import { useEffect, useState, useCallback } from "react";
import { supabase, EDGE_URL } from "@/lib/supabase";
import { useSettings, accentMap } from "@/lib/useSettings";
import type { AuthState } from "@/lib/useAuth";
import { navigate } from "@/lib/router";
import type {
  AppSettings, AdminStats, AdminRole, AdminUser, AuditEvent,
  Project, MemoryEntry, KnowledgeEntry, UsageLog,
} from "@/lib/types";
import {
  LayoutDashboard, Settings, FolderGit2, Brain, BarChart3,
  LogOut, Menu, X, MessageSquare, AlertTriangle, CheckCircle2,
  DollarSign, Zap, Activity, Trash2, Loader2, KeyRound, Save,
  Sparkles, ShieldCheck, FileCode, BookOpen, Users, ScrollText,
  UserCog, Ban, ShieldOff, Search, Crown, UserCheck, XCircle,
} from "lucide-react";

type Tab = "dashboard" | "users" | "audit" | "settings" | "projects" | "memory" | "knowledge" | "usage";

function getAuthToken(): Promise<string> {
  return supabase.auth.getSession().then(({ data }) => data.session?.access_token ?? "");
}

function roleLabel(role: AdminRole): string {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "Support";
}

function roleBadge(role: AdminRole | null, suspended: boolean) {
  if (!role) return null;
  if (suspended) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-950/50 border border-rose-800 text-rose-300">
        <ShieldOff className="w-3 h-3" /> Suspended
      </span>
    );
  }
  const cls = role === "super_admin"
    ? "bg-amber-950/50 border-amber-700 text-amber-300"
    : role === "admin"
    ? "bg-cyan-950/50 border-cyan-800 text-cyan-300"
    : "bg-slate-800 border-slate-600 text-slate-300";
  const Icon = role === "super_admin" ? Crown : role === "admin" ? ShieldCheck : UserCheck;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      <Icon className="w-3 h-3" /> {roleLabel(role)}
    </span>
  );
}

