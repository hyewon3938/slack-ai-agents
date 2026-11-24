/**
 * web-api.md, cron.md, slack.md를 만든다.
 */
import { GENERATED_NOTICE } from './config.js';
import type { CronData, PublicPathList, RouteEntry } from './collect.js';
import { compareText, escapeCell, inlineCode } from './fs-utils.js';
import { cellText } from './render-files.js';
import type { SlackExtract } from './slack.js';

const codeCell = (text: string): string => (text ? escapeCell(inlineCode(text)) : '');

const renderRouteRows = (routes: RouteEntry[]): string[] =>
  routes.flatMap((r) => {
    if (r.methods.length === 0) return [`| \`${r.url}\` | 찾지 못함 | | \`${r.file}\` |`];
    return r.methods.map((m) => {
      const auth = m.auth.length > 0 ? m.auth.map((a) => `\`${a}\``).join(', ') : '찾지 못함';
      return `| \`${r.url}\` | ${m.method} | ${auth} | \`${r.file}\` |`;
    });
  });

export const renderWebApi = (routes: RouteEntry[], publicPaths: PublicPathList[]): string => {
  const out = [
    '# 웹 API 라우트',
    '',
    GENERATED_NOTICE,
    '',
    `\`route.ts\` 파일 ${routes.length}개에서 export한 HTTP 메서드를 한 줄씩 적었다.`,
    '인증 확인 칸에는 메서드 함수 본문에서 찾은 호출만 적는다. 인증 모듈에서 가져온 `require`로 시작하는 함수 호출과 `_SECRET`으로 끝나는 환경변수 읽기가 대상이다.',
    '찾지 못함은 본문에 그런 호출이 없다는 뜻이고, 그 라우트가 공개인지는 파일을 열어 확인한다.',
    '',
    '| URL | 메서드 | 인증 확인 | 파일 |',
    '| --- | --- | --- | --- |',
    ...renderRouteRows(routes),
    '',
  ];
  if (publicPaths.length > 0) {
    out.push('## 공개 경로 상수', '', '이름에 PUBLIC이 들어간 문자열 배열 상수와 그 값이다.', '');
    for (const p of publicPaths) {
      out.push(`- \`${p.file}\`: ${p.paths.map((x) => `\`${x}\``).join(', ')}`);
    }
    out.push('');
  }
  return out.join('\n');
};

const renderSlots = (cron: CronData): string[] => {
  if (cron.slots.length === 0) return [];
  const out = [
    '## 봇 크론 슬롯',
    '',
    `슬롯 ${cron.slots.length}개다. 슬롯 이름은 DB \`notification_settings\` 행과 핸들러 함수를 연결하는 키다.`,
    '',
    '| 슬롯 | 핸들러 | 핸들러 파일 | 주석 | 슬롯 이름이 나오는 마이그레이션 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const s of cron.slots) {
    const migrations = (cron.slotMigrations.get(s.slot) ?? [])
      .map((m) => `\`${m.slice(m.lastIndexOf('/') + 1)}\``)
      .join(', ');
    out.push(
      `| \`${s.slot}\` | \`${s.handler}\` | \`${s.handlerFile}\` | ${cellText(s.comment)} | ${migrations} |`,
    );
  }
  const maps = [...new Set(cron.slots.map((s) => `\`${s.mapFile}\`의 \`${s.mapName}\``))].sort(
    compareText,
  );
  out.push('', `슬롯 표를 선언한 곳은 ${maps.join(', ')}이다.`, '');
  return out;
};

export const renderCron = (cron: CronData): string => {
  const out = [
    '# 크론',
    '',
    GENERATED_NOTICE,
    '',
    '봇 크론의 발송 시각 원본은 DB `notification_settings` 테이블이다. 코드와 마이그레이션에 적힌 시각은 처음 넣은 값일 수 있어서 이 문서에는 싣지 않았다.',
    '',
    ...renderSlots(cron),
    '## `cron.schedule` 호출',
    '',
    '| 파일 | 위치 | 시각 식 |',
    '| --- | --- | --- |',
    ...cron.calls.map((c) => `| \`${c.file}\` | \`${c.where}\` | ${codeCell(c.expression)} |`),
    '',
  ];
  if (cron.vercel.length > 0) {
    out.push(
      '## Vercel 크론',
      '',
      '`web/vercel.json`의 `crons` 항목이다. 이 시각 식은 설정 파일이 원본이고 UTC 기준이다.',
      '',
      '| 경로 | 시각 식 |',
      '| --- | --- |',
      ...cron.vercel.map((v) => `| \`${v.path}\` | \`${v.schedule}\` |`),
      '',
    );
  }
  if (cron.workflows.length > 0) {
    out.push('## GitHub Actions 예약 실행', '', '| 워크플로 | 시각 식 |', '| --- | --- |');
    for (const w of cron.workflows) {
      out.push(`| \`${w.file}\` | ${w.schedules.map((s) => `\`${s}\``).join(', ')} |`);
    }
    out.push('');
  }
  return out.join('\n');
};

const renderRegexes = (slack: SlackExtract): string[] => {
  const out = [
    '## fast path 정규식',
    '',
    '`agents/` 아래 파일에서 최상위 상수로 선언한 정규식이다. 메시지가 정해진 명령인지 판별해 LLM을 거치지 않고 처리하는 데 쓰는 정규식이 대부분이고 입력값 검사용도 함께 나온다. 쓰는 곳에는 같은 파일 안에서 이 상수를 참조하는 함수를 적었다.',
    '',
  ];
  let lastFile = '';
  for (const r of slack.regexes) {
    if (r.file !== lastFile) out.push('', `### \`${r.file}\``, '');
    lastFile = r.file;
    const used = r.usedIn.length > 0 ? r.usedIn.map((u) => `\`${u}\``).join(', ') : '찾지 못함';
    out.push(`- \`${r.name}\`: ${inlineCode(r.pattern)}`, `  - 쓰는 곳: ${used}`);
    if (r.comment) out.push(`  - 주석: ${cellText(r.comment)}`);
  }
  out.push('');
  return out;
};

export const renderSlack = (slack: SlackExtract): string =>
  [
    '# Slack 진입점',
    '',
    GENERATED_NOTICE,
    '',
    '## 채널별 에이전트',
    '',
    '`registerAgent` 호출에서 뽑았다. 채널 칸은 호출에 넘긴 식 그대로이고 실제 채널 ID는 환경변수에 있다.',
    '',
    '| 채널 | 에이전트 | 에이전트 파일 | 등록 파일 |',
    '| --- | --- | --- | --- |',
    ...slack.agents.map(
      (a) => `| \`${a.channel}\` | \`${a.factory}\` | \`${a.factoryFile}\` | \`${a.file}\` |`,
    ),
    '',
    '## 리스너',
    '',
    '`app.action`, `app.view`, `app.event`, `app.message`처럼 Bolt 앱에 등록한 리스너다. 종류가 action인 줄의 ID가 `action_id`다.',
    '',
    '| 종류 | ID | 상수 | 등록 파일 | 등록 함수 |',
    '| --- | --- | --- | --- | --- |',
    ...slack.listeners.map(
      (l) =>
        `| ${l.kind} | ${codeCell(l.id)} | ${codeCell(l.constName)} | \`${l.file}\` | ${codeCell(l.where)} |`,
    ),
    '',
    ...renderRegexes(slack),
    '## 에이전트 도구',
    '',
    '| 도구 | 설명 | 파일 |',
    '| --- | --- | --- |',
    ...slack.tools.map((t) => `| \`${t.name}\` | ${cellText(t.description)} | \`${t.file}\` |`),
    '',
  ].join('\n');
