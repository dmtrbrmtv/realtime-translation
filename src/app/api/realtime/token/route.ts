import { NextResponse } from "next/server";

const STORED_KEY_NAME = "OPENAI_API_KEY";

export async function POST(request: Request) {
  let apiKey: string | undefined;

  try {
    const body = await request.json().catch(() => ({}));
    const bodyKey = typeof body?.api_key === "string" ? body.api_key.trim() : undefined;
    apiKey = bodyKey || process.env[STORED_KEY_NAME];
  } catch {
    apiKey = process.env[STORED_KEY_NAME];
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No API key. Add your OpenAI API key in the field below, or set OPENAI_API_KEY on the server.",
      },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 3600 },
        session: {
          type: "realtime",
          model: "gpt-4o-realtime-preview",
          instructions: `You are a Dutch-to-English translator. For each response, output ONLY the literal translation of the MOST RECENT Dutch phrase (the last thing the user said). One phrase in → one short translation out. Do not combine or summarize multiple phrases.

CRITICAL RULES:
- Translate ONLY the most recent user utterance. One response = one phrase translated.
- NEVER invent or guess. If you heard "Groene kraag" output "Green collar", NOT "Good evening". If you heard "Dankuwel" output "Thank you". If you heard "Tot ziens" output "Goodbye". If you heard "Maak een grap" output "Make a joke."
- NEVER output greetings like "Good evening", "Hello", "How are you" unless the user actually said the Dutch equivalent (e.g. "Goedenavond", "Hallo").
- Output ONLY the English translation of what was just said. No extra words, no politeness phrases unless they were in the Dutch.`,
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-transcribe",
                language: "nl",
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json({ value: data.value });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("OpenAI client_secrets error:", err);
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Token request timed out"
        : "Failed to create token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
