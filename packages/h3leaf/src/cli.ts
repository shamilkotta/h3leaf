#!/usr/bin/env node
import { Effect } from "effect";
import { compile } from "./index.js";
import { build, context } from "esbuild";
import { watch } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
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

const bundle = async (entry: string, outFile: string) =>
  build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    legalComments: "none",
    sourcemap: true,
  });

if (command === "build") {
  const outFile = path.resolve(option("--out") ?? "dist/worker.mjs");
  const generatedEntry = path.resolve(".h3leaf/entry.ts");
  const buildWorker = compile({ routesDirectory, base, entryFile, outFile: generatedEntry }).pipe(
    Effect.flatMap(({ routes }) =>
      Effect.tryPromise({
        try: async () => {
          await bundle(generatedEntry, outFile);
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
  const generatedEntry = path.resolve(".h3leaf/dev-entry.ts");
  const bundledWorker = path.resolve(".h3leaf/dev-worker.mjs");
  const bundler = await context({
    entryPoints: [generatedEntry],
    outfile: bundledWorker,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    legalComments: "none",
  });
  let activeApp: { fetch(request: Request): Promise<Response> } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reload = async () => {
    try {
      const { routes } = await Effect.runPromise(
        compile({ routesDirectory, base, entryFile, outFile: generatedEntry })
      );
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
