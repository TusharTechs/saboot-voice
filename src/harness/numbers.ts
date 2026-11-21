/**
 * Spoken-number parsing for Indian support calls.
 *
 * Callers read phone numbers, pincodes and IDs digit by digit, in English,
 * Hindi (romanised or Devanagari) or a mix, with fillers, pauses and
 * corrections in between: "nine eight four, ek second... double one, nahi nahi, double seven".
 * Transcription models usually return words, not digits, and drop or merge
 * groups. This module turns that text back into the digits the caller meant.
 */

const STRONG_DIGITS: Record<string, string> = {
  zero: "0", shunya: "0", shoonya: "0", sunya: "0", "शून्य": "0", "ज़ीरो": "0", "जीरो": "0",
  one: "1", "वन": "1",
  two: "2", "दो": "2", "टू": "2",
  three: "3", teen: "3", "तीन": "3", "थ्री": "3",
  four: "4", chaar: "4", "चार": "4", "फोर": "4",
  five: "5", paanch: "5", panch: "5", "पांच": "5", "पाँच": "5", "फाइव": "5",
  six: "6", chhe: "6", chhah: "6", chheh: "6", "छह": "6", "छः": "6", "छे": "6", "सिक्स": "6",
  seven: "7", saat: "7", "सात": "7", "सेवन": "7",
  eight: "8", aath: "8", "आठ": "8", "एट": "8",
  nine: "9", nau: "9", "नौ": "9", "नाइन": "9",
};

/** Words that are digits only when they sit next to other digits ("do" is also "give", "o" is a letter). */
const WEAK_DIGITS: Record<string, string> = {
  o: "0", oh: "0", ek: "1", "एक": "1", do: "2", tin: "3", char: "4", che: "6", chah: "6",
  sat: "7", aat: "8", nao: "9",
};

const TEENS: Record<string, string> = {
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
};
const TENS: Record<string, string> = {
  twenty: "2", thirty: "3", forty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9",
};

const REPEAT: Record<string, number> = {
  double: 2, dabal: 2, dubble: 2, "डबल": 2, triple: 3, tripal: 3, "ट्रिपल": 3,
};

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Tokens that may sit inside a number without ending it. */
const FILLERS = new Set([
  "uh", "um", "umm", "ummm", "hmm", "haan", "han", "ha", "achha", "acha", "matlab", "like",
  "and", "aur", "then", "phir", "fir", "dash", "hyphen", "space", "number", "hai", "is", "toh", "to",
]);

/** Phrases that mean "wait, I'm still talking" and must not be read as digits ("ek second" is not 1). */
const PAUSE_PHRASES = [
  /\b(ek|one)\s+(second|sec|seconds|minute|min)\b/g,
  /\b(hold on|wait|ruko|ruk jao|ruko zara)\b/g,
  /एक\s+(सेकंड|मिनट)/g,
];

/** Self-corrections inside a number: the group just before is replaced by what follows. */
const CORRECTION = /^(nahi|nahin|nai|no|sorry|galat|नहीं|सॉरी)$/;
const CORRECTION_PHRASES = [/\bi mean\b/g, /\bmatlab nahi\b/g, /\bnahi nahi\b/g, /\bno no\b/g];

export type Token = { kind: "word"; text: string } | { kind: "sep" };

