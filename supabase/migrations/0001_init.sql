-- ============================================================================
-- Mohasba Tracker v2 — 0001_init.sql (PostgreSQL 15+ / Supabase Cloud)
-- Personal Single-Instance Schema | Declarative Integrity Only | Zero Secrets
-- Note: gen_random_uuid() is native in PostgreSQL 13+ (no pgcrypto in public)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. app_settings (Singleton row id = 1; ZERO secrets stored in DB)
-- ----------------------------------------------------------------------------
CREATE TABLE public.app_settings (
  id                       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rollover_mode            TEXT NOT NULL DEFAULT 'FAJR'
                           CHECK (rollover_mode IN ('FAJR', 'MIDNIGHT')),
  iana_timezone            TEXT NOT NULL DEFAULT 'Africa/Cairo'
                           CHECK (char_length(iana_timezone) BETWEEN 1 AND 64),
  city_name                TEXT NOT NULL DEFAULT 'Cairo'
                           CHECK (char_length(city_name) BETWEEN 1 AND 100),
  latitude                 DOUBLE PRECISION NOT NULL DEFAULT 30.0444
                           CHECK (latitude BETWEEN -90 AND 90),
  longitude                DOUBLE PRECISION NOT NULL DEFAULT 31.2357
                           CHECK (longitude BETWEEN -180 AND 180),
  calc_method              TEXT NOT NULL DEFAULT 'Egyptian'
                           CHECK (calc_method IN ('Egyptian', 'UmmAlQura', 'MWL', 'ISNA', 'Karachi', 'Dubai', 'Kuwait', 'Qatar', 'Turkey', 'Singapore', 'MoonsightingCommittee')),
  asr_madhhab              TEXT NOT NULL DEFAULT 'Shafi'
                           CHECK (asr_madhhab IN ('Shafi', 'Hanafi')),
  prayer_offsets           JSONB NOT NULL DEFAULT '{"fajr":0,"sunrise":0,"dhuhr":0,"asr":0,"maghrib":0,"isha":0}'::jsonb,
  week_start_day           SMALLINT NOT NULL DEFAULT 6
                           CHECK (week_start_day BETWEEN 0 AND 6), -- 0=Sun .. 6=Sat
  ntfy_master_enabled      BOOLEAN NOT NULL DEFAULT false,
  quiet_start_hhmm         TEXT NULL CHECK (quiet_start_hhmm IS NULL OR quiet_start_hhmm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end_hhmm           TEXT NULL CHECK (quiet_end_hhmm IS NULL OR quiet_end_hhmm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  digest_enabled           BOOLEAN NOT NULL DEFAULT true,
  digest_hhmm              TEXT NOT NULL DEFAULT '22:00'
                           CHECK (digest_hhmm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  backup_reminder_enabled  BOOLEAN NOT NULL DEFAULT true,
  onboarding_completed     BOOLEAN NOT NULL DEFAULT false,
  last_pruned_date         DATE NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. periods (Right TIME_BOUND prayer windows + Left DAILY_GROUP habits)
-- ----------------------------------------------------------------------------
CREATE TABLE public.periods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 80),
  side              TEXT NOT NULL CHECK (side IN ('TIME_BOUND', 'DAILY_GROUP')),
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  start_anchor      TEXT NULL CHECK (start_anchor IS NULL OR start_anchor IN ('FAJR', 'SUNRISE', 'DHUHR', 'ASR', 'MAGHRIB', 'ISHA', 'FIXED_TIME')),
  start_offset_min  SMALLINT NOT NULL DEFAULT 0 CHECK (start_offset_min BETWEEN -360 AND 360),
  start_fixed_hhmm  TEXT NULL CHECK (start_fixed_hhmm IS NULL OR start_fixed_hhmm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_anchor        TEXT NULL CHECK (end_anchor IS NULL OR end_anchor IN ('FAJR', 'SUNRISE', 'DHUHR', 'ASR', 'MAGHRIB', 'ISHA', 'FIXED_TIME')),
  end_offset_min    SMALLINT NOT NULL DEFAULT 0 CHECK (end_offset_min BETWEEN -360 AND 360),
  end_fixed_hhmm    TEXT NULL CHECK (end_fixed_hhmm IS NULL OR end_fixed_hhmm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ntfy_enabled      BOOLEAN NOT NULL DEFAULT true,
  ntfy_mode         TEXT NULL CHECK (ntfy_mode IS NULL OR ntfy_mode IN ('pre_expiry', 'post_start')),
  ntfy_offset_min   SMALLINT NOT NULL DEFAULT 25 CHECK (ntfy_offset_min BETWEEN 1 AND 180),
  active_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  archived_at       DATE NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT periods_archive_after_active CHECK (archived_at IS NULL OR archived_at >= active_from),
  CONSTRAINT periods_time_bound_anchors CHECK (
    (side = 'TIME_BOUND' AND start_anchor IS NOT NULL AND end_anchor IS NOT NULL)
    OR (side = 'DAILY_GROUP' AND start_anchor IS NULL AND end_anchor IS NULL)
  ),
  CONSTRAINT periods_fixed_time_required CHECK (
    (start_anchor <> 'FIXED_TIME' OR start_fixed_hhmm IS NOT NULL)
    AND (end_anchor <> 'FIXED_TIME' OR end_fixed_hhmm IS NOT NULL)
  )
);

-- ----------------------------------------------------------------------------
-- 3. actions (Stable identity across renames, moves, target upgrades, soft-archive)
-- ----------------------------------------------------------------------------
CREATE TABLE public.actions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id                   UUID NOT NULL REFERENCES public.periods(id) ON DELETE RESTRICT,
  bound_time_period_id        UUID NULL REFERENCES public.periods(id) ON DELETE SET NULL,
  title                       TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  sort_order                  SMALLINT NOT NULL DEFAULT 0,
  is_mosque_action            BOOLEAN NOT NULL DEFAULT false,
  is_qadaa_eligible           BOOLEAN NOT NULL DEFAULT false,
  supports_percentage         BOOLEAN NOT NULL DEFAULT false,
  include_in_normal_day_preset BOOLEAN NOT NULL DEFAULT false,
  analytics_role              TEXT NOT NULL DEFAULT 'standard'
                              CHECK (analytics_role IN ('standard', 'core_jamaah', 'core_habit')),
  default_disabled_days       SMALLINT[] NOT NULL DEFAULT '{}'::smallint[]
                              CHECK (default_disabled_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]), -- 0=Sun..6=Sat
  active_from                 DATE NOT NULL DEFAULT CURRENT_DATE,
  archived_at                 DATE NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT actions_archive_after_active CHECK (archived_at IS NULL OR archived_at >= active_from)
);

-- ----------------------------------------------------------------------------
-- 4. target_versions (Append-only Target Evolution / تطوير الهدف)
-- ----------------------------------------------------------------------------
CREATE TABLE public.target_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id       UUID NOT NULL REFERENCES public.actions(id) ON DELETE RESTRICT,
  effective_from  DATE NOT NULL,
  target_label    TEXT NOT NULL CHECK (char_length(trim(target_label)) BETWEEN 1 AND 80),
  target_value    NUMERIC NULL CHECK (target_value IS NULL OR target_value > 0),
  target_unit     TEXT NULL CHECK (target_unit IS NULL OR char_length(trim(target_unit)) BETWEEN 1 AND 32),
  direction       TEXT NOT NULL DEFAULT 'level_up'
                  CHECK (direction IN ('level_up', 'step_down', 'adjustment')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT target_versions_action_effective_uidx UNIQUE (action_id, effective_from),
  CONSTRAINT target_versions_id_action_uidx UNIQUE (id, action_id)
);

-- ----------------------------------------------------------------------------
-- 5. daily_logs (Single 2-layer cell table | Tombstone-preserving | No Hard DELETE)
-- ----------------------------------------------------------------------------
CREATE TABLE public.daily_logs (
  action_id              UUID NOT NULL REFERENCES public.actions(id) ON DELETE RESTRICT,
  log_date               DATE NOT NULL,
  availability_override  TEXT NULL CHECK (availability_override IS NULL OR availability_override IN ('ENABLED', 'DISABLED')),
  status                 TEXT NULL CHECK (status IS NULL OR status IN ('DONE', 'MISSED', 'QADAA_DONE', 'PERCENT')),
  percent_value          SMALLINT NULL CHECK (percent_value IS NULL OR (percent_value BETWEEN 1 AND 99)),
  qadaa_resolved_at      TIMESTAMPTZ NULL,
  target_version_id      UUID NULL,
  note                   TEXT NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  note_updated_at        TIMESTAMPTZ NULL,
  row_version            BIGINT NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  last_mutation_id       UUID NULL,
  last_device_id         UUID NULL,
  client_updated_at      TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (action_id, log_date),

  -- Composite FK guarantees target_version_id belongs to THIS action AND cannot be deleted once referenced
  CONSTRAINT daily_logs_target_version_fk
    FOREIGN KEY (target_version_id, action_id)
    REFERENCES public.target_versions (id, action_id)
    ON DELETE RESTRICT,

  -- SQL 3-valued-logic-safe CHECK constraints (NULL-proof)
  CONSTRAINT daily_logs_percent_consistency
    CHECK (
      (status IS NOT DISTINCT FROM 'PERCENT' AND percent_value IS NOT NULL)
      OR (status IS DISTINCT FROM 'PERCENT' AND percent_value IS NULL)
    ),
  CONSTRAINT daily_logs_qadaa_consistency
    CHECK (
      (status IS NOT DISTINCT FROM 'QADAA_DONE' AND qadaa_resolved_at IS NOT NULL)
      OR (status IS DISTINCT FROM 'QADAA_DONE' AND qadaa_resolved_at IS NULL)
    ),
  CONSTRAINT daily_logs_disabled_has_no_status
    CHECK (availability_override IS DISTINCT FROM 'DISABLED' OR status IS NULL)
);

-- ----------------------------------------------------------------------------
-- 6. applied_mutations (Sync Idempotency Ledger; pruned > 90d daily)
-- ----------------------------------------------------------------------------
CREATE TABLE public.applied_mutations (
  mutation_id  UUID PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. reminder_dispatches (Atomic ntfy Anti-Spam Claims; pruned > 90d daily)
-- ----------------------------------------------------------------------------
CREATE TABLE public.reminder_dispatches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id        UUID NULL REFERENCES public.periods(id) ON DELETE CASCADE,
  islamic_date     DATE NOT NULL,
  reminder_kind    TEXT NOT NULL CHECK (reminder_kind IN ('pre_expiry', 'post_start', 'nightly_digest', 'backup_nudge')),
  dispatch_status  TEXT NOT NULL DEFAULT 'sending' CHECK (dispatch_status IN ('sending', 'sent', 'failed')),
  dispatched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message    TEXT NULL CHECK (error_message IS NULL OR char_length(error_message) <= 500),

  -- Postgres 15+ NULLS NOT DISTINCT prevents duplicate NULL-period digests/nudges on the same day
  CONSTRAINT reminder_dispatches_unique_claim
    UNIQUE NULLS NOT DISTINCT (period_id, islamic_date, reminder_kind)
);

-- ----------------------------------------------------------------------------
-- 8. unlock_rate_limits (Per-IP Hashed Brute-Force Protection; pruned daily)
-- ----------------------------------------------------------------------------
CREATE TABLE public.unlock_rate_limits (
  ip_hash          TEXT PRIMARY KEY,
  failed_attempts  SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until     TIMESTAMPTZ NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 9. audit_logs (Detailed Action & Error Log; 25 MB / 35,000-row safe ring buffer)
-- ----------------------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  level        TEXT NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  category     TEXT NOT NULL CHECK (category IN ('SYNC', 'CRUD', 'TARGET', 'CRON', 'AUTH', 'EXPORT_IMPORT', 'SYSTEM')),
  event_name   TEXT NOT NULL CHECK (char_length(event_name) BETWEEN 1 AND 80),
  request_id   TEXT NULL CHECK (request_id IS NULL OR char_length(request_id) <= 64),
  device_id    UUID NULL,
  entity_type  TEXT NULL CHECK (entity_type IS NULL OR char_length(entity_type) <= 40),
  entity_id    TEXT NULL CHECK (entity_id IS NULL OR char_length(entity_id) <= 80),
  summary      TEXT NOT NULL CHECK (char_length(summary) <= 500),
  context      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_stack  TEXT NULL CHECK (error_stack IS NULL OR char_length(error_stack) <= 1500)
);

-- ============================================================================
-- Query-Driven Minimal Indexes (Zero Redundant Indexes)
-- ============================================================================
CREATE INDEX actions_period_sort_idx
  ON public.actions (period_id, sort_order);

CREATE INDEX actions_bound_period_idx
  ON public.actions (bound_time_period_id)
  WHERE bound_time_period_id IS NOT NULL;

CREATE INDEX target_versions_action_effective_desc_idx
  ON public.target_versions (action_id, effective_from DESC);

CREATE INDEX daily_logs_log_date_idx
  ON public.daily_logs (log_date);

CREATE INDEX daily_logs_updated_at_idx
  ON public.daily_logs (updated_at);

CREATE INDEX daily_logs_open_qadaa_idx
  ON public.daily_logs (action_id, log_date)
  WHERE status = 'MISSED' AND availability_override IS DISTINCT FROM 'DISABLED';

CREATE INDEX daily_logs_target_version_idx
  ON public.daily_logs (target_version_id)
  WHERE target_version_id IS NOT NULL;

CREATE INDEX applied_mutations_applied_at_idx
  ON public.applied_mutations (applied_at);

CREATE INDEX audit_logs_created_at_desc_idx
  ON public.audit_logs (created_at DESC);

CREATE INDEX audit_logs_warn_error_idx
  ON public.audit_logs (level, created_at DESC)
  WHERE level IN ('ERROR', 'WARN');

-- ============================================================================
-- Ultra-Thin, Logic-Free Persistence RPCs (Only 2 Functions; Zero Business Logic)
-- ============================================================================

-- RPC 1: commit_sync_batch
-- Receives pre-resolved rows from TS `src/domain/conflict.ts` (ZERO business logic in SQL).
-- CRITICAL CONTRACT: `expected_row_version` is the `row_version` that `sync-service.ts` READ
-- from Postgres immediately before running `domain/conflict.ts` (NULL if row did not exist),
-- NOT the client's stale `base_row_version` (otherwise Conflict-Path resolutions could never commit!).
-- Per-item subtransaction (`BEGIN ... EXCEPTION`) guarantees:
--   1. Atomic `mutation_id` claim (`INSERT ... ON CONFLICT DO NOTHING`) safe against parallel duplicate requests.
--   2. Strict Create (`expected_row_version IS NULL` -> `ON CONFLICT DO NOTHING`) vs Update (`WHERE row_version = expected`)
--      so concurrent new-row inserts under READ COMMITTED NEVER silently overwrite each other.
--   3. Custom SQLSTATE `'MC001'` isolates optimistic race rollbacks; `data_exception` / `integrity_constraint_violation`
--      roll back ONLY the offending item (`rejected`) without aborting healthy items in the batch.
CREATE OR REPLACE FUNCTION public.commit_sync_batch(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item         JSONB;
  v_mut_id       UUID;
  v_action_id    UUID;
  v_log_date     DATE;
  v_exp_ver      BIGINT;
  v_claimed      INTEGER;
  v_existing     public.daily_logs%ROWTYPE;
  v_written      public.daily_logs%ROWTYPE;
  v_results      JSONB := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    v_mut_id    := (v_item->>'mutation_id')::UUID;
    v_action_id := (v_item->>'action_id')::UUID;
    v_log_date  := (v_item->>'log_date')::DATE;
    v_exp_ver   := NULLIF(v_item->>'expected_row_version', '')::BIGINT;

    BEGIN
      -- 1. Atomic idempotency claim (prevents parallel duplicate-request race)
      INSERT INTO public.applied_mutations (mutation_id)
      VALUES (v_mut_id)
      ON CONFLICT (mutation_id) DO NOTHING;

      GET DIAGNOSTICS v_claimed = ROW_COUNT;

      IF v_claimed = 0 THEN
        SELECT * INTO v_existing
        FROM public.daily_logs
        WHERE action_id = v_action_id AND log_date = v_log_date;

        v_results := v_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'mutation_id', v_mut_id,
            'outcome', 'already_applied',
            'resolved_row', CASE WHEN FOUND THEN pg_catalog.to_jsonb(v_existing) ELSE NULL END
          )
        );
        CONTINUE;
      END IF;

      -- 2. Strict Create vs. Optimistic Update (no unconditional ON CONFLICT DO UPDATE!)
      IF v_exp_ver IS NULL THEN
        INSERT INTO public.daily_logs (
          action_id, log_date, availability_override, status, percent_value,
          qadaa_resolved_at, target_version_id, note, note_updated_at,
          row_version, last_mutation_id, last_device_id, client_updated_at, updated_at
        ) VALUES (
          v_action_id,
          v_log_date,
          NULLIF(v_item->>'availability_override', ''),
          NULLIF(v_item->>'status', ''),
          NULLIF(v_item->>'percent_value', '')::SMALLINT,
          NULLIF(v_item->>'qadaa_resolved_at', '')::TIMESTAMPTZ,
          NULLIF(v_item->>'target_version_id', '')::UUID,
          v_item->>'note',
          NULLIF(v_item->>'note_updated_at', '')::TIMESTAMPTZ,
          1,
          v_mut_id,
          NULLIF(v_item->>'device_id', '')::UUID,
          (v_item->>'client_updated_at')::TIMESTAMPTZ,
          pg_catalog.now()
        )
        ON CONFLICT (action_id, log_date) DO NOTHING
        RETURNING * INTO v_written;

        IF NOT FOUND THEN
          -- Concurrent transaction inserted this cell first -> roll back applied_mutations claim for this item
          RAISE EXCEPTION USING ERRCODE = 'MC001';
        END IF;
      ELSE
        UPDATE public.daily_logs SET
          availability_override = NULLIF(v_item->>'availability_override', ''),
          status                = NULLIF(v_item->>'status', ''),
          percent_value         = NULLIF(v_item->>'percent_value', '')::SMALLINT,
          qadaa_resolved_at     = NULLIF(v_item->>'qadaa_resolved_at', '')::TIMESTAMPTZ,
          target_version_id     = NULLIF(v_item->>'target_version_id', '')::UUID,
          note                  = v_item->>'note',
          note_updated_at       = NULLIF(v_item->>'note_updated_at', '')::TIMESTAMPTZ,
          row_version           = public.daily_logs.row_version + 1,
          last_mutation_id      = v_mut_id,
          last_device_id        = NULLIF(v_item->>'device_id', '')::UUID,
          client_updated_at     = (v_item->>'client_updated_at')::TIMESTAMPTZ,
          updated_at            = pg_catalog.now()
        WHERE action_id = v_action_id
          AND log_date = v_log_date
          AND row_version = v_exp_ver
        RETURNING * INTO v_written;

        IF NOT FOUND THEN
          -- Row version moved (or row absent) -> roll back applied_mutations claim for this item
          RAISE EXCEPTION USING ERRCODE = 'MC001';
        END IF;
      END IF;

      v_results := v_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'mutation_id', v_mut_id,
          'outcome', 'applied',
          'resolved_row', pg_catalog.to_jsonb(v_written)
        )
      );

    EXCEPTION
      WHEN SQLSTATE 'MC001' THEN
        SELECT * INTO v_existing
        FROM public.daily_logs
        WHERE action_id = v_action_id AND log_date = v_log_date;

        v_results := v_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'mutation_id', v_mut_id,
            'outcome', 'race_conflict',
            'resolved_row', CASE WHEN FOUND THEN pg_catalog.to_jsonb(v_existing) ELSE NULL END
          )
        );

      WHEN data_exception OR integrity_constraint_violation THEN
        v_results := v_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'mutation_id', v_mut_id,
            'outcome', 'rejected',
            'error', SQLERRM
          )
        );
    END;
  END LOOP;

  RETURN v_results;
