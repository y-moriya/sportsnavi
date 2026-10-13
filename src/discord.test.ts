import { describe, it, expect, vi } from "vitest";
import { splitContentIntoChunks, sendDiscordMessage } from "./discord.js";
import type { NewsItem } from "./types.js";

describe("discord module", () => {
  describe("splitContentIntoChunks", () => {
    it("splits long content into chunks under limit", () => {
      const line = "A".repeat(800);
      const longText = `${line}\n${line}\n${line}`;
      const chunks = splitContentIntoChunks(longText, 1000);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      }
    });

    it("handles short text as a single chunk", () => {
      const text = "短いテキストです。";
      const chunks = splitContentIntoChunks(text, 2000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].trim()).toBe(text);
    });
  });

  describe("sendDiscordMessage", () => {
    it("posts payload to webhook", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let sentBody = "";

      globalThis.fetch = vi.fn(async (url: any, init: any) => {
        requestedUrl = String(url);
        sentBody = init?.body ? String(init.body) : "";
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      try {
        const item: NewsItem = {
          title: "阪神タイガース",
          credit: "デイリースポーツ",
          url: "https://example.com",
        };
        await sendDiscordMessage("https://discord.com/webhook/test", "hello world", item);

        expect(requestedUrl).toBe("https://discord.com/webhook/test");
        const parsed = JSON.parse(sentBody);
        expect(parsed.content).toBe("hello world");
        expect(parsed.username).toBe("デイリースポーツ");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws error on non-ok status", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => {
        return new Response("bad request", { status: 400, statusText: "Bad Request" });
      }) as unknown as typeof fetch;

      try {
        const item: NewsItem = {
          title: "阪神タイガース",
          credit: "デイリースポーツ",
          url: "https://example.com",
        };
        await expect(
          sendDiscordMessage("https://discord.com/webhook/test", "hello", item),
        ).rejects.toThrow("Failed to send Discord notification: HTTP 400");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
