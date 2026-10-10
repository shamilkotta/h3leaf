import type { H3Event } from "h3";

export const GET = (event: H3Event) => ({
  user: { id: event.context.params?.id, name: "Ada Lovelace" },
});

export const DELETE = () => new Response(null, { status: 204 });
