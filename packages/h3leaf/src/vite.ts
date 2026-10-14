import {
  compileEntry,
  normalizeBase,
  routeMatcher,
  toImportPath,
  writeIfChanged,
} from "./index.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DevEnvironment, Plugin, ViteDevServer } from "vite";

const environmentName = "h3leaf";
const virtualEntryId = "virtual:h3leaf/worker-entry";
const resolvedVirtualEntryId = `\0${virtualEntryId}`;
// `ssr` is the fallback when another plugin replaces the h3leaf environment with a non-runnable one.
const entryEnvironments = new Set([environmentName, "ssr"]);

export type H3LeafTarget = "workers" | "neutral" | "node";

export type H3LeafPluginOptions = Readonly<{
  routesDir?: string;
  base?: string;
  entryFile?: string | false;
  outFile?: string;
  sourcemap?: boolean;
  target?: H3LeafTarget;
  types?: string | false;
}>;

type WorkerModule = {
  fetch(request: Request): Response | Promise<Response>;
  routes: readonly string[];
};

const targetConditions: Record<H3LeafTarget, string[] | undefined> = {
  workers: ["workerd", "worker", "module", "browser", "development|production"],
  neutral: ["module", "development|production"],
  node: undefined,
};

const toWebRequest = (request: IncomingMessage): Request => {
  const method = request.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request);
  return new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, {
    method,
    headers,
    body,
    duplex: "half",
  } as RequestInit);
};

const sendWebResponse = async (response: ServerResponse, webResponse: Response) => {
  response.statusCode = webResponse.status;
  if (webResponse.statusText) response.statusMessage = webResponse.statusText;
  webResponse.headers.forEach((value, name) => {
    if (name !== "set-cookie") response.setHeader(name, value);
  });
  const cookies = webResponse.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
  if (!webResponse.body) return void response.end();
  await pipeline(Readable.fromWeb(webResponse.body as never), response);
};

const isInside = (directory: string, file: string) => {
  const relative = path.relative(directory, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

type RunnableEnvironment = DevEnvironment & {
  runner: { import(id: string): Promise<unknown>; clearCache(): void };
};
const isRunnable = (environment: DevEnvironment | undefined): environment is RunnableEnvironment =>
  !!environment && "runner" in environment;

/** Loads the generated entry through the h3leaf environment's module runner. */
const loadWorker = async (server: ViteDevServer): Promise<WorkerModule> => {
  const environment = server.environments[environmentName];
  const worker = isRunnable(environment)
    ? await environment.runner.import(virtualEntryId)
    : await server.ssrLoadModule(virtualEntryId);
  return worker as WorkerModule;
};

/** Drops the generated entry everywhere it is cached so the next request rediscovers routes. */
const invalidateEntry = (server: ViteDevServer) => {
  for (const environment of Object.values(server.environments)) {
    const entry = environment.moduleGraph.getModuleById(resolvedVirtualEntryId);
    if (entry) environment.moduleGraph.invalidateModule(entry);
    if (isRunnable(environment)) environment.runner.clearCache();
  }
};

export const h3leaf = (options: H3LeafPluginOptions = {}): Plugin => {
  const base = normalizeBase(options.base);
  let routesDirectory = "";
  let typesFile: string | undefined;
  const matchers = new Map<string, RegExp>();
  const matcher = (route: string) => {
    let compiled = matchers.get(route);
    if (!compiled) matchers.set(route, (compiled = routeMatcher(route)));
    return compiled;
  };

  const compile = async () => {
    const result = await compileEntry({
      routesDirectory,
      entryFile: options.entryFile,
      base: options.base,
      typesFile,
      importFile: toImportPath,
    });
    if (typesFile && result.types) await writeIfChanged(typesFile, result.types);
    return result;
  };

  return {
    name: "h3leaf",
    config(config) {
      const conditions = targetConditions[options.target ?? "workers"];
      return {
        builder: {},
        environments: {
          [environmentName]: {
            consumer: "server",
            resolve: { noExternal: true, ...(conditions && { conditions }) },
            build: {
              outDir: config.build?.outDir ?? "dist",
              emptyOutDir: false,
              sourcemap: options.sourcemap ?? config.build?.sourcemap,
              target: "es2022",
              rollupOptions: {
                input: virtualEntryId,
                external: [/^cloudflare:/],
                output: {
                  entryFileNames: options.outFile ?? `${base.slice(1) || "api"}.mjs`,
                  format: "es",
                },
              },
            },
          },
        },
      };
    },
    configResolved(config) {
      routesDirectory = path.resolve(config.root, options.routesDir ?? "api");
      typesFile =
        options.types === false
          ? undefined
          : path.resolve(config.root, options.types ?? ".h3leaf/routes.d.ts");
    },
    async buildApp(builder) {
      for (const environment of Object.values(builder.environments)) {
        if (!environment.isBuilt) await builder.build(environment);
      }
    },
    resolveId(id) {
      if (id === virtualEntryId && entryEnvironments.has(this.environment.name)) {
        return resolvedVirtualEntryId;
      }
    },
    async load(id) {
      if (id !== resolvedVirtualEntryId || !entryEnvironments.has(this.environment.name)) return;
      return (await compile()).contents;
    },
    configureServer(server) {
      const logError = (error: unknown) =>
        server.config.logger.error(`[h3leaf] ${error instanceof Error ? error.message : error}`, {
          error: error instanceof Error ? error : null,
        });
      // Generate route types up front rather than on the first API request.
      compile().catch(logError);

      for (const event of ["add", "unlink", "addDir", "unlinkDir"] as const) {
        server.watcher.on(event, (file) => {
          if (!isInside(routesDirectory, file)) return;
          invalidateEntry(server);
          compile().catch(logError);
        });
      }

      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0] ?? "/";
        if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return next();
        const handle = async () => {
          const worker = await loadWorker(server);
          if (!base && !worker.routes.some((route) => matcher(route).test(pathname))) {
            return next();
          }
          await sendWebResponse(response, await worker.fetch(toWebRequest(request)));
        };
        handle().catch((error: unknown) => {
          if (response.headersSent) {
            response.destroy(error instanceof Error ? error : undefined);
          } else if (base) {
            next(error);
          } else {
            // Keep the frontend usable while the API is broken.
            logError(error);
            next();
          }
        });
      });
    },
  };
};
