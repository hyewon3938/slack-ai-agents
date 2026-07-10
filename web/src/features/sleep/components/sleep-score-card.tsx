'use client';

import type { SleepScores } from '../lib/types';
import { InfoButton, scoreColor } from './sleep-summary-cards';

interface SleepScoreCardProps {
  scores: SleepScores | null;
}

interface AxisDef {
  key: 'duration' | 'regularity' | 'continuity' | 'timing';
  label: string;
  description: string;
}

/** 축 설명 — 계산 근거는 lib/scores.ts + sleep-score-config.ts */
const AXES: AxisDef[] = [
  {
    key: 'duration',
    label: '시간',
    description: '하루 총 수면이 7~9시간 구간에 들면 100점, 벗어난 만큼 감점해.',
  },
  {
    key: 'regularity',
    label: '규칙성',
    description: '취침·기상 시각이 날마다 일정할수록 높아. 표본이 2일 미만이면 계산하지 않아.',
  },
  {
    key: 'continuity',
    label: '연속성',
    description: '밤잠이 끊기지 않을수록 높아. 중간 기상·수면 분절 횟수만큼 감점해.',
  },
  {
    key: 'timing',
    label: '타이밍',
    description: '자정 전에 잠들면 100점, 취침이 늦어진 만큼 감점해.',
  },
];

const GAUGE_ARC = 'M 10 60 A 50 50 0 0 1 110 60';

/** 종합점수 반원 게이지 (인라인 SVG) */
function ScoreGauge({ total }: { total: number }) {
  return (
    <svg viewBox="0 0 120 72" className="w-40" role="img" aria-label={`종합 수면 점수 ${total}점`}>
      <path d={GAUGE_ARC} fill="none" stroke="#f3f4f6" strokeWidth={9} strokeLinecap="round" />
      {total > 0 && (
        <path
          d={GAUGE_ARC}
          fill="none"
          stroke="currentColor"
          strokeWidth={9}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${total} 100`}
          className={scoreColor(total)}
        />
      )}
      <text
        x={60}
        y={54}
        textAnchor="middle"
        className={`fill-current text-[26px] font-bold ${scoreColor(total)}`}
      >
        {total}
      </text>
      <text x={60} y={69} textAnchor="middle" className="fill-gray-400 text-[9px]">
        종합 점수
      </text>
    </svg>
  );
}

function AxisRow({ axis, value }: { axis: AxisDef; value: number | null }) {
  const rounded = value === null ? null : Math.round(value);
  const content = (
    <div className="text-xs leading-relaxed">
      <p className="mb-1 font-semibold text-gray-700">{axis.label} 점수</p>
      <p className="text-gray-600">{axis.description}</p>
    </div>
  );
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex w-16 shrink-0 items-center gap-1 text-xs ${
          rounded === null ? 'text-gray-300' : 'text-gray-500'
        }`}
      >
        {axis.label}
        <InfoButton content={content} ariaLabel={`${axis.label} 점수 설명`} />
      </div>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
        {rounded !== null && (
          <div className="h-full rounded-full bg-indigo-400" style={{ width: `${rounded}%` }} />
        )}
      </div>
      {rounded === null ? (
        <span className="w-14 shrink-0 text-right text-[10px] text-gray-400">표본 부족</span>
      ) : (
        <span className={`w-14 shrink-0 text-right text-sm font-bold ${scoreColor(rounded)}`}>
          {rounded}
        </span>
      )}
    </div>
  );
}

export function SleepScoreCard({ scores }: SleepScoreCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">수면 점수</h3>
      {scores === null ? (
        <p className="py-8 text-center text-sm text-gray-400">이 기간에 밤잠 데이터가 없어</p>
      ) : (
        <div className="flex flex-col items-center gap-5 md:flex-row md:gap-10">
          <div className="shrink-0">
            <ScoreGauge total={scores.total} />
          </div>
          <div className="w-full min-w-0 flex-1 space-y-3">
            {AXES.map((axis) => (
              <AxisRow key={axis.key} axis={axis} value={scores[axis.key]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
