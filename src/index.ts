import { loadConfig, MAX_NOTIFICATIONS_PER_RUN } from "./config.js";
import { Logger } from "./logger.js";
import { LocalStorage } from "./storage.js";
import { fetchNewsListPage, filterNews, parseNewsListHtml } from "./scraper.js";
import { processAndNotifyItem } from "./notifier.js";

export async function runBatch(): Promise<void> {
  const config = loadConfig();
  const log = new Logger({
    appName: "sportsnavi",
    dataset: config.axiomDataset,
    token: config.axiomToken,
  });

  const storage = new LocalStorage(
    config.dataDir,
    config.historyFilePath,
    config.lockFilePath,
  );

  // 1. プロセスロックの取得（前回のジョブがまだ実行中なら重複実行をスキップ）
  if (!storage.acquireLock()) {
    log.info("Previous sportsnavi batch job is still running, skipping.");
    await log.flush();
    return;
  }

  log.info("Started sportsnavi batch job");

  try {
    if (!config.webhookUrl) {
      throw new Error("WEBHOOK_URL is not configured in environment or .env");
    }

    // 2. 48時間以上前の古いURL履歴をクリーンアップ
    storage.cleanup();

    // 3. ニュース一覧を取得
    const rawItems = await fetchNewsListPage(undefined, log);
    if (rawItems.length === 0) {
      log.info("No news items found or fetch failed.");
      return;
    }

    // 4. タイトル・クレジットによる一次フィルタリング
    const filteredItems = filterNews(rawItems, log);

    // 5. ローカル履歴を参照し、未通知の記事のみ抽出
    const unregisteredItems = storage.filterUnregistered(filteredItems);

    log.info("News items prepared for notification", {
      rawCount: rawItems.length,
      filteredCount: filteredItems.length,
      unregisteredCount: unregisteredItems.length,
    });

    if (unregisteredItems.length === 0) {
      log.info("No new articles to notify.");
      return;
    }

    // 1回の実行あたりの通知上限（最大5件）
    const targetItems = unregisteredItems.slice(0, MAX_NOTIFICATIONS_PER_RUN);

    for (let i = 0; i < targetItems.length; i++) {
      const item = targetItems[i];

      // 重複チェック前に既読登録して二重通知を防止
      storage.register(item.url);

      const notified = await processAndNotifyItem(
        item,
        config.webhookUrl,
        config.echoBreakerUrl,
        log,
      );

      // 新規通知に成功し、かつ次の記事がある場合のみベクターDB反映待ち（デフォルト90秒）
      if (notified && i < targetItems.length - 1 && config.notifyIntervalMs > 0) {
        log.info(
          "Waiting for vector DB propagation before checking next article",
          { intervalMs: config.notifyIntervalMs },
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.notifyIntervalMs),
        );
      }
    }

    log.info("sportsnavi batch job completed successfully.");
  } catch (err) {
    log.error("sportsnavi batch job encountered an error", err);
  } finally {
    // ロックを解放
    storage.releaseLock();
    await log.flush();
  }
}

// CLIから直接実行された場合
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("src/index.ts") ||
  process.argv[1]?.endsWith("dist/index.js")
) {
  runBatch()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
