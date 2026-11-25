import { z } from 'zod';

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const IsoDateSchema = z
  .string()
  .regex(ISO_DATE_REGEX, 'Expected ISO date YYYY-MM-DD');

export const HhmmSchema = z
  .string()
  .regex(HHMM_REGEX, 'Expected 24h time HH:MM');

export const RolloverModeSchema = z.enum(['FAJR', 'MIDNIGHT']);
export type RolloverMode = z.infer<typeof RolloverModeSchema>;

export const CalcMethodSchema = z.enum([
  'Egyptian',
  'UmmAlQura',
  'MWL',
  'ISNA',
  'Karachi',
  'Dubai',
  'Kuwait',
  'Qatar',
  'Turkey',
  'Singapore',
  'MoonsightingCommittee',
]);
export type CalcMethod = z.infer<typeof CalcMethodSchema>;

export const AsrMadhhabSchema = z.enum(['Shafi', 'Hanafi']);
export type AsrMadhhab = z.infer<typeof AsrMadhhabSchema>;

export const PrayerOffsetsSchema = z.object({
  fajr: z.number().int().min(-180).max(180),
  sunrise: z.number().int().min(-180).max(180),
  dhuhr: z.number().int().min(-180).max(180),
  asr: z.number().int().min(-180).max(180),
  maghrib: z.number().int().min(-180).max(180),
  isha: z.number().int().min(-180).max(180),
});
export type PrayerOffsets = z.infer<typeof PrayerOffsetsSchema>;

export const DefaultHomeViewSchema = z.enum([
  'now',
  'week',
  'qadaa',
  'analytics',
]);
export type DefaultHomeView = z.infer<typeof DefaultHomeViewSchema>;

export const DefaultWeekModeSchema = z.enum(['standard', 'one_glance']);
export type DefaultWeekMode = z.infer<typeof DefaultWeekModeSchema>;

export const EnterKeyModeSchema = z.enum(['editor', 'move_down']);
export type EnterKeyMode = z.infer<typeof EnterKeyModeSchema>;

export const NtfySourceSchema = z.enum(['db', 'env', 'none']);
export type NtfySource = z.infer<typeof NtfySourceSchema>;

export const NtfyStatusMetaSchema = z.object({
  ntfy_configured: z.boolean(),
  ntfy_source: NtfySourceSchema,
  ntfy_topic_hint: z.string().nullable(),
  ntfy_has_token: z.boolean(),
});
export type NtfyStatusMeta = z.infer<typeof NtfyStatusMetaSchema>;

export const KeyboardShortcutBindingSchema = z
  .object({
    code: z
      .string()
      .regex(
        /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space|Tab|Enter|Escape|Backspace|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/,
      ),
    ctrl: z.boolean().optional(),
    alt: z.boolean().optional(),
    shift: z.boolean().optional(),
  })
  .strict();
export type KeyboardShortcutBinding = z.infer<
  typeof KeyboardShortcutBindingSchema
>;

export const KeyboardShortcutActionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/)
  .refine((k) => k !== 'constructor' && k !== 'prototype', {
    message: 'Reserved property name is not allowed as shortcut action ID',
  });
export type KeyboardShortcutActionId = z.infer<
  typeof KeyboardShortcutActionIdSchema
>;

export const KeyboardShortcutsMapSchema = z
  .record(KeyboardShortcutActionIdSchema, KeyboardShortcutBindingSchema)
  .refine((obj) => Object.keys(obj).length <= 32, {
    message: 'At most 32 custom keyboard shortcuts are allowed',
  })
  .superRefine((obj, ctx) => {
    const seen = new Map<string, string>();
    for (const [actionId, binding] of Object.entries(obj)) {
      const chord = `${Boolean(binding.ctrl)}:${Boolean(binding.alt)}:${Boolean(binding.shift)}:${binding.code}`;
      const existingActionId = seen.get(chord);
      if (existingActionId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [actionId],
          message: `Duplicate keyboard shortcut chord "${chord}" conflicts with "${existingActionId}"`,
        });
      } else {
        seen.set(chord, actionId);
      }
    }
  });
export type KeyboardShortcutsMap = z.infer<typeof KeyboardShortcutsMapSchema>;

