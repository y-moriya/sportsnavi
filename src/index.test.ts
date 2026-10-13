import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  filterPhotoLines,
  normalizeNewlines,
  filterNews,
  parseNewsListHtml,
  parseArticleHtml,
  type NewsItem,
} from "./scraper.js";
import { LocalStorage } from "./storage.js";
import { splitContentIntoChunks, processAndNotifyItem } from "./notifier.js";
import { Logger } from "./logger.js";

describe("sportsnavi local batch", () => {
  let tmpDir: string;
  let historyFile: string;
  let lockFile: string;
  let storage: LocalStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sportsnavi-test-"));
    historyFile = path.join(tmpDir, "history.json");
    lockFile = path.join(tmpDir, "process.lock");
    storage = new LocalStorage(tmpDir, historyFile, lockFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("scraper utilities", () => {
    it("filterPhotoLines removes lines starting with 【...】", () => {
      const text = [
        "通常の文章です。",
        "【写真】マウンドの投手",
        "　【写真あり】ベンチの様子",
        "【動画】ホームランシーン",
        "文中に【注釈】がある文章です。",
        "最後の文章です。",
      ].join("\n");

      const expected = [
        "通常の文章です。",
        "文中に【注釈】がある文章です。",
        "最後の文章です。",
      ].join("\n");

      expect(filterPhotoLines(text)).toBe(expected);
    });

    it("normalizeNewlines compresses multiple newlines", () => {
      const input = "段落1\n\n\n\n段落2\n\n\n段落3";
      expect(normalizeNewlines(input)).toBe("段落1\n\n段落2\n\n段落3");
    });

    it("parseNewsListHtml parses sportsnavi items accurately", () => {
      const sampleHtml = `
        <div class="cm-timeLine__item">
          <a class="cm-timeLine__itemArticleLink" href="https://news.yahoo.co.jp/articles/sample1">
            <h2 class="cm-timeLine__itemTitle">阪神タイガースが劇的サヨナラ勝ち</h2>
          </a>
          <span class="cm-timeLine__itemCredit">デイリースポーツ</span>
        </div>
        <div class="cm-timeLine__item">
          <a class="cm-timeLine__itemArticleLink" href="https://news.yahoo.co.jp/articles/sample2">
            <h2 class="cm-timeLine__itemTitle">巨人軍の話題</h2>
          </a>
          <span class="cm-timeLine__itemCredit">スポニチアネックス</span>
        </div>
      `;

      const items = parseNewsListHtml(sampleHtml);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        title: "阪神タイガースが劇的サヨナラ勝ち",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/articles/sample1",
      });
    });

    it("filterNews filters out non-Hanshin and ignored titles/credits", () => {
      const testLogger = new Logger({ appName: "test" });
      const items: NewsItem[] = [
        {
          title: "巨人の選手情報",
          credit: "デイリースポーツ",
          url: "https://example.com/1",
        },
        {
          title: "阪神タイガースの新戦力",
          credit: "デイリースポーツ",
          url: "https://example.com/2",
        },
        {
          title: "阪神タイガースの特集（虎になれ）",
          credit: "デイリースポーツ",
          url: "https://example.com/3",
        },
        {
          title: "阪神タイガースの試合結果",
          credit: "東スポWEB", // IGNORE_CREDITS
          url: "https://example.com/4",
        },
      ];

      const filtered = filterNews(items, testLogger);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("阪神タイガースの新戦力");
    });

    it("parseArticleHtml extracts title and body", () => {
      const html = `
        <article id="uamods">
          <header><h1>阪神・岡田監督の談話</h1></header>
          <div><div>
            <p>1ページ目の段落です。</p>
            <p>【写真】笑顔の監督</p>
            <p>2つ目の段落です。</p>
          </div></div>
          <a href="https://news.yahoo.co.jp/articles/sample1?page=2">次へ</a>
        </article>
      `;

      const result = parseArticleHtml(
        html,
        1,
        "https://news.yahoo.co.jp/articles/sample1",
      );
      expect(result.title).toBe("阪神・岡田監督の談話");
      expect(result.body).toBe("1ページ目の段落です。\n2つ目の段落です。");
      expect(result.hasNextPage).toBe(true);
    });

    it("parseArticleHtml handles <br> tags within paragraphs and strips photo links", () => {
      const html = `
        <article id="uamods">
          <header><h1>阪神タイガースの速報</h1></header>
          <div><div>
            <p>
              14日に開幕する。<br><br>
              <a href="https://example.com/photo">【写真】マウンドで練習する投手</a><br><br>
              阪神は村上投手が先発。<br><br>
              好投が期待される。
            </p>
          </div></div>
        </article>
      `;

      const result = parseArticleHtml(
        html,
        1,
        "https://news.yahoo.co.jp/articles/sample2",
      );
      expect(result.title).toBe("阪神タイガースの速報");
      expect(result.body).not.toContain("【写真】");
      expect(result.body).toContain("14日に開幕する。\n\n阪神は村上投手が先発。\n\n好投が期待される。");
    });
  });

  describe("LocalStorage", () => {
    it("handles registration and filtering correctly", () => {
      const url1 = "https://news.yahoo.co.jp/articles/test1";
      const url2 = "https://news.yahoo.co.jp/articles/test2";

      expect(storage.isRegistered(url1)).toBe(false);
      storage.register(url1);
      expect(storage.isRegistered(url1)).toBe(true);

      const items = [{ url: url1 }, { url: url2 }];
      const unregistered = storage.filterUnregistered(items);
      expect(unregistered).toEqual([{ url: url2 }]);
    });

    it("acquires and releases process lock", () => {
      expect(storage.acquireLock()).toBe(true);
      // 同一期間内での二重取得は拒否
      expect(storage.acquireLock()).toBe(false);

      storage.releaseLock();
      // 解放後は再度取得可能
      expect(storage.acquireLock()).toBe(true);
      storage.releaseLock();
    });

    it("cleans up old records older than retention threshold", () => {
      const urlOld = "https://example.com/old";
      const urlNew = "https://example.com/new";
      const pastTime = Date.now() - 50 * 60 * 60 * 1000; // 50時間前

      storage.register(urlOld, pastTime);
      storage.register(urlNew, Date.now());

      storage.cleanup(48 * 60 * 60 * 1000); // 48時間保持
      expect(storage.isRegistered(urlOld)).toBe(false);
      expect(storage.isRegistered(urlNew)).toBe(true);
    });
  });

  describe("notifier and chunking", () => {
    it("splitContentIntoChunks splits long text by lines under 2000 chars", () => {
      const longText = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join(
        "\n",
      );
      const chunks = splitContentIntoChunks(longText, 100);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });

    it("processAndNotifyItem skips keywords and duplicate articles", async () => {
      const originalFetch = globalThis.fetch;
      const testLogger = new Logger({ appName: "test" });

      // 1. キーワード除外のテスト
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          "<article id='uamods'><header><h1>タイトル</h1></header><div><div><p>ファンは「素晴らしい」と話した</p></div></div></article>",
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const item: NewsItem = {
        title: "阪神ニュース",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/articles/kw-test",
      };

      const resultKw = await processAndNotifyItem(
        item,
        "https://discord.com/api/webhooks/test",
        testLogger,
      );
      expect(resultKw).toBe(false);

      // 2. 正常通知のテスト
      let discordSent = false;
      globalThis.fetch = vi.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("discord.com")) {
          discordSent = true;
          return new Response("ok", { status: 200 });
        }
        return new Response(
          "<article id='uamods'><header><h1>阪神佐藤輝明が活躍</h1></header><div><div><p>正常な記事本文です。</p></div></div></article>",
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const resultOk = await processAndNotifyItem(
        item,
        "https://discord.com/api/webhooks/test",
        testLogger,
      );
      expect(resultOk).toBe(true);
      expect(discordSent).toBe(true);

      globalThis.fetch = originalFetch;
    });
  });

  describe("batch execution with log rotation", () => {
    it("rotates cron.log during runBatch execution when oversized", async () => {
      const { runBatch } = await import("./index.js");
      const cronLogFile = path.join(tmpDir, "cron.log");
      fs.writeFileSync(cronLogFile, "A".repeat(500), "utf-8");

      const originalEnv = { ...process.env };
      process.env.DATA_DIR = tmpDir;
      process.env.WEBHOOK_URL = "https://discord.com/api/webhooks/dummy";
      process.env.CRON_LOG_PATH = cronLogFile;
      process.env.MAX_LOG_SIZE_BYTES = "200";

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => {
        return new Response("<html></html>", { status: 200 });
      }) as unknown as typeof fetch;

      try {
        await runBatch();

        // ログローテーションが行われたことを確認
        expect(fs.existsSync(`${cronLogFile}.1`)).toBe(true);
        expect(fs.readFileSync(`${cronLogFile}.1`, "utf-8")).toBe("A".repeat(500));
        expect(fs.existsSync(cronLogFile)).toBe(true);
        expect(fs.statSync(cronLogFile).size).toBe(0);
      } finally {
        process.env = originalEnv;
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("local SQLite deduplication flow", () => {
    it("deduplicates in-process via local SQLite without echo-breaker", async () => {
      const { VectorStorage } = await import("./vector-storage.js");
      const { GeminiClient } = await import("./gemini.js");
      const vectorDb = new VectorStorage(path.join(tmpDir, "test-vectors.db"));
      const gemini = new GeminiClient("dummy-key");

      // モック埋め込みベクトル
      vi.spyOn(gemini, "generateEmbedding").mockResolvedValue([1, 0, 0]);

      const originalFetch = globalThis.fetch;
      let discordCalls = 0;
      globalThis.fetch = vi.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("discord.com")) {
          discordCalls++;
          return new Response("ok", { status: 200 });
        }
        return new Response(
          "<article id='uamods'><header><h1>阪神佐藤輝明が活躍</h1></header><div><div><p>本文です。</p></div></div></article>",
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const testLogger = new Logger({ appName: "test" });

      try {
        const item1: NewsItem = {
          title: "阪神佐藤がホームラン",
          credit: "デイリースポーツ",
          url: "https://example.com/art1",
        };
        const notified1 = await processAndNotifyItem(
          item1,
          "https://discord.com/webhook",
          testLogger,
          { gemini, vectorStorage: vectorDb, similarityThreshold: 0.9 },
        );
        expect(notified1).toBe(true);
        expect(discordCalls).toBe(1);

        // 2回目（同一ベクトル）：ローカル SQLite により即座に重複判定
        const item2: NewsItem = {
          title: "阪神佐藤が特大弾（別メディア）",
          credit: "スポニチアネックス",
          url: "https://example.com/art2",
        };
        const notified2 = await processAndNotifyItem(
          item2,
          "https://discord.com/webhook",
          testLogger,
          { gemini, vectorStorage: vectorDb, similarityThreshold: 0.9 },
        );
        expect(notified2).toBe(false);
        // Discord 送信回数は増えていない
        expect(discordCalls).toBe(1);
      } finally {
        vectorDb.close();
        globalThis.fetch = originalFetch;
      }
    });
  });
});

