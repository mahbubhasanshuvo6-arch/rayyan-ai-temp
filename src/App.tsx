import { useAuth } from "@/lib/useAuth";
import { useRoute } from "@/lib/router";
import ChatPage from "@/components/ChatPage";
import BuilderPage from "@/components/BuilderPage";
import DocumentsPage from "@/components/DocumentsPage";
import AdminAuth from "@/components/admin/AdminAuth";
import AdminPanel from "@/components/admin/AdminPanel";
import { isRecoveryCallback } from "@/lib/supabase";
import { useEffect, useState } from "react";

export default function App() {
  const auth = useAuth();
  const route = useRoute();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!auth.loading) setAuthChecked(true);
  }, [auth.loading]);

  // Password recovery flow takes precedence over everything — render it
  // immediately, BEFORE waiting for auth to finish loading. The recovery
  // screen has its own loading state ("Verifying recovery link…") and listens
  // for the SDK's SIGNED_IN event. Waiting for auth.loading here would be too
  // late: by the time auth.loading becomes false, the SDK has already
  // processed the callback and deleted ?code from the URL.
  if (isRecoveryCallback()) {
    return <AdminAuth auth={auth} onAuthed={() => {}} recoveryMode />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (route === "admin") {
    if (auth.isAdmin) return <AdminPanel auth={auth} />;
    return <AdminAuth auth={auth} onAuthed={() => {}} />;
  }

  if (route === "builder") {
    return <BuilderPage />;
  }

  if (route === "documents") {
    return <DocumentsPage />;
  }

  return <ChatPage />;
}
