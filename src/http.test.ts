import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchWithRetry,
  isTransientNetworkError,
  isRetryableStatusCode,
} from "./http.js";

describe("http utility", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("isTransientNetworkError", () => {
    it("identifies TypeError fetch failed as transient", () => {
      expect(isTransientNetworkError(new TypeError("fetch failed"))).toBe(true);
    });

    it("identifies TimeoutError and AbortError as transient", () => {
      const timeoutErr = new Error("timeout");
      timeoutErr.name = "TimeoutError";
      expect(isTransientNetworkError(timeoutErr)).toBe(true);

      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      expect(isTransientNetworkError(abortErr)).toBe(true);
    });

    it("identifies socket errors as transient", () => {
      const err = new Error("connect error");
      (err as any).code = "EHOSTUNREACH";
      expect(isTransientNetworkError(err)).toBe(true);
    });

    it("returns false for non-network errors", () => {
      expect(isTransientNetworkError(new Error("Generic business error"))).toBe(
        false,
      );
      expect(isTransientNetworkError(null)).toBe(false);
    });
  });

  describe("isRetryableStatusCode", () => {
    it("returns true for 429 and 5xx", () => {
      expect(isRetryableStatusCode(429)).toBe(true);
      expect(isRetryableStatusCode(500)).toBe(true);
      expect(isRetryableStatusCode(502)).toBe(true);
      expect(isRetryableStatusCode(503)).toBe(true);
      expect(isRetryableStatusCode(504)).toBe(true);
    });

    it("returns false for 200, 400, 401, 403, 404", () => {
      expect(isRetryableStatusCode(200)).toBe(false);
      expect(isRetryableStatusCode(400)).toBe(false);
      expect(isRetryableStatusCode(401)).toBe(false);
      expect(isRetryableStatusCode(403)).toBe(false);
      expect(isRetryableStatusCode(404)).toBe(false);
    });
  });

  describe("fetchWithRetry", () => {
    it("succeeds on first attempt without retrying", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const res = await fetchWithRetry("https://example.com");
      expect(callCount).toBe(1);
      expect(res.status).toBe(200);
    });

    it("retries on 503 and returns ok on second attempt", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const res = await fetchWithRetry("https://example.com", undefined, {
        retries: 3,
        baseDelayMs: 5,
      });

      expect(callCount).toBe(2);
      expect(res.status).toBe(200);
    });

    it("does not retry 404 and returns response immediately", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      const res = await fetchWithRetry("https://example.com", undefined, {
        retries: 3,
        baseDelayMs: 5,
      });

      expect(callCount).toBe(1);
      expect(res.status).toBe(404);
    });

    it("throws if all retries are exhausted", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;

      await expect(
        fetchWithRetry("https://example.com", undefined, {
          retries: 3,
          baseDelayMs: 5,
        }),
      ).rejects.toThrow("fetch failed");

      expect(callCount).toBe(3);
    });
  });
});
