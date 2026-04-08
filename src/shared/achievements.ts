/**
 * 오늘 해낸 일 선정 로직 (규칙 기반, 현재 미사용).
 *
 * 현재 이 기능은 Scheduled Task(nightly-achievements)가 Opus로 처리 중.
 * Claude 구독 종료 등으로 Scheduled Task를 못 쓰게 되면,
 * life-cron.ts의 insightNightTask에서 이 모듈을 import하여
 * API 기반(Sonnet)으로 전환할 수 있도록 남겨둔 코드.
 *
 * 사용법: PR #184의 insightNightTask 변경 참고 (git log).
 */

import type { ScheduleRow, RoutineRecordRow } from './life-queries.js';

export interface Achievement {
  label: string;    // 카테고리 또는 "루틴"
  content: string;  // 표시할 내용
  priority: number; // 정렬용 (낮을수록 높은 우선순위)
}

/** 카테고리별 우선순위 (낮을수록 높은 우선순위) */
const CATEGORY_PRIORITY: Record<string, number> = {
  '이직': 1,
  '사업': 2,
  '리커밋 에이전트': 2,
  '택배 자동 발송 시스템': 2,
  '매출 분석 자동화 시스템': 2,
  '프로젝트': 3,
  '라이프 에이전트': 3,
  '개인': 4,
  '아이디어': 5,
};

/** 매칭 안 되는 카테고리는 "개인" 수준으로 처리 */
const DEFAULT_PRIORITY = 4;

/** 루틴 우선순위 — 프로젝트/라이프에이전트와 동급 */
const ROUTINE_PRIORITY = 3;

/** 루틴 포함 최소 달성률 기준 (%) */
const ROUTINE_INCLUDE_THRESHOLD = 90;

/**
 * 오늘 해낸 일 최대 3가지를 선정한다.
 *
 * 선정 기준:
 * 1) 완료 일정을 카테고리 우선순위로 정렬 — 같은 카테고리는 하나로 묶음
 * 2) 루틴 달성률 90% 이상이면 후보에 추가
 * 3) 전체 후보를 우선순위로 재정렬 → 상위 3개 반환
 */
export function selectAchievements(
  doneSchedules: ScheduleRow[],
  routineRecords: RoutineRecordRow[],
): Achievement[] {
  // ── 일정 기반 후보: 같은 카테고리는 묶음 ──
  const byCategory = new Map<string, ScheduleRow[]>();
  for (const s of doneSchedules) {
    const cat = s.category ?? '기타';
    const list = byCategory.get(cat) ?? [];
    list.push(s);
    byCategory.set(cat, list);
  }

  const scheduleAchievements: Achievement[] = [];
  for (const [cat, schedules] of byCategory) {
    const priority = CATEGORY_PRIORITY[cat] ?? DEFAULT_PRIORITY;
    const content =
      schedules.length === 1
        ? schedules[0].title
        : `${schedules[0].title} 외 ${schedules.length - 1}건`;
    scheduleAchievements.push({ label: cat, content, priority });
  }

  scheduleAchievements.sort((a, b) => a.priority - b.priority);

  // ── 루틴 후보: 90% 이상일 때만 ──
  const total = routineRecords.length;
  const completed = routineRecords.filter((r) => r.completed).length;
  const routineAchievement: Achievement | null =
    total > 0 && Math.round((completed / total) * 100) >= ROUTINE_INCLUDE_THRESHOLD
      ? {
          label: '루틴',
          content: `${completed}/${total} 완료 (${Math.round((completed / total) * 100)}%)`,
          priority: ROUTINE_PRIORITY,
        }
      : null;

  // ── 전체 후보 합산 → 우선순위 정렬 → 상위 3개 ──
  const all = routineAchievement
    ? [...scheduleAchievements, routineAchievement]
    : scheduleAchievements;

  all.sort((a, b) => a.priority - b.priority);
  return all.slice(0, 3);
}

/**
 * 해낸 일 목록 + LLM 코멘트 → Slack 텍스트 생성.
 */
export function buildAchievementsMessage(
  achievements: Achievement[],
  comment: string,
): string {
  const lines = achievements.map((a, i) => `${i + 1}. *[${a.label}]* ${a.content}`);
  return `오늘 해낸 일\n\n${lines.join('\n')}\n\n${comment}`;
}
