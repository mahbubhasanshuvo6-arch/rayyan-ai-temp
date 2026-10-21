import { useEffect, useRef, useState, useCallback } from "react";
import { supabase, EDGE_URL } from "@/lib/supabase";
import { useSettings, accentMap } from "@/lib/useSettings";
import { navigate } from "@/lib/router";
import type { ChatThread, ChatMessage } from "@/lib/types";
import {
  Send, Mic, MicOff, Plus, MessageSquare, Trash2,
  Menu, X, Sparkles, Loader2, Volume2, Square, Bot, User, Settings,
  Globe, Brain, Check, X as XIcon, ShieldCheck, BookOpen, Code2, PackageSearch,
  ExternalLink,
} from "lucide-react";
import {
  loadVoiceSettings, saveVoiceSettings, createRecognizer, createSpeaker,
  isSTTSupported, isTTSSupported, pickBengaliVoice,
  type VoiceSettings, type STTController,
} from "@/lib/voice";
import { loadWakeWordSettings, saveWakeWordSettings, detectWakeWord, WAKE_WORD_STATUS_NOTE, type WakeWordSettings } from "@/lib/wakeWord";

const SESSION_LABEL_KEY = "rayyan_owner_label";

const TOOL_LABELS: Record<string, string> = {
  web_search: "Web research",
  save_memory: "Memory saved",
  review_code: "Code security review",
  save_knowledge: "Knowledge saved",
  check_deps: "Dependency check",
};

function formatToolCard(tool: string, ok: boolean | undefined, result: string): string {
  const label = TOOL_LABELS[tool] ?? tool;
  const okText = ok === false ? `Did not complete: ${result}` : result;
  return `[${label}] ${okText}`;
}

function toolIcon(tool: string, className: string) {
  switch (tool) {
    case "web_search": return <Globe className={className} />;
    case "save_memory": return <Brain className={className} />;
    case "review_code": return <Code2 className={className} />;
    case "save_knowledge": return <BookOpen className={className} />;
    case "check_deps": return <PackageSearch className={className} />;
    default: return <Brain className={className} />;
  }
}

function getOrCreateOwnerLabel(): string {
  let label = localStorage.getItem(SESSION_LABEL_KEY);
  if (!label) {
    label = `anon-${crypto.randomUUID()}`;
    localStorage.setItem(SESSION_LABEL_KEY, label);
  }
  return label;
}

