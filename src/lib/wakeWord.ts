// Wake-word preparation for "Hello Rayyan".
//
// IMPORTANT: This module only works while the app is in the FOREGROUND and
// the microphone is actively being listened to. Background or locked-screen
// wake-word detection requires a native Android service (foreground service
// with microphone permission) and has NOT been tested on a real device.
//
// This provides:
//   1. A foreground-only keyword spotter that checks the STT transcript
//      for "hello rayyan" / "হ্যালো রায়য়ান" while the user is holding
//      the mic button or conversation mode is on.
//   2. A settings flag so a future native Android plugin can read the
//      same stored preference.

export interface WakeWordSettings {
  enabled: boolean;
  phrase: string;
  backgroundMode: boolean; // future — not functional yet
}

const WAKE_KEY = "rayyan_wake_word_settings";

export const DEFAULT_WAKE_WORD: WakeWordSettings = {
  enabled: false,
  phrase: "hello rayyan",
  backgroundMode: false,
};

export function loadWakeWordSettings(): WakeWordSettings {
  try {
    const raw = localStorage.getItem(WAKE_KEY);
    if (!raw) return DEFAULT_WAKE_WORD;
    const parsed = JSON.parse(raw) as Partial<WakeWordSettings>;
    return {
      ...DEFAULT_WAKE_WORD,
      enabled: parsed.enabled === true,
      phrase: typeof parsed.phrase === "string" ? parsed.phrase : DEFAULT_WAKE_WORD.phrase,
      backgroundMode: false, // always false until native impl exists
    };
  } catch {
    return DEFAULT_WAKE_WORD;
  }
}

export function saveWakeWordSettings(s: WakeWordSettings): void {
  localStorage.setItem(WAKE_KEY, JSON.stringify({ ...s, backgroundMode: false }));
}

const WAKE_PATTERNS = [
  "hello rayyan",
  "হ্যালো রায়য়ান",
  "হালো রায়য়ান",
  "hello rayan",
  "hey rayyan",
  "হ্যালো রায়ান",
];

// Returns true if the transcript contains the wake phrase.
// Works with Bengali and English variants.
export function detectWakeWord(transcript: string): boolean {
  const lower = transcript.toLowerCase().trim();
  if (!lower) return false;
  return WAKE_PATTERNS.some((p) => lower.includes(p));
}

// Status note for UI — clearly states what works and what doesn't.
export const WAKE_WORD_STATUS_NOTE =
  "এই ফিচারটি শুধু অ্যাপ খোলা থাকলে কাজ করে। ব্যাকগ্রাউন্ডে বা স্ক্রিন লক করা অবস্থায় ওয়েক-ওয়ার্ড সনাক্তকরণ এখনও পরীক্ষিত হয়নি — ভবিষ্যতে নেটিভ Android ইম্প্লিমেন্টেশনের জন্য প্রস্তুত রাখা হয়েছে।";
