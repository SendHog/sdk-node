// Public mirror integrity check. No network, credentials or service source required.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name));
const source = JSON.parse(read("SOURCE.json")),
  pkg = JSON.parse(read("package.json"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
if (
  source.formatVersion !== 1 ||
  source.language !== "node" ||
  source.packageName !== "@sendhog/sdk" ||
  pkg.name !== source.packageName ||
  pkg.version !== source.version ||
  !/^[a-f0-9]{40}$/.test(source.sourceCommit)
)
  throw new Error("Invalid release metadata.");
for (const [name, digest] of Object.entries(source.files)) {
  if (
    path.isAbsolute(name) ||
    name.split("/").some((p) => !p || p === "." || p === "..") ||
    !/^[a-f0-9]{64}$/.test(digest)
  )
    throw new Error("Unsafe source manifest entry.");
  if (hash(read(name)) !== digest)
    throw new Error("Export file changed: " + name);
}
const schema = JSON.parse(read("contract/schema.json")),
  api = JSON.parse(read("contract/api.json")),
  cases = JSON.parse(read("contract/cases.json"));
if (hash(JSON.stringify({ schema, api, cases })) !== source.contractSha256)
  throw new Error("Contract hash mismatch.");
if (existsSync(path.join(root, ".git"))) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const file of tracked)
    if (file !== "SOURCE.json" && !Object.hasOwn(source.files, file))
      throw new Error("Unmanifested tracked file: " + file);
}
console.log(
  `Verified ${Object.keys(source.files).length} exported files; source ${source.sourceCommit}.`,
);
