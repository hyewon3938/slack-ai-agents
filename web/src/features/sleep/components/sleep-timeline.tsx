'use client';

import type { SleepRecordWithEvents } from '../lib/types';

interface SleepTimelineProps {
  records: SleepRecordWithEvents[];
}

// 20:00(=0) ~ 12:00(=960) 범위를 Y축으로 매핑
const Y_START_HOUR = 20;
const Y_RANGE_MINUTES = 16 * 60; // 20:00 ~ 12:00 = 16시간 = 960분

function timeToY(time: string): number {
  const [h, m] = time.split(':').map(Number);
  let minutesFromStart = (h * 60 + (m ?? 0)) - (Y_START_HOUR * 60);
  if (minutesFromStart < 0) minutesFromStart += 1440;
  return minutesFromStart;
}

function yToRatio(y: number): number {
  return Math.max(0, Math.min(1, y / Y_RANGE_MINUTES));
}

const Y_LABELS = ['20', '22', '0', '2', '4', '6', '8', '10', '12'];
const Y_LABEL_MINUTES = [0, 120, 240, 360, 480, 600, 720, 840, 960];

export function SleepTimeline({ records }: SleepTimelineProps) {
  const validRecords = records.filter((r) => r.bedtime && r.wake_time);

  if (validRecords.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">수면 타임라인</h3>
        <p className="py-8 text-center text-sm text-gray-400">기간 내 수면 기록이 없어</p>
      </div>
    );
  }

  const chartHeight = 280;
  const labelWidth = 28;
  const barGap = 2;
  const barWidth = Math.max(8, Math.min(24, (320 - labelWidth) / validRecords.length - barGap));
  const chartWidth = labelWidth + validRecords.length * (barWidth + barGap) + 8;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">수면 타임라인</h3>
      <div className="overflow-x-auto">
        <svg
          width={Math.max(chartWidth, 300)}
          height={chartHeight + 36}
          className="text-xs"
        >
          {/* Y축 라벨 + 그리드 */}
          {Y_LABELS.map((label, i) => {
            const y = ((Y_LABEL_MINUTES[i] ?? 0) / Y_RANGE_MINUTES) * chartHeight;
            return (
              <g key={label}>
                <text x={labelWidth - 4} y={y + 4} textAnchor="end" className="fill-gray-400 text-[10px]">
                  {label}
                </text>
                <line
                  x1={labelWidth} y1={y} x2={chartWidth} y2={y}
                  stroke="#f3f4f6" strokeWidth={1}
                />
              </g>
            );
          })}

          {/* 바 */}
          {validRecords.map((r, i) => {
            const x = labelWidth + i * (barWidth + barGap);
            const bedY = yToRatio(timeToY(r.bedtime!)) * chartHeight;
            const wakeY = yToRatio(timeToY(r.wake_time!)) * chartHeight;
            const barHeight = Math.max(4, wakeY - bedY);
            const dateLabel = r.date.slice(5);

            return (
              <g key={r.id}>
                <rect
                  x={x} y={bedY} width={barWidth} height={barHeight}
                  rx={3} fill="#818cf8" opacity={0.8}
                />
                {r.events.map((e) => {
                  const ey = yToRatio(timeToY(e.event_time)) * chartHeight;
                  return (
                    <circle
                      key={e.id}
                      cx={x + barWidth / 2} cy={ey}
                      r={2.5} fill="#ef4444"
                    />
                  );
                })}
                <text
                  x={x + barWidth / 2} y={chartHeight + 14}
                  textAnchor="middle" className="fill-gray-400 text-[9px]"
                >
                  {dateLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-400" /> 수면
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> 중간 기상
        </span>
      </div>
    </div>
  );
}
