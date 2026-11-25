-- ============================================================================
-- Mohasba Tracker v2 — 0002_ux_preferences.sql (PostgreSQL 15+ / Supabase Cloud)
-- UX Preferences, Keyboard Shortcuts & In-App Self-Hoster ntfy Configuration
-- ============================================================================

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS show_catchup_banner BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_home_view TEXT NOT NULL DEFAULT 'now'
    CHECK (default_home_view IN ('now', 'week', 'qadaa', 'analytics')),
  ADD COLUMN IF NOT EXISTS default_week_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (default_week_mode IN ('standard', 'one_glance')),
  ADD COLUMN IF NOT EXISTS keyboard_shortcuts JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(keyboard_shortcuts) = 'object'),
  ADD COLUMN IF NOT EXISTS ntfy_topic_url TEXT NULL
    CHECK (
      ntfy_topic_url IS NULL
      OR (char_length(ntfy_topic_url) BETWEEN 10 AND 500 AND ntfy_topic_url ~ '^https://[^[:space:][:cntrl:]]+$')
    ),
  ADD COLUMN IF NOT EXISTS ntfy_access_token TEXT NULL
    CHECK (
      ntfy_access_token IS NULL
      OR (char_length(ntfy_access_token) BETWEEN 1 AND 500 AND ntfy_access_token !~ '[[:cntrl:]]')
    );
