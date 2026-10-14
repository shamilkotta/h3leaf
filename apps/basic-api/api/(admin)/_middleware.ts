import type { H3Event, Middleware } from "h3";

/** Applies to every route in `(admin)`; the group name doesn't appear in URLs. */
export const middleware: Middleware = (event: H3Event) => {
  if (event.req.headers.get("authorization") !== "Bearer demo") {
    return new Response("Unauthorized", { status: 401 });
  }
};
