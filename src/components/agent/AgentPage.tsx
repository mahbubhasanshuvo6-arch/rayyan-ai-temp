import { useState } from "react";
import { ArrowLeft, Bot, Plus, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import type { AuthState } from "@/lib/useAuth";
import { navigate } from "@/lib/router";
import { useAgent } from "@/lib/useAgent";
import { TASK_STATUS_LABEL, type AgentTask } from "@/lib/agent";
import AgentSignIn from "@/components/agent/AgentSignIn";
import AgentTaskForm from "@/components/agent/AgentTaskForm";
import AgentTaskDetail from "@/components/agent/AgentTaskDetail";
import { TaskStatusBadge } from "@/components/agent/AgentStatusBadge";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export default function AgentPage({ auth }: { auth: AuthState }) {
  if (!auth.session) return <AgentSignIn />;
  return <AgentWorkspace userId={auth.session.user.id} />;
}

function AgentWorkspace({ userId }: { userId: string }) {
  const agent = useAgent(userId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingBusy, setCreatingBusy] = useState(false);

  const hasSelection = !!agent.selectedId && !creating;
  const dbReady = agent.dbState === "ready";

  async function handleCreate(title: string, goal: string) {
    setCreateError(null);
    setCreatingBusy(true);
    const ok = await agent.createTask(title, goal);
    setCreatingBusy(false);
    if (ok) setCreating(false);
    else setCreateError("The task could not be created. Please try again.");
    return ok;
  }

  function openNew() {
    setCreating(true);
    setCreateError(null);
    agent.setSelectedId(null);
  }

  function openTask(task: AgentTask) {
    setCreating(false);
    agent.setSelectedId(task.id);
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <button
          onClick={() => navigate("chat")}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Chat
        </button>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-sky-300" />
          <h1 className="text-base font-semibold">Agent</h1>
        </div>
      </header>

      {agent.dbState === "missing" && (
        <div role="status" className="flex items-start gap-3 border-b border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The agent's database is awaiting setup. Tasks cannot be created yet. Chat, Voice, App Builder, Memory and the other pages are not affected.
          </span>
        </div>
      )}
      {agent.dbState === "error" && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <span>Could not check the agent's status right now.</span>
          <button onClick={() => window.location.reload()} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-rose-500/10">
            <RefreshCw className="h-4 w-4" /> Reload
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className={`${hasSelection ? "hidden" : "flex"} w-full flex-col border-r border-slate-800 md:flex md:w-72 md:shrink-0`}>
          <div className="p-3">
            <button
              onClick={openNew}
              disabled={!dbReady}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> New task
            </button>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            {agent.dbState === "checking" && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              </div>
            )}
            {agent.tasksError && <p className="px-2 py-3 text-sm text-rose-300">{agent.tasksError}</p>}
            {dbReady && agent.tasks.length === 0 && !agent.tasksError && (
              <p className="px-2 py-3 text-sm text-slate-500">No tasks yet. Create one to get started.</p>
            )}
            {agent.tasks.map((task) => {
              const active = agent.selectedId === task.id && !creating;
              return (
                <button
                  key={task.id}
                  onClick={() => openTask(task)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    active ? "border-sky-400/50 bg-slate-800" : "border-transparent hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-100">{task.title}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <TaskStatusBadge status={task.status} />
                    <span className="text-xs text-slate-500">{dateFormat.format(new Date(task.created_at))}</span>
                  </div>
                  <span className="sr-only">{TASK_STATUS_LABEL[task.status]}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className={`${hasSelection ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}>
          {hasSelection && (
            <button
              onClick={() => agent.setSelectedId(null)}
              className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm text-slate-300 md:hidden"
            >
              <ArrowLeft className="h-4 w-4" /> All tasks
            </button>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            {creating || !agent.selectedId ? (
              <AgentTaskForm
                disabled={!dbReady}
                submitting={creatingBusy}
                error={createError}
                onSubmit={handleCreate}
              />
            ) : (
              <AgentTaskDetail
                task={agent.task}
                bundle={agent.bundle}
                detailError={agent.detailError}
                actionError={agent.actionError}
                busy={agent.busy}
                autoRunPaused={agent.autoRunPaused}
                onAction={agent.runAction}
                onContinue={agent.continueRun}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
