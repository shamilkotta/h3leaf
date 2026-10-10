import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({
  postId: event.context.params?.id ?? null,
});
