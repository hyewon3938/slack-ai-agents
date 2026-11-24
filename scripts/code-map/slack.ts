/**
 * Slack 진입점을 뽑는다.
 * 채널별 에이전트 등록, 리스너 등록, 최상위 정규식 상수, 에이전트 도구 정의를 구문에서 찾는다.
 */

import ts from 'typescript';
import { parseSource } from './ts-extract.js';
import {
  collectImports,
  collectStringConsts,
  enclosingName,
  leadingCommentLine,
} from './ts-resolve.js';

export interface AgentRegistration {
  channel: string;
  factory: string;
  factoryFile: string;
  file: string;
}

export interface SlackListener {
  kind: string;
  /** action_id, callback_id, 이벤트 이름. 못 풀면 소스 표기 그대로 */
  id: string;
  constName: string;
  file: string;
  where: string;
}

export interface RegexConst {
  name: string;
  pattern: string;
  comment: string;
  file: string;
  usedIn: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  file: string;
}

export interface SlackExtract {
  agents: AgentRegistration[];
  listeners: SlackListener[];
  regexes: RegexConst[];
  tools: AgentTool[];
}

const LISTENER_METHODS = new Set(['action', 'view', 'event', 'command', 'shortcut', 'options', 'message']);

export type ConstLookup = (file: string) => Map<string, string>;

const findFactory = (sf: ts.SourceFile, handlerName: string): string => {
  let factory = '';
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === handlerName &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      factory = node.initializer.expression.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return factory;
};

const firstSentenceOf = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/(?<=\.)\s/);
  return end === -1 ? flat : flat.slice(0, end);
};

const toolFromObject = (node: ts.ObjectLiteralExpression): { name: string; description: string } | null => {
  let name: string | null = null;
  let description: string | null = null;
  let hasSchema = false;
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
    const key = p.name.text;
    const isText = ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer);
    if (key === 'name' && isText) name = (p.initializer as ts.StringLiteral).text;
    if (key === 'description' && isText) description = (p.initializer as ts.StringLiteral).text;
    if (key === 'inputSchema' || key === 'input_schema') hasSchema = true;
  }
  return name !== null && description !== null && hasSchema ? { name, description } : null;
};

export const extractSlack = (
  filePath: string,
  text: string,
  files: ReadonlySet<string>,
  lookupConsts: ConstLookup,
): SlackExtract => {
  const sf = parseSource(filePath, text);
  const imports = collectImports(sf, filePath, files);
  const localConsts = collectStringConsts(sf);
  const out: SlackExtract = { agents: [], listeners: [], regexes: [], tools: [] };

  const resolveConst = (name: string): string | undefined => {
    const local = localConsts.get(name);
    if (local !== undefined) return local;
    const imported = imports.get(name);
    return imported?.file ? lookupConsts(imported.file).get(imported.original) : undefined;
  };

  const regexNames = new Map<string, RegexConst>();
  if (/(^|\/)agents\//.test(filePath)) {
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (!ts.isRegularExpressionLiteral(d.initializer)) continue;
        const entry: RegexConst = {
          name: d.name.text,
          pattern: d.initializer.text,
          comment: leadingCommentLine(sf, st),
          file: filePath,
          usedIn: [],
        };
        regexNames.set(entry.name, entry);
        out.regexes.push(entry);
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      if (ts.isIdentifier(callee) && callee.text === 'registerAgent' && node.arguments.length >= 2) {
        const handler = node.arguments[1];
        const factory = handler && ts.isIdentifier(handler) ? findFactory(sf, handler.text) : '';
        const imported = imports.get(factory);
        out.agents.push({
          channel: first ? first.getText(sf) : '',
          factory: imported ? imported.original : factory,
          factoryFile: imported ? (imported.file ?? '') : factory ? filePath : '',
          file: filePath,
        });
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'app' &&
        LISTENER_METHODS.has(callee.name.text)
      ) {
        let id = '';
        let constName = '';
        if (first && ts.isStringLiteral(first)) id = first.text;
        else if (first && ts.isIdentifier(first)) {
          constName = first.text;
          id = resolveConst(first.text) ?? '';
        } else if (first && ts.isRegularExpressionLiteral(first)) id = first.text;
        out.listeners.push({
          kind: callee.name.text,
          id,
          constName,
          file: filePath,
          where: enclosingName(node),
        });
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const tool = toolFromObject(node);
      if (tool) {
        out.tools.push({ name: tool.name, description: firstSentenceOf(tool.description), file: filePath });
      }
    }
    if (ts.isIdentifier(node) && regexNames.has(node.text) && !ts.isVariableDeclaration(node.parent)) {
      const entry = regexNames.get(node.text);
      const where = enclosingName(node);
      if (entry && where && !entry.usedIn.includes(where)) entry.usedIn.push(where);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const r of out.regexes) r.usedIn.sort();
  return out;
};
