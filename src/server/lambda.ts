/**
 * AWS Lambda (function URL) handler for the deployed demo:
 * POST /api/session?mode=base|saboot  -> short-lived realtime client secret.
 * The OpenAI key comes from the OPENAI_API_KEY environment variable of the function.
 */
import { mintClientSecret, parseMode } from "./session.js";

export async function handler(event: any) {
  const path: string = event.rawPath ?? "/";
  const method: string = event.requestContext?.http?.method ?? "GET";
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (method === "POST" && path.endsWith("/api/session")) {
    const code = process.env.DEMO_CODE;
    if (code && event.headers?.["x-demo-code"] !== code)
      return { statusCode: 401, headers, body: JSON.stringify({ error: "access code required" }) };
    try {
      const out = await mintClientSecret(process.env.OPENAI_API_KEY ?? "", parseMode(event.queryStringParameters?.mode));
      return { statusCode: 200, headers, body: JSON.stringify(out) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: (e as Error).message }) };
    }
  }
  return { statusCode: 404, headers, body: "{}" };
}
