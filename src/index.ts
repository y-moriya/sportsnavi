import { loadConfig, MAX_NOTIFICATIONS_PER_RUN } from "./config.js";
import { Logger } from "./logger.js";
import { ProcessLock } from "./storage.js";
import { fetchNewsListPage, filterNews } from "./scraper.js";
import { processAndNotifyItem } from "./notifier.js";
import { rotateLogFile } from "./rotator.js";
import { GeminiClient } from "./gemini.js";
import { VectorStorage } from "./vector-storage.js";

export async function runBatch(): Promise<void> {
  const config = loadConfig();
  const log = new Logger({
    appName: "sportsnavi",
    dataset: config.axiomDataset,
    token: config.axiomToken,
  });

  const lock = new ProcessLock(config.lockFilePath);

  // 1. プロセスロックの取得（前回のジョブがまだ実行中なら重複実行をスキップ）
  if (!lock.acquire()) {
    log.info("Previous sportsnavi batch job is still running, skipping.");
    await log.flush();
    return;
  }

  log.info("Started sportsnavi batch job");

  let storage: VectorStorage | undefined;
  const gemini = config.geminiApiKey
    ? new GeminiClient(config.geminiApiKey)
    : undefined;

  try {
    if (!config.webhookUrl) {
      throw new Error("WEBHOOK_URL is not configured in environment or .env");
    }

    // 2. ログファイルのローテーションチェック（上限サイズ超過時に自動世代交代）
    rotateLogFile(
      {
        logFilePath: config.cronLogPath,
        maxSizeBytes: config.maxLogSizeBytes,
        maxFiles: config.maxLogFiles,
      },
      log,
    );

    // 3. SQLite ストレージ初期化・旧JSON履歴移行・期限切れデータのクリーンアップ
    storage = new VectorStorage(config.vectorDbPath);
    const migratedHistory = storage.migrateJsonHistory(config.historyFilePath);
    if (migratedHistory > 0) {
      log.info("Migrated legacy JSON history to SQLite", {
        count: migratedHistory,
      });
    }

    const cleanedVectors = storage.cleanup();
    if (cleanedVectors > 0) {
      log.info("Cleaned up expired vector records", { count: cleanedVectors });
    }

    // 4. ニュース一覧を取得
    const rawItems = await fetchNewsListPage(undefined, log);
    if (rawItems.length === 0) {
      log.info("No news items found or fetch failed.");
      return;
    }

    // 5. タイトル・クレジットによる一次フィルタリング
    const filteredItems = filterNews(rawItems, log);

    // 6. SQLite 履歴を参照し、未通知の記事のみ抽出
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
      storage.registerUrl(item.url);

      const notified = await processAndNotifyItem(
        item,
        config.webhookUrl,
        log,
        {
          gemini,
          vectorStorage: storage,
          similarityThreshold: config.similarityThreshold,
        },
      );

      // 新規通知に成功し、かつ次の記事がある場合のみレートリミット保護のため待機
      if (notified && i < targetItems.length - 1 && config.notifyIntervalMs > 0) {
        log.info(
          "Waiting for Discord rate limit protection before checking next article",
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
    if (storage) {
      try {
        storage.close();
      } catch {
        // ignore
      }
    }
    // ロックを解放
    lock.release();
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
