/**
 * 패턴 검증 1회성 재기준선 — admin script (#523 Phase 0, ADR-0048).
 *
 * 측정 로직(enrollment 클립 등)이 바뀌어도 sticky confirmed 링크는 정기 주간 run이 재검정하지
 * 않는다(verifyUserLinks는 status='active'만 로드). 이 스크립트가 confirmed를 active로 강등한 뒤
 * 새 측정 로직으로 전체를 1회 강제 재검증하고, 사용자에게 정직 공지 카드를 보낸다.
 * 멱등 — 반복 실행해도 같은 종착 상태(두 번째 실행은 강등 0).
 *
 * 스냅샷·교란·발굴·강도컷은 건너뛴다 — 비월요일 실행 시 week_start 시맨틱 오염 방지(다음 월요일
 * 정기 run이 자연 충전). 이 스크립트는 pattern_links 본체(counters·status·test_detail)만 갱신.
 *
 * 실행(prod): ssh oracle-prod "docker exec slack-ai-agents node dist/ops/rebaseline-pattern-links.js [--user N]"
 * 실행(dev):  yarn tsx src/ops/rebaseline-pattern-links.ts [--user N]
 *   배포(머지된 새 측정 코드) 후 실행. 컨테이너 env(DATABASE_URL·SLACK_BOT_TOKEN) 사용.
 *   운영 절차: docs/ops/verification-rebaseline.md
 */

import { WebClient } from '@slack/web-api';
import { CONFIG } from '../shared/config.js';
import { connectDB, disconnectDB, query } from '../shared/db.js';
import { getTodayISO } from '../shared/kst.js';
import { verifyUserLinks } from '../shared/pattern-verification.js';
import { persistLinkVerification } from '../cron/weekly-verification.js';
import { postBlockMessage } from '../shared/slack.js';
import { buildRebaselineNotice } from '../agents/insight/hypothesis-cards.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';

interface CliArgs {
  /** null = 전체 매핑(없으면 DEFAULT_USER_ID). */
  userId: number | null;
}

const parseArgs = (argv: string[]): CliArgs => {
  let userId: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user' && argv[i + 1]) {
      userId = Number(argv[i + 1]);
      i++;
    }
  }
  if (userId !== null && (!Number.isFinite(userId) || userId <= 0)) {
    throw new Error('--user 옵션이 양의 정수여야 함');
  }
  return { userId };
};

interface Target {
  userId: number;
  channelId: string | null;
}

/** 재기준선 대상 유저·채널 해석 — 크론과 동일(매핑 우선, 없으면 DEFAULT_USER_ID + INSIGHT). */
const resolveTargets = async (only: number | null): Promise<Target[]> => {
  const insightFallback = CONFIG.channels.insight || null;
  const mappings = await queryAllUserMappings();
  const all: Target[] =
    mappings.length === 0
      ? [{ userId: DEFAULT_USER_ID, channelId: insightFallback }]
      : mappings.map((m) => ({
          userId: m.userId,
          channelId: m.insightChannelId ?? insightFallback,
        }));
  return only === null ? all : all.filter((t) => t.userId === only);
};

const rebaselineUser = async (client: WebClient, target: Target, today: string): Promise<void> => {
  const { userId, channelId } = target;

  // ① confirmed → active 강등 (RETURNING으로 강등 건수 확보). 새 측정 로직 재검정 대상에 포함시킴.
  const demoteRes = await query<{ id: number }>(
    `UPDATE pattern_links SET status = 'active', updated_at = NOW()
      WHERE user_id = $1 AND status = 'confirmed'
      RETURNING id`,
    [userId],
  );
  const demoted = demoteRes.rowCount ?? demoteRes.rows.length;

  // ② 새 측정 로직으로 전체 active 링크 재검증 (read-only 계산).
  const results = await verifyUserLinks(userId, today);

  // ③ per-link persist (격리 — 한 링크 실패가 전체를 막지 않게). 같은 기준 통과 시 자동 재확정.
  let persisted = 0;
  for (const l of results) {
    try {
      await persistLinkVerification(l);
      persisted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Rebaseline] 링크 persist 실패 link=${l.linkId}: ${msg}`);
    }
  }

  const reconfirmed = results.filter((l) => l.nextStatus === 'confirmed').length;
  const rejects = results.filter((l) => l.verdict === 'reject').length;

  // ⑤ 요약 출력.
  console.warn(
    `[Rebaseline] user=${userId} 강등 ${demoted} · 재검증 ${results.length} (persist ${persisted}) · 재확정 ${reconfirmed} · reject ${rejects}`,
  );

  // ④ 정직 공지 카드 → #insight.
  if (!channelId) {
    console.warn(`[Rebaseline] user=${userId} insight 채널 미설정 — 공지 카드 생략`);
    return;
  }
  const blocks = buildRebaselineNotice({ demoted, reconfirmed, total: results.length });
  try {
    await postBlockMessage(client, channelId, '패턴 검증 재기준선 안내', blocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Rebaseline] user=${userId} 공지 카드 전송 실패: ${msg}`);
  }
};

const main = async (): Promise<void> => {
  const { userId } = parseArgs(process.argv.slice(2));
  await connectDB(CONFIG.db.url);
  try {
    const today = getTodayISO();
    const targets = await resolveTargets(userId);
    if (targets.length === 0) {
      console.warn('[Rebaseline] 대상 유저 없음.');
      return;
    }
    const client = new WebClient(CONFIG.slack.botToken);
    console.warn(`[Rebaseline] 시작 — 대상 ${targets.length}명 · today=${today}`);
    for (const target of targets) {
      await rebaselineUser(client, target, today);
    }
    console.warn('[Rebaseline] 완료.');
  } finally {
    await disconnectDB();
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Rebaseline] 실패:', err);
    process.exit(1);
  });
