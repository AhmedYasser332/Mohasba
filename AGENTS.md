# AGENTS.md — Mohasba Tracker v2 (`جدول المحاسبة`)

Engineering, governance, and Git workflow rules for AI coding agents working in this repository.

---

## 1. Project Identity & Authoritative Specs

Mohasba Tracker v2 is an **Open-Source, Personal, Single-Instance, Offline-First PWA** built with **Next.js (App Router, TypeScript)** + **Supabase PostgreSQL (Server-Only HTTP)**, designed for `<3s` street logging after prayer and a high-density desktop weekly accountability ledger.

Always read the authoritative specifications in `docs/` before making architectural, schema, or UI decisions:
1. `docs/project-state.md` — Current stage, approved gates, and active constraints.
2. `docs/00-discovery-qa.md` — Product scope, 3D Classification, and rejections (`Gate 1 Approved`).
3. `docs/01-requirements.md` — Islamic day rollover, 5-state lifecycle, Qadaa, Target Evolution, Analytics, and `ntfy` rules (`Gate 2 Approved`).
4. `docs/02-ux-design-system.md` & `docs/02b-anti-ai-slop-guide.md` — *Al-Mizan Al-Ma'dani* design tokens, Section 6 UI polish conditions, and strict Anti-AI-Slop rules (`Gate 3 Approved`).
5. `docs/03-architecture.md` — Modular Monolith boundaries, Offline PWA Sync, Right-Sized Access, and Hosting ADRs.

---

## 2. Strict Phase-Gate Governance (`/start-from-scratch`)

- Never cross a phase Gate or write premature artifacts (e.g., SQL DDL before Gate 4, production code before Gate 6) without explicit user authorization.
- Keep architecture **moderate and right-sized** for a personal single-instance open-source app:
  - **NO** Supabase Auth, user accounts, RBAC, or multi-tenant `user_id` columns.
  - **NO** Redis, Kafka, microservices, or third-party sync SaaS.
  - **NO** Vercel hosting — Primary Launch Target is **Oracle / Linux VPS Docker (`output: 'standalone'`) + Cloudflare Tunnel**, with **Cloudflare Workers (`@opennextjs/cloudflare`)** as the supported Open-Source serverless target.

---

## 3. Architectural Non-Negotiables

- **One-Way Dependency Boundaries:**
  - `src/domain/*` MUST stay 100% pure TypeScript (zero imports from `react`, `next/*`, `@supabase/*`, DOM, or Node-only APIs).
  - `src/client/*` MUST NEVER import `src/server/*`.
  - Keep cron-shared `src/server/*` modules free of `import 'server-only'` so Cloudflare `wrangler` bundling (`scheduled()`) never breaks.
- **Server-Only Database Access:** Browser never talks directly to Supabase; zero `NEXT_PUBLIC_SUPABASE_*` keys; Postgres RLS stays default-deny; `commit_sync_batch` RPC explicitly revokes `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`.
- **Web Standards Portability:** Use Web Crypto (`crypto.subtle`) and HTTP `@supabase/supabase-js` so identical code runs on both Node 20 Docker (VPS) and Cloudflare Workers (`workerd`).
- **UI & Accessibility:** Enforce `docs/02b-anti-ai-slop-guide.md`, `docs/02-ux-design-system.md` §6, Dual Desktop (`1440px`) + Mobile (`390px`) parity, and **zero music / melodic audio**.

---

## 4. Git Workflow, SSH Push Convention & Public Repo Hygiene

### Remote & SSH Push Setup
- **Repository:** Public Open-Source GitHub repo (`AhmedYasser332/Mohasba`).
- **SSH Remote Alias:** Always push via the configured SSH host alias:
  ```bash
  git remote set-url origin git@github-ahmedyasser332:AhmedYasser332/Mohasba.git
  git push -u origin main
  ```
  *(Uses the local `~/.ssh/config` `Host github-ahmedyasser332` entry — never store tokens, private keys, or personal server IPs in repo files.)*

### Mandatory Gate Commit & Push Rule
- **Every time a `/start-from-scratch` Gate is explicitly approved and closed by the user:**
  1. Update `docs/project-state.md` and the stage spec status.
  2. Run `git status` and verify **ZERO** private/ignored files or secrets are staged.
  3. Create a clear, scoped commit (e.g., `docs: close Gate 4 system architecture`) and push to `origin main`.

### Public Open-Source Hygiene (Strict Pre-Commit Check)
- **NEVER** commit or push:
  - `_archive_v1_sheets/` (contains personal v1 spreadsheets/seeds),
  - `*.rar`, `*.zip`, `*.xlsx`, or personal backup files,
  - `.env` or `.env.local` (only `.env.example` with placeholder values may be tracked),
  - Real `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APP_PASSCODE`, `NTFY_TOPIC_URL`, personal server IPs, or SSH keys.
