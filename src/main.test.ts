import { describe, it, expect, vi } from "vitest";
import worker, {
  filterNews,
  filterPhotoLines,
  filterUnregisteredNewsItems,
  getNewsArticleExpert,
  getNewsArticleNormal,
  normalizeNewlines,
  registerNewsItem,
  splitContentIntoChunks,
  type Env,
  type NewsItem,
} from "./main";
import { Logger } from "./logger";

class MockKVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(
    key: string,
    value: string,
    _options?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe("sportsnavi main", () => {
  it("filterPhotoLines removes lines starting with 【...】", () => {
    const text = [
      "通常の文章です。",
      "【写真】マウンドの投手",
      "　【写真あり】ベンチの様子",
      "【動画】ホームランシーン",
      "【セ・リーグ順位表】最新順位",
      "【一覧】戦力外通告一覧",
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

  it("normalizeNewlines", () => {
    const input = "段落1\n\n\n\n段落2\n\n\n段落3";
    expect(normalizeNewlines(input)).toBe("段落1\n\n段落2\n\n段落3");
  });

  it("getNewsArticle", async () => {
    const url =
      "https://news.yahoo.co.jp/articles/2a13733c39a2af81966054ed474719f853b7f5dc?page=1";
    const body = await getNewsArticleNormal(url);
    expect(body).toContain(
      "☆阪神―ヤクルト（１８：００・甲子園）阪神＝高橋、ヤクルト＝奥川\n\n　２９日の阪神・ヤクルト戦は雨天により中止。",
    );
    expect(body.includes("【動画】")).toBe(false);
  });

  it("getNewsArticleExpert", async () => {
    const url =
      "https://news.yahoo.co.jp/expert/articles/f0807da4ad35579487ad28d5e6f6e7a877e1775c?page=1";
    const body = await getNewsArticleExpert(url);
    const content = splitContentIntoChunks(body, 2000);
    expect(content.length).toBeGreaterThan(0);
  });

  it("filterNews", () => {
    const testLogger = new Logger({ appName: "test" });
    const news1 = {
      title: "タイトルに hanshin を含まない",
      credit: "Yahoo!ニュース",
      url: "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
    };
    expect(filterNews([news1], testLogger)).toEqual([]);

    const news2 = {
      title: "タイトルに 阪神 を含む",
      credit: "Yahoo!ニュース",
      url: "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
    };
    expect(filterNews([news2], testLogger)).toEqual([news2]);

    const news3 = {
      title: "タイトルに 阪神 と 虎になれ を含む",
      credit: "Yahoo!ニュース",
      url: "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
    };
    expect(filterNews([news3], testLogger)).toEqual([]);
  });

  it("KV registration and filtering", async () => {
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const testLogger = new Logger({ appName: "test" });
    const uniqueUrl = `https://example.com/test-article-${Date.now()}`;
    const testItem: NewsItem = {
      title: "阪神テスト記事",
      credit: "テスト",
      url: uniqueUrl,
    };

    const unregistered = await filterUnregisteredNewsItems([testItem], mockKv);
    expect(unregistered.length).toBe(1);
    expect(unregistered[0].url).toBe(uniqueUrl);

    const isRegisteredFirst = await registerNewsItem(testItem, mockKv, testLogger);
    expect(isRegisteredFirst).toBe(false);

    const isRegisteredSecond = await registerNewsItem(testItem, mockKv, testLogger);
    expect(isRegisteredSecond).toBe(true);

    const unregisteredAfter = await filterUnregisteredNewsItems([testItem], mockKv);
    expect(unregisteredAfter.length).toBe(0);
  });

  it("handles multiple items in filterUnregisteredNewsItems", async () => {
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `阪神テスト記事${i}`,
      credit: "テスト",
      url: `https://example.com/test-article-${i}`,
    }));

    const unregistered = await filterUnregisteredNewsItems(items, mockKv);
    expect(unregistered.length).toBe(15);
  });

  it("handles fetch healthcheck request", async () => {
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const env: Env = {
      SPORTSNAVI_KV: mockKv,
    };
    const req = new Request("https://sportsnavi.gunjobiyori.com/");
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("SportsNavi News Fetcher is running");
  });

  it("handles non-200 response from duplicate check API gracefully with descriptive error", async () => {
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const mockEchoBreaker = {
      fetch: vi.fn(async () => {
        return new Response("error code: 1042\n", { status: 403 });
      }),
    } as unknown as Fetcher;

    const env: Env = {
      SPORTSNAVI_KV: mockKv,
      ECHO_BREAKER: mockEchoBreaker,
      WEBHOOK_URL: "https://discord.com/api/webhooks/dummy/dummy",
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response("<h1>記事タイトル</h1><p>記事本文</p>", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const testItem: NewsItem = {
        title: "阪神テスト記事",
        credit: "テスト",
        url: "https://news.yahoo.co.jp/articles/sample1",
      };

      await expect(
        worker &&
          import("./main").then((m) =>
            m.notifyDiscordWithNewsItem(testItem, env, new Logger({ appName: "test" })),
          ),
      ).rejects.toThrow(/Duplicate check API returned status 403: error code: 1042/);
      expect(mockEchoBreaker.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parseNewsListWithHTMLRewriter parses timeline items correctly", async () => {
    const html = `
      <ul class="cm-timeLine">
        <li class="cm-timeLine__item">
          <a class="cm-timeLine__itemArticleLink" href="https://news.yahoo.co.jp/articles/sample_a">
            <p class="cm-timeLine__itemTitle">阪神タイガースが勝利</p>
            <small class="cm-timeLine__itemCredit">デイリースポーツ</small>
          </a>
        </li>
        <li class="cm-timeLine__item">
          <a class="cm-timeLine__itemArticleLink" href="https://news.yahoo.co.jp/articles/sample_b">
            <p class="cm-timeLine__itemTitle">読売ジャイアンツ敗戦</p>
            <small class="cm-timeLine__itemCredit">スポーツ報知</small>
          </a>
        </li>
      </ul>
    `;
    const response = new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
    const { parseNewsListWithHTMLRewriter } = await import("./main");
    const items = await parseNewsListWithHTMLRewriter(response);
    expect(items).toEqual([
      {
        title: "阪神タイガースが勝利",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/articles/sample_a",
      },
      {
        title: "読売ジャイアンツ敗戦",
        credit: "スポーツ報知",
        url: "https://news.yahoo.co.jp/articles/sample_b",
      },
    ]);
  });

  it("extractArticleContentWithHTMLRewriter detects next page correctly", async () => {
    const { extractArticleContentWithHTMLRewriter } = await import("./main");

    const htmlWithNext = `
      <article id="uamods">
        <header><h1>テスト記事タイトル</h1></header>
        <div><div>
          <p>第1段落です。<br>改行後の文章。</p>
          <p>【写真】選手の写真</p>
          <p>第2段落です。</p>
        </div></div>
        <a href="/articles/art123?page=2">2</a>
        <a href="https://external.example.com/other?page=2">他記事</a>
      </article>
    `;
    const res1 = new Response(htmlWithNext);
    const parsed1 = await extractArticleContentWithHTMLRewriter(
      res1,
      1,
      "https://news.yahoo.co.jp/articles/art123",
    );
    expect(parsed1.title).toBe("テスト記事タイトル");
    expect(parsed1.body).toContain("第1段落です。\n改行後の文章。");
    expect(parsed1.body).toContain("第2段落です。");
    expect(parsed1.body.includes("【写真】")).toBe(false);
    expect(parsed1.hasNextPage).toBe(true);

    const htmlWithoutNext = `
      <article id="uamods">
        <header><h1>単一ページ記事</h1></header>
        <div><div>
          <p>本文です。</p>
        </div></div>
        <a href="https://external.example.com/other?page=2">無関係なリンク</a>
      </article>
    `;
    const res2 = new Response(htmlWithoutNext);
    const parsed2 = await extractArticleContentWithHTMLRewriter(
      res2,
      1,
      "https://news.yahoo.co.jp/articles/art999",
    );
    expect(parsed2.title).toBe("単一ページ記事");
    expect(parsed2.body).toBe("本文です。");
    expect(parsed2.hasNextPage).toBe(false);
  });

  it("notifyDiscordWithNewsItem exits early on IGNORE_KEYWORDS without duplicate check or webhook call", async () => {
    const { notifyDiscordWithNewsItem } = await import("./main");
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const mockEchoBreaker = {
      fetch: vi.fn(),
    } as unknown as Fetcher;

    const env: Env = {
      SPORTSNAVI_KV: mockKv,
      ECHO_BREAKER: mockEchoBreaker,
      WEBHOOK_URL: "https://discord.com/api/webhooks/dummy/dummy",
    };

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => {
      return new Response(
        "<article id='uamods'><header><h1>阪神テスト記事</h1></header><div><div><p>川藤氏が語る。</p></div></div></article>",
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const testItem: NewsItem = {
        title: "阪神テスト記事",
        credit: "テスト",
        url: "https://news.yahoo.co.jp/articles/sample_keyword",
      };

      await notifyDiscordWithNewsItem(testItem, env, new Logger({ appName: "test" }));

      // echo-breaker should NOT be called because川藤 is in IGNORE_KEYWORDS
      expect(mockEchoBreaker.fetch).not.toHaveBeenCalled();
      // fetch was only called once for page 1
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("notifyDiscordWithNewsItem exits early on duplicate article without fetching page 2", async () => {
    const { notifyDiscordWithNewsItem } = await import("./main");
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const mockEchoBreaker = {
      fetch: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            is_duplicate: true,
            similarity_score: 0.95,
            message: "duplicate",
            debug_info: { most_similar_article: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    } as unknown as Fetcher;

    const env: Env = {
      SPORTSNAVI_KV: mockKv,
      ECHO_BREAKER: mockEchoBreaker,
      WEBHOOK_URL: "https://discord.com/api/webhooks/dummy/dummy",
    };

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => {
      return new Response(
        "<article id='uamods'><header><h1>阪神テスト記事</h1></header><div><div><p>本文です。</p></div></div><a href='/articles/sample_dup?page=2'>2</a></article>",
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const testItem: NewsItem = {
        title: "阪神テスト記事",
        credit: "テスト",
        url: "https://news.yahoo.co.jp/articles/sample_dup",
      };

      await notifyDiscordWithNewsItem(testItem, env, new Logger({ appName: "test" }));

      // echo-breaker was called once
      expect(mockEchoBreaker.fetch).toHaveBeenCalledTimes(1);
      // fetch was called only once for page 1, page 2 was not fetched!
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("notifyDiscord only waits for vector DB propagation when an article is actually notified", async () => {
    vi.useFakeTimers();
    try {
      const { notifyDiscord } = await import("./main");
      const mockKv = new MockKVNamespace() as unknown as KVNamespace;
      const env: Env = {
        SPORTSNAVI_KV: mockKv,
        WEBHOOK_URL: "https://discord.com/api/webhooks/dummy/dummy",
        NOTIFY_INTERVAL_MS: "90000",
      };

      const originalFetch = globalThis.fetch;
      // 1件目は除外キーワード（川藤）でスキップ、2件目は正常通知
      const fetchMock = vi.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("sample_skip")) {
          return new Response(
            "<article id='uamods'><header><h1>除外記事</h1></header><div><div><p>川藤の解説</p></div></div></article>",
            { status: 200 },
          );
        }
        if (urlStr.includes("sample_ok")) {
          return new Response(
            "<article id='uamods'><header><h1>正常記事</h1></header><div><div><p>佐藤輝明のホームラン</p></div></div></article>",
            { status: 200 },
          );
        }
        if (urlStr.includes("echo-breaker")) {
          return new Response(
            JSON.stringify({
              is_duplicate: false,
              similarity_score: 0.1,
              message: "ok",
              debug_info: { most_similar_article: null },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Discord Webhook
        return new Response("ok", { status: 200 });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const items: NewsItem[] = [
          {
            title: "除外記事",
            credit: "テスト",
            url: "https://news.yahoo.co.jp/articles/sample_skip",
          },
          {
            title: "正常記事",
            credit: "テスト",
            url: "https://news.yahoo.co.jp/articles/sample_ok",
          },
        ];

        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

        const notifyPromise = notifyDiscord(items, env, new Logger({ appName: "test" }));
        await vi.runAllTimersAsync();
        await notifyPromise;

        // 1件目はスキップされたため90秒待機は呼ばれず、2件目は最終記事なので後続記事がなく90秒待機は呼ばれない
        expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 90000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifyDiscord waits for vector DB propagation between multiple notified articles", async () => {
    vi.useFakeTimers();
    try {
      const { notifyDiscord } = await import("./main");
      const mockKv = new MockKVNamespace() as unknown as KVNamespace;
      const env: Env = {
        SPORTSNAVI_KV: mockKv,
        WEBHOOK_URL: "https://discord.com/api/webhooks/dummy/dummy",
        NOTIFY_INTERVAL_MS: "90000",
      };

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("echo-breaker")) {
          return new Response(
            JSON.stringify({
              is_duplicate: false,
              similarity_score: 0.1,
              message: "ok",
              debug_info: { most_similar_article: null },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlStr.includes("sample_ok")) {
          return new Response(
            "<article id='uamods'><header><h1>正常記事</h1></header><div><div><p>本文です</p></div></div></article>",
            { status: 200 },
          );
        }
        return new Response("ok", { status: 200 });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const items: NewsItem[] = [
          {
            title: "正常記事1",
            credit: "テスト",
            url: "https://news.yahoo.co.jp/articles/sample_ok1",
          },
          {
            title: "正常記事2",
            credit: "テスト",
            url: "https://news.yahoo.co.jp/articles/sample_ok2",
          },
        ];

        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

        const notifyPromise = notifyDiscord(items, env, new Logger({ appName: "test" }));
        await vi.runAllTimersAsync();
        await notifyPromise;

        // 1件目の通知後、2件目を処理する前にベクターDB反映待ちとして 90000ms が呼ばれる
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 90000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetchWithRetry retries on 403 status and succeeds when next attempt is 200", async () => {
    vi.useFakeTimers();
    try {
      const { fetchWithRetry } = await import("./main");
      const originalFetch = globalThis.fetch;
      let callCount = 0;
      globalThis.fetch = vi.fn(async (_url: any, options: any) => {
        callCount++;
        // Verify User-Agent header is set
        expect(options.headers["User-Agent"]).toContain("Mozilla/5.0");
        if (callCount === 1) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch;

      try {
        const fetchPromise = fetchWithRetry(
          "https://example.com/test",
          {},
          2,
          100,
          new Logger({ appName: "test" }),
        );
        await vi.runAllTimersAsync();
        const res = await fetchPromise;
        expect(res.status).toBe(200);
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetchNewsListPage returns empty array gracefully when API returns 403", async () => {
    vi.useFakeTimers();
    try {
      const { fetchNewsListPage } = await import("./main");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => {
        return new Response("Forbidden", { status: 403 });
      }) as unknown as typeof fetch;

      try {
        const promise = fetchNewsListPage(new Logger({ appName: "test" }));
        await vi.runAllTimersAsync();
        const items = await promise;
        expect(items).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      vi.useRealTimers();
    }
  });
});



