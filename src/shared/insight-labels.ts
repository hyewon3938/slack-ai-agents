/**
 * 카드 라벨 레이어 — 시드·신호 내부 식별자를 사용자가 읽을 수 있는 자연어로 (#504 Phase 2, ADR-0045).
 *
 * 프로액티브 인사이트 카드가 노출하던 두 종류의 내부 식별자를 런타임에 번역한다(DB 미변경):
 *  - 시드/신호 변수명: `S1_갑목_편재_천간` · `sleep_night_minutes`
 *  - 신호 description의 잘못된 provenance: "N8_… 시드의 X 평가" — 신호는 #477 P1에서 전역화됐는데
 *    옛 시드 종속 시절 자동생성 문구가 잔존(특정 사주 시드 소속처럼 읽힘).
 *
 * 라벨 비대칭(ADR-0045 §2):
 *  - 시드 = description tail-strip. 시드 description은 hand-authored라 접두가 곧 활성조건
 *    ("일운 천간 갑목(편재) → 일정/지출 폭증" → "일운 천간 갑목(편재)"). 첫 →/— 앞만 취함.
 *  - 신호 = name+domain+direction 룰. 신호 description은 깨진 provenance라 못 쓰고 metadata로 생성.
 *
 * 불변식: 미매핑 신호(미래 LLM 신호 등)도 도메인 명사 fallback으로 끝내 raw 변수명을 노출하지 않는다.
 * 통계·verdict·tier·임계치 일절 불변 — 표현 문자열만(#502 카피 PR 연장).
 */

import type { SignalDirection } from './pattern-verification.js';

// ─── 시드 라벨 (description tail-strip) ───────────────────

export interface SeedLabelInput {
  name: string;
  description: string | null;
}

/**
 * 비정형 description을 가진 시드의 수동 라벨(escape hatch, ADR-0045 §2).
 * 현 시드셋은 전부 tail-strip으로 깔끔히 떨어져 비어 있음 — 향후 strip이 어색한 시드만 등록.
 */
export const SEED_LABEL_OVERRIDES: Record<string, string> = {};

/** 활성조건과 예측/설명을 가르는 구분자 — 첫 등장 앞만 라벨로 취한다(( 는 십성 주석이라 제외). */
const SEED_DELIMITERS = ['→', '—', '–'];

const firstDelimiterIndex = (s: string): number => {
  let min = -1;
  for (const d of SEED_DELIMITERS) {
    const i = s.indexOf(d);
    if (i >= 0 && (min === -1 || i < min)) min = i;
  }
  return min;
};

/**
 * 시드 라벨 = description의 첫 →/— 앞 활성조건. 십성 주석 "(편재)"은 보존.
 * override 우선, description 없으면 name fallback(실무상 미발생 — 전 시드 description 보유).
 */
export const seedLabel = ({ name, description }: SeedLabelInput): string => {
  const override = SEED_LABEL_OVERRIDES[name];
  if (override) return override;
  const desc = description?.trim();
  if (!desc) return name;
  const idx = firstDelimiterIndex(desc);
  const head = (idx >= 0 ? desc.slice(0, idx) : desc).trim();
  return head || name;
};

// ─── 신호 라벨 (name+domain+direction 룰) ─────────────────

export interface SignalLabelInput {
  name: string;
  kind: 'sql' | 'tag';
  source: 'seed' | 'llm';
  direction: SignalDirection | null;
  threshold: number | null;
  tagName: string | null;
  domain: string | null;
  description?: string | null;
}

/** 측정 명사 + above_avg/below_avg 방향 어휘(기본 많음/적음, 율·시각은 별도 지정). */
interface Measure {
  noun: string;
  hi?: string; // above_avg 어휘 (기본 '많음')
  lo?: string; // below_avg 어휘 (기본 '적음')
}

/** sql seed 신호 name → 측정 명사. 한글접미(expense_배달음식)는 도메인 명사로 자연어화. */
const SIGNAL_MEASURE: Record<string, Measure> = {
  // sleep
  sleep_night_minutes: { noun: '밤잠' },
  sleep_total_minutes: { noun: '총 수면 시간' },
  sleep_nap_count: { noun: '낮잠' },
  sleep_wake_hour: { noun: '기상 시각', hi: '늦음', lo: '이름' },
  // expense
  expense_total: { noun: '총 지출' },
  expense_배달음식: { noun: '배달음식 지출' },
  expense_식재료: { noun: '식재료 지출' },
  expense_외식: { noun: '외식 지출' },
  expense_의료건강: { noun: '의료·건강 지출' },
  // routine
  routine_completion_rate: { noun: '루틴 완료율', hi: '높음', lo: '낮음' },
  routine_rate_운동: { noun: '운동 루틴 완료율', hi: '높음', lo: '낮음' },
  // schedule
  schedule_completion_rate: { noun: '일정 완료율', hi: '높음', lo: '낮음' },
  schedule_count_today: { noun: '일정 수' },
  schedule_created: { noun: '등록한 일정' },
  schedule_done: { noun: '완료한 일정' },
  schedule_영화: { noun: '영화 일정' },
  schedule_이직: { noun: '이직 일정' },
};

