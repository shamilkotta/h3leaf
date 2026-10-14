#!/usr/bin/env node
import {
  buildWorker,
  parseCliArgs,
  plural,
  startDevServer,
  usage,
  UsageError,
  writeRouteTypes,
} from "./commands.js";

const run = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === "help") return console.log(usage);

  if (args.command === "build") {
    const { routes, outFile } = await buildWorker(args);
    return console.log(`h3leaf: bundled ${plural(routes.length)} → ${outFile}`);
  }

  if (args.command === "types") {
    const { routes, typesFile } = await writeRouteTypes(args);
    return console.log(`h3leaf: wrote types for ${plural(routes.length)} → ${typesFile}`);
  }

  process.setSourceMapsEnabled(true);
  const server = await startDevServer(args);
  console.log(`h3leaf: listening on ${server.url}`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`h3leaf: ${message}${error instanceof UsageError ? `\n\n${usage}` : ""}`);
  process.exitCode = 1;
});
