import { describe, expect, it } from "vitest";
import { H3 } from "h3";
import { buildPath, createClient, HTTPError } from "./client.js";

type Routes = {
  "/users/:id": {
    params: { id: string };
    module: {
      GET: () => { id: string };
      POST: () => Promise<{ created: true }>;
    };
  };
  "/files/**:path?": { params: { path?: string }; module: { handler: () => Response } };
};

const app = new H3()
  .get("/users/:id", (event) => ({ id: event.context.params?.id, q: event.url.search }))
  .post("/users/:id", async (event) => ({ body: await event.req.json() }))
  .all("/files/**", (event) => new Response(event.url.pathname, { status: 404 }));

describe("buildPath", () => {
  it("interpolates and encodes params", () => {
    expect(buildPath("/users/:id", { id: "a b" })).toBe("/users/a%20b");
    expect(buildPath("/posts/:id?", {})).toBe("/posts");
    expect(buildPath("/files/**:path", { path: "a/b c" })).toBe("/files/a/b%20c");
    expect(buildPath("/files/**:path?")).toBe("/files");
    expect(() => buildPath("/users/:id")).toThrow('Missing route param "id"');
  });
});

describe("createClient", () => {
  const api = createClient<Routes>({ baseURL: "https://api.test/", fetch: app.fetch });

  it("sends typed requests with params, query, and JSON bodies", async () => {
    expect(await api.json("/users/:id", { params: { id: "7" }, query: { a: [1, 2] } })).toEqual({
      id: "7",
      q: "?a=1&a=2",
    });
    expect(
      await api.json("/users/:id", { method: "POST", params: { id: "7" }, body: { x: 1 } })
    ).toEqual({ body: { x: 1 } });
    expect(api.url("/files/**:path?", { path: "a/b" })).toBe("https://api.test/files/a/b");
  });

  it("throws HTTPError for failed JSON requests", async () => {
    const error = await api.json("/files/**:path?").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(HTTPError);
    expect((error as HTTPError).response.status).toBe(404);
  });
});
