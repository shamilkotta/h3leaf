import { describe, expect, it } from "vitest";
import { fileToRoute, generateEntry } from "./index.js";

describe("file routes", () => {
  const root = "/project/api";
  it("maps Next-style segments to H3 route patterns", () => {
    expect(fileToRoute(root, "/project/api/users/[id].ts")).toBe("/users/:id");
    expect(fileToRoute(root, "/project/api/docs/[...path].ts")).toBe("/docs/**:path");
    expect(fileToRoute(root, "/project/api/docs/[[...path]].ts")).toBe("/docs/**");
    expect(fileToRoute(root, "/project/api/(admin)/index.ts")).toBe("/");
  });
  it("emits method and fallback registrations", () => {
    const output = generateEntry([{ file: "/project/api/hello.ts", route: "/hello" }], {
      routesDirectory: root,
      sourceFile: "/project/dist/worker.ts",
    });
    expect(output).toContain('app.on(method, "/hello", handler)');
    expect(output).toContain('app.all("/hello", fallback)');
  });
  it("prefixes every generated route when a base is configured", () => {
    const output = generateEntry([{ file: "/project/api/hello.ts", route: "/hello" }], {
      routesDirectory: root,
      sourceFile: "/project/dist/worker.ts",
      base: "/api/",
    });
    expect(output).toContain('app.on(method, "/api/hello", handler)');
  });

  it("registers routes on a user-provided H3 app", () => {
    const output = generateEntry([], {
      routesDirectory: root,
      sourceFile: "/project/dist/worker.ts",
      entryFile: "/project/api/_leaf.ts",
    });
    expect(output).toContain('import * as leafEntry from "../api/_leaf.ts"');
    expect(output).toContain('Object.entries(leafEntry).find(([name]) => name === "app")');
  });
});
