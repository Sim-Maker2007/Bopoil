import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "apps", "web");
const destination = join(root, "apps", "coat-care", "public");
const excluded = new Set(["README.md", "tools"]);

await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue;
  await cp(join(source, entry.name), join(destination, entry.name), {
    recursive: entry.isDirectory(),
    force: true,
  });
}

console.log("BOPOIL public website synchronized without transforming its HTML, CSS, or layout.");
