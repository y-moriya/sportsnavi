import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchNewsListPage, fetchFullArticleContent } from "./scraper.js";
import { sendDiscordMessage } from "./discord.js";
import { GeminiClient } from "./gemini.js";
import { Logger } from "./logger.js";
import type { NewsItem } from "./types.js";

describe("Network resilience and retry handling", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetchNewsListPage retries on transient network failure and returns parsed items", async () => {
    let callCount = 0;
    const sampleHtml = `
      <div class="cm-timeLine__item">
        <a class="cm-timeLine__itemArticleLink" href="https://news.yahoo.co.jp/articles/sample1">
          <h2 class="cm-timeLine__itemTitle">阪神タイガースの速報</h2>
        </a>
        <span class="cm-timeLine__itemCredit">デイリースポーツ</span>
      </div>
    `;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(sampleHtml, { status: 200 });
    }) as unknown as typeof fetch;

    const testLogger = new Logger({ appName: "test" });
    const items = await fetchNewsListPage(undefined, testLogger);

    expect(callCount).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("阪神タイガースの速報");
  });

  it("fetchFullArticleContent retries on transient network failure and returns article detail", async () => {
    let callCount = 0;
    const articleHtml = `
      <article id="uamods">
        <header><h1>阪神タイガースの速報</h1></header>
        <div><div><p>本文です。</p></div></div>
      </article>
    `;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(articleHtml, { status: 200 });
    }) as unknown as typeof fetch;

    const testLogger = new Logger({ appName: "test" });
    const article = await fetchFullArticleContent(
      "https://news.yahoo.co.jp/articles/sample1",
      testLogger,
    );

    expect(callCount).toBe(2);
    expect(article).not.toBeNull();
    expect(article?.title).toBe("阪神タイガースの速報");
  });

  it("sendDiscordMessage retries on transient failure (e.g. 503 or network error) and succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const testLogger = new Logger({ appName: "test" });
    const newsItem: NewsItem = {
      title: "阪神タイガースの速報",
      credit: "デイリースポーツ",
      url: "https://news.yahoo.co.jp/articles/sample1",
    };

    await expect(
      sendDiscordMessage(
        "https://discord.com/webhook",
        "本文",
        newsItem,
        testLogger,
      ),
    ).resolves.not.toThrow();
    expect(callCount).toBe(2);
  });

  it("GeminiClient.generateEmbedding retries on transient failure and returns embeddings", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(
        JSON.stringify({
          embedding: {
            values: [0.1, 0.2, 0.3],
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const gemini = new GeminiClient("dummy-key");
    const embedding = await gemini.generateEmbedding("sample text");

    expect(callCount).toBe(2);
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("Logger.flush does not dump raw Error stacks with console.error on network failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = vi.fn(async () => {
      const err = new TypeError("fetch failed");
      err.cause = new Error("EHOSTUNREACH");
      throw err;
    }) as unknown as typeof fetch;

    const testLogger = new Logger({
      appName: "sportsnavi",
      token: "dummy-token",
      dataset: "test-dataset",
    });
    testLogger.info("Test message");

    await testLogger.flush();

    // Verify console.error is NOT called with raw multi-line AggregateError / TypeError object
    // which pollutes cron.log and trips Grafana alerts
    for (const call of errorSpy.mock.calls) {
      const formatted = call.map((c) => String(c)).join(" ");
      expect(formatted).not.toContain("AggregateError");
      expect(formatted).not.toContain("EHOSTUNREACH");
    }
  });

  it("Logger.flush logs warnings with [WARN] tag on Axiom failure to avoid tripping Grafana alerts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = vi.fn(async () => {
      const err = new TypeError("fetch failed");
      err.cause = new Error("EHOSTUNREACH");
      throw err;
    }) as unknown as typeof fetch;

    const testLogger = new Logger({
      appName: "sportsnavi",
      token: "dummy-token",
      dataset: "test-dataset",
    });
    testLogger.info("Test message");

    await testLogger.flush();

    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls[0].map((c) => String(c)).join(" ");
    expect(warnCall).toContain("[sportsnavi] [WARN]");
    expect(/(\[INFO\]|\[WARN\])/i.test(warnCall)).toBe(true);
  });
});
