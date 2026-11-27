-- ============================================================================
-- Mohasba Tracker v2 — Migration 0003: Atomic Smart-Delete Persistence RPCs
-- ============================================================================
-- Thin, logic-free transactional persistence primitives for Smart 2-Tier
-- Permanent Delete of actions and periods (eliminating multi-request TOCTOU
-- races and partial-delete risks against ON DELETE RESTRICT FKs).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_action_atomic(
  p_action_id UUID,
  p_force     BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_title     TEXT;
  v_period_id UUID;
  v_log_count INTEGER := 0;
BEGIN
  SELECT title, period_id
    INTO v_title, v_period_id
    FROM public.actions
   WHERE id = p_action_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT COUNT(*)::INTEGER
    INTO v_log_count
    FROM public.daily_logs
   WHERE action_id = p_action_id
     AND (
       status IS NOT NULL
       OR availability_override IS NOT NULL
       OR note IS NOT NULL
     );

  IF v_log_count > 0 AND NOT COALESCE(p_force, false) THEN
    RETURN jsonb_build_object(
      'outcome', 'has_history',
      'log_count', v_log_count,
      'title', v_title,
      'period_id', v_period_id
    );
  END IF;

  DELETE FROM public.daily_logs      WHERE action_id = p_action_id;
  DELETE FROM public.target_versions WHERE action_id = p_action_id;
  DELETE FROM public.actions         WHERE id = p_action_id;

  RETURN jsonb_build_object(
    'outcome', 'deleted',
    'deleted_logs_count', v_log_count,
    'title', v_title,
    'period_id', v_period_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_period_atomic(
  p_period_id UUID,
  p_force     BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_title        TEXT;
  v_side         TEXT;
  v_child_ids    UUID[] := '{}'::UUID[];
  v_action_count INTEGER := 0;
  v_bound_count  INTEGER := 0;
  v_log_count    INTEGER := 0;
BEGIN
  SELECT title, side
    INTO v_title, v_side
    FROM public.periods
   WHERE id = p_period_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT COALESCE(ARRAY_AGG(locked.id), '{}'::UUID[])
    INTO v_child_ids
    FROM (
      SELECT id
        FROM public.actions
       WHERE period_id = p_period_id
       FOR UPDATE
    ) AS locked;

  v_action_count := COALESCE(array_length(v_child_ids, 1), 0);

  SELECT COUNT(*)::INTEGER
    INTO v_bound_count
    FROM public.actions
   WHERE bound_time_period_id = p_period_id
     AND period_id <> p_period_id;

  IF v_action_count > 0 THEN
    SELECT COUNT(*)::INTEGER
      INTO v_log_count
      FROM public.daily_logs
     WHERE action_id = ANY(v_child_ids)
       AND (
         status IS NOT NULL
         OR availability_override IS NOT NULL
         OR note IS NOT NULL
       );
  END IF;

  IF (v_action_count > 0 OR v_log_count > 0 OR v_bound_count > 0)
     AND NOT COALESCE(p_force, false) THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_log_count > 0 THEN 'has_history' ELSE 'has_children' END,
      'action_count', v_action_count,
      'log_count', v_log_count,
      'bound_action_count', v_bound_count,
      'title', v_title,
      'side', v_side
    );
  END IF;

  IF v_action_count > 0 THEN
    DELETE FROM public.daily_logs      WHERE action_id = ANY(v_child_ids);
    DELETE FROM public.target_versions WHERE action_id = ANY(v_child_ids);
    DELETE FROM public.actions         WHERE id = ANY(v_child_ids);
  END IF;

  DELETE FROM public.periods WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'outcome', 'deleted',
    'deleted_actions_count', v_action_count,
    'deleted_logs_count', v_log_count,
    'unbound_actions_count', v_bound_count,
    'title', v_title,
    'side', v_side
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_action_atomic(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_period_atomic(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_action_atomic(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_period_atomic(UUID, BOOLEAN) TO service_role;

COMMIT;
