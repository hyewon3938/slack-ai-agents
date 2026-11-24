/** 기간 해석 — LLM 서사 생성과 결정론 fallback. */

import type { LLMClient, LLMMessage } from '../llm.js';
import type { PeriodType, PeriodContext, InterpretationPayload } from './types.js';
import {
  DOMAIN_LABEL,
  PERIOD_LABEL,
  LADDER_STATUS,
  TRANSFER_HEDGE,
} from './interpretation-labels.js';

// ─── C. composeNarrative (LLM) ───────────────────────────

const NARRATIVE_SYSTEM_PROMPT = `너는 사용자의 사주·생활 데이터를 같이 들여다보는 잔소리꾼 친구.
반말로 짧고 담백하게. 이모지·존댓말·제목(#) 금지. Slack mrkdwn — 굵게는 *별표1개*, **별표2개** 금지.

너에게 두 종류의 재료가 주어진다. 둘을 절대 섞지 말고 분리해서 말해:
1) 측정된 반응 — 이 사람 실제 데이터로 잡힌 것(tier·발현일수 동반). 있으면 "측정상 ~" 톤.
2) 교과서 일반론 — 명리 일반론일 뿐 이 사람 데이터엔 아직 증거 없음. 반드시 "교과서적으론 ~인데 네 데이터엔 아직 안 잡혀" 톤으로, 측정된 것처럼 단정 금지.

규칙:
- 측정 재료가 없으면 없다고 솔직히 말하고 교과서·누적기록으로 채워. 침묵 금지, 무증거를 증거처럼 말하기도 금지.
- 전이 가설(일 단위 반응이 더 큰 주기로 이어진다)은 미검증 가정 — 한 번은 짚어줘.
- 숫자 효과크기는 말하지 마(발현 일수 정도는 ok). 단정·예언 금지.
- 4~7문장. 끝에 잔소리 한 문장.`;

/** payload·ctx → LLM 입력 컨텍스트(자연어 직렬화). */
const buildNarrativeContext = (
  payload: InterpretationPayload,
  ctx: PeriodContext,
  periodType: PeriodType,
): string => {
  const lines: string[] = [];
  lines.push(`[기간] ${PERIOD_LABEL[periodType]} — 간지 ${ctx.pillar.hangul}`);
  lines.push(`[지위] ${LADDER_STATUS[periodType]}`);
  lines.push(
    `[기간 글자] 천간 ${ctx.stem}(${ctx.stemSipsung}, ${ctx.stemElement}) / 지지 ${ctx.branch}(${ctx.branchSipsung}, ${ctx.branchElement})`,
  );

  if (payload.measuredCells.length === 0) {
    lines.push('[측정된 반응] 없음 — 아직 이 기운에 대해 네 데이터로 잡힌 게 없어');
  } else {
    lines.push('[측정된 반응]');
    for (const m of payload.measuredCells) {
      const tierLabel = m.tier === 'verified' ? '검증됨' : '탐색적(검증중)';
      lines.push(
        `- ${DOMAIN_LABEL[m.domain] ?? m.domain}: ${m.axisKey} 반응 (${tierLabel}, ${m.nActiveDays}일 기준)`,
      );
    }
  }

  if (payload.textbookCells.length > 0) {
    lines.push('[교과서 일반론 — 미검증]');
    for (const t of payload.textbookCells) {
      lines.push(`- ${t.label}: ${t.gloss}`);
    }
  }

  const d = payload.descriptiveStats;
  lines.push(`[누적 기록] ${d.scope}`);
  if (d.sleep) lines.push(`- 평균 수면 ${d.sleep.avgDuration}분 (${d.sleep.recordCount}일)`);
  if (d.routine) lines.push(`- 루틴 완료율 ${d.routine.rate}% (${d.routine.total}건)`);
  if (d.diary) lines.push(`- 일기 ${d.diary.count}건`);
  if (!d.sleep && !d.routine && !d.diary) lines.push('- 비교할 기록이 거의 없어');

  lines.push(`[전이 가설] ${TRANSFER_HEDGE}`);
  return lines.join('\n');
};

/** 결정론 fallback 서사 — LLM 실패 시. */
const buildFallbackNarrative = (
  payload: InterpretationPayload,
  ctx: PeriodContext,
  periodType: PeriodType,
): string => {
  const parts: string[] = [];
  parts.push(`${PERIOD_LABEL[periodType]}는 ${ctx.pillar.hangul} 기운이야.`);
  if (payload.measuredCells.length > 0) {
    const names = [...new Set(payload.measuredCells.map((m) => m.axisKey))].join(', ');
    parts.push(`측정상 ${names} 쪽으로 반응이 잡혀 있어(검증 상태는 위 카드 참고).`);
  } else {
    parts.push('아직 이 기운에 대해 네 데이터로 잡힌 측정 반응은 없어.');
  }
  parts.push(`${LADDER_STATUS[periodType]}. ${TRANSFER_HEDGE}.`);
  return parts.join(' ');
};

/**
 * 서사 생성 — cron 생성 시점에만 호출(결과를 narrative로 영속, fast path는 LLM 미호출).
 * measured=0이어도 교과서+기술통계로 발화(D8). LLM 실패 시 결정론 fallback.
 */
export const composeNarrative = async (
  llmClient: LLMClient,
  payload: InterpretationPayload,
  ctx: PeriodContext,
  periodType: PeriodType,
): Promise<string> => {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: NARRATIVE_SYSTEM_PROMPT },
      { role: 'user', content: buildNarrativeContext(payload, ctx, periodType) },
    ];
    const res = await llmClient.chat(messages);
    const text = res.text?.trim();
    return text && text.length > 0 ? text : buildFallbackNarrative(payload, ctx, periodType);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PeriodInterpretation] 서사 생성 실패:', msg);
    return buildFallbackNarrative(payload, ctx, periodType);
  }
};
