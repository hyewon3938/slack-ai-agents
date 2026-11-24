/**
 * Next.js app 라우터의 페이지와 API 라우트를 뽑는다.
 */

import ts from 'typescript';
import { parseSource } from './ts-extract.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** app 폴더 안 파일 경로를 URL 경로로 바꾼다. 라우트 그룹과 병렬 라우트 폴더는 URL에서 빠진다. */
export const toUrlPath = (filePath: string, appRoot: string): string => {
  const rel = filePath.slice(appRoot.length).replace(/^\//, '');
  const segments = rel.split('/').slice(0, -1);
  const visible = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${visible.join('/')}`;
};

export interface RouteMethod {
  method: string;
  /** 본문에서 찾은 인증 확인. 못 찾으면 빈 배열 */
  auth: string[];
}

/** 인증 모듈에서 가져온 이름 가운데 require로 시작하는 것을 인증 헬퍼로 본다. */
export const findAuthHelpers = (sf: ts.SourceFile): string[] => {
  const helpers: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/(^|\/)auth(\.js)?$/.test(st.moduleSpecifier.text)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (/^require[A-Z]/.test((el.propertyName ?? el.name).text)) helpers.push(el.name.text);
    }
  }
  return helpers;
};

const detectAuth = (body: ts.Node, helpers: string[]): string[] => {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (helpers.includes(node.expression.text)) found.add(`${node.expression.text}()`);
    }
    // process.env.X_SECRET 또는 process.env['X_SECRET']를 읽으면 공유 비밀값 확인으로 본다
    const envName = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    if (envName !== null && /_SECRET$/.test(envName)) {
      const target = (node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
      if (target.getText() === 'process.env') found.add(envName);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return [...found].sort();
};

/** route.ts가 export하는 HTTP 메서드와 메서드별 인증 확인 */
export const extractRouteMethods = (fileName: string, text: string): RouteMethod[] => {
  const sf = parseSource(fileName, text);
  const helpers = findAuthHelpers(sf);
  const out: RouteMethod[] = [];
  const isExported = (st: ts.Statement): boolean =>
    ts.canHaveModifiers(st) &&
    (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (!isExported(st)) continue;
    if (ts.isFunctionDeclaration(st) && st.name && HTTP_METHODS.includes(st.name.text)) {
      out.push({ method: st.name.text, auth: detectAuth(st, helpers) });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HTTP_METHODS.includes(d.name.text) && d.initializer) {
          out.push({ method: d.name.text, auth: detectAuth(d.initializer, helpers) });
        }
      }
    }
  }
  return out.sort((a, b) => HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method));
};

/** 프록시(미들웨어) 파일에서 이름에 PUBLIC이 들어간 문자열 배열 상수를 찾는다. */
export const extractPublicPaths = (fileName: string, text: string): string[] => {
  const sf = parseSource(fileName, text);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/PUBLIC/.test(d.name.text) || !d.initializer) continue;
      if (!ts.isArrayLiteralExpression(d.initializer)) continue;
      for (const el of d.initializer.elements) if (ts.isStringLiteral(el)) out.push(el.text);
    }
  }
  return out;
};
