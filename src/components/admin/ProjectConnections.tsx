import { useMemo, useState } from "react";
import {
  ExternalLink, ShieldCheck, ShieldAlert, Copy, Check,
  Database, KeyRound, Info, AlertTriangle,
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const FALLBACK_REF = "dckptkibasswiqupmano";

function extractProjectRef(url?: string): string | null {
  if (!url) return null;
  try {
    const m = new URL(url).host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2 text-slate-100">
        <Icon className="w-4 h-4 text-slate-400" /> {title}
      </h3>
      {children}
    </div>
  );
}

function StatusRow({ label, present, note }: { label: string; present: boolean; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-800 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {note && <div className="text-xs text-slate-500 mt-0.5">{note}</div>}
      </div>
      <span
        className={`shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
          present
            ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
            : "bg-rose-950/40 border-rose-800 text-rose-300"
        }`}
      >
        {present ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
        {present ? "Configured" : "Missing"}
      </span>
    </div>
  );
}

export default function ProjectConnections() {
  const urlPresent = Boolean(SUPABASE_URL);
  const anonKeyPresent = Boolean(SUPABASE_ANON_KEY);
  const parsedRef = useMemo(() => extractProjectRef(SUPABASE_URL), []);
  const ref = parsedRef ?? FALLBACK_REF;
  const [copied, setCopied] = useState(false);

  const checks = [urlPresent, anonKeyPresent, Boolean(parsedRef)];
  const passed = checks.filter(Boolean).length;
  const allPassed = passed === checks.length;

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${allPassed ? "bg-emerald-950/50" : "bg-amber-950/50"}`}>
          {allPassed ? <ShieldCheck className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-amber-400" />}
        </div>
        <div>
          <div className="font-semibold text-slate-100">Connection Diagnostics</div>
          <div className="text-sm text-slate-400">{passed} of {checks.length} client-side checks passed.</div>
        </div>
      </div>

      <Section title="Open Existing Supabase Project" icon={ExternalLink}>
        {parsedRef ? (
          <>
            <p className="text-sm text-slate-400 mb-3">
              Open the project only from a Google account that owns it.
            </p>
            <a
              href={`https://supabase.com/dashboard/project/${parsedRef}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-sm text-slate-100 hover:bg-slate-700 transition"
            >
              <ExternalLink className="w-4 h-4" /> Open Supabase Dashboard
            </a>
            <p className="text-xs text-slate-500 mt-3">
              If you see "You do not have access to this project," the signed-in Google account is not the owner. Try another account.
            </p>
          </>
        ) : (
          <p className="text-sm text-amber-300">Not identified yet. The Supabase URL could not be read in this environment.</p>
        )}
      </Section>

      <Section title="Connection Status" icon={Database}>
        <StatusRow label="Supabase URL" present={urlPresent} note="Public endpoint used by the app." />
        <StatusRow label="Anon Key" present={anonKeyPresent} note="Public key, safe for the frontend." />
        <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-slate-950/40 rounded-lg p-3 border border-slate-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            Server-side secrets such as the service role key are not visible to the browser, so this page does not report their status. Their values are never shown here.
          </p>
        </div>
      </Section>

      <Section title="Project Reference" icon={KeyRound}>
        <div className="flex items-center justify-between gap-3">
          <code className="text-sm font-mono text-slate-200 bg-slate-950/50 px-3 py-2 rounded-lg border border-slate-800 break-all">
            {ref}
          </code>
          <button
            onClick={copyRef}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200 hover:bg-slate-700 transition"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Give this reference and Bolt project ID 72130885 when contacting Bolt support.
        </p>
      </Section>

      <Section title="Find Original Account" icon={Info}>
        <ol className="space-y-3 text-sm text-slate-300 list-decimal list-inside">
          <li>
            Sign in to <a className="text-sky-400 underline" href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">supabase.com/dashboard</a> with each Google account you may have used. The owner account lists project <span className="font-mono">{ref}</span>.
          </li>
          <li>
            Sign in to <a className="text-sky-400 underline" href="https://bolt.new" target="_blank" rel="noopener noreferrer">bolt.new</a> with each Google account. The owner account has the Rayyan AI project (ID 72130885).
          </li>
          <li>Search your inbox for "Supabase", "Bolt", or <span className="font-mono">{ref}</span>.</li>
          <li>Check browser history for visits to supabase.com or bolt.new around October 2026.</li>
        </ol>
        <p className="text-xs text-slate-500 mt-3">
          The app's super-admin login is not necessarily the Supabase or Bolt project owner.
        </p>
      </Section>

      <p className="text-xs text-slate-500 leading-relaxed">
        This database appears to be Bolt-managed. Claiming, migrating, or replacing the connection can lose data and is limited to the project owner. Do not create a new Supabase organization or project. Contact Bolt support before changing anything here.
      </p>
    </div>
  );
}
