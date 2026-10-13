import { describe, it, expect } from "vitest";
import {
  evaluateNewsMetadata,
  filterNewsList,
  containsIgnoredKeywords,
} from "./filters.js";
import type { NewsItem } from "./types.js";

describe("filters module", () => {
  describe("evaluateNewsMetadata", () => {
    it("rejects expert author articles", () => {
      const item: NewsItem = {
        title: "阪神タイガースの分析",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/expert/articles/12345",
      };
      const result = evaluateNewsMetadata(item);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("expert_author");
    });

    it("rejects articles without included titles", () => {
      const item: NewsItem = {
        title: "読売ジャイアンツの話題",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/articles/12345",
      };
      const result = evaluateNewsMetadata(item);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("title_not_included");
    });

    it("rejects articles matching ignored titles", () => {
      const item: NewsItem = {
        title: "阪神大学野球の試合結果",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/articles/12345",
      };
      const result = evaluateNewsMetadata(item);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("ignored_title");
    });

    it("rejects articles from ignored credits", () => {
      const item: NewsItem = {
        title: "阪神タイガースの快進撃",
        credit: "東スポWEB",
        url: "https://news.yahoo.co.jp/articles/12345",
      };
      const result = evaluateNewsMetadata(item);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("ignored_credit");
    });

    it("accepts valid Hanshin articles", () => {
      const item: NewsItem = {
        title: "阪神タイガースが劇的勝利",
        credit: "デイリースポーツ",
        url: "https://news.yahoo.co.jp/articles/12345",
      };
      const result = evaluateNewsMetadata(item);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("filterNewsList", () => {
    it("filters list accurately", () => {
      const items: NewsItem[] = [
        {
          title: "阪神佐藤がホームラン",
          credit: "デイリースポーツ",
          url: "https://example.com/1",
        },
        {
          title: "巨人菅野の投球",
          credit: "デイリースポーツ",
          url: "https://example.com/2",
        },
      ];
      const filtered = filterNewsList(items);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("阪神佐藤がホームラン");
    });
  });

  describe("containsIgnoredKeywords", () => {
    it("detects blacklisted keywords", () => {
      expect(containsIgnoredKeywords("川藤氏の解説")).toBe(true);
      expect(containsIgnoredKeywords("ファン「最高の試合」")).toBe(true);
      expect(containsIgnoredKeywords("通常の試合速報です")).toBe(false);
    });
  });
});
