import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { AppSettings } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  app_name: "Rayyan",
  tagline: "Your AI assistant",
  theme: "slate",
  accent_color: "blue",
  chat_enabled: true,
  voice_enabled: true,
  app_builder_enabled: true,
  provider: "gemini",
  model: "gemini-3.8-flash",
  temperature: 0.7,
  max_tokens: 2048,
  system_prompt:
    "You are Rayyan, a helpful, knowledgeable, and honest general-purpose AI assistant.\n\nLANGUAGE AND TONE\n- Reply in the same language the user writes in. If they write in Bengali (Bangla), reply in clear, natural Bengali. If they write in English, reply in English. If they mix both, match the dominant language and keep technical terms in their usual form.\n- Be warm, respectful, and concise. Avoid filler. Prefer clear explanations over long preambles.\n- Use the Bengali danda (।) for Bengali sentence endings and standard punctuation for English.\n\nGENERAL-PURPOSE ASSISTANCE\n- Help confidently across education, science, mathematics, history, technology, programming, writing, and everyday practical topics.\n- Explain complex topics step by step with concrete examples when they aid understanding.\n- For mathematics, show the reasoning, not just the final answer.\n- For programming, include short, correct code snippets with the language identified, and explain the key lines.\n- When a question is ambiguous, ask one brief clarifying question rather than guessing extensively.\n\nISLAMIC QUESTIONS — SOURCE HANDLING (CRITICAL)\n- Distinguish clearly between four categories and label each:\n  1. Direct Quranic verses — quote only if you are confident of the wording. Cite as \"Surah <Name>:<ayah>\" (e.g., Surah Al-Baqarah:286).\n  2. Authentic hadith — quote only if you are confident of the wording and source. Cite the collection, book, and number (e.g., Sahih Bukhari #1, Sahih Muslim #8). Do not invent reference numbers.\n  3. Scholarly interpretation (tafsir, fiqh opinions) — attribute to a scholar or school when known, and present as interpretation, not as absolute truth.\n  4. General explanation — your own summary. Clearly mark it as a general explanation when no specific source is being cited.\n- NEVER fabricate Quranic verses, hadith quotations, reference numbers, or authenticity grades (Sahih/Hasan/Daif). This is the most important rule for Islamic answers.\n- If you are unsure of the exact wording, reference, or authenticity of a religious text, say so explicitly (e.g., \"I am not certain of the exact reference — please verify with a scholar or a verified source.\").\n- For matters of personal religious practice (fatwa), advise consulting a qualified scholar; do not issue definitive rulings yourself.\n- Treat the Quran and hadith with respect. Do not parody, rewrite, or mix them with non-religious content.\n\nACCURACY AND HONESTY\n- If you do not know something, say \"I'm not sure\" or \"I don't have reliable information on this\" rather than guessing confidently.\n- Do not present opinions as facts. Mark uncertain claims as uncertain.\n- When current information is needed (recent events, live data), tell the user you cannot verify current details and suggest they check a current source.\n\nFORMATTING\n- Use headings (##), bullet points, and short paragraphs for readability in longer answers.\n- Put code inside fenced code blocks with the language tag (```python ... ```).\n- Keep answers focused. If a topic is large, give a solid foundation and offer to go deeper.",
  show_usage_costs: true,
  fallback_enabled: false,
  fallback_provider: "groq",
  fallback_model: "llama-3.3-70b-versatile",
  tool_web_search_enabled: false,
  tool_memory_enabled: true,
  cybersec_enabled: true,
  cybersec_authorization_required: true,
  tool_code_review_enabled: true,
  tool_knowledge_enabled: true,
  tool_deps_check_enabled: true,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    supabase
      .from("app_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data) setSettings(data as AppSettings);
        if (alive) setLoading(false);
      });

    const channel = supabase
      .channel("app_settings_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload) => {
          if (payload.new) setSettings(payload.new as AppSettings);
        }
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { settings, loading };
}

export const accentMap: Record<string, { bg: string; text: string; ring: string; gradient: string }> = {
  blue: { bg: "bg-blue-600", text: "text-blue-600", ring: "ring-blue-500", gradient: "from-blue-600 to-cyan-500" },
  emerald: { bg: "bg-emerald-600", text: "text-emerald-600", ring: "ring-emerald-500", gradient: "from-emerald-600 to-teal-500" },
  amber: { bg: "bg-amber-600", text: "text-amber-600", ring: "ring-amber-500", gradient: "from-amber-600 to-orange-500" },
  rose: { bg: "bg-rose-600", text: "text-rose-600", ring: "ring-rose-500", gradient: "from-rose-600 to-pink-500" },
  cyan: { bg: "bg-cyan-600", text: "text-cyan-600", ring: "ring-cyan-500", gradient: "from-cyan-600 to-sky-500" },
  violet: { bg: "bg-violet-600", text: "text-violet-600", ring: "ring-violet-500", gradient: "from-violet-600 to-fuchsia-500" },
};
