// admin-api: handles admin setup, admin stats, settings update, user
// management, audit logs, and admin data management.
//
// Security model:
//   1. Every request (except /setup and /setup-status) requires a valid
//      Supabase JWT. We verify it via getUser() with the service-role client.
//   2. The user must have app_metadata.is_admin = true (server-controlled).
//   3. Fine-grained authorization uses the admin_users table (role column):
//      - super_admin: full access including user/role management
//      - admin: stats, settings, projects, memory, knowledge, usage
//      - support: read-only access to stats, usage, and audit logs
//   4. Role mutations (grant/revoke/suspend) require super_admin and are
//      performed via SECURITY DEFINER SQL functions that check the caller.
//   5. All sensitive actions are logged to admin_events with actor, action,
//      target, and outcome.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_SETUP_KEY = Deno.env.get("ADMIN_SETUP_KEY") ?? "";

type AdminRole = "super_admin" | "admin" | "support";

interface AuthUser {
  id: string;
  email: string;
  role: AdminRole | null;
  suspended: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin-api/, "") || "/";

  try {
    // ---- SETUP: create the first admin ----
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

    // Everything below requires an admin JWT.
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
    const isAdminClaim = (user.app_metadata?.is_admin as boolean) === true;
    if (!isAdminClaim) return json({ error: "Forbidden" }, 403);

    // Resolve the caller's role from admin_users table.
    const authUser = await resolveAdminUser(adminClient, user.id, user.email ?? "");
    if (!authUser || authUser.suspended) {
      return json({ error: "Forbidden: admin account is suspended or not recognized" }, 403);
    }

    const role = authUser.role;

    // ---- STATS (admin, support) ----
    if (path === "/stats" && req.method === "GET") {
      if (role === "support" || role === "admin" || role === "super_admin") {
        const { data } = await adminClient.rpc("admin_stats");
        return json({ stats: data, role });
      }
      return json({ error: "Forbidden" }, 403);
    }

    // ---- SETTINGS GET (admin, support read-only) ----
    if (path === "/settings" && req.method === "GET") {
      if (role === "admin" || role === "super_admin" || role === "support") {
        const { data } = await adminClient
          .from("app_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        return json({ settings: data, role });
      }
      return json({ error: "Forbidden" }, 403);
    }

    // ---- SETTINGS UPDATE (admin, super_admin) ----
    if (path === "/settings" && req.method === "PUT") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden: insufficient role" }, 403);
      }
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
      if (error) return json({ error: "Update failed" }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "update_settings",
        p_detail: JSON.stringify(patch) as unknown as never,
        p_target: "app_settings",
        p_target_type: "config",
        p_outcome: "success",
      });
      return json({ settings: data });
    }

    // ---- GEMINI KEY TEST (admin, super_admin) ----
    if (path === "/test-key" && req.method === "POST") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
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

    // ---- GROQ KEY TEST (admin, super_admin) ----
    if (path === "/test-groq-key" && req.method === "POST") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const key = Deno.env.get("GROQ_API_KEY") ?? "";
      if (!key) return json({ ok: false, error: "No GROQ_API_KEY secret is set." });
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

    // ---- LIST ALL PROJECTS (admin, super_admin) ----
    if (path === "/projects" && req.method === "GET") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const { data, error } = await adminClient
        .from("projects")
        .select("*, generated_files(count)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: "Failed to load projects" }, 400);
      return json({ projects: data });
    }

    // ---- DELETE PROJECT (super_admin only — destructive) ----
    if (path.startsWith("/projects/") && req.method === "DELETE") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can delete projects" }, 403);
      }
      const id = path.split("/")[2];
      const { error } = await adminClient.from("projects").delete().eq("id", id);
      if (error) return json({ error: "Delete failed" }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_project",
        p_detail: JSON.stringify({ id }) as unknown as never,
        p_target: id,
        p_target_type: "project",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- LIST ALL MEMORY ENTRIES (admin, super_admin) ----
    if (path === "/memory" && req.method === "GET") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const { data, error } = await adminClient
        .from("memory_entries")
        .select("id, user_id, owner_label, thread_id, content, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: "Failed to load memory entries" }, 400);
      return json({ entries: data });
    }

    // ---- DELETE MEMORY ENTRY (admin, super_admin) ----
    if (path.startsWith("/memory/") && !path.includes("clear-all") && req.method === "DELETE") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const id = path.split("/")[2];
      const { error } = await adminClient
        .from("memory_entries")
        .delete()
        .eq("id", id);
      if (error) return json({ error: "Delete failed" }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_memory",
        p_detail: JSON.stringify({ id }) as unknown as never,
        p_target: id,
        p_target_type: "memory",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- CLEAR ALL MEMORY (super_admin only — destructive) ----
    if (path === "/memory/clear-all" && req.method === "DELETE") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can clear all memory" }, 403);
      }
      const { error } = await adminClient.from("memory_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ error: "Clear failed" }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "clear_all_memory",
        p_detail: null,
        p_target: "memory_entries",
        p_target_type: "table",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- LIST ALL KNOWLEDGE ENTRIES (admin, super_admin) ----
    if (path === "/knowledge" && req.method === "GET") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const { data, error } = await adminClient
        .from("knowledge_entries")
        .select("id, user_id, owner_label, thread_id, title, content, tags, source, category, visibility, is_shared, document_id, chunk_index, total_chunks, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: "Failed to load knowledge entries" }, 400);
      return json({ entries: data });
    }

    // ---- ADD SHARED KNOWLEDGE ENTRY (admin, super_admin) ----
    if (path === "/knowledge" && req.method === "POST") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const body = await req.json();
      const title = String(body.title ?? "").trim().slice(0, 200);
      const content = String(body.content ?? "").trim().slice(0, 50000);
      const source = String(body.source ?? "admin-shared").trim().slice(0, 64);
      const category = String(body.category ?? "admin-shared").trim().slice(0, 64);
      const tagsRaw = Array.isArray(body.tags) ? body.tags : [];
      const tags = tagsRaw.filter((t: unknown) => typeof t === "string").map((t: string) => String(t).slice(0, 64)).slice(0, 20);
      const isShared = body.is_shared === true;
      const visibility = isShared ? "shared" : "private";
      if (!title || !content) {
        return json({ error: "Title and content are required." }, 400);
      }
      const { data, error } = await adminClient
        .from("knowledge_entries")
        .insert({
          title,
          content,
          tags,
          source,
          category,
          visibility,
          is_shared: isShared,
        })
        .select()
        .maybeSingle();
      if (error) return json({ error: "Insert failed: " + error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "add_knowledge",
        p_detail: JSON.stringify({ title, is_shared: isShared }) as unknown as never,
        p_target: data?.id ?? "",
        p_target_type: "knowledge",
        p_outcome: "success",
      });
      return json({ entry: data });
    }

    // ---- EDIT KNOWLEDGE ENTRY (admin, super_admin) ----
    if (path.startsWith("/knowledge/") && !path.includes("clear-all") && req.method === "PUT") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const id = path.split("/")[2];
      const body = await req.json();
      const patch: Record<string, unknown> = {};
      if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 200);
      if (typeof body.content === "string") patch.content = body.content.trim().slice(0, 50000);
      if (typeof body.source === "string") patch.source = body.source.trim().slice(0, 64);
      if (typeof body.category === "string") patch.category = body.category.trim().slice(0, 64);
      if (typeof body.is_shared === "boolean") {
        patch.is_shared = body.is_shared;
        patch.visibility = body.is_shared ? "shared" : "private";
      }
      if (Array.isArray(body.tags)) {
        patch.tags = body.tags.filter((t: unknown) => typeof t === "string").map((t: string) => String(t).slice(0, 64)).slice(0, 20);
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await adminClient
        .from("knowledge_entries")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) return json({ error: "Update failed: " + error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "edit_knowledge",
        p_detail: JSON.stringify(patch) as unknown as never,
        p_target: id,
        p_target_type: "knowledge",
        p_outcome: "success",
      });
      return json({ entry: data });
    }

    // ---- DELETE KNOWLEDGE ENTRY (admin, super_admin) ----
    if (path.startsWith("/knowledge/") && !path.includes("clear-all") && req.method === "DELETE") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const id = path.split("/")[2];
      const { error } = await adminClient
        .from("knowledge_entries")
        .delete()
        .eq("id", id);
      if (error) return json({ error: "Delete failed" }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_knowledge",
        p_detail: JSON.stringify({ id }) as unknown as never,
        p_target: id,
        p_target_type: "knowledge",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- CLEAR ALL KNOWLEDGE (super_admin only — destructive) ----
    if (path === "/knowledge/clear-all" && req.method === "DELETE") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can clear all knowledge" }, 403);
      }
      const { error } = await adminClient.from("knowledge_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ error: "Clear failed" }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "clear_all_knowledge",
        p_detail: null,
        p_target: "knowledge_entries",
        p_target_type: "table",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- USAGE LOGS (admin, support) ----
    if (path === "/usage" && req.method === "GET") {
      if (role !== "admin" && role !== "super_admin" && role !== "support") {
        return json({ error: "Forbidden" }, 403);
      }
      const page = parseInt(url.searchParams.get("page") ?? "1");
      const perPage = 50;
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const { data, error, count } = await adminClient
        .from("api_usage_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) return json({ error: "Failed to load usage logs" }, 400);
      return json({ logs: data, total: count, page, perPage });
    }

    // ---- AUDIT EVENTS (admin, support) ----
    if (path === "/events" && req.method === "GET") {
      if (role !== "admin" && role !== "super_admin" && role !== "support") {
        return json({ error: "Forbidden" }, 403);
      }
      const { data } = await adminClient
        .from("admin_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ events: data });
    }

    // ---- USERS LIST (super_admin only) ----
    if (path === "/users" && req.method === "GET") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can view users" }, 403);
      }
      const page = parseInt(url.searchParams.get("page") ?? "1");
      const perPage = 50;
      const search = url.searchParams.get("search") ?? "";
      const {
        data: { users },
        error: le,
      } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (le) return json({ error: "Failed to list users" }, 400);

      // Fetch admin roles for these users.
      const userIds = (users ?? []).map((u) => u.id);
      let adminRoles: Record<string, { role: string; suspended: boolean }> = {};
      if (userIds.length > 0) {
        const { data: auData } = await adminClient
          .from("admin_users")
          .select("user_id, role, suspended")
          .in("user_id", userIds);
        for (const au of auData ?? []) {
          adminRoles[au.user_id] = { role: au.role, suspended: au.suspended };
        }
      }

      // Filter by search query (email contains).
      let filtered = users ?? [];
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((u) =>
          (u.email ?? "").toLowerCase().includes(q)
        );
      }

      const result = filtered.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned: u.banned_until !== null && u.banned_until !== undefined,
        is_admin: (u.app_metadata?.is_admin as boolean) === true,
        admin_role: adminRoles[u.id]?.role ?? null,
        admin_suspended: adminRoles[u.id]?.suspended ?? false,
      }));

      return json({ users: result, page, perPage, role });
    }

    // ---- GRANT ADMIN ROLE (super_admin only) ----
    if (path === "/users/grant" && req.method === "POST") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can grant roles" }, 403);
      }
      const body = await req.json();
      const targetUserId: string = body.userId ?? "";
      const targetRole: string = body.role ?? "admin";
      if (!targetUserId) return json({ error: "userId is required" }, 400);
      if (!["super_admin", "admin", "support"].includes(targetRole)) {
        return json({ error: "Invalid role" }, 400);
      }
      if (targetUserId === authUser.id) {
        return json({ error: "Cannot modify your own role" }, 400);
      }
      // Call the SECURITY DEFINER function.
      const { error: fe } = await adminClient.rpc("grant_admin_role", {
        p_target_user_id: targetUserId,
        p_role: targetRole,
      });
      if (fe) {
        await adminClient.rpc("log_admin_event", {
          p_action: "grant_admin_role",
          p_detail: JSON.stringify({ target: targetUserId, role: targetRole }) as unknown as never,
          p_target: targetUserId,
          p_target_type: "user",
          p_outcome: "failed",
        });
        return json({ error: fe.message }, 400);
      }
      // Set app_metadata.is_admin = true on the auth user.
      await adminClient.auth.admin.updateUserById(targetUserId, {
        app_metadata: { is_admin: true },
      });
      await adminClient.rpc("log_admin_event", {
        p_action: "grant_admin_role",
        p_detail: JSON.stringify({ target: targetUserId, role: targetRole }) as unknown as never,
        p_target: targetUserId,
        p_target_type: "user",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- REVOKE ADMIN ROLE (super_admin only) ----
    if (path === "/users/revoke" && req.method === "POST") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can revoke roles" }, 403);
      }
      const body = await req.json();
      const targetUserId: string = body.userId ?? "";
      if (!targetUserId) return json({ error: "userId is required" }, 400);
      if (targetUserId === authUser.id) {
        return json({ error: "Cannot revoke your own admin role" }, 400);
      }
      const { error: fe } = await adminClient.rpc("revoke_admin_role", {
        p_target_user_id: targetUserId,
      });
      if (fe) {
        await adminClient.rpc("log_admin_event", {
          p_action: "revoke_admin_role",
          p_detail: JSON.stringify({ target: targetUserId }) as unknown as never,
          p_target: targetUserId,
          p_target_type: "user",
          p_outcome: "failed",
        });
        return json({ error: fe.message }, 400);
      }
      // Remove is_admin from app_metadata.
      await adminClient.auth.admin.updateUserById(targetUserId, {
        app_metadata: { is_admin: false },
      });
      await adminClient.rpc("log_admin_event", {
        p_action: "revoke_admin_role",
        p_detail: JSON.stringify({ target: targetUserId }) as unknown as never,
        p_target: targetUserId,
        p_target_type: "user",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- SUSPEND / UNSUSPEND ADMIN (super_admin only) ----
    if (path === "/users/suspend" && req.method === "POST") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can suspend admins" }, 403);
      }
      const body = await req.json();
      const targetUserId: string = body.userId ?? "";
      const suspended: boolean = body.suspended ?? true;
      if (!targetUserId) return json({ error: "userId is required" }, 400);
      if (targetUserId === authUser.id) {
        return json({ error: "Cannot suspend your own account" }, 400);
      }
      const { error: fe } = await adminClient.rpc("set_admin_suspended", {
        p_target_user_id: targetUserId,
        p_suspended: suspended,
      });
      if (fe) {
        await adminClient.rpc("log_admin_event", {
          p_action: "set_admin_suspended",
          p_detail: JSON.stringify({ target: targetUserId, suspended }) as unknown as never,
          p_target: targetUserId,
          p_target_type: "user",
          p_outcome: "failed",
        });
        return json({ error: fe.message }, 400);
      }
      await adminClient.rpc("log_admin_event", {
        p_action: "set_admin_suspended",
        p_detail: JSON.stringify({ target: targetUserId, suspended }) as unknown as never,
        p_target: targetUserId,
        p_target_type: "user",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- BAN / UNBAN USER (super_admin only — auth-level ban) ----
    if (path === "/users/ban" && req.method === "POST") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can ban users" }, 403);
      }
      const body = await req.json();
      const targetUserId: string = body.userId ?? "";
      const banned: boolean = body.banned ?? true;
      if (!targetUserId) return json({ error: "userId is required" }, 400);
      if (targetUserId === authUser.id) {
        return json({ error: "Cannot ban your own account" }, 400);
      }
      const { error: be } = await adminClient.auth.admin.updateUserById(targetUserId, {
        ban_duration: banned ? "876000h" : "none",
      });
      if (be) {
        return json({ error: "Failed to update ban status" }, 400);
      }
      await adminClient.rpc("log_admin_event", {
        p_action: banned ? "ban_user" : "unban_user",
        p_detail: JSON.stringify({ target: targetUserId }) as unknown as never,
        p_target: targetUserId,
        p_target_type: "user",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    // ---- LIST ALL USER DOCUMENTS (admin, super_admin) ----
    if (path === "/documents" && req.method === "GET") {
      if (role !== "admin" && role !== "super_admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const { data, error } = await adminClient
        .from("user_documents")
        .select("id, user_id, owner_label, title, file_name, file_type, file_size, chunk_count, status, error_message, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: "Failed to load documents" }, 400);
      return json({ documents: data });
    }

    // ---- DELETE USER DOCUMENT (super_admin only — cascades to chunks) ----
    if (path.startsWith("/documents/") && req.method === "DELETE") {
      if (role !== "super_admin") {
        return json({ error: "Forbidden: only super admins can delete documents" }, 403);
      }
      const id = path.split("/")[2];
      // Get storage_path before deleting the record
      const { data: doc } = await adminClient
        .from("user_documents")
        .select("storage_path")
        .eq("id", id)
        .maybeSingle();
      if (doc?.storage_path) {
        await adminClient.storage.from("user-documents").remove([doc.storage_path]);
      }
      const { error } = await adminClient.from("user_documents").delete().eq("id", id);
      if (error) return json({ error: "Delete failed: " + error.message }, 400);
      await adminClient.rpc("log_admin_event", {
        p_action: "delete_document",
        p_detail: JSON.stringify({ id }) as unknown as never,
        p_target: id,
        p_target_type: "document",
        p_outcome: "success",
      });
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json(
      { error: "Internal error" },
      500
    );
  }
});

// Resolve the caller's admin role from the admin_users table.
// If the user has is_admin=true in app_metadata but isn't in admin_users
// yet (e.g. the original admin from setup), seed them as super_admin.
async function resolveAdminUser(
  client: ReturnType<typeof createClient>,
  userId: string,
  email: string
): Promise<AuthUser | null> {
  const { data, error } = await client
    .from("admin_users")
    .select("role, suspended")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;

  if (data) {
    return {
      id: userId,
      email,
      role: data.role as AdminRole,
      suspended: data.suspended as boolean,
    };
  }

  // The user has is_admin=true but isn't in admin_users. This is the
  // original admin from the setup flow — seed them as super_admin.
  const { error: ie } = await client
    .from("admin_users")
    .insert({ user_id: userId, role: "super_admin" });

  if (ie) {
    // Insert may have failed due to a race; try to read again.
    const { data: retry } = await client
      .from("admin_users")
      .select("role, suspended")
      .eq("user_id", userId)
      .maybeSingle();
    if (retry) {
      return {
        id: userId,
        email,
        role: retry.role as AdminRole,
        suspended: retry.suspended as boolean,
      };
    }
    return null;
  }

  return {
    id: userId,
    email,
    role: "super_admin",
    suspended: false,
  };
}

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

  const { data: existing } = await admin.auth.admin.listUsers();
  const hasAdmin = (existing?.users ?? []).some(
    (u) => (u.app_metadata?.is_admin as boolean) === true
  );
  if (hasAdmin) {
    return json({ error: "An admin already exists. Setup is locked." }, 409);
  }

  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { is_admin: true },
  });
  if (ce) return json({ error: "Failed to create admin account" }, 400);

  // Seed the admin_users table with super_admin role.
  if (created.user?.id) {
    await admin.from("admin_users").upsert({
      user_id: created.user.id,
      role: "super_admin",
    });
  }

  await admin.rpc("log_admin_event", {
    p_action: "admin_setup",
    p_detail: JSON.stringify({ email }) as unknown as never,
    p_target: created.user?.id ?? "",
    p_target_type: "user",
    p_outcome: "success",
  });

  return json({ ok: true, userId: created.user?.id });
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
