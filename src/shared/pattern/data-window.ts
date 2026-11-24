/**
 * 데이터-존재 윈도우 계산 (pattern-verification에서 분리).
 */

import { query } from '../db.js';
import { BEHAVIOR_SIGNAL_DOMAIN } from '../insights/types.js';
import { addDays } from '../kst.js';

// ─── 데이터-존재 윈도우 (#504, ADR-0044) ─────────────────
// 발굴·검증의 측정 아티팩트 제거: 윈도우를 365일 고정이 아니라 "그 시드와 그 신호가 둘 다
// 데이터를 가진 구간"으로 한정한다. 사용자가 시스템을 쓰기 시작한 날(첫 기록) 이전의 빈 과거는
// COALESCE(SUM,0)=0=fail로 세지 않는다(비발현 pass율 0 → rate ratio 폭발 = GIGO). 활성 기간 내
// "기록 없음"은 의미로 살린다(floor 위는 보존). 검증·발굴 양쪽이 동일 클립을 경유 → 둘 다 정직.

/** 신호 domain → 데이터-존재 기준 테이블. audit는 기록 계기(schedule_changes) 자체의 시작을 따름. */
const DOMAIN_TABLE: Record<string, string> = {
  schedule: 'schedules',
  routine: 'routine_records',
  sleep: 'sleep_records',
  expense: 'expenses',
  expense_category_present: 'expenses',
  diary_meta: 'diary_meta_tags',
  audit: 'schedule_changes',
};

/** 글로벌 floor(온보딩) 산출 대상 테이블 — DATE+user_id 보유 라이프 데이터 테이블. */
const DATA_TABLES = [
  'schedules',
  'routine_records',
  'sleep_records',
  'expenses',
  'diary_meta_tags',
] as const;

// life_signal behavior_baseline signal_name → 의존 도메인: insights/types.ts의 BEHAVIOR_SIGNAL_DOMAIN이
// 단일 진실(각 detect 함수의 domain 선언). #510 — 옛 로컬 맵이 slotGap·weekComparison을 schedule로
// 적던 드리프트 제거(실제는 routine_records 집계 = routine).

export interface UserDataStarts {
  /** 테이블별 첫 기록일(YYYY-MM-DD). 데이터 없는 테이블은 키 없음. */
  byTable: Map<string, string>;
  /** 전체 최소 = 글로벌 온보딩 floor. 매핑 누락 도메인·saju 시드 fallback. null=데이터 0(클립 안 함). */
  global: string | null;
}

/**
 * 테이블별 추가 존재 조건 — 신호가 실제로 측정하는 행만 윈도우 시작을 정한다 (ADR-0061).
 * 값은 고정 리터럴(사용자 입력 아님)이라 테이블명 인터폴레이션과 같은 안전 근거를 공유한다.
 */
const DATA_TABLE_EXTRA_WHERE: Partial<Record<(typeof DATA_TABLES)[number], string>> = {
  // 자율 루틴 기록은 기대된 발생이 아니다. 이걸 세면 루틴 신호의 측정 윈도우가 과거로 앞당겨지고
  // 그 구간은 COALESCE(SUM,0)=0=fail로 세지는 빈 과거가 된다 — ADR-0044가 없앤 GIGO의 재발.
  routine_records: "entry_type = 'scheduled'",
};

/**
 * 유저의 라이프 데이터 테이블별 첫 기록일 + 글로벌 floor를 1회 산출 (#504).
 * 테이블명은 고정 allowlist(DATA_TABLES)라 인터폴레이션 안전(파라미터화 불가 대상).
 */
