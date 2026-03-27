import { splitContentIntoChunks } from "./main.ts";
import {
  filterNews,
  getNewsArticleExpert,
  getNewsArticleNormal,
  registerNewsItem,
  filterUnregisteredNewsItems,
} from "./main.ts";
import { assertEquals } from "@std/assert";

// test for getNewsArticle
Deno.test("getNewsArticle", async () => {
  const url =
    "https://news.yahoo.co.jp/articles/9a418c146b413da37d97806e506af0f5fa3d5b2d";
  await getNewsArticleNormal(url);
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
