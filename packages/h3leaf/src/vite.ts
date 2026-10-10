import { Effect } from "effect";
import { discoverRoutes, generateEntry, resolveEntryFile } from "./index.js";
import { Readable } from "node:stream";
import path from "node:path";
import type { Plugin } from "vite";

const environmentName = "h3leaf";
const virtualEntryId = "virtual:h3leaf/worker-entry";
const resolvedVirtualEntryId = `\0${virtualEntryId}`;
const normalizedBase = (base: string | undefined) =>
  base && base !== "/" ? `/${base.replace(/^\/+|\/+$/g, "")}` : undefined;

export type H3LeafPluginOptions = Readonly<{
  routesDir?: string;
  base?: string;
  entryFile?: string | false;
  outFile?: string;
  sourcemap?: boolean;
}>;

export const h3leaf = (options: H3LeafPluginOptions = {}): Plugin => {
  return {
    name: "h3leaf",
    config(config) {
      const outDir = config.build?.outDir ?? "dist";
      return {
        builder: {},
        environments: {
          [environmentName]: {
            consumer: "server",
            resolve: { noExternal: true },
            build: {
              outDir,
              emptyOutDir: false,
              sourcemap: options.sourcemap ?? config.build?.sourcemap,
              target: "es2022",
              rollupOptions: {
                input: virtualEntryId,
                output: { entryFileNames: options.outFile ?? "worker.mjs", format: "es" },
              },
            },
          },
        },
      };
    },
    async buildApp(builder) {
      for (const environment of Object.values(builder.environments)) {
        if (!environment.isBuilt) await builder.build(environment);
      }
    },
    resolveId(id) {
      if (id === virtualEntryId && [environmentName, "ssr"].includes(this.environment.name)) {
        return resolvedVirtualEntryId;
      }
    },
    async load(id) {
      if (
        id !== resolvedVirtualEntryId ||
        ![environmentName, "ssr"].includes(this.environment.name)
      )
        return;
      const routesDirectory = path.resolve(
        this.environment.config.root,
        options.routesDir ?? "api"
      );
      const { routes, entryFile } = await Effect.runPromise(
        Effect.all({
          routes: discoverRoutes(routesDirectory),
          entryFile: resolveEntryFile(routesDirectory, options.entryFile),
        })
      );
      return generateEntry(routes, {
        routesDirectory,
        sourceFile: path.join(this.environment.config.root, ".h3leaf", "entry.ts"),
        entryFile,
        base: options.base,
        importFile: (file) => file.replace(/\\/g, "/"),
      });
    },
    configureServer(server) {
      const base = normalizedBase(options.base);
      if (!base) return;
      server.middlewares.use((request, response, next) => {
        if (request.url !== base && !request.url?.startsWith(`${base}/`)) return next();
        void (async () => {
          try {
            const worker = await server.ssrLoadModule(virtualEntryId);
            const method = request.method ?? "GET";
            const headers = new Headers();
            Object.entries(request.headers).forEach(([name, value]) => {
              if (value !== undefined)
                headers.set(name, Array.isArray(value) ? value.join(", ") : value);
            });
            const body =
              method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request);
            const webRequest = new Request(
              `http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`,
              { method, headers, body, duplex: "half" } as RequestInit
            );
            const webResponse = await worker.fetch(webRequest);
            response.statusCode = webResponse.status;
            webResponse.headers.forEach((value: string, name: string) =>
              response.setHeader(name, value)
            );
            if (!webResponse.body) return response.end();
            Readable.fromWeb(webResponse.body as never).pipe(response);
          } catch (error) {
            next(error);
          }
        })();
      });
    },
  };
};
