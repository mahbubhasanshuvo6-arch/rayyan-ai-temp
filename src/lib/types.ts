export interface AppSettings {
  id: number;
  app_name: string;
  tagline: string;
  theme: string;
  accent_color: string;
  chat_enabled: boolean;
  voice_enabled: boolean;
  app_builder_enabled: boolean;
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  show_usage_costs: boolean;
  fallback_enabled: boolean;
  fallback_provider: string;
  fallback_model: string;
  tool_web_search_enabled: boolean;
  tool_memory_enabled: boolean;
  cybersec_enabled: boolean;
  cybersec_authorization_required: boolean;
  tool_code_review_enabled: boolean;
  tool_knowledge_enabled: boolean;
  tool_deps_check_enabled: boolean;
}

export interface ChatThread {
  id: string;
  user_id: string | null;
  owner_label: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Array<{ title: string; url: string }> | null;
  created_at: string;
}

export interface MemoryEntry {
  id: string;
  user_id: string | null;
  owner_label: string | null;
  thread_id: string | null;
  content: string;
  created_at: string;
}

export interface KnowledgeEntry {
  id: string;
  user_id: string | null;
  owner_label: string | null;
  thread_id: string | null;
  title: string;
  content: string;
  tags: string[] | null;
  source: string;
  category: string;
  visibility: string;
  is_shared: boolean;
  document_id: string | null;
  chunk_index: number | null;
  total_chunks: number | null;
  created_at: string;
  updated_at: string;
}

export interface UserDocument {
  id: string;
  user_id: string | null;
  owner_label: string | null;
  title: string;
  file_name: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: "pending" | "ready" | "failed";
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string | null;
  owner_label: string | null;
  name: string;
  description: string | null;
  prompt: string;
  status: "pending" | "generating" | "ready" | "error";
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedFile {
  id: string;
  project_id: string;
  path: string;
  language: string;
  content: string;
  created_at: string;
}

export interface UsageLog {
  id: string;
  provider: string;
  model: string;
  feature: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  status: "success" | "error";
  error_message: string | null;
  user_id: string | null;
  owner_label: string | null;
  created_at: string;
}

export interface AdminStats {
  total_threads: number;
  total_messages: number;
  total_projects: number;
  total_files: number;
  total_memory_entries: number;
  total_api_calls: number;
  error_count: number;
  total_tokens: number;
  total_cost_usd: number;
  calls_today: number;
  errors_today: number;
  recent_errors: Array<{ model: string; error: string; created_at: string }>;
}

export type AdminRole = "super_admin" | "admin" | "support";

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  banned: boolean;
  is_admin: boolean;
  admin_role: AdminRole | null;
  admin_suspended: boolean;
}

export interface AuditEvent {
  id: string;
  admin_id: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  target: string | null;
  target_type: string | null;
  outcome: "success" | "failed" | "denied";
  created_at: string;
}
