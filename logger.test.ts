// logger.test.ts
import { Logger } from "./logger.ts";
import { assertEquals } from "@std/assert";

Deno.test("Logger formats console and enqueues events without throwing when no token", async () => {
  const logger = new Logger("test-app");
  logger.info("Test info message", { key: "value" });
  logger.warn("Test warn message");
  logger.error("Test error message", new Error("Sample error"));
  await logger.flush();
});

Deno.test("Logger sends payload to Axiom when token is present", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: HeadersInit | undefined;
  let requestedBody = "";

  // Mock fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedHeaders = init?.headers;
    requestedBody = String(init?.body);
    return new Response(JSON.stringify({ ingested: 1 }), { status: 200 });
  };

  try {
    Deno.env.set("AXIOM_TOKEN", "test-token");
    Deno.env.set("AXIOM_DATASET", "personal-apps");

    const logger = new Logger("test-app");
    logger.info("Hello Axiom", { count: 42 });
    await logger.flush();

    assertEquals(
      requestedUrl,
      "https://api.axiom.co/v1/datasets/personal-apps/ingest",
    );
    const parsedBody = JSON.parse(requestedBody);
    assertEquals(parsedBody.length, 1);
    assertEquals(parsedBody[0].app, "test-app");
    assertEquals(parsedBody[0].level, "info");
    assertEquals(parsedBody[0].message, "Hello Axiom");
    assertEquals(parsedBody[0].data, { count: 42 });
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("AXIOM_TOKEN");
  }
});
