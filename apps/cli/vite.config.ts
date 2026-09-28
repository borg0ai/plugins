import { defineConfig } from "vitest/config";

// The CLI ships as a single bundled ESM file targeting Node.js 18+, built through
// Vite's SSR pipeline so the build and the test runner share one toolchain.
export default defineConfig({
  build: {
    ssr: "index.ts",
    target: "node18",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "esm",
        entryFileNames: "index.js",
        banner: "#!/usr/bin/env node",
      },
    },
  },
  ssr: {
    target: "node",
    // The CLI has zero runtime dependencies; keep everything in the single bundle.
    noExternal: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: true,
  },
});
