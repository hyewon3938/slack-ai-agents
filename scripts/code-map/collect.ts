/**
 * 저장소를 훑어 코드 맵에 실을 자료를 모은다.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOT_ROOT,
  MIGRATIONS_DIR,
  VERCEL_CONFIG,
  WEB_APP_ROOT,
  WEB_ROOT,
  WORKFLOWS_DIR,
} from './config.js';
import {
  extractCron,
  parseVercelCrons,
  parseWorkflowCrons,
  type CronCall,
  type CronSlot,
  type VercelCron,
} from './cron.js';
import { compareText, countLines, isSourceFile, isTestFile, readText, walkFiles } from './fs-utils.js';
import { extractPublicPaths, extractRouteMethods, toUrlPath, type RouteMethod } from './routes.js';
import { extractSlack, type SlackExtract } from './slack.js';
import { applyMigration, createSchema, type SchemaState } from './sql-migrations.js';
import { findTableUsage } from './table-usage.js';
import { extractExports, extractFileRole, parseSource, type ExportEntry } from './ts-extract.js';
import { collectStringConsts } from './ts-resolve.js';

export interface FileEntry {
  path: string;
  lines: number;
  role: string;
  exports: ExportEntry[];
}

export interface SourceTree {
  root: string;
  files: FileEntry[];
  tests: string[];
  others: string[];
}

export interface PageEntry {
  url: string;
  file: string;
}

export interface RouteEntry extends PageEntry {
  methods: RouteMethod[];
}

export interface PublicPathList {
  file: string;
  paths: string[];
}

export interface WorkflowCron {
  file: string;
  schedules: string[];
}

export interface CronData {
  slots: CronSlot[];
  calls: CronCall[];
  vercel: VercelCron[];
  workflows: WorkflowCron[];
  /** 슬롯 이름 → 그 이름이 문자열로 나오는 마이그레이션 파일 */
  slotMigrations: Map<string, string[]>;
}

export interface TableUsage {
  bot: string[];
  web: string[];
}

export interface DbData {
  schema: SchemaState;
  migrationCount: number;
  usage: Map<string, TableUsage>;
}

export interface CodeMapData {
  bot: SourceTree;
  web: SourceTree;
  pages: PageEntry[];
  routes: RouteEntry[];
  publicPaths: PublicPathList[];
  cron: CronData;
  slack: SlackExtract;
  db: DbData;
}

type Reader = (path: string) => string;

const collectTree = (root: string, all: string[], read: Reader): SourceTree => {
  const tree: SourceTree = { root, files: [], tests: [], others: [] };
  for (const path of all) {
    if (!isSourceFile(path)) tree.others.push(path);
    else if (isTestFile(path)) tree.tests.push(path);
    else {
      const text = read(path);
      tree.files.push({
        path,
        lines: countLines(text),
        role: extractFileRole(path, text),
        exports: extractExports(path, text),
      });
    }
  }
  return tree;
};

const collectWebEntries = (
  web: SourceTree,
  read: Reader,
): Pick<CodeMapData, 'pages' | 'routes' | 'publicPaths'> => {
  const pages: PageEntry[] = [];
  const routes: RouteEntry[] = [];
  const publicPaths: PublicPathList[] = [];
  for (const { path } of web.files) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const inApp = path.startsWith(`${WEB_APP_ROOT}/`);
    if (inApp && /^page\.tsx?$/.test(base)) pages.push({ url: toUrlPath(path, WEB_APP_ROOT), file: path });
    if (inApp && /^route\.tsx?$/.test(base)) {
      routes.push({
        url: toUrlPath(path, WEB_APP_ROOT),
        file: path,
        methods: extractRouteMethods(path, read(path)),
      });
    }
    const paths = extractPublicPaths(path, read(path));
    if (paths.length > 0) publicPaths.push({ file: path, paths });
  }
  const byUrl = (a: PageEntry, b: PageEntry): number => compareText(a.url, b.url);
  return { pages: pages.sort(byUrl), routes: routes.sort(byUrl), publicPaths };
};

