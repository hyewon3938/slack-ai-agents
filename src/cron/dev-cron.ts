/**
 * 개발 리뷰 + 작업 요약 크론 태스크.
 * GitHub API로 커밋 수집 → LLM 분석 → Slack 전송.
 */

import type { App } from '@slack/bolt';
import type { LLMClient, LLMMessage } from '../shared/llm.js';
import { postToChannel } from '../shared/slack.js';
import { CONFIG } from '../shared/config.js';
import { getTodayISO, getYesterdayISO } from '../shared/kst.js';
import { query } from '../shared/db.js';

const REPO = 'hyewon3938/slack-ai-agents';
const GITHUB_API = 'https://api.github.com';

// ─── GitHub API ──────────────────────────────────────────

interface CommitInfo {
  sha: string;
  message: string;
  date: string;
}

interface CommitStats {
  commits: CommitInfo[];
  filesChanged: number;
  additions: number;
  deletions: number;
  files: string[];
}

interface FileStats {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: string[];
}

type GitHubFileEntry = { filename: string; additions: number; deletions: number };

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'slack-ai-agents',
};

/** 복수 커밋 범위의 파일 변경 통계 (compare API) */
const fetchCompareStats = async (base: string, head: string): Promise<FileStats> => {
  const empty: FileStats = { filesChanged: 0, additions: 0, deletions: 0, files: [] };
  try {
    const res = await fetch(`${GITHUB_API}/repos/${REPO}/compare/${base}~1...${head}`, {
      headers: GITHUB_HEADERS,
    });
    if (!res.ok) return empty;

    const data = (await res.json()) as { files?: GitHubFileEntry[] };
    return parseFileEntries(data.files ?? []);
  } catch {
    return empty;
  }
};

/** 단일 커밋의 파일 변경 통계 */
const fetchSingleCommitStats = async (sha: string): Promise<FileStats> => {
  const empty: FileStats = { filesChanged: 0, additions: 0, deletions: 0, files: [] };
  try {
    const res = await fetch(`${GITHUB_API}/repos/${REPO}/commits/${sha}`, {
      headers: GITHUB_HEADERS,
    });
    if (!res.ok) return empty;

    const data = (await res.json()) as { files?: GitHubFileEntry[] };
    return parseFileEntries(data.files ?? []);
  } catch {
    return empty;
  }
};

/** GitHub 파일 엔트리 배열 → FileStats */
const parseFileEntries = (entries: GitHubFileEntry[]): FileStats => {
  let additions = 0;
  let deletions = 0;
  for (const f of entries) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return {
    filesChanged: entries.length,
    additions,
    deletions,
    files: entries.map((f) => f.filename),
  };
};

/** GitHub API로 최근 24시간 커밋 수집 */
export const fetchRecentCommits = async (): Promise<CommitStats | null> => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(`${GITHUB_API}/repos/${REPO}/commits?since=${since}`, {
    headers: GITHUB_HEADERS,
  });

  if (!res.ok) {
    console.error(`[Dev Cron] GitHub API 오류: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as Array<{
    sha: string;
    commit: { message: string; author: { date: string } };
  }>;

  if (data.length === 0) return null;

  const commits: CommitInfo[] = data.map((c) => ({
    sha: c.sha.substring(0, 7),
    message: c.commit.message.split('\n')[0] ?? '',
    date: c.commit.author.date,
  }));

  const oldest = data[data.length - 1]?.sha;
  const newest = data[0]?.sha;

  const fileStats =
    oldest && newest && oldest !== newest
      ? await fetchCompareStats(oldest, newest)
      : oldest
        ? await fetchSingleCommitStats(oldest)
        : { filesChanged: 0, additions: 0, deletions: 0, files: [] as string[] };

  return { commits, ...fileStats };
};

// ─── LLM 분석 ───────────────────────────────────────────

const buildCommitContext = (stats: CommitStats): string => {
  const commitList = stats.commits.map((c) => `- ${c.sha} ${c.message}`).join('\n');
  const fileList = stats.files.slice(0, 20).join(', ');

  return [
    `커밋 ${stats.commits.length}개:`,
    commitList,
    '',
    `변경: ${stats.filesChanged}개 파일, +${stats.additions} / -${stats.deletions}`,
    fileList ? `주요 파일: ${fileList}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

/** LLM으로 개발자 리뷰 생성 */
const generateDevReview = async (
  llmClient: LLMClient,
  stats: CommitStats,
): Promise<string> => {
  const today = getTodayISO();
  const context = buildCommitContext(stats);

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `너는 시니어 개발 멘토. 개발자의 작업 패턴을 분석하고 건설적인 피드백을 제공한다.
한국어로 작성. Slack mrkdwn 형식.
분석 항목: 작업 요약(1줄), 개발 성향(패턴/스타일), 강점, 개선점, AI 협업 팁.
각 항목은 1~2문장으로 짧게. 구체적 커밋/파일명을 인용해서 설명.`,
    },
    {
      role: 'user',
      content: `${today} 작업 분석해줘.\n\n${context}`,
    },
  ];

  const response = await llmClient.chat(messages);
  return response.text ?? '분석 생성 실패';
};

