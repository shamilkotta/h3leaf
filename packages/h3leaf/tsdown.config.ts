import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts", "src/vite.ts"],
  outDir: "dist",
  format: "esm",
  target: "esnext",
  sourcemap: false,
  clean: true,
  dts: true,
});
