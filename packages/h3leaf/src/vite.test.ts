import { afterEach, describe, expect, it } from "vitest";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { h3leaf, type H3LeafPluginOptions } from "./vite.js";
import { fixture } from "./test/fixtures.js";

const servers: ViteDevServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const buildWorker = async (root: string, options: H3LeafPluginOptions) => {
  const builder = await createBuilder({
    root,
    logLevel: "silent",
    plugins: [h3leaf({ outFile: "worker.mjs", sourcemap: false, ...options })],
  });
  await builder.buildApp();
  return (await import(`${pathToFileURL(path.join(root, "dist/worker.mjs")).href}?${Date.now()}`))
    .default;
};

const startServer = async (root: string, options: H3LeafPluginOptions) => {
  const server = await createServer({
    root,
    logLevel: "silent",
    server: { port: 0 },
    plugins: [h3leaf(options)],
  });
  servers.push(server);
  await server.listen();
  return (pathname: string, init?: RequestInit) =>
    fetch(new URL(pathname, server.resolvedUrls?.local[0]), init);
};

describe("h3leaf Vite plugin", () => {
  it("emits a bundled Worker and route types during vite build", async () => {
    const root = await fixture(
      {
        "index.html": '<div id="app">hello</div>',
        "api.ts": 'export const GET = () => ({ source: "vite" });',
      },
      "vite"
    );
    const worker = await buildWorker(root, { routesDir: "." });
    const response = await worker.fetch(new Request("https://h3leaf.test/api"));
    expect(await response.json()).toEqual({ source: "vite" });
    expect(await readFile(path.join(root, ".h3leaf/routes.d.ts"), "utf8")).toContain('"/api"');
  });

  it("exposes Cloudflare env and waitUntil to handlers", async () => {
    const root = await fixture(
      {
        "index.html": "<div></div>",
        "api/env.ts": `import type { H3Event } from "h3";
export const GET = (event: H3Event) => {
  event.waitUntil(Promise.resolve("done"));
  return { name: event.runtime?.cloudflare?.env.NAME };
};`,
      },
      "vite"
    );
    const worker = await buildWorker(root, { types: false });
    const pending: Promise<unknown>[] = [];
    const response = await worker.fetch(
      new Request("https://h3leaf.test/env"),
      { NAME: "leaf" },
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }
    );
    expect(await response.json()).toEqual({ name: "leaf" });
    expect(await Promise.all(pending)).toEqual(["done"]);
  });

  it("serves the API under a base in dev, including routes added after startup", async () => {
    const root = await fixture(
      {
        "index.html": "<div></div>",
        "api/hello.ts": `import type { H3Event } from "h3";
export const GET = (event: H3Event) => {
  event.res.headers.append("set-cookie", "a=1");
  event.res.headers.append("set-cookie", "b=2");
  return { q: event.url.searchParams.get("q") };
};`,
      },
      "vite"
    );
    const request = await startServer(root, { base: "/api" });

    const hello = await request("/api/hello?q=1");
    expect(await hello.json()).toEqual({ q: "1" });
    expect(hello.headers.getSetCookie()).toEqual(["a=1", "b=2"]);

    await writeFile(path.join(root, "api/added.ts"), "export const GET = () => 'added';");
    await expect
      .poll(async () => (await request("/api/added")).status, { timeout: 5000 })
      .toBe(200);
  });

  it("serves matching routes without a base and leaves other paths to Vite", async () => {
    const root = await fixture(
      {
        "index.html": "<p>frontend</p>",
        "api/users/[id].ts": `export const GET = () => ({ version: 1 });`,
      },
      "vite"
    );
    const request = await startServer(root, {});

    expect(await (await request("/users/1")).json()).toEqual({ version: 1 });
    expect(await (await request("/")).text()).toContain("frontend");

    await writeFile(
      path.join(root, "api/users/[id].ts"),
      `export const GET = () => ({ version: 2 });`
    );
    await expect
      .poll(async () => (await (await request("/users/1")).json()).version, { timeout: 5000 })
      .toBe(2);
    expect(await readFile(path.join(root, ".h3leaf/routes.d.ts"), "utf8")).toContain(
      '"/users/:id"'
    );
  });
});
