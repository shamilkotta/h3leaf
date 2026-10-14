import { describe, expect, it } from "vitest";
import ts from "typescript";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  compileEntry,
  discoverRoutes,
  fileToRoute,
  generateEntry,
  generateTypes,
  normalizeBase,
  routeMatcher,
  routePaths,
  writeIfChanged,
} from "./index.js";
import { fixture } from "./test/fixtures.js";

describe("file routes", () => {
  const root = "/project/api";
  it("maps Next-style segments to H3 route patterns", () => {
    expect(fileToRoute(root, "/project/api/users/[id].ts")).toBe("/users/:id");
    expect(fileToRoute(root, "/project/api/docs/[...path].ts")).toBe("/docs/**:path");
    expect(fileToRoute(root, "/project/api/docs/[[...path]].ts")).toBe("/docs/**:path?");
    expect(fileToRoute(root, "/project/api/posts/[[id]].ts")).toBe("/posts/:id?");
    expect(fileToRoute(root, "/project/api/(admin)/index.ts")).toBe("/");
  });

  it("only treats a trailing index segment as the directory root", () => {
    expect(fileToRoute(root, "/project/api/index/stats.ts")).toBe("/index/stats");
    expect(fileToRoute(root, "/project/api/users/index.ts")).toBe("/users");
  });

  it("registers optional catch-alls on the parent path too", () => {
    expect(routePaths("/docs/**:slug?")).toEqual(["/docs", "/docs/**:slug"]);
    expect(routePaths("/**:slug?")).toEqual(["/", "/**:slug"]);
    expect(routePaths("/users/:id")).toEqual(["/users/:id"]);
  });

  it("normalizes base prefixes", () => {
    expect(normalizeBase(undefined)).toBe("");
    expect(normalizeBase("/")).toBe("");
    expect(normalizeBase("api/v1/")).toBe("/api/v1");
  });

  it("matches URLs against registered patterns", () => {
    expect(routeMatcher("/").test("/")).toBe(true);
    expect(routeMatcher("/users/:id").test("/users/1")).toBe(true);
    expect(routeMatcher("/users/:id").test("/users")).toBe(false);
    expect(routeMatcher("/posts/:id?").test("/posts")).toBe(true);
    expect(routeMatcher("/files/**:path").test("/files/a/b")).toBe(true);
    expect(routeMatcher("/files/**:path").test("/files")).toBe(false);
    expect(routeMatcher("/v1.0/x").test("/v1x0/x")).toBe(false);
  });
});

describe("route discovery", () => {
  it("ignores private, test, and declaration files", async () => {
    const directory = await fixture({
      "_leaf.ts": "",
      "hello.ts": "",
      "hello.test.ts": "",
      "types.d.ts": "",
      "_internal/secret.ts": "",
      "users/[id].ts": "",
    });
    const routes = await discoverRoutes(directory);
    expect(routes.map((route) => route.route)).toEqual(["/hello", "/users/:id"]);
  });

  it("collects middleware chains from enclosing directories and groups", async () => {
    const directory = await fixture({
      "_middleware.ts": "",
      "public.ts": "",
      "(admin)/_middleware.ts": "",
      "(admin)/users/_middleware.ts": "",
      "(admin)/users/list.ts": "",
    });
    const routes = await discoverRoutes(directory);
    const middleware = Object.fromEntries(
      routes.map((route) => [
        route.route,
        route.middleware.map((file) => path.relative(directory, file)),
      ])
    );
    expect(middleware).toEqual({
      "/public": ["_middleware.ts"],
      "/users/list": [
        "_middleware.ts",
        path.join("(admin)", "_middleware.ts"),
        path.join("(admin)", "users", "_middleware.ts"),
      ],
    });
  });

  it("rejects ambiguous middleware modules", async () => {
    const directory = await fixture({ "_middleware.ts": "", "_middleware.js": "" });
    await expect(discoverRoutes(directory)).rejects.toThrow("More than one middleware");
  });

  it("rejects files that resolve to the same path", async () => {
    const directory = await fixture({ "users/[id].ts": "", "users/[slug].ts": "" });
    await expect(discoverRoutes(directory)).rejects.toThrow("same path");
  });

  it("rejects an optional catch-all that collides with its parent index", async () => {
    const directory = await fixture({ "docs/index.ts": "", "docs/[[...slug]].ts": "" });
    await expect(discoverRoutes(directory)).rejects.toThrow("/docs");
  });

  it("rejects route groups that collide", async () => {
    const directory = await fixture({ "(a)/health.ts": "", "health.ts": "" });
    await expect(discoverRoutes(directory)).rejects.toThrow("/health");
  });
});

