# Route conventions

Files under the routes directory are URL endpoints. `index.ts` resolves to its directory; extensions may be `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, or `.mjs`. Files beginning with `_`, test/spec files, and declaration files are ignored.

| File                   | Route           |
| ---------------------- | --------------- |
| `health.ts`            | `/health`       |
| `users/index.ts`       | `/users`        |
| `users/[id].ts`        | `/users/:id`    |
| `docs/[...path].ts`    | `/docs/**:path` |
| `docs/[[...path]].ts`  | `/docs/**`      |
| `blog/[[slug]].ts`     | `/blog/:slug?`  |
| `(internal)/health.ts` | `/health`       |

Routes export uppercase HTTP method handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `CONNECT`, `TRACE`), plus an optional `handler` or default export for all methods. Specific methods win over `handler`; two route files resolving to the same path are rejected at build time.

Generated handlers receive H3's `H3Event`, so H3's response conversion, params, middleware-compatible context, errors, and `event.waitUntil()` remain available. The compilation stage is represented as an `Effect` program, keeping filesystem failures typed and composable for embedding tools.

## Optional app entry

Place `_leaf.ts` (or another supported JS/TS extension) at the root of the routes directory to own the H3 app instance. Export a named `app` (recommended) or default `H3` instance; h3leaf attaches every discovered route to it. This is where application-wide middleware, H3 plugins, error hooks, and custom app configuration live.

```ts
// api/_leaf.ts
import { H3 } from "h3";

export const app = new H3().use((event) => {
  event.res.headers.set("x-powered-by", "my-api");
});
```

The CLI supports `--entry custom-app` for another module name. The compiler and Vite plugin accept `entryFile: "custom-app"`; set it to `false` to disable entry-file discovery.
