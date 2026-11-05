import { TASK_STATUS_LABEL, STEP_STATUS_LABEL, type AgentStepStatus, type AgentTaskStatus } from "@/lib/agent";

const TASK_TONE: Record<AgentTaskStatus, string> = {
  planning: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  queued: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  running: "bg-sky-500/15 text-sky-200 border-sky-400/40",
  paused: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  awaiting_approval: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  completed: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  failed: "bg-rose-500/15 text-rose-200 border-rose-400/40",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-600",
};

const STEP_TONE: Record<AgentStepStatus, string> = {
  pending: "bg-slate-500/15 text-slate-300 border-slate-600",
  running: "bg-sky-500/15 text-sky-200 border-sky-400/40",
  awaiting_approval: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  succeeded: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  failed: "bg-rose-500/15 text-rose-200 border-rose-400/40",
  skipped: "bg-slate-500/15 text-slate-400 border-slate-600",
  rejected: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

const base = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function TaskStatusBadge({ status }: { status: AgentTaskStatus }) {
  return <span className={`${base} ${TASK_TONE[status]}`}>{TASK_STATUS_LABEL[status]}</span>;
}

export function StepStatusBadge({ status }: { status: AgentStepStatus }) {
  return <span className={`${base} ${STEP_TONE[status]}`}>{STEP_STATUS_LABEL[status]}</span>;
}
