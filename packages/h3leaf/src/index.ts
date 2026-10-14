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

/** Non-`fetch` Worker handlers that `_leaf` may export (`scheduled`, `queue`, …). */
export const WORKER_HANDLERS = ["scheduled", "queue", "email", "tail", "trace"] as const;

export type Route = Readonly<{
  file: string;
  /** h3leaf pattern; `**:name?` marks an optional named catch-all. */
  route: string;
  /** `_middleware` modules that apply to this route, outermost first. */
  middleware: readonly string[];
}>;

export class CompileError extends Error {
  override name = "CompileError";
}

const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
const ignored = (name: string) =>
  name.startsWith("_") || name.endsWith(".d.ts") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
const isModule = (name: string, baseName: string) =>
  extensions.has(path.extname(name)) && path.basename(name, path.extname(name)) === baseName;

/** Normalizes a URL prefix to `/segment` form, or `""` when no prefix applies. */
export const normalizeBase = (base: string | undefined): string => {
  const trimmed = base?.replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
};

export const toImportPath = (file: string): string => file.replace(/\\/g, "/");

const readDirectory = async (directory: string) => {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (cause) {
    throw new CompileError(`Unable to read directory: ${directory}`, { cause });
  }
};

const scanRoutes = async (
  directory: string,
  inherited: readonly string[]
): Promise<{ file: string; middleware: readonly string[] }[]> => {
  const entries = await readDirectory(directory);
  const own = entries.filter((entry) => entry.isFile() && isModule(entry.name, "_middleware"));
  if (own.length > 1) {
    throw new CompileError(
      `More than one middleware module in ${directory}: ${own.map((e) => e.name).join(", ")}`
    );
  }
  const middleware = own[0] ? [...inherited, path.join(directory, own[0].name)] : inherited;
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (ignored(entry.name)) return [];
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return scanRoutes(candidate, middleware);
      return entry.isFile() && extensions.has(path.extname(entry.name))
        ? [{ file: candidate, middleware }]
        : [];
    })
  );
  return nested.flat();
};

