"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Segment = {
  id: string;
  text: string;
  isPartial: boolean;
  timestamp?: string;
};

function formatTimestamp(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function extractTextFromObj(obj: unknown): string {
  if (obj == null) return "";
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(extractTextFromObj).join("");
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if ("text" in o && typeof o.text === "string") return o.text;
    if ("transcript" in o && typeof o.transcript === "string") return o.transcript;
    if ("content" in o) return extractTextFromObj(o.content);
    return Object.values(o).map(extractTextFromObj).join("");
  }
  return "";
}

const API_KEY_STORAGE_KEY = "live-translation-openai-api-key";

const SOURCE_LANGUAGES: { code: string; name: string }[] = [
  { code: "nl", name: "Dutch" },
  { code: "sr", name: "Serbian" },
  { code: "de", name: "German" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "uk", name: "Ukrainian" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "cs", name: "Czech" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "sk", name: "Slovak" },
  { code: "hr", name: "Croatian" },
  { code: "ca", name: "Catalan" },
  { code: "is", name: "Icelandic" },
];

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "active" | "error">("idle");
  const [apiKey, setApiKey] = useState("");
  const [saveApiKey, setSaveApiKey] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState("nl");
  const [nlSegments, setNlSegments] = useState<Segment[]>([]);
  const [enSegments, setEnSegments] = useState<Segment[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const sourceLanguageName = SOURCE_LANGUAGES.find((l) => l.code === sourceLanguage)?.name ?? "Source";

  useEffect(() => {
    try {
      const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (stored) setApiKey(stored);
    } catch {
      // ignore
    }
  }, []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nlContainerRef = useRef<HTMLDivElement>(null);
  const enContainerRef = useRef<HTMLDivElement>(null);
  const partialNlByItemRef = useRef<Map<string, string>>(new Map());
  const partialEnByItemRef = useRef<Map<string, string>>(new Map());
  const itemToNlRef = useRef<Map<string, string>>(new Map());
  const itemToEnRef = useRef<Map<string, string>>(new Map());
  const seenIdsRef = useRef<Set<string>>(new Set());

  const sessionStartRef = useRef<number>(0);
  const FETCH_TIMEOUT_MS = 15000;

  const fetchWithTimeout = useCallback(
    (url: string, options: RequestInit & { timeout?: number } = {}) => {
      const { timeout = FETCH_TIMEOUT_MS, ...fetchOptions } = options;
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeout);
      return fetch(url, { ...fetchOptions, signal: ctrl.signal }).finally(() =>
        clearTimeout(id)
      );
    },
    []
  );

  const addSegment = useCallback(
    (
      text: string,
      isPartial: boolean,
      column: "nl" | "en",
      itemRef?: string,
      timestamp?: string
    ) => {
      if (!text.trim()) return;
      const id = itemRef ?? `${column}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const setter = column === "nl" ? setNlSegments : setEnSegments;
      const seen = seenIdsRef.current;
      if (seen.has(id) && !isPartial) return;
      if (!isPartial) seen.add(id);

      const ts = timestamp ?? (!isPartial && sessionStartRef.current ? formatTimestamp(Date.now() - sessionStartRef.current) : undefined);

      setter((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        const seg: Segment = { id, text: text.trim(), isPartial, timestamp: ts };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = seg;
          return next;
        }
        return [...prev, seg];
      });
    },
    []
  );

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        const type = msg.type as string;

        if (type === "conversation.item.input_audio_transcription.delta") {
          const itemRef = msg.item_id as string | undefined;
          const delta = (msg.delta as string) ?? "";
          if (!itemRef || !delta) return;
          partialNlByItemRef.current.set(
            itemRef,
            (partialNlByItemRef.current.get(itemRef) ?? "") + delta
          );
          const partial = partialNlByItemRef.current.get(itemRef) ?? "";
          addSegment(partial, true, "nl", itemRef);
        }

        if (type === "conversation.item.input_audio_transcription.completed") {
          const itemRef = msg.item_id as string | undefined;
          const transcript = (msg.transcript as string) ?? "";
          if (!itemRef) return;
          const final = transcript || (partialNlByItemRef.current.get(itemRef) ?? "");
          partialNlByItemRef.current.delete(itemRef);
          itemToNlRef.current.set(itemRef, final);
          if (final) addSegment(final, false, "nl", itemRef);
          // Request a translation for this phrase so we get one EN segment per NL phrase
          const dc = dcRef.current;
          if (dc?.readyState === "open") {
            dc.send(JSON.stringify({ type: "response.create" }));
          }
        }

        if (type === "response.audio_transcript.delta" || type === "response.output_audio_transcript.delta") {
          const itemRef = msg.item_id as string | undefined;
          const delta = extractTextFromObj(msg.delta);
          if (!itemRef || !delta) return;
          partialEnByItemRef.current.set(
            itemRef,
            (partialEnByItemRef.current.get(itemRef) ?? "") + delta
          );
          const partial = partialEnByItemRef.current.get(itemRef) ?? "";
          addSegment(partial, true, "en", itemRef);
        }

        if (type === "response.audio_transcript.done" || type === "response.output_audio_transcript.done") {
          const itemRef = msg.item_id as string | undefined;
          const transcript = extractTextFromObj(msg.transcript);
          if (!itemRef) return;
          const final = transcript || (partialEnByItemRef.current.get(itemRef) ?? "");
          partialEnByItemRef.current.delete(itemRef);
          itemToEnRef.current.set(itemRef, final);
          if (final) addSegment(final, false, "en", itemRef);
        }

        if (type === "response.content_part.done") {
          const itemRef = msg.item_id as string | undefined;
          const text = extractTextFromObj(msg.part);
          if (!itemRef || !text) return;
          itemToEnRef.current.set(itemRef, text);
          addSegment(text, false, "en", itemRef);
        }

        if (type === "response.output_item.done") {
          const itemRef = msg.item_id as string | undefined;
          const output = msg.output as unknown;
          if (!itemRef) return;
          const text = extractTextFromObj(output);
          if (text) addSegment(text, false, "en", itemRef);
        }


        if (type === "conversation.item.created") {
          const item = msg.item as { id?: string } | undefined;
          const itemRef = item?.id;
          if (itemRef) {
            partialNlByItemRef.current.set(itemRef, "");
            partialEnByItemRef.current.set(itemRef, "");
          }
        }

        if (type === "response.output_item.added") {
          const itemRef = msg.item_id as string | undefined;
          if (itemRef) partialEnByItemRef.current.set(itemRef, "");
        }
      } catch {
        // ignore parse errors
      }
    },
    [addSegment]
  );

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const nl = nlContainerRef.current;
    const en = enContainerRef.current;
    if (nl) nl.scrollTop = nl.scrollHeight;
    if (en) en.scrollTop = en.scrollHeight;
  }, [autoScroll, nlSegments, enSegments]);

  const start = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage(null);
    setNlSegments([]);
    setEnSegments([]);
    partialNlByItemRef.current.clear();
    partialEnByItemRef.current.clear();
    itemToNlRef.current.clear();
    itemToEnRef.current.clear();
    seenIdsRef.current.clear();
    setAutoScroll(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") {
          setStatus("error");
          setErrorMessage("Connection lost. Try again.");
        }
      });

      const dc = pc.createDataChannel("oai-events");
      dc.binaryType = "arraybuffer";
      dc.onmessage = handleMessage;
      dcRef.current = dc;

      pc.addTrack(stream.getTracks()[0], stream);

      const keyToUse = apiKey.trim();
      if (!keyToUse) {
        throw new Error("Enter your OpenAI API key above to start.");
      }
      if (saveApiKey) {
        try {
          localStorage.setItem(API_KEY_STORAGE_KEY, keyToUse);
        } catch {
          // ignore
        }
      }

      const tokenRes = await fetchWithTimeout("/api/realtime/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: keyToUse, language: sourceLanguage }),
        timeout: FETCH_TIMEOUT_MS,
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        const msg =
          typeof tokenData.error === "string"
            ? tokenData.error
            : (tokenData.error as { message?: string })?.message ?? "Failed to get token";
        throw new Error(msg);
      }
      const ephemeralKey = tokenData.value;
      if (!ephemeralKey) throw new Error("No token returned");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("No SDP");

      const callRes = await fetchWithTimeout("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: sdp,
        timeout: FETCH_TIMEOUT_MS,
      });

      const answerSdp = await callRes.text();
      if (!callRes.ok) {
        try {
          const errData = JSON.parse(answerSdp) as { error?: string | { message?: string } };
          const msg =
            typeof errData.error === "string"
              ? errData.error
              : (errData.error as { message?: string })?.message ?? "Session creation failed";
          throw new Error(msg);
        } catch (e) {
          if (e instanceof Error && e.message !== "Session creation failed")
            throw e;
          throw new Error(answerSdp || "Session creation failed");
        }
      }

      const answer = new RTCSessionDescription({
        type: "answer",
        sdp: answerSdp,
      });
      await pc.setRemoteDescription(answer);

      sessionStartRef.current = Date.now();
      pcRef.current = pc;
      setStatus("active");
    } catch (err) {
      setStatus("error");
      if (err instanceof Error) {
        setErrorMessage(err.name === "AbortError" ? "Request timed out. Try again." : err.message);
      } else {
        setErrorMessage("Failed to start");
      }
    }
  }, [handleMessage, fetchWithTimeout, apiKey, saveApiKey, sourceLanguage]);

  const stop = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      dcRef.current?.close();
      dcRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="shrink-0 border-b border-[var(--border)] px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-lg font-medium tracking-tight">
            Live Translation
          </h1>
          {status === "idle" && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:flex-wrap">
                <label className="sr-only" htmlFor="source-language">
                  Source language
                </label>
                <select
                  id="source-language"
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:border-[var(--foreground)] focus:outline-none"
                  aria-label="Source language"
                >
                  {SOURCE_LANGUAGES.map(({ code, name }) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="api-key">
                  OpenAI API key
                </label>
                <input
                  id="api-key"
                  type="password"
                  placeholder="OpenAI API key (sk-...)"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="min-w-[200px] rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--foreground)] focus:outline-none"
                  autoComplete="off"
                />
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={saveApiKey}
                    onChange={(e) => setSaveApiKey(e.target.checked)}
                  />
                  Save on this device
                </label>
              </div>
              <button
                onClick={start}
                className="rounded-lg bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
              >
                Start
              </button>
            </div>
          )}
          {status !== "idle" && (
            <div className="flex items-center gap-3">
            {status === "connecting" && (
              <span className="text-sm text-[var(--text-muted)]">
                Connecting…
              </span>
            )}
            {status === "active" && (
              <button
                onClick={stop}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Stop
              </button>
            )}
            {status === "error" && (
              <>
                <span className="text-sm text-red-600">{errorMessage}</span>
                <button
                  onClick={start}
                  className="rounded-lg bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
                >
                  Retry
                </button>
              </>
            )}
            </div>
          )}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <div className="flex w-full flex-col md:flex-row">
          <section className="flex flex-1 flex-col border-r border-[var(--border)]">
            <div className="shrink-0 border-b border-[var(--border)] px-6 py-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {sourceLanguageName}
              </span>
            </div>
            <div
              ref={nlContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-6 py-6"
            >
              <div className="mx-auto max-w-2xl space-y-4">
                {nlSegments.length === 0 && status === "idle" && (
                  <p className="text-[22px] leading-[1.6] text-[var(--text-muted)]">
                    Press Start to begin. Speak in {sourceLanguageName}.
                  </p>
                )}
                {nlSegments.length === 0 && status === "active" && (
                  <p className="text-[22px] leading-[1.6] text-[var(--text-muted)]">
                    Listening…
                  </p>
                )}
                {nlSegments.map((seg) => (
                  <p
                    key={seg.id}
                    className={`text-[22px] leading-[1.65] ${
                      seg.isPartial
                        ? "text-[var(--text-muted)]"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {seg.timestamp && (
                      <span className="mr-2 text-xs text-[var(--text-muted)]">
                        {seg.timestamp}
                      </span>
                    )}
                    {seg.text}
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section className="flex flex-1 flex-col">
            <div className="shrink-0 border-b border-[var(--border)] px-6 py-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                English
              </span>
            </div>
            <div
              ref={enContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-6 py-6"
            >
              <div className="mx-auto max-w-2xl space-y-4">
                {enSegments.length === 0 && status === "idle" && (
                  <p className="text-[22px] leading-[1.6] text-[var(--text-muted)]">
                    Translation will appear here.
                  </p>
                )}
                {enSegments.length === 0 && status === "active" && (
                  <p className="text-[22px] leading-[1.6] text-[var(--text-muted)]">
                    Translating…
                  </p>
                )}
                {enSegments.map((seg) => (
                  <p
                    key={seg.id}
                    className={`text-[22px] leading-[1.65] ${
                      seg.isPartial
                        ? "text-[var(--text-muted)]"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {seg.timestamp && (
                      <span className="mr-2 text-xs text-[var(--text-muted)]">
                        {seg.timestamp}
                      </span>
                    )}
                    {seg.text}
                  </p>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
