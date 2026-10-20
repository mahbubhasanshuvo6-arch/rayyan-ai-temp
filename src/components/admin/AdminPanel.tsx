import { useEffect, useState, useCallback } from "react";
import { supabase, EDGE_URL } from "@/lib/supabase";
import { useSettings, accentMap } from "@/lib/useSettings";
import type { AuthState } from "@/lib/useAuth";
import { navigate } from "@/lib/router";
import type { AppSettings, AdminStats, Project, MemoryEntry, KnowledgeEntry, UsageLog } from "@/lib/types";
import {
  LayoutDashboard, Settings, FolderGit2, Brain, BarChart3,
  LogOut, Menu, X, MessageSquare, AlertTriangle, CheckCircle2,
  DollarSign, Zap, Activity, Trash2, Loader2, KeyRound, Save,
  Sparkles, ShieldCheck, FileCode, BookOpen, Lock,
} from "lucide-react";

type Tab = "dashboard" | "settings" | "projects" | "memory" | "knowledge" | "usage";

export default function AdminPanel({ auth }: { auth: AuthState }) {
  const { settings } = useSettings();
  const accent = accentMap[settings.accent_color] ?? accentMap.blue;
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems: { id: Tab; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "projects", label: "Projects", icon: FolderGit2 },
    { id: "memory", label: "Memory", icon: Brain },
    { id: "knowledge", label: "Knowledge", icon: BookOpen },
    { id: "usage", label: "API Usage", icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <aside
        className={`fixed lg:relative z-40 h-full w-60 bg-slate-900 border-r border-slate-800 transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accent.gradient} flex items-center justify-center`}>
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold">Admin</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setTab(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                tab === item.id ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800 space-y-1">
          <button
            onClick={() => navigate("chat")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <MessageSquare className="w-4 h-4" /> Public Chat
          </button>
          <button
            onClick={() => auth.signOut().then(() => navigate("chat"))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-950/40"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-400">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold capitalize">{tab}</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {tab === "dashboard" && <DashboardTab />}
          {tab === "settings" && <SettingsTab />}
          {tab === "projects" && <ProjectsTab />}
          {tab === "memory" && <MemoryTab />}
          {tab === "knowledge" && <KnowledgeTab />}
          {tab === "usage" && <UsageTab />}
        </div>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------
function DashboardTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const jwt = supabase.auth.getSession().then(({ data }) => {
      fetch(`${EDGE_URL}/admin-api/stats`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      })
        .then((r) => r.json())
        .then((d) => setStats(d.stats))
        .finally(() => setLoading(false));
    });
    return () => void jwt;
  }, []);

  if (loading) return <Spinner />;
  if (!stats) return <p className="text-slate-400">Could not load stats.</p>;

  const cards = [
    { label: "Conversations", value: stats.total_threads, icon: MessageSquare },
    { label: "Messages", value: stats.total_messages, icon: Activity },
    { label: "Projects", value: stats.total_projects, icon: FolderGit2 },
    { label: "API Calls", value: stats.total_api_calls, icon: Zap },
    { label: "Calls (24h)", value: stats.calls_today, icon: Activity },
    { label: "Errors (24h)", value: stats.errors_today, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <c.icon className="w-4 h-4" /> {c.label}
            </div>
            <div className="text-2xl font-bold">{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <DollarSign className="w-4 h-4" /> Estimated Cost (total)
          </div>
          <div className="text-3xl font-bold text-emerald-400">
            ${stats.total_cost_usd.toFixed(4)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {stats.total_tokens.toLocaleString()} tokens used
          </p>
        </div>
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <CheckCircle2 className="w-4 h-4" /> System Status
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-lg font-semibold">Operational</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {stats.error_count} total errors
          </p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" /> Recent Errors
        </h3>
        {stats.recent_errors.length === 0 ? (
          <p className="text-sm text-slate-500">No errors recorded.</p>
        ) : (
          <div className="space-y-2">
            {stats.recent_errors.map((e, i) => (
              <div key={i} className="bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-mono text-xs text-slate-400">{e.model}</span>
                  <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <p className="text-rose-200 mt-1">{e.error}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Settings ----------
function SettingsTab() {
  const { settings, loading } = useSettings();
  const accent = accentMap[settings.accent_color] ?? accentMap.blue;
  const [form, setForm] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keyTest, setKeyTest] = useState<{ ok: boolean; error?: string; models?: string[] } | null>(null);
  const [groqTest, setGroqTest] = useState<{ ok: boolean; error?: string; models?: string[] } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingGroq, setTestingGroq] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { setForm(settings); }, [settings]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session?.access_token) {
        setSaveError("Your admin session has expired. Please log in again.");
        setSaving(false);
        return;
      }
      const res = await fetch(`${EDGE_URL}/admin-api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        setSaveError(d.error ?? `Save failed (HTTP ${res.status}).`);
        setSaving(false);
        return;
      }
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Network error while saving.");
    } finally {
      setSaving(false);
    }
  };

  const testKey = async () => {
    setTesting(true);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${EDGE_URL}/admin-api/test-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    const d = await res.json();
    setKeyTest(d);
    setTesting(false);
  };

  const testGroqKey = async () => {
    setTestingGroq(true);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${EDGE_URL}/admin-api/test-groq-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    const d = await res.json();
    setGroqTest(d);
    setTestingGroq(false);
  };

  if (loading) return <Spinner />;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="max-w-3xl space-y-6">
      {/* Appearance */}
      <Section title="App Appearance" icon={Sparkles}>
        <Field label="App Name">
          <input value={form.app_name} onChange={(e) => set("app_name", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Tagline">
          <input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Accent Color">
          <select value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} className={inputCls}>
            {Object.keys(accentMap).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </Section>

      {/* AI Provider */}
      <Section title="AI Provider" icon={KeyRound}>
        <Field label="Provider">
          <select value={form.provider} onChange={(e) => {
            const p = e.target.value;
            set("provider", p);
            if (p === "huggingface") set("model", "meta-llama/Llama-3.3-70B-Instruct");
            else if (p === "groq") set("model", "openai/gpt-oss-120b");
            else if (p === "gemini" && !form.model.startsWith("gemini")) set("model", "gemini-3.8-flash");
          }} className={inputCls}>
            <option value="gemini">Google Gemini</option>
            <option value="groq">Groq (Free)</option>
            <option value="huggingface">Hugging Face</option>
          </select>
        </Field>
        <Field label="Model">
          <input value={form.model} onChange={(e) => set("model", e.target.value)} className={inputCls} />
        </Field>
        <Field label={`Temperature (${form.temperature})`}>
          <input type="range" min="0" max="2" step="0.1" value={form.temperature}
            onChange={(e) => set("temperature", parseFloat(e.target.value))} className="w-full" />
        </Field>
        <Field label="Max Output Tokens">
          <input type="number" value={form.max_tokens} onChange={(e) => set("max_tokens", parseInt(e.target.value) || 2048)} className={inputCls} />
        </Field>
        <Field label="System Prompt">
          <textarea value={form.system_prompt} onChange={(e) => set("system_prompt", e.target.value)}
            rows={3} className={inputCls} />
        </Field>
        <div className="flex items-center gap-3">
          <button onClick={testKey} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-sm hover:bg-slate-700">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Test Gemini Key
          </button>
          {keyTest && (
            <span className={`text-sm ${keyTest.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {keyTest.ok ? `Connected (${keyTest.models?.length ?? 0} models available)` : keyTest.error}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          The Gemini API key is stored as a server secret, never in the frontend. Add it via the Supabase Edge Function secret <code className="bg-slate-800 px-1 rounded">GEMINI_API_KEY</code>.
        </p>
        {form.provider === "huggingface" && (
          <p className="text-xs text-amber-400/80 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
            Hugging Face Inference Providers-এ ফ্রি অ্যাকাউন্টে মাসে মাত্র $0.10 ক্রেডিট থাকে। ক্রেডিট শেষ হলে ব্যবহারকারীদের কাছে একটি বাংলা বার্তা দেখানো হবে। সমর্থিত মডেল: <code className="bg-slate-800 px-1 rounded">meta-llama/Llama-3.3-70B-Instruct</code>, <code className="bg-slate-800 px-1 rounded">meta-llama/Llama-3.1-8B-Instruct</code>। HF টোকেন <code className="bg-slate-800 px-1 rounded">HF_TOKEN</code> সিক্রেট হিসেবে সার্ভারে সংরক্ষিত।
          </p>
        )}
        {form.provider === "groq" && (
          <p className="text-xs text-emerald-400/80 bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-3 py-2">
            Groq একটি ফ্রি AI প্রোভাইডার — কোনো ক্রেডিট বা পেমেন্ট লাগে না। ফ্রি টিয়ারে রেট লিমিট আছে (প্রতিদিন/প্রতি মিনিট টোকেন সীমা)। সমর্থিত মডেল: <code className="bg-slate-800 px-1 rounded">openai/gpt-oss-120b</code> (কারেন্ট), <code className="bg-slate-800 px-1 rounded">openai/gpt-oss-20b</code>, <code className="bg-slate-800 px-1 rounded">qwen/qwen3.8-27b</code>। Groq কী <code className="bg-slate-800 px-1 rounded">GROQ_API_KEY</code> সিক্রেট হিসেবে সার্ভারে সংরক্ষিত। Groq প্রাইমারি হলে Gemini এবং OpenRouter স্বয়ংক্রিয়ভাবে ফলব্যাক হিসেবে কাজ করে।
          </p>
        )}
      </Section>

      {/* Fallback Provider */}
      <Section title="Fallback Provider" icon={ShieldCheck}>
        <Toggle label="Enable fallback when primary fails" value={form.fallback_enabled} onChange={(v) => set("fallback_enabled", v)} />
        <Field label="Fallback Provider">
          <select value={form.fallback_provider} onChange={(e) => set("fallback_provider", e.target.value)} className={inputCls}>
            <option value="groq">Groq</option>
          </select>
        </Field>
        <Field label="Fallback Model">
          <input value={form.fallback_model} onChange={(e) => set("fallback_model", e.target.value)} className={inputCls} />
        </Field>
        <div className="flex items-center gap-3">
          <button onClick={testGroqKey} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-sm hover:bg-slate-700">
            {testingGroq ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Test Groq Key
          </button>
          {groqTest && (
            <span className={`text-sm ${groqTest.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {groqTest.ok ? `Connected (${groqTest.models?.length ?? 0} models available)` : groqTest.error}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Fallback requires a valid <code className="bg-slate-800 px-1 rounded">GROQ_API_KEY</code> secret. When the primary provider returns a rate-limit, quota, or temporary-outage error, the assistant retries once on Groq. Fallback is still subject to Groq's quotas and terms — it is not unlimited free AI.
        </p>
      </Section>

      {/* Cybersecurity */}
      <Section title="Cybersecurity" icon={ShieldCheck}>
        <Toggle label="Cybersecurity instruction set" value={form.cybersec_enabled} onChange={(v) => set("cybersec_enabled", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          Adds structured cybersecurity teaching, code review, and authorized-testing guidance to the system prompt. Applies to both Gemini and Groq.
        </p>
        <Toggle label="Require declared authorization scope for active testing" value={form.cybersec_authorization_required} onChange={(v) => set("cybersec_authorization_required", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          When on, Rayyan asks the user to declare a testing scope (own app, CTF, local lab) before helping with active testing against a live target. Does not block educational or defensive questions.
        </p>
      </Section>

      {/* Assistant Tools */}
      <Section title="Assistant Tools" icon={Sparkles}>
        <Toggle label="Web research (fetch public URLs)" value={form.tool_web_search_enabled} onChange={(v) => set("tool_web_search_enabled", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          Lets the AI read a public web page to answer research questions. SSRF-guarded: private/local addresses and non-text content are blocked.
        </p>
        <Toggle label="Persistent memory (save user facts)" value={form.tool_memory_enabled} onChange={(v) => set("tool_memory_enabled", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          Lets the AI save facts about the user to memory. Existing memory entries are preserved.
        </p>
        <Toggle label="Code security review" value={form.tool_code_review_enabled} onChange={(v) => set("tool_code_review_enabled", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          Lets the AI produce structured security findings (severity, evidence, impact, remediation, verification) for user-submitted code. Code is reviewed, never executed.
        </p>
        <Toggle label="Knowledge library (save user notes/docs)" value={form.tool_knowledge_enabled} onChange={(v) => set("tool_knowledge_enabled", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          Lets the AI save user-supplied cybersecurity notes and documentation to a per-user knowledge library, then retrieve relevant entries for future questions.
        </p>
        <Toggle label="Dependency vulnerability check (OSV.dev)" value={form.tool_deps_check_enabled} onChange={(v) => set("tool_deps_check_enabled", v)} />
        <p className="text-xs text-slate-500 -mt-2">
          Lets the AI check a package list against the free OSV.dev advisory database. No API key, no paid service.
        </p>
        <p className="text-xs text-slate-500">
          No code execution is enabled. The AI reviews code and checks dependencies but does not run them.
        </p>
      </Section>

      {/* Feature toggles */}
      <Section title="Features" icon={CheckCircle2}>
        <Toggle label="Chat" value={form.chat_enabled} onChange={(v) => set("chat_enabled", v)} />
        <Toggle label="Voice" value={form.voice_enabled} onChange={(v) => set("voice_enabled", v)} />
        <Toggle label="App Builder" value={form.app_builder_enabled} onChange={(v) => set("app_builder_enabled", v)} />
        <Toggle label="Show usage costs to admin" value={form.show_usage_costs} onChange={(v) => set("show_usage_costs", v)} />
      </Section>

      <button
        onClick={save}
        disabled={saving}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg ${accent.bg} text-white font-medium disabled:opacity-40`}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saved ? "Saved!" : "Save Settings"}
      </button>
      {saveError && (
        <p className="text-sm text-rose-400 mt-2">{saveError}</p>
      )}
    </div>
  );
}

// ---------- Projects ----------
function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${EDGE_URL}/admin-api/projects`, {
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    const d = await res.json();
    setProjects(d.projects ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    if (!confirm("Permanently delete this project and all its files?")) return;
    const { data: sess } = await supabase.auth.getSession();
    await fetch(`${EDGE_URL}/admin-api/projects/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      {projects.length === 0 ? (
        <p className="text-slate-500">No projects yet.</p>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <div key={p.id} className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-4">
              <FileCode className="w-8 h-8 text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-sm text-slate-400 truncate">{p.prompt}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(p.created_at).toLocaleString()} · {p.status}
                </div>
              </div>
              <button onClick={() => del(p.id)} className="text-slate-500 hover:text-rose-400 p-2">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Memory ----------
function MemoryTab() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${EDGE_URL}/admin-api/memory`, {
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    const d = await res.json();
    setEntries(d.entries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    if (!confirm("Delete this memory entry?")) return;
    const { data: sess } = await supabase.auth.getSession();
    await fetch(`${EDGE_URL}/admin-api/memory/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    load();
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL memory entries? This cannot be undone.")) return;
    const { data: sess } = await supabase.auth.getSession();
    await fetch(`${EDGE_URL}/admin-api/memory/clear-all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">{entries.length} memory entries</p>
        {entries.length > 0 && (
          <button onClick={clearAll} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm hover:bg-rose-950/60">
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-slate-500">No memory entries.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((m) => (
            <div key={m.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3 flex items-start gap-3">
              <div className="flex-1 text-sm">{m.content}</div>
              <button onClick={() => del(m.id)} className="text-slate-500 hover:text-rose-400">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Knowledge ----------
function KnowledgeTab() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${EDGE_URL}/admin-api/knowledge`, {
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    const d = await res.json();
    setEntries(d.entries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    if (!confirm("Delete this knowledge entry?")) return;
    const { data: sess } = await supabase.auth.getSession();
    await fetch(`${EDGE_URL}/admin-api/knowledge/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    load();
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL knowledge entries? This cannot be undone.")) return;
    const { data: sess } = await supabase.auth.getSession();
    await fetch(`${EDGE_URL}/admin-api/knowledge/clear-all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">{entries.length} knowledge entries</p>
        {entries.length > 0 && (
          <button onClick={clearAll} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm hover:bg-rose-950/60">
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-slate-500">No knowledge entries yet. Users can ask Rayyan to save notes and documentation during chat.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((k) => (
            <div key={k.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3 flex items-start gap-3">
              <BookOpen className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{k.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {k.source}{k.tags && k.tags.length > 0 ? ` · ${k.tags.join(", ")}` : ""}
                </div>
                <div className="text-sm text-slate-300 mt-1 line-clamp-3">{k.content}</div>
              </div>
              <button onClick={() => del(k.id)} className="text-slate-500 hover:text-rose-400 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Usage ----------
function UsageTab() {
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const perPage = 50;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${EDGE_URL}/admin-api/usage?page=${p}`, {
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    const d = await res.json();
    setLogs(d.logs ?? []);
    setTotal(d.total ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  const totalPages = Math.ceil(total / perPage);

  if (loading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-slate-400 mb-4">{total} total API calls</p>
      {logs.length === 0 ? (
        <p className="text-slate-500">No API calls logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-800">
                <th className="py-2 px-2">Time</th>
                <th className="py-2 px-2">Feature</th>
                <th className="py-2 px-2">Model</th>
                <th className="py-2 px-2 text-right">Tokens</th>
                <th className="py-2 px-2 text-right">Cost</th>
                <th className="py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/50">
                  <td className="py-2 px-2 text-slate-400 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="py-2 px-2">{l.feature}</td>
                  <td className="py-2 px-2 font-mono text-xs">{l.model}</td>
                  <td className="py-2 px-2 text-right">{l.total_tokens}</td>
                  <td className="py-2 px-2 text-right text-emerald-400">${l.estimated_cost_usd.toFixed(5)}</td>
                  <td className="py-2 px-2">
                    {l.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded bg-slate-800 text-sm disabled:opacity-30">Prev</button>
              <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded bg-slate-800 text-sm disabled:opacity-30">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Helpers ----------
const inputCls = "w-full bg-slate-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-600";

function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Icon className="w-4 h-4" /> {title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition ${value ? "bg-emerald-600" : "bg-slate-700"}`}
      >
        <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0.5"} mt-0.5`} />
      </button>
    </div>
  );
}
