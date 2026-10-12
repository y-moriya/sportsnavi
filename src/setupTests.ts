import { HTMLRewriter } from "@miniflare/html-rewriter";

// Provide global HTMLRewriter for Vitest node environment
if (typeof (globalThis as any).HTMLRewriter === "undefined") {
  (globalThis as any).HTMLRewriter = HTMLRewriter;
}
