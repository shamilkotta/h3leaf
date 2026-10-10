import type { H3Event } from "h3";

export const handler = (event: H3Event) => ({
  method: event.req.method,
  path: event.context.params?.path,
});
