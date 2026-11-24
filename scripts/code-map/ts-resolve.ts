/**
 * 구문 트리에서 이름을 따라가는 도우미.
 * import한 이름이 어느 파일에서 왔는지, 어떤 선언 안에 있는지, 상수의 문자열 값이 무엇인지 찾는다.
 */

import ts from 'typescript';

export interface ImportedName {
  /** 가져온 쪽에서 쓰는 원래 이름 */
  original: string;
  /** 저장소 루트 기준 파일 경로. 상대 경로 import가 아니거나 파일을 못 찾으면 null */
  file: string | null;
}

const normalize = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
};

/** 상대 경로 import를 실제 파일 경로로 바꾼다. */
export const resolveImport = (
  fromFile: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null => {
  if (!specifier.startsWith('.')) return null;
  const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const base = normalize(`${dir}/${specifier}`).replace(/\.js$/, '');
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base];
  return candidates.find((c) => files.has(c)) ?? null;
};

/** 파일이 import한 이름과 출처 */
export const collectImports = (
  sf: ts.SourceFile,
  filePath: string,
  files: ReadonlySet<string>,
): Map<string, ImportedName> => {
  const out = new Map<string, ImportedName>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const file = resolveImport(filePath, st.moduleSpecifier.text, files);
    const clause = st.importClause;
    if (!clause) continue;
    if (clause.name) out.set(clause.name.text, { original: 'default', file });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        out.set(el.name.text, { original: (el.propertyName ?? el.name).text, file });
      }
    }
  }
  return out;
};

export const importsModule = (sf: ts.SourceFile, moduleName: string): boolean =>
  sf.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === moduleName,
  );

/** 노드를 감싼 가장 가까운 이름 있는 선언. 클래스 메서드는 Class.method 형태. 없으면 빈 문자열 */
export const enclosingName = (node: ts.Node): string => {
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) {
      const cls = cur.parent;
      const clsName = ts.isClassDeclaration(cls) && cls.name ? `${cls.name.text}.` : '';
      return `${clsName}${cur.name.text}`;
    }
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
  }
  return '';
};

/** 파일 최상위 const 가운데 값이 문자열 리터럴인 것 */
export const collectStringConsts = (sf: ts.SourceFile): Map<string, string> => {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      if (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer)) {
        out.set(d.name.text, d.initializer.text);
      }
    }
  }
  return out;
};

/** 선언 바로 앞 주석의 첫 줄 */
export const leadingCommentLine = (sf: ts.SourceFile, node: ts.Node): string => {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
  const last = ranges[ranges.length - 1];
  if (!last) return '';
  const lines = sf.text
    .slice(last.pos, last.end)
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\/\*+/, '')
        .replace(/\*+\/\s*$/, '')
        .replace(/^\s*\/\/+/, '')
        .replace(/^\s*\*+/, '')
        .trim(),
    )
    .filter((l) => l.length > 0);
  return lines[0] ?? '';
};

/** 노드 뒤 같은 줄에 붙은 주석. 쉼표 뒤 주석도 본다. */
export const trailingComment = (sf: ts.SourceFile, node: ts.Node): string => {
  let pos = node.getEnd();
  if (sf.text[pos] === ',') pos += 1;
  const range = (ts.getTrailingCommentRanges(sf.text, pos) ?? [])[0];
  if (!range) return '';
  return sf.text
    .slice(range.pos, range.end)
    .replace(/^\/\/+|^\/\*+|\*+\/$/g, '')
    .trim();
};
