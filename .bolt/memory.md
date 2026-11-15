# Project memory

## Product intent & audience

- Rayyan AI is an existing AI assistant app (chat, agent, voice, app builder, usage logs, admin panel) with Android APK via Capacitor and GitHub Actions.
- Current phase: READ-ONLY audit completed for an **Advanced Telecom Security Research Lab** upgrade targeting Android APK + Cloud Server.
- Lab scope: SS7, MAP, SCCP, TCAP, SIGTRAN, Diameter, SIP, GTP protocol analysis over synthetic PCAP files only — restricted to authorized research, not live network exploitation.
- Primary user language: **Bengali** (audit report delivered in Bengali).

## Brand personality & voice

- Production-grade, non-cookie-cutter UI per `.bolt/prompt` global instructions.
- Technical/security domain: serious, precise, evidence-based; clearly distinguishes VERIFIED / NOT VERIFIED / PROPOSED.

## Visual design & UX direction

- Hash-based routing (`src/lib/router.ts`): `#/chat`, `#/builder`, `#/documents`, `#/agent`, `#/admin`; proposed addition: `#/telecom`.
- Existing AgentPage design pattern is the template for new Telecom sub-views (Dashboard, SS7 Research, PCAP Analyzer, Vulnerability Assessment, Anomaly Detection, Synthetic Lab Simulator, Threat Intelligence, Security Reports).
- Stack: React + Vite + Tailwind + lucide-react icons; `@/` path alias for `src/`.
- No extra UI packages to be installed unless explicitly requested.
- APK workflow unchanged — new routes auto-build into Android.

## Decisions, constraints & rationale

- **Audit was strictly READ-ONLY**: no file, DB, or deploy changes made; awaiting explicit user approval before implementation.
- Existing system to preserve: Supabase project, auth + RLS (21 tables, all RLS-enabled), Gemini/Groq/Tavily integrations, agent-run Edge Function, chat history/memory, voice, App Builder, Usage Logs, Admin Panel, Capacitor config, GitHub Actions APK workflow.
- Admin check uses JWT `app_metadata.is_admin` (secure, not client-editable `user_metadata`).
- `owner_label` (localStorage UUID) trust model used for anon in existing app — **not acceptable** for telecom lab; lab must be authenticated-only.
- Existing `process-document` Edge Function has reusable file-validation pattern (magic bytes, private bucket, size limits) — applicable to PCAP upload.
- Agent task/step/approval/quota architecture is reusable as job-queue runner template.
- Proposed new infra: Python 3 + FastAPI + Docker-isolated worker (tshark, pyshark, scapy); no Python runtime currently exists; Edge Functions cannot run tshark.
- Proposed job queue: Supabase table-based polling (no external queue service).
- Proposed 7 new tables: `telecom_lab_jobs`, `telecom_lab_files`, `telecom_lab_findings`, `telecom_lab_reports`, `telecom_lab_rules`, `telecom_lab_research`, `telecom_lab_audit_logs` — all `TO authenticated`, ownership via `auth.uid() = user_id`.
- Feature toggle via `app_settings.telecom_lab_enabled` for safe rollback; new tables in separate migration (no ALTER to existing tables).
- Estimated new cost: ~$0–12/month (worker VPS or free-tier PaaS; Supabase within current plan).

## Open questions & assumptions

- **CRITICAL**: Local `agent-run/index.ts` has fixes but latest version is **not yet deployed** — user must approve deploying it before implementation begins.
- Assumption: user will approve the 9-phase implementation plan starting with DB migration (Phase 1).
- Assumption: new private Supabase Storage bucket for PCAP files (vs. reusing `user-documents`) — awaiting confirmation.
- Not yet verified: whether Groq/Gemini response content is safe to trust in telecom context — output sanitization in worker proposed.
- Advisor showed 13 WARN on SECURITY DEFINER functions (currently safe due to internal user checks, but could be hardened).
- Proposed architecture, schema, costs, and file-by-file plan are all PROPOSED — nothing created yet.