export function tokenize(raw: string): Token[] {
  let text = raw.toLowerCase();
  for (const p of PAUSE_PHRASES) text = text.replace(p, " , ");
  for (const p of CORRECTION_PHRASES) text = text.replace(p, " sorry ");
  // Devanagari digits -> ASCII
  text = text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  // split digit strings like "98765" into single tokens per digit later; keep separators
  text = text.replace(/[.,;:!?…—–]+/g, " | ").replace(/[-]/g, " ");
  const out: Token[] = [];
  for (const part of text.split(/\s+/)) {
    if (!part) continue;
    if (part === "|") {
      out.push({ kind: "sep" });
      continue;
    }
    const clean = part.replace(/^['"“”‘’(]+|['"“”‘’)]+$/g, "");
    if (clean) out.push({ kind: "word", text: clean });
  }
  return out;
}

function digitValue(word: string): string | undefined {
  if (/^\d+$/.test(word)) return word;
  if (word in STRONG_DIGITS) return STRONG_DIGITS[word];
  if (word in TEENS) return TEENS[word];
  return undefined;
}

function isNumericWord(word: string): boolean {
  return digitValue(word) !== undefined || word in TENS || word in REPEAT || word in WEAK_DIGITS;
}

export interface DigitRun {
  /** Final digits after corrections. */
  digits: string;
  /** Digit groups as spoken (split at pauses/commas), after corrections. */
  groups: string[];
  /** Number of self-corrections applied. */
  corrections: number;
}

/**
 * Find runs of spoken digits in a transcript. Fillers and pauses inside a run
 * split it into groups but don't end it; any other word does.
 */
export function findDigitRuns(raw: string): DigitRun[] {
  const tokens = tokenize(raw);
  const runs: DigitRun[] = [];
  let groups: string[] = [];
  let current = "";
  let corrections = 0;
  let pendingRepeat = 0;
  let pendingCorrection = false;
  let inRun = false;

  const closeGroup = () => {
    if (current) {
      if (pendingCorrection && groups.length) {
        // replace the last spoken group with the correction
        groups.pop();
        corrections++;
      }
      pendingCorrection = false;
      groups.push(current);
      current = "";
    }
  };
  const closeRun = () => {
    closeGroup();
    if (groups.length) runs.push({ digits: groups.join(""), groups: [...groups], corrections });
    groups = [];
    corrections = 0;
    pendingRepeat = 0;
    pendingCorrection = false;
    inRun = false;
  };
  const emit = (d: string) => {
    if (pendingRepeat) {
      current += d.repeat(pendingRepeat);
      pendingRepeat = 0;
    } else current += d;
    inRun = true;
  };

  const words = tokens;
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (t.kind === "sep") {
      closeGroup();
      continue;
    }
    const w = t.text;
    const v = digitValue(w);
    if (v !== undefined) {
      emit(v);
      continue;
    }
    if (w in TENS) {
      // "ninety eight" -> 98, "ninety" alone -> 90
      const next = words[i + 1];
      const unit = next && next.kind === "word" ? STRONG_DIGITS[next.text] ?? WEAK_DIGITS[next.text] : undefined;
      if (unit && unit !== "0") {
        emit(TENS[w] + unit);
        i++;
      } else emit(TENS[w] + "0");
      continue;
    }
    if (w in REPEAT) {
      pendingRepeat = REPEAT[w];
      inRun = true;
      continue;
    }
    if (w in WEAK_DIGITS) {
      const prev = neighbour(words, i, -1);
      const next = neighbour(words, i, +1);
      if (inRun || (prev && isNumericWord(prev)) || (next && isNumericWord(next))) {
        emit(WEAK_DIGITS[w]);
        continue;
      }
    }
    if (inRun && CORRECTION.test(w)) {
      closeGroup();
      pendingCorrection = true;
      continue;
    }
    if (inRun && FILLERS.has(w)) {
      closeGroup();
      continue;
    }
    if (inRun) closeRun();
  }
  closeRun();
  return runs;
}

function neighbour(tokens: Token[], i: number, dir: 1 | -1): string | undefined {
  for (let j = i + dir; j >= 0 && j < tokens.length; j += dir) {
    const t = tokens[j];
    if (t.kind === "sep") continue;
    if (FILLERS.has(t.text)) continue;
    return t.text;
  }
  return undefined;
}

/** All digits the caller said in this text, joined (most utterances carry one number). */
export function allDigits(raw: string): string {
  return findDigitRuns(raw).map((r) => r.digits).join("");
}

/** True if the text ends while a number is still being spoken ("...double", "...nine eight,"). */
export function endsMidNumber(raw: string): boolean {
  const tokens = tokenize(raw).filter((t) => t.kind === "word") as { kind: "word"; text: string }[];
  const last = tokens[tokens.length - 1]?.text;
  if (!last) return false;
  return last in REPEAT || last in TENS;
}
