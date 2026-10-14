import { compileEntry, toImportPath, writeIfChanged, type CompileResult } from "./index.js";
import { build, context, type BuildOptions, type Plugin } from "esbuild";
import { watch } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { H3, serve } from "h3";

export const TARGETS = ["workers", "neutral", "node"] as const;
export type Target = (typeof TARGETS)[number];

export const usage = [
  "Usage:",
  "  h3leaf build [--routes api] [--base /api] [--entry _leaf] [--out dist/api.mjs] [--target workers]",
  "  h3leaf dev [--routes api] [--base /api] [--entry _leaf] [--port 3000] [--target workers]",
  "  h3leaf types [--routes api] [--base /api] [--types .h3leaf/routes.d.ts]",
  "",
  "Shared flags:",
  "  --types <file>   Route map declaration (default .h3leaf/routes.d.ts; --types=false disables)",
  "  --target <name>  workers (default), neutral, or node",
].join("\n");

export type CommandOptions = Readonly<{
  routesDirectory: string;
  base?: string;
  entryFile?: string;
  typesFile?: string;
  target: Target;
}>;

export type CliArgs =
  | { command: "help" }
  | ({ command: "build"; outFile: string } & CommandOptions)
  | ({ command: "dev"; port: number } & CommandOptions)
  | ({ command: "types"; typesFile: string } & CommandOptions);

export class UsageError extends Error {
  override name = "UsageError";
}

