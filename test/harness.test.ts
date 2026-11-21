import { test } from "node:test";
import assert from "node:assert/strict";
import { allDigits, findDigitRuns } from "../src/harness/numbers.ts";
import { parseCustomerId, parseMobile, parsePincode, parseLocality, speakDigits } from "../src/harness/entities.ts";
import { judgeTurn } from "../src/harness/turn.ts";

test("English digit words with double/triple", () => {
  assert.equal(allDigits("nine eight four double one three two triple seven"), "9841132777");
});

test("Hinglish digits, romanised and Devanagari", () => {
  assert.equal(allDigits("nau aath chaar, do do, teen saat"), "9842237");
  assert.equal(allDigits("नौ आठ सात छह पांच"), "98765");
  assert.equal(allDigits("९८७६५ ४३२१०"), "9876543210");
});

test("'ek second' is a pause, not the digit 1", () => {
  assert.equal(allDigits("nine eight four, ek second, double one three two"), "98411 32".replace(" ", ""));
});

test("weak digit words only count next to other digits", () => {
  assert.equal(allDigits("haan do minute ruko"), "");
  assert.equal(allDigits("nine do teen"), "923");
});

test("mid-number self-correction replaces the last group", () => {
  const runs = findDigitRuns("nine eight seven six, nahi nahi, nine eight seven five, four three two one zero");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].digits, "987543210");
  assert.equal(runs[0].corrections, 1);
});

test("tens words: ninety eight seventy six", () => {
  assert.equal(allDigits("ninety eight seventy six five four three two one zero"), "9876543210");
});

test("mobile: strips +91, validates length and first digit", () => {
  assert.deepEqual(parseMobile("plus nine one nine eight seven six five four three two one zero").value, "9876543210");
  const short = parseMobile("nine eight seven six five four three two one");
  assert.equal(short.ok, false);
  assert.match(short.problem!, /9 of 10/);
  assert.equal(parseMobile("five eight seven six five four three two one zero").ok, false);
  assert.equal(parseMobile("98765 43210").readback, "98765 43210");
});

test("pincode with locality check", () => {
  const ok = parsePincode("five double zero zero seven two", "Kukatpally");
  assert.equal(ok.value, "500072");
  assert.equal(ok.warning, undefined);
  const mismatch = parsePincode("five zero zero zero three two", "Kukatpally");
  assert.equal(mismatch.ok, true);
  assert.match(mismatch.warning!, /Kukatpally is usually 500072/);
  assert.equal(parsePincode("zero five zero zero seven two").ok, false);
});

test("customer ID with spelled letters", () => {
  const c = parseCustomerId("H for Hyderabad, Y for Yamuna, two zero four eight one seven three three");
  assert.equal(c.value, "HY20481733");
  assert.equal(c.readback, "HY 2048 1733");
  assert.equal(parseCustomerId("aitch why two zero four eight").ok, false);
});

test("locality aliases", () => {
  assert.equal(parseLocality("main kukatpalli mein rehta hoon").value, "Kukatpally");
});

test("speakDigits reads groups digit by digit", () => {
  assert.equal(speakDigits("98765 43210"), "nine eight seven six five, four three two one zero");
});

test("turn judge waits on an incomplete mobile number", () => {
  const d = judgeTurn({ transcript: "haan, nine eight four double one", expecting: "mobile", silenceMs: 400 });
  assert.equal(d.action, "wait");
  assert.match(d.reason, /5 of 10/);
});

test("turn judge responds once the number is complete", () => {
  const d = judgeTurn({ transcript: "nine eight four double one three two seven seven zero", expecting: "mobile", silenceMs: 400 });
  assert.equal(d.action, "respond");
});

test("turn judge gives up after the hold cap", () => {
  const d = judgeTurn({ transcript: "nine eight four", expecting: "mobile", silenceMs: 3000 });
  assert.equal(d.action, "respond");
});

test("turn judge waits after a trailing hesitation", () => {
  assert.equal(judgeTurn({ transcript: "mera internet band hai aur", silenceMs: 400 }).action, "wait");
  assert.equal(judgeTurn({ transcript: "mera internet band hai", silenceMs: 400 }).action, "respond");
  assert.equal(judgeTurn({ transcript: "number hai nine eight double", expecting: null, silenceMs: 400 }).action, "wait");
});
