// admin-api: handles admin setup, admin stats, settings update, and admin
// data management. Admin status is checked via app_metadata.is_admin on the
// JWT — a server-controlled claim that users cannot mutate.
// Routes: /setup, /setup-status, /stats, /settings, /test-key,
// /test-groq-key, /projects, /memory, /knowledge, /usage, /events.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_SETUP_KEY = Deno.env.get("ADMIN_SETUP_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin-api/, "") || "/";

  try {
    // ---- SETUP: create the first admin ----
    // Only works when caller supplies ADMIN_SETUP_KEY (an env secret) and
    // provides an email + password. Creates the auth user and flags it.
    if (path === "/setup" && req.method === "POST") {
      return handleSetup(req);
    }

    // ---- STATUS: public check whether an admin exists ----
    if (path === "/setup-status" && req.method === "GET") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false },
      });
      const { data } = await admin.auth.admin.listUsers();
      const hasAdmin = (data?.users ?? []).some((u) =>
        (u.app_metadata?.is_admin as boolean) === true
      );
      return json({ setupRequired: !hasAdmin });
    }

    // Everything below requires an admin JWT. We verify the token using the
    // service-role admin API rather than creating a client with the user's
    // JWT — that path (auth.getUser on a user-token client with verify_jwt
    // disabled) is unreliable in the edge runtime and silently returns null.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const { data: ud, error: uerr } = await adminClient.auth.getUser(jwt);
    const user = ud?.user;
    if (uerr || !user) return json({ error: "Unauthorized" }, 401);

    // Verify admin claim (server-controlled, not user-editable).
    const isAdmin = (user.app_metadata?.is_admin as boolean) === true;
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    // ---- STATS ----
    if (path === "/stats" && req.method === "GET") {
      const { data } = await adminClient.rpc("admin_stats");
      return json({ stats: data });
    }

    // ---- SETTINGS GET ----
    if (path === "/settings" && req.method === "GET") {
      const { data } = await adminClient
        .from("app_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      return json({ settings: data });
    }

    // ---- SETTINGS UPDATE ----
    if (path === "/settings" && req.method === "PUT") {
      const body = await req.json();
      const allowed = [
        "app_name", "tagline", "theme", "accent_color",
        "chat_enabled", "voice_enabled", "app_builder_enabled",
        "provider", "model", "temperature", "max_tokens",
        "system_prompt", "show_usage_costs",
        "fallback_enabled", "fallback_provider", "fallback_model",
        "tool_web_search_enabled", "tool_memory_enabled",
        "cybersec_enabled", "cybersec_authorization_required",
        "tool_code_review_enabled", "tool_knowledge_enabled",
        "tool_deps_check_enabled",
      ];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      patch.updated_at = new Date().toISOString();
      const { data, error } = await adminClient
        .from("app_settings")
        .update(patch)
        .eq("id", 1)
        .select()
        .maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "update_settings",
        p_detail: JSON.stringify(patch) as unknown as never,
      });
      return json({ settings: data });
    }

    // ---- GEMINI KEY TEST ----
    if (path === "/test-key" && req.method === "POST") {
      const key = Deno.env.get("GEMINI_API_KEY") ?? "";
      if (!key) return json({ ok: false, error: "No GEMINI_API_KEY secret is set." });
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      );
      if (!r.ok) {
        const d = await r.json();
        return json({ ok: false, error: d?.error?.message ?? `HTTP ${r.status}` });
      }
      const d = await r.json();
      const models = (d.models ?? []).map((m: { name: string }) =>
        m.name.replace("models/", "")
      );
      return json({ ok: true, models });
    }

    // ---- GROQ KEY TEST ----
    if (path === "/test-groq-key" && req.method === "POST") {
      const key = Deno.env.get("GROQ_API_KEY") ?? "";
      if (!key) return json({ ok: false, error: "No GROQ_API_KEY secret is set. Add it in the project secrets to enable fallback." });
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const d = await r.json(); msg = d?.error?.message ?? msg; } catch { /* ignore */ }
        return json({ ok: false, error: msg });
      }
      const d = await r.json();
      const models = (d.data ?? []).map((m: { id: string }) => m.id);
      return json({ ok: true, models });
    }

    // ---- LIST ALL PROJECTS (admin view) ----
    if (path === "/projects" && req.method === "GET") {
      const { data, error } = await adminClient
        .from("projects")
        .select("*, generated_files(count)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: error.message }, 400);
      return json({ projects: data });
    }

    // ---- DELETE PROJECT (destructive, confirmed client-side) ----
    if (path.startsWith("/projects/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      const { error } = await adminClient.from("projects").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_project",
        p_detail: JSON.stringify({ id }) as unknown as never,
      });
      return json({ ok: true });
    }

    // ---- LIST ALL MEMORY ENTRIES ----
    if (path === "/memory" && req.method === "GET") {
      const { data, error } = await adminClient
        .from("memory_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: error.message }, 400);
      return json({ entries: data });
    }

    // ---- DELETE MEMORY ENTRY ----
    if (path.startsWith("/memory/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      const { error } = await adminClient
        .from("memory_entries")
        .delete()
        .eq("id", id);
      if (error) return json({ error: error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_memory",
        p_detail: JSON.stringify({ id }) as unknown as never,
      });
      return json({ ok: true });
    }

    // ---- CLEAR ALL MEMORY ----
    if (path === "/memory/clear-all" && req.method === "DELETE") {
      const { error } = await adminClient.from("memory_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ error: error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "clear_all_memory",
        p_detail: null,
      });
      return json({ ok: true });
    }

    // ---- LIST ALL KNOWLEDGE ENTRIES (admin view) ----
    if (path === "/knowledge" && req.method === "GET") {
      const { data, error } = await adminClient
        .from("knowledge_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: error.message }, 400);
      return json({ entries: data });
    }

    // ---- DELETE KNOWLEDGE ENTRY ----
    if (path.startsWith("/knowledge/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      const { error } = await adminClient
        .from("knowledge_entries")
        .delete()
        .eq("id", id);
      if (error) return json({ error: error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_knowledge",
        p_detail: JSON.stringify({ id }) as unknown as never,
      });
      return json({ ok: true });
    }

    // ---- CLEAR ALL KNOWLEDGE ----
    if (path === "/knowledge/clear-all" && req.method === "DELETE") {
      const { error } = await adminClient.from("knowledge_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ error: error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "clear_all_knowledge",
        p_detail: null,
      });
      return json({ ok: true });
    }

    // ---- USAGE LOGS (paginated) ----
    if (path === "/usage" && req.method === "GET") {
      const page = parseInt(url.searchParams.get("page") ?? "1");
      const perPage = 50;
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const { data, error, count } = await adminClient
        .from("api_usage_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) return json({ error: error.message }, 400);
      return json({ logs: data, total: count, page, perPage });
    }

    // ---- AUDIT EVENTS ----
    if (path === "/events" && req.method === "GET") {
      const { data } = await adminClient
        .from("admin_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return json({ events: data });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});

async function handleSetup(req: Request): Promise<Response> {
  if (!ADMIN_SETUP_KEY) {
    return json(
      { error: "Admin setup is not available. ADMIN_SETUP_KEY secret is not set." },
      503
    );
  }
  const body = await req.json();
  const providedKey: string = body.setupKey ?? "";
  if (providedKey !== ADMIN_SETUP_KEY) {
    return json({ error: "Invalid setup key." }, 403);
  }
  const email: string = body.email ?? "";
  const password: string = body.password ?? "";
  if (!email || !password) {
    return json({ error: "Email and password are required." }, 400);
  }
  if (password.length < 8) {
    return json({ error: "Password must be at least 8 characters." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Check no admin already exists.
  const { data: existing } = await admin.auth.admin.listUsers();
  const hasAdmin = (existing?.users ?? []).some(
    (u) => (u.app_metadata?.is_admin as boolean) === true
  );
  if (hasAdmin) {
    return json({ error: "An admin already exists. Setup is locked." }, 409);
  }

  // Create the user.
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { is_admin: true },
  });
  if (ce) return json({ error: ce.message }, 400);

  await admin.rpc("log_admin_event", {
    p_action: "admin_setup",
    p_detail: JSON.stringify({ email }) as unknown as never,
  });

  return json({ ok: true, userId: created.user?.id });
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
