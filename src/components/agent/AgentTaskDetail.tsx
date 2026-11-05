import { Pause, Play, Square, RotateCcw, Loader2, AlertCircle, CheckCircle2, ListChecks, History } from "lucide-react";
import type { AgentAction, AgentEvent, AgentTask, AgentTaskBundle } from "@/lib/agent";
import { TaskStatusBadge, StepStatusBadge } from "@/components/agent/AgentStatusBadge";
import AgentApprovalCard from "@/components/agent/AgentApprovalCard";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const btnBase = "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const btnSecondary = `${btnBase} border border-slate-600 text-slate-200 hover:bg-slate-800`;
const btnDanger = `${btnBase} border border-rose-500/40 text-rose-200 hover:bg-rose-500/10`;
const btnPrimary = `${btnBase} bg-sky-500 font-semibold text-slate-950 hover:bg-sky-400`;

const EVENT_LABEL: Record<AgentEvent["kind"], string> = {
  status: "Status",
  plan: "Plan",
  step_start: "Step started",
  tool_result: "Step finished",
  retry: "Retrying",
  approval_requested: "Approval needed",
  approval_decided: "Decision",
  error: "Problem",
  info: "Note",
};

export default function AgentTaskDetail({
  task,
  bundle,
  detailError,
  actionError,
  busy,
  autoRunPaused,
  onAction,
  onContinue,
}: {
  task: AgentTask | null;
  bundle: AgentTaskBundle;
  detailError: string | null;
  actionError: string | null;
  busy: AgentAction | null;
  autoRunPaused: boolean;
  onAction: (action: Exclude<AgentAction, "create" | "run">) => void;
  onContinue: () => void;
}) {
  if (!task) {
    if (detailError) {
      return (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{detailError}</span>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  const { status } = task;
  const pendingApprovals = bundle.approvals.filter((a) => a.status === "pending");
  const decidedApprovals = bundle.approvals.filter((a) => a.status !== "pending");
  const stepById = new Map(bundle.steps.map((s) => [s.id, s]));
  const showContinue = autoRunPaused && (status === "queued" || status === "running");
  const canStop = ["queued", "running", "paused", "awaiting_approval"].includes(status);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <TaskStatusBadge status={status} />
          <span className="text-xs text-slate-500">Created {dateFormat.format(new Date(task.created_at))}</span>
        </div>
        <h2 className="text-2xl font-semibold leading-tight text-slate-100">{task.title}</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-400">{task.goal}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {status === "queued" && !showContinue && (
          <span className="flex items-center gap-2 rounded-lg bg-sky-500/10 px-3.5 py-2 text-sm text-sky-200">
            <Loader2 className="h-4 w-4 animate-spin" /> Working on the next step...
          </span>
        )}
        {status === "running" && (
          <span className="flex items-center gap-2 rounded-lg bg-sky-500/10 px-3.5 py-2 text-sm text-sky-200">
            <Loader2 className="h-4 w-4 animate-spin" /> Working...
          </span>
        )}
        {(status === "queued" || status === "running") && (
          <button onClick={() => onAction("pause")} disabled={!!busy} className={btnSecondary}>
            {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Pause
          </button>
        )}
        {status === "paused" && (
          <button onClick={() => onAction("resume")} disabled={!!busy} className={btnPrimary}>
            {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume
          </button>
        )}
        {showContinue && (
          <button onClick={onContinue} disabled={!!busy} className={btnPrimary}>
            <Play className="h-4 w-4" /> Continue
          </button>
        )}
        {status === "failed" && (
          <button onClick={() => onAction("retry")} disabled={!!busy} className={btnPrimary}>
            {busy === "retry" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Retry
          </button>
        )}
        {canStop && (
          <button
            onClick={() => {
              if (window.confirm("Stop this task? Steps that have not started will be skipped.")) onAction("stop");
            }}
            disabled={!!busy}
            className={btnDanger}
          >
            {busy === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop
          </button>
        )}
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {status === "failed" && task.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{task.error}</span>
        </div>
      )}

      {status === "completed" && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" /> Result
          </h3>
          <div className="whitespace-pre-wrap rounded-xl border border-emerald-500/30 bg-slate-900 p-5 text-sm leading-relaxed text-slate-200">
            {task.result || "The task finished without any written result."}
          </div>
        </section>
      )}

      {pendingApprovals.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">Waiting for your approval</h3>
          {pendingApprovals.map((approval) => (
            <AgentApprovalCard
              key={approval.id}
              approval={approval}
              step={stepById.get(approval.step_id)}
              busy={busy === "approve" || busy === "reject"}
              onDecide={(approve) => onAction(approve ? "approve" : "reject")}
            />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <ListChecks className="h-5 w-5 text-slate-400" /> Plan
        </h3>
        {bundle.steps.length === 0 ? (
          <p className="text-sm text-slate-500">No steps yet.</p>
        ) : (
          <ol className="space-y-2">
            {bundle.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
                  {step.position}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-100">{step.title}</p>
                    <StepStatusBadge status={step.status} />
                  </div>
                  <p className="text-xs text-slate-500">Tool: {step.tool.replace(/_/g, " ")}</p>
                  {step.error && step.status !== "succeeded" && (
                    <p className="text-xs text-rose-300">{step.error}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {decidedApprovals.length > 0 && (
        <p className="text-xs text-slate-500">{decidedApprovals.length} earlier approval decision(s) recorded.</p>
      )}

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <History className="h-5 w-5 text-slate-400" /> History
        </h3>
        {bundle.events.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing has happened yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
            {bundle.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-1 p-3.5 sm:flex-row sm:items-start sm:gap-4">
                <span className="w-32 shrink-0 text-xs font-medium text-slate-400">{EVENT_LABEL[event.kind]}</span>
                <span className="flex-1 text-sm text-slate-200">{event.message}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {dateFormat.format(new Date(event.created_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
