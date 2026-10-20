import { useState, useEffect } from "react";
import {
  loadLocalAISettings,
  saveLocalAISettings,
  testLocalConnection,
  type LocalAISettings,
  type ConnectionStatus,
} from "@/lib/localAI";
import {
  loadVoiceSettings, saveVoiceSettings, isSTTSupported, isTTSSupported, pickBengaliVoice,
  type VoiceSettings,
} from "@/lib/voice";
import {
  loadWakeWordSettings, saveWakeWordSettings, WAKE_WORD_STATUS_NOTE,
  type WakeWordSettings,
} from "@/lib/wakeWord";
import { X, Wifi, Loader2, CheckCircle2, AlertCircle, Cpu, Mic, Volume2, Radio, Smartphone } from "lucide-react";

// Detect whether code is running inside a Capacitor native WebView (APK)
// vs a regular browser / Bolt preview.
function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as any).Capacitor?.isNative === true
  );
}

function isSecureBrowserContext(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.isSecureContext || location.protocol === "https:")
  );
}

interface Props {
  onClose: () => void;
}

export default function LocalAISettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<LocalAISettings>(loadLocalAISettings());
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });
  const [voice, setVoice] = useState<VoiceSettings>(loadVoiceSettings());
  const [wakeWord, setWakeWord] = useState<WakeWordSettings>(loadWakeWordSettings());
  const [hasBnVoice, setHasBnVoice] = useState(false);
  const inputCls =
    "w-full bg-slate-900 text-slate-100 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-slate-600 border border-slate-700";

  useEffect(() => {
    if (isTTSSupported()) {
      const check = () => {
        const v = pickBengaliVoice();
        setHasBnVoice(!!v);
      };
      check();
      window.speechSynthesis.onvoiceschanged = check;
      return () => { window.speechSynthesis.onvoiceschanged = null; };
    }
  }, []);

  const update = (patch: Partial<LocalAISettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveLocalAISettings(next);
  };

  const updateVoice = (patch: Partial<VoiceSettings>) => {
    const next = { ...voice, ...patch };
    setVoice(next);
    saveVoiceSettings(next);
  };

  const updateWakeWord = (patch: Partial<WakeWordSettings>) => {
    const next = { ...wakeWord, ...patch };
    setWakeWord(next);
    saveWakeWordSettings(next);
  };

  const runTest = async () => {
    setStatus({ state: "testing" });
    const result = await testLocalConnection(settings.endpoint, settings.model);
    setStatus(result);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-slate-100">লোকাল AI সেটিংস</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* What is this? */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 leading-relaxed">
            <p className="text-slate-300 font-medium mb-1">এই সেটিংস কী?</p>
            ফোনে Termux + llama.cpp দিয়ে একটি লোকাল AI সার্ভার চালালে, এই অপশন ব্যবহার করে
            অ্যাপটি সরাসরি ফোনের সার্ভারে কল করতে পারে — ক্লাউড API ছাড়াই। সার্ভার বন্ধ
            থাকলে স্বয়ংক্রিয়ভাবে ক্লাউডে ফিরে যায় (যদি ফলব্যাক চালু থাকে)।
          </div>

          {/* Localhost explanation */}
          <div className="bg-cyan-950/30 border border-cyan-900 rounded-lg p-3 text-[11px] text-cyan-200 leading-relaxed">
            <p className="text-cyan-300 font-medium mb-1">গুরুত্বপূর্ণ: localhost কী?</p>
            <span className="text-slate-200">http://127.0.0.1:8080</span> বা <span className="text-slate-200">http://localhost:8080</span> ঠিকানা ব্রাউজার বা অ্যাপ থেকে কল করলে সেটি আপনার ফোনের ভেতরের সার্ভারে যায় — বাইরের কোনো সার্ভারে নয়। অর্থাৎ llama-server যদি এই ফোনেই চালু থাকে, তবেই সংযোগ হবে।
            <br /><br />
            <span className="text-cyan-300">পরীক্ষা:</span> চোম বা ফায়ারফক্স ব্রাউজার খুলে <code className="bg-slate-950 rounded px-1">http://127.0.0.1:8080/v1/models</code> ঠিকানায় যান। JSON উত্তর দেখলে সার্ভার চালু আছে। ব্রাউজার থেকে সংযোগ না হলে অ্যাপ থেকেও হবে না।
          </div>

          {/* Browser context warning */}
          {!isNativeApp() && isSecureBrowserContext() && (
            <div className="bg-amber-950/40 border border-amber-800 rounded-lg p-3 text-[11px] text-amber-200 leading-relaxed space-y-1.5">
              <p className="flex items-center gap-1.5 text-amber-300 font-medium">
                <Smartphone className="w-3.5 h-3.5" /> ব্রাউজার প্রিভিউ — লোকাল সার্ভারে সংযোগ ব্লক হতে পারে
              </p>
              <p>
                এই প্রিভিউ HTTPS পেজ থেকে <span className="text-amber-100">http://127.0.0.1:8080</span>-এ কল করছে। ব্রাউজার দুটি নিয়মে এই কল ব্লক করে:
              </p>
              <p>
                <span className="text-amber-300">১. Mixed Content:</span> HTTPS পেজ থেকে HTTP কল ব্লক।<br />
                <span className="text-amber-300">২. Private Network Access:</span> পাবলিক ডোমেইন থেকে localhost/loopback কল ব্লক (Chrome)।
              </p>
              <p>
                এটি সার্ভারের সমস্যা নয় — <code className="bg-slate-950 rounded px-1">curl</code> Termux-এ কাজ করে কারণ সেটি ব্রাউজারের নিয়মের বাইরে। সমাধান: অ্যাপটি Capacitor APK হিসেবে প্যাকেজ করুন (নিচের "APK প্যাকেজ নির্দেশনা" দেখুন)। APK-তে WebView-এর নিয়ম আলাদা — localhost কল কাজ করে।
              </p>
            </div>
          )}

          {/* Enable toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-slate-200">লোকাল AI ব্যবহার করুন</span>
            <button
              onClick={() => update({ enabled: !settings.enabled })}
              className={`relative w-11 h-6 rounded-full transition ${
                settings.enabled ? "bg-cyan-600" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>

          {/* Endpoint */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              এন্ডপয়েন্ট ঠিকানা (Endpoint URL)
            </label>
            <input
              type="text"
              value={settings.endpoint}
              onChange={(e) => update({ endpoint: e.target.value })}
              placeholder="http://127.0.0.1:8080"
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              llama-server এর জন্য ডিফল্ট পোর্ট ৮০৮০। Ollama হলে ১১৪৩৪ ব্যবহার করুন।
            </p>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">মডেলের নাম</label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="qwen2.5-1.5b-q4.gguf"
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              llama-server-এ যে মডেল লোড করা আছে তার নাম লিখুন।
            </p>
          </div>

          {/* Fallback toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-slate-200">
              লোকাল ব্যর্থ হলে ক্লাউডে ফিরে যান
            </span>
            <button
              onClick={() => update({ fallbackToCloud: !settings.fallbackToCloud })}
              className={`relative w-11 h-6 rounded-full transition ${
                settings.fallbackToCloud ? "bg-cyan-600" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.fallbackToCloud ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>

          {/* Test connection */}
          <div className="border-t border-slate-700 pt-4">
            <button
              onClick={runTest}
              disabled={status.state === "testing"}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 text-slate-100 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition border border-slate-600"
            >
              {status.state === "testing" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              সংযোগ পরীক্ষা করুন
            </button>

            {status.state === "connected" && (
              <div className="mt-3 flex items-start gap-2 bg-emerald-950/40 border border-emerald-800 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-200">
                  <p className="font-medium text-emerald-300">সংযোগ সফল!</p>
                  <p className="mt-0.5">মডেল: {status.model}</p>
                  <p className="mt-0.5 text-emerald-400/70">উত্তর: "{status.reply}"</p>
                </div>
              </div>
            )}

            {status.state === "failed" && (
              <div className="mt-3 flex items-start gap-2 bg-rose-950/40 border border-rose-800 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-200">
                  <p className="font-medium text-rose-300">সংযোগ ব্যর্থ</p>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words font-sans text-rose-200">{status.message}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Setup instructions */}
          <details className="border-t border-slate-700 pt-4">
            <summary className="text-sm text-cyan-400 cursor-pointer hover:text-cyan-300">
              Android-এ লোকাল AI সেটআপ নির্দেশনা (দেখুন)
            </summary>
            <div className="mt-3 text-xs text-slate-400 leading-relaxed space-y-2">
              <p>
                <span className="text-slate-300 font-medium">ধাপ ১:</span> Google Play
                থেকে <span className="text-slate-200">Termux</span> ইনস্টল করুন (F-Droid
                সংস্করণ পছন্দনীয় — Play সংস্করণ পুরোনো হতে পারে)।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ২:</span> Termux-এ
                নিচের কমান্ড চালান:
                <code className="block bg-slate-950 text-slate-200 rounded p-2 mt-1 text-[11px]">
                  pkg update && pkg install llama.cpp
                </code>
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৩:</span> একটি GGUF
                মডেল ডাউনলোড করুন (যেমন Qwen2.5-1.5B-Instruct Q4_K_M, ~১GB)।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৪:</span> সার্ভার
                চালু করুন:
                <code className="block bg-slate-950 text-slate-200 rounded p-2 mt-1 text-[11px]">
                  llama-server -m model.gguf --host 127.0.0.1 --port 8080
                </code>
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৫:</span> Termux-এ
                wakelock চালু রাখুন যাতে ব্যাকগ্রাউন্ডে সার্ভার বন্ধ না হয়:
                <code className="block bg-slate-950 text-slate-200 rounded p-2 mt-1 text-[11px]">
                  termux-wake-lock
                </code>
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৬:</span> উপরে
                "সংযোগ পরীক্ষা করুন" বাটনে চাপুন। সফল হলে লোকাল AI চালু করুন।
              </p>
            </div>
          </details>

          {/* APK packaging instructions */}
          <details className="border-t border-slate-700 pt-4">
            <summary className="text-sm text-amber-400 cursor-pointer hover:text-amber-300">
              APK প্যাকেজ নির্দেশনা — লোকাল সার্ভারে সংযোগের জন্য (দেখুন)
            </summary>
            <div className="mt-3 text-xs text-slate-400 leading-relaxed space-y-2">
              <p className="text-amber-300/80">
                ব্রাউজার প্রিভিউ থেকে localhost কল ব্লক হয়। সমাধান: অ্যাপটি Capacitor APK হিসেবে প্যাকেজ করুন। APK-তে Capacitor WebView-এ allowMixedContent চালু আছে, ফলে http://127.0.0.1 কল কাজ করে।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ১:</span> কম্পিউটারে Node.js ও Android Studio (command-line tools) ইনস্টল করুন।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ২:</span> প্রজেক্ট ফোল্ডারে গিয়ে বিল্ড করুন:
                <code className="block bg-slate-950 text-slate-200 rounded p-2 mt-1 text-[11px]">
                  npm install<br />npm run cap:sync
                </code>
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৩:</span> Android ফোন USB-তে কানেক্ট করুন (USB debugging চালু)। অথবা GitHub Actions workflow (`.github/workflows/build-apk.yml`) ব্যবহার করুন — সেটি APK বিল্ড করে।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৪:</span> APK ফোনে ইনস্টল করুন:
                <code className="block bg-slate-950 text-slate-200 rounded p-2 mt-1 text-[11px]">
                  npx cap run android
                </code>
                অথবা `android/app/build/outputs/apk/` ফোল্ডার থেকে `.apk` ফাইল ফোনে কপি করে ইনস্টল করুন।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৫:</span> ফোনে Termux-এ llama-server চালু করুন (পোর্ট ৮০৮০)।
              </p>
              <p>
                <span className="text-slate-300 font-medium">ধাপ ৬:</span> Rayyan AI অ্যাপ খুলুন → Cpu আইকন → লোকাল AI চালু → "সংযোগ পরীক্ষা করুন"। এবার সফল হবে।
              </p>
              <p className="text-[10px] text-slate-500 mt-2">
                বিকল্প: Termux-এ llama-server-এ TLS/HTTPS চালু করলে ব্রাউজার থেকেও কাজ করতে পারে, কিন্তু Private Network Access এখনও ব্লক করতে পারে। APK-ই নির্ভরযোগ্য সমাধান।
              </p>
            </div>
          </details>
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 transition"
          >
            বন্ধ করুন
          </button>
        </div>

        {/* Voice settings */}
        <div className="p-4 border-t border-slate-700 space-y-4">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-200">ভয়েস সেটিংস</h3>
          </div>

          {!isSTTSupported() && (
            <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-800 rounded-lg p-3 text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              এই ডিভাইসে স্পিচ-টু-টেক্সট সমর্থিত নয়। Android WebView-এ Google সার্চ অ্যাপ ও স্পিচ সার্ভিস চালু থাকা প্রয়োজন।
            </div>
          )}

          {!hasBnVoice && isTTSSupported() && (
            <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-800 rounded-lg p-3 text-xs text-amber-200">
              <Volume2 className="w-4 h-4 shrink-0 mt-0.5" />
              বাংলা ভয়েস পাওয়া যায়নি। ফোনের সেটিংস → Language &amp; input → Text-to-speech → বাংলা ভয়েস ডেটা ইনস্টল করুন। না থাকলে ইংরেজি ভয়েস দিয়ে উচ্চারণ হবে।
            </div>
          )}

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-slate-200">ভয়েস শুনে স্বয়ংক্রিয়ভাবে পাঠান</span>
            <button
              onClick={() => updateVoice({ autoSend: !voice.autoSend })}
              className={`relative w-11 h-6 rounded-full transition ${
                voice.autoSend ? "bg-cyan-600" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  voice.autoSend ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>

          <div>
            <label className="block text-xs text-slate-400 mb-1">স্পিচ-টু-টেক্সট ভাষা</label>
            <select value={voice.sttLang} onChange={(e) => updateVoice({ sttLang: e.target.value })} className={inputCls}>
              <option value="bn-BD">বাংলা (বাংলাদেশ)</option>
              <option value="bn-IN">বাংলা (ভারত)</option>
              <option value="en-US">English (US)</option>
              <option value="en-IN">English (India)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">টেক্সট-টু-স্পিচ ভাষা</label>
            <select value={voice.ttsLang} onChange={(e) => updateVoice({ ttsLang: e.target.value })} className={inputCls}>
              <option value="bn-BD">বাংলা (বাংলাদেশ)</option>
              <option value="bn-IN">বাংলা (ভারত)</option>
              <option value="en-US">English (US)</option>
              <option value="en-IN">English (India)</option>
            </select>
          </div>
        </div>

        {/* Wake word settings */}
        <div className="p-4 border-t border-slate-700 space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-200">ওয়েক-ওয়ার্ড ("Hello Rayyan")</h3>
          </div>

          <div className="bg-slate-800/60 border border-amber-800/40 rounded-lg p-3 text-[11px] text-amber-300/80 leading-relaxed">
            {WAKE_WORD_STATUS_NOTE}
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-slate-200">ওয়েক-ওয়ার্ড সনাক্তকরণ চালু করুন</span>
            <button
              onClick={() => updateWakeWord({ enabled: !wakeWord.enabled })}
              className={`relative w-11 h-6 rounded-full transition ${
                wakeWord.enabled ? "bg-cyan-600" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  wakeWord.enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>

          <p className="text-[11px] text-slate-500">
            চালু থাকলে, ভয়েস ইনপুটে "Hello Rayyan" বা "হ্যালো রায়য়ান" বললে স্বয়ংক্রিয়ভাবে চ্যাট শুরু হবে। শুধু অ্যাপ খোলা থাকলে কাজ করে।
          </p>
        </div>
      </div>
    </div>
  );
}