export default function AdminPanel({ auth }: { auth: AuthState }) {
  const { settings } = useSettings();
  const accent = accentMap[settings.accent_color] ?? accentMap.blue;
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const role = auth.adminRole;

  const allNavItems: { id: Tab; label: string; icon: any; roles: AdminRole[] }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin", "admin", "support"] },
    { id: "users", label: "Users", icon: Users, roles: ["super_admin"] },
    { id: "audit", label: "Audit Logs", icon: ScrollText, roles: ["super_admin", "admin", "support"] },
    { id: "settings", label: "Settings", icon: Settings, roles: ["super_admin", "admin"] },
    { id: "projects", label: "Projects", icon: FolderGit2, roles: ["super_admin", "admin"] },
    { id: "memory", label: "Memory", icon: Brain, roles: ["super_admin", "admin"] },
    { id: "knowledge", label: "Knowledge", icon: BookOpen, roles: ["super_admin", "admin"] },
    { id: "usage", label: "API Usage", icon: BarChart3, roles: ["super_admin", "admin", "support"] },
  ];

  const navItems = allNavItems.filter((item) =>
    role ? item.roles.includes(role) : false
  );

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
            <div>
              <div className="font-semibold text-sm">Admin Panel</div>
              {role && <div className="text-[10px] text-slate-500">{roleLabel(role)}</div>}
            </div>
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
          <h1 className="text-lg font-semibold capitalize flex-1">{tab === "audit" ? "Audit Logs" : tab}</h1>
          {auth.session?.user?.email && (
            <span className="text-xs text-slate-500 hidden sm:block truncate max-w-[200px]">{auth.session.user.email}</span>
          )}
          {role && roleBadge(role, false)}
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {tab === "dashboard" && <DashboardTab />}
          {tab === "users" && <UsersTab currentUserId={auth.session?.user?.id ?? ""} />}
          {tab === "audit" && <AuditTab />}
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
  const [role, setRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthToken().then((token) => {
      fetch(`${EDGE_URL}/admin-api/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok || d.error) {
            setError(d.error ?? `Failed to load dashboard data (HTTP ${r.status}).`);
            return;
          }
          if (d.stats === null || d.stats === undefined) {
            setError("The server returned no statistics. This may indicate a permissions issue with your admin account.");
            return;
          }
          setStats(d.stats as AdminStats);
          setRole(d.role ?? null);
        })
        .catch(() => setError("Could not reach the server. Please check your connection and try again."))
        .finally(() => setLoading(false));
    });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!stats) return <ErrorBox message="No dashboard data received from the server." />;

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
          <EmptyState text="No errors recorded." />
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

// ---------- Users ----------
function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "grant" | "revoke" | "suspend" | "unsuspend" | "ban" | "unban";
    userId: string;
    email: string;
    role?: AdminRole;
  } | null>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    const token = await getAuthToken();
    const params = q ? `?search=${encodeURIComponent(q)}` : "";
    const res = await fetch(`${EDGE_URL}/admin-api/users${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? "Failed to load users"); }
    setUsers(d.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const doAction = async () => {
    if (!confirmAction) return;
    setActionLoading(confirmAction.userId + confirmAction.type);
    const token = await getAuthToken();
    try {
      let endpoint = "";
      let body: Record<string, unknown> = { userId: confirmAction.userId };
      if (confirmAction.type === "grant") {
        endpoint = "/users/grant";
        body.role = confirmAction.role ?? "admin";
      } else if (confirmAction.type === "revoke") {
        endpoint = "/users/revoke";
      } else if (confirmAction.type === "suspend" || confirmAction.type === "unsuspend") {
        endpoint = "/users/suspend";
        body.suspended = confirmAction.type === "suspend";
      } else if (confirmAction.type === "ban" || confirmAction.type === "unban") {
        endpoint = "/users/ban";
        body.banned = confirmAction.type === "ban";
      }
      const res = await fetch(`${EDGE_URL}/admin-api${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Action failed"); }
      else { setError(null); load(search); }
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  };

  const confirmText = confirmAction ? {
    grant: `Grant ${roleLabel(confirmAction.role ?? "admin")} role to ${confirmAction.email}?`,
    revoke: `Revoke admin privileges from ${confirmAction.email}? They will lose all admin access.`,
    suspend: `Suspend admin ${confirmAction.email}? They will be unable to access the admin panel.`,
    unsuspend: `Restore admin access for ${confirmAction.email}?`,
    ban: `Ban user ${confirmAction.email}? They will be unable to sign in.`,
    unban: `Unban user ${confirmAction.email}?`,
  }[confirmAction.type] : "";

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(search); }}
            placeholder="Search by email..."
            className="w-full bg-slate-900 text-white rounded-lg pl-10 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-600 border border-slate-800"
          />
        </div>
        <button
          onClick={() => load(search)}
          className="px-4 py-2 rounded-lg bg-slate-800 text-sm hover:bg-slate-700"
        >
          Search
        </button>
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState text="No users found." />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="bg-slate-900 rounded-xl border border-slate-800 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{u.email}</span>
                    {u.banned && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-950/50 border border-rose-800 text-rose-300">
                        <Ban className="w-3 h-3" /> Banned
                      </span>
                    )}
                    {roleBadge(u.admin_role, u.admin_suspended)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Joined {new Date(u.created_at).toLocaleDateString()}
                    {u.last_sign_in_at && ` · Last sign-in ${new Date(u.last_sign_in_at).toLocaleDateString()}`}
                  </div>
                </div>
                {u.id !== currentUserId && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {!u.admin_role && (
                      <IconBtn
                        icon={ShieldCheck}
                        label="Make Admin"
                        onClick={() => setConfirmAction({ type: "grant", userId: u.id, email: u.email, role: "admin" })}
                        color="cyan"
                      />
                    )}
                    {u.admin_role && (
                      <>
                        {u.admin_role !== "super_admin" && (
                          <IconBtn
                            icon={Crown}
                            label="Super Admin"
                            onClick={() => setConfirmAction({ type: "grant", userId: u.id, email: u.email, role: "super_admin" })}
                            color="amber"
                          />
                        )}
                        {u.admin_role !== "support" && (
                          <IconBtn
                            icon={UserCheck}
                            label="Support"
                            onClick={() => setConfirmAction({ type: "grant", userId: u.id, email: u.email, role: "support" })}
                            color="slate"
                          />
                        )}
                        {u.admin_suspended ? (
                          <IconBtn
                            icon={ShieldCheck}
                            label="Restore"
                            onClick={() => setConfirmAction({ type: "unsuspend", userId: u.id, email: u.email })}
                            color="emerald"
                          />
                        ) : (
                          <IconBtn
                            icon={ShieldOff}
                            label="Suspend"
                            onClick={() => setConfirmAction({ type: "suspend", userId: u.id, email: u.email })}
                            color="rose"
                          />
                        )}
                        <IconBtn
                          icon={XCircle}
                          label="Revoke"
                          onClick={() => setConfirmAction({ type: "revoke", userId: u.id, email: u.email })}
                          color="rose"
                        />
                      </>
                    )}
                    {u.banned ? (
                      <IconBtn
                        icon={CheckCircle2}
                        label="Unban"
                        onClick={() => setConfirmAction({ type: "unban", userId: u.id, email: u.email })}
                        color="emerald"
                      />
                    ) : (
                      <IconBtn
                        icon={Ban}
                        label="Ban"
                        onClick={() => setConfirmAction({ type: "ban", userId: u.id, email: u.email })}
                        color="rose"
                      />
                    )}
                  </div>
                )}
                {u.id === currentUserId && (
                  <span className="text-xs text-slate-500 italic">You</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          text={confirmText}
          loading={actionLoading === confirmAction.userId + confirmAction.type}
          onConfirm={doAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

// ---------- Audit Logs ----------
function AuditTab() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthToken().then((token) => {
      fetch(`${EDGE_URL}/admin-api/events`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) { setError(d.error); return; }
          setEvents(d.events ?? []);
        })
        .catch(() => setError("Failed to load audit logs."))
        .finally(() => setLoading(false));
    });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="max-w-4xl">
      {events.length === 0 ? (
        <EmptyState text="No audit events recorded yet." />
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    e.outcome === "success" ? "bg-emerald-400" :
                    e.outcome === "denied" ? "bg-rose-400" : "bg-amber-400"
                  }`} />
                  <span className="font-medium">{e.action}</span>
                  {e.target_type && (
                    <span className="text-xs text-slate-500">→ {e.target_type}: {e.target ?? "—"}</span>
                  )}
                </div>
                <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Actor: {e.admin_id ? e.admin_id.slice(0, 8) : "system"} · {e.outcome}
              </div>
            </div>
          ))}
        </div>
      )}
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
      const token = await getAuthToken();
      const res = await fetch(`${EDGE_URL}/admin-api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) { setSaveError(d.error ?? "Save failed."); setSaving(false); return; }
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { setSaveError("Network error while saving."); }
    finally { setSaving(false); }
  };

  const testKey = async () => {
    setTesting(true);
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/test-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setKeyTest(await res.json());
    setTesting(false);
  };

  const testGroqKey = async () => {
    setTestingGroq(true);
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/test-groq-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroqTest(await res.json());
    setTestingGroq(false);
  };

  if (loading) return <Spinner />;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="max-w-3xl space-y-6">
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
          The Gemini API key is stored as a server secret, never in the frontend.
        </p>
      </Section>

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
      </Section>

      <Section title="Cybersecurity" icon={ShieldCheck}>
        <Toggle label="Cybersecurity instruction set" value={form.cybersec_enabled} onChange={(v) => set("cybersec_enabled", v)} />
        <Toggle label="Require declared authorization scope" value={form.cybersec_authorization_required} onChange={(v) => set("cybersec_authorization_required", v)} />
      </Section>

      <Section title="Assistant Tools" icon={Sparkles}>
        <Toggle label="Web research" value={form.tool_web_search_enabled} onChange={(v) => set("tool_web_search_enabled", v)} />
        <Toggle label="Persistent memory" value={form.tool_memory_enabled} onChange={(v) => set("tool_memory_enabled", v)} />
        <Toggle label="Code security review" value={form.tool_code_review_enabled} onChange={(v) => set("tool_code_review_enabled", v)} />
        <Toggle label="Knowledge library" value={form.tool_knowledge_enabled} onChange={(v) => set("tool_knowledge_enabled", v)} />
        <Toggle label="Dependency vulnerability check" value={form.tool_deps_check_enabled} onChange={(v) => set("tool_deps_check_enabled", v)} />
      </Section>

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
      {saveError && <p className="text-sm text-rose-400 mt-2">{saveError}</p>}
    </div>
  );
}

// ---------- Projects ----------
function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? "Failed to load"); }
    setProjects(d.projects ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/projects/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { setError("Delete failed"); }
    setConfirmId(null);
    load();
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="max-w-4xl">
      {projects.length === 0 ? (
        <EmptyState text="No projects yet." />
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
              <button
                onClick={() => setConfirmId(p.id)}
                className="text-slate-500 hover:text-rose-400 p-2"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmId && (
        <ConfirmDialog
          text="Permanently delete this project and all its files? This cannot be undone."
          onConfirm={() => del(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}

// ---------- Memory ----------
function MemoryTab() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const load = useCallback(async () => {
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/memory`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    setEntries(d.entries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    const token = await getAuthToken();
    await fetch(`${EDGE_URL}/admin-api/memory/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setConfirmId(null);
    load();
  };

  const clearAll = async () => {
    const token = await getAuthToken();
    await fetch(`${EDGE_URL}/admin-api/memory/clear-all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setConfirmClearAll(false);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">{entries.length} memory entries</p>
        {entries.length > 0 && (
          <button onClick={() => setConfirmClearAll(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm hover:bg-rose-950/60">
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <EmptyState text="No memory entries." />
      ) : (
        <div className="space-y-2">
          {entries.map((m) => (
            <div key={m.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3 flex items-start gap-3">
              <div className="flex-1 text-sm">{m.content}</div>
              <button onClick={() => setConfirmId(m.id)} className="text-slate-500 hover:text-rose-400">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmId && (
        <ConfirmDialog text="Delete this memory entry?" onConfirm={() => del(confirmId)} onCancel={() => setConfirmId(null)} />
      )}
      {confirmClearAll && (
        <ConfirmDialog text="Delete ALL memory entries? This cannot be undone." onConfirm={clearAll} onCancel={() => setConfirmClearAll(false)} />
      )}
    </div>
  );
}

// ---------- Knowledge ----------
function KnowledgeTab() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const load = useCallback(async () => {
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/knowledge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    setEntries(d.entries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    const token = await getAuthToken();
    await fetch(`${EDGE_URL}/admin-api/knowledge/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setConfirmId(null);
    load();
  };

  const clearAll = async () => {
    const token = await getAuthToken();
    await fetch(`${EDGE_URL}/admin-api/knowledge/clear-all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setConfirmClearAll(false);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">{entries.length} knowledge entries</p>
        {entries.length > 0 && (
          <button onClick={() => setConfirmClearAll(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm hover:bg-rose-950/60">
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <EmptyState text="No knowledge entries yet." />
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
              <button onClick={() => setConfirmId(k.id)} className="text-slate-500 hover:text-rose-400 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmId && (
        <ConfirmDialog text="Delete this knowledge entry?" onConfirm={() => del(confirmId)} onCancel={() => setConfirmId(null)} />
      )}
      {confirmClearAll && (
        <ConfirmDialog text="Delete ALL knowledge entries? This cannot be undone." onConfirm={clearAll} onCancel={() => setConfirmClearAll(false)} />
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
    const token = await getAuthToken();
    const res = await fetch(`${EDGE_URL}/admin-api/usage?page=${p}`, {
      headers: { Authorization: `Bearer ${token}` },
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
        <EmptyState text="No API calls logged yet." />
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

// ---------- Shared UI ----------
const inputCls = "w-full bg-slate-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-600";

function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-xl px-4 py-3 text-sm">
      {message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-slate-500 text-sm py-8 text-center">{text}</p>;
}

function ConfirmDialog({
  text, onConfirm, onCancel, loading,
}: {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 p-6 max-w-md w-full">
        <p className="text-sm text-slate-200 mb-5">{text}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-slate-800 text-sm text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-500 disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  icon: Icon, label, onClick, color,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  color: "cyan" | "amber" | "rose" | "emerald" | "slate";
}) {
  const colorMap = {
    cyan: "text-cyan-400 hover:bg-cyan-950/40",
    amber: "text-amber-400 hover:bg-amber-950/40",
    rose: "text-rose-400 hover:bg-rose-950/40",
    emerald: "text-emerald-400 hover:bg-emerald-950/40",
    slate: "text-slate-400 hover:bg-slate-800",
  };
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 rounded-lg transition ${colorMap[color]}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
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
