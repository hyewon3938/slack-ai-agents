import { describe, expect, it } from 'vitest';
import { checkDocs } from '../check.js';
import { findStaleDocs, formatWarning, parseBaseArg } from '../freshness.js';
import { matchesGlob } from '../glob.js';
import { classify, findUnusedGlobs, parseManifest, type ManifestEntry } from '../manifest.js';
import { createPathChecker, extractPathRefs, normalizePath, stripSuffix } from '../refs.js';

describe('matchesGlob', () => {
  it('**는 폴더를 넘고 *는 한 구간 안에서만 맞는다', () => {
    expect(matchesGlob('docs/adr/0001-a.md', 'docs/adr/**')).toBe(true);
    expect(matchesGlob('docs/domains/a.md', 'docs/domains/*.md')).toBe(true);
    expect(matchesGlob('docs/domains/x/a.md', 'docs/domains/*.md')).toBe(false);
    expect(matchesGlob('src/sql-tools.ts', 'src/**/sql-tools.ts')).toBe(true);
    expect(matchesGlob('src/a/b/sql-tools.ts', 'src/**/sql-tools.ts')).toBe(true);
    expect(matchesGlob('web/src/app/[id]/route.ts', 'web/src/app/[id]/*.ts')).toBe(true);
    expect(matchesGlob('READMExmd', 'README.md')).toBe(false);
  });
});

describe('stripSuffix와 normalizePath', () => {
  it('줄 번호와 앵커를 뗀다', () => {
    expect(stripSuffix('src/a.ts:12')).toBe('src/a.ts');
    expect(stripSuffix('src/a.ts:12-30')).toBe('src/a.ts');
    expect(stripSuffix('src/a.ts#L10-L20')).toBe('src/a.ts');
    expect(stripSuffix('docs/a.md#제목')).toBe('docs/a.md');
  });

  it('상대 경로를 정리하고 루트 밖은 null로 돌려준다', () => {
    expect(normalizePath('docs/domains/../adr/a.md')).toBe('docs/adr/a.md');
    expect(normalizePath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizePath('../outside.md')).toBeNull();
  });
});

describe('extractPathRefs', () => {
  it('백틱 코드는 루트 기준, 링크는 문서 기준으로 읽는다', () => {
    const text = [
      '`src/a.ts:12` 와 [결정](../adr/0001-x.md#배경)',
      '',
      '[그림](images/a.png) `yarn test`',
    ].join('\n');
    expect(extractPathRefs('docs/domains/a.md', text)).toEqual([
      { line: 1, raw: 'src/a.ts:12', path: 'src/a.ts' },
      { line: 1, raw: '../adr/0001-x.md#배경', path: 'docs/adr/0001-x.md' },
      { line: 3, raw: 'images/a.png', path: 'docs/domains/images/a.png' },
    ]);
  });

  it('외부 링크, 앵커, 틀, 비공개 폴더, 코드 펜스는 건너뛴다', () => {
    const text = [
      '[a](https://example.com) [b](#절) [c](mailto:a@example.com)',
      '`docs/adr/NNNN-*.md` `docs/domains/<domain>.md` `docs/_personal/x.md` `src/a.ts 실행`',
      '```',
      '`src/in-fence.ts`',
      '```',
      '`db/migrations/*.sql`',
    ].join('\n');
    expect(extractPathRefs('README.md', text).map((r) => r.path)).toEqual(['db/migrations/*.sql']);
  });
});

describe('createPathChecker', () => {
  const exists = createPathChecker(['src/a/b.ts', 'db/migrations/001_x.sql']);

  it('파일, 폴더, 글롭을 확인한다', () => {
    expect(exists('src/a/b.ts')).toBe(true);
    expect(exists('src/a/')).toBe(true);
    expect(exists('src')).toBe(true);
    expect(exists('db/migrations/*.sql')).toBe(true);
    expect(exists('src/a/c.ts')).toBe(false);
    expect(exists('db/migrations/*.md')).toBe(false);
  });
});

const entries: ManifestEntry[] = [
  { glob: 'docs/adr/**', kind: 'record', sources: [] },
  { glob: 'docs/*.md', kind: 'current', sources: ['src/**'] },
  { glob: 'docs/features.md', kind: 'current', sources: ['web/src/**'] },
];

