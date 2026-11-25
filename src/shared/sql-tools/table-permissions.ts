/**
 * SQL 도구 전용 DB 역할의 테이블 권한 목록 (ADR-0067).
 *
 * LLM이 쓴 SQL은 권한을 줄인 도구 역할로 실행한다. 봇 시작 시 동기화 단계가 이 목록대로
 * GRANT를 맞추고, SQL 검사의 변경 대상 판단도 같은 목록을 읽는다.
 * 마이그레이션의 모든 테이블·뷰를 이름으로 적어 두고, 권한을 주지 않는 것도 'none'으로 적는다.
 * 새 테이블을 만들면 이 목록에 넣어야 정합 테스트(sql-table-scope.test.ts)가 통과한다.
 */

export type TableAccess =
  | { access: 'none' }
  | { access: 'read' }
  | {
      access: 'write';
      insert: boolean;
      /** true면 모든 컬럼, 배열이면 그 컬럼만 UPDATE */
      update: boolean | readonly string[];
      delete: boolean;
      /**
       * INSERT 권한은 트리거가 쓰는 용도로만 준다. 도구 SQL이 직접 INSERT하는 것은 검사가 거절한다.
       * 트리거 함수는 SQL을 실행한 역할의 권한으로 돌기 때문에 이 권한이 필요하다.
       */
      insertByTriggerOnly?: boolean;
    };

const NONE: TableAccess = { access: 'none' };
const READ: TableAccess = { access: 'read' };
const FULL: TableAccess = { access: 'write', insert: true, update: true, delete: true };

export const TABLE_PERMISSIONS: Readonly<Record<string, TableAccess>> = {
  // ---- 읽고 쓰기: 에이전트 프롬프트가 변경 대상으로 안내하는 테이블 ----
  schedules: FULL,
  categories: FULL,
  routine_templates: FULL,
  routine_records: FULL,
  sleep_records: FULL,
  sleep_events: FULL,
  reminders: FULL,
  custom_instructions: FULL,
  /** 슬롯은 고정이라 시간 컬럼만 바꾼다 (prompt-sections.ts REMINDER_SECTION 알림 설정 규칙) */
  notification_settings: { access: 'write', insert: false, update: ['time_value'], delete: false },
  /** 일정 변경 이력: 트리거가 INSERT하고, 도구는 삭제 사유 컬럼만 채운다 */
  schedule_changes: {
    access: 'write',
    insert: true,
    insertByTriggerOnly: true,
    update: ['delete_reason_category', 'delete_reason_text'],
    delete: false,
  },

  // ---- 읽기만: 사용자 데이터 ----
  assets: READ,
  budget_settings: READ,
  category_limits: READ,
  daily_budget_logs: READ,
  daily_insight_log: READ,
  diary_entries: READ,
  diary_meta_tags: READ,
  expenses: READ,
  fixed_cost_records: READ,
  fixed_costs: READ,
  fortune_analyses: READ,
  fortune_calls: READ,
  life_themes: READ,
  link_weekly_stats: READ,
  monthly_budget_snapshots: READ,
  pattern_catalog: READ,
  pattern_links: READ,
  period_forecasts: READ,
  period_interpretations: READ,
  planned_expenses: READ,
  routine_inactive_periods: READ,
  saju_patterns: READ,
  saju_profiles: READ,
  saju_response_profile: READ,
  saju_weekly_reviews: READ,
  seed_daily_activations: READ,
  signal_defs: READ,
  signal_suggest_runs: READ,
  strength_band_cutpoints: READ,

  // ---- 읽기만: 모든 사용자가 같이 읽는 사주 기준표 ----
  branch_relations: READ,
  branches_master: READ,
  ganji_master: READ,
  sibiunsung_lookup: READ,
  sipsin_lookup: READ,
  stem_relations: READ,
  stems_master: READ,

  // ---- 권한 없음 ----
  users: NONE,
  schema_migrations: NONE,
  /** 확인 카드가 실행할 SQL을 담으므로 도구 SQL로는 읽거나 바꿀 수 없어야 한다 */
  pending_modify: NONE,
  slack_user_mappings: NONE,
  // 뷰
  pattern_summary: NONE,
  saju_influence_summary: NONE,
  schedule_fate: NONE,
};

/** 목록에 없는 테이블은 권한 없음으로 본다 */
export const getTableAccess = (table: string): TableAccess =>
  Object.hasOwn(TABLE_PERMISSIONS, table) ? (TABLE_PERMISSIONS[table] ?? NONE) : NONE;

export type ModifyOp = 'insert' | 'update' | 'delete';

/**
 * 도구 SQL이 이 테이블에 이 작업을 할 수 있는지.
 * UPDATE 컬럼이 제한된 테이블은 SET 왼쪽에 나온 식별자가 모두 허용 컬럼이어야 한다.
 */
export const isToolModifyAllowed = (
  table: string,
  op: ModifyOp,
  setColumns: readonly string[] = [],
): boolean => {
  const entry = getTableAccess(table);
  if (entry.access !== 'write') return false;
  if (op === 'insert') return entry.insert && !entry.insertByTriggerOnly;
  if (op === 'delete') return entry.delete;
  if (entry.update === true) return true;
  if (entry.update === false) return false;
  const allowed = new Set(entry.update);
  return setColumns.length > 0 && setColumns.every((c) => allowed.has(c));
};
