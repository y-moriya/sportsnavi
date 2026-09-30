import {
  filterNews,
  filterPhotoLines,
  filterUnregisteredNewsItems,
  getNewsArticleExpert,
  getNewsArticleNormal,
  normalizeNewlines,
  registerNewsItem,
  splitContentIntoChunks,
} from "./main.ts";
import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";

// test for filterPhotoLines
Deno.test("filterPhotoLines removes lines starting with 【...】", () => {
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

  assertEquals(filterPhotoLines(text), expected);
});

// test for normalizeNewlines
Deno.test("normalizeNewlines", () => {
  const input = "段落1\n\n\n\n段落2\n\n\n段落3";
  assertEquals(normalizeNewlines(input), "段落1\n\n段落2\n\n段落3");
});

// test for getNewsArticle
Deno.test("getNewsArticle", async () => {
  const url =
    "https://news.yahoo.co.jp/articles/2a13733c39a2af81966054ed474719f853b7f5dc?page=1";
  const body = await getNewsArticleNormal(url);
  assertStringIncludes(
    body,
    "☆阪神―ヤクルト（１８：００・甲子園）阪神＝高橋、ヤクルト＝奥川\n\n　２９日の阪神・ヤクルト戦は雨天により中止。",
  );
  assertFalse(body.includes("【動画】"));
});

// test for getNewsArticleExpert
Deno.test("getNewsArticleExpert", async () => {
  const url =
    "https://news.yahoo.co.jp/expert/articles/f0807da4ad35579487ad28d5e6f6e7a877e1775c?page=1";

  const body = await getNewsArticleExpert(url);
  const content = splitContentIntoChunks(body, 2000);
  for (const chunk of content) {
    console.log(chunk.length);
  }
});

// test for filterNews
Deno.test("filterNews", () => {
  const news1 = {
    title: "タイトルに hanshin を含まない",
    credit: "Yahoo!ニュース",
    url:
      "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
  };

  const filteredNews1 = filterNews([news1]);
  assertEquals(filteredNews1, []);

  const news2 = {
    title: "タイトルに 阪神 を含む",
    credit: "Yahoo!ニュース",
    url:
      "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
  };

  const filteredNews2 = filterNews([news2]);
  assertEquals(filteredNews2, [news2]);

  const news3 = {
    title: "タイトルに 阪神 と 虎になれ を含む",
    credit: "Yahoo!ニュース",
    url:
      "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
  };

  const filteredNews3 = filterNews([news3]);
  assertEquals(filteredNews3, []);
});

// test for KV registration
Deno.test("KV registration and filtering", async () => {
  const newsItem = {
    title: "阪神テスト記事",
    credit: "テスト",
    url: "https://example.com/test-article",
  };

  // Clear before test if possible, but since it's a temp KV for testing, it's fine
  // Actually, let's use a unique URL to avoid interference
  const uniqueUrl = `https://example.com/test-article-${Date.now()}`;
  const testItem = { ...newsItem, url: uniqueUrl };

  // Should not be registered initially
  const unregistered = await filterUnregisteredNewsItems([testItem]);
  assertEquals(unregistered.length, 1);
  assertEquals(unregistered[0].url, uniqueUrl);

  // Register it
  const isRegisteredFirst = await registerNewsItem(testItem);
  assertEquals(isRegisteredFirst, false); // Returns false when newly registered

  // Should be registered now
  const isRegisteredSecond = await registerNewsItem(testItem);
  assertEquals(isRegisteredSecond, true); // Returns true when already registered

  // Should be filtered out now
  const unregisteredAfter = await filterUnregisteredNewsItems([testItem]);
  assertEquals(unregisteredAfter.length, 0);
});

// Reproduction of Deno KV getMany limit (max 10)
Deno.test("KV getMany limit", async () => {
  const items = Array.from({ length: 11 }, (_, i) => ({
    title: `阪神テスト記事${i}`,
    credit: "テスト",
    url: `https://example.com/test-article-${i}`,
  }));

  // This should fail before the fix
  await filterUnregisteredNewsItems(items);
});
