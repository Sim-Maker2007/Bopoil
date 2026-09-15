import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boutiqueEnabled, transformPublicFile } from "./public-site-boutique.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "apps", "web");
const destination = join(root, "apps", "coat-care", "public");
const excluded = new Set(["README.md", "tools"]);

await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue;
  const from = join(source, entry.name);
  const to = join(destination, entry.name);
  const transformed = entry.isFile() ? transformPublicFile(entry.name, await readFile(from, "utf8")) : null;
  if (transformed !== null) {
    await writeFile(to, transformed);
    continue;
  }
  await cp(from, to, { recursive: entry.isDirectory(), force: true });
}

console.log(
  boutiqueEnabled()
    ? "BOPOIL public website synchronized with the boutique published."
    : "BOPOIL public website synchronized with the boutique hidden (set BOUTIQUE_ENABLED=true to publish it).",
);
