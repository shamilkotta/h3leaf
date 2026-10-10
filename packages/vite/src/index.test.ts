import { afterEach, describe, expect, it } from "vitest";
import { createBuilder } from "vite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { h3leaf } from "./index.js";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("h3leaf Vite plugin", () => {
  it("emits a bundled Worker during vite build", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".h3leaf-vite-"));
    fixtures.push(root);
    await writeFile(path.join(root, "index.html"), '<div id="app">hello</div>');
    await writeFile(path.join(root, "api.ts"), 'export const GET = () => ({ source: "vite" });');

    const builder = await createBuilder({
      root,
      logLevel: "silent",
      plugins: [h3leaf({ routesDir: ".", outFile: "worker.mjs", sourcemap: false })],
    });
    await builder.buildApp();

    const worker = await import(`${path.join(root, "dist/worker.mjs")}?${Date.now()}`);
    const response = await worker.default.fetch(new Request("https://h3leaf.test/api"));
    expect(await response.json()).toEqual({ source: "vite" });
  });
});
