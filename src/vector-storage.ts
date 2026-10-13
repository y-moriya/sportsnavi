import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export interface StoredArticle {
  id: string;
  url: string;
  title: string;
  media_name: string;
  vector: number[];
  timestamp: number;
}

/**
 * 2つのベクトル間のコサイン類似度を計算
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS article_vectors (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        media_name TEXT NOT NULL,
        vector TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_article_vectors_timestamp ON article_vectors(timestamp);
      CREATE INDEX IF NOT EXISTS idx_article_vectors_url ON article_vectors(url);
    `);
  }

  /**
   * 記事ベクトルを保存
   */
  saveArticle(article: StoredArticle): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO article_vectors (id, url, title, media_name, vector, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      article.id,
      article.url,
      article.title,
      article.media_name,
      JSON.stringify(article.vector),
      article.timestamp,
    );
  }

  /**
   * 直近の記事一覧を取得
   */
  getRecentArticles(retentionMs = 7 * 24 * 60 * 60 * 1000): StoredArticle[] {
    const since = Date.now() - retentionMs;
    const stmt = this.db.prepare(`
      SELECT id, url, title, media_name, vector, timestamp
      FROM article_vectors
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(since) as Array<{
      id: string;
      url: string;
      title: string;
      media_name: string;
      vector: string;
      timestamp: number;
    }>;

    return rows.map((row) => ({
      ...row,
      vector: JSON.parse(row.vector) as number[],
    }));
  }

  /**
   * クエリベクトルに最も類似した記事を探索
   */
  findMostSimilar(
    queryVector: number[],
    threshold = 0.8,
    retentionMs = 7 * 24 * 60 * 60 * 1000,
  ): { article: StoredArticle; score: number } | null {
    const articles = this.getRecentArticles(retentionMs);
    let topScore = -1;
    let topArticle: StoredArticle | null = null;

    for (const article of articles) {
      const score = cosineSimilarity(queryVector, article.vector);
      if (score > topScore) {
        topScore = score;
        topArticle = article;
      }
    }

    if (topArticle && topScore >= threshold) {
      return { article: topArticle, score: topScore };
    }

    return null;
  }

  /**
   * 期限切れの古いベクトルデータを削除
   */
  cleanup(retentionMs = 7 * 24 * 60 * 60 * 1000): number {
    const threshold = Date.now() - retentionMs;
    const stmt = this.db.prepare(`
      DELETE FROM article_vectors WHERE timestamp < ?
    `);
    const result = stmt.run(threshold);
    return result.changes;
  }

  /**
   * データベース接続を閉じる
   */
  close(): void {
    this.db.close();
  }
}