describe('manifest', () => {
  it('형식을 검증한다', () => {
    expect(parseManifest('{"documents":[{"glob":"a.md","kind":"record"}]}')).toEqual([
      { glob: 'a.md', kind: 'record', sources: [] },
    ]);
    expect(() => parseManifest('{"documents":[{"glob":"a.md","kind":"old"}]}')).toThrow(/kind/);
    expect(() => parseManifest('{}')).toThrow(/documents/);
  });

  it('맞는 항목의 종류와 sources를 모은다', () => {
    expect(classify('docs/features.md', entries)).toEqual({
      kinds: ['current'],
      sources: ['src/**', 'web/src/**'],
    });
    expect(classify('docs/new/a.md', entries).kinds).toEqual([]);
    expect(findUnusedGlobs(entries, ['docs/features.md'])).toEqual(['docs/adr/**']);
  });
});

describe('checkDocs', () => {
  const docs: Record<string, string> = {
    'docs/features.md': '`src/a.ts` `src/gone.ts`',
    'docs/adr/0001.md': '`src/old.ts`',
    'docs/new/a.md': '',
    'README.md': '`src/gone.ts`',
  };
  const files = [...Object.keys(docs), 'src/a.ts', 'web/src/a.ts'];
  const read = (path: string): string => docs[path] ?? '';

  it('등록 안 된 문서와 없는 경로를 문서:줄로 알린다', () => {
    const result = checkDocs(files, entries, [], read);
    expect(result.errors).toEqual([
      'docs/features.md:1: 없는 경로 src/gone.ts',
      'docs/new/a.md: docs/doc-manifest.json에 등록되지 않았습니다',
    ]);
    expect(result.checkedDocs).toBe(1);
  });

  it('두 종류에 걸린 문서를 알린다', () => {
    const both: ManifestEntry[] = [...entries, { glob: 'docs/**', kind: 'record', sources: [] }];
    expect(checkDocs(files, both, [], read).errors).toContain(
      'docs/features.md: docs/doc-manifest.json에서 record와 current에 모두 걸립니다',
    );
  });

  it('sources 패턴에 맞는 파일이 없으면 알린다', () => {
    const stale: ManifestEntry[] = entries.map((entry) =>
      entry.glob === 'docs/features.md' ? { ...entry, sources: ['src/**', 'src/moved/**'] } : entry,
    );
    expect(checkDocs(files, stale, [], read).errors).toContain(
      'docs/doc-manifest.json: docs/features.md의 sources src/moved/**에 맞는 파일이 없습니다',
    );
  });

  it('허용 목록의 경로는 넘기고, 필요 없어진 항목은 알린다', () => {
    const allowed = [
      { doc: 'docs/features.md', path: 'src/gone.ts' },
      { doc: 'docs/features.md', path: 'src/a.ts' },
    ];
    const errors = checkDocs(files, entries, allowed, read).errors;
    expect(errors.some((e) => e.includes('없는 경로'))).toBe(false);
    expect(errors.some((e) => e.includes('src/a.ts는 이제'))).toBe(true);
  });
});

describe('freshness', () => {
  it('리터럴 --를 건너뛰고 base를 읽는다', () => {
    expect(parseBaseArg(['--', '--base', 'origin/main'])).toBe('origin/main');
    expect(parseBaseArg(['--base=origin/main'])).toBe('origin/main');
    expect(parseBaseArg(['--base'])).toBeNull();
    expect(parseBaseArg([])).toBeNull();
  });

  it('sources가 바뀌고 문서는 그대로일 때만 찾는다', () => {
    const docs = ['docs/features.md', 'docs/adr/0001.md'];
    expect(findStaleDocs(docs, entries, ['src/a.ts', 'web/x.ts'])).toEqual([
      { doc: 'docs/features.md', changedSources: ['src/a.ts'] },
    ]);
    expect(findStaleDocs(docs, entries, ['src/a.ts', 'docs/features.md'])).toEqual([]);
    expect(findStaleDocs(docs, entries, ['src/__tests__/a.test.ts', 'src/b.test.ts'])).toEqual([]);
  });

  it('GitHub Actions 경고 형식으로 적는다', () => {
    const line = formatWarning({
      doc: 'docs/features.md',
      changedSources: ['1', '2', '3', '4', '5', '6', '7'],
    });
    expect(line.startsWith('::warning file=docs/features.md::')).toBe(true);
    expect(line.endsWith('1, 2, 3, 4, 5 외 2개')).toBe(true);
  });
});
