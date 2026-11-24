/**
 * TypeScript 소스에서 export 목록과 파일 역할 한 줄을 뽑는다.
 * 타입 정보 없이 구문만 본다.
 */

import ts from 'typescript';

export type ExportKind = 'function' | 'const' | 'type' | 'class' | 'enum' | 're-export';

export interface ExportEntry {
  name: string;
  kind: ExportKind;
}

export const parseSource = (fileName: string, text: string): ts.SourceFile =>
  ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

const isFunctionLike = (node: ts.Expression | undefined): boolean =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

const bindingNames = (name: ts.BindingName): string[] => {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)));
};

/** 파일 안에서 선언된 이름의 종류. export { a } 형태를 풀 때 쓴다. */
const collectLocalKinds = (sf: ts.SourceFile): Map<string, ExportKind> => {
  const kinds = new Map<string, ExportKind>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) kinds.set(st.name.text, 'function');
    else if (ts.isClassDeclaration(st) && st.name) kinds.set(st.name.text, 'class');
    else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st))
      kinds.set(st.name.text, 'type');
    else if (ts.isEnumDeclaration(st)) kinds.set(st.name.text, 'enum');
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const kind: ExportKind = isFunctionLike(d.initializer) ? 'function' : 'const';
        for (const n of bindingNames(d.name)) kinds.set(n, kind);
      }
    }
  }
  return kinds;
};

const fromExportDeclaration = (
  st: ts.ExportDeclaration,
  localKinds: Map<string, ExportKind>,
): ExportEntry[] => {
  const from =
    st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
  if (!st.exportClause) return [{ name: `* from ${from ?? '?'}`, kind: 're-export' }];
  if (!ts.isNamedExports(st.exportClause)) {
    return [{ name: st.exportClause.name.text, kind: 're-export' }];
  }
  return st.exportClause.elements.map((el) => {
    const local = (el.propertyName ?? el.name).text;
    if (from !== null) return { name: el.name.text, kind: 're-export' as const };
    if (st.isTypeOnly || el.isTypeOnly) return { name: el.name.text, kind: 'type' as const };
    return { name: el.name.text, kind: localKinds.get(local) ?? 'const' };
  });
};

const fromStatement = (st: ts.Statement, localKinds: Map<string, ExportKind>): ExportEntry[] => {
  if (ts.isExportDeclaration(st)) return fromExportDeclaration(st, localKinds);
  if (ts.isExportAssignment(st))
    return st.isExportEquals ? [] : [{ name: 'default', kind: 'const' }];
  if (!hasModifier(st, ts.SyntaxKind.ExportKeyword)) return [];
  const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
  const named = (name: ts.Identifier | undefined, kind: ExportKind): ExportEntry[] => [
    { name: isDefault ? `default${name ? ` ${name.text}` : ''}` : (name?.text ?? 'default'), kind },
  ];
  if (ts.isFunctionDeclaration(st)) return named(st.name, 'function');
  if (ts.isClassDeclaration(st)) return named(st.name, 'class');
  if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) return named(st.name, 'type');
  if (ts.isEnumDeclaration(st)) return named(st.name, 'enum');
  if (ts.isVariableStatement(st)) {
    return st.declarationList.declarations.flatMap((d) => {
      const kind: ExportKind = isFunctionLike(d.initializer) ? 'function' : 'const';
      return bindingNames(d.name).map((name) => ({ name, kind }));
    });
  }
  return [];
};

/** 파일의 export 이름과 종류. 화살표 함수를 담은 const는 function으로 센다. 선언 순서를 지킨다. */
export const extractExports = (fileName: string, text: string): ExportEntry[] => {
  const sf = parseSource(fileName, text);
  const localKinds = collectLocalKinds(sf);
  return sf.statements.flatMap((st) => fromStatement(st, localKinds));
};

const cleanCommentLine = (line: string): string =>
  line
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*\/\/+/, '')
    .replace(/^\s*\*+/, '')
    .trim();

const firstSentence = (commentText: string): string => {
  for (const raw of commentText.split('\n')) {
    const line = cleanCommentLine(raw);
    if (line.length === 0) continue;
    if (/^(eslint|@ts-|prettier|istanbul)/.test(line) || line.startsWith('@')) return '';
    const end = line.search(/(?<=[.。!?])\s/);
    return end === -1 ? line : line.slice(0, end);
  }
  return '';
};

interface CommentBlock {
  pos: number;
  end: number;
}

/** 빈 줄 없이 이어진 한 줄 주석을 한 덩어리로 묶는다. */
const mergeLineComments = (text: string, ranges: readonly ts.CommentRange[]): CommentBlock[] => {
  const blocks: CommentBlock[] = [];
  let prevKind: ts.SyntaxKind | null = null;
  for (const r of ranges) {
    const last = blocks[blocks.length - 1];
    const joinable =
      last !== undefined &&
      prevKind === ts.SyntaxKind.SingleLineCommentTrivia &&
      r.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      !/\n\s*\n/.test(text.slice(last.end, r.pos));
    if (joinable && last) last.end = r.end;
    else blocks.push({ pos: r.pos, end: r.end });
    prevKind = r.kind;
  }
  return blocks;
};

/**
 * 파일 맨 위 주석의 첫 문장.
 * 첫 선언에 바로 붙은 주석은 그 선언의 설명일 수 있어, import 앞이거나 빈 줄로 떨어진 주석만 파일 설명으로 본다.
 */
export const extractFileRole = (fileName: string, text: string): string => {
  const sf = parseSource(fileName, text);
  const first = sf.statements.find(
    (st) => !(ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)),
  );
  const scanFrom = first ? first.getFullStart() : 0;
  const blocks = mergeLineComments(text, ts.getLeadingCommentRanges(text, scanFrom) ?? []);
  const range = blocks[0];
  if (!range) return '';
  const next = blocks[1];
  const afterEnd = next ? next.pos : first ? first.getStart(sf) : text.length;
  const detached = next !== undefined || /\n\s*\n/.test(text.slice(range.end, afterEnd));
  const beforeImport = first !== undefined && ts.isImportDeclaration(first);
  if (!detached && !beforeImport && first !== undefined) return '';
  return firstSentence(text.slice(range.pos, range.end));
};
