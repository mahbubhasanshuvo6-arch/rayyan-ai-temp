// Bengali voice helpers: speech-to-text and text-to-speech.
// Uses the Web Speech API which is available inside the Capacitor WebView
// on Android via the system speech services.

export interface VoiceSettings {
  sttLang: string;
  ttsLang: string;
  autoSend: boolean;
}

const VOICE_KEY = "rayyan_voice_settings";

export const DEFAULT_VOICE: VoiceSettings = {
  sttLang: "bn-BD",
  ttsLang: "bn-BD",
  autoSend: false,
};

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    if (!raw) return DEFAULT_VOICE;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      ...DEFAULT_VOICE,
      sttLang: typeof parsed.sttLang === "string" ? parsed.sttLang : DEFAULT_VOICE.sttLang,
      ttsLang: typeof parsed.ttsLang === "string" ? parsed.ttsLang : DEFAULT_VOICE.ttsLang,
      autoSend: parsed.autoSend === true,
    };
  } catch {
    return DEFAULT_VOICE;
  }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  localStorage.setItem(VOICE_KEY, JSON.stringify(s));
}

export function isSTTSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );
}

export type MicPermissionResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "not-supported" | "insecure-context" | "unknown"; message: string };

export async function requestMicPermission(): Promise<MicPermissionResult> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      return {
        ok: false,
        reason: "insecure-context",
        message: "মাইক্রোফোন ব্যবহারের জন্য HTTPS সংযোগ প্রয়োজন। অনুগ্রহ করে HTTPS লিংক ব্যবহার করুন।",
      };
    }
    return {
      ok: false,
      reason: "not-supported",
      message: "এই ব্রাউজারে মাইক্রোফোন অনুমতি যাচাই করা যাচ্ছে না।",
    };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e: any) {
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
      return {
        ok: false,
        reason: "denied",
        message: "মাইক্রোফোন অনুমতি প্রয়োজন। ব্রাউজার বা অ্যাপ সেটিংসে মাইক্রোফোন অনুমতি দিন।",
      };
    }
    if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
      return {
        ok: false,
        reason: "not-supported",
        message: "কোনো মাইক্রোফোন পাওয়া যায়নি। ডিভাইসে মাইক্রোফোন আছে কিনা যাচাই করুন।",
      };
    }
    if (e?.name === "NotReadableError" || e?.name === "TrackStartError") {
      return {
        ok: false,
        reason: "unknown",
        message: "মাইক্রোফোন অ্যাক্সেস ব্যর্থ। অন্য অ্যাপ মাইক্রোফোন ব্যবহার করছে কিনা যাচাই করুন।",
      };
    }
    return {
      ok: false,
      reason: "unknown",
      message: `মাইক্রোফোন অনুমতি যাচাই ব্যর্থ: ${e?.name ?? e?.message ?? "অজানা ত্রুটি"}`,
    };
  }
}

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Bengali voice preference — try to pick a bn-* voice if available.
export function pickBengaliVoice(): SpeechSynthesisVoice | null {
  if (!isTTSSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "bn-BD") ??
    voices.find((v) => v.lang === "bn-IN") ??
    voices.find((v) => v.lang.startsWith("bn")) ??
    null
  );
}

export interface STTHandlers {
  onResult: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface STTController {
  start: () => void;
  stop: () => void;
}

export function createRecognizer(lang: string, handlers: STTHandlers): STTController | null {
  const SR =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang || "bn-BD";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e: any) => {
    let interim = "";
    let finalText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (finalText) handlers.onResult(finalText.trim(), true);
    else if (interim) handlers.onResult(interim.trim(), false);
  };
  rec.onerror = (e: any) => {
    const msgs: Record<string, string> = {
      "no-speech": "কোনো কথা শোনা যায়নি। অনুগ্রহ করে আবার বলুন।",
      "audio-capture": "মাইক্রোফোন অ্যাক্সেস ব্যর্থ। মাইক্রোফোন অনুমতি দিন।",
      "not-allowed": "মাইক্রোফোন অনুমতি প্রয়োজন। ব্রাউজার বা অ্যাপ সেটিংসে অনুমতি দিন।",
      "network": "নেটওয়ার্ক ত্রুটি। ইন্টারনেট সংযোগ যাচাই করুন।",
      "service-shutdown": "ভয়েস সার্ভিস বন্ধ হয়ে গেছে। আবার চেষ্টা করুন।",
      "aborted": "মাইক্রোফোন ব্যবহার বন্ধ করা হয়েছে।",
    };
    handlers.onError(msgs[e.error] ?? `ভয়েস ত্রুটি: ${e.error}`);
  };
  rec.onend = () => handlers.onEnd();
  return {
    start: () => {
      try { rec.start(); } catch { /* already started */ }
    },
    stop: () => {
      try { rec.stop(); } catch { /* not started */ }
    },
  };
}

export interface TTSController {
  speak: (text: string) => void;
  stop: () => void;
}

export function createSpeaker(lang: string): TTSController {
  const synth = window.speechSynthesis;
  let current: SpeechSynthesisUtterance | null = null;
  return {
    speak: (text: string) => {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang || "bn-BD";
      const voice = pickBengaliVoice();
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.pitch = 1.0;
      current = u;
      synth.speak(u);
    },
    stop: () => {
      synth.cancel();
      current = null;
    },
  };
}