describe("generated entry", () => {
  const root = "/project/api";
  const route = (file: string, pattern: string, middleware: string[] = []) => ({
    file: `${root}/${file}`,
    route: pattern,
    middleware,
  });

  it("emits registrations with base prefixes and shared middleware imports", () => {
    const shared = `${root}/_middleware.ts`;
    const output = generateEntry(
      [
        route("hello.ts", "/hello", [shared]),
        route("docs/[[...slug]].ts", "/docs/**:slug?", [shared]),
      ],
      { routesDirectory: root, sourceFile: "/project/dist/worker.ts", base: "/api/" }
    );
    expect(output).toContain('import * as route0 from "../api/hello.ts"');
    expect(output.match(/import \* as middlewareModule/g)).toHaveLength(1);
    expect(output).toContain('register(["/api/hello"], route0, [...middleware0]);');
    expect(output).toContain(
      'register(["/api/docs","/api/docs/**:slug"], route1, [...middleware0]);'
    );
    expect(output).toContain(
      'export const routes = ["/api/hello","/api/docs","/api/docs/**:slug"];'
    );
  });

  it("registers routes on a user-provided H3 app and forwards Worker handlers", () => {
    const output = generateEntry([], {
      routesDirectory: root,
      sourceFile: "/project/dist/worker.ts",
      entryFile: "/project/api/_leaf.ts",
    });
    expect(output).toContain('import * as leafEntry from "../api/_leaf.ts"');
    expect(output).toContain("export const app = entryApp(leafEntry);");
    expect(output).toContain("export default { ...workerHandlers(leafEntry), fetch };");
    expect(output).not.toContain('from "h3"');
  });
});

describe("generated types", () => {
  it("emits params for every pattern kind", () => {
    const types = generateTypes(
      [
        { file: "/p/api/users/[id].ts", route: "/users/:id", middleware: [] },
        { file: "/p/api/docs/[[...slug]].tsx", route: "/docs/**:slug?", middleware: [] },
      ],
      { typesFile: "/p/.h3leaf/routes.d.ts", base: "/api" }
    );
    expect(types).toContain('"/api/users/:id": {\n    params: { "id": string };');
    expect(types).toContain('module: typeof import("../api/users/[id].js");');
    expect(types).toContain('params: { "slug"?: string };');
  });

  it("type-checks client calls against route modules", async () => {
    const root = await fixture(
      {
        "api/users/[id].ts": `export const GET = () => ({ user: { name: "Ada" } });
export const POST = async () => ({ ok: true });`,
        "api/docs/[[...slug]].ts": `export const handler = () => new Response("docs");`,
        "api/health.ts": `export default () => "ok";`,
      },
      "types"
    );
    const typesFile = path.join(root, ".h3leaf/routes.d.ts");
    const { types } = await compileEntry({ routesDirectory: path.join(root, "api"), typesFile });
    await writeIfChanged(typesFile, types ?? "");
    const client = path.relative(root, path.resolve("src/client.js")).replace(/\\/g, "/");
    const check = path.join(root, "check.ts");
    await writeFile(
      check,
      `import type { Routes } from "./.h3leaf/routes.js";
import { createClient } from "${client}";

const api = createClient<Routes>();
const user = await api.json("/users/:id", { params: { id: "1" } });
const name: string = user.user.name;
const created: { ok: boolean } = await api.json("/users/:id", { method: "POST", params: { id: "1" } });
const docs: unknown = await api.json("/docs/**:slug?");
const health: string = await api.json("/health", { method: "DELETE" });
// @ts-expect-error params are required
void api.json("/users/:id");
// @ts-expect-error PUT is not exported
void api.json("/users/:id", { method: "PUT", params: { id: "1" } });
// @ts-expect-error unknown route
void api.json("/nope");
export { name, created, docs, health };
`
    );
    const program = ts.createProgram([check], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      types: [],
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  }, 20_000);
});
