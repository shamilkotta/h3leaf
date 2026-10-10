import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({
  message: "Hello from the Vite-built H3 Worker",
  query: Object.fromEntries(event.url.searchParams),
});
