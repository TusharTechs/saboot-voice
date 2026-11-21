/**
 * Mint a short-lived realtime client secret for the browser, configured for
 * the requested mode. The real API key never leaves the server.
 */
import { sessionConfig, isVoice, DEFAULT_VOICE, type Mode, type Voice } from "../harness/session.js";

export async function mintClientSecret(apiKey: string, mode: Mode, voice: Voice = DEFAULT_VOICE) {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: sessionConfig(mode, voice) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `client_secrets ${res.status}`);
  return { value: body.value as string, expires_at: body.expires_at as number, mode, voice };
}

export function parseVoice(v: unknown): Voice {
  return isVoice(v) ? v : DEFAULT_VOICE;
}

export function parseMode(m: unknown): Mode {
  return m === "base" ? "base" : "saboot";
}
