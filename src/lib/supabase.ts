import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

export const EDGE_URL = `${url}/functions/v1`;

// Capture whether the page loaded with a recovery/OAuth callback in the URL.
// This MUST be evaluated synchronously at module load time, BEFORE the
// Supabase client's async _initialize() runs. During _initialize(), the SDK
// detects the PKCE ?code=XXXX parameter, exchanges it for a session, and then
// DELETES the code from the URL via window.history.replaceState. By the time
// React finishes waiting for auth.loading and checks the URL, the code is
// gone. So we snapshot the flag now and export it as a mutable value that can
// be cleared once the recovery flow is consumed.
let _recoveryCallbackAtLoad = (() => {
  if (typeof window === "undefined") return false;
  const queryParams = new URLSearchParams(window.location.search);
  if (queryParams.get("code")) return true;
  if (queryParams.get("error")) return true;
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  // Skip hash-router fragments (#/admin, #/chat) — those are app routes.
  if (hash.startsWith("/")) return false;
  const hashParams = new URLSearchParams(hash);
  if (hashParams.get("type") === "recovery") return true;
  if (hashParams.get("error")) return true;
  if (hashParams.get("access_token")) return true;
  return false;
})();

export function isRecoveryCallback(): boolean {
  return _recoveryCallbackAtLoad;
}

export function clearRecoveryCallback(): void {
  _recoveryCallbackAtLoad = false;
}