/** Parses `h3leaf` arguments relative to `cwd`; throws {@link UsageError} on invalid input. */
export const parseCliArgs = (argv: readonly string[], cwd = process.cwd()): CliArgs => {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        routes: { type: "string", default: "api" },
        base: { type: "string" },
        entry: { type: "string" },
        out: { type: "string", default: "dist/api.mjs" },
        port: { type: "string", default: "3000" },
        types: { type: "string", default: ".h3leaf/routes.d.ts" },
        target: { type: "string", default: "workers" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values: flags, positionals } = parsed;
  const command = positionals[0];
  if (flags.help) return { command: "help" };
  if (command !== "build" && command !== "dev" && command !== "types") {
    throw new UsageError(`Unknown command: ${command ?? "(none)"}`);
  }
  if (!TARGETS.includes(flags.target as Target)) {
    throw new UsageError(`Unknown target: ${flags.target} (expected ${TARGETS.join(", ")})`);
  }
  const options: CommandOptions = {
    routesDirectory: path.resolve(cwd, flags.routes),
    base: flags.base,
    entryFile: flags.entry,
    typesFile: ["", "false"].includes(flags.types) ? undefined : path.resolve(cwd, flags.types),
    target: flags.target as Target,
  };
  if (command === "build") return { command, outFile: path.resolve(cwd, flags.out), ...options };
  if (command === "types") {
    if (!options.typesFile) throw new UsageError("The types command needs a --types path");
    return { command, ...options, typesFile: options.typesFile };
  }

  const port = Number(flags.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid port: ${flags.port}`);
  }
  return { command, port, ...options };
};

export const plural = (count: number) => `${count} route${count === 1 ? "" : "s"}`;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const prepareEntry = async (options: CommandOptions): Promise<CompileResult> => {
  const result = await compileEntry({
    routesDirectory: options.routesDirectory,
    entryFile: options.entryFile,
    base: options.base,
    typesFile: options.typesFile,
    importFile: toImportPath,
  });
  if (options.typesFile && result.types) await writeIfChanged(options.typesFile, result.types);
  return result;
};

const virtualEntry = "virtual:h3leaf/entry";
const virtualEntryPlugin = (routesDirectory: string, getContents: () => string): Plugin => ({
  name: "h3leaf-virtual-entry",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^virtual:h3leaf\/entry$/ }, () => ({
      path: virtualEntry,
      namespace: "h3leaf",
    }));
    buildApi.onLoad({ filter: /.*/, namespace: "h3leaf" }, () => ({
      contents: getContents(),
      loader: "js",
      resolveDir: routesDirectory,
    }));
  },
});

const targetOptions: Record<Target, BuildOptions> = {
  // Matches Wrangler: resolve Workers-specific package builds, leave runtime modules external.
  workers: {
    platform: "neutral",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    external: ["cloudflare:*", "node:*"],
    target: "es2022",
  },
  // `neutral` resolves no package.json main fields by default; fall back like other bundlers.
  neutral: {
    platform: "neutral",
    mainFields: ["module", "main"],
    external: ["node:*"],
    target: "es2022",
  },
  node: { platform: "node", target: "node20" },
};

const bundleOptions = (options: CommandOptions): BuildOptions => ({
  entryPoints: [virtualEntry],
  bundle: true,
  format: "esm",
  legalComments: "none",
  ...targetOptions[options.target],
});

/** Writes the route map declaration without bundling. */
export const writeRouteTypes = async (options: CommandOptions & { typesFile: string }) => {
  const { routes } = await prepareEntry(options);
  return { routes, typesFile: options.typesFile };
};

/** Bundles the routes into a single ESM worker module. */
export const buildWorker = async (options: CommandOptions & { outFile: string }) => {
  const { routes, contents } = await prepareEntry(options);
  await build({
    ...bundleOptions(options),
    outfile: options.outFile,
    logLevel: "silent",
    plugins: [virtualEntryPlugin(options.routesDirectory, () => contents)],
  }).catch((cause: unknown) => {
    throw new Error(`Unable to bundle worker: ${errorMessage(cause)}`, { cause });
  });
  return { routes, outFile: options.outFile };
};

/** Shows wildcard listen addresses (`[::]`, `0.0.0.0`) as `localhost`. */
const displayUrl = (url: string | undefined, port: number) => {
  const parsed = new URL(url ?? `http://localhost:${port}/`);
  if (["[::]", "0.0.0.0"].includes(parsed.hostname)) parsed.hostname = "localhost";
  return parsed.href;
};

type Logger = Pick<Console, "log" | "error">;

export type DevServer = Readonly<{ url: string; close(): Promise<void> }>;

/** Serves the routes locally, rebuilding whenever a bundled file or the route table changes. */
export const startDevServer = async (
  options: CommandOptions & { port: number },
  logger: Logger = console
): Promise<DevServer> => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "h3leaf-dev-"));
  let entryContents = "";
  let routeCount = 0;
  let loadedCode = "";
  let version = 0;
  let activeApp: { fetch(request: Request): Response | Promise<Response> } | undefined;

  // Loads every successful build. esbuild serializes builds on a context, so reloads never overlap.
  const loadWorkerPlugin: Plugin = {
    name: "h3leaf-dev-load",
    setup(buildApi) {
      buildApi.onEnd(async (result) => {
        const code = result.outputFiles?.[0]?.text;
        if (result.errors.length > 0 || !code) {
          logger.error("h3leaf: build failed; keeping the last working app");
          return;
        }
        if (code === loadedCode) return;
        // A fresh file per build defeats module caching without relying on query strings.
        const file = path.join(tempDirectory, `worker-${++version}.mjs`);
        try {
          await writeFile(file, code);
          const worker = await import(pathToFileURL(file).href);
          activeApp = worker.app;
          loadedCode = code;
          logger.log(`h3leaf: loaded ${plural(routeCount)}`);
        } catch (error) {
          logger.error(`h3leaf: reload failed; keeping the last working app\n`, error);
        } finally {
          await rm(file, { force: true });
        }
      });
    },
  };

  const bundler = await context({
    ...bundleOptions(options),
    sourcemap: "inline",
    outfile: path.join(tempDirectory, "worker.mjs"),
    write: false,
    logLevel: "error",
    plugins: [virtualEntryPlugin(options.routesDirectory, () => entryContents), loadWorkerPlugin],
  });

  /** Regenerates the entry module; returns whether the route table changed. */
  const refreshEntry = async () => {
    try {
      const { routes, contents } = await prepareEntry(options);
      routeCount = routes.length;
      if (contents === entryContents) return false;
      entryContents = contents;
      return true;
    } catch (error) {
      logger.error(`h3leaf: ${errorMessage(error)}`);
      return false;
    }
  };
  const rebuild = () => bundler.rebuild().catch(() => undefined);

  if (await refreshEntry()) await rebuild();
  if (!activeApp) {
    await bundler.dispose();
    await rm(tempDirectory, { recursive: true, force: true });
    throw new Error("Unable to start the dev server");
  }

  const devApp = new H3().all("/**", (event) =>
    activeApp ? activeApp.fetch(event.req) : new Response("h3leaf is reloading", { status: 503 })
  );
  const listener = serve(devApp, { port: options.port, silent: true, gracefulShutdown: false });
  await listener.ready();

  // esbuild watches every bundled file (including imports outside the routes directory);
  // the directory watcher picks up added, removed, and renamed route files.
  await bundler.watch();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(options.routesDirectory, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (await refreshEntry()) await rebuild();
    }, 60);
  });

  return {
    url: displayUrl(listener.url, options.port),
    async close() {
      clearTimeout(timer);
      watcher.close();
      await Promise.allSettled([
        listener.close(true),
        bundler.dispose(),
        rm(tempDirectory, { recursive: true, force: true }),
      ]);
    },
  };
};
