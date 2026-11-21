/**
 * Mint a short-lived realtime client secret for the browser, configured for
 * the requested mode. The real API key never leaves the server.
 */
import { sessionConfig, type Mode } from "../harness/session.js";

export async function mintClientSecret(apiKey: string, mode: Mode) {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: sessionConfig(mode) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `client_secrets ${res.status}`);
  return { value: body.value as string, expires_at: body.expires_at as number, mode };
}

export function parseMode(m: unknown): Mode {
  return m === "base" ? "base" : "saboot";
}
