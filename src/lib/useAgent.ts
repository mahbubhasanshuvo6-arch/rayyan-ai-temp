import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIVE_TASK_STATUSES,
  callAgent,
  checkAgentDatabase,
  getAgentTask,
  getAgentTaskBundle,
  listAgentTasks,
  type AgentAction,
  type AgentDatabaseState,
  type AgentTask,
  type AgentTaskBundle,
} from "@/lib/agent";

const POLL_MS = 3000;
const EMPTY_BUNDLE: AgentTaskBundle = { steps: [], events: [], approvals: [] };

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function useAgent(userId: string | null) {
  const [dbState, setDbState] = useState<AgentDatabaseState | "checking">("checking");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<AgentTask | null>(null);
  const [bundle, setBundle] = useState<AgentTaskBundle>(EMPTY_BUNDLE);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<AgentAction | null>(null);
  const [runTick, setRunTick] = useState(0);
  const [autoRunPaused, setAutoRunPaused] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await listAgentTasks());
      setTasksError(null);
    } catch (e) {
      setTasksError(errorMessage(e, "Could not load your tasks."));
    }
  }, []);

  const refreshSelected = useCallback(async (id: string) => {
    try {
      const [t, b] = await Promise.all([getAgentTask(id), getAgentTaskBundle(id)]);
      if (selectedRef.current !== id) return;
      setTask(t);
      setBundle(b);
      setDetailError(null);
    } catch (e) {
      if (selectedRef.current !== id) return;
      setDetailError(errorMessage(e, "Could not load this task."));
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    checkAgentDatabase()
      .then((state) => {
        if (cancelled) return;
        setDbState(state);
        if (state === "ready") refreshTasks();
      })
      .catch(() => {
        if (!cancelled) setDbState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshTasks]);

  useEffect(() => {
    setActionError(null);
    setAutoRunPaused(false);
    setRunTick(0);
    if (!selectedId) {
      setTask(null);
      setBundle(EMPTY_BUNDLE);
      return;
    }
    setTask(null);
    setBundle(EMPTY_BUNDLE);
    refreshSelected(selectedId);
  }, [selectedId, refreshSelected]);

  const isActive = !!task && ACTIVE_TASK_STATUSES.includes(task.status);

  useEffect(() => {
    if (!selectedId || !isActive) return;
    const timer = window.setInterval(() => {
      refreshSelected(selectedId);
      refreshTasks();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedId, isActive, refreshSelected, refreshTasks]);

  const shouldAutoRun = !!task && (task.status === "queued" || task.status === "running") && !autoRunPaused;

  useEffect(() => {
    if (!selectedId || !shouldAutoRun || busy) return;
    let cancelled = false;
    callAgent("run", { taskId: selectedId })
      .then(() => {
        if (cancelled) return;
        refreshSelected(selectedId);
        refreshTasks();
        setRunTick((n) => n + 1);
      })
      .catch((e) => {
        if (cancelled) return;
        setAutoRunPaused(true);
        setActionError(errorMessage(e, "The agent stopped while working. Use Continue to try again."));
        refreshSelected(selectedId);
      });
    return () => {
      cancelled = true;
    };
    // runTick advances after each completed run to schedule the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, shouldAutoRun, runTick]);

  const createTask = useCallback(
    async (title: string, goal: string) => {
      setBusy("create");
      setActionError(null);
      try {
        const res = await callAgent("create", { title, goal });
        await refreshTasks();
        if (res.task?.id) setSelectedId(res.task.id);
        return true;
      } catch (e) {
        setActionError(errorMessage(e, "Could not create the task."));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refreshTasks],
  );

  const runAction = useCallback(
    async (action: Exclude<AgentAction, "create" | "run">) => {
      if (!selectedId) return;
      setBusy(action);
      setActionError(null);
      try {
        await callAgent(action, { taskId: selectedId });
        if (action === "resume" || action === "retry") setAutoRunPaused(false);
      } catch (e) {
        setActionError(errorMessage(e, "That action could not be completed."));
      } finally {
        setBusy(null);
        refreshSelected(selectedId);
        refreshTasks();
      }
    },
    [selectedId, refreshSelected, refreshTasks],
  );

  const continueRun = useCallback(() => {
    setAutoRunPaused(false);
    setActionError(null);
    if (selectedId) refreshSelected(selectedId);
  }, [selectedId, refreshSelected]);

  return {
    dbState,
    tasks,
    tasksError,
    selectedId,
    setSelectedId,
    task,
    bundle,
    detailError,
    actionError,
    busy,
    createTask,
    runAction,
    continueRun,
    autoRunPaused,
    refreshSelected,
    refreshTasks,
  };
}
