/**
 * The two configurations we compare on the same recordings:
 *
 *  base    – the realtime model as it ships: semantic VAD decides when the caller
 *            is done, the model answers automatically, and whatever it writes into
 *            the capture tool is taken as is.
 *  saboot  – the same model and voice, with our harness in front: a short VAD
 *            pause only marks a candidate turn end, our turn judge decides whether
 *            to answer, transcription is primed with Indian names and places, and
 *            every captured detail is parsed and validated before it is accepted.
 */
import { LOCALITIES } from "./entities.js";

export type Mode = "base" | "saboot";

const env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {};
export const REALTIME_MODEL = env.REALTIME_MODEL ?? "gpt-realtime-2.1";
export const TRANSCRIBE_MODEL = env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";
export const VOICES = ["marin", "cedar", "coral", "sage", "shimmer", "verse", "ballad", "ash", "alloy", "echo"] as const;
export type Voice = (typeof VOICES)[number];
export const DEFAULT_VOICE: Voice = "marin";
export const isVoice = (v: unknown): v is Voice => typeof v === "string" && (VOICES as readonly string[]).includes(v);

export const AGENT_INSTRUCTIONS = `You are Saboot, the voice support agent of a fictional Indian broadband provider, "LineOne Fibre".
You are an Indian support agent from Hyderabad. Speak Hindi fluently like a native speaker, and English in your natural
Hindi-influenced Indian English accent.
Language: callers speak Hinglish, so always answer in Hinglish: mostly Hindi, with the everyday English words Indians use
(number, internet, router, customer ID, pincode, complaint). Do not switch to full English sentences, not even for
acknowledgements or filler: say "जी", "ठीक है", "समझ गया". Switch to English only if the caller speaks only English for two turns.
No preambles like "let me check" or "let me note that"; just do it.
Pronounce Hindi words the way a native Hindi speaker says them, not as English words. In your replies, write Hindi words
in Devanagari so they are spoken correctly, e.g. "सही है?" (not "sahi hai"), "ठीक है", "बताइए", "धन्यवाद".
Your job on this call: collect the caller's registered mobile number, customer ID (two letters and eight digits),
their locality and pincode, and their name, one at a time, then confirm the complaint is logged.
Rules:
- Ask for one detail at a time. Before asking, call set_expecting with the field you are about to ask for.
- In record_detail, always write "value" in English (Latin) letters: names and localities spelled the usual English way
  (e.g. "Venkata Ramana Reddy", "Kukatpally"), numbers as digits. Devanagari is only for what you say aloud.
- When the caller gives a detail, call record_detail immediately, before saying anything, with the field and exactly what they said (their words, not your guess). If they gave two details at once, record both.
- If record_detail returns ok:false, ask a precise follow-up in Hindi based on its "problem" (which is written in English for you), e.g. "मुझे 9 digits मिले, आखिरी हिस्सा फिर से बताइए?".
- If it returns ok:true, read the "readback" value back digit by digit in its groups, then ask "सही है?". Just say the digits; never say the word "readback". Never read a number in thousands or lakhs.
- Never invent digits. Never finish a number for the caller.
- Keep replies under 2 sentences.`;

const recordDetail = {
  type: "function",
  name: "record_detail",
  description: "Record a detail the caller just said. Pass their words verbatim; the system parses and validates them.",
  parameters: {
    type: "object",
    properties: {
      field: { type: "string", enum: ["mobile", "customer_id", "locality", "pincode", "name"] },
      spoken: { type: "string", description: "The caller's words for this detail, verbatim" },
      value: {
        type: "string",
        description: "The detail in canonical form: mobile = 10 digits, customer_id = 2 letters + 8 digits, pincode = 6 digits, name/locality as text",
      },
    },
    required: ["field", "spoken", "value"],
  },
} as const;

const setExpecting = {
  type: "function",
  name: "set_expecting",
  description: "Tell the system which detail you are about to ask for.",
  parameters: {
    type: "object",
    properties: { field: { type: "string", enum: ["mobile", "customer_id", "locality", "pincode", "name", "none"] } },
    required: ["field"],
  },
} as const;

export const TRANSCRIPTION_PROMPT =
  "Indian broadband support call in Hinglish (Hindi and English mixed), sometimes Telugu or Tamil words. " +
  "The caller reads phone numbers, pincodes and customer IDs digit by digit, often with pauses, 'double'/'triple', " +
  "and corrections. Write digits exactly as spoken, keep Hindi words in Latin script.";

export const TRANSCRIPTION_KEYWORDS = [
  ...new Set(LOCALITIES.map((l) => l.name)),
  "Hyderabad", "Secunderabad", "Bengaluru", "LineOne", "pincode", "double", "triple",
  "Venkata", "Lakshmi", "Srinivas", "Sravani", "Mohammed", "Irfan", "Reddy", "Rao", "Naidu", "Kodali",
];

export function sessionConfig(mode: Mode, voice: Voice = DEFAULT_VOICE) {
  const base = {
    type: "realtime" as const,
    model: REALTIME_MODEL,
    output_modalities: ["audio"],
    instructions: AGENT_INSTRUCTIONS,
    tools: [recordDetail, setExpecting],
    tool_choice: "auto",
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        transcription: { model: TRANSCRIBE_MODEL } as Record<string, unknown>,
        turn_detection: {} as Record<string, unknown>,
      },
      output: { format: { type: "audio/pcm", rate: 24000 }, voice },
    },
  };
  if (mode === "base") {
    base.audio.input.turn_detection = { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true };
  } else {
    base.audio.input.transcription = { model: TRANSCRIBE_MODEL, prompt: TRANSCRIPTION_PROMPT };
    base.audio.input.turn_detection = {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 350,
      create_response: false,
      interrupt_response: true,
    };
  }
  return base;
}
