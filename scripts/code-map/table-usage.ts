/**
 * 소스 파일의 문자열에서 SQL 키워드 바로 뒤에 나오는 테이블 이름을 찾는다.
 */
import ts from 'typescript';
import { compareText } from './fs-utils.js';
import { parseSource } from './ts-extract.js';

const SQL_REF = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:ONLY\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

/** 문자열과 템플릿 리터럴의 내용을 모은다. 템플릿의 끼워 넣는 식은 공백으로 바꾼다. */
export const collectStringTexts = (sf: ts.SourceFile): string[] => {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push([node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' '));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

/** 텍스트에서 FROM, JOIN, INTO, UPDATE, TABLE 바로 뒤에 온 이름 가운데 known에 있는 것 */
export const findSqlTableRefs = (text: string, known: ReadonlySet<string>): string[] => {
  const found = new Set<string>();
  for (const m of text.matchAll(SQL_REF)) {
    const name = (m[1] ?? '').toLowerCase();
    if (known.has(name)) found.add(name);
  }
  return [...found].sort(compareText);
};

/** 파일 하나가 SQL 문자열에서 쓰는 테이블 이름 목록 */
export const findTableUsage = (fileName: string, text: string, known: ReadonlySet<string>): string[] => {
  const found = new Set<string>();
  for (const str of collectStringTexts(parseSource(fileName, text))) {
    for (const name of findSqlTableRefs(str, known)) found.add(name);
  }
  return [...found].sort(compareText);
};
