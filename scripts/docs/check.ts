/**
 * yarn docs:check
 * 1. docs 아래 모든 md가 doc-manifest.json에서 정확히 한 종류로 분류되는지 본다.
 * 2. 현황 문서에 적힌 repo 경로가 실제로 있는지 본다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, findUnusedGlobs, MANIFEST_PATH, parseManifest, type ManifestEntry } from './manifest.js';
import { createPathChecker, extractPathRefs } from './refs.js';
import { isDocFile, listRepoFiles } from './repo-files.js';

export const ALLOWLIST_PATH = 'scripts/docs/known-broken-refs.json';

interface AllowedRef {
  doc: string;
  path: string;
}

export interface CheckResult {
  errors: string[];
  checkedDocs: number;
  checkedRefs: number;
}

const parseAllowlist = (json: string): AllowedRef[] => {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error(`${ALLOWLIST_PATH}: 배열이어야 합니다`);
  return data.map((item: unknown): AllowedRef => {
    const entry = item as Partial<AllowedRef> | null;
    if (typeof entry?.doc !== 'string' || typeof entry.path !== 'string') {
      throw new Error(`${ALLOWLIST_PATH}: 항목마다 doc과 path가 있어야 합니다`);
    }
    return { doc: entry.doc, path: entry.path };
  });
};

const allowKey = (doc: string, path: string): string => `${doc}\n${path}`;

/** 파일 목록과 문서 본문만 받아 검사한다. 디스크와 git은 호출하는 쪽이 읽는다. */
export const checkDocs = (
  files: readonly string[],
  entries: readonly ManifestEntry[],
  allowed: readonly AllowedRef[],
  readDoc: (path: string) => string,
): CheckResult => {
  const errors: string[] = [];
  const docs = files.filter(isDocFile);
  const exists = createPathChecker(files);
  const allowedKeys = new Set(allowed.map((a) => allowKey(a.doc, a.path)));
  const usedKeys = new Set<string>();
  let checkedDocs = 0;
  let checkedRefs = 0;

  for (const doc of docs) {
    const { kinds } = classify(doc, entries);
    if (doc.startsWith('docs/') && kinds.length !== 1) {
      errors.push(
        kinds.length === 0
          ? `${doc}: ${MANIFEST_PATH}에 등록되지 않았습니다`
          : `${doc}: ${MANIFEST_PATH}에서 record와 current에 모두 걸립니다`,
      );
    }
    if (kinds.length !== 1 || kinds[0] !== 'current') continue;
    checkedDocs += 1;
    for (const ref of extractPathRefs(doc, readDoc(doc))) {
      checkedRefs += 1;
      if (exists(ref.path)) continue;
      const key = allowKey(doc, ref.path);
      if (allowedKeys.has(key)) usedKeys.add(key);
      else errors.push(`${doc}:${ref.line}: 없는 경로 ${ref.path}`);
    }
  }

  for (const glob of findUnusedGlobs(entries, docs)) {
    errors.push(`${MANIFEST_PATH}: ${glob}에 맞는 문서가 없습니다`);
  }
  for (const entry of allowed) {
    if (!usedKeys.has(allowKey(entry.doc, entry.path))) {
      errors.push(`${ALLOWLIST_PATH}: ${entry.doc}의 ${entry.path}는 이제 깨져 있지 않으니 목록에서 지우세요`);
    }
  }
  return { errors, checkedDocs, checkedRefs };
};

const main = (): void => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');
  const files = listRepoFiles(root);
  const result = checkDocs(files, parseManifest(read(MANIFEST_PATH)), parseAllowlist(read(ALLOWLIST_PATH)), read);
  if (result.errors.length > 0) {
    process.stdout.write(`${result.errors.join('\n')}\n\n문서 검사 실패: ${result.errors.length}건\n`);
    process.exit(1);
  }
  process.stdout.write(`문서 검사 통과: 현황 문서 ${result.checkedDocs}개, 경로 참조 ${result.checkedRefs}개\n`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