/** LLM으로 작업 요약 생성 */
const generateWorkSummary = async (
  llmClient: LLMClient,
  stats: CommitStats,
): Promise<string> => {
  const yesterday = getYesterdayISO();
  const context = buildCommitContext(stats);

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `전날 작업을 팩트 기반으로 요약한다.
한국어로 작성. Slack mrkdwn 형식.
포맷: 작업 요약(불릿 2~3개), 변경 규모, 주요 변경(불릿), 미완료/다음 할 일.
간결하게. 항목당 1줄.`,
    },
    {
      role: 'user',
      content: `${yesterday} 작업 요약해줘.\n\n${context}`,
    },
  ];

  const response = await llmClient.chat(messages);
  return response.text ?? '요약 생성 실패';
};

// ─── DB: Opus 분석 결과 조회 ─────────────────────────────

interface DevAnalysisRow {
  analysis: string;
  date: string;
}

/** 어제자 Opus 분석 결과 조회 (없으면 null) */
const fetchOpusAnalysis = async (): Promise<string | null> => {
  try {
    const yesterday = getYesterdayISO();
    const result = await query<DevAnalysisRow>(
      'SELECT analysis FROM dev_analyses WHERE date = $1',
      [yesterday],
    );
    return result.rows[0]?.analysis ?? null;
  } catch {
    return null;
  }
};

// ─── Slack 전송 포맷 ────────────────────────────────────

const getProjectChannelId = (): string =>
  CONFIG.channels.project || CONFIG.channels.life;

// ─── 크론 태스크 ────────────────────────────────────────

export interface DevCronClients {
  mainLLMClient: LLMClient;
  cronLLMClient: LLMClient;
}

let devCronClients: DevCronClients | null = null;

/** app.ts에서 초기화 시 호출 */
export const setDevCronClients = (clients: DevCronClients): void => {
  devCronClients = clients;
};

/** 개발자 리뷰 크론 태스크 — Opus 분석(DB) 우선, 없으면 Sonnet 자체 생성 */
export const devReviewTask = async (app: App): Promise<void> => {
  const today = getTodayISO();

  // 1. Opus 분석 결과가 DB에 있으면 우선 사용
  const opusAnalysis = await fetchOpusAnalysis();
  if (opusAnalysis) {
    const message = `📋 *Daily Dev Review — ${today}*\n\n${opusAnalysis}`;
    await postToChannel(app.client, getProjectChannelId(), message);
    console.warn('[Dev Cron] 개발자 리뷰 전송 완료 (Opus 분석)');
    return;
  }

  // 2. Opus 분석 없으면 GitHub API + Sonnet으로 자체 생성
  const stats = await fetchRecentCommits();
  if (!stats) {
    console.warn('[Dev Cron] 최근 24시간 커밋 없음 — devReview 스킵');
    return;
  }

  const client = devCronClients?.mainLLMClient;
  if (!client) {
    console.error('[Dev Cron] mainLLMClient 미설정');
    return;
  }

  const review = await generateDevReview(client, stats);
  const message = `📋 *Daily Dev Review — ${today}*\n\n${review}`;

  await postToChannel(app.client, getProjectChannelId(), message);
  console.warn('[Dev Cron] 개발자 리뷰 전송 완료 (Sonnet 자체 생성)');
};

/** 작업 요약 크론 태스크 */
export const workSummaryTask = async (app: App): Promise<void> => {
  const stats = await fetchRecentCommits();
  if (!stats) {
    console.warn('[Dev Cron] 최근 24시간 커밋 없음 — workSummary 스킵');
    return;
  }

  const client = devCronClients?.cronLLMClient;
  if (!client) {
    console.error('[Dev Cron] cronLLMClient 미설정');
    return;
  }

  const yesterday = getYesterdayISO();
  const summary = await generateWorkSummary(client, stats);
  const message = `📊 *Daily Work Summary — ${yesterday}*\n\n${summary}`;

  await postToChannel(app.client, getProjectChannelId(), message);
  console.warn('[Dev Cron] 작업 요약 전송 완료');
};
