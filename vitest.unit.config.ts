import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    pool: "forks",
    reporters: "verbose",
    include: ["./tests/**/*.unit.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    testTimeout: 120_000,
    bail: 1,
  },
});
