/**
 * Insight 에이전트 — Slack 일기 수정 (#639).
 * 일기 본문을 입력칸 크기로 나누고 다시 붙인다. DB·Slack 호출 없음.
 */

/** Slack 입력칸·section 하나가 받는 최대 글자 수 */
export const SLACK_TEXT_MAX = 3000;
/** 마지막 입력칸이 이 길이를 넘으면 빈 입력칸을 하나 더 둔다 */ // ─── 입력칸 나누기 / 다시 붙이기 ──────────────────────────

/** 입력칸 사이 경계: 'n' = 원래 줄바꿈, 'c' = 바로 이어진 글 */
export type PartJoin = 'n' | 'c';

export interface DiaryParts {
  parts: string[];
  /** joins[i] = parts[i]와 parts[i+1] 사이 경계 */
  joins: PartJoin[];
}

/**
 * 자를 위치 보정. 서로게이트 쌍과 &amp; 같은 엔티티 중간을 자르지 않는다.
 * 엔티티가 아닌 &에서 앞당겨져도 조각이 조금 짧아질 뿐이다.
 */
const safeCut = (s: string, at: number): number => {
  const amp = s.lastIndexOf('&', at - 1);
  if (amp > at - 5 && amp > 0) {
    const semi = s.indexOf(';', amp);
    if (semi >= at && semi < amp + 5) return amp;
  }
  const code = s.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at;
};

/**
 * 일기를 max자 이하 조각으로 나눈다. 줄 경계에서 나누고, max자를 넘는 줄만 글자 수로 자른다.
 * 빈 일기는 빈 조각 1개.
 */
export const splitDiaryContent = (content: string, max: number = SLACK_TEXT_MAX): DiaryParts => {
  const parts: string[] = [];
  const joins: PartJoin[] = [];
  let current: string | null = null;

  const flush = (join: PartJoin): void => {
    if (current === null) return;
    parts.push(current);
    joins.push(join);
    current = null;
  };

  for (const line of content.split('\n')) {
    if (current !== null && current.length + 1 + line.length <= max) {
      current += `\n${line}`;
      continue;
    }
    flush('n');
    let rest = line;
    while (rest.length > max) {
      const cut = safeCut(rest, max);
      parts.push(rest.slice(0, cut));
      joins.push('c');
      rest = rest.slice(cut);
    }
    current = rest;
  }
  parts.push(current ?? '');
  return { parts, joins };
};

/**
 * 입력칸 값을 경계 정보대로 다시 붙인다. 비운 입력칸은 경계째 건너뛴다.
 * 빈 칸 뒤에 오는 경계는 앞쪽 경계 중 줄바꿈을 우선한다.
 */
export const joinDiaryParts = (parts: string[], joins: PartJoin[]): string => {
  let out = '';
  let pending: PartJoin | null = null;
  parts.forEach((part, i) => {
    if (part !== '') {
      if (out !== '') out += pending === 'c' ? '' : '\n';
      out += part;
      pending = null;
    }
    const join = joins[i];
    if (join && out !== '') pending = pending === 'n' || join === 'n' ? 'n' : 'c';
  });
  return out;
};
