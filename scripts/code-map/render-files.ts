/**
 * bot.md와 web.md를 만든다. 디렉터리별 파일 표와 웹 페이지 표.
 */
import { GENERATED_NOTICE } from './config.js';
import type { FileEntry, PageEntry, SourceTree } from './collect.js';
import { compareText, dirOf, escapeCell, escapeTilde } from './fs-utils.js';
import type { ExportEntry, ExportKind } from './ts-extract.js';

const KIND_ORDER: ExportKind[] = ['function', 'const', 'class', 'type', 'enum', 're-export'];

/** 표 칸에 넣는 일반 텍스트. 꺾쇠가 HTML로 읽히지 않게 한다. */
export const cellText = (text: string): string =>
  escapeTilde(escapeCell(text)).replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const renderExports = (exports: ExportEntry[]): string =>
  KIND_ORDER.map((kind) => {
    const names = exports.filter((e) => e.kind === kind).map((e) => `\`${e.name}\``);
    return names.length > 0 ? `${kind}: ${names.join(', ')}` : '';
  })
    .filter(Boolean)
    .join('<br>');

/** 테스트 폴더는 한 단계 위 디렉터리에 합쳐서 센다. */
export const groupDir = (path: string): string => dirOf(path).replace(/\/__tests__(\/.*)?$/, '');

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const renderDir = (dir: string, files: FileEntry[], tests: string[], others: string[]): string[] => {
  const out = [`## \`${dir}\``, ''];
  if (files.length > 0) {
    out.push('| 파일 | 줄 수 | 역할 | export |', '| --- | ---: | --- | --- |');
    for (const f of files) {
      out.push(`| \`${baseName(f.path)}\` | ${f.lines} | ${cellText(f.role)} | ${renderExports(f.exports)} |`);
    }
    out.push('');
  }
  if (tests.length > 0) out.push(`테스트 파일 ${tests.length}개`, '');
  if (others.length > 0) out.push(`그 밖의 파일: ${others.map((o) => `\`${baseName(o)}\``).join(', ')}`, '');
  return out;
};

export const totalLines = (tree: SourceTree): number => tree.files.reduce((sum, f) => sum + f.lines, 0);

const renderTree = (tree: SourceTree): string[] => {
  const dirs = new Set<string>();
  for (const f of tree.files) dirs.add(dirOf(f.path));
  for (const t of tree.tests) dirs.add(groupDir(t));
  for (const o of tree.others) dirs.add(dirOf(o));
  const out: string[] = [];
  for (const dir of [...dirs].sort(compareText)) {
    out.push(
      ...renderDir(
        dir,
        tree.files.filter((f) => dirOf(f.path) === dir),
        tree.tests.filter((t) => groupDir(t) === dir),
        tree.others.filter((o) => dirOf(o) === dir),
      ),
    );
  }
  return out;
};

const summaryLine = (tree: SourceTree): string =>
  `\`${tree.root}/\` 아래 소스 파일 ${tree.files.length}개, ${totalLines(tree)}줄이고 테스트 파일은 ${tree.tests.length}개다. 줄 수는 테스트를 뺀 값이다.`;

const COLUMN_GUIDE =
  '역할 칸에는 파일 맨 위 주석의 첫 문장을 옮겼고, 주석이 없는 파일은 비워 뒀다. export 칸의 function에는 화살표 함수로 선언한 const도 들어간다.';

export const renderBot = (tree: SourceTree): string =>
  ['# 봇 코드', '', GENERATED_NOTICE, '', summaryLine(tree), COLUMN_GUIDE, '', ...renderTree(tree)].join('\n');

const renderPages = (pages: PageEntry[]): string[] => [
  '## 페이지',
  '',
  `\`page.tsx\` 파일 ${pages.length}개의 URL이다. 대괄호로 감싼 부분은 동적 경로다.`,
  '',
  '| URL | 파일 |',
  '| --- | --- |',
  ...pages.map((p) => `| \`${p.url}\` | \`${p.file}\` |`),
  '',
];

export const renderWeb = (tree: SourceTree, pages: PageEntry[]): string =>
  [
    '# 웹 코드',
    '',
    GENERATED_NOTICE,
    '',
    summaryLine(tree),
    COLUMN_GUIDE,
    'API 라우트의 URL과 인증은 `web-api.md`에 따로 정리했다.',
    '',
    ...renderPages(pages),
    ...renderTree(tree),
  ].join('\n');
