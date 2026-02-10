import { NextResponse } from "next/server";

const STORED_KEY_NAME = "OPENAI_API_KEY";

const ALLOWED_LANGUAGE_CODES = new Set([
  "ar", "ca", "zh", "hr", "cs", "da", "nl", "en", "fi", "fr", "de", "el", "he", "hi", "hu", "is", "id", "it", "ja", "ko", "ms", "no", "pl", "pt", "ro", "ru", "sr", "sk", "es", "sv", "th", "tr", "uk", "vi",
]);

function getInstructions(langCode: string): string {
  return `You are a translator from the user's language to English. For each response, output ONLY the literal translation of the MOST RECENT phrase (the last thing the user said) into English. One phrase in → one short translation out. Do not combine or summarize multiple phrases.

CRITICAL RULES:
- Translate ONLY the most recent user utterance to English. One response = one phrase translated.
- NEVER invent or guess. Output only the English translation of what was actually said.
- Output ONLY the English translation. No extra words, no added politeness unless it was in the original.`;
}

export async function POST(request: Request) {
  let apiKey: string | undefined;
  let language = "nl";

  try {
    const body = await request.json().catch(() => ({}));
    const bodyKey = typeof body?.api_key === "string" ? body.api_key.trim() : undefined;
    apiKey = bodyKey || process.env[STORED_KEY_NAME];
    const bodyLang = typeof body?.language === "string" ? body.language.trim().toLowerCase() : "";
    if (bodyLang && ALLOWED_LANGUAGE_CODES.has(bodyLang)) language = bodyLang;
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
          instructions: getInstructions(language),
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-transcribe",
                language,
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
