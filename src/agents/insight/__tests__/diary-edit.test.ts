import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/db.js', () => ({ query: vi.fn() }));
vi.mock('../../../shared/llm.js', () => ({ createDiaryMetaLLMClient: vi.fn() }));
vi.mock('../../../cron/diary-meta-extract.js', () => ({ extractAndPersistForUser: vi.fn() }));

const {
  parseDiaryLookup,
  splitDiaryContent,
  joinDiaryParts,
  encodeDiaryEditMeta,
  decodeDiaryEditMeta,
  hashDiaryContent,
  buildDiaryEditModal,
  buildDiaryLookupBlocks,
  readDiaryEditSubmission,
  DIARY_DATE_BLOCK_ID,
  DIARY_EDIT_ACTION_ID,
} = await import('../diary-edit.js');

const TODAY = '2026-10-22';

describe('parseDiaryLookup', () => {
  it('메시지 전체가 "M/D 일기"면 날짜로 해석', () => {
    expect(parseDiaryLookup('10/21 일기', TODAY)).toEqual({ kind: 'date', date: '2026-10-21' });
    expect(parseDiaryLookup('10/21일기', TODAY)).toEqual({ kind: 'date', date: '2026-10-21' });
  });

  it('오늘보다 뒤 M/D는 작년', () => {
    expect(parseDiaryLookup('12/25 일기', TODAY)).toEqual({ kind: 'date', date: '2025-12-25' });
  });

  it('없는 날짜는 invalid_date', () => {
    expect(parseDiaryLookup('2/30 일기', TODAY)).toEqual({ kind: 'invalid_date', token: '2/30' });
  });

  it('뒤에 다른 말이 붙으면 조회가 아니다', () => {
    expect(parseDiaryLookup('10/21 일기 쓰기 귀찮다', TODAY)).toEqual({ kind: 'none' });
    expect(parseDiaryLookup('10/21 산책했다', TODAY)).toEqual({ kind: 'none' });
    expect(parseDiaryLookup('오늘 일기', TODAY)).toEqual({ kind: 'none' });
  });
});

describe('splitDiaryContent / joinDiaryParts', () => {
  it('짧은 일기는 조각 1개', () => {
    expect(splitDiaryContent('a\nb')).toEqual({ parts: ['a\nb'], joins: [] });
    expect(splitDiaryContent('')).toEqual({ parts: [''], joins: [] });
  });

  it('줄 경계에서 나누고 경계를 줄바꿈으로 기록', () => {
    const content = `${'a'.repeat(6)}\n${'b'.repeat(6)}\n${'c'.repeat(3)}`;
    const { parts, joins } = splitDiaryContent(content, 10);
    expect(parts).toEqual(['aaaaaa', 'bbbbbb\nccc']);
    expect(joins).toEqual(['n']);
    expect(joinDiaryParts(parts, joins)).toBe(content);
  });

  it('max를 넘는 한 줄은 글자 수로 자르고 바로 이어진 글로 기록', () => {
    const content = `${'x'.repeat(25)}\nend`;
    const { parts, joins } = splitDiaryContent(content, 10);
    expect(parts).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5) + '\nend']);
    expect(joins).toEqual(['c', 'c']);
    expect(joinDiaryParts(parts, joins)).toBe(content);
  });

  it('서로게이트 쌍 중간을 자르지 않는다', () => {
    const content = `${'a'.repeat(9)}😀b`;
    const { parts } = splitDiaryContent(content, 10);
    expect(parts[0]).toBe('a'.repeat(9));
    expect(parts[1]).toBe('😀b');
  });

  it('실제 3000자 기준으로 왕복해도 원문 그대로', () => {
    const line = '가'.repeat(1200);
    const content = [line, line, line, 'z'.repeat(7000), '끝'].join('\n');
    const { parts, joins } = splitDiaryContent(content);
    expect(parts.every((p) => p.length <= 3000)).toBe(true);
    expect(joinDiaryParts(parts, joins)).toBe(content);
  });

  it('비운 입력칸은 경계째 건너뛴다', () => {
    expect(joinDiaryParts(['a', '', 'b'], ['n', 'c'])).toBe('a\nb');
    expect(joinDiaryParts(['a', '', 'b'], ['c', 'c'])).toBe('ab');
    expect(joinDiaryParts(['', 'b'], ['n'])).toBe('b');
    expect(joinDiaryParts(['a', ''], ['n'])).toBe('a');
    expect(joinDiaryParts(['', ''], ['n'])).toBe('');
  });
});

