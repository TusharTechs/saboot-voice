# Saboot Voice

**A voice harness for Indian support calls.** It gets phone numbers, customer IDs, pincodes and names right in Hinglish, and it doesn't cut callers off while they're still reading out a number.

Built solo for the *Build Challenging: Voice AI for India* track.

## The frustration

Every Indian caller knows this one. You're reading your number to a support bot, you pause to check the last digits, and it jumps in: *"Sorry, I didn't get that."* Or it reads back "nine crore eighty-four lakh…" instead of your number. Or it hears "ek second" as the digit 1.

Realtime voice models decide when you're done talking from silence and English conversational patterns. Indian callers:

- pause mid-number ("nine eight four nine… zero double one…"),
- mix English, Hindi and Devanagari digits ("nau aath", "नौ आठ", "ninety eight"),
- say "double", "triple", "plus nine one", "S for Sita",
- correct themselves ("…two three, nahi nahi, two four"),
- trail off with "matlab", "aur", "wo actually".

## What the harness does

Same realtime model, same voice, same prompt. Saboot sits between the caller's audio and the model:

| | Base model | Saboot harness |
|---|---|---|
| End of turn | Semantic VAD decides | A short VAD pause only marks a *candidate* end. Our turn judge reads the transcript so far and the field being collected, and keeps listening while a number is incomplete, after "double", after a correction or a trailing "aur/matlab", with a hard cap so it never hangs |
| Transcription | Default | Primed for Hinglish digit reading, Indian names and localities |
| Captured details | Whatever the model writes | Parsed from the caller's own words: English/Hindi/Devanagari digits, double/triple, tens ("ninety eight"), +91, spelled letters, mid-number corrections. Validated (10-digit mobile starting 6–9, 6-digit pincode, locality ↔ pincode check, ID format) |
| Read-back | Model's own phrasing | Grouped digit by digit ("98765 43210"), never in lakhs |
| On a bad capture | Stored anyway | A precise follow-up ("I got 9 of 10 digits, could you repeat the last part?") |

## Measured on the same recordings

`eval/` plays the same caller recordings, in real time, into the realtime model twice: once as it ships, once behind the harness. It records when the agent took the turn and what it captured.

Latest run (`gpt-realtime-2.1`, 46 clips, each played twice per configuration):

| | Caller cut off mid-sentence | Details captured exactly right | Median reply after caller stops |
|---|---|---|---|
| Base model, all clips | 50.0% | 73.8% | 932 ms |
| **Saboot, all clips** | **4.3%** | **88.8%** | 1365 ms |
| Base model, 16 held-out clips | 37.5% | 67.9% | 932 ms |
| **Saboot, 16 held-out clips** | **6.3%** | **85.7%** | 1384 ms |

Held-out clips (`x*`) were written after the harness was tuned and never used for tuning. The cost is real: Saboot answers about 0.4 s later once the caller has stopped, because it reads the transcript before deciding. Clips are synthetic (TTS voices with Indian-caller styling, real inserted pauses, mixed background noise); results vary by a few points between runs.

```
npm run clips    # synthesize the caller clips (eval/clips, with labels)
npm run eval     # replay every clip into both configurations
npm run report   # cut-off rate, capture accuracy by field, reply latency
```

Results are written to `eval/results/` and shown in the app's **"Same recordings, scored"** tab, with each clip playable.

## Run it

```
cp .env.example .env    # add OPENAI_API_KEY
npm install
npm test                # harness unit tests
npm run server          # local API (mints short-lived realtime keys)
npm run dev             # web app on http://localhost:5173
```

Deploy to AWS (S3 + CloudFront for the app, Lambda function URL for the key endpoint):

```
./deploy/deploy.sh
```

## Layout

```
src/harness/   numbers.ts (spoken digits), entities.ts (Indian entities), turn.ts (end-of-turn judge),
               controller.ts (call controller, shared by the live app and the eval), session.ts (the two configs)
src/web/       browser app: WebRTC to the realtime model, live turn decisions, captured details, results
src/server/    short-lived key minting (local dev server and AWS Lambda)
eval/          caller scenarios, clip synthesis, A/B replay, report
deploy/        AWS deploy script
```

Slides: `docs/Saboot-Voice-slides.pdf`.

All data is synthetic; "LineOne Fibre" is a fictional provider.
