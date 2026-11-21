/**
 * Caller clips for the A/B evaluation. Each clip is one caller answer, made of
 * spoken segments with real pauses between them (the pauses are where silence-
 * based turn-taking cuts people off). `expect` is what the agent should capture.
 */
import type { Field } from "../src/harness/entities.ts";

export interface Scenario {
  id: string;
  field: Field | null;
  /** What the agent just asked; seeded into the conversation before the clip plays. */
  question: string;
  /** Spoken text and pause in ms after each segment. */
  segments: [string, number][];
  expect?: string;
  /** Background noise level as SNR in dB (lower = noisier). */
  snr: number;
  tag: string;
}

const Q = {
  mobile: "Apna registered mobile number bataiye?",
  customer_id: "Aapka customer ID kya hai? Do letters aur aath digits.",
  pincode: "Aapka area aur pincode bataiye?",
  name: "Aapka poora naam bataiye?",
  problem: "Bataiye, kya problem ho rahi hai?",
};

export const SCENARIOS: Scenario[] = [
  // mobile numbers, with pauses inside the number
  { id: "m01", field: "mobile", question: Q.mobile, segments: [["Haan, mera number hai nine eight four nine", 1300], ["zero double one, three two seven", 0]], expect: "9849011327", snr: 20, tag: "pause" },
  { id: "m02", field: "mobile", question: Q.mobile, segments: [["Number likh lijiye, seven zero three two", 1500], ["ek second", 900], ["six eight, double five, four one", 0]], expect: "7032685541", snr: 12, tag: "ek second" },
  { id: "m03", field: "mobile", question: Q.mobile, segments: [["नौ आठ सात छह पांच", 1200], ["चार तीन दो एक शून्य", 0]], expect: "9876543210", snr: 20, tag: "hindi digits" },
  { id: "m04", field: "mobile", question: Q.mobile, segments: [["ninety eight, fifty two", 1400], ["seventy one, double zero, sixty three", 0]], expect: "9852710063", snr: 15, tag: "pairs" },
  { id: "m05", field: "mobile", question: Q.mobile, segments: [["eight eight zero one, two three", 1000], ["nahi nahi, eight eight zero one, two four", 800], ["five six seven nine", 0]], expect: "8801245679", snr: 15, tag: "correction" },
  { id: "m06", field: "mobile", question: Q.mobile, segments: [["plus nine one", 700], ["nine one double zero", 1100], ["four five six, triple eight", 0]], expect: "9100456888", snr: 10, tag: "+91" },
  { id: "m07", field: "mobile", question: Q.mobile, segments: [["Haan ji, six three zero four", 1600], ["matlab", 600], ["two two nine one eight eight", 0]], expect: "6304229188", snr: 12, tag: "matlab" },
  { id: "m08", field: "mobile", question: Q.mobile, segments: [["Na number andi, nine five five zero", 1300], ["one two, three four, five six", 0]], expect: "9550123456", snr: 15, tag: "pause" },
  { id: "m09", field: "mobile", question: Q.mobile, segments: [["Seven eight double nine", 1400], ["zero, zero, one, four, two, six", 0]], expect: "7899001426", snr: 10, tag: "pause" },
  { id: "m10", field: "mobile", question: Q.mobile, segments: [["nau saat aath, do do", 1200], ["teen chaar, paanch chhe saat", 0]], expect: "9782234567", snr: 15, tag: "hinglish digits" },

  // customer IDs: two letters + eight digits
  { id: "c01", field: "customer_id", question: Q.customer_id, segments: [["Customer ID hai H Y", 900], ["two zero four eight", 1300], ["one seven three three", 0]], expect: "HY20481733", snr: 20, tag: "pause" },
  { id: "c02", field: "customer_id", question: Q.customer_id, segments: [["S for Sita, B for Bombay", 1000], ["five five", 1200], ["zero one two nine four four", 0]], expect: "SB55012944", snr: 12, tag: "spelled letters" },
  { id: "c03", field: "customer_id", question: Q.customer_id, segments: [["K L, seven seven", 1300], ["eight one, double three, nine zero", 0]], expect: "KL77813390", snr: 15, tag: "pause" },
  { id: "c04", field: "customer_id", question: Q.customer_id, segments: [["H for Hyderabad, Y for Yamuna", 1100], ["three nine one zero", 1200], ["zero five eight one", 0]], expect: "HY39100581", snr: 10, tag: "spelled letters" },
  { id: "c05", field: "customer_id", question: Q.customer_id, segments: [["ID hai T S", 800], ["double four, double six", 1300], ["one two three four", 0]], expect: "TS44661234", snr: 15, tag: "double" },
  { id: "c06", field: "customer_id", question: Q.customer_id, segments: [["एच वाई", 900], ["चार चार दो दो", 1200], ["एक एक सात सात", 0]], expect: "HY44221177", snr: 20, tag: "hindi" },

  // locality + pincode
  { id: "p01", field: "pincode", question: Q.pincode, segments: [["Main Kukatpally mein rehta hoon, pincode five zero", 1300], ["zero zero seven two", 0]], expect: "500072", snr: 15, tag: "pause" },
  { id: "p02", field: "pincode", question: Q.pincode, segments: [["Gachibowli, five double zero", 1200], ["zero three two", 0]], expect: "500032", snr: 12, tag: "double" },
  { id: "p03", field: "pincode", question: Q.pincode, segments: [["Madhapur side, pin code hai", 900], ["five zero zero, zero eight one", 0]], expect: "500081", snr: 15, tag: "hesitation" },
  { id: "p04", field: "pincode", question: Q.pincode, segments: [["Ameerpet, pincode five zero zero zero", 1400], ["one six", 0]], expect: "500016", snr: 10, tag: "pause" },
  { id: "p05", field: "pincode", question: Q.pincode, segments: [["Koramangala, five six zero", 1300], ["zero three four", 0]], expect: "560034", snr: 15, tag: "pause" },
  { id: "p06", field: "pincode", question: Q.pincode, segments: [["Uppal, five zero zero", 1200], ["zero three nine", 0]], expect: "500039", snr: 20, tag: "pause" },

  // names
  { id: "n01", field: "name", question: Q.name, segments: [["Mera naam Venkata Ramana Reddy hai", 0]], expect: "Venkata Ramana Reddy", snr: 20, tag: "name" },
  { id: "n02", field: "name", question: Q.name, segments: [["Sravani Kodali", 0]], expect: "Sravani Kodali", snr: 15, tag: "name" },
  { id: "n03", field: "name", question: Q.name, segments: [["Ji, Mohammed Irfan", 0]], expect: "Mohammed Irfan", snr: 12, tag: "name" },
  { id: "n04", field: "name", question: Q.name, segments: [["Lakshmi Prasanna Naidu", 0]], expect: "Lakshmi Prasanna Naidu", snr: 15, tag: "name" },

  // describing the problem, with a trailing hesitation pause (no entity; cut-off only)
  { id: "h01", field: null, question: Q.problem, segments: [["Mera internet kal raat se band hai aur", 1400], ["router pe red light aa rahi hai", 0]], snr: 15, tag: "aur" },
  { id: "h02", field: null, question: Q.problem, segments: [["Bill to maine pay kar diya tha, matlab", 1500], ["phir bhi connection suspend dikha raha hai", 0]], snr: 12, tag: "matlab" },
  { id: "h03", field: null, question: Q.problem, segments: [["Wo actually", 1200], ["do din se speed bahut slow hai", 0]], snr: 15, tag: "wo actually" },
  { id: "h04", field: null, question: Q.problem, segments: [["Haan, ek second", 1600], ["haan, router restart kar diya maine, phir bhi nahi chal raha", 0]], snr: 10, tag: "ek second" },
];

export const VOICES = ["coral", "ash", "sage", "verse", "ballad", "marin", "cedar"];
