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
 *    ("일운 천간 갑목(편재) → 일정/지출 폭증" → "갑목(편재)"). 첫 →/— 앞만 취하고
 *    "일운 천간/지지" 접두는 제거(#542 카드 폭 축소).
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
 * description tail-strip으로는 무슨 뜻인지 안 읽히는(jargon·오기) 시드의 수동 라벨(ADR-0045 §2).
 * 행동 신호(behavior_baseline) description은 코드와 어긋나는 오기가 많아(예: drift는 "카테고리 분포
 * 변화"로 써있으나 실제는 수면 리듬 밀림) 전부 src/shared/insights.ts 감지 로직 기준으로 재작성.
 * 강도 밴드·합화십성은 내부 용어라 평어로. 끝을 "날"로 맞춰 활성 절(activationClause)이 "켜진 날"을
 * 중복으로 안 붙이게 한다. 누적(N개) 시드는 정확해서 strip 유지(적응형 임계 재설계 후속에서 재검토).
 */
export const SEED_LABEL_OVERRIDES: Record<string, string> = {
  // ── 행동 신호 (insights.ts 감지 로직 기준 — description 오기 무시) ──
  life_behavior_spotty: '루틴 듬성듬성 빠진 날', // 최근 7일 중 3~4번 산발 누락
  life_behavior_lapse: '쭉 지키던 루틴 거른 날', // 7일 연속 달성 후 오늘 빠짐
  life_behavior_streak: '루틴 며칠째 연속 달성한 날',
  life_behavior_recovery: '루틴 빠졌다 바로 복귀한 날',
  life_behavior_overdue: '밀린 일정 쌓인 날',
  life_behavior_weekly_regression: '루틴 완료율 지난주보다 떨어진 날',
  life_behavior_week_compare: '루틴 완료율 지난주와 크게 달라진 날',
  life_behavior_slot_gap: '시간대별 루틴 완료율 격차 큰 날',
  life_behavior_skew: '일정이 한 분야에 쏠린 날',
  life_behavior_drift: '수면 리듬 평소보다 밀린 날', // 취침·기상 늦어짐 / 중간기상 잦아짐
  life_behavior_sleep_trend: '수면 시간 사흘 연속 늘거나 준 날',
  // ── 오행 강도 밴드 ("실효 강도 약/강 밴드(상대 분위수)" → 평어) ──
  pool_강도_목_강: '목 기운 강한 날',
  pool_강도_목_약: '목 기운 약한 날',
  pool_강도_목_적정: '목 기운 적정한 날',
  pool_강도_화_강: '화 기운 강한 날',
  pool_강도_화_약: '화 기운 약한 날',
  pool_강도_화_적정: '화 기운 적정한 날',
  pool_강도_토_강: '토 기운 강한 날',
  pool_강도_토_약: '토 기운 약한 날',
  pool_강도_토_적정: '토 기운 적정한 날',
  pool_강도_금_강: '금 기운 강한 날',
  pool_강도_금_약: '금 기운 약한 날',
  pool_강도_금_적정: '금 기운 적정한 날',
  pool_강도_수_강: '수 기운 강한 날',
  pool_강도_수_약: '수 기운 약한 날',
  pool_강도_수_적정: '수 기운 적정한 날',
  pool_강도_일간_강: '신강한 날',
  pool_강도_일간_약: '신약한 날',
  pool_강도_일간_적정: '일간 균형인 날',
  // ── 합화십성 ("합화 변환 결과 효과적 십성 = X 발현일" → 평어) ──
  pool_합화십성_재성: '합화로 재성 기운 도는 날',
  pool_합화십성_비겁: '합화로 비겁 기운 도는 날',
  pool_합화십성_식상: '합화로 식상 기운 도는 날',
  pool_합화십성_인성: '합화로 인성 기운 도는 날',
  pool_합화십성_관성: '합화로 관성 기운 도는 날',
};

/** 활성조건과 예측/설명을 가르는 구분자 — 첫 등장 앞만 라벨로 취한다(( 는 십성 주석이라 제외). */
const SEED_DELIMITERS = ['→', '—', '–'];

/**
 * 천간·지지 시드 접두("일운 천간 "/"일운 지지 ") 제거 — "갑목(편재)"만 남겨 카드 폭 축소(#542).
 * 귀문 등 "지지 귀문 발현일"은 "일운 지지 "로 시작하지 않아 영향 없음.
 */
const SEED_PREFIXES = ['일운 천간 ', '일운 지지 '] as const;
const stripSeedPrefix = (s: string): string => {
  for (const p of SEED_PREFIXES) {
    if (s.startsWith(p)) return s.slice(p.length);
  }
  return s;
};

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
  return stripSeedPrefix(head) || name;
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
  expense_discretionary: { noun: '자유지출' }, // #573: expense_total 개명 — 할부·고정비 제외
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
  // schedule_영화·schedule_이직은 "실제 처리한 날"(status=done) 의미라 방향 룰로 안 떨어짐 →
  // SIGNAL_LABEL_OVERRIDES에서 전체 라벨 직접 지정(#573 ADR-0056).
};

/** 합성·모호 신호 — 룰로 안 떨어져 라벨 전체를 직접 지정(direction 무시). */
const SIGNAL_LABEL_OVERRIDES: Record<string, string> = {
  // audit_date_changed는 #508 ADR-0046에서 방향 신호 2개로 분리·은퇴 — 과거 카드 렌더 대비 라벨만 유지.
  audit_date_changed: '일정 날짜 변경',
  audit_date_postponed: '일정 미룸',
  audit_date_advanced: '일정 당김',
  audit_postponed_done: '미룬 일정 처리',
  // #590 ADR-0060: 삭제 사유(changed_mind) 기반 — "하기 싫어져서 일정을 지운 날".
  audit_cancel_changed_mind: '변심 일정 취소',
  expense_hospital_excl_installment: '병원비 지출(할부 제외)',
  schedule_tax_keyword: '세금 관련 일정',
  // #573 ADR-0056: category_id JOIN + status='done' 재정의 — "그 일정을 실제로 처리한 날".
  schedule_영화: '영화 일정 처리한 날',
  schedule_이직: '이직 일정 처리한 날',
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
  evaluation_exposure: '평가 노출',
  feeling_enough: '충분함 체감',
  palpitation: '두근거림',
  muscle_tension: '결림',
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
      return `${measure} ${hi}`;
    case 'below_avg':
      return `${measure} ${lo}`;
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
