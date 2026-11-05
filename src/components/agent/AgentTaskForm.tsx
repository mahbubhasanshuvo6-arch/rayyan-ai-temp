import { useState, type FormEvent } from "react";
import { Loader2, Send, AlertCircle } from "lucide-react";

const TITLE_MAX = 200;
const GOAL_MAX = 4000;

export default function AgentTaskForm({
  disabled,
  submitting,
  error,
  onSubmit,
}: {
  disabled: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (title: string, goal: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanGoal = goal.trim();
    if (!cleanTitle || !cleanGoal) {
      setLocalError("Give your task a name and describe what you want done.");
      return;
    }
    setLocalError(null);
    const ok = await onSubmit(cleanTitle, cleanGoal);
    if (ok) {
      setTitle("");
      setGoal("");
    }
  }

  const shownError = localError ?? error;

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">New task</h2>
        <p className="text-sm text-slate-400">
          Describe the outcome you want. The agent will break it into steps and show you the plan before it starts working.
        </p>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-300">Task name</span>
        <input
          value={title}
          maxLength={TITLE_MAX}
          disabled={disabled || submitting}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Summarise recent security news"
          enterKeyHint="next"
          autoComplete="off"
          autoCapitalize="sentences"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-base text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-300">Goal</span>
        <textarea
          value={goal}
          rows={6}
          maxLength={GOAL_MAX}
          disabled={disabled || submitting}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe what you want the agent to find, check or produce."
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
          className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-base leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none disabled:opacity-50"
        />
        <span className="block text-right text-xs text-slate-500">
          {goal.length} / {GOAL_MAX}
        </span>
      </label>

      {shownError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{shownError}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={disabled || submitting}
        className="flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {submitting ? "Creating plan..." : "Create task"}
      </button>
    </form>
  );
}
