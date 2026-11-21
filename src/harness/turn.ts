/**
 * End-of-turn judge for Hinglish support calls.
 *
 * Silence-based voice activity detection ends a turn after a fixed pause, and
 * even semantic VAD is tuned on English conversation. Indian callers pause
 * mid-number ("nine eight four... ek second... double one"), trail off with
 * "matlab", "aur", "wo", and correct themselves. Ending the turn there makes the
 * agent interrupt and capture half a number. This judge reads the transcript so
 * far and the field the agent is collecting, and decides whether to answer now
 * or keep listening, with a hard cap so it never waits forever.
 */
import { endsMidNumber, findDigitRuns, tokenize } from "./numbers.js";
import { EXPECTED_LENGTH, type Field } from "./entities.js";

export type TurnDecision =
  | { action: "respond"; reason: string }
  | { action: "wait"; reason: string; holdMs: number };

/**
 * Words a caller trails off on while still mid-thought, in Latin and Devanagari script.
 * Live transcripts of Hindi often come back in Devanagari ("…बंद है और"), so both are needed.
 * Matched on the last one or two words (a regex \b doesn't work for Devanagari).
 */
const HESITATION_WORDS = new Set([
  "ek second", "one second", "ek sec", "one sec", "ek minute", "ek min", "wait", "ruko", "matlab", "aur", "and", "ki", "ke",
  "ka", "ko", "wo", "woh", "toh", "to", "so", "like", "actually", "basically", "haan to", "number hai", "hai na", "that is",
  "it's", "mera", "meri", "my", "yaani", "jaise", "phir", "fir", "uske baad", "but", "lekin", "par",
  "और", "मतलब", "वो", "वह", "तो", "कि", "की", "के", "का", "को", "यानी", "जैसे", "फिर", "मेरा", "मेरी", "लेकिन", "पर",
  "एक सेकंड", "एक मिनट", "रुको", "हाँ तो", "हां तो", "नंबर है", "उसके बाद",
  // "ek second" is often transcribed as "eight second"/"a second": a trailing second/minute means "wait"
  "second", "seconds", "sec", "minute", "minutes", "min", "सेकंड", "मिनट",
]);
const FILLER_SOUND = /^(u+m+|u+h+|h+m+|a+h+|e+r+m*|उम्म+|अं+|हम्म+)$/;
const CORRECTION_WORDS = new Set(["nahi", "nahin", "no", "sorry", "i mean", "galat", "नहीं", "सॉरी", "गलत", "मतलब नहीं"]);

function lastWords(text: string): [string, string] {
  const words = text.toLowerCase().replace(/[.,;:!?…।॥"“”'‘’()\-–—]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  const lastTwo = words.slice(-2).join(" ");
  return [last, lastTwo];
}

function endsWith(text: string, set: Set<string>, sound?: RegExp): boolean {
  const [last, lastTwo] = lastWords(text);
  return set.has(last) || set.has(lastTwo) || (!!sound && sound.test(last));
}

export interface TurnInput {
  /** Everything the caller has said since the agent last spoke. */
  transcript: string;
  /** The field the agent just asked for, if any. */
  expecting?: Field | null;
  /** How long the caller has been silent, in ms. */
  silenceMs: number;
}

export interface TurnConfig {
  /** Longest extra wait for an incomplete number. */
  numberHoldMs: number;
  /** Longest extra wait after a trailing hesitation word. */
  hesitationHoldMs: number;
}

export const DEFAULT_TURN_CONFIG: TurnConfig = { numberHoldMs: 2600, hesitationHoldMs: 1800 };

export function judgeTurn(input: TurnInput, cfg: TurnConfig = DEFAULT_TURN_CONFIG): TurnDecision {
  const text = input.transcript.trim();
  if (!text) return { action: "wait", reason: "nothing heard yet", holdMs: cfg.hesitationHoldMs };

  const expected = input.expecting ? EXPECTED_LENGTH[input.expecting] : undefined;
  if (expected) {
    const runs = findDigitRuns(text);
    const heard = runs.map((r) => r.digits).join("").replace(/^(91|0)(?=\d{10}$)/, "");
    const needDigits = input.expecting === "customer_id" ? 8 : expected;
    // asked for a number, nothing numeric yet ("ID hai TS…", "pin code hai…"): they're about to say it
    if (heard.length === 0 && !/\b(nahi pata|don'?t know|yaad nahi|kyun|why|baad mein|later)\b/i.test(text)) {
      if (input.silenceMs < cfg.hesitationHoldMs)
        return { action: "wait", reason: `asked for ${input.expecting}, no digits yet`, holdMs: cfg.hesitationHoldMs - input.silenceMs };
    }
    if (heard.length > 0 && heard.length < needDigits) {
      if (input.silenceMs < cfg.numberHoldMs)
        return { action: "wait", reason: `number incomplete: ${heard.length} of ${needDigits} digits`, holdMs: cfg.numberHoldMs - input.silenceMs };
      return { action: "respond", reason: `gave up waiting at ${heard.length} of ${needDigits} digits; ask for the rest` };
    }
  }

  if (endsMidNumber(text) && input.silenceMs < cfg.numberHoldMs)
    return { action: "wait", reason: "ended on 'double'/'triple' or a tens word", holdMs: cfg.numberHoldMs - input.silenceMs };

  if (endsWith(text, CORRECTION_WORDS) && input.silenceMs < cfg.numberHoldMs)
    return { action: "wait", reason: "caller is correcting themselves", holdMs: cfg.numberHoldMs - input.silenceMs };

  if (endsWith(text, HESITATION_WORDS, FILLER_SOUND) && input.silenceMs < cfg.hesitationHoldMs)
    return { action: "wait", reason: "trailing hesitation word", holdMs: cfg.hesitationHoldMs - input.silenceMs };

  const words = tokenize(text).filter((t) => t.kind === "word").length;
  return { action: "respond", reason: words <= 2 ? "short complete reply" : "complete" };
}
