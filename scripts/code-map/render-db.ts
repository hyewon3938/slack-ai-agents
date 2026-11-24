/**
 * db.md를 만든다. 테이블과 컬럼, 테이블을 쓰는 소스 파일.
 */
import { GENERATED_NOTICE } from './config.js';
import type { DbData } from './collect.js';
import { compareText, escapeCell, inlineCode } from './fs-utils.js';
import type { TableInfo } from './sql-migrations.js';

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const codeList = (items: string[]): string => items.map((i) => `\`${i}\``).join(', ');

const renderUsage = (label: string, files: string[]): string =>
  `- ${label}: ${files.length > 0 ? codeList(files) : '찾지 못함'}`;

const renderTable = (table: TableInfo, db: DbData): string[] => {
  const usage = db.usage.get(table.name) ?? { bot: [], web: [] };
  const out = [
    `### \`${table.name}\``,
    '',
    `- 만든 마이그레이션: \`${fileName(table.createdIn)}\``,
  ];
  if (table.changedIn.length > 0)
    out.push(`- 바꾼 마이그레이션: ${codeList(table.changedIn.map(fileName))}`);
  out.push(
    renderUsage('봇에서 쓰는 파일', usage.bot),
    renderUsage('웹에서 쓰는 파일', usage.web),
    '',
  );
  out.push('| 컬럼 | 타입 | NOT NULL | 기본값 | PK |', '| --- | --- | --- | --- | --- |');
  for (const c of table.columns) {
    const def = c.defaultValue === null ? '' : escapeCell(inlineCode(c.defaultValue));
    out.push(
      `| \`${c.name}\` | ${escapeCell(inlineCode(c.type))} | ${c.notNull ? 'O' : ''} | ${def} | ${c.primaryKey ? 'O' : ''} |`,
    );
  }
  out.push('');
  return out;
};

const renderViews = (db: DbData): string[] => {
  const names = [...db.schema.views.keys()].sort(compareText);
  if (names.length === 0) return [];
  const out = ['## 뷰', '', '뷰는 이름과 마지막으로 정의한 마이그레이션만 적는다.', ''];
  for (const name of names) {
    const usage = db.usage.get(name) ?? { bot: [], web: [] };
    out.push(
      `### \`${name}\``,
      '',
      `- 정의한 마이그레이션: \`${fileName(db.schema.views.get(name) ?? '')}\``,
      renderUsage('봇에서 쓰는 파일', usage.bot),
      renderUsage('웹에서 쓰는 파일', usage.web),
      '',
    );
  }
  return out;
};

const renderUnparsed = (db: DbData): string[] => {
  const { unparsed } = db.schema;
  const out = ['## 해석하지 못한 문장', '', `해석하지 못한 문장은 ${unparsed.length}개다.`];
  if (unparsed.length === 0) return [...out, ''];
  out.push(
    '이 문장들이 테이블이나 컬럼을 바꿨다면 위 표에 반영되지 않았으니 해당 마이그레이션을 직접 확인한다.',
    '',
  );
  for (const u of unparsed) out.push(`- \`${fileName(u.file)}\`: ${inlineCode(u.head)}`);
  return [...out, ''];
};

export const renderDb = (db: DbData): string => {
  const tables = [...db.schema.tables.values()].sort((a, b) => compareText(a.name, b.name));
  return [
    '# DB 테이블',
    '',
    GENERATED_NOTICE,
    '',
    `마이그레이션 파일 ${db.migrationCount}개를 파일 이름 순서로 적용해 계산한 결과이고 테이블은 ${tables.length}개, 뷰는 ${db.schema.views.size}개다. 운영 DB를 조회한 값은 아니다.`,
    '쓰는 파일에는 SQL 문자열에서 FROM, JOIN, INTO, UPDATE, TABLE 바로 뒤에 테이블 이름이 나오는 소스 파일을 적었고 테스트 파일은 뺐다.',
    '',
    '## 테이블',
    '',
    ...tables.flatMap((t) => renderTable(t, db)),
    ...renderViews(db),
    ...renderUnparsed(db),
  ].join('\n');
};
