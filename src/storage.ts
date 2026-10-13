import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface HistoryRecord {
  url: string;
  timestamp: number;
}

/**
 * プロセスロック管理（PID とタイムスタンプによる重複実行防止）
 */
export class ProcessLock {
  private lockFilePath: string;

  constructor(lockFilePath: string) {
    this.lockFilePath = lockFilePath;
    const dir = path.dirname(lockFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * プロセスロックを取得
   * @param maxLockAgeMs ロックが放置されたとみなす有効期限（デフォルト30分）
   */
  acquire(maxLockAgeMs = 30 * 60 * 1000): boolean {
    if (fs.existsSync(this.lockFilePath)) {
      try {
        const content = fs.readFileSync(this.lockFilePath, "utf-8");
        const { timestamp } = JSON.parse(content);
        const age = Date.now() - timestamp;

        if (age < maxLockAgeMs) {
          return false;
        }
      } catch {
        // パース失敗した古いロックファイルは上書き
      }
    }

    try {
      const lockData = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
      });
      fs.writeFileSync(this.lockFilePath, lockData, { flag: "w" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * プロセスロックを解放
   */
  release(): void {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * ローカルストレージ（プロセスロックおよび SQLite ベースの履歴管理）
 */
export class LocalStorage {
  private lock: ProcessLock;
  private db: Database.Database;

  constructor(dataDir: string, historyFilePath: string, lockFilePath: string) {
    this.lock = new ProcessLock(lockFilePath);

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, "history.db");
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS url_history (
        url TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_url_history_timestamp ON url_history(timestamp);
    `);

    // 既存の history.json があれば自動移行
    if (fs.existsSync(historyFilePath)) {
      try {
        const content = fs.readFileSync(historyFilePath, "utf-8");
        const data = JSON.parse(content) as Record<string, number>;
        const insert = this.db.prepare(
          "INSERT OR IGNORE INTO url_history (url, timestamp) VALUES (?, ?)",
        );
        for (const [url, ts] of Object.entries(data)) {
          insert.run(url, ts);
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * プロセスロックを取得
   */
  acquireLock(maxLockAgeMs = 30 * 60 * 1000): boolean {
    return this.lock.acquire(maxLockAgeMs);
  }

  /**
   * プロセスロックを解放
   */
  releaseLock(): void {
    this.lock.release();
  }

  /**
   * URLが既に登録済みか判定
   */
  isRegistered(url: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM url_history WHERE url = ?")
      .get(url);
    return Boolean(row);
  }

  /**
   * URLを既読登録
   */
  register(url: string, timestamp = Date.now()): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO url_history (url, timestamp) VALUES (?, ?)",
      )
      .run(url, timestamp);
  }

  /**
   * 複数URLから未登録のものだけを抽出
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
   * 期限切れの古い履歴を削除
   */
  cleanup(retentionMs = 48 * 60 * 60 * 1000): void {
    const threshold = Date.now() - retentionMs;
    this.db
      .prepare("DELETE FROM url_history WHERE timestamp < ?")
      .run(threshold);
  }

  /**
   * データベース接続を閉じる
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
