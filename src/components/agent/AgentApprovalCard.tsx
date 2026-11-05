import { ShieldAlert, Check, X, Loader2 } from "lucide-react";
import type { AgentApproval, AgentStep } from "@/lib/agent";

const RISK_TONE = {
  low: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  medium: "text-amber-200 border-amber-400/40 bg-amber-500/10",
  high: "text-rose-200 border-rose-400/40 bg-rose-500/10",
} as const;

export default function AgentApprovalCard({
  approval,
  step,
  busy,
  onDecide,
}: {
  approval: AgentApproval;
  step: AgentStep | undefined;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const pending = approval.status === "pending";
  const inputText = step ? JSON.stringify(step.input, null, 2) : "";

  return (
    <div className="space-y-4 rounded-xl border border-amber-400/30 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-100">{approval.action_summary}</h3>
            <p className="text-sm text-slate-400">Review exactly what the agent wants to do before you decide.</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${RISK_TONE[approval.risk]}`}>
          {approval.risk} risk
        </span>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Step details</p>
        {inputText ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">
            {inputText}
          </pre>
        ) : (
          <p className="text-sm text-slate-400">The details for this step are not available.</p>
        )}
        {approval.preview && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">
            {approval.preview}
          </pre>
        )}
      </div>

      {pending ? (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onDecide(true)}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </button>
          <button
            onClick={() => onDecide(false)}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Reject
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-400 capitalize">Decision: {approval.status}</p>
      )}
    </div>
  );
}
