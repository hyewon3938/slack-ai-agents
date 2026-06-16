/**
 * 인사이트 Block Kit 카드 빌더 — P5a 발굴 승인 카드(ADR-0039) + 재기준선 공지(#523 P0, ADR-0048).
 *
 * - 발굴 승인 카드: 여집합 발굴 후보(pending 링크)를 맥락 풍부 카드로 → [추적 시작]/[패스].
 *   사람은 노출·큐레이션만 게이트, 믿음(진짜인지)은 끝까지 e-value 트랙(ADR-0039 §3).
 * - 재기준선 공지: 측정 정밀화 후 전체 재검증 1회성 안내.
 *
 * 주간 검증 리포트 카드(buildVerificationBlocks 등)는 #542(ADR-0052)에서 발송 은퇴 —
 * 사용자-facing 검증 현황은 routine(weekly-saju-review-v2) 통합 카드가 단독 발송한다.
 * 검증 엔진(weekly-verification.ts)은 그대로 — 카드 생성만 사라짐.
 */

import type { KnownBlock } from '@slack/types';
import type { DiscoveryCandidate } from './hypothesis-discovery.js';

const KIND_LABEL: Record<'saju' | 'life_signal', string> = {
  saju: '[사주]',
  life_signal: '[생활]',
};

// ─── P5a 발굴 승인 카드 (ADR-0039 §3) ────────────────────

export const DISCOVERY_APPROVE_ACTION_ID = 'discovery_approve';
export const DISCOVERY_DISMISS_ACTION_ID = 'discovery_dismiss';

/** Slack action value 직렬화 — pending 링크 id만 실어 승인/패스 시 status 전이. */
export interface DiscoveryCardPayload {
  linkId: number;
}

export const encodeDiscoveryPayload = (payload: DiscoveryCardPayload): string =>
  JSON.stringify(payload);

export const decodeDiscoveryPayload = (raw: string): DiscoveryCardPayload | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.linkId !== 'number' || !Number.isFinite(obj.linkId)) return null;
    return { linkId: obj.linkId };
  } catch {
    return null;
  }
};

/** 비율 → 정수 퍼센트 (자연어 본문용). "20%" */
const pct = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

/** 효과크기 → "4.0배". 비유한 → "—" */
const mult = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(1)}배` : '—');

const formatPValue = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '—');

/**
 * off-day 대조 자연어: 발현=분수(작은 표본을 정직하게 드러냄), 평소=비율(큰 baseline 표본 왜곡 없이).
 * effect 산출 불가(off일 0)면 배수 절(節) 생략.
 */
const offDayPhrase = (nActive: number, hit: number, rateOff: number, effect: number): string =>
  Number.isFinite(effect)
    ? `${nActive}일 중 ${hit}일 (평소 ${pct(rateOff)} → ${mult(effect)} 자주)`
    : `${nActive}일 중 ${hit}일 (평소 ${pct(rateOff)})`;

/**
 * 시드 활성 절 — "{시드} 켜진 날". 단 라벨이 이미 "…날/일"로 끝나면(행동·날짜 시드) 그 자체가
 * 날 표현이라 "켜진 날"을 또 붙이지 않는다("발현일 켜진 날" 중복 방지, #504 P2).
 * 끝 괄호 주석("…날(신강)")은 무시하고 그 앞 날/일을 본다.
 */
const activationClause = (seedLabel: string): string =>
  /[날일](\s*\([^)]*\))?$/.test(seedLabel) ? seedLabel : `${seedLabel} 켜진 날`;

// ─── P5a 발굴 후보 카드 빌더 ──────────────────────────────

/** 발굴 후보(pending 링크) 카드 입력 = 후보 + 선INSERT된 링크 id. */
export type DiscoveryCardInput = DiscoveryCandidate & { linkId: number };

/**
 * 발굴 후보 맥락 풍부 카드 — 왜 이 후보인지(off-day 통계 + 평어) + "승인=추적, 통계가 심판" 프레이밍.
 * 사람은 추적 가치(노출·큐레이션)만 게이트. 진짜인지는 주간 e-value 트랙이 몇 주에 걸쳐 가린다.
 */
export const buildDiscoveryCandidateCard = (c: DiscoveryCardInput): KnownBlock[] => {
  const payload = encodeDiscoveryPayload({ linkId: c.linkId });
  const header = `${KIND_LABEL[c.patternKind]} *${c.seedLabel}* × *${c.signalLabel}* — 새 패턴 후보`;
  const stat = `${activationClause(c.seedLabel)} *${c.signalLabel}* — ${offDayPhrase(c.nActive, c.hit, c.rateOff, c.effect)}`;
  const why =
    `_평소보다 자주 겹쳐서 후보로 올렸어. ` +
    `아직 연관일 뿐 — 추적 시작하면 주간 엔진이 몇 주 검정해서 진짜인지 가려._`;
  const sub = `_발굴 근거 q ${formatPValue(c.qValue)} (느슨한 발견 기준 통과). 연관이지 인과 아님._`;
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${stat}\n${why}\n${sub}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '추적 시작' },
          style: 'primary',
          action_id: DISCOVERY_APPROVE_ACTION_ID,
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '패스' },
          action_id: DISCOVERY_DISMISS_ACTION_ID,
          value: payload,
        },
      ],
    },
  ];
};

// ─── 재기준선 1회성 공지 (#523 P0, ADR-0048) ─────────────

/** 재기준선 1회성 공지 카드 입력 — 건수만(구체 패턴 라벨 미노출, §9). */
export interface RebaselineSummary {
  /** confirmed → active 강등 수. */
  demoted: number;
  /** 재기준선 후 같은 기준으로 다시 confirmed 승격된 수. */
  reconfirmed: number;
  /** 재검증한 active 링크 총수. */
  total: number;
}

/**
 * 재기준선 1회성 공지 카드(#523 P0, ADR-0048) — scripts/rebaseline-pattern-links.ts 전용.
 * 측정 로직 정밀화 → 전체 재검증 → '검증됨' 일시 보류를 정직하게 안내. 강등은 낙인이 아니라
 * 측정 정확도의 결과(기준 불변)임을 명시. 구체 패턴 라벨은 노출하지 않고 건수만(§9).
 */
export const buildRebaselineNotice = (s: RebaselineSummary): KnownBlock[] => {
  const head = '🔧 *패턴 검증 재기준선 안내*';
  const body =
    '측정 방식을 좀 더 정밀하게 고쳤어. 발굴로 찾은 패턴이 자길 뽑아준 데이터로 곧장 ' +
    "'검증됨'까지 가는 걸 막으려고, 검증 구간을 그 패턴이 등록된 다음부터로 잡도록 바꿨어. " +
    '그래서 전체 패턴을 한 번 다시 검증했어.';
  const demotionLine =
    s.demoted > 0
      ? `그동안 '검증됨'으로 보던 ${s.demoted}개는 실데이터로 따질 수 있는 구간이 아직 짧아서 '검증 중'으로 내렸어.`
      : "이번엔 '검증됨'에서 내려온 패턴은 없어.";
  const reassure =
    '기준이 빡세진 게 아니라 측정이 정확해진 거야. 데이터 쌓이면 똑같은 기준으로 다시 올라와 — ' +
    '내려간 건 틀렸다는 게 아니라 아직 판단 보류라는 뜻이야.';
  const foot = `재검증 ${s.total}개 · 현재 검증됨 ${s.reconfirmed}개.`;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `${head}\n${body}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `${demotionLine}\n${reassure}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: foot }] },
  ];
};