END;
$$;

-- RPC 2: trim_audit_logs_if_needed
-- Deterministic row-count ring buffer (35,000 rows ≈ ~25 MiB typical) + 100 MiB emergency ceiling:
-- Trims at most 1 batch of oldest rows > 7 days old per daily tick; reports `pg_total_relation_size` for monitoring.
CREATE OR REPLACE FUNCTION public.trim_audit_logs_if_needed(
  p_max_rows        BIGINT  DEFAULT 35000,
  p_emergency_bytes BIGINT  DEFAULT 104857600, -- 100 MiB worst-case ceiling
  p_batch_limit     INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_bytes   BIGINT;
  v_rows    BIGINT;
  v_deleted INTEGER := 0;
BEGIN
  SELECT pg_catalog.pg_total_relation_size('public.audit_logs') INTO v_bytes;
  SELECT count(*) INTO v_rows FROM public.audit_logs;

  IF v_rows > p_max_rows OR v_bytes > p_emergency_bytes THEN
    WITH oldest AS (
      SELECT id
      FROM public.audit_logs
      WHERE created_at < pg_catalog.now() - INTERVAL '7 days'
      ORDER BY id ASC
      LIMIT p_batch_limit
    )
    DELETE FROM public.audit_logs a
    USING oldest o
    WHERE a.id = o.id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'bytes_observed', v_bytes,
    'rows_before', v_rows,
    'deleted_count', v_deleted
  );
END;
$$;

-- ============================================================================
-- Security Lockdown: Default-Deny RLS + Explicit REVOKE + Explicit service_role GRANT
-- ============================================================================
ALTER TABLE public.app_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periods             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.target_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applied_mutations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unlock_rate_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Mandatory explicit grants for service_role (required when Supabase auto-API-grant is OFF)
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_sync_batch(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.trim_audit_logs_if_needed(BIGINT, BIGINT, INTEGER) TO service_role;
