import cron from 'node-cron';
import type { App } from '@slack/bolt';
import {
  queryNotificationSettings,
  queryActiveReminderTimes,
  queryDueReminders,
  deactivateReminder,
  decrementReminderCount,
} from '../../shared/life-queries.js';
import { postToChannel } from '../../shared/slack.js';
import { getTodayISO, getKSTTimeString, getKSTDayOfWeek } from '../../shared/kst.js';
import type { LifeCronConfig } from './types.js';
import { wrapTask, timeToCron, SLOT_TASKS } from './slot-tasks.js';

// ─── CronScheduler 클래스 ───────────────────────────────

/** reload() debounce 대기 시간 (ms) */
export const RELOAD_DEBOUNCE_MS = 500;

interface CronTask {
  stop: () => void;
}

export class CronScheduler {
  private tasks = new Map<string, CronTask>();
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloading = false;
  private reloadQueued = false;
  private reminderTimesCache = new Set<string>();
  private reminderCacheUpdatedAt = 0;

  constructor(
    private readonly app: App,
    private readonly config: LifeCronConfig,
  ) {}

  /** DB에서 스케줄 로드 → 크론 등록 + 리마인더 체커 시작 */
  async init(): Promise<void> {
    await this.loadAndSchedule();
    this.startReminderChecker();
  }

  /**
   * 기존 태스크 전체 파기 → DB 재로드 → 새 스케줄로 등록.
   * debounce 적용: 연속 호출 시 마지막 호출만 실행.
   * mutex 적용: 실행 중 재호출 시 큐잉 후 완료 후 1회 재실행.
   */
  reload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.executeReload();
    }, RELOAD_DEBOUNCE_MS);
  }

  /** 모든 태스크 정지 + 제거 (pending debounce 포함) */
  destroy(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.destroyAll();
  }

  // ── 내부 메서드 ──

  private async executeReload(): Promise<void> {
    if (this.reloading) {
      this.reloadQueued = true;
      return;
    }

    this.reloading = true;
    try {
      this.destroyAll();
      await this.loadAndSchedule();
      this.startReminderChecker();
      console.warn('[Life Cron] 스케줄 리로드 완료');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Life Cron] 리로드 실패:', msg);
    } finally {
      this.reloading = false;
      if (this.reloadQueued) {
        this.reloadQueued = false;
        await this.executeReload();
      }
    }
  }

  private async loadAndSchedule(): Promise<void> {
    const settings = await queryNotificationSettings();
    const timezone = 'Asia/Seoul';
    const registered: string[] = [];

    for (const setting of settings) {
      if (!setting.active) continue;

      const taskFn = SLOT_TASKS[setting.slot_name];
      if (!taskFn) continue;

      const cronExpr = timeToCron(setting.time_value);
      const task = cron.schedule(cronExpr, wrapTask(taskFn, this.app, this.config, setting.label), {
        timezone,
      });

      // 안전장치: 기존 task가 있으면 먼저 정지 (좀비 방지)
      const existing = this.tasks.get(setting.slot_name);
      if (existing) existing.stop();

      this.tasks.set(setting.slot_name, task);
      registered.push(`${setting.label}(${setting.time_value})`);
    }

    console.warn(`[Life Cron] 알림 스케줄 등록: ${registered.join(', ')}`);
  }

  private startReminderChecker(): void {
    const task = cron.schedule(
      '* * * * *',
      async () => {
        try {
          const currentTime = getKSTTimeString();

          // 캐시 갱신: 30분마다 또는 최초
          const now = Date.now();
          if (now - this.reminderCacheUpdatedAt > 30 * 60 * 1000) {
            await this.refreshReminderCache();
          }

          // 현재 시각에 리마인더가 없으면 DB 쿼리 스킵
          if (!this.reminderTimesCache.has(currentTime)) return;

          await this.checkDueReminders(currentTime);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('[Life Cron] 리마인더 체크 오류:', msg);
        }
      },
      { timezone: 'Asia/Seoul' },
    );

    // 안전장치: 기존 리마인더 체커가 있으면 먼저 정지
    const existing = this.tasks.get('_reminderChecker');
    if (existing) existing.stop();

    this.tasks.set('_reminderChecker', task);
  }

  private async refreshReminderCache(): Promise<void> {
    this.reminderTimesCache = await queryActiveReminderTimes();
    this.reminderCacheUpdatedAt = Date.now();
    console.warn(`[Life Cron] 리마인더 캐시 갱신: ${this.reminderTimesCache.size}개 시간대`);
  }

  private async checkDueReminders(currentTime?: string): Promise<void> {
    const today = getTodayISO();
    const time = currentTime ?? getKSTTimeString();
    const dow = getKSTDayOfWeek();

    const reminders = await queryDueReminders(today, time, dow);

    for (const reminder of reminders) {
      await postToChannel(this.app.client, this.config.channelId, `리마인더: ${reminder.title}`);

      // 일회성(date 지정) → 자동 비활성화
      if (reminder.date) {
        await deactivateReminder(reminder.id);
        this.reminderCacheUpdatedAt = 0; // 캐시 무효화
        console.warn(`[Life Cron] 일회성 리마인더 비활성화: ${reminder.title}`);
        continue;
      }

      // remaining_count 차감 → 0이면 비활성화
      if (reminder.remaining_count != null && reminder.remaining_count > 0) {
        const deactivated = await decrementReminderCount(reminder.id);
        if (deactivated) {
          this.reminderCacheUpdatedAt = 0; // 캐시 무효화
          console.warn(`[Life Cron] 횟수 소진 리마인더 비활성화: ${reminder.title}`);
          continue;
        }
      }

      // end_date 도달 → 비활성화
      if (reminder.end_date && today >= reminder.end_date) {
        await deactivateReminder(reminder.id);
        this.reminderCacheUpdatedAt = 0; // 캐시 무효화
        console.warn(`[Life Cron] 기간 만료 리마인더 비활성화: ${reminder.title}`);
      }
    }

    if (reminders.length > 0) {
      console.warn(`[Life Cron] 리마인더 ${reminders.length}건 전송 (${time})`);
    }
  }

  private destroyAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }
}
