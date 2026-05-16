import { describe, it, expect } from 'vitest';
import { validateLlmInsightResponse } from '../llm-insight-prompts.js';

const validResponse = JSON.stringify({
  findings: [
    {
      signal: '지난 28일 평균 취침 1.2시',
      hypothesis: '다음 7일 아침 루틴 달성률 10%p 이상 감소',
      domains: ['sleep', 'routine'],
      confidence: 'medium',
      verification: {
        sql: 'SELECT COUNT(*) FROM routine_records WHERE user_id = 1',
        result_type: 'scalar_count',
        verify_after_days: 7,
      },
    },
  ],
});

describe('validateLlmInsightResponse', () => {
  it('정상 응답을 파싱한다', () => {
    const drafts = validateLlmInsightResponse(validResponse);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      signal: '지난 28일 평균 취침 1.2시',
      hypothesis: '다음 7일 아침 루틴 달성률 10%p 이상 감소',
      domains: ['sleep', 'routine'],
      confidence: 'medium',
    });
    expect(drafts[0]?.verification.resultType).toBe('scalar_count');
    expect(drafts[0]?.verification.verifyAfterDays).toBe(7);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(validateLlmInsightResponse('')).toEqual([]);
  });

  it('JSON 파싱 실패 시 빈 배열', () => {
    expect(validateLlmInsightResponse('not json')).toEqual([]);
    expect(validateLlmInsightResponse('{malformed')).toEqual([]);
  });

  it('findings가 배열 아니면 빈 배열', () => {
    expect(validateLlmInsightResponse('{"findings": "x"}')).toEqual([]);
    expect(validateLlmInsightResponse('{}')).toEqual([]);
  });

  it('SQL에 DELETE 포함 시 해당 finding 제외', () => {
    const payload = JSON.stringify({
      findings: [
        {
          signal: 'x',
          hypothesis: 'y',
          domains: ['sleep'],
          confidence: 'high',
          verification: {
            sql: 'DELETE FROM users; SELECT 1',
            result_type: 'boolean',
            verify_after_days: 5,
          },
        },
      ],
    });
    expect(validateLlmInsightResponse(payload)).toEqual([]);
  });

  it('SQL에 DROP/TRUNCATE/ALTER 포함 시 제외', () => {
    const cases = ['DROP TABLE x', 'TRUNCATE x', 'ALTER TABLE x', 'INSERT INTO x VALUES(1)'];
    for (const sql of cases) {
      const payload = JSON.stringify({
        findings: [
          {
            signal: 'x',
            hypothesis: 'y',
            domains: ['sleep'],
            confidence: 'medium',
            verification: { sql, result_type: 'scalar_count', verify_after_days: 7 },
          },
        ],
      });
      expect(validateLlmInsightResponse(payload), sql).toEqual([]);
    }
  });

  it('result_type 화이트리스트 외 값은 제외', () => {
    const payload = JSON.stringify({
      findings: [
        {
          signal: 'x',
          hypothesis: 'y',
          domains: ['sleep'],
          confidence: 'medium',
          verification: { sql: 'SELECT 1', result_type: 'text', verify_after_days: 7 },
        },
      ],
    });
    expect(validateLlmInsightResponse(payload)).toEqual([]);
  });

  it('verify_after_days 범위 외 값은 1~28로 클램프', () => {
    const buildPayload = (days: number): string =>
      JSON.stringify({
        findings: [
          {
            signal: 'x',
            hypothesis: 'y',
            domains: ['sleep'],
            confidence: 'medium',
            verification: { sql: 'SELECT 1', result_type: 'boolean', verify_after_days: days },
          },
        ],
      });

    expect(validateLlmInsightResponse(buildPayload(0))[0]?.verification.verifyAfterDays).toBe(1);
    expect(validateLlmInsightResponse(buildPayload(-5))[0]?.verification.verifyAfterDays).toBe(1);
    expect(validateLlmInsightResponse(buildPayload(100))[0]?.verification.verifyAfterDays).toBe(28);
    expect(validateLlmInsightResponse(buildPayload(14))[0]?.verification.verifyAfterDays).toBe(14);
  });

  it('confidence가 low면 제외 (medium/high만 허용)', () => {
    const payload = JSON.stringify({
      findings: [
        {
          signal: 'x',
          hypothesis: 'y',
          domains: ['sleep'],
          confidence: 'low',
          verification: { sql: 'SELECT 1', result_type: 'boolean', verify_after_days: 7 },
        },
      ],
    });
    expect(validateLlmInsightResponse(payload)).toEqual([]);
  });

  it('signal/hypothesis/domains 누락 시 제외', () => {
    const base = {
      signal: 'x',
      hypothesis: 'y',
      domains: ['sleep'],
      confidence: 'medium',
      verification: { sql: 'SELECT 1', result_type: 'boolean', verify_after_days: 7 },
    };
    const missingSignal = { ...base, signal: '' };
    const missingDomains = { ...base, domains: [] };
    expect(validateLlmInsightResponse(JSON.stringify({ findings: [missingSignal] }))).toEqual([]);
    expect(validateLlmInsightResponse(JSON.stringify({ findings: [missingDomains] }))).toEqual([]);
  });

  it('JSON 앞뒤에 부가 텍스트가 있어도 추출', () => {
    const wrapped = `여기 분석 결과야:\n${validResponse}\n끝.`;
    const drafts = validateLlmInsightResponse(wrapped);
    expect(drafts).toHaveLength(1);
  });
});
