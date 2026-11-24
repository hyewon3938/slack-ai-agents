/**
 * SQL 텍스트를 문장으로 나누는 가벼운 스캐너.
 * 주석, 작은따옴표 문자열, 큰따옴표 식별자, 달러 인용만 구분한다. 문법은 해석하지 않는다.
 */

export interface SqlLiteral {
  /** 인용 부호를 뺀 내용 */
  content: string;
  dollar: boolean;
}

export interface MaskedSql {
  /** 문자열과 달러 인용을 `'N'` 자리표로 바꾼 텍스트. N은 literals의 인덱스 */
  masked: string;
  literals: SqlLiteral[];
}

const DOLLAR_TAG = /^\$[A-Za-z_]*\$/;

interface Span {
  end: number;
  literal?: SqlLiteral;
  /** 주석이면 true */
  comment?: boolean;
}

/** pos에서 시작하는 주석이나 인용 구간을 읽는다. 해당 없으면 null */
const readSpan = (sql: string, pos: number): Span | null => {
  const two = sql.slice(pos, pos + 2);
  if (two === '--') {
    const nl = sql.indexOf('\n', pos);
    return { end: nl === -1 ? sql.length : nl, comment: true };
  }
  if (two === '/*') {
    const close = sql.indexOf('*/', pos + 2);
    return { end: close === -1 ? sql.length : close + 2, comment: true };
  }
  const ch = sql[pos];
  if (ch === "'") {
    let i = pos + 1;
    let content = '';
    while (i < sql.length) {
      if (sql[i] === "'" && sql[i + 1] === "'") {
        content += "'";
        i += 2;
      } else if (sql[i] === "'") break;
      else content += sql[i++];
    }
    return { end: Math.min(i + 1, sql.length), literal: { content, dollar: false } };
  }
  if (ch === '$') {
    const tag = DOLLAR_TAG.exec(sql.slice(pos, pos + 64))?.[0];
    if (!tag) return null;
    const close = sql.indexOf(tag, pos + tag.length);
    const stop = close === -1 ? sql.length : close;
    return {
      end: close === -1 ? sql.length : close + tag.length,
      literal: { content: sql.slice(pos + tag.length, stop), dollar: true },
    };
  }
  return null;
};

/** 주석을 지우고 세미콜론으로 문장을 나눈다. 인용 안의 세미콜론은 건드리지 않는다. */
export const splitStatements = (sql: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const span = readSpan(sql, i);
    if (span) {
      cur += span.comment ? ' ' : sql.slice(i, span.end);
      i = span.end;
      continue;
    }
    if (sql[i] === '"') {
      const close = sql.indexOf('"', i + 1);
      const end = close === -1 ? sql.length : close + 1;
      cur += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += sql[i];
    i += 1;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

/** 문자열과 달러 인용을 자리표로 바꾼다. 키워드를 찾을 때 문자열 내용에 속지 않기 위함이다. */
export const maskLiterals = (stmt: string): MaskedSql => {
  const literals: SqlLiteral[] = [];
  let masked = '';
  let i = 0;
  while (i < stmt.length) {
    const span = readSpan(stmt, i);
    if (span?.literal) {
      masked += `'${literals.length}'`;
      literals.push(span.literal);
      i = span.end;
    } else if (span) {
      masked += ' ';
      i = span.end;
    } else masked += stmt[i++];
  }
  return { masked, literals };
};

/** 괄호 깊이 0에서만 구분자로 나눈다. */
export const splitTopLevel = (text: string, separator: ',' | ' '): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    const isSep = separator === ',' ? ch === ',' : /\s/.test(ch);
    if (isSep && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

/** 첫 여는 괄호부터 짝이 맞는 닫는 괄호까지의 안쪽 내용과 그 뒤 텍스트 */
export const readParenGroup = (text: string): { inner: string; rest: string } | null => {
  const start = text.indexOf('(');
  if (start === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(start + 1, i), rest: text.slice(i + 1) };
    }
  }
  return null;
};

/** 식별자의 큰따옴표와 스키마 접두를 떼고 소문자로 맞춘다. */
export const normalizeIdent = (raw: string): string =>
  raw
    .trim()
    .replace(/^public\./i, '')
    .replace(/^"(.*)"$/, '$1')
    .toLowerCase();
