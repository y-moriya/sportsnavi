import type { NewsItem } from "./types.js";
import { fetchFullArticleContent } from "./scraper.js";
import { containsIgnoredKeywords, evaluateNewsMetadata } from "./filters.js";
import { splitContentIntoChunks, sendDiscordMessage } from "./discord.js";
import { checkLocalDuplicate } from "./deduplicator.js";
import type { Logger } from "./logger.js";
import type { GeminiClient } from "./gemini.js";
import type { VectorStorage } from "./vector-storage.js";

export {
  splitContentIntoChunks,
  sendDiscordMessage,
};

export interface ProcessItemContext {
  gemini?: GeminiClient;
  vectorStorage?: VectorStorage;
  similarityThreshold?: number;
}

/**
 * 1記事の取得・検証・通知パイプライン
 * 1. メタデータ検証（expert除外等）
 * 2. 本文取得
 * 3. キーワード除外判定
 * 4. ベクトル重複判定（ローカルSQLite）
 * 5. Discord メッセージ送信
 *
 * @returns 通知が行われた場合 true、スキップまたは失敗した場合 false
 */
export async function processAndNotifyItem(
  newsItem: NewsItem,
  webhookUrl: string,
  log?: Logger,
  context?: ProcessItemContext,
): Promise<boolean> {
  // 1. メタデータ検証
  const metaCheck = evaluateNewsMetadata(newsItem);
  if (!metaCheck.allowed) {
    if (metaCheck.reason === "expert_author") {
      log?.info("Ignored expert news item", { url: newsItem.url });
    }
    return false;
  }

  // 2. 本文取得
  const article = await fetchFullArticleContent(newsItem.url, log);
  if (!article) {
    return false;
  }

  // 3. キーワード除外判定（本文またはタイトルに含まれるか）
  if (
    containsIgnoredKeywords(article.page1Text) ||
    containsIgnoredKeywords(article.fullContent)
  ) {
    log?.info("Ignored news item due to keywords", { title: newsItem.title });
    return false;
  }

  // 4. 重複チェック（ローカル SQLite + Gemini）
  let isDuplicate = false;
  if (context?.gemini && context?.vectorStorage) {
    const result = await checkLocalDuplicate({
      gemini: context.gemini,
      storage: context.vectorStorage,
      newsItem,
      content: article.page1Text,
      threshold: context.similarityThreshold ?? 0.9,
      log,
    });
    isDuplicate = result.isDuplicate;
  }

  if (isDuplicate) {
    log?.info("Skipped duplicate news item", { title: newsItem.title });
    return false;
  }

  // 5. Discord 送信（個別エラーハンドリングにより他記事の通知継続を保護）
  try {
    const chunks = splitContentIntoChunks(article.fullContent);
    for (const chunk of chunks) {
      await sendDiscordMessage(webhookUrl, chunk, newsItem, log);
    }
    return true;
  } catch (err) {
    log?.error("Failed to deliver Discord notification for article", err, {
      title: newsItem.title,
      url: newsItem.url,
    });
    return false;
  }
}
