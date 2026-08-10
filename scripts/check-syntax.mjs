import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const roots = ["src", "public/js", "scripts", "test"];
const files = [];

function collect(path) {
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    if (statSync(child).isDirectory()) collect(child);
    else if (child.endsWith(".js") || child.endsWith(".mjs")) files.push(child);
  }
}

roots.forEach(collect);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax check passed for ${files.length} JavaScript files.`);

