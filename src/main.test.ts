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
});
