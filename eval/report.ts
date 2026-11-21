/**
 * Summarise eval/results/latest.json into the numbers we show:
 * cut-off rate, capture accuracy by field, reply latency. Writes
 * eval/results/summary.json (used by the web app) and prints a table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RunResult } from "./run.ts";

const dir = resolve(import.meta.dirname, "results");
const { model, at, results } = JSON.parse(readFileSync(resolve(dir, "latest.json"), "utf8")) as {
  model: string; at: string; results: RunResult[];
};

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function summarise(mode: string) {
  const rs = results.filter((r) => r.mode === mode && !r.error);
  const withEntity = rs.filter((r) => r.expect);
  const byField: Record<string, { n: number; correct: number }> = {};
  for (const r of withEntity) {
    const f = (byField[r.field!] ??= { n: 0, correct: 0 });
    f.n++;
    if (r.correct) f.correct++;
  }
  return {
    runs: rs.length,
    cutOffs: rs.filter((r) => r.cutOff).length,
    cutOffRate: pct(rs.filter((r) => r.cutOff).length, rs.length),
    captureAccuracy: pct(withEntity.filter((r) => r.correct).length, withEntity.length),
    captured: withEntity.filter((r) => r.correct).length,
    capturable: withEntity.length,
    byField: Object.fromEntries(Object.entries(byField).map(([k, v]) => [k, { ...v, accuracy: pct(v.correct, v.n) }])),
    medianReplyLatencyMs: median(rs.map((r) => r.replyLatencyMs).filter((x): x is number => x !== null)),
    errors: results.filter((r) => r.mode === mode && r.error).length,
  };
}

const modes = [...new Set(results.map((r) => r.mode))];
const summary = {
  model, at, clips: new Set(results.map((r) => r.id)).size,
  modes: Object.fromEntries(modes.map((m) => [m, summarise(m)])),
  perClip: [...new Set(results.map((r) => r.id))].map((id) => ({
    id,
    expect: results.find((r) => r.id === id)?.expect,
    runs: Object.fromEntries(modes.map((m) => {
      const rs = results.filter((r) => r.id === id && r.mode === m);
      return [m, rs.map((r) => ({ cutOff: r.cutOff, captured: r.captured, correct: r.correct, firstResponseMs: r.firstResponseMs, speechEndMs: r.speechEndMs }))];
    })),
  })),
};
writeFileSync(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2));

console.log(`\n${model} · ${summary.clips} clips · ${at}\n`);
console.log("mode    cut-offs        capture accuracy   median reply latency");
for (const m of modes) {
  const s = summary.modes[m];
  console.log(
    `${m.padEnd(7)} ${`${s.cutOffs}/${s.runs} (${s.cutOffRate}%)`.padEnd(15)} ${`${s.captured}/${s.capturable} (${s.captureAccuracy}%)`.padEnd(18)} ${s.medianReplyLatencyMs ?? "-"} ms${s.errors ? `  (${s.errors} errors)` : ""}`,
  );
}
for (const m of modes) {
  console.log(`\n${m} by field: ` + Object.entries(summary.modes[m].byField).map(([f, v]) => `${f} ${v.correct}/${v.n}`).join(" · "));
}
