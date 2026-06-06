import { describe, it, expect } from 'vitest';
import {
  buildLlmSignalCard,
  buildNoSignalSuggestionMessage,
  encodeLlmSignalPayload,
  decodeLlmSignalPayload,
  LLM_SIGNAL_APPROVE_ACTION_ID,
  LLM_SIGNAL_REJECT_ACTION_ID,
  type LlmSignalCardInput,
} from '../llm-signal-cards.js';

describe('llm-signal-cards payload', () => {
  it('encode → decode round-trip', () => {
    const raw = encodeLlmSignalPayload({ signalId: 42 });
    expect(decodeLlmSignalPayload(raw)).toEqual({ signalId: 42 });
  });

  it('잘못된 payload는 null', () => {
    expect(decodeLlmSignalPayload('not json')).toBeNull();
    expect(decodeLlmSignalPayload('{}')).toBeNull();
    expect(decodeLlmSignalPayload('{"signalId":"x"}')).toBeNull();
    expect(decodeLlmSignalPayload('null')).toBeNull();
  });
});

describe('buildLlmSignalCard', () => {
  const input: LlmSignalCardInput = {
    signalId: 7,
    name: '늦잠 다음날 루틴 누락',
    description: '늦게 일어난 날 아침 루틴을 더 자주 빠뜨리는지',
    domain: 'routine',
    valueType: 'binary',
    direction: 'below_avg',
    sqlBody: 'SELECT count(*) FROM routine_records WHERE user_id = $1 AND date = $2',
  };

  it('헤더·의도·SQL·승인/반려 버튼을 포함한다', () => {
    const blocks = buildLlmSignalCard(input);
    const json = JSON.stringify(blocks);
    expect(json).toContain('신호 제안');
    expect(json).toContain(input.name);
    expect(json).toContain(input.description);
    expect(json).toContain(input.sqlBody); // 검토용 SQL 노출(투명성)
    expect(json).toContain(LLM_SIGNAL_APPROVE_ACTION_ID);
    expect(json).toContain(LLM_SIGNAL_REJECT_ACTION_ID);
  });

  it('버튼 value에 signalId payload가 실린다', () => {
    const blocks = buildLlmSignalCard(input);
    const actions = blocks.find((b) => b.type === 'actions');
    const elements = (actions as { elements?: Array<{ value?: string }> } | undefined)?.elements;
    expect(elements?.[0]?.value).toBeDefined();
    expect(decodeLlmSignalPayload(elements?.[0]?.value ?? '')).toEqual({ signalId: 7 });
  });

  it('caveat — 승인=측정 시작이지 인과 아님', () => {
    const json = JSON.stringify(buildLlmSignalCard(input));
    expect(json).toContain('인과');
  });
});

describe('buildNoSignalSuggestionMessage', () => {
  it('월 표기를 포함한 0건 메시지', () => {
    const json = JSON.stringify(buildNoSignalSuggestionMessage('2026-06'));
    expect(json).toContain('2026-06');
    expect(json).toContain('신호 제안 없음');
  });
});
