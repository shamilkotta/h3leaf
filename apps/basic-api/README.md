# Basic API example

This is a Worker-only project. It uses the standalone CLI and has no Vite app.

```sh
pnpm --filter @h3leaf/example-basic-api build
pnpm --filter @h3leaf/example-basic-api dev
```

The command produces `dist/worker.mjs`. Deploy that file with your Worker platform, for example by setting Wrangler's `main` to `dist/worker.mjs`.

`api/_leaf.ts` exports the application-owned H3 instance. Its middleware adds an `x-powered-by: h3leaf` response header before any generated route executes.

Try these endpoints after deployment: `GET /`, `GET /health`, `GET /users/42`, `DELETE /users/42`, and any method at `/files/a/b.txt`.
