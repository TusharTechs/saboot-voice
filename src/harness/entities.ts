/**
 * Indian support-call entities: parse, validate and format for read-back.
 * Every check is deterministic so the agent never reads back a number it
 * only half heard.
 */
import { findDigitRuns, tokenize } from "./numbers.js";

export type Field = "mobile" | "pincode" | "customer_id" | "name" | "locality";

export interface Capture {
  field: Field;
  ok: boolean;
  /** Canonical value (digits only for numbers, uppercase for IDs). */
  value?: string;
  /** How the agent should read it back, grouped the way people say it. */
  readback?: string;
  /** Why it failed, phrased so the agent can ask a precise follow-up. */
  problem?: string;
  /** Digits heard so far, for partial numbers. */
  heard?: string;
  /** Non-blocking warnings, e.g. pincode doesn't match the locality. */
  warning?: string;
}

export const EXPECTED_LENGTH: Partial<Record<Field, number>> = { mobile: 10, pincode: 6, customer_id: 10 };

/** Mobile: 10 digits starting 6-9; strips +91 / 91 / leading 0. */
export function parseMobile(text: string): Capture {
  let digits = findDigitRuns(text).map((r) => r.digits).join("");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!digits) return { field: "mobile", ok: false, problem: "no digits heard" };
  if (digits.length < 10)
    return { field: "mobile", ok: false, heard: digits, problem: `only ${digits.length} of 10 digits heard` };
  if (digits.length > 10)
    return { field: "mobile", ok: false, heard: digits, problem: `${digits.length} digits heard, expected 10` };
  if (!/^[6-9]/.test(digits))
    return { field: "mobile", ok: false, heard: digits, problem: `starts with ${digits[0]}; Indian mobile numbers start with 6, 7, 8 or 9` };
  return { field: "mobile", ok: true, value: digits, readback: `${digits.slice(0, 5)} ${digits.slice(5)}` };
}

/** Pincode: 6 digits, first digit 1-9; warns if it doesn't match a known locality. */
export function parsePincode(text: string, locality?: string): Capture {
  const digits = findDigitRuns(text).map((r) => r.digits).join("");
  if (!digits) return { field: "pincode", ok: false, problem: "no digits heard" };
  if (digits.length !== 6)
    return { field: "pincode", ok: false, heard: digits, problem: `${digits.length} digits heard, a pincode has 6` };
  if (digits[0] === "0") return { field: "pincode", ok: false, heard: digits, problem: "pincodes don't start with 0" };
  const cap: Capture = { field: "pincode", ok: true, value: digits, readback: `${digits.slice(0, 3)} ${digits.slice(3)}` };
  const loc = locality ? findLocality(locality) : undefined;
  if (loc && !loc.pincodes.includes(digits)) cap.warning = `${loc.name} is usually ${loc.pincodes.join(" or ")}`;
  return cap;
}

/** Spoken letters: "S", "es", "S for Sita", "B as in Bombay". */
const LETTER_WORDS: Record<string, string> = {
  ay: "A", bee: "B", see: "C", cee: "C", dee: "D", ee: "E", ef: "F", eff: "F", gee: "G", jee: "G",
  aitch: "H", ech: "H", eye: "I", jay: "J", kay: "K", el: "L", em: "M", en: "N", pee: "P", queue: "Q",
  cue: "Q", ar: "R", are: "R", es: "S", ess: "S", tee: "T", you: "U", vee: "V", ex: "X", why: "Y", zed: "Z", zee: "Z",
};

/**
 * Customer ID for the demo ISP: two letters then eight digits, e.g. HY20481733.
 * Letters can be spelled with "for"/"as in" words; digits use the number parser.
 */
export function parseCustomerId(text: string): Capture {
  const words = tokenize(text)
    .filter((t) => t.kind === "word")
    .map((t) => (t as { text: string }).text);
  let letters = "";
  for (let i = 0; i < words.length && letters.length < 2; i++) {
    const w = words[i];
    let letter: string | undefined;
    if (/^[a-z]$/.test(w)) letter = w.toUpperCase();
    else if (w in LETTER_WORDS) letter = LETTER_WORDS[w];
    else if (/^[a-z]{2}$/.test(w) && i + 1 < words.length && /^\d|^(zero|one|two|three|four|five|six|seven|eight|nine)$/.test(words[i + 1]) && letters === "")
      letter = w.toUpperCase(); // "hy 2 0 4..." transcribed as a 2-letter word
    if (letter) {
      letters += letter;
      // skip "for Sita" / "as in Bombay"
      if (words[i + 1] === "for" || (words[i + 1] === "as" && words[i + 2] === "in")) i += words[i + 1] === "for" ? 2 : 3;
    }
  }
  const digits = findDigitRuns(text).map((r) => r.digits).join("");
  const value = (letters + digits).toUpperCase();
  if (letters.length < 2)
    return { field: "customer_id", ok: false, heard: value, problem: "the two letters at the start weren't clear" };
  if (digits.length !== 8)
    return { field: "customer_id", ok: false, heard: value, problem: `${digits.length} of 8 digits heard after the letters` };
  return { field: "customer_id", ok: true, value, readback: `${letters} ${digits.slice(0, 4)} ${digits.slice(4)}` };
}