export default function ChatPage() {
  const { settings } = useSettings();
  const accent = accentMap[settings.accent_color] ?? accentMap.blue;
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTool, setPendingTool] = useState<null | {
    threadId: string;
    userText: string;
    history: Array<{ role: string; content: string }>;
    tool: string;
    args: Record<string, unknown>;
  }>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const [scope, setScope] = useState({ scope: "", target: "", relationship: "" });
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(loadVoiceSettings());
  const [wakeWord, setWakeWord] = useState<WakeWordSettings>(loadWakeWordSettings());
  const [conversationMode, setConversationMode] = useState(false);
  const [interimText, setInterimText] = useState("");
  const ownerLabel = getOrCreateOwnerLabel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sttRef = useRef<STTController | null>(null);
  const ttsRef = useRef<ReturnType<typeof createSpeaker> | null>(null);
  const convRestartRef = useRef(false);

  // Load threads.
  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("chat_threads")
      .select("*")
      .or(`owner_label.eq.${ownerLabel}`)
      .order("updated_at", { ascending: false });
    if (data) setThreads(data as ChatThread[]);
  }, [ownerLabel]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Load messages when thread changes.
  useEffect(() => {
    if (!activeThread) {
      setMessages([]);
      return;
    }
    supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", activeThread.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setMessages((data as ChatMessage[]) ?? []));
  }, [activeThread]);

  // Auto-scroll.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const newChat = () => {
    setActiveThread(null);
    setMessages([]);
    setError(null);
    setSidebarOpen(false);
  };

  const selectThread = (t: ChatThread) => {
    setActiveThread(t);
    setSidebarOpen(false);
    setError(null);
  };

  const deleteThread = async (id: string) => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    await supabase.from("chat_threads").delete().eq("id", id);
    if (activeThread?.id === id) newChat();
    loadThreads();
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    if (!settings.chat_enabled) {
      setError("Chat is currently disabled by the administrator.");
      return;
    }
    setSending(true);
    setError(null);

    let thread = activeThread;
    const userText = input.trim();
    setInput("");

    // Create thread if needed.
    if (!thread) {
      const { data, error: te } = await supabase
        .from("chat_threads")
        .insert({ owner_label: ownerLabel, title: userText.slice(0, 40) })
        .select()
        .maybeSingle();
      if (te || !data) {
        setError(te?.message ?? "Could not start a new conversation.");
        setSending(false);
        return;
      }
      thread = data as ChatThread;
      setActiveThread(thread);
      loadThreads();
    }

    // Save user message.
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      thread_id: thread.id,
      role: "user",
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    await supabase.from("chat_messages").insert({
      thread_id: thread.id,
      role: "user",
      content: userText,
    });

    // Build history for Gemini.
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Fetch user's persistent memory to inject into the AI context.
    // Scoped by owner_label via RLS — only this user's entries are returned.
    // Failures are non-fatal: chat proceeds without memory.
    let memoryStrings: string[] = [];
    try {
      const { data: memData, error: memErr } = await supabase
        .from("memory_entries")
        .select("content")
        .or(`owner_label.eq.${ownerLabel}`)
        .order("created_at", { ascending: false })
        .limit(8);
      if (!memErr && memData && memData.length > 0) {
        memoryStrings = memData.map((m: { content: string }) => m.content).filter(Boolean);
      }
    } catch {
      // Memory retrieval failed — proceed without memory (safe fallback).
    }

    try {
      const res = await fetch(`${EDGE_URL}/gemini-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          mode: "chat",
          message: userText,
          history,
          ownerLabel,
          memory: memoryStrings.length > 0 ? memoryStrings : undefined,
          authorization:
            scope.scope || scope.target || scope.relationship
              ? scope
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Use the server-provided error message directly — it already contains
        // a helpful Bengali message when all providers fail. Only fall back to
        // a generic Bengali message if the server sent an English-only string.
        const errMsg = data.error ?? "Something went wrong.";
        const isBengali = /[\u0980-\u09FF]/.test(errMsg);
        setError(isBengali ? errMsg : "এআই পরিষেবা এই মুহূর্তে ব্যস্ত। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।");
        setSending(false);
        return;
      }

      // Tool confirmation request (future destructive tools).
      if (data.tool_request && data.tool_request.requiresConfirmation) {
        setPendingTool({
          threadId: thread.id,
          userText,
          history,
          tool: data.tool_request.tool,
          args: data.tool_request.args,
        });
        setSending(false);
        return;
      }

      // Tool executed server-side — show result card.
      if (data.tool_request && !data.tool_request.requiresConfirmation) {
        const tr = data.tool_request;
        const card = formatToolCard(tr.tool, tr.ok, tr.result);
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          thread_id: thread.id,
          role: "assistant",
          content: card,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        await supabase.from("chat_messages").insert({
          thread_id: thread.id,
          role: "assistant",
          content: card,
        });
        setSending(false);
        return;
      }

      const reply: string = data.reply ?? "";
      const truncated: boolean = data.truncated === true;
      const sources: Array<{ title: string; url: string }> | undefined =
        Array.isArray(data.sources) ? data.sources : undefined;
      const displayText = truncated
        ? reply + "\n\n---\n\n⚠️ এই উত্তরটি আউটপুট সীমার কারণে সম্পূর্ণ হয়নি। অনুগ্রহ করে আবার জিজ্ঞাসা করুন অথবা আরও নির্দিষ্ট প্রশ্ন করুন।"
        : reply;
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        thread_id: thread.id,
        role: "assistant",
        content: displayText,
        sources,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      await supabase.from("chat_messages").insert({
        thread_id: thread.id,
        role: "assistant",
        content: reply,
      });

      if (messages.length === 0) {
        await supabase
          .from("chat_threads")
          .update({ title: userText.slice(0, 40), updated_at: new Date().toISOString() })
          .eq("id", thread.id);
        loadThreads();
      }

      if (settings.voice_enabled && speaking) {
        speak(reply);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "নেটওয়ার্ক ত্রুটি। অনুগ্রহ করে আবার চেষ্টা করুন।");
    } finally {
      setSending(false);
    }
  };

  const confirmTool = async () => {
    if (!pendingTool) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${EDGE_URL}/gemini-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          mode: "chat",
          message: pendingTool.userText,
          history: pendingTool.history,
          ownerLabel,
          confirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Tool action failed.");
      } else if (data.tool_request) {
        const tr = data.tool_request;
        const card = formatToolCard(tr.tool, tr.ok, tr.result);
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          thread_id: pendingTool.threadId,
          role: "assistant",
          content: card,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        await supabase.from("chat_messages").insert({
          thread_id: pendingTool.threadId,
          role: "assistant",
          content: card,
        });
      } else if (data.reply) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          thread_id: pendingTool.threadId,
          role: "assistant",
          content: data.reply,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        await supabase.from("chat_messages").insert({
          thread_id: pendingTool.threadId,
          role: "assistant",
          content: data.reply,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "নেটওয়ার্ক ত্রুটি। অনুগ্রহ করে আবার চেষ্টা করুন।");
    } finally {
      setPendingTool(null);
      setSending(false);
    }
  };

  // Initialize TTS speaker once.
  useEffect(() => {
    if (isTTSSupported()) ttsRef.current = createSpeaker(voiceSettings.ttsLang);
  }, [voiceSettings.ttsLang]);

  // Load voices (Chrome loads them asynchronously).
  useEffect(() => {
    if (isTTSSupported()) window.speechSynthesis.getVoices();
  }, []);

  const speak = (text: string) => {
    if (!ttsRef.current) return;
    setSpeaking(true);
    ttsRef.current.speak(text);
    // Poll for end since onend is unreliable on some Android WebViews.
    const synth = window.speechSynthesis;
    const check = setInterval(() => {
      if (!synth.speaking) { setSpeaking(false); clearInterval(check); }
    }, 300);
  };

  const stopSpeaking = () => {
    ttsRef.current?.stop();
    setSpeaking(false);
  };

  const startListening = useCallback(() => {
    if (!isSTTSupported()) {
      setError("এই ডিভাইসে ভয়েস ইনপুট সমর্থিত নয়।");
      return;
    }
    setError(null);
    const stt = createRecognizer(voiceSettings.sttLang, {
      onResult: (text, isFinal) => {
        if (!isFinal) {
          setInterimText(text);
          return;
        }
        setInterimText("");
        if (wakeWord.enabled && detectWakeWord(text)) {
          // Wake word detected — strip it and continue with the rest.
          const cleaned = text.replace(/hello rayyan|হ্যালো রায়য়ান|হালো রায়য়ান|hello rayan|hey rayyan|হ্যালো রায়ান/i, "").trim();
          if (cleaned) {
            setInput(cleaned);
            if (voiceSettings.autoSend || conversationMode) {
              setTimeout(() => sendMessage(), 100);
            }
          }
          return;
        }
        setInput((prev) => (prev ? prev + " " : "") + text);
        if (voiceSettings.autoSend || conversationMode) {
          setTimeout(() => sendMessage(), 100);
        }
      },
      onError: (msg) => { setError(msg); setListening(false); setConversationMode(false); },
      onEnd: () => {
        setListening(false);
        setInterimText("");
        // Conversation mode: auto-restart listening after reply completes.
        if (convRestartRef.current && !speaking) {
          convRestartRef.current = false;
          setTimeout(() => startListening(), 500);
        }
      },
    });
    if (!stt) return;
    sttRef.current = stt;
    stt.start();
    setListening(true);
  }, [voiceSettings.sttLang, voiceSettings.autoSend, wakeWord.enabled, conversationMode, speaking]);

  const stopListening = useCallback(() => {
    sttRef.current?.stop();
    sttRef.current = null;
    setListening(false);
    setInterimText("");
  }, []);

  const toggleListening = () => {
    if (listening) { stopListening(); return; }
    startListening();
  };

  // Conversation mode: hold mic to listen continuously, auto-send, speak reply, then listen again.
  const toggleConversationMode = () => {
    if (conversationMode) {
      setConversationMode(false);
      convRestartRef.current = false;
      stopListening();
      return;
    }
    setConversationMode(true);
    convRestartRef.current = false;
    startListening();
  };

  // Update voice settings and persist.
  const updateVoiceSettings = (patch: Partial<VoiceSettings>) => {
    const next = { ...voiceSettings, ...patch };
    setVoiceSettings(next);
    saveVoiceSettings(next);
  };

  const updateWakeWord = (patch: Partial<WakeWordSettings>) => {
    const next = { ...wakeWord, ...patch };
    setWakeWord(next);
    saveWakeWordSettings(next);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden max-w-[100vw]">
      {/* Sidebar */}
      <aside
        className={`fixed lg:relative z-40 h-full w-72 bg-slate-900 border-r border-slate-800 transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accent.gradient} flex items-center justify-center`}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg">{settings.app_name}</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={newChat}
          className={`m-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r ${accent.gradient} text-white font-medium hover:opacity-90 transition`}
        >
          <Plus className="w-4 h-4" /> New Chat
        </button>

        <div className="px-3 pb-4 overflow-y-auto max-h-[calc(100vh-180px)]">
          {threads.length === 0 && (
            <p className="text-sm text-slate-500 px-2 py-4">No conversations yet.</p>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => selectThread(t)}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer mb-1 transition ${
                activeThread?.id === t.id ? "bg-slate-800" : "hover:bg-slate-800/50"
              }`}
            >
              <MessageSquare className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="flex-1 text-sm truncate">{t.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800">
          <button
            onClick={() => navigate("documents")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition"
          >
            <BookOpen className="w-4 h-4" /> My Documents
          </button>
          <button
            onClick={() => navigate("builder")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition"
          >
            <Sparkles className="w-4 h-4" /> App Builder
          </button>
          <button
            onClick={() => navigate("admin")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition"
          >
            <Settings className="w-4 h-4" /> Admin Panel
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-400 hover:text-white">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-base sm:text-lg font-semibold flex-1 truncate min-w-0">
            {activeThread ? activeThread.title : `New chat with ${settings.app_name}`}
          </h1>
          {settings.voice_enabled && (
            <button
              onClick={speaking ? stopSpeaking : () => setSpeaking(!speaking)}
              className={`p-2 rounded-lg transition ${speaking ? accent.bg + " text-white" : "text-slate-400 hover:bg-slate-800"}`}
              title={speaking ? "Stop speaking" : "Enable voice replies"}
            >
              {speaking ? <Square className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          )}
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 sm:py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 sm:py-20 px-2">
                <div className={`inline-flex w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br ${accent.gradient} items-center justify-center mb-3 sm:mb-4`}>
                  <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold mb-2">{settings.app_name}</h2>
                <p className="text-slate-400 text-sm sm:text-base px-2">{settings.tagline}</p>
                <p className="text-slate-500 text-sm mt-4">Ask me anything — I'm here to help.</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accent.gradient} flex items-center justify-center shrink-0`}>
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    m.role === "user"
                      ? "bg-slate-700 text-white"
                      : "bg-slate-800 text-slate-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>
                  {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-700/60 space-y-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold flex items-center gap-1.5">
                        <Globe className="w-3 h-3" /> ওয়েব উৎস
                      </p>
                      {m.sources.map((src, i) => (
                        <a
                          key={i}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-1.5 text-xs text-slate-300 hover:text-white transition group"
                        >
                          <span className="text-slate-500 shrink-0">{i + 1}.</span>
                          <span className="flex-1 min-w-0">
                            <span className="underline decoration-slate-600 group-hover:decoration-slate-400 truncate block">
                              {src.title || src.url}
                            </span>
                            <span className="text-slate-500 block truncate">{src.url}</span>
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-slate-300 shrink-0 mt-0.5" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {m.role === "user" && (
                  <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-slate-300" />
                  </div>
                )}
              </div>
            ))}
            {pendingTool && (
              <div className="flex gap-3 justify-start">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accent.gradient} flex items-center justify-center shrink-0`}>
                  {toolIcon(pendingTool.tool, "w-5 h-5 text-white")}
                </div>
                <div className="bg-slate-800 rounded-2xl px-4 py-3 space-y-2">
                  <p className="text-sm text-slate-200">
                    Rayyan wants to run <span className="font-semibold">{pendingTool.tool}</span>
                    {pendingTool.args && Object.keys(pendingTool.args).length > 0 && (
                      <span className="block text-xs text-slate-400 mt-1 font-mono break-all">{JSON.stringify(pendingTool.args)}</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={confirmTool} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-500">
                      <Check className="w-3.5 h-3.5" /> Allow
                    </button>
                    <button onClick={() => setPendingTool(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 text-xs hover:bg-slate-600">
                      <XIcon className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            {sending && (
              <div className="flex gap-3 justify-start">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accent.gradient} flex items-center justify-center shrink-0`}>
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="bg-slate-800 rounded-2xl px-4 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              </div>
            )}
            {error && (
              <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-800 bg-slate-900/50 backdrop-blur p-3 sm:p-4">
          <div className="max-w-3xl mx-auto space-y-2">
            {settings.cybersec_enabled && settings.cybersec_authorization_required && showScope && (
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-300">
                    <ShieldCheck className="w-3.5 h-3.5" /> Testing scope (advisory)
                  </span>
                  <button onClick={() => setShowScope(false)} className="text-slate-500 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={scope.scope} onChange={(e) => setScope((p) => ({ ...p, scope: e.target.value }))} placeholder="Scope (e.g. my own app)" className="bg-slate-900 text-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-slate-600" />
                  <input value={scope.target} onChange={(e) => setScope((p) => ({ ...p, target: e.target.value }))} placeholder="Target (e.g. https://myapp.test)" className="bg-slate-900 text-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-slate-600" />
                  <input value={scope.relationship} onChange={(e) => setScope((p) => ({ ...p, relationship: e.target.value }))} placeholder="Relationship (owner / CTF / lab)" className="bg-slate-900 text-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-slate-600" />
                </div>
                <p className="text-[11px] text-slate-500">Declared scope is a claim, not proof. Rayyan uses it to tailor guidance for authorized testing.</p>
              </div>
            )}
            <div className="flex items-end gap-1.5 sm:gap-2 min-w-0">
              {settings.voice_enabled && (
                <>
                  <button
                    onClick={toggleListening}
                    className={`p-3 rounded-xl transition shrink-0 ${
                      listening ? "bg-rose-600 text-white animate-pulse" : "bg-slate-800 text-slate-400 hover:text-white"
                    }`}
                    title="ভয়েস ইনপুট"
                  >
                    {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={toggleConversationMode}
                    className={`p-3 rounded-xl transition shrink-0 ${
                      conversationMode ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
                    }`}
                    title="কনভার্সেশন মোড — কথা বললে স্বয়ংক্রিয়ভাবে বার্তা পাঠানো হয় এবং উত্তর শোনানো হয়"
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                </>
              )}
              {settings.cybersec_enabled && settings.cybersec_authorization_required && (
                <button
                  onClick={() => setShowScope((v) => !v)}
                  className={`p-2.5 sm:p-3 rounded-xl transition shrink-0 ${
                    showScope || scope.scope || scope.target || scope.relationship
                      ? "bg-slate-700 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                  title="Declare testing scope"
                >
                  <ShieldCheck className="w-5 h-5" />
                </button>
              )}
              <textarea
                value={interimText || input}
                onChange={(e) => { setInput(e.target.value); setInterimText(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={listening ? (conversationMode ? "শুনছি... কথা বলুন" : "শুনছি...") : `Message ${settings.app_name}...`}
                rows={1}
                className="flex-1 min-w-0 bg-slate-800 text-slate-100 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-slate-600 max-h-32"
                style={{ minHeight: "44px" }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className={`p-2.5 sm:p-3 rounded-xl ${accent.bg} text-white disabled:opacity-40 transition shrink-0`}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            {conversationMode && (
              <div className="flex items-center justify-between bg-cyan-950/30 border border-cyan-900 rounded-lg px-3 py-2">
                <span className="text-xs text-cyan-300">কনভার্সেশন মোড চালু — কথা বললে স্বয়ংক্রিয়ভাবে পাঠানো হবে এবং উত্তর শোনানো হবে।</span>
                <button onClick={toggleConversationMode} className="text-cyan-400 hover:text-white text-xs underline">বন্ধ</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
