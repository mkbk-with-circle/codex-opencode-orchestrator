#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, ".."));
const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME, ".codex");
const file = path.join(codexHome, "hooks.json");
fs.mkdirSync(codexHome, { recursive: true });
let value = { hooks: {} };
try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
value.hooks ||= {};
value.hooks.PreToolUse ||= [];
value.hooks.PreToolUse = value.hooks.PreToolUse.filter((entry) => entry.description !== "codex-opencode execution authority guard");
value.hooks.PreToolUse.push({
  description: "codex-opencode execution authority guard",
  matcher: ".*",
  hooks: [{ type: "command", command: `node ${JSON.stringify(path.join(root, "scripts", "codex-execution-guard.mjs"))}`, timeout: 5 }],
});
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`已安装 Codex 执行权门禁: ${file}`);
