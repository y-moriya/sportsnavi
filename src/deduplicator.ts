import type { NewsItem } from "./types.js";
import type { Logger } from "./logger.js";
import type { GeminiClient } from "./gemini.js";
import type { VectorStorage } from "./vector-storage.js";

/**
 * 類似度判定用のテキスト前処理
 */
export function preprocessContent(
  media: string,
  title: string,
  content: string,
): string {
  const truncatedContent = content.slice(0, 500);
  return `Media: ${media}\nTitle: ${title}\nContent: ${truncatedContent}`;
}

export interface LocalDeduplicateOptions {
  gemini: GeminiClient;
  storage: VectorStorage;
  newsItem: NewsItem;
  content: string;
  threshold?: number;
  log?: Logger;
}

/**
 * ローカル SQLite + Gemini Embedding によるインプロセス重複判定
 */
export async function checkLocalDuplicate(
  options: LocalDeduplicateOptions,
): Promise<{ isDuplicate: boolean; score: number }> {
  const { gemini, storage, newsItem, content, threshold = 0.9, log } = options;

  const textToEmbed = preprocessContent(
    newsItem.credit,
    newsItem.title,
    content,
  );

  let vector: number[];
  try {
    vector = await gemini.generateEmbedding(textToEmbed);
  } catch (err) {
    log?.warn("Failed to generate embedding via Gemini API", {
      title: newsItem.title,
      error: String(err),
    });
    // API エラー時は通知を妨げないフェイルオープン設計
    return { isDuplicate: false, score: 0 };
  }

  // ローカル SQLite の直近記事ベクトルと照合
  const match = storage.findMostSimilar(vector, threshold);
  if (match) {
    log?.info("Duplicate check completed", {
      title: newsItem.title,
      isDuplicate: true,
      score: match.score,
      matchedTitle: match.article.title,
      matchedMedia: match.article.media_name,
    });
    return { isDuplicate: true, score: match.score };
  }

  // 重複でない場合はローカル SQLite にインデックス登録
  storage.saveArticle({
    id: crypto.randomUUID(),
    url: newsItem.url,
    title: newsItem.title,
    media_name: newsItem.credit,
    vector,
    timestamp: Date.now(),
  });

  log?.info("Duplicate check completed", {
    title: newsItem.title,
    isDuplicate: false,
    score: 0,
  });

  return { isDuplicate: false, score: 0 };
}
