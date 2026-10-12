import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/setupTests.ts"],
    env: {
      AXIOM_TOKEN: "",
      AXIOM_DATASET: "test-dataset",
      NODE_ENV: "test",
    },
  },
});
