import { describe, expect, it } from 'vitest';
import { extractExports, extractFileRole } from '../ts-extract.js';

describe('extractExports', () => {
  it('선언 종류를 구분한다', () => {
    const src = [
      'export function a() {}',
      'export const b = () => 1;',
      'export const c = 3;',
      'export class D {}',
      'export interface E {}',
      'export type F = string;',
      'export enum G { X }',
      'const hidden = 1;',
    ].join('\n');
    expect(extractExports('x.ts', src)).toEqual([
      { name: 'a', kind: 'function' },
      { name: 'b', kind: 'function' },
      { name: 'c', kind: 'const' },
      { name: 'D', kind: 'class' },
      { name: 'E', kind: 'type' },
      { name: 'F', kind: 'type' },
      { name: 'G', kind: 'enum' },
    ]);
  });

  it('export 목록은 로컬 선언의 종류를 따른다', () => {
    const src = 'const run = async () => {};\nconst MAX = 3;\ninterface Opt {}\nexport { run, MAX };\nexport type { Opt };';
    expect(extractExports('x.ts', src)).toEqual([
      { name: 'run', kind: 'function' },
      { name: 'MAX', kind: 'const' },
      { name: 'Opt', kind: 'type' },
    ]);
  });

  it('다른 모듈에서 다시 내보낸 이름은 re-export로 적는다', () => {
    const src = "export { a as b } from './a.js';\nexport * from './c.js';";
    expect(extractExports('x.ts', src)).toEqual([
      { name: 'b', kind: 're-export' },
      { name: '* from ./c.js', kind: 're-export' },
    ]);
  });

  it('default export를 표시한다', () => {
    expect(extractExports('x.tsx', 'export default function Page() { return null; }')).toEqual([
      { name: 'default Page', kind: 'function' },
    ]);
  });
});

describe('extractFileRole', () => {
  it('맨 위 블록 주석의 첫 문장을 돌려준다', () => {
    const src = "/**\n * 일정 조회 쿼리. 둘째 문장.\n * 셋째 줄.\n */\nimport x from 'x';\n";
    expect(extractFileRole('x.ts', src)).toBe('일정 조회 쿼리.');
  });

  it('이어진 한 줄 주석은 첫 줄만 돌려준다', () => {
    const src = "// 크론 스케줄러\n// DB 설정을 읽는다\n\nimport x from 'x';\n";
    expect(extractFileRole('x.ts', src)).toBe('크론 스케줄러');
  });

  it("'use client' 뒤의 주석도 읽는다", () => {
    const src = "'use client';\n\n/** 지출 입력 폼 */\nimport x from 'x';\n";
    expect(extractFileRole('x.tsx', src)).toBe('지출 입력 폼');
  });

  it('첫 선언에 붙은 주석은 파일 역할로 보지 않는다', () => {
    expect(extractFileRole('x.ts', '/** 합계를 구한다 */\nexport const sum = 1;\n')).toBe('');
  });

  it('주석이 없거나 린트 지시문이면 비운다', () => {
    expect(extractFileRole('x.ts', 'export const a = 1;\n')).toBe('');
    expect(extractFileRole('x.ts', "/* eslint-disable no-console */\nimport x from 'x';\n")).toBe('');
  });
});
