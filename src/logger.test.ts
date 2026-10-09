import { describe, it, expect, vi, afterEach } from "vitest";
import { Logger } from "./logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats console and enqueues events without throwing when no token", async () => {
    const logger = new Logger({ appName: "test-app" });
    logger.info("Test info message", { key: "value" });
    logger.warn("Test warn message");
    logger.error("Test error message", new Error("Sample error"));
    await logger.flush();
  });

  it("sends payload to Axiom when token is present", async () => {
    let requestedUrl = "";
    let requestedHeaders: HeadersInit | undefined;
    let requestedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers;
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({ ingested: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const logger = new Logger({
        appName: "test-app",
        token: "test-token",
        dataset: "personal-apps",
      });

      logger.info("Hello Axiom", { count: 42 });
      await logger.flush();

      expect(requestedUrl).toBe(
        "https://api.axiom.co/v1/datasets/personal-apps/ingest",
      );
      const parsedBody = JSON.parse(requestedBody);
      expect(parsedBody.length).toBe(1);
      expect(parsedBody[0].app).toBe("test-app");
      expect(parsedBody[0].level).toBe("info");
      expect(parsedBody[0].message).toBe("Hello Axiom");
      expect(parsedBody[0].data).toEqual({ count: 42 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
