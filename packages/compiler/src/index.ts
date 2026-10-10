import { Effect, Data } from "effect";
import path from "node:path";
import { promises as fs } from "node:fs";

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type Route = Readonly<{ file: string; route: string }>;

export class CompileError extends Data.TaggedError("CompileError")<{
  message: string;
  cause?: unknown;
}> {}

const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
const ignored = (name: string) =>
  name.startsWith("_") || name.endsWith(".d.ts") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

const walk = (directory: string): Effect.Effect<readonly string[], CompileError> =>
  Effect.tryPromise({
    try: async () => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map(async (entry) => {
          const candidate = path.join(directory, entry.name);
          if (entry.isDirectory())
            return ignored(entry.name) ? [] : await Effect.runPromise(walk(candidate));
          return entry.isFile() && extensions.has(path.extname(entry.name)) && !ignored(entry.name)
            ? [candidate]
            : [];
        })
      );
      return nested.flat();
    },
    catch: (cause) =>
      new CompileError({ message: `Unable to read routes directory: ${directory}`, cause }),
  });

export const fileToRoute = (routesDirectory: string, file: string): string => {
  const noExtension = path.relative(routesDirectory, file).replace(/\.[^.]+$/, "");
  const segments = noExtension
    .split(path.sep)
    .filter((segment) => segment !== "index" && !/^\(.+\)$/.test(segment));
  const route = segments
    .map((segment) => {
      if (/^\[\[\.\.\.(.+)\]\]$/.test(segment)) return "**";
      if (/^\[\.\.\.(.+)\]$/.test(segment)) return `**:${segment.slice(4, -1)}`;
      if (/^\[\[(.+)\]\]$/.test(segment)) return `:${segment.slice(2, -2)}?`;
      if (/^\[(.+)\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    })
    .join("/");
  return `/${route}`.replace(/\/$/, "") || "/";
};

export const discoverRoutes = (
  routesDirectory: string
): Effect.Effect<readonly Route[], CompileError> =>
  walk(routesDirectory).pipe(
    Effect.map((files) =>
      files
        .map((file) => ({ file, route: fileToRoute(routesDirectory, file) }))
        .toSorted((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file))
    ),
    Effect.flatMap((routes) => {
      const duplicate = routes.find(
        (route, index) => index > 0 && routes[index - 1]?.route === route.route
      );
      return duplicate
        ? Effect.fail(
            new CompileError({
              message: `Two route files resolve to ${duplicate.route}: ${routes
                .filter((r) => r.route === duplicate.route)
                .map((r) => r.file)
                .join(", ")}`,
            })
          )
        : Effect.succeed(routes);
    })
  );

export type EntryFile = string | false | undefined;

/** Resolves an optional root `_leaf` module (or a configured replacement). */
export const resolveEntryFile = (
  routesDirectory: string,
  entryFile: EntryFile = undefined
): Effect.Effect<string | undefined, CompileError> => {
  if (entryFile === false) return Effect.succeed(undefined);

  const requested = entryFile ?? "_leaf";
  const resolved = path.resolve(routesDirectory, requested);
  const directory = path.dirname(resolved);
  const fileName = path.basename(resolved);
  const candidates = extensions.has(path.extname(fileName))
    ? [fileName]
    : [...extensions].map((extension) => `${fileName}${extension}`);

  return Effect.tryPromise({
    try: () => fs.readdir(directory, { withFileTypes: true }),
    catch: (cause) =>
      new CompileError({ message: `Unable to read entry directory: ${directory}`, cause }),
  }).pipe(
    Effect.flatMap((entries) => {
      const matches = entries
        .filter((entry) => entry.isFile() && candidates.includes(entry.name))
        .map((entry) => path.join(directory, entry.name));
      if (matches.length === 0 && entryFile === undefined) return Effect.succeed(undefined);
      if (matches.length === 1) return Effect.succeed(matches[0]);
      return Effect.fail(
        new CompileError({
          message:
            matches.length === 0
              ? `Configured entry file was not found: ${resolved}`
              : `More than one entry file matches ${requested}: ${matches.join(", ")}`,
        })
      );
    })
  );
};

export type GenerateOptions = Readonly<{
  routesDirectory: string;
  sourceFile?: string;
  entryFile?: string;
  base?: string;
  /** Override generated module specifiers (useful for virtual build entries). */
  importFile?: (file: string) => string;
}>;

export const generateEntry = (routes: readonly Route[], options: GenerateOptions): string => {
  const base =
    options.base && options.base !== "/" ? `/${options.base.replace(/^\/+|\/+$/g, "")}` : "";
  const routePath = (route: string) => `${base}${route === "/" ? "" : route}` || "/";
  const importFile = (file: string) =>
    options.importFile?.(file) ??
    path
      .relative(path.dirname(options.sourceFile ?? "entry.ts"), file)
      .replace(/\\/g, "/")
      .replace(/^(?!\.)/, "./");
  const entryImport = options.entryFile
    ? `import * as leafEntry from ${JSON.stringify(importFile(options.entryFile))};\n`
    : "";
  const imports = routes
    .map((route, index) => {
      return `import * as route${index} from ${JSON.stringify(importFile(route.file))};`;
    })
    .join("\n");
  const registrations = routes
    .map(
      (route, index) => `{
  const module = route${index};
  for (const [method, handler] of Object.entries(module)) {
    if (${JSON.stringify(HTTP_METHODS)}.includes(method) && typeof handler === "function") app.on(method, ${JSON.stringify(routePath(route.route))}, handler);
  }
  const fallback = Object.entries(module).find(([name]) => name === "handler")?.[1] ?? Object.entries(module).find(([name]) => name === "default")?.[1];
  if (typeof fallback === "function") app.all(${JSON.stringify(routePath(route.route))}, fallback);
}`
    )
    .join("\n");
  const app = options.entryFile
    ? 'Object.entries(leafEntry).find(([name]) => name === "app")?.[1] ?? Object.entries(leafEntry).find(([name]) => name === "default")?.[1]'
    : "new H3()";
  return `// Generated by h3leaf. Do not edit.\nimport { H3 } from "h3";\n${entryImport}${imports}\n\nexport const app = ${app};\nif (!app || typeof app.on !== "function" || typeof app.all !== "function") throw new TypeError("h3leaf entry must export an H3 app as named app or default export.");\n${registrations}\n\nexport const fetch = app.fetch;\nexport default { fetch };\n`;
};

export type CompileOptions = Readonly<{
  routesDirectory?: string;
  outFile?: string;
  base?: string;
  /** Defaults to `_leaf` in the routes directory; use false to disable discovery. */
  entryFile?: EntryFile;
}>;
export const compile = (
  options: CompileOptions = {}
): Effect.Effect<{ readonly routes: readonly Route[]; readonly outFile: string }, CompileError> => {
  const routesDirectory = path.resolve(options.routesDirectory ?? "api");
  const outFile = path.resolve(options.outFile ?? "dist/worker.ts");
  return Effect.all({
    routes: discoverRoutes(routesDirectory),
    entryFile: resolveEntryFile(routesDirectory, options.entryFile),
  }).pipe(
    Effect.flatMap(({ routes, entryFile }) =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path.dirname(outFile), { recursive: true });
          await fs.writeFile(
            outFile,
            generateEntry(routes, {
              routesDirectory,
              sourceFile: outFile,
              entryFile,
              base: options.base,
            })
          );
          return { routes, outFile };
        },
        catch: (cause) =>
          new CompileError({ message: `Unable to write generated entry: ${outFile}`, cause }),
      })
    )
  );
};
