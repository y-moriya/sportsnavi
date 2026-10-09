import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      AXIOM_TOKEN: "",
      AXIOM_DATASET: "test-dataset",
      NODE_ENV: "test",
    },
  },
});
