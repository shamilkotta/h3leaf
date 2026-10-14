# Vite example

The Vite plugin makes one app build produce the frontend assets and API Worker.

```sh
pnpm --filter @h3leaf/example-vite-api build
pnpm --filter @h3leaf/example-vite-api dev
pnpm --filter @h3leaf/example-vite-api typecheck
```

Vite's Environment API uses app builds, so the script runs `vite build`: one Vite invocation, with no secondary bundler or h3leaf command. Vite emits the site to `dist/` and the Worker to `dist/api.mjs`. This example configures `base: "/api"`, so it exposes `GET /api/hello?name=Ada`, plus `GET /api/posts` and `GET /api/posts/42`. `pnpm dev` serves the same API through Vite's dev server.

`api/_leaf.ts` owns the H3 app instance and applies middleware to every API response. `src/main.ts` calls the API with `h3leaf/client`, typed by the generated `.h3leaf/routes.d.ts`; `typecheck` regenerates that file with `h3leaf types` before running `tsc`.
