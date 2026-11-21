/** Load .env without a dependency. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(import.meta.dirname, "..", ".env");
if (existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

export function requireKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("OPENAI_API_KEY is missing. Copy .env.example to .env and add your key.");
    process.exit(1);
  }
  return key;
}
