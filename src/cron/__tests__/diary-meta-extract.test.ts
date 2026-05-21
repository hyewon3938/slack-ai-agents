import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMMessage } from '../../shared/llm.js';
import { DIARY_META_TAGS, parseTagResponse, extractDiaryTags } from '../diary-meta-extract.js';

// ─── parseTagResponse: 허용 enum 화이트리스트 ──────────────

describe('parseTagResponse', () => {
  it('순수 JSON 배열 — 허용 태그 그대로 통과', () => {
    expect(parseTagResponse('["irritation","low_energy"]')).toEqual(['irritation', 'low_energy']);
  });

  it('허용되지 않은 태그는 폐기, 허용 태그만 통과', () => {
    expect(parseTagResponse('["irritation","totally_made_up","mood_down"]')).toEqual([
      'irritation',
      'mood_down',
    ]);
  });

  it('JSON 앞뒤 공백·설명문이 섞여도 첫 배열 토큰 추출', () => {
    const raw = '  결과:\n["rest","peaceful"]\n끝';
    expect(parseTagResponse(raw)).toEqual(['rest', 'peaceful']);
  });

  it('JSON 형식 깨지면 빈 배열', () => {
    expect(parseTagResponse('["irritation"')).toEqual([]);
    expect(parseTagResponse('not json')).toEqual([]);
  });

  it('빈 입력·null 처리', () => {
    expect(parseTagResponse('')).toEqual([]);
    expect(parseTagResponse(null)).toEqual([]);
    expect(parseTagResponse('[]')).toEqual([]);
  });

  it('배열이 아니면 빈 배열', () => {
    expect(parseTagResponse('{"tag":"irritation"}')).toEqual([]);
    expect(parseTagResponse('"irritation"')).toEqual([]);
  });

  it('중복 태그 제거', () => {
    expect(parseTagResponse('["rest","rest","peaceful"]')).toEqual(['rest', 'peaceful']);
  });

  it('문자열 외 항목(숫자·객체) 무시', () => {
    expect(parseTagResponse('["irritation",42,{"x":1},"rest"]')).toEqual(['irritation', 'rest']);
  });

  it('허용 태그 전부 정상 통과 (22개)', () => {
    const all = JSON.stringify(DIARY_META_TAGS);
    expect(parseTagResponse(all).length).toBe(DIARY_META_TAGS.length);
    expect(DIARY_META_TAGS.length).toBe(22);
  });
});

// ─── extractDiaryTags: LLM 호출 통합 ──────────────────────

describe('extractDiaryTags', () => {
  const buildLLM = (responseText: string | null): LLMClient => ({
    chat: vi.fn(async () => ({
      text: responseText,
      toolCalls: [],
      finishReason: 'stop' as const,
    })),
  });

  it('LLM이 JSON 배열을 돌려주면 enum 화이트리스트로 필터링한 태그 반환', async () => {
    const llm = buildLLM('["mood_high","rest","not_an_enum"]');
    const tags = await extractDiaryTags(llm, '오늘 푹 쉬고 기분 좋았어');
    expect(tags).toEqual(['mood_high', 'rest']);
  });

  it('LLM 응답이 깨지면 빈 배열 — 폴백 동작', async () => {
    const llm = buildLLM('LLM이 형식을 망쳤어요');
    const tags = await extractDiaryTags(llm, '내용');
    expect(tags).toEqual([]);
  });

  it('LLM이 null 반환 시 빈 배열', async () => {
    const llm = buildLLM(null);
    const tags = await extractDiaryTags(llm, '내용');
    expect(tags).toEqual([]);
  });

  it('LLM에 시스템 + 유저 메시지 2개가 전달됨', async () => {
    const llm = buildLLM('[]');
    await extractDiaryTags(llm, '일기 본문');
    const chatMock = llm.chat as ReturnType<typeof vi.fn>;
    expect(chatMock).toHaveBeenCalledTimes(1);
    const messages = chatMock.mock.calls[0]?.[0] as LLMMessage[];
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    // 시스템 프롬프트에 enum 22개 모두 포함되어야 함 (LLM이 enum 외 출력하지 않도록)
    const systemContent = messages[0]?.content as string;
    for (const tag of DIARY_META_TAGS) {
      expect(systemContent).toContain(tag);
    }
  });
});
