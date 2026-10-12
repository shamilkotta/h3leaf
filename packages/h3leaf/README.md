# h3leaf

[![npm](https://img.shields.io/npm/v/h3leaf?label=npm)](https://www.npmjs.com/package/h3leaf)
[![license](https://img.shields.io/npm/l/h3leaf)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/h3leaf)](https://nodejs.org/)

File-based API routing for [H3](https://h3.dev). h3leaf compiles an `api/` directory of TypeScript or JavaScript route files into a single Web-standard `fetch` handler for Cloudflare Workers and other `Request` / `Response` runtimes.

Use the CLI for API-only Workers, or the optional Vite plugin (`h3leaf/vite`) to build a frontend and its API Worker with one `vite build`.

## Features

- File-based routing with Next.js-style segments (`[id]`, `[[id]]`, `[...path]`, route groups)
- HTTP method exports (`GET`, `POST`, …) plus fallback `handler` / `default`
- Optional `_leaf` entry so your app owns the H3 instance, middleware, and plugins
- `h3leaf build` — bundle a Worker-ready ESM module with esbuild
- `h3leaf dev` — local server with watch and hot reload
- Vite Environment API plugin — one build for site + Worker; dev middleware when `base` is set

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Route conventions](#route-conventions)
- [Route handlers](#route-handlers)
- [App entry (`_leaf`)](#app-entry-_leaf)
- [CLI](#cli)
- [Vite plugin](#vite-plugin)
- [Deployment output](#generated-module)

## Requirements

- Node.js **20+**
- Peer: [`h3`](https://www.npmjs.com/package/h3) `^2.0.1-rc.9`
- Peer (optional): [`vite`](https://vite.dev) `^6` / `^7` / `^8` when using `h3leaf/vite`

## Install

```sh
pnpm add h3 h3leaf
```

For Vite projects, Vite is already a dependency of your app; h3leaf treats it as an optional peer.

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

# Local API server (watches routes, reloads on change)
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

`vite build` emits frontend assets and the Worker. With `base` set, `vite` / `pnpm dev` also serves matching API requests through the Vite dev server.

---

## Route conventions

Files under the routes directory become URL endpoints. Supported extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`.

| File                   | Route           |
| ---------------------- | --------------- |
| `health.ts`            | `/health`       |
| `users/index.ts`       | `/users`        |
| `users/[id].ts`        | `/users/:id`    |
| `blog/[[slug]].ts`     | `/blog/:slug?`  |
| `docs/[...path].ts`    | `/docs/**:path` |
| `docs/[[...path]].ts`  | `/docs/**`      |
| `(internal)/health.ts` | `/health`       |

### Segment rules

| Pattern       | Meaning                                 |
| ------------- | --------------------------------------- |
| `index`       | Directory root; omitted from the path   |
| `[id]`        | Required dynamic param → `:id`          |
| `[[id]]`      | Optional dynamic param → `:id?`         |
| `[...path]`   | Named catch-all → `**:path`             |
| `[[...path]]` | Anonymous catch-all → `**`              |
| `(group)`     | Route group; does not appear in the URL |

`[id]` matches `/users/42` but not `/users`. `[[id]]` matches both.

### Ignored files

These are never registered as routes:

- Names starting with `_` (reserved for entry modules such as `_leaf.ts`)
- Test / spec files: `*.test.*`, `*.spec.*`
- Declaration files: `*.d.ts`

### Duplicate paths

Two route files that resolve to the same URL fail at compile time with a clear error. Fix the collision before build or dev can succeed.

---

## Route handlers

Export uppercase HTTP method names. Handlers receive H3’s `H3Event`, so params, headers, body helpers, middleware context, errors, and `event.waitUntil()` work as usual.

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

---

## App entry (`_leaf`)

By default, h3leaf creates `new H3()` and attaches routes. To own the app instance—global middleware, plugins, error hooks, headers—add `_leaf` at the root of the routes directory:

```ts
// api/_leaf.ts
import { H3 } from "h3";

export const app = new H3().use((event) => {
  event.res.headers.set("x-powered-by", "my-api");
});
```

Export a named `app` (recommended) or a default `H3` instance. Generated routes attach to that instance.

| Mechanism       | How to customize                                                     |
| --------------- | -------------------------------------------------------------------- |
| CLI             | `--entry custom-app` (basename; extension resolved automatically)    |
| Compiler / Vite | `entryFile: "custom-app"` or `entryFile: false` to disable discovery |

When `entryFile` is omitted, `_leaf` is used if present; missing `_leaf` is fine. When you set an explicit name and the file is missing (or ambiguous), compilation fails.

---

## CLI

```
Usage:
  h3leaf build [--routes api] [--base /api] [--entry _leaf] [--out dist/worker.mjs]
  h3leaf dev   [--routes api] [--base /api] [--entry _leaf] [--port 3000]
```

| Flag       | Default        | Description                                                                       |
| ---------- | -------------- | --------------------------------------------------------------------------------- |
| `--routes` | `api`          | Routes directory                                                                  |
| `--base`   | _(none)_       | URL prefix applied to every route                                                 |
| `--entry`  | `_leaf`        | App entry module basename (or path without forcing discovery when using defaults) |
| `--out`    | `dist/api.mjs` | Bundle output path (`build` only)                                                 |
| `--port`   | `3000`         | Dev server port (`dev` only)                                                      |

`build` discovers routes, generates an entry module, and bundles ESM with esbuild (`platform: "neutral"`, `target: "es2022"`). The output exports `fetch`, `app`, and `default: { fetch }` for Worker platforms.

`dev` watches the routes directory, rebuilds into a temp module, and serves through H3. Failed reloads keep the last working app.

---

## Vite plugin

```ts
import { h3leaf } from "h3leaf/vite";

h3leaf({
  routesDir: "api", // default: "api"
  base: "/api", // optional URL prefix; enables dev middleware
  entryFile: "_leaf", // string | false | undefined
  outFile: "worker.mjs",
  sourcemap: false,
});
```

| Option      | Default                                         | Description                                                                      |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `routesDir` | `"api"`                                         | Routes directory relative to Vite root                                           |
| `base`      | _(none)_                                        | Prefix for registered paths; when set, Vite middleware serves that prefix in dev |
| `entryFile` | `"_leaf"` discovery                             | Same semantics as the compiler                                                   |
| `outFile`   | `"api.mjs"`, or `"<base>.mjs"` if `base` is set | Worker entry filename under Vite `outDir`                                        |
| `sourcemap` | Vite `build.sourcemap`                          | Worker sourcemaps                                                                |

The plugin registers a Vite environment named `h3leaf`, builds it during `buildApp`, and does not empty the shared `outDir` so frontend assets remain intact.

---

## Generated module

Compilation produces a module shaped like:

```ts
// Generated by h3leaf. Do not edit.
import { H3 } from "h3";
// … route imports …

export const app = /* your _leaf app or new H3() */;
// … app.on / app.all registrations …

export const fetch = app.fetch;
export default { fetch };
```

Deploy that bundle as a Worker entry, or import `fetch` / `app` from your own host adapter.

---

## Base path

`--base` / `base` prefixes every route. With `base: "/api"`:

| File              | Registered path                    |
| ----------------- | ---------------------------------- |
| `hello.ts`        | `/api/hello`                       |
| `posts/[[id]].ts` | `/api/posts` and `/api/posts/:id?` |

Use this when the Worker sits behind a path prefix or shares a host with a Vite SPA.

## Public API

The supported interfaces are the `h3leaf` CLI and the `h3leaf/vite` plugin. The underlying compiler is not part of the package exports.

---

## Examples

In the [h3leaf monorepo](https://github.com/shamilkotta/h3leaf):

- [`apps/basic-api`](https://github.com/shamilkotta/h3leaf/tree/main/apps/basic-api) — CLI-only Worker
- [`apps/vite-api`](https://github.com/shamilkotta/h3leaf/tree/main/apps/vite-api) — Vite site + API Worker

## License

[MIT](./LICENSE) © shamilkotta
