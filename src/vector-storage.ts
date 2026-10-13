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
 * 浮動小数点配列をバイナリ Buffer (Float32Array) にシリアライズ
 */
export function serializeVector(vector: number[]): Buffer {
  const floatArray = new Float32Array(vector);
  return Buffer.from(
    floatArray.buffer,
    floatArray.byteOffset,
    floatArray.byteLength,
  );
}

/**
 * バイナリ Buffer または JSON 文字列から浮動小数点配列をデシリアライズ
 */
export function deserializeVector(raw: Buffer | string): number[] {
  if (typeof raw === "string") {
    return JSON.parse(raw) as number[];
  }
  const floatArray = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(floatArray);
}

/**
 * 2つのベクトル間のコサイン類似度を計算
 * @param normSqA 事前計算済みの vecA のノルム二乗（指定された場合は再計算を省略）
 */
export function cosineSimilarity(
  vecA: number[],
  vecB: number[],
  normSqA?: number,
): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let computedNormSqA = normSqA ?? 0;
  let normSqB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    if (normSqA === undefined) {
      computedNormSqA += a * a;
    }
    normSqB += b * b;
  }

  if (computedNormSqA === 0 || normSqB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(computedNormSqA) * Math.sqrt(normSqB));
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
        vector BLOB NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_article_vectors_timestamp ON article_vectors(timestamp);
      CREATE INDEX IF NOT EXISTS idx_article_vectors_url ON article_vectors(url);

      CREATE TABLE IF NOT EXISTS url_history (
        url TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_url_history_timestamp ON url_history(timestamp);
    `);
  }

  /**
   * 記事ベクトルを保存（バイナリ BLOB として保存）
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
      serializeVector(article.vector),
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
      vector: Buffer | string;
      timestamp: number;
    }>;

    return rows.map((row) => ({
      ...row,
      vector: deserializeVector(row.vector),
    }));
  }

  /**
   * クエリベクトルに最も類似した記事を探索（クエリノルムの事前計算により高速化）
   */
  findMostSimilar(
    queryVector: number[],
    threshold = 0.8,
    retentionMs = 7 * 24 * 60 * 60 * 1000,
  ): { article: StoredArticle; score: number } | null {
    const articles = this.getRecentArticles(retentionMs);
    let topScore = -1;
    let topArticle: StoredArticle | null = null;

    let queryNormSq = 0;
    for (let i = 0; i < queryVector.length; i++) {
      queryNormSq += queryVector[i] * queryVector[i];
    }

    for (const article of articles) {
      const score = cosineSimilarity(queryVector, article.vector, queryNormSq);
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
   * URL が既読登録済みか判定
   */
  isUrlRegistered(url: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM url_history WHERE url = ?")
      .get(url);
    return Boolean(row);
  }

  /**
   * URL を既読登録
   */
  registerUrl(url: string, timestamp = Date.now()): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO url_history (url, timestamp) VALUES (?, ?)",
      )
      .run(url, timestamp);
  }

  /**
   * 複数 URL から未登録のもののみを抽出（単一の IN クエリで高速判定）
   */
  filterUnregistered<T extends { url: string }>(items: T[]): T[] {
    if (items.length === 0) {
      return [];
    }

    const placeholders = items.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT url FROM url_history WHERE url IN (${placeholders})`)
      .all(...items.map((i) => i.url)) as Array<{ url: string }>;

    const seen = new Set(rows.map((r) => r.url));
    return items.filter((item) => !seen.has(item.url));
  }

  /**
   * 既存の JSON 履歴ファイルがあれば SQLite に安全に移行
   */
  migrateJsonHistory(jsonPath: string): number {
    if (!fs.existsSync(jsonPath)) {
      return 0;
    }

    try {
      const content = fs.readFileSync(jsonPath, "utf-8");
      const data = JSON.parse(content) as Record<string, number>;
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO url_history (url, timestamp) VALUES (?, ?)",
      );

      const migrate = this.db.transaction((entries: [string, number][]) => {
        let count = 0;
        for (const [url, ts] of entries) {
          insert.run(url, ts);
          count++;
        }
        return count;
      });

      const count = migrate(Object.entries(data));
      try {
        fs.renameSync(jsonPath, `${jsonPath}.migrated`);
      } catch {
        // ignore
      }
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * 期限切れの古いベクトルデータおよび URL 履歴を削除
   */
  cleanup(
    vectorRetentionMs = 7 * 24 * 60 * 60 * 1000,
    urlRetentionMs = 48 * 60 * 60 * 1000,
  ): number {
    const vectorThreshold = Date.now() - vectorRetentionMs;
    const vectorStmt = this.db.prepare(
      "DELETE FROM article_vectors WHERE timestamp < ?",
    );
    const vectorResult = vectorStmt.run(vectorThreshold);

    const urlThreshold = Date.now() - urlRetentionMs;
    const urlStmt = this.db.prepare(
      "DELETE FROM url_history WHERE timestamp < ?",
    );
    urlStmt.run(urlThreshold);

    return vectorResult.changes;
  }

  /**
   * データベース接続を閉じる
   */
  close(): void {
    this.db.close();
  }
}