/** 합성·모호 신호 — 룰로 안 떨어져 라벨 전체를 직접 지정(direction 무시). */
const SIGNAL_LABEL_OVERRIDES: Record<string, string> = {
  audit_date_changed: '일정 날짜 변경',
  audit_postponed_done: '미룬 일정 처리',
  expense_hospital_excl_installment: '병원비 지출(할부 제외)',
  schedule_tax_keyword: '세금 관련 일정',
};

/** diary 태그 enum → 한글 (diary-meta-extract.ts gloss 기반). */
const TAG_LABELS: Record<string, string> = {
  irritation: '짜증',
  health_complaint: '몸 아픔',
  low_energy: '무기력',
  mood_down: '우울감',
  confidence_high: '자신감',
  analytical_mode: '분석 모드',
  deep_thought: '깊은 사색',
  rest: '휴식',
  peaceful: '평온함',
  mood_high: '기분 좋음',
  cooking: '요리',
  creating: '창작',
  talkative: '말 많아짐',
  nostalgia: '향수',
  anxiety: '불안',
  past_memory: '과거 회상',
  wealth_awareness: '돈 인식',
  self_observation: '사주 언급',
  social_activity: '사람 만남',
  physical_activity: '운동·외출',
  task_completion: '일 완료',
  clumsy_overflow: '실수·덤벙',
};

/** 미매핑 신호 fallback 도메인 명사 — raw 변수명 노출 0 불변식의 마지막 방어선. */
const DOMAIN_NOUN: Record<string, string> = {
  sleep: '수면',
  expense: '지출',
  expense_category_present: '지출',
  schedule: '일정',
  routine: '루틴',
  diary_meta: '일기',
  audit: '일정',
};

/** SIGNAL_MEASURE 미등록 신호 → 도메인 명사(+한글접미 보존). 영문 토큰은 절대 출력 안 함. */
const fallbackMeasure = (name: string, domain: string | null): string => {
  const koSuffix = /_([가-힣][가-힣·]*)$/.exec(name)?.[1];
  const base = (domain && DOMAIN_NOUN[domain]) || '지표';
  return koSuffix ? `${base} ${koSuffix}` : base;
};

/** direction → 측정 명사에 붙는 자연어 절. */
const directionPhrase = (
  measure: string,
  direction: SignalDirection | null,
  threshold: number | null,
  hi: string,
  lo: string,
): string => {
  switch (direction) {
    case 'above_avg':
      return `${measure} 평소보다 ${hi}`;
    case 'below_avg':
      return `${measure} 평소보다 ${lo}`;
    case 'above_abs':
      return (threshold ?? 1) <= 1 ? `${measure} 있음` : `${measure} ${threshold}회 이상`;
    case 'below_abs':
      return `${measure} ${threshold ?? 0}회 이하`;
    case 'flag_present':
      return `${measure} 있음`;
    default:
      return measure;
  }
};

/**
 * 신호 라벨 — override → tag맵 → llm 자작 description → seed sql 룰(측정 명사 + 방향 절).
 * 신호 description(provenance 깨짐)은 llm 신호일 때만 사용(자작 의도). 미매핑은 도메인 명사 fallback.
 */
export const signalLabel = (s: SignalLabelInput): string => {
  const override = SIGNAL_LABEL_OVERRIDES[s.name];
  if (override) return override;
  if (s.kind === 'tag') {
    const key = s.tagName ?? s.name;
    return TAG_LABELS[key] ?? fallbackMeasure(s.name, s.domain);
  }
  if (s.source === 'llm') {
    const desc = s.description?.trim();
    if (desc) return desc;
  }
  const m = SIGNAL_MEASURE[s.name];
  const measure = m?.noun ?? fallbackMeasure(s.name, s.domain);
  return directionPhrase(measure, s.direction, s.threshold, m?.hi ?? '많음', m?.lo ?? '적음');
};
