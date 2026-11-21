/**
 * A/B evaluation: play the same caller clips, in real time, into the realtime
 * model twice: once as it ships (base) and once behind the Saboot harness.
 * For each run we record when the agent took the turn and what it captured.
 *
 *   npm run eval                 # all clips, both modes
 *   npm run eval -- --modes saboot --only m01,m02
 *   npm run eval -- --repeat 2   # run each clip twice per mode
 */
import "./env.ts";
import { requireKey } from "./env.ts";
import WebSocket from "ws";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { readWav, RATE } from "./audio.ts";
import { CallController } from "../src/harness/controller.ts";
import { sessionConfig, REALTIME_MODEL, type Mode } from "../src/harness/session.ts";
import type { Scenario } from "./scenarios.ts";

const key = requireKey();
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const modes = (opt("modes") ?? "base,saboot").split(",") as Mode[];
const only = opt("only")?.split(",");
const repeat = Number(opt("repeat") ?? 1);
const parallel = Number(opt("parallel") ?? 4);
const TAIL_MS = 6000; // silence after the caller stops, so both modes get to answer

const clipsDir = resolve(import.meta.dirname, "clips");
const labels: Record<string, Scenario & { speechEndMs: number; pauses: { startMs: number; endMs: number }[] }> = JSON.parse(
  readFileSync(resolve(clipsDir, "labels.json"), "utf8"),
);

export interface RunResult {
  id: string;
  mode: Mode;
  rep: number;
  field: string | null;
  expect?: string;
  speechEndMs: number;
  /** When the agent first took the turn, ms from clip start. */
  firstResponseMs: number | null;
  /** True if the agent took the turn before the caller finished speaking. */
  cutOff: boolean;
  /** Agent's first turn after the caller finished, minus speech end. */
  replyLatencyMs: number | null;
  captured?: string;
  correct?: boolean;
  transcripts: string[];
  timeline: { t: number; kind: string; text: string }[];
  error?: string;
}

function runOne(s: (typeof labels)[string], mode: Mode, rep: number): Promise<RunResult> {
  return new Promise((done) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const pcm = readWav(resolve(clipsDir, `${s.id}.wav`));
    const transcripts: string[] = [];
    let start = 0;
    let firstResponseMs: number | null = null;
    let replyAfterEnd: number | null = null;
    let finished = false;
    const send = (e: Record<string, unknown>) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(e));
    const ctl = new CallController(mode, send, {
      onUserText: (t, final) => final && t && transcripts.push(t),
    });

    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      ws.close();
      const cap = s.field ? ctl.captures.get(s.field) : undefined;
      const captured = cap?.value;
      const norm = (v?: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      done({
        id: s.id, mode, rep, field: s.field, expect: s.expect, speechEndMs: s.speechEndMs,
        firstResponseMs, cutOff: firstResponseMs !== null && firstResponseMs < s.speechEndMs - 150,
        replyLatencyMs: replyAfterEnd, captured,
        correct: s.expect ? norm(captured) === norm(s.expect) : undefined,
        transcripts, timeline: ctl.timeline, error,
      });
    };
    const timeout = setTimeout(() => finish("timeout"), s.speechEndMs + TAIL_MS + 20000);

    ws.on("open", () => {
      const session = { ...sessionConfig(mode), output_modalities: ["text"] };
      delete (session as any).audio.output;
      send({ type: "session.update", session });
    });
    ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString());
      if (ev.type === "session.updated" && !start) {
        ctl.seedQuestion(s.question, s.field);
        start = Date.now();
        stream();
      }
      if (ev.type === "response.created" && start) {
        const t = Date.now() - start;
        if (firstResponseMs === null) firstResponseMs = t;
        if (replyAfterEnd === null && t >= s.speechEndMs - 150) replyAfterEnd = t - s.speechEndMs;
      }
      if (ev.type === "error" && !/no active response|already has an active response/i.test(ev.error?.message ?? ""))
        console.error(`  ${s.id}/${mode}: ${ev.error?.message}`);
      ctl.handle(ev);
    });
    ws.on("error", (e) => finish(String(e)));

    // stream the clip in 100 ms chunks at real-time pace, then silence
    const CHUNK = RATE / 10;
    const total = pcm.length + Math.round((RATE * TAIL_MS) / 1000);
    let off = 0;
    const stream = () => {
      const tick = () => {
        if (finished) return;
        if (off >= total) {
          setTimeout(() => {
            clearTimeout(timeout);
            finish();
          }, 2500);
          return;
        }
        const chunk = new Int16Array(CHUNK);
        if (off < pcm.length) chunk.set(pcm.subarray(off, Math.min(pcm.length, off + CHUNK)));
        off += CHUNK;
        send({ type: "input_audio_buffer.append", audio: Buffer.from(chunk.buffer).toString("base64") });
        const due = start + (off / RATE) * 1000;
        setTimeout(tick, Math.max(0, due - Date.now()));
      };
      tick();
    };
  });
}

const jobs: [string, Mode, number][] = [];
for (const id of Object.keys(labels)) {
  if (only && !only.includes(id)) continue;
  if (!existsSync(resolve(clipsDir, `${id}.wav`))) continue;
  for (let rep = 0; rep < repeat; rep++) for (const m of modes) jobs.push([id, m, rep]);
}

const results: RunResult[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [id, mode, rep] = jobs[next++];
    const r = await runOne(labels[id], mode, rep);
    results.push(r);
    const status = r.error ? `error: ${r.error}` : `${r.cutOff ? "CUT OFF" : "waited "} captured=${r.captured ?? "-"} ${r.correct === undefined ? "" : r.correct ? "✓" : "✗"}`;
    console.log(`${String(results.length).padStart(3)}/${jobs.length} ${id} ${mode.padEnd(6)} ${status}`);
  }
}
console.log(`model ${REALTIME_MODEL}, ${jobs.length} runs`);
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));

const outDir = resolve(import.meta.dirname, "results");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(resolve(outDir, `run-${stamp}.json`), JSON.stringify({ model: REALTIME_MODEL, results }, null, 2));
writeFileSync(resolve(outDir, "latest.json"), JSON.stringify({ model: REALTIME_MODEL, at: new Date().toISOString(), results }, null, 2));
console.log(`results -> eval/results/latest.json`);
