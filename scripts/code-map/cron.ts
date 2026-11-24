/**
 * 크론 등록을 뽑는다.
 * node-cron을 쓰는 파일에서 슬롯 이름과 핸들러를 잇는 객체, 그리고 cron.schedule 호출을 찾는다.
 */

import ts from 'typescript';
import { parseSource } from './ts-extract.js';
import {
  collectImports,
  collectStringConsts,
  enclosingName,
  importsModule,
  trailingComment,
} from './ts-resolve.js';

export interface CronSlot {
  slot: string;
  handler: string;
  handlerFile: string;
  /** 슬롯 표를 선언한 파일 */
  mapFile: string;
  mapName: string;
  comment: string;
}

export interface CronCall {
  file: string;
  where: string;
  /** 첫 인자의 소스 표기. 상수면 값도 함께 */
  expression: string;
}

export interface CronExtract {
  slots: CronSlot[];
  calls: CronCall[];
}

const propertyKey = (name: ts.PropertyName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;

/** 값이 모두 식별자인 최상위 객체 const 가운데 이름에 SLOT이 들어간 것 */
const findSlotMaps = (sf: ts.SourceFile): ts.VariableDeclaration[] => {
  const out: ts.VariableDeclaration[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/SLOT/i.test(d.name.text)) continue;
      const init = d.initializer;
      if (!init || !ts.isObjectLiteralExpression(init) || init.properties.length === 0) continue;
      const allIdentifiers = init.properties.every(
        (p) =>
          ts.isShorthandPropertyAssignment(p) ||
          (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)),
      );
      if (allIdentifiers) out.push(d);
    }
  }
  return out;
};

export const extractCron = (
  filePath: string,
  text: string,
  files: ReadonlySet<string>,
): CronExtract => {
  const sf = parseSource(filePath, text);
  if (!importsModule(sf, 'node-cron')) return { slots: [], calls: [] };
  const imports = collectImports(sf, filePath, files);
  const consts = collectStringConsts(sf);

  const slots: CronSlot[] = [];
  for (const decl of findSlotMaps(sf)) {
    const init = decl.initializer as ts.ObjectLiteralExpression;
    for (const prop of init.properties) {
      const key = prop.name ? propertyKey(prop.name) : null;
      if (key === null) continue;
      const handler = ts.isPropertyAssignment(prop) ? prop.initializer.getText(sf) : key;
      const imported = imports.get(handler);
      slots.push({
        slot: key,
        handler: imported ? imported.original : handler,
        handlerFile: imported ? (imported.file ?? '') : filePath,
        mapFile: filePath,
        mapName: (decl.name as ts.Identifier).text,
        comment: trailingComment(sf, prop),
      });
    }
  }

  const calls: CronCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'schedule' &&
      node.expression.expression.getText(sf) === 'cron'
    ) {
      const arg = node.arguments[0];
      const source = arg ? arg.getText(sf) : '';
      const value = arg && ts.isIdentifier(arg) ? consts.get(arg.text) : undefined;
      calls.push({
        file: filePath,
        where: enclosingName(node),
        expression: value === undefined ? source : `${source} = '${value}'`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { slots, calls };
};

export interface VercelCron {
  path: string;
  schedule: string;
}

/** vercel.json의 crons 항목 */
export const parseVercelCrons = (jsonText: string): VercelCron[] => {
  const parsed: unknown = JSON.parse(jsonText);
  if (typeof parsed !== 'object' || parsed === null || !('crons' in parsed)) return [];
  const crons = (parsed as { crons: unknown }).crons;
  if (!Array.isArray(crons)) return [];
  return crons.flatMap((c: unknown) => {
    if (typeof c !== 'object' || c === null) return [];
    const { path, schedule } = c as { path?: unknown; schedule?: unknown };
    return typeof path === 'string' && typeof schedule === 'string' ? [{ path, schedule }] : [];
  });
};

/** 워크플로 YAML의 schedule cron 표현식 */
export const parseWorkflowCrons = (yamlText: string): string[] =>
  [...yamlText.matchAll(/^\s*-\s*cron:\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/gm)].map((m) =>
    (m[1] ?? '').trim(),
  );