const collectCron = (root: string, bot: SourceTree, fileSet: ReadonlySet<string>, read: Reader): CronData => {
  const data: CronData = { slots: [], calls: [], vercel: [], workflows: [], slotMigrations: new Map() };
  for (const { path } of bot.files) {
    const found = extractCron(path, read(path), fileSet);
    data.slots.push(...found.slots);
    data.calls.push(...found.calls);
  }
  if (fileSet.has(VERCEL_CONFIG)) data.vercel = parseVercelCrons(read(VERCEL_CONFIG));
  for (const file of walkFiles(root, WORKFLOWS_DIR)) {
    const schedules = parseWorkflowCrons(read(file));
    if (schedules.length > 0) data.workflows.push({ file, schedules });
  }
  return data;
};

const collectSlack = (bot: SourceTree, fileSet: ReadonlySet<string>, read: Reader): SlackExtract => {
  const cache = new Map<string, Map<string, string>>();
  const lookup = (file: string): Map<string, string> => {
    const hit = cache.get(file);
    if (hit) return hit;
    const consts = fileSet.has(file) ? collectStringConsts(parseSource(file, read(file))) : new Map<string, string>();
    cache.set(file, consts);
    return consts;
  };
  const out: SlackExtract = { agents: [], listeners: [], regexes: [], tools: [] };
  for (const { path } of bot.files) {
    const found = extractSlack(path, read(path), fileSet, lookup);
    out.agents.push(...found.agents);
    out.listeners.push(...found.listeners);
    out.regexes.push(...found.regexes);
    out.tools.push(...found.tools);
  }
  return out;
};

const collectDb = (root: string, bot: SourceTree, web: SourceTree, cron: CronData, read: Reader): DbData => {
  const schema = createSchema();
  const migrations = walkFiles(root, MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  for (const file of migrations) {
    const sql = read(file);
    applyMigration(schema, file, sql);
    for (const { slot } of cron.slots) {
      if (!sql.includes(`'${slot}'`)) continue;
      cron.slotMigrations.set(slot, [...(cron.slotMigrations.get(slot) ?? []), file]);
    }
  }
  const known = new Set([...schema.tables.keys(), ...schema.views.keys()]);
  const usage = new Map<string, TableUsage>();
  const scan = (tree: SourceTree, side: keyof TableUsage): void => {
    for (const { path } of tree.files) {
      for (const name of findTableUsage(path, read(path), known)) {
        const entry = usage.get(name) ?? { bot: [], web: [] };
        entry[side].push(path);
        usage.set(name, entry);
      }
    }
  };
  scan(bot, 'bot');
  scan(web, 'web');
  return { schema, migrationCount: migrations.length, usage };
};

/** root는 저장소 루트의 절대 경로. 결과에는 루트 기준 상대 경로만 담는다. */
export const collectCodeMap = (root: string): CodeMapData => {
  const cache = new Map<string, string>();
  const read: Reader = (path) => {
    const hit = cache.get(path);
    if (hit !== undefined) return hit;
    const text = readText(root, path);
    cache.set(path, text);
    return text;
  };
  const botAll = walkFiles(root, BOT_ROOT);
  const webAll = walkFiles(root, WEB_ROOT);
  const fileSet = new Set([...botAll, ...webAll]);
  if (existsSync(join(root, VERCEL_CONFIG))) fileSet.add(VERCEL_CONFIG);
  const bot = collectTree(BOT_ROOT, botAll, read);
  const web = collectTree(WEB_ROOT, webAll, read);
  const cron = collectCron(root, bot, fileSet, read);
  return {
    bot,
    web,
    ...collectWebEntries(web, read),
    cron,
    slack: collectSlack(bot, fileSet, read),
    db: collectDb(root, bot, web, cron, read),
  };
};
