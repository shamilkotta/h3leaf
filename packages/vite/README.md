# @h3leaf/vite

Build the frontend and its H3 API Worker in one `vite build` command.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { h3leaf } from "@h3leaf/vite";

export default defineConfig({
  plugins: [h3leaf({ routesDir: "api", base: "/api", outFile: "worker.mjs" })],
});
```

Add `api/_leaf.ts` to supply your own H3 instance. h3leaf registers generated routes on that instance, preserving your global middleware and other H3 configuration:

```ts
import { H3 } from "h3";

export const app = new H3().use((event) => {
  event.res.headers.set("x-api", "vite");
});
```
