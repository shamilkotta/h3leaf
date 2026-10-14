# Basic API example

This is a Worker-only project. It uses the standalone CLI and has no Vite app.

```sh
pnpm --filter @h3leaf/example-basic-api build
pnpm --filter @h3leaf/example-basic-api dev
```

The build produces `dist/api.mjs`. Deploy that file with your Worker platform, for example by setting Wrangler's `main` to `dist/api.mjs`.

- `api/_leaf.ts` exports the application-owned H3 instance, whose middleware adds an `x-powered-by: h3leaf` header, and a `scheduled` handler for Cron Triggers.
- `api/(admin)/_middleware.ts` guards every route in the `(admin)` group; `GET /stats` needs `Authorization: Bearer demo`.

Try these endpoints: `GET /`, `GET /health`, `GET /stats`, `GET /users/42`, `DELETE /users/42`, and any method at `/files/a/b.txt`.