/**
 * Localities with their usual pincodes, for consistency checks. A starter
 * table for the demo, not a postal database; anything missing is accepted as said.
 */
export const LOCALITIES: { name: string; aliases: string[]; city: string; pincodes: string[] }[] = [
  { name: "Kukatpally", aliases: ["kukatpally", "kukatpalli", "कुकटपल्ली"], city: "Hyderabad", pincodes: ["500072"] },
  { name: "Gachibowli", aliases: ["gachibowli", "gachibouli", "गचीबोवली"], city: "Hyderabad", pincodes: ["500032"] },
  { name: "Madhapur", aliases: ["madhapur", "माधापुर"], city: "Hyderabad", pincodes: ["500081"] },
  { name: "HITEC City", aliases: ["hitec city", "hitech city", "hi-tech city"], city: "Hyderabad", pincodes: ["500081"] },
  { name: "Kondapur", aliases: ["kondapur", "कोंडापुर"], city: "Hyderabad", pincodes: ["500084"] },
  { name: "Ameerpet", aliases: ["ameerpet", "amirpet", "अमीरपेट"], city: "Hyderabad", pincodes: ["500016"] },
  { name: "Begumpet", aliases: ["begumpet", "बेगमपेट"], city: "Hyderabad", pincodes: ["500016"] },
  { name: "Banjara Hills", aliases: ["banjara hills", "बंजारा हिल्स"], city: "Hyderabad", pincodes: ["500034"] },
  { name: "Jubilee Hills", aliases: ["jubilee hills", "जुबली हिल्स"], city: "Hyderabad", pincodes: ["500033"] },
  { name: "Miyapur", aliases: ["miyapur", "मियापुर"], city: "Hyderabad", pincodes: ["500049"] },
  { name: "Secunderabad", aliases: ["secunderabad", "सिकंदराबाद"], city: "Hyderabad", pincodes: ["500003"] },
  { name: "Dilsukhnagar", aliases: ["dilsukhnagar", "dilsukh nagar"], city: "Hyderabad", pincodes: ["500060"] },
  { name: "LB Nagar", aliases: ["lb nagar", "l b nagar", "elbee nagar"], city: "Hyderabad", pincodes: ["500074"] },
  { name: "Uppal", aliases: ["uppal", "उप्पल"], city: "Hyderabad", pincodes: ["500039"] },
  { name: "Koramangala", aliases: ["koramangala", "कोरमंगला"], city: "Bengaluru", pincodes: ["560034"] },
  { name: "Indiranagar", aliases: ["indiranagar", "indira nagar"], city: "Bengaluru", pincodes: ["560038"] },
  { name: "Whitefield", aliases: ["whitefield", "white field"], city: "Bengaluru", pincodes: ["560066"] },
  { name: "Powai", aliases: ["powai", "पवई"], city: "Mumbai", pincodes: ["400076"] },
  { name: "Andheri East", aliases: ["andheri east", "andheri"], city: "Mumbai", pincodes: ["400069"] },
];

export function findLocality(text: string) {
  const t = text.toLowerCase();
  return LOCALITIES.find((l) => l.aliases.some((a) => t.includes(a)));
}

export function parseLocality(text: string): Capture {
  const loc = findLocality(text);
  if (!loc) return { field: "locality", ok: true, value: text.trim(), readback: text.trim(), warning: "not in the locality list; read back as heard" };
  return { field: "locality", ok: true, value: loc.name, readback: `${loc.name}, ${loc.city}` };
}

/** Names are taken as the agent heard them, but always read back and spelled on request. */
export function parseName(text: string): Capture {
  const name = text
    .replace(/\b(mera naam|my name is|naam hai|name is|i am|main)\b/gi, "")
    .replace(/[^\p{L}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { field: "name", ok: false, problem: "no name heard" };
  const value = name.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return { field: "name", ok: true, value, readback: value };
}

export function parseField(field: Field, text: string, context: { locality?: string } = {}): Capture {
  switch (field) {
    case "mobile":
      return parseMobile(text);
    case "pincode":
      return parsePincode(text, context.locality);
    case "customer_id":
      return parseCustomerId(text);
    case "locality":
      return parseLocality(text);
    case "name":
      return parseName(text);
  }
}

/** Speakable read-back: digits as words in groups, so TTS doesn't say "ninety-eight thousand...". */
export function speakDigits(grouped: string): string {
  const names = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return grouped
    .split(" ")
    .map((g) => g.split("").map((c) => (/\d/.test(c) ? names[+c] : c)).join(" "))
    .join(", ");
}