export const AppSettingsSchema = z.object({
  id: z.literal(1),
  rollover_mode: RolloverModeSchema,
  iana_timezone: z.string().min(1).max(64),
  city_name: z.string().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  calc_method: CalcMethodSchema,
  asr_madhhab: AsrMadhhabSchema,
  prayer_offsets: PrayerOffsetsSchema,
  week_start_day: z.number().int().min(0).max(6),
  ntfy_master_enabled: z.boolean(),
  quiet_start_hhmm: HhmmSchema.nullable(),
  quiet_end_hhmm: HhmmSchema.nullable(),
  digest_enabled: z.boolean(),
  digest_hhmm: HhmmSchema,
  backup_reminder_enabled: z.boolean(),
  onboarding_completed: z.boolean(),
  last_pruned_date: IsoDateSchema.nullable(),
  show_catchup_banner: z.boolean().default(true),
  default_home_view: DefaultHomeViewSchema.default('now'),
  default_week_mode: DefaultWeekModeSchema.default('standard'),
  enter_key_mode: EnterKeyModeSchema.default('editor'),
  keyboard_shortcuts: KeyboardShortcutsMapSchema.default({}),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const PeriodSideSchema = z.enum(['TIME_BOUND', 'DAILY_GROUP']);
export type PeriodSide = z.infer<typeof PeriodSideSchema>;

export const PrayerAnchorSchema = z.enum([
  'FAJR',
  'SUNRISE',
  'DHUHR',
  'ASR',
  'MAGHRIB',
  'ISHA',
  'FIXED_TIME',
]);
export type PrayerAnchor = z.infer<typeof PrayerAnchorSchema>;

export const NtfyModeSchema = z.enum(['pre_expiry', 'post_start']);
export type NtfyMode = z.infer<typeof NtfyModeSchema>;

export const PeriodSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(80),
    side: PeriodSideSchema,
    sort_order: z.number().int(),
    start_anchor: PrayerAnchorSchema.nullable(),
    start_offset_min: z.number().int().min(-360).max(360),
    start_fixed_hhmm: HhmmSchema.nullable(),
    end_anchor: PrayerAnchorSchema.nullable(),
    end_offset_min: z.number().int().min(-360).max(360),
    end_fixed_hhmm: HhmmSchema.nullable(),
    ntfy_enabled: z.boolean(),
    ntfy_mode: NtfyModeSchema.nullable(),
    ntfy_offset_min: z.number().int().min(1).max(180),
    active_from: IsoDateSchema,
    archived_at: IsoDateSchema.nullable(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.archived_at !== null && p.archived_at < p.active_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'archived_at must be >= active_from',
      });
    }
    if (p.side === 'TIME_BOUND') {
      if (p.start_anchor === null || p.end_anchor === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TIME_BOUND period requires start_anchor and end_anchor',
        });
      }
    } else if (p.start_anchor !== null || p.end_anchor !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DAILY_GROUP period must have null start_anchor and end_anchor',
      });
    }
    if (p.start_anchor === 'FIXED_TIME' && p.start_fixed_hhmm === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_fixed_hhmm required when start_anchor is FIXED_TIME',
      });
    }
    if (p.end_anchor === 'FIXED_TIME' && p.end_fixed_hhmm === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'end_fixed_hhmm required when end_anchor is FIXED_TIME',
      });
    }
  });
export type Period = z.infer<typeof PeriodSchema>;

export const AnalyticsRoleSchema = z.enum([
  'standard',
  'core_jamaah',
  'core_habit',
]);
export type AnalyticsRole = z.infer<typeof AnalyticsRoleSchema>;

export const WeekdaySchema = z.number().int().min(0).max(6);

export const ActionSchema = z
  .object({
    id: z.string().uuid(),
    period_id: z.string().uuid(),
    bound_time_period_id: z.string().uuid().nullable(),
    title: z.string().trim().min(1).max(120),
    sort_order: z.number().int(),
    is_mosque_action: z.boolean(),
    is_qadaa_eligible: z.boolean(),
    supports_percentage: z.boolean(),
    include_in_normal_day_preset: z.boolean(),
    analytics_role: AnalyticsRoleSchema,
    default_disabled_days: z.array(WeekdaySchema),
    active_from: IsoDateSchema,
    archived_at: IsoDateSchema.nullable(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.archived_at !== null && a.archived_at < a.active_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'archived_at must be >= active_from',
      });
    }
  });
export type Action = z.infer<typeof ActionSchema>;

export const TargetDirectionSchema = z.enum([
  'level_up',
  'step_down',
  'adjustment',
]);
export type TargetDirection = z.infer<typeof TargetDirectionSchema>;

export const TargetVersionSchema = z.object({
  id: z.string().uuid(),
  action_id: z.string().uuid(),
  effective_from: IsoDateSchema,
  target_label: z.string().trim().min(1).max(80),
  target_value: z.number().positive().nullable(),
  target_unit: z.string().trim().min(1).max(32).nullable(),
  direction: TargetDirectionSchema,
  created_at: z.string().optional(),
});
export type TargetVersion = z.infer<typeof TargetVersionSchema>;

export const AvailabilityOverrideSchema = z.enum(['ENABLED', 'DISABLED']);
export type AvailabilityOverride = z.infer<typeof AvailabilityOverrideSchema>;

export const CellStatusSchema = z.enum([
  'DONE',
  'MISSED',
  'QADAA_DONE',
  'PERCENT',
]);
export type CellStatus = z.infer<typeof CellStatusSchema>;

export type EffectiveCellState =
  | CellStatus
  | 'DISABLED'
  | 'PENDING'
  | 'UNLOGGED_EXPIRED'
  | 'INACTIVE';

