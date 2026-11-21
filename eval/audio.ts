/** Minimal PCM16 / WAV helpers (24 kHz mono, the realtime API's native format). */
import { readFileSync, writeFileSync } from "node:fs";

export const RATE = 24000;

export function silence(ms: number): Int16Array {
  return new Int16Array(Math.round((RATE * ms) / 1000));
}

export function concat(parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function rms(a: Int16Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / Math.max(1, a.length));
}

/** Pink-ish noise (Paul Kellet filter) with a slow fan hum, mixed in at the given SNR. */
export function addNoise(speech: Int16Array, snrDb: number, seed = 1): Int16Array {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const noise = new Float64Array(speech.length);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < noise.length; i++) {
    const w = rand();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    noise[i] = b0 + b1 + b2 + w * 0.1848 + 0.3 * Math.sin((2 * Math.PI * 100 * i) / RATE);
  }
  const voiced = speech.filter((v) => Math.abs(v) > 300);
  const sRms = rms(voiced.length ? voiced : speech);
  let nRms = 0;
  for (const v of noise) nRms += v * v;
  nRms = Math.sqrt(nRms / noise.length);
  const gain = sRms / (nRms * Math.pow(10, snrDb / 20));
  const out = new Int16Array(speech.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(speech[i] + noise[i] * gain)));
  return out;
}

export function writeWav(path: string, pcm: Int16Array) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

/** Read a 24 kHz mono PCM16 WAV (as written above, or recorded by the demo app). */
export function readWav(path: string): Int16Array {
  const buf = readFileSync(path);
  let off = 12;
  let rate = RATE, channels = 1;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
    }
    if (id === "data") {
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size));
      if (rate !== RATE || channels !== 1) throw new Error(`${path}: expected 24 kHz mono, got ${rate} Hz x${channels}`);
      return pcm;
    }
    off += 8 + size;
  }
  throw new Error(`${path}: no data chunk`);
}
