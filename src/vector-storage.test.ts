import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  VectorStorage,
  cosineSimilarity,
  type StoredArticle,
} from "./vector-storage.js";

describe("VectorStorage", () => {
  let tmpDir: string;
  let dbPath: string;
  let storage: VectorStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-test-"));
    dbPath = path.join(tmpDir, "vectors.db");
    storage = new VectorStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("cosineSimilarity", () => {
    it("computes similarity correctly", () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe("SQLite persistence and vector search", () => {
    it("saves and finds most similar article", () => {
      const article: StoredArticle = {
        id: "art-1",
        url: "https://example.com/1",
        title: "阪神タイガースの勝利",
        media_name: "デイリースポーツ",
        vector: [0.99, 0.05, 0],
        timestamp: Date.now(),
      };

      storage.saveArticle(article);

      const match = storage.findMostSimilar([1, 0, 0], 0.8);
      expect(match).not.toBeNull();
      expect(match!.article.id).toBe("art-1");
      expect(match!.score).toBeGreaterThan(0.95);
    });

    it("returns null when similarity is below threshold", () => {
      const article: StoredArticle = {
        id: "art-2",
        url: "https://example.com/2",
        title: "別チームの話題",
        media_name: "デイリースポーツ",
        vector: [0, 1, 0],
        timestamp: Date.now(),
      };

      storage.saveArticle(article);

      const match = storage.findMostSimilar([1, 0, 0], 0.8);
      expect(match).toBeNull();
    });

    it("cleans up expired articles", () => {
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
      storage.saveArticle({
        id: "old-1",
        url: "https://example.com/old",
        title: "古い記事",
        media_name: "デイリースポーツ",
        vector: [1, 0, 0],
        timestamp: oldTime,
      });

      storage.saveArticle({
        id: "new-1",
        url: "https://example.com/new",
        title: "新しい記事",
        media_name: "デイリースポーツ",
        vector: [1, 0, 0],
        timestamp: Date.now(),
      });

      const deletedCount = storage.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(deletedCount).toBe(1);

      const remaining = storage.getRecentArticles();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("new-1");
    });
  });
});
