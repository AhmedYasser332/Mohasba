-- ============================================================================
-- Mohasba Tracker v2 — Migration 0004: Atomic Workspace Reset & Unlock Rate-Limit RPCs
-- ============================================================================
-- Thin, logic-free transactional persistence primitives for:
--   1. Atomic workspace reset (strict FK delete order + onboarding flag reset)
--   2. Atomic per-IP unlock failure counter & lockout window update
-- ============================================================================

BEGIN;

ALTER TABLE public.unlock_rate_limits
  ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now();

CREATE OR REPLACE FUNCTION public.reset_workspace_atomic()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_daily_logs          INTEGER := 0;
  v_target_versions     INTEGER := 0;
  v_actions             INTEGER := 0;
  v_reminder_dispatches INTEGER := 0;
  v_periods             INTEGER := 0;
  v_applied_mutations   INTEGER := 0;
BEGIN
  -- Strict child-to-parent FK order inside one transaction (explicit WHERE clauses satisfy pg_safeupdate)
  DELETE FROM public.daily_logs WHERE action_id IS NOT NULL;
  GET DIAGNOSTICS v_daily_logs = ROW_COUNT;

  DELETE FROM public.target_versions WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_target_versions = ROW_COUNT;

  DELETE FROM public.actions WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_actions = ROW_COUNT;

  DELETE FROM public.reminder_dispatches WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_reminder_dispatches = ROW_COUNT;

  DELETE FROM public.periods WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_periods = ROW_COUNT;

  DELETE FROM public.applied_mutations WHERE mutation_id IS NOT NULL;
  GET DIAGNOSTICS v_applied_mutations = ROW_COUNT;

  UPDATE public.app_settings
     SET onboarding_completed = false,
         updated_at = pg_catalog.now()
   WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_settings singleton row (id=1) not found';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'daily_logs', v_daily_logs,
    'target_versions', v_target_versions,
    'actions', v_actions,
    'reminder_dispatches', v_reminder_dispatches,
    'periods', v_periods,
    'applied_mutations', v_applied_mutations
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_unlock_failure_atomic(
  p_ip_hash      TEXT,
  p_now          TIMESTAMPTZ,
  p_window_ms    BIGINT,
  p_max_attempts INTEGER,
  p_lock_ms      BIGINT
)
RETURNS TABLE(failed_attempts INTEGER, locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_window_interval INTERVAL := p_window_ms * INTERVAL '1 millisecond';
  v_lock_interval   INTERVAL := p_lock_ms * INTERVAL '1 millisecond';
BEGIN
  RETURN QUERY
  INSERT INTO public.unlock_rate_limits AS u (
    ip_hash,
    failed_attempts,
    locked_until,
    window_started_at,
    updated_at
  )
  VALUES (
    p_ip_hash,
    1,
    CASE WHEN 1 >= p_max_attempts THEN p_now + v_lock_interval ELSE NULL END,
    p_now,
    p_now
  )
  ON CONFLICT (ip_hash) DO UPDATE
    SET failed_attempts = (
          CASE
            WHEN (u.locked_until IS NOT NULL AND u.locked_until <= p_now)
              OR (u.locked_until IS NULL AND u.window_started_at + v_window_interval <= p_now)
            THEN 1
            ELSE LEAST(32767, u.failed_attempts + 1)
          END
        )::SMALLINT,
        window_started_at = CASE
          WHEN (u.locked_until IS NOT NULL AND u.locked_until <= p_now)
            OR (u.locked_until IS NULL AND u.window_started_at + v_window_interval <= p_now)
          THEN p_now
          ELSE u.window_started_at
        END,
        locked_until = CASE
          WHEN (u.locked_until IS NOT NULL AND u.locked_until <= p_now)
            OR (u.locked_until IS NULL AND u.window_started_at + v_window_interval <= p_now)
          THEN CASE WHEN 1 >= p_max_attempts THEN p_now + v_lock_interval ELSE NULL END
          WHEN LEAST(32767, u.failed_attempts + 1) >= p_max_attempts
          THEN CASE
            WHEN u.locked_until IS NOT NULL AND u.locked_until > p_now
            THEN u.locked_until
            ELSE p_now + v_lock_interval
          END
          ELSE NULL
        END,
        updated_at = p_now
  RETURNING u.failed_attempts::INTEGER, u.locked_until;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_workspace_atomic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_unlock_failure_atomic(TEXT, TIMESTAMPTZ, BIGINT, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reset_workspace_atomic() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_unlock_failure_atomic(TEXT, TIMESTAMPTZ, BIGINT, INTEGER, BIGINT) TO service_role;

COMMIT;
