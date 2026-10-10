#!/usr/bin/env node
import { Effect } from "effect";
import { discoverRoutes, generateEntry, resolveEntryFile, type Route } from "./index.js";
import { build, context, type Plugin } from "esbuild";
import { watch } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";
import { H3, serve } from "h3";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const usage = [
  "Usage:",
  "  h3leaf build [--routes api] [--base /api] [--entry _leaf] [--out dist/worker.mjs]",
  "  h3leaf dev [--routes api] [--base /api] [--entry _leaf] [--port 3000]",
].join("\n");
const command = args[0];

if (!command || args.includes("--help") || !["build", "dev"].includes(command)) {
  console.log(usage);
  process.exit(args.includes("--help") ? 0 : 1);
}

const routesDirectory = option("--routes") ?? "api";
const base = option("--base");
const entryFile = option("--entry");
const virtualEntry = "virtual:h3leaf/entry";

const prepareEntry = (): Effect.Effect<
  { readonly routes: readonly Route[]; readonly contents: string },
  Error
> => {
  const resolvedRoutes = path.resolve(routesDirectory);
  return Effect.all({
    routes: discoverRoutes(resolvedRoutes),
    resolvedEntry: resolveEntryFile(resolvedRoutes, entryFile),
  }).pipe(
    Effect.map(({ routes, resolvedEntry }) => ({
      routes,
      contents: generateEntry(routes, {
        routesDirectory: resolvedRoutes,
        entryFile: resolvedEntry,
        base,
        importFile: (file) => file.replace(/\\/g, "/"),
      }),
    }))
  );
};

const virtualEntryPlugin = (getContents: () => string): Plugin => ({
  name: "h3leaf-virtual-entry",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^virtual:h3leaf\/entry$/ }, () => ({
      path: virtualEntry,
      namespace: "h3leaf",
    }));
    buildApi.onLoad({ filter: /.*/, namespace: "h3leaf" }, () => ({
      contents: getContents(),
      loader: "ts",
      resolveDir: path.resolve(routesDirectory),
    }));
  },
});

const sharedBundleOptions = {
  entryPoints: [virtualEntry],
  bundle: true,
  format: "esm" as const,
  platform: "neutral" as const,
  target: "es2022",
  legalComments: "none" as const,
};

if (command === "build") {
  const outFile = path.resolve(option("--out") ?? "dist/api.mjs");
  const buildWorker = prepareEntry().pipe(
    Effect.flatMap(({ routes, contents }) =>
      Effect.tryPromise({
        try: async () => {
          await build({
            ...sharedBundleOptions,
            outfile: outFile,
            sourcemap: false,
            plugins: [virtualEntryPlugin(() => contents)],
          });
          return { routes, outFile };
        },
        catch: (cause) =>
          new Error(
            `Unable to bundle worker: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause }
          ),
      })
    )
  );
  Effect.runPromise(buildWorker)
    .then(({ routes, outFile: bundledFile }) =>
      console.log(
        `h3leaf: bundled ${routes.length} route${routes.length === 1 ? "" : "s"} → ${bundledFile}`
      )
    )
    .catch((error) => {
      console.error(`h3leaf: ${error.message}`);
      process.exitCode = 1;
    });
} else {
  const port = Number(option("--port") ?? "3000");
  const bundledWorker = path.join(tmpdir(), `h3leaf-dev-${process.pid}.mjs`);
  let entryContents = "";
  const bundler = await context({
    ...sharedBundleOptions,
    sourcemap: true,
    outfile: bundledWorker,
    plugins: [virtualEntryPlugin(() => entryContents)],
  });
  let activeApp: { fetch(request: Request): Promise<Response> } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reload = async () => {
    try {
      const { routes, contents } = await Effect.runPromise(prepareEntry());
      entryContents = contents;
      await bundler.rebuild();
      const worker = await import(`${pathToFileURL(bundledWorker).href}?v=${Date.now()}`);
      activeApp = worker.app;
      console.log(`h3leaf: reloaded ${routes.length} route${routes.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error(`h3leaf: reload failed; keeping the last working app\n${error}`);
    }
  };

  await reload();
  if (!activeApp) process.exit(1);

  const devApp = new H3().all("/**", (event) =>
    activeApp ? activeApp.fetch(event.req) : new Response("h3leaf is reloading", { status: 503 })
  );
  const listener = serve(devApp, { port });

  const watcher = watch(path.resolve(routesDirectory), { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reload, 60);
  });
  const shutdown = () => {
    watcher.close();
    listener.close();
    void bundler.dispose();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
