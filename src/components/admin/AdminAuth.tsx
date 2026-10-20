import { useEffect, useState } from "react";
import { supabase, EDGE_URL, clearRecoveryCallback } from "@/lib/supabase";
import { useSettings, accentMap } from "@/lib/useSettings";
import type { AuthState } from "@/lib/useAuth";
import { navigate } from "@/lib/router";
import {
  Lock, Mail, KeyRound, Loader2, ShieldCheck, ArrowLeft, AlertCircle,
} from "lucide-react";

type Mode = "login" | "setup" | "forgot" | "reset";
type ResetState = "exchanging" | "ready" | "error" | "done";

// Bengali error messages for recovery link problems.
function bengaliRecoveryError(
  errorCode?: string,
  errorDescription?: string,
  fallback?: string,
): string {
  if (errorCode === "otp_expired" || errorCode === "access_denied") {
    return "এই রিকভারি লিংকটির মেয়াদ শেষ হয়ে গেছে বা ইতিমধ্যে ব্যবহার করা হয়েছে। অনুগ্রহ করে একটি নতুন লিংকের জন্য অনুরোধ করুন।";
  }
  if (errorCode === "user_not_found") {
    return "এই ইমেল ঠিকানার সাথে কোনো অ্যাকাউন্ট পাওয়া যায়নি।";
  }
  if (errorDescription) {
    return `রিকভারি লিংক যাচাই করা যায়নি: ${errorDescription}`;
  }
  return fallback ?? "এই রিকভারি লিংকটি বৈধ নয়। অনুগ্রহ করে একটি নতুন লিংকের জন্য অনুরোধ করুন।";
}

// Check for error params in the URL (e.g. #error=access_denied&error_code=otp_expired
// or ?error=...). Returns the parsed error info if present.
function getRecoveryErrorFromUrl(): { errorCode?: string; errorDescription?: string } | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash.startsWith("/")) {
    const hashParams = new URLSearchParams(hash);
    if (hashParams.get("error")) {
      return {
        errorCode: hashParams.get("error_code") ?? undefined,
        errorDescription: hashParams.get("error_description") ?? undefined,
      };
    }
  }
  const queryParams = new URLSearchParams(window.location.search);
  if (queryParams.get("error")) {
    return {
      errorCode: queryParams.get("error_code") ?? undefined,
      errorDescription: queryParams.get("error_description") ?? undefined,
    };
  }
  return null;
}

