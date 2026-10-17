import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boutiqueEnabled, onlineBookingEnabled, transformPublicFile } from "./public-site-boutique.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "apps", "web");
const destination = join(root, "apps", "coat-care", "public");
const excluded = new Set(["README.md", "tools"]);

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// The date of the last commit that changed a page, for the sitemap. Vercel
// clones only the latest commits: a page last changed before them seems to
// date from the oldest one, so its committed date is kept instead.
const shallowCommits = new Set();
try {
  const shallowFile = resolve(root, git("rev-parse", "--git-path", "shallow") || ".git/shallow");
  for (const line of (await readFile(shallowFile, "utf8")).split("\n")) if (line) shallowCommits.add(line.trim());
} catch {
  // A full clone has no shallow commits.
}
function lastChange(name) {
  const [commit, date] = git("log", "-1", "--format=%H %cs", "--", join("apps", "web", name)).split(" ");
  return commit && !shallowCommits.has(commit) ? date : "";
}

await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue;
  const from = join(source, entry.name);
  const to = join(destination, entry.name);
  const transformed = entry.isFile() ? transformPublicFile(entry.name, await readFile(from, "utf8"), process.env, lastChange) : null;
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
if (!onlineBookingEnabled()) console.log("Online reservations are paused (set ONLINE_BOOKING_ENABLED=true to reopen them).");
