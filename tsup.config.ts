import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
});
