import type { NewsItem, CheckArticleRequest, CheckArticleResponse } from "./types.js";
import { fetchFullArticleContent } from "./scraper.js";
import { containsIgnoredKeywords, evaluateNewsMetadata } from "./filters.js";
import { splitContentIntoChunks, sendDiscordMessage } from "./discord.js";
import { checkEchoBreakerDuplicate } from "./deduplicator.js";
import type { Logger } from "./logger.js";

export {
  CheckArticleRequest,
  CheckArticleResponse,
  splitContentIntoChunks,
  sendDiscordMessage,
};

/**
 * echo-breaker による類似記事（重複）チェック（後方互換用ラッパー）
 */
export async function checkArticleDuplicate(
  echoBreakerUrl: string,
  newsItem: NewsItem,
  content: string,
  log?: Logger,
): Promise<boolean> {
  return checkEchoBreakerDuplicate(echoBreakerUrl, newsItem, content, log);
}

/**
 * 1記事の取得・検証・通知パイプライン
 * 1. メタデータ検証（expert除外等）
 * 2. 本文取得
 * 3. キーワード除外判定
 * 4. ベクトル重複判定（echo-breaker）
 * 5. Discord メッセージ送信
 *
 * @returns 通知が行われた場合 true、スキップされた場合 false
 */
export async function processAndNotifyItem(
  newsItem: NewsItem,
  webhookUrl: string,
  echoBreakerUrl: string,
  log?: Logger,
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

  // 4. 重複チェック（echo-breaker）
  const isDuplicate = await checkEchoBreakerDuplicate(
    echoBreakerUrl,
    newsItem,
    article.page1Text,
    log,
  );

  if (isDuplicate) {
    log?.info("Skipped duplicate news item", { title: newsItem.title });
    return false;
  }

  // 5. Discord 送信
  const chunks = splitContentIntoChunks(article.fullContent);
  for (const chunk of chunks) {
    await sendDiscordMessage(webhookUrl, chunk, newsItem, log);
  }

  return true;
}
