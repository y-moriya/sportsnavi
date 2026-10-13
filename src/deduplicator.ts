import type { NewsItem, CheckArticleRequest, CheckArticleResponse } from "./types.js";
import type { Logger } from "./logger.js";

/**
 * echo-breaker による類似記事（ベクトル重複）チェック
 */
export async function checkEchoBreakerDuplicate(
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
      // APIエラー時は通知を止めないフェイルオープン設計
      return false;
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
