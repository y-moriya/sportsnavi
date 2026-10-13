import type { NewsItem } from "./types.js";
import type { Logger } from "./logger.js";

/**
 * 連続する3行以上の空行を2行に正規化
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * 長文記事を Discord の上限文字数（2,000文字）以下のチャンクに分割
 */
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
 * Discord Webhook へメッセージを送信
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
