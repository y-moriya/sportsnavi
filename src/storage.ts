import fs from "node:fs";
import path from "node:path";

export interface HistoryRecord {
  url: string;
  timestamp: number;
}

export class LocalStorage {
  private historyFilePath: string;
  private lockFilePath: string;
  private dataDir: string;

  constructor(dataDir: string, historyFilePath: string, lockFilePath: string) {
    this.dataDir = dataDir;
    this.historyFilePath = historyFilePath;
    this.lockFilePath = lockFilePath;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * プロセスロックを取得（重複実行防止）
   * @param maxLockAgeMs ロックが放置されたとみなす有効期限（デフォルト30分）
   */
  acquireLock(maxLockAgeMs = 30 * 60 * 1000): boolean {
    this.ensureDir();
    if (fs.existsSync(this.lockFilePath)) {
      try {
        const content = fs.readFileSync(this.lockFilePath, "utf-8");
        const { timestamp, pid } = JSON.parse(content);
        const age = Date.now() - timestamp;

        // まだ有効期限内で、プロセスが生存している可能性がある場合
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
  releaseLock(): void {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch {
      // ignore
    }
  }

  /**
   * 履歴ファイルを読み込み
   */
  private readHistory(): Record<string, number> {
    this.ensureDir();
    if (!fs.existsSync(this.historyFilePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.historyFilePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * 履歴ファイルに書き込み
   */
  private writeHistory(data: Record<string, number>): void {
    this.ensureDir();
    fs.writeFileSync(this.historyFilePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * URLが既に登録済み（通知済み）か判定
   */
  isRegistered(url: string): boolean {
    const history = this.readHistory();
    return Boolean(history[url]);
  }

  /**
   * URLを既読登録
   */
  register(url: string, timestamp = Date.now()): void {
    const history = this.readHistory();
    history[url] = timestamp;
    this.writeHistory(history);
  }

  /**
   * 複数URLから未登録のものだけを抽出
   */
  filterUnregistered<T extends { url: string }>(items: T[]): T[] {
    const history = this.readHistory();
    return items.filter((item) => !history[item.url]);
  }

  /**
   * 48時間以上前の古い履歴を削除してファイル肥大化を防止
   */
  cleanup(retentionMs = 48 * 60 * 60 * 1000): void {
    const history = this.readHistory();
    const now = Date.now();
    let modified = false;

    for (const [url, timestamp] of Object.entries(history)) {
      if (now - timestamp > retentionMs) {
        delete history[url];
        modified = true;
      }
    }

    if (modified) {
      this.writeHistory(history);
    }
  }
}