export const DailyLogSchema = z.object({
  action_id: z.string().uuid(),
  log_date: IsoDateSchema,
  availability_override: AvailabilityOverrideSchema.nullable(),
  status: CellStatusSchema.nullable(),
  percent_value: z.number().int().min(1).max(99).nullable(),
  qadaa_resolved_at: z.string().nullable(),
  target_version_id: z.string().uuid().nullable(),
  note: z.string().max(2000).nullable(),
  note_updated_at: z.string().nullable(),
  row_version: z.number().int().min(1),
  last_mutation_id: z.string().uuid().nullable(),
  last_device_id: z.string().uuid().nullable(),
  client_updated_at: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type DailyLog = z.infer<typeof DailyLogSchema>;

export const SyncMutationSchema = z.object({
  mutation_id: z.string().uuid(),
  device_id: z.string().uuid(),
  parent_mutation_id: z.string().uuid().nullable(),
  action_id: z.string().uuid(),
  log_date: IsoDateSchema,
  base_row_version: z.number().int().min(1).nullable(),
  availability_override: AvailabilityOverrideSchema.nullable(),
  status: CellStatusSchema.nullable(),
  percent_value: z.number().int().min(0).max(100).nullable(),
  qadaa_resolved_at: z.string().nullable(),
  client_target_version_id: z.string().uuid().nullable(),
  note: z.string().max(2000).nullable(),
  note_updated_at: z.string().nullable(),
  client_updated_at: z.string(),
});
export type SyncMutation = z.infer<typeof SyncMutationSchema>;

export const SyncCommitItemSchema = z.object({
  mutation_id: z.string().uuid(),
  device_id: z.string().uuid(),
  action_id: z.string().uuid(),
  log_date: IsoDateSchema,
  expected_row_version: z.number().int().min(1).nullable(),
  availability_override: AvailabilityOverrideSchema.nullable(),
  status: CellStatusSchema.nullable(),
  percent_value: z.number().int().min(1).max(99).nullable(),
  qadaa_resolved_at: z.string().nullable(),
  target_version_id: z.string().uuid().nullable(),
  note: z.string().max(2000).nullable(),
  note_updated_at: z.string().nullable(),
  client_updated_at: z.string(),
});
export type SyncCommitItem = z.infer<typeof SyncCommitItemSchema>;

export const SyncItemOutcomeSchema = z.enum([
  'applied',
  'already_applied',
  'rejected',
  'race_conflict',
]);
export type SyncItemOutcome = z.infer<typeof SyncItemOutcomeSchema>;

export interface SyncResultItem {
  mutation_id: string;
  outcome: SyncItemOutcome;
  resolved_row?: DailyLog | null;
  error?: string;
}

export const AuditLogLevelSchema = z.enum(['INFO', 'WARN', 'ERROR']);
export type AuditLogLevel = z.infer<typeof AuditLogLevelSchema>;

export const AuditLogCategorySchema = z.enum([
  'SYNC',
  'CRUD',
  'TARGET',
  'CRON',
  'AUTH',
  'EXPORT_IMPORT',
  'SYSTEM',
]);
export type AuditLogCategory = z.infer<typeof AuditLogCategorySchema>;

export const AuditLogEntrySchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  level: AuditLogLevelSchema,
  category: AuditLogCategorySchema,
  event_name: z.string().min(1).max(80),
  request_id: z.string().max(64).nullable(),
  device_id: z.string().uuid().nullable(),
  entity_type: z.string().max(40).nullable(),
  entity_id: z.string().max(80).nullable(),
  summary: z.string().max(500),
  context: z.record(z.unknown()),
  error_stack: z.string().max(1500).nullable(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const ReminderKindSchema = z.enum([
  'pre_expiry',
  'post_start',
  'nightly_digest',
  'backup_nudge',
]);
export type ReminderKind = z.infer<typeof ReminderKindSchema>;

export const DispatchStatusSchema = z.enum(['sending', 'sent', 'failed']);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

export const ReminderDispatchSchema = z.object({
  id: z.string().uuid(),
  period_id: z.string().uuid().nullable(),
  islamic_date: IsoDateSchema,
  reminder_kind: ReminderKindSchema,
  dispatch_status: DispatchStatusSchema,
  dispatched_at: z.string(),
  error_message: z.string().max(500).nullable(),
});
export type ReminderDispatch = z.infer<typeof ReminderDispatchSchema>;

export const ExportSnapshotSchema = z.object({
  schema_version: z.literal(1),
  exported_at: z.string(),
  settings: AppSettingsSchema,
  periods: z.array(PeriodSchema),
  actions: z.array(ActionSchema),
  target_versions: z.array(TargetVersionSchema),
  daily_logs: z.array(DailyLogSchema),
  counts: z
    .object({
      periods: z.number().int().nonnegative(),
      actions: z.number().int().nonnegative(),
      target_versions: z.number().int().nonnegative(),
      daily_logs: z.number().int().nonnegative(),
    })
    .optional(),
});
export type ExportSnapshot = z.infer<typeof ExportSnapshotSchema>;

export function makeCellKey(actionId: string, logDate: string): string {
  return `${actionId}::${logDate}`;
}
