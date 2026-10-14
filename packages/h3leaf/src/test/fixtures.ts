import { afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true })));
});

/**
 * Writes files into a temporary directory inside the package so fixtures can resolve `h3`
 * from its `node_modules`. Removed after each test.
 */
export const fixture = async (files: Record<string, string>, prefix = "fixture") => {
  const root = await mkdtemp(path.join(process.cwd(), `.h3leaf-${prefix}-`));
  fixtures.push(root);
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }
  return root;
};