describe('metadata', () => {
  const meta = { id: 7, date: '2026-10-21', hash: 'abcd', channel: 'C1', ts: '1.2', joins: 'nc' };

  it('왕복', () => {
    expect(decodeDiaryEditMeta(encodeDiaryEditMeta(meta))).toEqual(meta);
  });

  it('형식이 어긋나면 null', () => {
    expect(decodeDiaryEditMeta('not json')).toBeNull();
    expect(decodeDiaryEditMeta(JSON.stringify({ ...meta, id: '7' }))).toBeNull();
    expect(decodeDiaryEditMeta(JSON.stringify({ ...meta, joins: 'x' }))).toBeNull();
  });

  it('해시는 내용이 다르면 달라진다', () => {
    expect(hashDiaryContent('a')).toHaveLength(16);
    expect(hashDiaryContent('a')).not.toBe(hashDiaryContent('b'));
  });
});

describe('buildDiaryEditModal', () => {
  const base = { id: 7, date: '2026-10-21', channel: 'C1', ts: '1.2' };

  it('짧은 일기는 입력칸 1개, metadata에 원문 해시', () => {
    const view = buildDiaryEditModal(base, '산책했다');
    const inputs = view.blocks.filter((b) => b.type === 'input');
    expect(inputs).toHaveLength(2); // 날짜 + 내용
    const meta = decodeDiaryEditMeta(view.private_metadata ?? '');
    expect(meta).toEqual({ ...base, hash: hashDiaryContent('산책했다'), joins: '' });
    expect((view.private_metadata ?? "").length).toBeLessThanOrEqual(3000);
  });

  it('마지막 입력칸이 2000자를 넘으면 빈 입력칸을 더 둔다', () => {
    const view = buildDiaryEditModal(base, 'a'.repeat(2500));
    const parts = view.blocks.filter(
      (b) => b.type === 'input' && b.block_id !== DIARY_DATE_BLOCK_ID,
    );
    expect(parts).toHaveLength(2);
    expect(decodeDiaryEditMeta(view.private_metadata ?? '')?.joins).toBe('n');
  });
});

describe('readDiaryEditSubmission', () => {
  it('날짜와 다시 붙인 내용을 꺼낸다', () => {
    const values = {
      [DIARY_DATE_BLOCK_ID]: { date: { selected_date: '2026-10-20' } },
      diary_part_0: { text: { value: 'a' } },
      diary_part_1: { text: { value: null } },
      diary_part_2: { text: { value: 'b' } },
    };
    expect(readDiaryEditSubmission(values, 'nn')).toEqual({ date: '2026-10-20', content: 'a\nb' });
  });
});

describe('buildDiaryLookupBlocks', () => {
  it('제목·본문 section과 수정 버튼, mrkdwn 특수문자 이스케이프', () => {
    const blocks = buildDiaryLookupBlocks(7, '2026-10-21', 'a <b> & c', TODAY);
    const first = blocks[0] as { text: { text: string } };
    expect(first.text.text).toBe('*10/21(수) 일기*\na &lt;b&gt; &amp; c');
    const actions = blocks[blocks.length - 1] as {
      elements: Array<{ action_id: string; value: string }>;
    };
    expect(actions.elements[0]).toMatchObject({ action_id: DIARY_EDIT_ACTION_ID, value: '7' });
  });

  it('긴 일기도 section마다 3000자 이하, 엔티티 중간을 자르지 않는다', () => {
    const blocks = buildDiaryLookupBlocks(7, '2026-10-21', '&'.repeat(5000), TODAY);
    const texts = blocks.slice(0, -1).map((b) => (b as { text: { text: string } }).text.text);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(3000);
    expect(texts.slice(1).every((t) => /^(&amp;)+$/.test(t))).toBe(true);
    expect(texts.join('').split('&amp;').length - 1).toBe(5000);
  });
});
