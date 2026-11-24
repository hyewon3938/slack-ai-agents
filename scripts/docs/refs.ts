/**
 * 마크다운 문서에서 repo 경로처럼 생긴 참조를 뽑는다.
 * 백틱 코드는 repo 루트 기준, 마크다운 링크는 문서 위치 기준으로 읽는다.
 */
import { globToRegex } from './glob.js';

export interface PathRef {
  /** 문서 안 줄 번호. 1부터 센다. */
  line: number;
  /** 문서에 적힌 그대로의 글자. */
  raw: string;
  /** repo 루트 기준으로 바꾼 경로. 글롭이면 `*`가 남아 있다. */
  path: string;
}

/** 백틱 코드가 이 접두로 시작하면 repo 경로로 본다. */
export const ROOT_PREFIXES = ['src/', 'web/', 'scripts/', 'docs/', 'db/', 'migrations/', '.github/'];

/** 커밋하지 않는 폴더와 빌드 산출물은 확인 대상에서 뺀다. */
const UNCHECKED_PREFIXES = ['docs/_personal', 'web/.next', 'web/node_modules'];

/** 꺾쇠, 중괄호, 줄임표, 자리표 이름이 들어가면 실제 경로가 아닌 틀로 본다. */
const PLACEHOLDER_RE = /[<>{}…|$]|\.\.\.|NNNN|xxx|YYYY/;

const LINE_SUFFIX_RE = /(?::\d+(?:[-:]\d+)?|#L\d+(?:-L?\d+)?)$/;

/** 줄 번호 접미와 앵커, 끝 구두점을 떼어 낸다. */
export const stripSuffix = (token: string): string => {
  let out = token.trim().replace(/[.,;)]+$/, '');
  out = out.replace(LINE_SUFFIX_RE, '');
  const hash = out.indexOf('#');
  if (hash !== -1) out = out.slice(0, hash);
  return out;
};

/** `a/./b`, `a/../b`를 정리한다. 루트 밖으로 나가면 null. */
export const normalizePath = (path: string): string | null => {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
};

const isCheckable = (path: string): boolean =>
  path.length > 0 &&
  !/\s/.test(path) &&
  !PLACEHOLDER_RE.test(path) &&
  !UNCHECKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

const fromCodeSpan = (content: string): string | null => {
  const token = stripSuffix(content);
  if (!ROOT_PREFIXES.some((prefix) => token.startsWith(prefix))) return null;
  const path = normalizePath(token);
  return path !== null && isCheckable(path) ? path : null;
};

const fromLink = (target: string, docDir: string): string | null => {
  const first = target.trim().split(/\s+/)[0] ?? '';
  if (first.length === 0 || first.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(first) || first.startsWith('//')) {
    return null;
  }
  const token = stripSuffix(first.replace(/^<|>$/g, ''));
  if (token.length === 0) return null;
  const joined = token.startsWith('/') ? token.slice(1) : docDir.length > 0 ? `${docDir}/${token}` : token;
  const path = normalizePath(decodeURIComponentSafe(joined));
  return path !== null && isCheckable(path) ? path : null;
};

const decodeURIComponentSafe = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const CODE_SPAN_RE = /`([^`\n]+)`/g;
const LINK_RE = /\[[^\]\n]*\]\(([^)\n]+)\)/g;

/** 문서 본문에서 경로 참조를 뽑는다. 코드 펜스 안은 예시로 보고 건너뛴다. */
export const extractPathRefs = (docPath: string, text: string): PathRef[] => {
  const docDir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
  const refs: PathRef[] = [];
  let fence: string | null = null;
  text.split('\n').forEach((lineText, index) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(lineText);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1].slice(0, 3);
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence !== null) return;
    for (const match of lineText.matchAll(CODE_SPAN_RE)) {
      const path = fromCodeSpan(match[1] ?? '');
      if (path !== null) refs.push({ line: index + 1, raw: match[1] ?? '', path });
    }
    const withoutCode = lineText.replace(CODE_SPAN_RE, (span) => ' '.repeat(span.length));
    for (const match of withoutCode.matchAll(LINK_RE)) {
      const path = fromLink(match[1] ?? '', docDir);
      if (path !== null) refs.push({ line: index + 1, raw: match[1] ?? '', path });
    }
  });
  return refs;
};

/** 파일 목록에서 경로가 가리키는 파일이나 폴더가 있는지 확인한다. 글롭은 하나라도 맞으면 있다고 본다. */
export const createPathChecker = (files: readonly string[]): ((path: string) => boolean) => {
  const fileSet = new Set(files);
  const dirSet = new Set<string>();
  for (const file of files) {
    let slash = file.lastIndexOf('/');
    while (slash !== -1) {
      const dir = file.slice(0, slash);
      if (dirSet.has(dir)) break;
      dirSet.add(dir);
      slash = dir.lastIndexOf('/');
    }
  }
  const all = [...fileSet, ...dirSet];
  return (path: string): boolean => {
    const clean = path.replace(/\/+$/, '');
    if (clean.includes('*')) {
      const regex = globToRegex(clean);
      return all.some((candidate) => regex.test(candidate));
    }
    return fileSet.has(clean) || dirSet.has(clean);
  };
};
