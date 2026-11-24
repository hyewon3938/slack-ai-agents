import type { App } from '@slack/bolt';
import { postToChannel } from '../../shared/slack.js';
import { weeklyReportTask } from '../weekly-report/task.js';
import { dailyPatternMatchingTask } from '../daily-pattern-matching.js';
import { diaryMetaExtractTask } from '../diary-meta-extract.js';
import { weeklyVerificationTask, weeklyReviewFallbackTask } from '../weekly-verification/tasks.js';
import { signalSuggestFallbackTask } from '../signal-suggest-fallback.js';
import { discoveryRecommendTask } from '../discovery-recommend.js';
import { periodFortuneTask } from '../period-fortune.js';
import type { LifeCronConfig } from './types.js';
import { morningTask, nightTask } from './morning-night-tasks.js';
import { insightNightTask } from './insight-night-task.js';

// ─── 유틸리티 ──────────────────────────────────────────

export const wrapTask = (
  taskFn: (app: App, config: LifeCronConfig) => Promise<void>,
  app: App,
  config: LifeCronConfig,
  label: string,
): (() => Promise<void>) => {
  return async () => {
    try {
      await taskFn(app, config);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] ${label} 실패:`, msg);
      try {
        await postToChannel(
          app.client,
          config.channelId,
          `${label} 알림 처리 중 오류가 발생했어. 잠시 후 다시 확인해줘.`,
        );
      } catch {
        console.error(`[Life Cron] ${label} 에러 알림 전송도 실패`);
      }
    }
  };
};

/** 'HH:MM' → 'MM HH * * *' 크론 표현식 변환 */
export const timeToCron = (timeValue: string): string => {
  const parts = timeValue.split(':');
  return `${Number(parts[1])} ${Number(parts[0])} * * *`;
};

// ─── slot_name → 태스크 매핑 ────────────────────────────

type CronTaskFn = (app: App, config: LifeCronConfig) => Promise<void>;

export const SLOT_TASKS: Record<string, CronTaskFn> = {
  morning: morningTask,
  night: nightTask,
  weeklyReport: weeklyReportTask,
  insightNight: insightNightTask,
  dailySajuMatching: dailyPatternMatchingTask,
  diaryMetaExtract: diaryMetaExtractTask,
  weeklyVerification: weeklyVerificationTask,
  weeklyReviewFallback: weeklyReviewFallbackTask, // 월 10:00 — routine 미발송 시 수동 실행 알림 (#542 ADR-0052)
  signalSuggestFallback: signalSuggestFallbackTask, // 월 2일 11:00 — monthly-signal-suggest 미실행 시 알림 (#466 ADR-0058)
  discoveryRecommend: discoveryRecommendTask, // 07:30 데일리 — 묶음 전부 패스 시 다음 best (#512 ADR-0047)
  periodFortune: periodFortuneTask, // 08:20 데일리 — 절기/입춘/대운 전환 시 주기 운세 카드 (#529 ADR-0050)
  // pillarLevelDistributionReview 은퇴(#508 ADR-0046) — 누적 시드 강도 밴드 위임으로 분포 리뷰 무의미.
  // 미등록 슬롯은 loadAndSchedule가 graceful skip(if (!taskFn) continue) — DB row 비활성은 가역 정리.
};
