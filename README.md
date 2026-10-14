# h3leaf

[![npm](https://img.shields.io/npm/v/h3leaf?label=npm)](https://www.npmjs.com/package/h3leaf)
[![license](https://img.shields.io/npm/l/h3leaf)](./packages/h3leaf/LICENSE)
[![Node.js](https://img.shields.io/node/v/h3leaf)](https://nodejs.org/)

File-based API routing for [H3](https://h3.dev). h3leaf compiles a directory of TypeScript route files into a single Web-standard `fetch` handler, ready to deploy to Cloudflare Workers or any `Request` / `Response` runtime. It ships as a CLI and an optional Vite plugin.

```ts
// api/users/[id].ts  →  GET /users/:id
import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({ id: event.context.params?.id });
```

```sh
pnpm add h3 h3leaf
pnpm h3leaf build --routes api --out dist/worker.mjs
```

## Features

- Next.js-style file routing for H3: dynamic `[id]`, optional `[[id]]`, catch-all `[...path]` / `[[...path]]`, and `(group)` segments
- Per-method exports (`GET`, `POST`, …) with `handler` / `default` fallbacks
- Per-directory `_middleware` modules
- `api/_leaf.ts` app entry for your own H3 instance, plus Worker `scheduled` / `queue` handlers
- Cloudflare `env`, `ctx`, and `event.waitUntil()` in every handler
- Generated route types and a typed client (`h3leaf/client`)
- `h3leaf build` bundles a Worker-ready ESM module with esbuild
- `h3leaf dev` runs a local API server that reloads when anything it imports changes
- `h3leaf/vite` builds a Vite frontend and its API Worker in one `vite build`, and serves the API in dev

Full documentation — routing rules, CLI flags, Vite options, and output format — is in the [package README](./packages/h3leaf/README.md).

## Repository

| Path                                   | Description                                               |
| -------------------------------------- | --------------------------------------------------------- |
| [`packages/h3leaf`](./packages/h3leaf) | The published `h3leaf` package (CLI, Vite plugin, client) |
| [`apps/basic-api`](./apps/basic-api)   | Example: API-only Cloudflare Worker built with CLI        |
| [`apps/vite-api`](./apps/vite-api)     | Example: Vite app and API Worker in a single build        |
| [`apps/docs`](./apps/docs)             | VitePress documentation site                              |

## Development

Requires Node.js 20+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Run an example:

```sh
pnpm --filter @h3leaf/example-basic-api dev
pnpm --filter @h3leaf/example-vite-api dev
pnpm --filter @h3leaf/docs dev
```

CI (`.github/workflows/ci.yml`) runs lint, format check, build, typecheck, and tests on Node 20, 22, and 24, plus Windows and macOS.

## License

[MIT](./packages/h3leaf/LICENSE) © shamilkotta
