import { describe, it, expect, vi, afterEach } from "vitest";
import { Logger } from "./logger.js";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats console and does not call fetch when no token is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logger = new Logger({ appName: "test-app" });
    logger.info("Test info message", { key: "value" });
    logger.warn("Test warn message");
    logger.error("Test error message", new Error("Sample error"));
    await logger.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not load process.env.AXIOM_TOKEN in test environment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const originalToken = process.env.AXIOM_TOKEN;
    try {
      process.env.AXIOM_TOKEN = "accidental-real-token";
      const logger = new Logger({ appName: "test-app" });
      logger.error("Sample error message", new Error("Sample error"));
      await logger.flush();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.AXIOM_TOKEN = originalToken;
    }
  });

  it("sends payload to mocked Axiom endpoint when token is explicitly provided", async () => {
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