export const fileToRoute = (routesDirectory: string, file: string): string => {
  const segments = path
    .relative(routesDirectory, file)
    .replace(/\.[^.]+$/, "")
    .split(path.sep)
    .filter(
      (segment, index, all) =>
        !(segment === "index" && index === all.length - 1) && !/^\(.+\)$/.test(segment)
    );
  const route = segments
    .map((segment) => {
      if (/^\[\[\.\.\.(.+)\]\]$/.test(segment)) return `**:${segment.slice(5, -2)}?`;
      if (/^\[\.\.\.(.+)\]$/.test(segment)) return `**:${segment.slice(4, -1)}`;
      if (/^\[\[(.+)\]\]$/.test(segment)) return `:${segment.slice(2, -2)}?`;
      if (/^\[(.+)\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    })
    .join("/");
  return `/${route}`.replace(/\/$/, "") || "/";
};

/**
 * Expands an h3leaf pattern into the H3 patterns to register. rou3's `**:name` needs at least
 * one segment, so an optional named catch-all also registers its parent path.
 */
export const routePaths = (route: string): string[] => {
  const optionalCatchAll = /^(.*)\/\*\*:([^/]+)\?$/.exec(route);
  if (!optionalCatchAll) return [route];
  const [, parent = "", name] = optionalCatchAll;
  return [parent || "/", `${parent}/**:${name}`];
};

/** Patterns that differ only by param names (`:id` vs `:slug`) match the same URLs. */
const routeShape = (route: string) =>
  route.replace(/\*\*(:[^/]+)?/g, "**").replace(/:[^/?]+/g, ":");

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const discoverRoutes = async (routesDirectory: string): Promise<readonly Route[]> => {
  const routes = (await scanRoutes(routesDirectory, []))
    .map(({ file, middleware }) => ({
      file,
      route: fileToRoute(routesDirectory, file),
      middleware,
    }))
    .toSorted((a, b) => compare(a.route, b.route) || compare(a.file, b.file));

  const byShape = new Map<string, Route[]>();
  for (const route of routes) {
    for (const shape of routePaths(route.route).map(routeShape)) {
      byShape.set(shape, [...(byShape.get(shape) ?? []), route]);
    }
  }
  const conflict = [...byShape.entries()].find(([, group]) => group.length > 1);
  if (conflict) {
    throw new CompileError(
      `Route files resolve to the same path ${conflict[0]}: ${conflict[1].map((r) => r.file).join(", ")}`
    );
  }
  return routes;
};

export type EntryFile = string | false | undefined;

/** Resolves an optional root `_leaf` module (or a configured replacement). */
export const resolveEntryFile = async (
  routesDirectory: string,
  entryFile: EntryFile = undefined
): Promise<string | undefined> => {
  if (entryFile === false) return undefined;

  const requested = entryFile ?? "_leaf";
  const resolved = path.resolve(routesDirectory, requested);
  const directory = path.dirname(resolved);
  const fileName = path.basename(resolved);
  const explicitExtension = extensions.has(path.extname(fileName));
  const matches = (await readDirectory(directory))
    .filter(
      (entry) =>
        entry.isFile() &&
        (explicitExtension ? entry.name === fileName : isModule(entry.name, fileName))
    )
    .map((entry) => path.join(directory, entry.name));

  if (matches.length === 0 && entryFile === undefined) return undefined;
  if (matches.length === 1) return matches[0];
  throw new CompileError(
    matches.length === 0
      ? `Configured entry file was not found: ${resolved}`
      : `More than one entry file matches ${requested}: ${matches.join(", ")}`
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

const relativeImport = (fromFile: string, file: string) =>
  toImportPath(path.relative(path.dirname(fromFile), file)).replace(/^(?!\.)/, "./");

const withBase = (base: string, route: string) => `${base}${route === "/" ? "" : route}` || "/";

export const generateEntry = (routes: readonly Route[], options: GenerateOptions): string => {
  const base = normalizeBase(options.base);
  const importFile = (file: string) =>
    options.importFile?.(file) ?? relativeImport(options.sourceFile ?? "entry.ts", file);
  const middlewareFiles = [...new Set(routes.flatMap((route) => route.middleware))];
  const middlewareIndex = new Map(middlewareFiles.map((file, index) => [file, index]));

  const imports = [
    options.entryFile
      ? `import * as leafEntry from ${JSON.stringify(importFile(options.entryFile))};`
      : 'import { H3 } from "h3";',
    ...middlewareFiles.map(
      (file, index) =>
        `import * as middlewareModule${index} from ${JSON.stringify(importFile(file))};`
    ),
    ...routes.map(
      (route, index) => `import * as route${index} from ${JSON.stringify(importFile(route.file))};`
    ),
  ].join("\n");
  const middleware = middlewareFiles
    .map((_, index) => `const middleware${index} = middlewareOf(middlewareModule${index});`)
    .join("\n");
  const registrations = routes
    .map((route, index) => {
      const paths = routePaths(route.route).map((pattern) => withBase(base, pattern));
      const chain = route.middleware.map((file) => `...middleware${middlewareIndex.get(file)}`);
      return `register(${JSON.stringify(paths)}, route${index}, [${chain.join(", ")}]);`;
    })
    .join("\n");
  const routeList = routes.flatMap((route) =>
    routePaths(route.route).map((pattern) => withBase(base, pattern))
  );
  // Exports are read through helpers so bundlers don't warn about missing named exports.
  const app = options.entryFile ? "entryApp(leafEntry)" : "new H3()";
  const workerHandlers = options.entryFile ? "...workerHandlers(leafEntry), " : "";

  return `// Generated by h3leaf. Do not edit.
${imports}

const entryApp = (module) => module.app ?? module.default;
export const app = ${app};
if (!app || typeof app.on !== "function" || typeof app.all !== "function") throw new TypeError("h3leaf entry must export an H3 app as named app or default export.");

const middlewareOf = (module) => {
  const value = module.middleware ?? module.default;
  return (Array.isArray(value) ? value : [value]).filter((fn) => typeof fn === "function");
};
${middleware}

const methods = new Set(${JSON.stringify(HTTP_METHODS)});
const register = (paths, module, middleware) => {
  const options = middleware.length > 0 ? { middleware } : undefined;
  const fallback = module.handler ?? module.default;
  for (const path of paths) {
    for (const [name, handler] of Object.entries(module)) {
      if (methods.has(name) && typeof handler === "function") app.on(name, path, handler, options);
    }
    if (typeof fallback === "function") app.all(path, fallback, options);
  }
};
${registrations}

/** Registered H3 route patterns, in registration order. */
export const routes = ${JSON.stringify(routeList)};

/** Worker-style entry: exposes Cloudflare \`env\` / \`ctx\` as \`event.runtime.cloudflare\` and wires \`event.waitUntil()\`. */
export const fetch = (request, env, context) => {
  if (typeof context?.waitUntil === "function" && !request.runtime) {
    Object.defineProperties(request, {
      waitUntil: { value: context.waitUntil.bind(context) },
      runtime: { enumerable: true, value: { name: "cloudflare", cloudflare: { env, context } } },
    });
  }
  return app.fetch(request);
};

const workerHandlers = (module) =>
  Object.fromEntries(${JSON.stringify(WORKER_HANDLERS)}.flatMap((name) => typeof module[name] === "function" ? [[name, module[name]]] : []));
export default { ${workerHandlers}fetch };
`;
};

const paramsType = (route: string) => {
  const params = route
    .split("/")
    .flatMap((segment) => {
      const match = /^(?:\*\*)?:(.+?)(\?)?$/.exec(segment);
      return match ? [`${JSON.stringify(match[1])}${match[2] ?? ""}: string`] : [];
    })
    .join("; ");
  return params ? `{ ${params} }` : "{}";
};

/** Maps a source file to the specifier TypeScript resolves back to it (`.ts` → `.js`). */
const typeImport = (fromFile: string, file: string) =>
  relativeImport(fromFile, file).replace(/\.([cm]?)[jt]sx?$/, (_, kind: string) => `.${kind}js`);

/** Generates a route map declaration for `h3leaf/client` and other typed helpers. */
export const generateTypes = (
  routes: readonly Route[],
  options: Readonly<{ typesFile: string; base?: string }>
): string => {
  const base = normalizeBase(options.base);
  const entries = routes
    .map(
      (route) =>
        `  ${JSON.stringify(withBase(base, route.route))}: {\n    params: ${paramsType(route.route)};\n    module: typeof import(${JSON.stringify(typeImport(options.typesFile, route.file))});\n  };`
    )
    .join("\n");
  return `// Generated by h3leaf. Do not edit.
export interface Routes {
${entries}
}
`;
};

export type CompileOptions = Omit<GenerateOptions, "entryFile"> & {
  entryFile?: EntryFile;
  /** Also generate a route map declaration for this file path. */
  typesFile?: string;
};

export type CompileResult = Readonly<{
  routes: readonly Route[];
  contents: string;
  types?: string;
}>;

/** Loads the routes directory and its entry module, then generates the worker entry source. */
export const compileEntry = async (options: CompileOptions): Promise<CompileResult> => {
  const [routes, entryFile] = await Promise.all([
    discoverRoutes(options.routesDirectory),
    resolveEntryFile(options.routesDirectory, options.entryFile),
  ]);
  return {
    routes,
    contents: generateEntry(routes, { ...options, entryFile }),
    types: options.typesFile
      ? generateTypes(routes, { typesFile: options.typesFile, base: options.base })
      : undefined,
  };
};

/** Writes a generated file, skipping the write when contents are unchanged. */
export const writeIfChanged = async (file: string, contents: string): Promise<void> => {
  const current = await fs.readFile(file, "utf8").catch(() => undefined);
  if (current === contents) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds a matcher for registered H3 patterns (`:id`, `:id?`, `**:path`, `**`). */
export const routeMatcher = (pattern: string): RegExp => {
  const source = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "**") return "(?:/.*)?";
      if (segment.startsWith("**:")) return "/.+";
      if (segment.startsWith(":")) return segment.endsWith("?") ? "(?:/[^/]+)?" : "/[^/]+";
      return `/${escapeRegExp(segment)}`;
    })
    .join("");
  return new RegExp(`^${source}/?$`);
};
