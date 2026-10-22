import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import type { LearningGoal, LearningProgress, CodeSnippet } from "./types";

const GOAL_CATEGORIES = [
  { value: "programming", label: "Programming" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "general", label: "General" },
] as const;

const SKILL_LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export { GOAL_CATEGORIES, SKILL_LEVELS };

export function useLearning(ownerLabel: string, isAuthenticated: boolean) {
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [progress, setProgress] = useState<LearningProgress[]>([]);
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filter = isAuthenticated
        ? `user_id.is.not.null`
        : `owner_label.eq.${ownerLabel}`;

      const [goalsRes, progressRes, snippetsRes] = await Promise.all([
        supabase.from("learning_goals").select("*").or(filter).order("created_at", { ascending: false }),
        supabase.from("learning_progress").select("*").or(filter).order("updated_at", { ascending: false }),
        supabase.from("code_snippets").select("*").or(filter).order("created_at", { ascending: false }),
      ]);

      if (goalsRes.error) throw goalsRes.error;
      if (progressRes.error) throw progressRes.error;
      if (snippetsRes.error) throw snippetsRes.error;

      setGoals((goalsRes.data as LearningGoal[]) ?? []);
      setProgress((progressRes.data as LearningProgress[]) ?? []);
      setSnippets((snippetsRes.data as CodeSnippet[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load learning data.");
    } finally {
      setLoading(false);
    }
  }, [ownerLabel, isAuthenticated]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const addGoal = useCallback(
    async (goal: string, category: string, skillLevel: string): Promise<boolean> => {
      try {
        const insert: Record<string, unknown> = { goal, category, skill_level: skillLevel };
        if (isAuthenticated) {
          insert.user_id = (await supabase.auth.getUser()).data.user?.id ?? null;
        } else {
          insert.owner_label = ownerLabel;
        }
        const { error: err } = await supabase.from("learning_goals").insert(insert);
        if (err) throw err;
        await loadAll();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save goal.");
        return false;
      }
    },
    [ownerLabel, isAuthenticated, loadAll],
  );

  const updateGoalStatus = useCallback(
    async (id: string, status: string): Promise<boolean> => {
      try {
        const { error: err } = await supabase
          .from("learning_goals")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (err) throw err;
        await loadAll();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update goal.");
        return false;
      }
    },
    [loadAll],
  );

  const deleteGoal = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error: err } = await supabase.from("learning_goals").delete().eq("id", id);
        if (err) throw err;
        await loadAll();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete goal.");
        return false;
      }
    },
    [loadAll],
  );

  const markLessonComplete = useCallback(
    async (goalId: string | null, lessonId: string, lessonTitle: string, lessonType: string): Promise<boolean> => {
      try {
        const existing = progress.find(
          (p) => p.lesson_id === lessonId && (p.goal_id === goalId || (!p.goal_id && !goalId)),
        );
        if (existing) {
          const { error: err } = await supabase
            .from("learning_progress")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (err) throw err;
        } else {
          const insert: Record<string, unknown> = {
            lesson_id: lessonId,
            lesson_title: lessonTitle,
            lesson_type: lessonType,
            status: "completed",
            goal_id: goalId,
          };
          if (isAuthenticated) {
            insert.user_id = (await supabase.auth.getUser()).data.user?.id ?? null;
          } else {
            insert.owner_label = ownerLabel;
          }
          const { error: err } = await supabase.from("learning_progress").insert(insert);
          if (err) throw err;
        }
        await loadAll();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save progress.");
        return false;
      }
    },
    [ownerLabel, isAuthenticated, progress, loadAll],
  );

  const saveSnippet = useCallback(
    async (title: string, language: string, code: string, description?: string, threadId?: string): Promise<boolean> => {
      try {
        const insert: Record<string, unknown> = { title, language, code, description: description ?? null };
        if (threadId) insert.thread_id = threadId;
        if (isAuthenticated) {
          insert.user_id = (await supabase.auth.getUser()).data.user?.id ?? null;
        } else {
          insert.owner_label = ownerLabel;
        }
        const { error: err } = await supabase.from("code_snippets").insert(insert);
        if (err) throw err;
        await loadAll();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save snippet.");
        return false;
      }
    },
    [ownerLabel, isAuthenticated, loadAll],
  );

  const deleteSnippet = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error: err } = await supabase.from("code_snippets").delete().eq("id", id);
        if (err) throw err;
        await loadAll();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete snippet.");
        return false;
      }
    },
    [loadAll],
  );

  return {
    goals,
    progress,
    snippets,
    loading,
    error,
    reload: loadAll,
    addGoal,
    updateGoalStatus,
    deleteGoal,
    markLessonComplete,
    saveSnippet,
    deleteSnippet,
  };
}
