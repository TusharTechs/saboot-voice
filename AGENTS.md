# Saboot Voice: setup, launch and use

**Deployed demo:** https://d3521hkpsid6pu.cloudfront.net/?code=5b9529fb
(Access code `5b9529fb`. It is already in the link; the app remembers it. The code only protects the API budget.)

Saboot Voice is a voice harness for Indian support calls. It sits between the caller's audio and a realtime voice model, and it gets phone numbers, customer IDs, pincodes and names right in Hinglish. It also stops the agent cutting callers off while they're still reading out a number.

The app puts the same model, voice and prompt side by side, once as it ships ("Base model") and once behind the harness ("Saboot"). You can hear and score the difference.

## 1. Prerequisites

| Tool | Version |
|---|---|
| Node.js | 22 or newer (tested on 22.23) |
| npm | 10+ (bundled with Node 22) |
| Browser | Chrome or Edge with a microphone, for live calls |
| OpenAI API key | Only for live calls and for re-running the eval (Realtime API access) |

No database. Nothing else to install.

## 2. Environment variables

Copy `.env.example` to `.env`:

| Variable | Required | What |
|---|---|---|
| `OPENAI_API_KEY` | For live calls / eval | Server side only. The browser never sees it. The server mints a 10-minute client secret per call. |
| `DEMO_CODE` | Optional | If set, `POST /api/session` needs header `x-demo-code` (the web app sends `?code=` from its URL). Leave empty locally. |
| `REALTIME_MODEL` | Optional | Default `gpt-realtime-2.1` |
| `TRANSCRIBE_MODEL` | Optional | Default `gpt-4o-transcribe` |
| `API_PORT` | Optional | Local API port, default `8787` |

**Without a key, these still run:**
- the unit tests
- the **"Same recordings, scored"** tab (stored results of 184 recorded runs, every clip playable)

**Live calls without your own key:** use the deployed demo link above.

## 3. Install, seed, start

```bash
cp .env.example .env        # add OPENAI_API_KEY for live calls
npm install
npm test                    # 23 harness unit tests (no key needed)
npm run server              # API on http://localhost:8787  (POST /api/session, GET /api/results, GET /clips/*.wav)
npm run dev                 # web app on http://localhost:5173 (proxies /api and /clips to :8787)
```

Open http://localhost:5173. Run the server and the front end in two terminals.

- **Seed data:** none needed. The caller recordings (`eval/clips/*.wav`, with `labels.json`) and the scored results (`eval/results/summary.json`) are included.
- **Re-running the eval (optional, uses the key, about 20–30 min):**
  - `npm run clips` re-synthesizes the clips.
  - `npm run eval` plays each clip into both configurations twice.
  - `npm run report` writes `eval/results/summary.json`.
  - `npm run eval -- --fill` re-runs only the runs that failed on a flaky network.

`npm run typecheck` checks the types. `npm run build` writes the static app to `dist/`.

## 4. Users and logins

There are no accounts. There is one kind of user, **the caller**. The only gate is the access code on the deployed demo, `5b9529fb`, which is already in the link.

## 5. Journeys to try

### A. Live call, harness on (deployed link or localhost)

1. Open the app. The **Live call** tab is selected and **Saboot** mode is on.
2. Optionally pick a voice, then click **Start call** and allow the microphone.
3. The agent greets you in Hinglish, as LineOne Fibre support, and asks for your mobile number.
4. Read a number with a pause in the middle, for example *"nine eight four nine … (pause 1–2 s) … zero double one, three two seven"*.
   - The **Turn decisions** panel shows the pause marked as a *candidate* end of turn, then "keep listening (number incomplete)".
   - The agent waits for the rest.
5. The **Captured details** panel shows `98490 11327`, validated. The agent reads it back digit by digit ("98490 11327"), never in lakhs.
6. Try the hard cases:
   - Hindi digits: *"नौ आठ सात…"*
   - "ek second" mid-number
   - a correction: *"…two three, nahi nahi, two four…"*
   - *"plus nine one"*
   - a trailing *"matlab…"*
   - a pincode, or a customer ID with spelled letters (*"H for Hyderabad"*)
7. Click **End call**. The reply-time meter shows the latency.

### B. Same call, base model (the comparison)

1. Switch to **Base model** and **Start call** again.
2. Read the same number with the same pause. The base model usually jumps in at the pause, and captures whatever it wrote down.

### C. Same recordings, scored (no key, no mic needed)

1. Click the **"Same recordings, scored"** tab.
2. Headline cards: 46 recorded callers played into the same model, once as shipped and once behind the harness.
   - Cut-off mid-sentence: 52.2% → 1.1%.
   - Exact captures: 71.3% → 87.5%.
   - Held-out clips (`x*`, written after tuning) are reported separately.
3. In the per-clip table, press play on any clip. Compare "Should capture" with what each configuration captured.

### Running a live call headless (for automated reviewers)

Chrome can use a recorded clip as its microphone:

```bash
chrome --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --use-file-for-fake-audio-capture=$PWD/eval/clips/m01.wav \
  "https://d3521hkpsid6pu.cloudfront.net/?code=5b9529fb"
```

Then click **Start call**. Clip `m01` is a caller reading 9849011327 with a 1.3 s pause mid-number. Other clips: `m02`–`m10`, `p*` and `c*`; what each should capture is listed in `eval/clips/labels.json`. Chrome loops the file, so the caller repeats.

## 6. What is real, simulated or unfinished

| Part | Status |
|---|---|
| Realtime voice model, transcription, the harness, the end-of-turn judge, digit/entity parsing and validation | **Real**, running live |
| "LineOne Fibre" and its support flow | **Fictional.** The agent collects details and reads them back; there is no back office behind it. |
| Caller recordings in the eval | **Synthetic**: TTS voices styled as Indian callers, with real inserted pauses and mixed background noise. Not real customer calls. |
| Locality ↔ pincode check | Small built-in list of Hyderabad localities (`src/harness/entities.ts`), not a full postal database |
| Phone/telephony (PSTN, SIP) | **Not built.** Calls run in the browser over WebRTC. |
| Demo video | Not included; please use the deployed link or the journeys above. |

## 7. Layout

| Path | What |
|---|---|
| `src/harness/` | `numbers.ts` (spoken digits), `entities.ts` (mobile, pincode, IDs, names), `turn.ts` (end-of-turn judge), `controller.ts` (call controller shared by the app and the eval), `session.ts` (base vs Saboot configs) |
| `src/web/` | Browser app: WebRTC to the realtime model, live turn decisions, captured details, results tab |
| `src/server/` | Key minting: `dev.ts` (local API), `lambda.ts` (AWS Lambda function URL) |
| `eval/` | Caller scenarios, clip synthesis, A/B replay, report, results |
| `deploy/` | AWS deploy (S3 + CloudFront for the app, Lambda for `/api/session`) |
| `docs/Saboot-Voice-slides.pdf` | Slides |
