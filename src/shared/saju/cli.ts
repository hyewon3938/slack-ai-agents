/**
 * 만세력 CLI 실행부.
 *
 * CLI: npx tsx src/shared/saju/cli.ts [날짜] [일수]
 */

import { fileURLToPath } from 'node:url';
import { getTodayISO } from '../kst.js';
import type { Cheongan, Jiji } from './types.js';
import { calculateFortuneRange } from './fortune.js';

// ─── CLI 모드 ───────────────────────────────────────────

interface SajuProfileRow {
  day_pillar: string;
  year_pillar: string;
  month_pillar: string;
  hour_pillar: string;
}

const isSajuProfileRow = (value: unknown): value is SajuProfileRow => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['day_pillar'] === 'string' &&
    typeof v['year_pillar'] === 'string' &&
    typeof v['month_pillar'] === 'string' &&
    typeof v['hour_pillar'] === 'string'
  );
};

const PROFILE_QUERY =
  'SELECT day_pillar, year_pillar, month_pillar, hour_pillar FROM saju_profiles WHERE user_id = $1';

/**
 * DB 프록시 API 경유로 사주 프로필 조회.
 * 외부 환경(scheduled task 등)에서 호출 시 사용.
 */
const loadSajuProfileViaProxy = async (
  proxyUrl: string,
  apiKey: string,
): Promise<SajuProfileRow> => {
  const response = await fetch(`${proxyUrl}/api/db/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ text: PROFILE_QUERY, params: [1] }),
  });

  if (!response.ok) {
    throw new Error(`DB 프록시 요청 실패: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    throw new Error('DB 프록시 응답 형식 오류');
  }
  const rows = (data as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error('DB 프록시 응답 형식 오류');
  }
  if (rows.length === 0) throw new Error('사주 프로필 미등록');

  const row = rows[0];
  if (!isSajuProfileRow(row)) {
    throw new Error('사주 프로필 필드 누락');
  }
  return row;
};

/**
 * PostgreSQL 직결로 사주 프로필 조회 (개발 환경 / VM 내부 fallback).
 */
const loadSajuProfileViaDirect = async (dbUrl: string): Promise<SajuProfileRow> => {
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const { rows } = await pool.query<SajuProfileRow>(PROFILE_QUERY, [1]);
    if (rows.length === 0) throw new Error('사주 프로필 미등록');
    return rows[0];
  } finally {
    await pool.end();
  }
};

/**
 * 사주 프로필 조회 — DB 프록시 우선, 없으면 DATABASE_URL 직결 fallback.
 */
const loadSajuProfile = async (): Promise<SajuProfileRow> => {
  const proxyUrl = process.env['DB_PROXY_URL'];
  const proxyKey = process.env['DB_PROXY_API_KEY'];
  if (proxyUrl && proxyKey) {
    return loadSajuProfileViaProxy(proxyUrl, proxyKey);
  }

  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) return loadSajuProfileViaDirect(dbUrl);

  throw new Error('DB_PROXY_URL+DB_PROXY_API_KEY 또는 DATABASE_URL 환경변수 필요');
};

export const runCLI = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const startDate = args[0] ?? getTodayISO();
  const count = Number(args[1] ?? 1);

  const dotenv = await import('dotenv');
  dotenv.config();

  const profile = await loadSajuProfile();
  // 일간 추출 (일주의 첫 글자)
  const dayMaster = profile.day_pillar.charAt(0) as Cheongan;
  // 원국 천간/지지 추출
  const pillars = [
    profile.year_pillar,
    profile.month_pillar,
    profile.day_pillar,
    profile.hour_pillar,
  ];
  const wonkukStems = pillars.map((p) => p.charAt(0)) as Cheongan[];
  const wonkukBranches = pillars.map((p) => p.charAt(1)) as Jiji[];

  const results = calculateFortuneRange(startDate, count, dayMaster, wonkukStems, wonkukBranches);
  console.log(JSON.stringify(results, null, 2));
};

// CLI 진입점
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runCLI().catch((err: unknown) => {
    console.error('[saju-calendar] 오류:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
