import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  let sdp: string;
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/sdp") || contentType.includes("text/plain")) {
    sdp = await req.text();
  } else {
    try {
      const body = await req.json();
      sdp = body?.sdp;
    } catch {
      return NextResponse.json(
        { error: "Send SDP as application/sdp, text/plain, or JSON with sdp field" },
        { status: 400 }
      );
    }
  }

  if (!sdp || typeof sdp !== "string") {
    return NextResponse.json(
      { error: "Missing sdp in request body" },
      { status: 400 }
    );
  }

  try {
    const sessionConfig = JSON.stringify({
      type: "realtime",
      model: "gpt-4o-realtime-preview",
    });

    const fd = new FormData();
    fd.set("sdp", sdp);
    fd.set("session", sessionConfig);

    const res = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: fd,
    });

    const responseText = await res.text();
    if (!res.ok) {
      try {
        const data = JSON.parse(responseText);
        return NextResponse.json(data, { status: res.status });
      } catch {
        return NextResponse.json(
          { error: responseText || "OpenAI API error" },
          { status: res.status }
        );
      }
    }

    return NextResponse.json({ sdp: responseText });
  } catch (err) {
    console.error("OpenAI Realtime API error:", err);
    return NextResponse.json(
      { error: "Failed to create Realtime session" },
      { status: 500 }
    );
  }
}
