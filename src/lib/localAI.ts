// Per-device local AI settings stored in localStorage.
// The cloud path remains default; local AI is opt-in and fully reversible.

export interface LocalAISettings {
  enabled: boolean;
  endpoint: string;
  model: string;
  fallbackToCloud: boolean;
}

const STORAGE_KEY = "rayyan_local_ai_settings";

export const DEFAULT_LOCAL_AI: LocalAISettings = {
  enabled: false,
  endpoint: "http://127.0.0.1:8080",
  model: "qwen2.5-1.5b-q4.gguf",
  fallbackToCloud: true,
};

export function loadLocalAISettings(): LocalAISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LOCAL_AI;
    const parsed = JSON.parse(raw) as Partial<LocalAISettings>;
    return {
      ...DEFAULT_LOCAL_AI,
      ...parsed,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : DEFAULT_LOCAL_AI.endpoint,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_LOCAL_AI.model,
      enabled: parsed.enabled === true,
      fallbackToCloud: parsed.fallbackToCloud !== false,
    };
  } catch {
    return DEFAULT_LOCAL_AI;
  }
}

export function saveLocalAISettings(s: LocalAISettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export type ConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "connected"; model: string; reply: string }
  | { state: "failed"; message: string };

export async function testLocalConnection(
  endpoint: string,
  model: string
): Promise<ConnectionStatus> {
  if (!endpoint.trim()) {
    return { state: "failed", message: "এন্ডপয়েন্ট ঠিকানা খালি। অনুগ্রহ করে ঠিকানা লিখুন (যেমন http://127.0.0.1:8080)।" };
  }
  let url: string;
  try {
    url = new URL(endpoint.trim()).origin;
  } catch {
    return { state: "failed", message: "ঠিকানাটি সঠিক নয়। সঠিক ফরম্যাট: http://127.0.0.1:8080" };
  }

  const pageOrigin = typeof location !== "undefined" ? location.origin : "(unknown)";
  const pageProtocol = typeof location !== "undefined" ? location.protocol : "";
  // In a Capacitor native WebView, location.protocol is "http:" or "https:"
  // depending on androidScheme, AND window.Capacitor.isNative is true.
  // We check both for robustness.
  const isNative =
    pageProtocol === "capacitor:" ||
    (typeof window !== "undefined" && (window as any).Capacitor?.isNative === true);
  const isHttpTarget = url.startsWith("http://");
  const isLoopback = /\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(url);

  // ---- Step 1: GET /v1/models (simple request, no preflight) ----
  // This tests basic reachability. If this fails, the browser is blocking
  // the request before CORS/PNA even matter (mixed content, network, etc).
  let modelsOk = false;
  let modelsError = "";
  let detectedModel = "";
  try {
    const getRes = await fetch(`${url}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    if (getRes.ok) {
      modelsOk = true;
      const md = await getRes.json().catch(() => null);
      const first: any = Array.isArray(md?.data) && md.data[0] ? md.data[0] : null;
      detectedModel = first?.id ?? "";
    } else {
      modelsError = `GET /v1/models → HTTP ${getRes.status} ${getRes.statusText}`;
    }
  } catch (e) {
    modelsError = e instanceof Error ? e.message : String(e);
  }

  // ---- Step 2: POST /v1/chat/completions (requires CORS preflight) ----
  // If step 1 passed but this fails, the issue is CORS preflight or PNA.
  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "qwen2.5-1.5b-q4.gguf",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 16,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        state: "failed",
        message: `POST /v1/chat/completions → HTTP ${res.status}. ${body.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? "";
    const returnedModel: string = data?.model ?? model;
    if (!reply) {
      return {
        state: "failed",
        message: `সার্ভার সংযুক্ত হয়েছে কিন্তু কোনো উত্তর পাওয়া যায়নি। মডেলের নাম সঠিক কিনা যাচাই করুন। (মডেল: ${returnedModel})`,
      };
    }
    return { state: "connected", model: returnedModel, reply: reply.trim().slice(0, 100) };
  } catch (e) {
    const rawErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // Build a detailed diagnostic message.
    const parts: string[] = [];

    if (!modelsOk) {
      // Step 1 also failed — the browser is blocking even the GET.
      parts.push("ধাপ ১ (GET /v1/models) ব্যর্থ।");
      parts.push(`ত্রুটি: ${modelsError}`);
      if (isHttpTarget && (pageProtocol === "https:" || window.isSecureContext) && !isNative) {
        parts.push(
          `কারণ: Mixed Content — প্রিভিউ পেজ HTTPS (${pageOrigin}) থেকে HTTP localhost কল ব্রাউজার ব্লক করে। CORS হেডার থাকলেও এটি ব্লক হয়।`
        );
        parts.push(
          "সমাধান: Capacitor APK-তে অ্যাপ প্যাকেজ করুন (WebView-এ allowMixedContent চালু), অথবা llama-server-এ TLS চালু করুন।"
        );
      } else if (isLoopback) {
        parts.push(
          `কারণ সম্ভবত Private Network Access — Chrome পাবলিক ডোমেইন থেকে localhost কল ব্লক করে।`
        );
      }
    } else {
      // Step 1 passed but step 2 failed — CORS preflight or PNA issue.
      parts.push("ধাপ ১ (GET /v1/models) সফল — সার্ভার পৌঁছানো যাচ্ছে।");
      if (detectedModel) parts.push(`সনাক্ত মডেল: ${detectedModel}`);
      parts.push("ধাপ ২ (POST /v1/chat/completions) ব্যর্থ।");
      parts.push(`ত্রুটি: ${rawErr}`);
      parts.push(
        "কারণ: CORS preflight (OPTIONS) ব্যর্থ বা Private Network Access। llama-server-এর OPTIONS উত্তরে এই হেডার প্রয়োজন:"
      );
      parts.push("Access-Control-Allow-Private-Network: true");
      parts.push("Access-Control-Allow-Origin: * (বা প্রিভিউ উৎস)");
      parts.push("Access-Control-Allow-Methods: GET, POST, OPTIONS");
      parts.push("Access-Control-Allow-Headers: Content-Type, Authorization");
    }

    if (e instanceof DOMException && e.name === "TimeoutError") {
      parts.push("নোট: সময়সীমা শেষ — সার্ভার ধীর বা ব্যস্ত।");
    }

    parts.push(`--- ডিবাগ তথ্য ---`);
    parts.push(`পেজ উৎস: ${pageOrigin}`);
    parts.push(`পেজ প্রোটোকল: ${pageProtocol || "(unknown)"}`);
    parts.push(`লক্ষ্য: ${url}`);
    parts.push(`isSecureContext: ${window.isSecureContext}`);
    parts.push(`Native WebView: ${isNative}`);

    return { state: "failed", message: parts.join("\n") };
  }
}

export interface LocalChatResult {
  reply: string;
  model: string;
}

// Call a local OpenAI-compatible endpoint. Returns null on failure so the
// caller can decide whether to fall back to the cloud path.
export async function callLocalAI(
  settings: LocalAISettings,
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  message: string,
  temperature: number,
  maxTokens: number
): Promise<LocalChatResult | null> {
  if (!settings.enabled) return null;
  const messages = [
    { role: "system", content: systemPrompt },
    ...history
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    { role: "user", content: message },
  ];
  try {
    const url = new URL(settings.endpoint.trim()).origin;
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature,
        max_tokens: Math.min(maxTokens, 1024),
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? "";
    if (!reply) return null;
    return { reply, model: data?.model ?? settings.model };
  } catch {
    return null;
  }
}
