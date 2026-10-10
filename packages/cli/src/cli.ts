#!/usr/bin/env node
import { Effect } from "effect";
import { compile } from "@h3leaf/compiler";
import { build } from "esbuild";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const usage = "Usage: h3leaf build [--routes api] [--entry _leaf] [--out dist/worker.mjs]";

if (args[0] !== "build" || args.includes("--help")) {
  console.log(usage);
  process.exit(args.includes("--help") ? 0 : 1);
}

const outFile = path.resolve(option("--out") ?? "dist/worker.mjs");
const generatedEntry = path.resolve(".h3leaf/entry.ts");

const buildWorker = compile({
  routesDirectory: option("--routes") ?? "api",
  entryFile: option("--entry"),
  outFile: generatedEntry,
}).pipe(
  Effect.flatMap(({ routes }) =>
    Effect.tryPromise({
      try: async () => {
        await build({
          entryPoints: [generatedEntry],
          outfile: outFile,
          bundle: true,
          format: "esm",
          platform: "neutral",
          target: "es2022",
          legalComments: "none",
          sourcemap: true,
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
