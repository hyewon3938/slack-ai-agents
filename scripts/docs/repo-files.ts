/**
 * git이 아는 파일 목록. 커밋된 파일과 아직 커밋하지 않은 새 파일을 담고 gitignore 대상은 뺀다.
 * 로컬과 CI가 같은 목록을 보게 하고, 비공개 파일을 읽지 않게 하려고 파일 시스템 대신 git에 묻는다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const runGit = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const splitLines = (out: string): string[] => out.split('\n').filter((line) => line.length > 0);

/** 작업 폴더에 실제로 있는 파일만 돌려준다. 지웠지만 아직 커밋하지 않은 파일은 빠진다. */
export const listRepoFiles = (root: string): string[] =>
  splitLines(runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard']))
    .filter((file) => existsSync(join(root, file)))
    .sort();

/** base와 갈라진 뒤 HEAD까지 바뀐 파일. */
export const listChangedFiles = (root: string, base: string): string[] =>
  splitLines(runGit(root, ['diff', '--name-only', `${base}...HEAD`]));

/** 검사 대상 문서: 루트의 md와 docs 아래 md. */
export const isDocFile = (path: string): boolean =>
  path.endsWith('.md') && (!path.includes('/') || path.startsWith('docs/'));
