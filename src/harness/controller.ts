/**
 * Call controller: sits between the caller's audio stream and the realtime
 * model, on the browser data channel (live demo) or a WebSocket (evaluation).
 *
 * base   – passes the model's own turn-taking through; accepts captured details as written.
 * saboot – decides when the caller has finished (turn judge), primes transcription,
 *          and parses + validates every captured detail from the caller's own words.
 */
import { judgeTurn, DEFAULT_TURN_CONFIG, type TurnConfig } from "./turn.js";
import { findLocality, parseField, parseLocality, parseName, speakDigits, type Capture, type Field } from "./entities.js";
import { findDigitRuns } from "./numbers.js";
import type { Mode } from "./session.js";

export type ServerEvent = { type: string; [k: string]: any };

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const c of hay) if (c === needle[i]) i++;
  return i === needle.length;
}
export type Send = (event: Record<string, unknown>) => void;

export interface TimelineEntry {
  t: number; // ms since controller start
  kind: "speech_start" | "speech_stop" | "transcript" | "wait" | "respond" | "agent_start" | "agent_text" | "capture" | "error";
  text: string;
}

export interface ControllerHooks {
  onTimeline?: (e: TimelineEntry) => void;
  onCapture?: (c: Capture & { raw: string }) => void;
  onAgentText?: (delta: string, done: boolean) => void;
  onUserText?: (text: string, final: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class CallController {
  readonly mode: Mode;
  expecting: Field | null = null;
  readonly captures = new Map<Field, Capture & { raw: string }>();
  readonly timeline: TimelineEntry[] = [];
  /** Caller text since the agent last took the turn. */
  private turnText = "";
  /** The caller turn the agent is currently answering. */
  private lastTurn = "";
  private lastSpeechStop = 0;
  private speaking = false;
  private responding = false;
  private holdTimer: unknown = null;
  private readonly t0: number;
  private locality?: string;

  constructor(
    mode: Mode,
    private readonly send: Send,
    private readonly hooks: ControllerHooks = {},
    private readonly turnCfg: TurnConfig = DEFAULT_TURN_CONFIG,
  ) {
    this.mode = mode;
    this.t0 = this.now();
  }

  private now() {
    return this.hooks.now ? this.hooks.now() : Date.now();
  }
  private log(kind: TimelineEntry["kind"], text: string) {
    const e = { t: this.now() - this.t0, kind, text };
    this.timeline.push(e);
    this.hooks.onTimeline?.(e);
  }
  private clearHold() {
    if (this.holdTimer !== null) {
      (this.hooks.clearTimer ?? clearTimeout)(this.holdTimer as any);
      this.holdTimer = null;
    }
  }

  /** Seed the conversation as if the agent just asked for a field (used by the evaluation). */
  seedQuestion(question: string, field: Field | null) {
    this.expecting = field;
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "assistant", content: [{ type: "output_text", text: question }] },
    });
  }

  handle(ev: ServerEvent) {
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        this.speaking = true;
        this.clearHold();
        this.log("speech_start", "caller speaking");
        break;
      case "input_audio_buffer.speech_stopped":
        this.speaking = false;
        this.lastSpeechStop = this.now();
        this.log("speech_stop", "pause");
        break;
      case "conversation.item.input_audio_transcription.delta":
        this.hooks.onUserText?.(ev.delta ?? "", false);
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = (ev.transcript ?? "").trim();
        this.log("transcript", text);
        this.hooks.onUserText?.(text, true);
        if (text) this.turnText = (this.turnText + " " + text).trim();
        if (this.mode === "saboot") this.decide();
        break;
      }
      case "response.created":
        this.responding = true;
        // what the caller said up to here is the turn the agent is answering
        if (this.turnText) {
          this.lastTurn = this.turnText;
          this.turnText = "";
        }
        this.log("agent_start", this.mode === "base" ? "model took the turn" : "agent answering");
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
        this.hooks.onAgentText?.(ev.delta ?? "", false);
        break;
      case "response.output_audio_transcript.done":
      case "response.output_text.done":
        this.hooks.onAgentText?.("", true);
        this.log("agent_text", ev.transcript ?? ev.text ?? "");
        break;
      case "response.function_call_arguments.done":
        this.onTool(ev.name, ev.call_id, ev.arguments);
        break;
      case "response.done":
        this.responding = false;
        if (this.pendingFollowUp) {
          this.pendingFollowUp = false;
          this.send({ type: "response.create" });
        }
        break;
      case "error":
        this.log("error", ev.error?.message ?? "error");
        break;
    }
  }

  private pendingFollowUp = false;

  /** saboot: answer now, or keep listening? */
  private decide() {
    if (this.speaking || this.responding) return;
    const silenceMs = this.now() - this.lastSpeechStop + 350; // VAD already waited 350 ms
    const d = judgeTurn({ transcript: this.turnText, expecting: this.expecting, silenceMs }, this.turnCfg);
    if (d.action === "respond") {
      this.log("respond", d.reason);
      // The caller just answered the detail we asked for: record it before any small talk,
      // so the read-back comes straight away instead of after "let me just check…".
      const gaveDetail = this.expecting && this.turnText && !/\b(nahi pata|yaad nahi|don'?t know|pata nahi|kyun|why)\b|नहीं पता|याद नहीं/i.test(this.turnText);
      this.send(
        gaveDetail
          ? { type: "response.create", response: { tool_choice: { type: "function", name: "record_detail" } } }
          : { type: "response.create" },
      );
      return;
    }
    this.log("wait", d.reason);
    this.clearHold();
    this.holdTimer = (this.hooks.setTimer ?? setTimeout)(() => {
      this.holdTimer = null;
      this.decide();
    }, d.holdMs);
  }

  /** The caller's words for the turn being answered, plus anything said since. */
  private callerWords(): string {
    return [this.lastTurn, this.turnText].filter(Boolean).join(" ").trim();
  }

  private onTool(name: string, callId: string, argsJson: string) {
    let args: any = {};
    try {
      args = JSON.parse(argsJson || "{}");
    } catch {
      /* keep empty */
    }
    let output: Record<string, unknown> = { ok: true };
    if (name === "set_expecting") {
      this.expecting = args.field && args.field !== "none" ? (args.field as Field) : null;
      output = { ok: true };
    } else if (name === "record_detail") {
      const field = args.field as Field;
      const spoken = String(args.spoken ?? "");
      let cap: Capture & { raw: string };
      if (this.mode === "base") {
        // the model's own canonical value is what gets stored (its best effort, no checks)
        const written = String(args.value ?? spoken);
        const value = field === "name" || field === "locality" ? written.trim() : written.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
        cap = { field, ok: true, value, readback: value, raw: spoken };
      } else {
        cap = this.harnessCapture(field, spoken, String(args.value ?? ""));
      }
      this.store(cap);
      output = this.toolOutput(cap);
      // The caller often gives two details in one breath ("Ameerpet, five zero zero zero one six").
      // If the agent recorded one, pick up the other from the same words.
      if (this.mode === "saboot") {
        const also: Record<string, unknown> = {};
        for (const other of ["pincode", "mobile", "customer_id", "locality"] as Field[]) {
          if (other === field || this.captures.get(other)?.ok) continue;
          if (other !== this.expecting && !(field === "locality" && other === "pincode") && !(field === "pincode" && other === "locality")) continue;
          const extra = other === "locality" ? parseLocality(this.callerWords()) : parseField(other, this.callerWords(), { locality: this.locality });
          if (extra.ok && (other !== "locality" || findLocality(this.callerWords()))) {
            const c = { ...extra, raw: this.callerWords() };
            if (other === "locality") this.locality = c.value;
            this.store(c);
            also[other] = this.toolOutput(c);
          }
        }
        if (Object.keys(also).length) output.also_captured = also;
      }
    }
    this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    // a tool call ends the model's response; ask it to continue once that response is done
    this.pendingFollowUp = true;
  }

  /** Harness capture: the caller's own words are the source of truth for numbers; the model's spelling helps for names. */
  private harnessCapture(field: Field, spoken: string, modelValue: string): Capture & { raw: string } {
    const raw = this.callerWords() || spoken;
    if (field === "name") {
      // the model hears the audio and writes names in Latin script; transcripts often come back in Devanagari
      const fromModel = parseName(modelValue || spoken);
      const fromCaller = parseName(raw);
      const latin = (c: Capture) => c.ok && /^[\p{Script=Latin}\s'-]+$/u.test(c.value ?? "");
      return { ...(latin(fromModel) ? fromModel : latin(fromCaller) ? fromCaller : fromModel), raw };
    }
    if (field === "locality") {
      const loc = findLocality(raw) ?? findLocality(modelValue) ?? findLocality(spoken);
      if (loc) {
        this.locality = loc.name;
        return { field, ok: true, value: loc.name, readback: `${loc.name}, ${loc.city}`, raw };
      }
      const v = (modelValue || spoken).trim();
      this.locality = v;
      return { field, ok: !!v, value: v, readback: v, problem: v ? undefined : "no locality heard", raw };
    }
    const fromCaller = parseField(field, raw, { locality: this.locality });
    if (fromCaller.ok) return { ...fromCaller, raw };
    const fromModel = parseField(field, modelValue || spoken, { locality: this.locality });
    // Two hearings: the transcript and the model's own reading of the audio. If the transcript
    // missed a digit or two but everything it did hear appears, in order, in the model's valid
    // value, the two agree and we take the model's. Any disagreement is asked again instead.
    const heard = (fromCaller.heard ?? "").replace(/[^0-9]/g, "");
    const modelDigits = (fromModel.value ?? "").replace(/[^0-9]/g, "");
    const agree =
      heard.length >= 4 &&
      Math.abs(modelDigits.length - heard.length) <= 2 &&
      (isSubsequence(heard, modelDigits) || isSubsequence(modelDigits, heard));
    if (fromModel.ok && agree) return { ...fromModel, raw, warning: "transcript and model differed by a digit or two; matched" };
    if (fromModel.ok && !heard && field !== "customer_id") return { ...fromModel, raw };
    if (field === "customer_id") {
      // letters are where transcripts fail most; digits are where the model fails most
      const letters = (modelValue.match(/^[A-Za-z]{2}/)?.[0] ?? "").toUpperCase();
      const digits = findDigitRuns(raw).map((r) => r.digits).join("");
      if (letters.length === 2 && digits.length === 8)
        return { field, ok: true, value: letters + digits, readback: `${letters} ${digits.slice(0, 4)} ${digits.slice(4)}`, raw };
    }
    return { ...fromCaller, raw };
  }

  private store(cap: Capture & { raw: string }) {
    this.captures.set(cap.field, cap);
    this.hooks.onCapture?.(cap);
    this.log("capture", `${cap.field}: ${cap.ok ? cap.value : "✗ " + cap.problem}`);
  }

  private toolOutput(cap: Capture): Record<string, unknown> {
    return cap.ok
      ? {
          ok: true,
          value: cap.value,
          // digits pre-spaced in their groups ("8 8 0 1 2, 4 5 6 7 9") so they can only be read one by one
          readback: cap.readback && /\d/.test(cap.readback) ? cap.readback.split(" ").map((g) => g.split("").join(" ")).join(", ") : cap.readback,
          say_digits: cap.readback && /\d/.test(cap.readback) ? speakDigits(cap.readback) : undefined,
          warning: cap.warning,
        }
      : { ok: false, problem: cap.problem, heard_so_far: cap.heard };
  }
}
