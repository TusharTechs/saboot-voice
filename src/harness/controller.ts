/**
 * Call controller: sits between the caller's audio stream and the realtime
 * model, on the browser data channel (live demo) or a WebSocket (evaluation).
 *
 * base   – passes the model's own turn-taking through; accepts captured details as written.
 * saboot – decides when the caller has finished (turn judge), primes transcription,
 *          and parses + validates every captured detail from the caller's own words.
 */
import { judgeTurn, DEFAULT_TURN_CONFIG, type TurnConfig } from "./turn.js";
import { parseField, speakDigits, type Capture, type Field } from "./entities.js";
import type { Mode } from "./session.js";

export type ServerEvent = { type: string; [k: string]: any };
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
        // the caller's next words start a new turn once the agent has spoken
        if (ev.response?.status === "completed") this.turnText = "";
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
      this.send({ type: "response.create" });
      return;
    }
    this.log("wait", d.reason);
    this.clearHold();
    this.holdTimer = (this.hooks.setTimer ?? setTimeout)(() => {
      this.holdTimer = null;
      this.decide();
    }, d.holdMs);
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
        // what the model wrote is what gets stored
        const value = field === "name" || field === "locality" ? spoken.trim() : spoken.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
        cap = { field, ok: true, value, readback: value, raw: spoken };
      } else {
        // parse the caller's own transcript first; fall back to the model's copy
        const fromCaller = parseField(field, this.turnText || spoken, { locality: this.locality });
        const fromModel = parseField(field, spoken, { locality: this.locality });
        cap = { ...(fromCaller.ok || !fromModel.ok ? fromCaller : fromModel), raw: this.turnText || spoken };
        if (field === "locality" && cap.ok) this.locality = cap.value;
      }
      this.captures.set(field, cap);
      this.hooks.onCapture?.(cap);
      this.log("capture", `${field}: ${cap.ok ? cap.value : "✗ " + cap.problem}`);
      output = cap.ok
        ? { ok: true, value: cap.value, readback: cap.readback, say_digits: cap.readback && /\d/.test(cap.readback) ? speakDigits(cap.readback) : undefined, warning: cap.warning }
        : { ok: false, problem: cap.problem, heard_so_far: cap.heard };
    }
    this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    // a tool call ends the model's response; ask it to continue once that response is done
    this.pendingFollowUp = true;
  }
}
