# h3leaf

`h3leaf` compiles convention-based API route files into one H3 fetch handler for Cloudflare Workers and other Web-standard runtimes.

Examples: [`apps/basic-api`](./apps/basic-api) uses the CLI for a Worker-only API, while [`apps/vite-api`](./apps/vite-api) lets Vite build a site and Worker together.

```sh
pnpm add h3 h3leaf
pnpm h3leaf build --routes api --out dist/worker.mjs
```

Or let an existing Vite build produce the Worker too:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { h3leaf } from "h3leaf/vite";

export default defineConfig({ plugins: [h3leaf()] });
```

```ts
// api/users/[id].ts
import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({ id: event.context.params.id });
export const DELETE = () => new Response(null, { status: 204 });
```

Supported files: `index`, static segments, `[id]`, `[[id]]`, `[...path]`, and `[[...path]]`; route files can export HTTP method names, `handler` (all methods), or `default` (all methods). Route groups `(name)` do not affect the URL. See `packages/h3leaf/README.md` for the full convention.

`[id]` is required: `api/users/[id].ts` matches `/users/42`, not `/users`. `[[id]]` is optional: `api/users/[[id]].ts` matches both `/users` and `/users/42`.

To own the H3 app configuration, add `api/_leaf.ts` and export an `app` instance. Generated routes are attached to that instance, so global middleware, plugins, and custom hooks remain entirely under the application's control.

For local API-only development, use `h3leaf dev --routes api --port 3000`. It watches route files and atomically reloads the Worker handler. In Vite projects, run `vite`/`pnpm dev`; configure `h3leaf({ base: "/api" })` to serve API requests from the same Vite dev server.
