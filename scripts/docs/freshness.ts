/**
 * yarn docs:freshness -- --base <ref>
 * 현황 문서의 sources에 든 코드가 바뀌었는데 문서는 그대로면 GitHub Actions 경고를 낸다.
 * 고칠지 말지는 사람이 정하므로 항상 0으로 끝난다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAny } from './glob.js';
import { classify, MANIFEST_PATH, parseManifest, type ManifestEntry } from './manifest.js';
import { isDocFile, listChangedFiles, listRepoFiles } from './repo-files.js';

export interface StaleDoc {
  doc: string;
  changedSources: string[];
}

/** `--base <ref>`와 `--base=<ref>`를 읽는다. yarn이 넘기는 리터럴 `--`는 건너뛴다. */
export const parseBaseArg = (argv: readonly string[]): string | null => {
  const args = argv.filter((arg) => arg !== '--');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--base') return args[i + 1] ?? null;
    if (arg.startsWith('--base=')) return arg.slice('--base='.length) || null;
  }
  return null;
};

/** 테스트만 바뀐 것은 문서 내용과 무관하다고 본다. */
const TEST_FILE_RE = /(^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$/;

/** sources가 바뀌었는데 자신은 바뀌지 않은 현황 문서를 찾는다. */
export const findStaleDocs = (
  docs: readonly string[],
  entries: readonly ManifestEntry[],
  changed: readonly string[],
): StaleDoc[] => {
  const changedSet = new Set(changed);
  const stale: StaleDoc[] = [];
  for (const doc of docs) {
    const { kinds, sources } = classify(doc, entries);
    if (kinds.length !== 1 || kinds[0] !== 'current' || sources.length === 0 || changedSet.has(doc)) continue;
    const changedSources = changed.filter((file) => !TEST_FILE_RE.test(file) && matchesAny(file, sources));
    if (changedSources.length > 0) stale.push({ doc, changedSources });
  }
  return stale;
};

const MAX_LISTED = 5;

export const formatWarning = ({ doc, changedSources }: StaleDoc): string => {
  const listed = changedSources.slice(0, MAX_LISTED).join(', ');
  const rest = changedSources.length > MAX_LISTED ? ` 외 ${changedSources.length - MAX_LISTED}개` : '';
  return `::warning file=${doc}::이 문서가 설명하는 코드가 바뀌었습니다. 내용이 여전히 맞는지 확인하세요. 바뀐 파일: ${listed}${rest}`;
};

const main = (): void => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const base = parseBaseArg(process.argv.slice(2));
  if (base === null) {
    process.stdout.write('사용법: yarn docs:freshness -- --base <ref>\n');
    return;
  }
  let changed: string[];
  try {
    changed = listChangedFiles(root, base);
  } catch {
    process.stdout.write(`::warning::${base}와 비교하지 못해 문서 최신 여부 확인을 건너뜁니다\n`);
    return;
  }
  const entries = parseManifest(readFileSync(join(root, MANIFEST_PATH), 'utf8'));
  const stale = findStaleDocs(listRepoFiles(root).filter(isDocFile), entries, changed);
  for (const item of stale) process.stdout.write(`${formatWarning(item)}\n`);
  process.stdout.write(`문서 최신 여부 확인: 바뀐 파일 ${changed.length}개, 다시 볼 문서 ${stale.length}개\n`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
