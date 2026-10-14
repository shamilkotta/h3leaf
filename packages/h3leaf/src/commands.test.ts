import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildWorker,
  parseCliArgs,
  startDevServer,
  UsageError,
  writeRouteTypes,
} from "./commands.js";
import { fixture } from "./test/fixtures.js";

const silent = { log: () => undefined, error: () => undefined };

const appFixture = () =>
  fixture(
    {
      "api/_leaf.ts": `import { H3 } from "h3";
export const app = new H3();
export const scheduled = (controller: { cron: string }) => controller.cron;`,
      "api/_middleware.ts": `export default (event, next) => { event.res.headers.set("x-root", "1"); return next(); };`,
      "api/(admin)/_middleware.ts": `export const middleware = [(event) => { if (!event.req.headers.get("authorization")) return new Response("denied", { status: 401 }); }];`,
      "api/(admin)/stats.ts": `export const GET = () => ({ stats: true });`,
      "api/docs/[[...slug]].ts": `export const GET = (event) => ({ slug: event.context.params?.slug ?? null });`,
      "api/hello.ts": `import { message } from "../lib/message.ts";
export const GET = () => ({ message });`,
      "lib/message.ts": `export const message = "v1";`,
    },
    "commands"
  );

describe("parseCliArgs", () => {
  it("resolves defaults relative to cwd", () => {
    const cwd = path.resolve("/project");
    expect(parseCliArgs(["build"], cwd)).toEqual({
      command: "build",
      routesDirectory: path.join(cwd, "api"),
      outFile: path.join(cwd, "dist/api.mjs"),
      typesFile: path.join(cwd, ".h3leaf/routes.d.ts"),
      target: "workers",
      base: undefined,
      entryFile: undefined,
    });
  });

  it("accepts --flag=value and disabling types", () => {
    const args = parseCliArgs(["dev", "--port=4000", "--types=false", "--target", "node"], "/p");
    expect(args).toMatchObject({
      command: "dev",
      port: 4000,
      typesFile: undefined,
      target: "node",
    });
  });

  it.each([
    [["serve"], "Unknown command"],
    [[], "Unknown command"],
    [["build", "--bogus"], "Unknown option"],
    [["dev", "--port", "abc"], "Invalid port"],
    [["build", "--target", "deno"], "Unknown target"],
    [["types", "--types=false"], "needs a --types path"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it("returns help regardless of command", () => {
    expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
  });
});

describe("buildWorker", () => {
  it("bundles routes with middleware, Worker handlers, and route types", async () => {
    const root = await appFixture();
    const typesFile = path.join(root, ".h3leaf/routes.d.ts");
    const { routes, outFile } = await buildWorker({
      routesDirectory: path.join(root, "api"),
      outFile: path.join(root, "dist/api.mjs"),
      typesFile,
      target: "workers",
    });
    expect(routes.map((route) => route.route)).toEqual(["/docs/**:slug?", "/hello", "/stats"]);

    const worker = (await import(`${pathToFileURL(outFile).href}?${Date.now()}`)).default;
    const get = (url: string, headers?: HeadersInit) =>
      worker.fetch(new Request(`https://h3leaf.test${url}`, { headers }));

    const hello = await get("/hello");
    expect(hello.headers.get("x-root")).toBe("1");
    expect(await hello.json()).toEqual({ message: "v1" });

    expect((await get("/stats")).status).toBe(401);
    expect(await (await get("/stats", { authorization: "x" })).json()).toEqual({ stats: true });

    expect(await (await get("/docs")).json()).toEqual({ slug: null });
    expect(await (await get("/docs/a/b")).json()).toEqual({ slug: "a/b" });

    expect(worker.scheduled({ cron: "* * * * *" })).toBe("* * * * *");
    expect(await readFile(typesFile, "utf8")).toContain('"/docs/**:slug?"');
  });

  it("reports bundling errors", async () => {
    const root = await fixture({ "api/broken.ts": "export const GET = (" }, "commands");
    await expect(
      buildWorker({
        routesDirectory: path.join(root, "api"),
        outFile: path.join(root, "dist/api.mjs"),
        target: "workers",
      })
    ).rejects.toThrow("Unable to bundle worker");
  });
});

describe("writeRouteTypes", () => {
  it("writes the route map without bundling", async () => {
    const root = await appFixture();
    const typesFile = path.join(root, "types/routes.d.ts");
    await writeRouteTypes({
      routesDirectory: path.join(root, "api"),
      typesFile,
      base: "/api",
      target: "workers",
    });
    const types = await readFile(typesFile, "utf8");
    expect(types).toContain('"/api/hello"');
    expect(types).toContain('typeof import("../api/hello.js")');
  });
});

describe("startDevServer", () => {
  it("serves routes and reloads when an imported file outside the routes changes", async () => {
    const root = await appFixture();
    const server = await startDevServer(
      { routesDirectory: path.join(root, "api"), port: 0, target: "node" },
      silent
    );
    try {
      const url = new URL("hello", server.url).href;
      expect(await (await fetch(url)).json()).toEqual({ message: "v1" });

      await writeFile(path.join(root, "lib/message.ts"), `export const message = "v2";`);
      await expect
        .poll(async () => (await (await fetch(url)).json()).message, { timeout: 10_000 })
        .toBe("v2");

      await writeFile(path.join(root, "api/added.ts"), `export const GET = () => "added";`);
      await expect
        .poll(async () => (await fetch(new URL("added", server.url))).status, { timeout: 5000 })
        .toBe(200);
    } finally {
      await server.close();
    }
  }, 20_000);
});
