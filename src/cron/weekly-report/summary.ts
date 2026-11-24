import type { LifeCronConfig } from '../life/types.js';
import type { LLMMessage } from '../../shared/llm.js';
import type { Insight } from '../../shared/insights/types.js';
import { CHARACTER_PROMPT } from '../../shared/personality.js';
import type { WeeklyReportData } from './types.js';

// ─── LLM 한줄 총평 ─────────────────────────────────────

export const generateWeeklySummary = async (
  llmClient: LifeCronConfig['llmClient'],
  data: WeeklyReportData,
  insights: Insight[],
): Promise<string> => {
  const { sleep, routine, schedule, correlation } = data;

  const insightContext =
    insights.length > 0
      ? `\n감지된 인사이트:\n${insights.map((i) => `- ${i.message}`).join('\n')}`
      : '';

  const context = [
    `지난주 리포트 데이터를 보고 총평을 써줘. 잘한 점은 칭찬하고, 개선할 점은 잔소리해. 반말로, 따뜻하게.`,
    `수면: 평균 ${Math.floor(sleep.avgDuration / 60)}시간 ${sleep.avgDuration % 60}분 (${sleep.recordCount}일)`,
    `루틴: ${routine.thisWeekRate}% (${routine.thisWeekCompleted}/${routine.thisWeekTotal})${routine.lastWeekRate != null ? `, 지난주 ${routine.lastWeekRate}%` : ''}`,
    `일정: 완료 ${schedule.completedCount}, 미완료 ${schedule.incompleteCount}`,
    correlation.goodSleepRate != null && correlation.badSleepRate != null
      ? `수면-루틴 상관: 7시간+ ${correlation.goodSleepRate}% vs 6시간 미만 ${correlation.badSleepRate}%`
      : '',
    insightContext,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `${CHARACTER_PROMPT}\n지난주 리포트 데이터를 보고 총평 써줘. 잘한 점 칭찬, 개선점 잔소리. 자연스러운 길이로.`,
      },
      { role: 'user', content: context },
    ];
    const response = await llmClient.chat(messages);
    return response.text ?? '지난주도 수고했어!';
  } catch {
    return '지난주도 수고했어!';
  }
};
