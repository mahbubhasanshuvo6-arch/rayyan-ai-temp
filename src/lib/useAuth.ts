import { useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { AdminRole } from "./types";

export interface AuthState {
  session: Session | null;
  isAdmin: boolean;
  adminRole: AdminRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const isAdmin =
    !!session &&
    (session.user.app_metadata?.is_admin as boolean) === true;

  const adminRole = session
    ? (session.user.app_metadata?.admin_role as AdminRole) ?? null
    : null;

  return { session, isAdmin, adminRole, loading, signOut };
}
