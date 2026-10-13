import { NewsItem, fetchFullArticleContent, normalizeNewlines } from "./scraper.js";
import { IGNORE_KEYWORDS } from "./config.js";
import { Logger } from "./logger.js";

export interface CheckArticleRequest {
  media_name: string;
  url: string;
  title: string;
  content: string;
}

export interface CheckArticleResponse {
  is_duplicate: boolean;
  similarity_score: number;
  verification_result?: boolean;
  message: string;
  debug_info?: {
    most_similar_article: {
      title: string;
      url: string;
      score: number;
    } | null;
  };
}

export function splitContentIntoChunks(
  content: string,
  maxChunkLength = 2000,
): string[] {
  const lines = content.split("\n");
  let currentChunk = "";
  const chunks: string[] = [];

  for (const line of lines) {
    if (currentChunk.length + line.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += `${line.trim()}\n`;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks.map((chunk) => normalizeNewlines(chunk));
}

/**
 * echo-breaker による類似記事（重複）チェック
 */
export async function checkArticleDuplicate(
  echoBreakerUrl: string,
  newsItem: NewsItem,
  content: string,
  log?: Logger,
): Promise<boolean> {
  const payload: CheckArticleRequest = {
    media_name: newsItem.credit,
    url: newsItem.url,
    title: newsItem.title,
    content,
  };

  try {
    const res = await fetch(echoBreakerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      log?.warn(`echo-breaker returned HTTP ${res.status}: ${errText}`);
      return false; // APIエラー時は通知を妨げない
    }

    const json = (await res.json()) as CheckArticleResponse;
    log?.info("Duplicate check completed", {
      title: newsItem.title,
      isDuplicate: json.is_duplicate,
      score: json.similarity_score,
    });

    return json.is_duplicate;
  } catch (err) {
    log?.warn("Failed to contact echo-breaker API", { error: String(err) });
    return false;
  }
}

/**
 * Discord Webhook へメッセージ送信
 */
export async function sendDiscordMessage(
  webhookUrl: string,
  content: string,
  newsItem: NewsItem,
  log?: Logger,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      username: newsItem.credit,
      avatar_url:
        "https://s.yimg.jp/images/sportsnavi/common/apple-touch-icon.png",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to send Discord notification: HTTP ${res.status} ${res.statusText}`,
    );
  }

  log?.info("Sent Discord message", {
    credit: newsItem.credit,
    title: newsItem.title,
  });
}

/**
 * 1記事の取得・検証・通知
 * @returns 通知が行われた場合 true、スキップされた場合 false
 */
export async function processAndNotifyItem(
  newsItem: NewsItem,
  webhookUrl: string,
  echoBreakerUrl: string,
  log?: Logger,
): Promise<boolean> {
  if (newsItem.url.includes("expert")) {
    log?.info("Ignored expert news item", { url: newsItem.url });
    return false;
  }

  const fetched = await fetchFullArticleContent(newsItem.url, log);
  if (!fetched) {
    return false;
  }

  // キーワードで除外された場合
  if (!fetched.fullContent) {
    log?.info("Ignored news item due to keywords", { title: newsItem.title });
    return false;
  }

  // 1ページ目の内容で類似記事（重複）チェック
  const isDuplicate = await checkArticleDuplicate(
    echoBreakerUrl,
    newsItem,
    fetched.page1Text,
    log,
  );

  if (isDuplicate) {
    log?.info("Skipped duplicate news item", { title: newsItem.title });
    return false;
  }

  // Discord へチャンク送信
  const chunks = splitContentIntoChunks(fetched.fullContent);
  for (const chunk of chunks) {
    await sendDiscordMessage(webhookUrl, chunk, newsItem, log);
  }

  return true;
}
