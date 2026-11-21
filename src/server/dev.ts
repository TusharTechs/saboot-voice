/** Local API for `npm run dev`: POST /api/session?mode=base|saboot, GET /api/results. */
import "../../eval/env.ts";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { mintClientSecret, parseMode, parseVoice } from "./session.js";

const PORT = Number(process.env.API_PORT ?? 8787);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/api/session") {
      const code = process.env.DEMO_CODE;
      if (code && req.headers["x-demo-code"] !== code) {
        res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "access code required" }));
        return;
      }
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY missing in .env");
      const out = await mintClientSecret(key, parseMode(url.searchParams.get("mode")), parseVoice(url.searchParams.get("voice")));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/results") {
      const p = resolve(import.meta.dirname, "../../eval/results/summary.json");
      res.writeHead(existsSync(p) ? 200 : 404, { "Content-Type": "application/json" }).end(existsSync(p) ? readFileSync(p) : "{}");
      return;
    }
    const clip = url.pathname.match(/^\/clips\/([a-z0-9-]+\.wav)$/i);
    if (req.method === "GET" && clip) {
      const p = resolve(import.meta.dirname, "../../eval/clips", clip[1]);
      if (existsSync(p)) {
        res.writeHead(200, { "Content-Type": "audio/wav" }).end(readFileSync(p));
        return;
      }
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String((e as Error).message) }));
  }
}).listen(PORT, () => console.log(`api on http://localhost:${PORT}`));
