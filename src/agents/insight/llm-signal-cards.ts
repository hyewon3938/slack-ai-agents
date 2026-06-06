/**
 * LLM 자율 신호 제안 승인 카드 — #477 P5b (ADR-0040, P5a 승인 게이트 재사용).
 *
 * monthly-signal-suggest routine이 signal_defs(source='llm', status='pending') INSERT 후 후보별 1메시지.
 * 사용자 [측정 시작]/[반려] → actions.ts approveLlmSignal/rejectLlmSignal (pending→active/rejected).
 * 사람은 큐레이션(측정할 가치)만 게이트, 진짜 연관인지는 승인 후 발굴+off-day 통계가 가린다(헌장 ①).
 *
 * (옛 metric-approval-cards.ts 대체 — pattern_metrics era 카드는 DROP된 스키마 참조라 폐기.)
 */

import type { KnownBlock } from '@slack/types';

export const LLM_SIGNAL_APPROVE_ACTION_ID = 'llm_signal_approve';
export const LLM_SIGNAL_REJECT_ACTION_ID = 'llm_signal_reject';

/** Slack action value 직렬화 — 신호 id만 실어 승인/반려 시 status 전이. */
export interface LlmSignalPayload {
  signalId: number;
}

export const encodeLlmSignalPayload = (payload: LlmSignalPayload): string =>
  JSON.stringify(payload);

export const decodeLlmSignalPayload = (raw: string): LlmSignalPayload | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.signalId !== 'number' || !Number.isFinite(obj.signalId)) return null;
    return { signalId: obj.signalId };
  } catch {
    return null;
  }
};

export interface LlmSignalCardInput {
  signalId: number;
  name: string;
  /** LLM이 명시한 측정 의도(자연어). */
  description: string;
  domain: string;
  valueType: 'binary' | 'continuous';
  direction: string;
  /** 검토용 SQL — context 블록에 그대로 노출(사람 게이트의 실질: 승인 전 직접 검토). */
  sqlBody: string;
}

/**
 * 신호 제안 카드 — 측정 의도 + 측정 정의 + 검토용 SQL(투명성) + caveat + [측정 시작]/[반려].
 * SQL을 노출해 승인 전 사용자가 직접 본다. 승인은 "측정 시작"이지 "진짜다"가 아님을 caveat로 명시.
 */
export const buildLlmSignalCard = (input: LlmSignalCardInput): KnownBlock[] => {
  const payload = encodeLlmSignalPayload({ signalId: input.signalId });
  const header = `[신호 제안] *${input.name}*`;
  const detail = `_${input.description}_\n측정: ${input.domain} · ${input.valueType}/${input.direction}`;
  const caveat =
    '_승인=측정 시작일 뿐, 진짜 연관인지는 이후 off-day 통계가 가린다. 연관이지 인과 아님._';
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n${detail}\n${caveat}` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '```' + input.sqlBody + '```' }],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '측정 시작' },
          style: 'primary',
          action_id: LLM_SIGNAL_APPROVE_ACTION_ID,
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '반려' },
          action_id: LLM_SIGNAL_REJECT_ACTION_ID,
          value: payload,
        },
      ],
    },
  ];
};

/** 후보 0건일 때 발사 메시지 (idempotency·로그 추적용). */
export const buildNoSignalSuggestionMessage = (yyyymm: string): KnownBlock[] => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `_${yyyymm} 신호 제안 없음. 다음 달 누적 데이터로 재시도._`,
    },
  },
];