export const computeUserDataStarts = async (userId: number): Promise<UserDataStarts> => {
  const byTable = new Map<string, string>();
  for (const table of DATA_TABLES) {
    const extra = DATA_TABLE_EXTRA_WHERE[table];
    const res = await query<{ d: string | null }>(
      `SELECT MIN(date)::text AS d FROM ${table} WHERE user_id = $1${extra ? ` AND ${extra}` : ''}`,
      [userId],
    );
    const d = res.rows[0]?.d ?? null;
    if (d) byTable.set(table, d);
  }
  let global: string | null = null;
  for (const d of byTable.values()) if (global === null || d < global) global = d;

  // audit 도메인 특례(#572 ADR-0054): 기록 계기(schedule_changes)는 date 컬럼 없이 changed_at뿐이라
  // DATA_TABLES 루프(MIN(date))에 못 들어간다. audit이 기록 가능해진 날(첫 changed_at, KST)부터가 존재
  // 구간 — schedules 첫 데이터가 아니라. global floor 산출 뒤에 넣어 온보딩 floor를 오염시키지 않는다
  // (audit 계기는 라이프 데이터 시작이 아님).
  const auditRes = await query<{ d: string | null }>(
    `SELECT MIN(DATE(changed_at AT TIME ZONE 'Asia/Seoul'))::text AS d
       FROM schedule_changes WHERE user_id = $1`,
    [userId],
  );
  const auditStart = auditRes.rows[0]?.d ?? null;
  if (auditStart) byTable.set('schedule_changes', auditStart);

  return { byTable, global };
};

/** 신호 domain → 데이터-존재 시작일 (매핑 없거나 데이터 없으면 글로벌 floor). */
export const signalDataStart = (domain: string | null, starts: UserDataStarts): string | null => {
  const table = domain ? DOMAIN_TABLE[domain] : undefined;
  return (table ? starts.byTable.get(table) : undefined) ?? starts.global;
};

/** life_signal trigger_aux → 의존 라이프 도메인 (calendar 류는 null = 데이터 비의존 → floor). */
const lifeSignalDomain = (aux: Record<string, unknown> | null): string | null => {
  if (!aux) return null;
  const kind = aux['kind'];
  if (kind === 'threshold') {
    const source = aux['source'];
    if (source === 'sleep_minutes') return 'sleep';
    if (source === 'routine_streak_max') return 'routine';
    return null;
  }
  if (kind === 'behavior_baseline') {
    const name = aux['signal_name'];
    return (
      (typeof name === 'string'
        ? (BEHAVIOR_SIGNAL_DOMAIN as Record<string, string>)[name]
        : undefined) ?? null
    );
  }
  return null; // weekday/weekday_group/month_position/season/calendar_event = 캘린더(데이터 비의존)
};

/** 시드 데이터-존재 시작일. saju=글로벌 floor(매일 일운 존재), life_signal=의존 도메인 시작(없으면 floor). */
export const seedDataStart = (
  seed: { trigger_target_type: string; trigger_aux: Record<string, unknown> | null },
  starts: UserDataStarts,
): string | null => {
  if (seed.trigger_target_type !== 'life_signal') return starts.global;
  const domain = lifeSignalDomain(seed.trigger_aux);
  const table = domain ? DOMAIN_TABLE[domain] : undefined;
  return (table ? starts.byTable.get(table) : undefined) ?? starts.global;
};

/** 두 ISO 일자의 max (null = 제약 없음 = -무한). 둘 다 null이면 null. */
export const maxDate = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
};

/**
 * 등록(enrollment) 클립 시작일 — 선택 편향 차단 (#523 Phase 0, D1, ADR-0048).
 * 발굴(discovery)·LLM 제안 출신 링크는 자기를 뽑은 데이터로 그대로 확정되는 double-dipping을
 * 막기 위해 검정 시퀀스를 등록(created_at, KST) 다음 날부터로 한정한다 — e-value의 "test from now"
 * 정신(가설이 데이터와 독립으로 고정된 뒤부터만 검정). 카탈로그(manual=선험 가설) 링크는 선택이
 * 없으므로 전체 데이터 윈도우 유지(null = 제약 없음). createdDate 결측 시에도 클립 없음(보수적).
 */
export const enrollmentStart = (source: string, createdDateKst: string | null): string | null => {
  if (source === 'manual') return null;
  if (createdDateKst === null) return null;
  return addDays(createdDateKst, 1);
};
