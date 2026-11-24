/**
 * 파일 시스템 유틸.
 * 경로는 항상 저장소 루트 기준 POSIX 형식으로 다룬다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSkippedFile, SKIP_DIR_NAMES } from './config.js';

/** 코드 단위 순서 비교. 로케일에 따라 결과가 달라지지 않게 한다. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** wc -l과 같은 방식의 줄 수 */
export const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  const newlines = text.split('\n').length - 1;
  return text.endsWith('\n') ? newlines : newlines + 1;
};

export const isTestFile = (path: string): boolean =>
  /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.tsx?$/.test(path);

export const isSourceFile = (path: string): boolean =>
  /\.tsx?$/.test(path) && !path.endsWith('.d.ts');

/** relDir 아래 모든 파일의 루트 기준 경로를 정렬해 돌려준다. 폴더가 없으면 빈 배열. */
export const walkFiles = (root: string, relDir: string): string[] => {
  const abs = join(root, relDir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name)) out.push(...walkFiles(root, rel));
    } else if (entry.isFile() && !isSkippedFile(entry.name)) {
      out.push(rel);
    }
  }
  return out.sort(compareText);
};

export const readText = (root: string, relPath: string): string =>
  readFileSync(join(root, relPath), 'utf-8');

export const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** 마크다운 표 칸에 넣을 수 있게 줄바꿈과 세로선을 처리한다. */
export const escapeCell = (text: string): string =>
  text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

/** 범위 표기의 물결표가 취소선으로 렌더링되지 않게 한다. */
export const escapeTilde = (text: string): string => text.replace(/(?<!\\)~/g, '\\~');

/** 백틱이 들어 있어도 깨지지 않는 인라인 코드 */
export const inlineCode = (text: string): string =>
  text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
