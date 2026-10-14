/**
 * Typed `fetch` client for h3leaf routes. Pair it with the generated route map:
 *
 * ```ts
 * import type { Routes } from "../.h3leaf/routes";
 * const api = createClient<Routes>({ baseURL: "https://example.com" });
 * const { user } = await api.json("/users/:id", { params: { id: "42" } });
 * ```
 */

// Kept local so the client has no Node.js dependencies.
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "CONNECT"
  | "TRACE";

// oxlint-disable-next-line no-explicit-any -- handler parameter types are irrelevant here
type AnyFunction = (...args: any[]) => unknown;

/** Shape of each entry in the generated `Routes` interface. */
export type RouteEntry = Readonly<{ params: object; module: object }>;
/** Accepts the generated `Routes` interface (interfaces lack implicit index signatures). */
export type RouteMap<R> = { [K in keyof R]: RouteEntry };

type Fallback<M> = M extends { handler: AnyFunction }
  ? M["handler"]
  : M extends { default: AnyFunction }
    ? M["default"]
    : never;

/** HTTP methods a route module answers: its method exports, or all methods with a fallback. */
export type RouteMethods<M> =
  | Extract<keyof M, HttpMethod>
  | ([Fallback<M>] extends [never] ? never : HttpMethod);

type MethodHandler<M, K> = K extends keyof M ? M[K] : Fallback<M>;

/** JSON body a route method resolves to (raw `Response` returns are untyped). */
export type RouteData<M, K> =
  MethodHandler<M, K> extends (...args: never[]) => infer R
    ? Exclude<Awaited<R>, Response> extends never
      ? unknown
      : Exclude<Awaited<R>, Response>
    : unknown;

type DefaultMethod<M> = "GET" extends RouteMethods<M> ? "GET" : RouteMethods<M>;
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

export type RequestOptions<E extends RouteEntry, M> = Omit<RequestInit, "method" | "body"> & {
  method?: M;
  query?: Query;
  /** Plain objects and arrays are sent as JSON; other `BodyInit` values are sent as-is. */
  body?: unknown;
} & ([RequiredKeys<E["params"]>] extends [never]
    ? { params?: E["params"] }
    : { params: E["params"] });

type OptionsArgs<E extends RouteEntry, M> = [RequiredKeys<E["params"]>] extends [never]
  ? [options?: RequestOptions<E, M>]
  : [options: RequestOptions<E, M>];

export type ClientOptions = Readonly<{
  /** Origin (and optional path) requests resolve against; defaults to relative URLs. */
  baseURL?: string;
  fetch?: (request: Request) => Response | Promise<Response>;
  headers?: HeadersInit;
}>;

export class HTTPError extends Error {
  override name = "HTTPError";
  constructor(readonly response: Response) {
    super(`Request failed with ${response.status} ${response.statusText}`.trim());
  }
}

/** Interpolates params into an h3leaf route pattern (`:id`, `:id?`, `**:path`, `**:path?`). */
export const buildPath = (pattern: string, params: Record<string, unknown> = {}): string => {
  const segments = pattern.split("/").flatMap((segment) => {
    const match = /^(\*\*)?:(.+?)(\?)?$/.exec(segment);
    if (!match) return [segment];
    const [, catchAll, name = "", optional] = match;
    const value = params[name];
    if (value === undefined || value === null || value === "") {
      if (optional) return [];
      throw new TypeError(`Missing route param "${name}" for ${pattern}`);
    }
    const text = String(value);
    return catchAll
      ? text.split("/").filter(Boolean).map(encodeURIComponent)
      : [encodeURIComponent(text)];
  });
  return segments.join("/") || "/";
};

const isJsonBody = (body: unknown) =>
  body !== null &&
  typeof body === "object" &&
  !(body instanceof Blob) &&
  !(body instanceof ArrayBuffer) &&
  !ArrayBuffer.isView(body) &&
  !(body instanceof FormData) &&
  !(body instanceof URLSearchParams) &&
  !(body instanceof ReadableStream);

export const createClient = <R extends RouteMap<R>>(clientOptions: ClientOptions = {}) => {
  const doFetch = clientOptions.fetch ?? ((request: Request) => globalThis.fetch(request));
  const base = clientOptions.baseURL?.replace(/\/+$/, "") ?? "";

  const url = <P extends keyof R & string>(
    path: P,
    params?: R[P]["params"],
    query?: Query
  ): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) search.append(key, String(item));
      }
    }
    const queryString = search.size > 0 ? `?${search}` : "";
    return `${base}${buildPath(path, params as Record<string, unknown>)}${queryString}`;
  };

  const request = <
    P extends keyof R & string,
    M extends RouteMethods<R[P]["module"]> = DefaultMethod<R[P]["module"]>,
  >(
    path: P,
    ...[options]: OptionsArgs<R[P], M>
  ): Promise<Response> => {
    const { method, params, query, body, headers, ...init } = (options ?? {}) as RequestOptions<
      R[P],
      M
    > & { params?: object };
    const requestHeaders = new Headers(clientOptions.headers);
    new Headers(headers).forEach((value, name) => requestHeaders.set(name, value));
    const json = isJsonBody(body);
    if (json && !requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }
    const target = url(path, params as R[P]["params"], query);
    return Promise.resolve(
      doFetch(
        // Relative URLs resolve against the page in browsers; elsewhere a custom `fetch` sees localhost.
        new Request(
          new URL(
            target,
            (globalThis as { location?: { href: string } }).location?.href ?? "http://localhost"
          ),
          {
            ...init,
            method: method ?? "GET",
            headers: requestHeaders,
            body: json ? JSON.stringify(body) : (body as BodyInit | undefined),
          }
        )
      )
    );
  };

  /** Sends a request and parses the JSON response; throws {@link HTTPError} on non-2xx. */
  const json = async <
    P extends keyof R & string,
    M extends RouteMethods<R[P]["module"]> = DefaultMethod<R[P]["module"]>,
  >(
    path: P,
    ...args: OptionsArgs<R[P], M>
  ): Promise<RouteData<R[P]["module"], M>> => {
    const response = await request<P, M>(path, ...args);
    if (!response.ok) throw new HTTPError(response);
    if (response.status === 204) return undefined as RouteData<R[P]["module"], M>;
    return (await response.json()) as RouteData<R[P]["module"], M>;
  };

  return { url, request, json };
};
