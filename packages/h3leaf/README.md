# h3leaf

[![npm](https://img.shields.io/npm/v/h3leaf?label=npm)](https://www.npmjs.com/package/h3leaf)
[![license](https://img.shields.io/npm/l/h3leaf)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/h3leaf)](https://nodejs.org/)

File-based API routing for [H3](https://h3.dev). h3leaf compiles an `api/` directory of TypeScript or JavaScript route files into a single Web-standard `fetch` handler for Cloudflare Workers and other `Request` / `Response` runtimes.

Use the CLI for API-only Workers, or the optional Vite plugin (`h3leaf/vite`) to build a frontend and its API Worker with one `vite build`.

## Features

- File-based routing with Next.js-style segments (`[id]`, `[[id]]`, `[...path]`, `[[...path]]`, route groups)
- HTTP method exports (`GET`, `POST`, …) plus fallback `handler` / `default`
- Per-directory `_middleware` modules, scoped to the routes beneath them
- Optional `_leaf` entry so your app owns the H3 instance, plus Worker `scheduled` / `queue` / `email` handlers
- Cloudflare `env`, `ctx`, and `event.waitUntil()` available in every handler
- Generated route types and a typed `fetch` client (`h3leaf/client`)
- `h3leaf build` — bundle a Worker-ready ESM module with esbuild
- `h3leaf dev` — local server that reloads when any imported file changes
- Vite Environment API plugin — one build for site + Worker, with the API served by the Vite dev server

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Route conventions](#route-conventions)
- [Route handlers](#route-handlers)
- [Middleware](#middleware)
- [App entry (`_leaf`)](#app-entry-_leaf)
- [Typed client](#typed-client)
- [CLI](#cli)
- [Vite plugin](#vite-plugin)
- [Generated module](#generated-module)

## Requirements

- Node.js **20+**
- Peer: [`h3`](https://www.npmjs.com/package/h3) `^2.0.1-rc.9`
- Peer (optional): [`vite`](https://vite.dev) `^6` / `^7` / `^8` when using `h3leaf/vite`

<!-- #region install -->

## Install

```sh
pnpm add h3 h3leaf
```

For Vite projects, Vite is already a dependency of your app; h3leaf treats it as an optional peer.

<!-- #endregion install -->

<!-- #region quick-start -->

## Quick start

### 1. Add a route

```ts
// api/users/[id].ts
import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({
  id: event.context.params?.id,
});

export const DELETE = () => new Response(null, { status: 204 });
```

### 2. Build or develop

```sh
# Production Worker bundle
pnpm h3leaf build --routes api --out dist/worker.mjs

# Local API server (reloads when routes or anything they import change)
pnpm h3leaf dev --routes api --port 3000
```

Point your Worker platform at the output file (for example Wrangler `main = "dist/worker.mjs"`).

### 3. Or use Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { h3leaf } from "h3leaf/vite";

export default defineConfig({
  plugins: [h3leaf({ routesDir: "api", base: "/api", outFile: "worker.mjs" })],
});
```

`vite build` emits frontend assets and the Worker. `vite` / `pnpm dev` serves the API through the Vite dev server.

<!-- #endregion quick-start -->

---

<!-- #region routing -->

## Route conventions

Files under the routes directory become URL endpoints. Supported extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`.

| File                   | Route                       |
| ---------------------- | --------------------------- |
| `health.ts`            | `/health`                   |
| `users/index.ts`       | `/users`                    |
| `users/[id].ts`        | `/users/:id`                |
| `blog/[[slug]].ts`     | `/blog/:slug?`              |
| `docs/[...path].ts`    | `/docs/**:path`             |
| `docs/[[...path]].ts`  | `/docs` and `/docs/**:path` |
| `(internal)/health.ts` | `/health`                   |

### Segment rules

| Pattern       | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `index`       | Directory root when it is the file name; omitted from the path |
| `[id]`        | Required dynamic param → `:id`                                 |
| `[[id]]`      | Optional dynamic param → `:id?`                                |
| `[...path]`   | Catch-all, one or more segments → `**:path`                    |
| `[[...path]]` | Optional catch-all, zero or more segments; param is `path`     |
| `(group)`     | Route group; does not appear in the URL                        |

`[id]` matches `/users/42` but not `/users`. `[[id]]` matches both. Catch-all params hold the remaining path, e.g. `a/b` for `/docs/a/b`.

### Ignored files

These are never registered as routes:

- Names starting with `_` (reserved for `_leaf` and `_middleware` modules); directories starting with `_` are skipped entirely
- Test / spec files: `*.test.*`, `*.spec.*`
- Declaration files: `*.d.ts`

### Duplicate paths

Route files that can match the same URL fail at compile time with a clear error — including patterns that only differ by param name (`users/[id].ts` and `users/[slug].ts`) and an optional catch-all next to its parent index (`docs/index.ts` and `docs/[[...path]].ts`).

<!-- #endregion routing -->

---

<!-- #region handlers -->

## Route handlers

Export uppercase HTTP method names. Handlers receive H3’s `H3Event`, so params, headers, body helpers, middleware context, and errors work as usual.

```ts
import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({ ok: true });
export const POST = async (event: H3Event) => {
  const body = await event.req.json();
  return { received: body };
};
```

Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `CONNECT`, `TRACE`.

### Fallback handlers

| Export                  | Behavior                                          |
| ----------------------- | ------------------------------------------------- |
| Named method (`GET`, …) | Registered with `app.on(method, path, handler)`   |
| `handler`               | Registered with `app.all(path, …)` for any method |
| `default`               | Same as `handler` if `handler` is absent          |

Specific method exports win over the fallback for that method.

### Cloudflare bindings

When the Worker runtime calls `fetch(request, env, ctx)`, the generated entry exposes them to handlers, and `event.waitUntil()` forwards to `ctx.waitUntil()`:

```ts
import type { H3Event } from "h3";

export const GET = async (event: H3Event) => {
  const env = event.runtime?.cloudflare?.env as Env;
  event.waitUntil(env.LOGS.put(crypto.randomUUID(), event.url.pathname));
  return env.KV.get("greeting");
};
```

`cloudflare:*` and `node:*` imports are left external for the Workers runtime (enable `nodejs_compat` for `node:*`).

<!-- #endregion handlers -->

---

<!-- #region middleware -->

## Middleware

A `_middleware` module applies to every route in its directory and below, including routes inside route groups. Export a default or named `middleware` H3 middleware — or an array of them:

```ts
// api/(admin)/_middleware.ts
import type { Middleware } from "h3";

export const middleware: Middleware = (event) => {
  if (!event.req.headers.get("authorization")) {
    return new Response("Unauthorized", { status: 401 });
  }
};
```

Middleware runs outermost first (`api/_middleware.ts`, then `api/(admin)/_middleware.ts`, …) and only for matched file routes. Use `app.use()` in `_leaf` for middleware that should see every request, including 404s.

Because route groups don't appear in URLs, `(admin)/_middleware.ts` protects only the files inside `(admin)/` — not sibling routes that share the same URL prefix.

<!-- #endregion middleware -->

---

<!-- #region app-entry -->

## App entry (`_leaf`)

By default, h3leaf creates `new H3()` and attaches routes. To own the app instance—global middleware, plugins, error hooks, headers—add `_leaf` at the root of the routes directory:

```ts
// api/_leaf.ts
import { H3 } from "h3";

export const app = new H3().use((event) => {
  event.res.headers.set("x-powered-by", "my-api");
});

// Optional Worker handlers, forwarded to the Worker's default export.
export const scheduled = async (
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
) => {
  ctx.waitUntil(cleanup(env));
};
```

Export a named `app` (recommended) or a default `H3` instance. Generated routes attach to that instance. `scheduled`, `queue`, `email`, `tail`, and `trace` exports are added to the Worker's default export next to `fetch`.

| Mechanism       | How to customize                                                     |
| --------------- | -------------------------------------------------------------------- |
| CLI             | `--entry custom-app` (basename; extension resolved automatically)    |
| Compiler / Vite | `entryFile: "custom-app"` or `entryFile: false` to disable discovery |

When `entryFile` is omitted, `_leaf` is used if present; missing `_leaf` is fine. When you set an explicit name and the file is missing (or ambiguous), compilation fails.

<!-- #endregion app-entry -->

---

<!-- #region client -->

## Typed client

`build`, `dev`, `types`, and the Vite plugin write a route map to `.h3leaf/routes.d.ts`. Pair it with `h3leaf/client` for type-checked paths, params, methods, and response bodies:

```ts
import { createClient } from "h3leaf/client";
import type { Routes } from "../.h3leaf/routes";

const api = createClient<Routes>({ baseURL: "https://api.example.com" });

const { user } = await api.json("/users/:id", { params: { id: "42" } });
await api.json("/users/:id", { method: "DELETE", params: { id: "42" } });
api.json("/users/:id"); // ✗ type error: params.id is required
```

| Method                         | Returns                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `api.json(path, options)`      | Parsed JSON typed from the handler's return; throws `HTTPError` on non-2xx |
| `api.request(path, options)`   | The raw `Response`                                                         |
| `api.url(path, params, query)` | The URL string                                                             |

Options: `params`, `method` (default `GET`), `query`, `body` (objects are sent as JSON), plus any `RequestInit` field. Client options: `baseURL`, `headers`, and a custom `fetch` (e.g. `app.fetch` in tests).

Handlers that return a raw `Response` are typed as `unknown`. Add `.h3leaf/` to `.gitignore`; run `h3leaf types` in CI before type-checking.

<!-- #endregion client -->

---

<!-- #region cli -->

## CLI

```
Usage:
  h3leaf build [--routes api] [--base /api] [--entry _leaf] [--out dist/api.mjs] [--target workers]
  h3leaf dev   [--routes api] [--base /api] [--entry _leaf] [--port 3000] [--target workers]
  h3leaf types [--routes api] [--base /api] [--types .h3leaf/routes.d.ts]
```

| Flag       | Default               | Description                                                 |
| ---------- | --------------------- | ----------------------------------------------------------- |
| `--routes` | `api`                 | Routes directory                                            |
| `--base`   | _(none)_              | URL prefix applied to every route                           |
| `--entry`  | `_leaf`               | App entry module basename; extension resolved automatically |
| `--out`    | `dist/api.mjs`        | Bundle output path (`build` only)                           |
| `--port`   | `3000`                | Dev server port (`dev` only)                                |
| `--types`  | `.h3leaf/routes.d.ts` | Route map declaration; `--types=false` disables it          |
| `--target` | `workers`             | Package resolution: `workers`, `neutral`, or `node`         |

Flags accept both `--port 3000` and `--port=3000`; unknown flags are rejected.

| Target    | Resolution                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------ |
| `workers` | Matches Wrangler: `workerd` / `worker` / `browser` conditions; `cloudflare:*`, `node:*` external |
| `neutral` | Platform-neutral ESM for other `fetch` runtimes; `node:*` external                               |
| `node`    | Node.js platform, `node20` syntax                                                                |

`build` discovers routes, generates an entry module, and bundles ESM with esbuild. The output exports `fetch`, `app`, `routes`, and a default `{ fetch, …workerHandlers }` for Worker platforms.

`dev` rebuilds when any bundled file changes (including modules imported from outside the routes directory) and when route files are added or removed, then serves the latest build through H3. Failed reloads keep the last working app. Dev runs in Node.js, so use `--target node` if a dependency's Workers build needs the Workers runtime.

`types` writes the route map without bundling — handy before `tsc` in CI.

<!-- #endregion cli -->

---

<!-- #region vite -->

## Vite plugin

```ts
import { h3leaf } from "h3leaf/vite";

h3leaf({
  routesDir: "api", // default: "api"
  base: "/api", // optional URL prefix
  entryFile: "_leaf", // string | false | undefined
  outFile: "worker.mjs",
  sourcemap: false,
  target: "workers", // "workers" | "neutral" | "node"
  types: ".h3leaf/routes.d.ts", // or false
});
```

| Option      | Default                                         | Description                                          |
| ----------- | ----------------------------------------------- | ---------------------------------------------------- |
| `routesDir` | `"api"`                                         | Routes directory relative to Vite root               |
| `base`      | _(none)_                                        | Prefix for registered paths                          |
| `entryFile` | `"_leaf"` discovery                             | Same semantics as the CLI                            |
| `outFile`   | `"api.mjs"`, or `"<base>.mjs"` if `base` is set | Worker entry filename under Vite `outDir`            |
| `sourcemap` | Vite `build.sourcemap`                          | Worker sourcemaps                                    |
| `target`    | `"workers"`                                     | Resolve conditions for the Worker build              |
| `types`     | `".h3leaf/routes.d.ts"`                         | Route map path relative to the Vite root, or `false` |

The plugin registers a Vite environment named `h3leaf`, builds it during `buildApp`, and does not empty the shared `outDir` so frontend assets remain intact.

In dev, the API runs in the `h3leaf` environment's module runner, so route edits apply on the next request and added or removed route files are picked up automatically. With `base`, every request under that prefix goes to the API (including its 404s). Without `base`, only paths that match a file route are sent to the API and everything else falls through to Vite — routes registered directly on the `_leaf` app need a `base` to be reachable in dev.

<!-- #endregion vite -->

---

<!-- #region output -->

## Generated module

Compilation produces a module shaped like:

```ts
// Generated by h3leaf. Do not edit.
import * as leafEntry from "./api/_leaf.ts";
// … middleware and route imports …

export const app = /* your _leaf app or new H3() */;
// … app.on / app.all registrations with route middleware …

export const routes = ["/users/:id", /* … */];
export const fetch = (request, env, ctx) => /* forwards Cloudflare env/ctx */ app.fetch(request);
export default { ...workerHandlers(leafEntry), fetch };
```

Deploy that bundle as a Worker entry, or import `fetch` / `app` from your own host adapter.

## Base path

`--base` / `base` prefixes every route. With `base: "/api"`:

| File              | Registered path                              |
| ----------------- | -------------------------------------------- |
| `hello.ts`        | `/api/hello`                                 |
| `posts/[[id]].ts` | `/api/posts/:id?` (matches `/api/posts` too) |

Use this when the Worker sits behind a path prefix or shares a host with a Vite SPA.

<!-- #endregion output -->

## Public API

The supported interfaces are the `h3leaf` CLI, the `h3leaf/vite` plugin, and the `h3leaf/client` typed client. The underlying compiler is not part of the package exports.

---

## Examples

In the [h3leaf monorepo](https://github.com/shamilkotta/h3leaf):

- [`apps/basic-api`](https://github.com/shamilkotta/h3leaf/tree/main/apps/basic-api) — CLI-only Worker with middleware and a Cron Trigger handler
- [`apps/vite-api`](https://github.com/shamilkotta/h3leaf/tree/main/apps/vite-api) — Vite site + API Worker with the typed client

## License

[MIT](./LICENSE) © shamilkotta