export default function AdminAuth({
  auth,
  onAuthed,
  recoveryMode = false,
}: {
  auth: AuthState;
  onAuthed: () => void;
  recoveryMode?: boolean;
}) {
  const { settings } = useSettings();
  const accent = accentMap[settings.accent_color] ?? accentMap.blue;
  const [mode, setMode] = useState<Mode>(recoveryMode ? "reset" : "login");
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetState, setResetState] = useState<ResetState>("exchanging");
  const [resetError, setResetError] = useState<string | null>(null);

  // Check setup status (skip in recovery mode).
  useEffect(() => {
    if (recoveryMode) return;
    fetch(`${EDGE_URL}/admin-api/setup-status`)
      .then((r) => r.json())
      .then((d) => {
        setSetupRequired(d.setupRequired);
        if (d.setupRequired) setMode("setup");
      })
      .catch(() => setSetupRequired(false));
  }, [recoveryMode]);

  // Recovery mode: wait for the Supabase client to establish a session from
  // the recovery callback URL. With detectSessionInUrl + PKCE flow, the
  // client's async _initialize() exchanges the ?code=XXXX parameter and fires
  // SIGNED_IN. We do NOT call exchangeCodeForSession ourselves — the SDK does
  // it during initialization, and calling it again would fail (code already
  // consumed). We listen for SIGNED_IN / PASSWORD_RECOVERY / INITIAL_SESSION.
  useEffect(() => {
    if (mode !== "reset") return;

    // First, check for error params in the URL (expired/invalid link).
    const urlError = getRecoveryErrorFromUrl();
    if (urlError) {
      setResetState("error");
      setResetError(bengaliRecoveryError(urlError.errorCode, urlError.errorDescription));
      clearRecoveryCallback();
      return;
    }

    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setResetState("ready");
    };

    // Poll getSession() a few times — _initialize() is async and may not have
    // finished when this effect runs. The SDK fires SIGNED_IN through
    // onAuthStateChange, but if the session is already established by the
    // time we subscribe, we'll only get INITIAL_SESSION (which also carries
    // the session). Both paths are handled below.
    supabase.auth.getSession().then(({ data }) => {
      if (settled) return;
      if (data.session) {
        markReady();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (settled) return;
      if (
        (event === "PASSWORD_RECOVERY" ||
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION") &&
        sess
      ) {
        markReady();
      } else if (event === "SIGNED_OUT") {
        settled = true;
        setResetState("error");
        setResetError(bengaliRecoveryError());
        clearRecoveryCallback();
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setResetState("error");
        setResetError(bengaliRecoveryError());
        clearRecoveryCallback();
      }
    }, 15000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [mode]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    onAuthed();
  };

  const handleSetup = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`${EDGE_URL}/admin-api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, setupKey }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Setup failed.");
      return;
    }
    // Auto-login after setup.
    const { error: le } = await supabase.auth.signInWithPassword({ email, password });
    if (le) {
      setError("Account created. Please log in.");
      setMode("login");
      return;
    }
    onAuthed();
  };

  const handleForgotPassword = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    const redirectTo = window.location.origin + "/";
    const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setInfo("Recovery link sent. Check your email inbox to continue.");
  };

  const handleResetPassword = async () => {
    setError(null);
    setInfo(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: e } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setResetState("done");
    setInfo("পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে। অ্যাডমিন প্যানেলে পুনঃনির্দেশিত হচ্ছে...");
    setTimeout(() => {
      window.history.replaceState({}, "", window.location.pathname);
      clearRecoveryCallback();
      navigate("admin");
      onAuthed();
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className={`inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br ${accent.gradient} items-center justify-center mb-4`}>
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {mode === "setup"
              ? "Admin Setup"
              : mode === "forgot"
              ? "Recover Password"
              : mode === "reset"
              ? "Reset Password"
              : "Admin Panel"}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {mode === "setup"
              ? "Create the first administrator account"
              : mode === "forgot"
              ? "Enter your admin email to receive a recovery link"
              : mode === "reset"
              ? "Choose a new password for your admin account"
              : settings.app_name}
          </p>
        </div>

        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4">
          {mode === "setup" && (
            <div className="bg-amber-950/40 border border-amber-800 rounded-lg p-3 text-sm text-amber-200">
              This one-time setup creates the first admin. You'll need the
              setup key (an environment secret). After this, setup is locked.
            </div>
          )}

          {/* ---- Reset mode (recovery link clicked) ---- */}
          {mode === "reset" && resetState === "exchanging" && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              <span className="ml-3 text-sm text-slate-400">Verifying recovery link…</span>
            </div>
          )}

          {mode === "reset" && resetState === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-rose-950/50 border border-rose-800 text-rose-200 rounded-lg px-3 py-3 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{resetError}</span>
              </div>
              <button
                onClick={() => {
                  window.history.replaceState({}, "", window.location.pathname);
                  clearRecoveryCallback();
                  setMode("forgot");
                  setResetState("exchanging");
                  setResetError(null);
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition"
              >
                <ArrowLeft className="w-4 h-4" /> নতুন রিকভারি লিংকের জন্য অনুরোধ করুন
              </button>
            </div>
          )}

          {mode === "reset" && resetState === "ready" && (
            <>
              <div>
                <label className="block text-sm text-slate-400 mb-1">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                    placeholder="At least 8 characters"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                    placeholder="Re-enter new password"
                  />
                </div>
              </div>
              {error && (
                <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-lg px-3 py-2 text-sm">
                  {error}
                </div>
              )}
              <button
                onClick={handleResetPassword}
                disabled={loading || !newPassword || !confirmPassword}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg ${accent.bg} text-white font-medium disabled:opacity-40 transition`}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Update Password
              </button>
            </>
          )}

          {mode === "reset" && resetState === "done" && (
            <div className="flex items-center justify-center py-8">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
              <span className="ml-3 text-sm text-emerald-300">পাসওয়ার্ড পরিবর্তন হয়েছে। পুনঃনির্দেশিত হচ্ছে…</span>
            </div>
          )}

          {/* ---- Forgot password mode ---- */}
          {mode === "forgot" && (
            <>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                    placeholder="admin@example.com"
                  />
                </div>
              </div>
              {error && (
                <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-lg px-3 py-2 text-sm">
                  {error}
                </div>
              )}
              {info && (
                <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-200 rounded-lg px-3 py-2 text-sm">
                  {info}
                </div>
              )}
              <button
                onClick={handleForgotPassword}
                disabled={loading || !email}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg ${accent.bg} text-white font-medium disabled:opacity-40 transition`}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Send Recovery Link
              </button>
              <button
                onClick={() => { setMode("login"); setError(null); setInfo(null); }}
                className="w-full flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to login
              </button>
            </>
          )}

          {/* ---- Login / Setup modes ---- */}
          {(mode === "login" || mode === "setup") && (
            <>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                    placeholder="admin@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                    placeholder={mode === "setup" ? "At least 8 characters" : "••••••••"}
                  />
                </div>
              </div>

              {mode === "setup" && (
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Setup Key</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="password"
                      value={setupKey}
                      onChange={(e) => setSetupKey(e.target.value)}
                      className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                      placeholder="ADMIN_SETUP_KEY"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-lg px-3 py-2 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={mode === "setup" ? handleSetup : handleLogin}
                disabled={loading || !email || !password}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg ${accent.bg} text-white font-medium disabled:opacity-40 transition`}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {mode === "setup" ? "Create Admin Account" : "Sign In"}
              </button>

              {mode === "login" && (
                <button
                  onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}
                  className="w-full text-sm text-slate-400 hover:text-white"
                >
                  Forgot password?
                </button>
              )}

              {setupRequired === false && mode === "setup" && (
                <button onClick={() => setMode("login")} className="w-full text-sm text-slate-400 hover:text-white">
                  An admin already exists — go to login
                </button>
              )}
              {setupRequired === true && mode === "login" && (
                <button onClick={() => setMode("setup")} className="w-full text-sm text-slate-400 hover:text-white">
                  No admin yet — run setup
                </button>
              )}
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Protected area. Unauthorized access is blocked.
        </p>
      </div>
    </div>
  );
}
