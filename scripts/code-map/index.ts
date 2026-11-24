/**
 * 코드 맵 생성기 진입점.
 * 인자 없이 실행하면 docs/code-map/을 다시 쓰고, --check를 주면 커밋본과 비교만 한다.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_DIR } from './config.js';
import { collectCodeMap } from './collect.js';
import { compareText } from './fs-utils.js';
import { renderDb } from './render-db.js';
import { renderCron, renderSlack, renderWebApi } from './render-entry.js';
import { renderBot, renderWeb } from './render-files.js';
import { renderReadme } from './render-readme.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const normalizeDoc = (text: string): string => `${text.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

const buildFiles = (): Map<string, string> => {
  const data = collectCodeMap(ROOT);
  const files = new Map<string, string>([
    ['README.md', renderReadme(data)],
    ['bot.md', renderBot(data.bot)],
    ['cron.md', renderCron(data.cron)],
    ['db.md', renderDb(data.db)],
    ['slack.md', renderSlack(data.slack)],
    ['web-api.md', renderWebApi(data.routes, data.publicPaths)],
    ['web.md', renderWeb(data.web, data.pages)],
  ]);
  for (const [name, text] of files) files.set(name, normalizeDoc(text));
  return files;
};

const existingFiles = (outDir: string): string[] =>
  existsSync(outDir)
    ? readdirSync(outDir)
        .filter((f) => f.endsWith('.md'))
        .sort(compareText)
    : [];

/** 다시 만든 결과와 다른 파일 이름. 맵에 없어야 할 파일이 남아 있어도 다르다고 본다. */
const findStale = (outDir: string, files: Map<string, string>): string[] => {
  const stale = new Set<string>();
  for (const [name, text] of files) {
    const path = join(outDir, name);
    if (!existsSync(path) || readFileSync(path, 'utf-8') !== text) stale.add(name);
  }
  for (const name of existingFiles(outDir)) if (!files.has(name)) stale.add(name);
  return [...stale].sort(compareText);
};

const main = (): void => {
  const check = process.argv.includes('--check');
  const outDir = join(ROOT, OUTPUT_DIR);
  const files = buildFiles();
  const stale = findStale(outDir, files);
  if (check) {
    if (stale.length === 0) {
      process.stdout.write('[code-map] 커밋본과 같다.\n');
      return;
    }
    process.stderr.write(
      '[code-map] 다시 만든 결과가 커밋본과 다르다. yarn code-map을 돌려 함께 커밋한다.\n',
    );
    for (const name of stale) process.stderr.write(`  ${OUTPUT_DIR}/${name}\n`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(outDir, { recursive: true });
  for (const name of existingFiles(outDir)) if (!files.has(name)) unlinkSync(join(outDir, name));
  for (const [name, text] of files) writeFileSync(join(outDir, name), text);
  process.stdout.write(
    `[code-map] ${OUTPUT_DIR}/ 파일 ${files.size}개 생성, 바뀐 파일 ${stale.length}개\n`,
  );
};

main();
