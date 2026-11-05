import { supabase, EDGE_URL } from "@/lib/supabase";

export type AgentTaskStatus =
  | "planning"
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStepStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rejected";

export interface AgentTask {
  id: string;
  title: string;
  goal: string;
  status: AgentTaskStatus;
  max_steps: number;
  current_step: number | null;
  result: string | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface AgentStep {
  id: string;
  task_id: string;
  position: number;
  title: string;
  tool: string;
  input: Record<string, unknown>;
  status: AgentStepStatus;
  attempts: number;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type AgentEventKind =
  | "status"
  | "plan"
  | "step_start"
  | "tool_result"
  | "retry"
  | "approval_requested"
  | "approval_decided"
  | "error"
  | "info";

export interface AgentEvent {
  id: number;
  task_id: string;
  step_id: string | null;
  kind: AgentEventKind;
  message: string;
  created_at: string;
}

export type AgentApprovalStatus = "pending" | "approved" | "rejected";

export interface AgentApproval {
  id: string;
  task_id: string;
  step_id: string;
  action_summary: string;
  risk: "low" | "medium" | "high";
  status: AgentApprovalStatus;
  preview: string;
  created_at: string;
  decided_at: string | null;
}

export interface AgentTaskBundle {
  steps: AgentStep[];
  events: AgentEvent[];
  approvals: AgentApproval[];
}

export type AgentDatabaseState = "ready" | "missing" | "error";

export const ACTIVE_TASK_STATUSES: AgentTaskStatus[] = ["planning", "queued", "running", "awaiting_approval", "paused"];

export const TASK_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  planning: "Planning",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  awaiting_approval: "Needs approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const STEP_STATUS_LABEL: Record<AgentStepStatus, string> = {
  pending: "Waiting",
  running: "Running",
  awaiting_approval: "Needs approval",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
  rejected: "Rejected",
};

const MISSING_TABLE_CODES = ["42P01", "PGRST205"];

export async function checkAgentDatabase(): Promise<AgentDatabaseState> {
  const { error } = await supabase.from("agent_tasks").select("id").limit(1);
  if (!error) return "ready";
  return MISSING_TABLE_CODES.includes(error.code ?? "") ? "missing" : "error";
}

export async function listAgentTasks(): Promise<AgentTask[]> {
  const { data, error } = await supabase
    .from("agent_tasks")
    .select("id, title, goal, status, max_steps, current_step, result, error, retry_count, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Could not load your tasks.");
  return (data ?? []) as AgentTask[];
}

export async function getAgentTask(taskId: string): Promise<AgentTask> {
  const { data, error } = await supabase
    .from("agent_tasks")
    .select("id, title, goal, status, max_steps, current_step, result, error, retry_count, created_at, updated_at")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error("Could not load this task.");
  if (!data) throw new Error("This task no longer exists.");
  return data as AgentTask;
}

export async function getAgentTaskBundle(taskId: string): Promise<AgentTaskBundle> {
  const [steps, events, approvals] = await Promise.all([
    supabase
      .from("agent_steps")
      .select("id, task_id, position, title, tool, input, status, attempts, output, error, started_at, finished_at")
      .eq("task_id", taskId)
      .order("position", { ascending: true }),
    supabase
      .from("agent_events")
      .select("id, task_id, step_id, kind, message, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_approvals")
      .select("id, task_id, step_id, action_summary, risk, status, preview, created_at, decided_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false }),
  ]);
  if (steps.error || events.error || approvals.error) throw new Error("Could not load this task's details.");
  return {
    steps: (steps.data ?? []) as AgentStep[],
    events: (events.data ?? []) as AgentEvent[],
    approvals: (approvals.data ?? []) as AgentApproval[],
  };
}

export type AgentAction = "create" | "run" | "pause" | "resume" | "stop" | "retry" | "approve" | "reject";

export async function callAgent(action: AgentAction, body: Record<string, unknown> = {}): Promise<{ task?: AgentTask; taskId?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in to use the agent.");

  const res = await fetch(`${EDGE_URL}/agent-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }),
  });
  const payload = (await res.json().catch(() => null)) as { task?: AgentTask; taskId?: string; error?: string } | null;
  if (!res.ok || !payload) {
    throw new Error(payload?.error ?? "The agent could not complete that request. Please try again.");
  }
  return payload;
}
