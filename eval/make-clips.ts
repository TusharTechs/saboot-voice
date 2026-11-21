/**
 * Synthesize the caller clips: each segment is spoken by gpt-4o-mini-tts with an
 * Indian-caller style, real silences are inserted between segments, and
 * background noise is mixed in. Writes eval/clips/<id>.wav and eval/clips/labels.json.
 *
 *   npm run clips            # all scenarios
 *   npm run clips -- m01 c02 # some
 */
import "./env.ts";
import { requireKey } from "./env.ts";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCENARIOS, VOICES } from "./scenarios.ts";
import { addNoise, concat, RATE, silence, writeWav } from "./audio.ts";

const key = requireKey();
const dir = resolve(import.meta.dirname, "clips");
mkdirSync(dir, { recursive: true });

const STYLE =
  "You are a customer calling your internet provider in Hyderabad. Natural Indian accent, casual Hinglish, " +
  "a little hurried. Read numbers and letters one at a time, exactly as written. Do not add words.";

async function tts(text: string, voice: string): Promise<Int16Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: STYLE, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return trim(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)));
}

/** Trim leading/trailing near-silence so our inserted pauses are the real pauses. */
function trim(pcm: Int16Array): Int16Array {
  const thr = 500;
  let a = 0, b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b]) < thr) b--;
  return pcm.slice(Math.max(0, a - 1200), Math.min(pcm.length, b + 1200)); // keep 50 ms
}

const labelsPath = resolve(dir, "labels.json");
const labels: Record<string, unknown> = existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, "utf8")) : {};
const only = process.argv.slice(2);
const todo = SCENARIOS.filter((s) => !only.length || only.includes(s.id));

let i = 0;
for (const s of todo) {
  const voice = VOICES[SCENARIOS.indexOf(s) % VOICES.length];
  const parts: Int16Array[] = [silence(400)];
  const pauses: { startMs: number; endMs: number }[] = [];
  let t = 400;
  for (const [text, pauseMs] of s.segments) {
    const pcm = await tts(text, voice);
    parts.push(pcm);
    t += (pcm.length / RATE) * 1000;
    if (pauseMs) {
      pauses.push({ startMs: Math.round(t), endMs: Math.round(t + pauseMs) });
      parts.push(silence(pauseMs));
      t += pauseMs;
    }
  }
  const speechEndMs = Math.round(t);
  const clip = addNoise(concat(parts), s.snr, SCENARIOS.indexOf(s) + 7);
  writeWav(resolve(dir, `${s.id}.wav`), clip);
  labels[s.id] = { ...s, voice, speechEndMs, pauses, durationMs: Math.round((clip.length / RATE) * 1000) };
  console.log(`${++i}/${todo.length} ${s.id} (${voice}, ${(speechEndMs / 1000).toFixed(1)} s, ${pauses.length} pause${pauses.length === 1 ? "" : "s"})`);
}
writeFileSync(labelsPath, JSON.stringify(labels, null, 2));
console.log(`labels -> ${labelsPath}`);
