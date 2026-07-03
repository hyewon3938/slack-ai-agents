import { getDayPillar } from '@/lib/saju';

interface SajuPillarLabelProps {
  dateStr: string;
  /** 오늘이면 파란색 강조 */
  today?: boolean;
  /** 이번 달이 아닌 날(월간 뷰의 이전/다음 달 흐림 처리) */
  dimmed?: boolean;
  /** 월간 뷰용 소형 표기: 더 작은 글씨 + 한 줄 고정(좁은 셀에서도 높이 예측 가능) */
  compact?: boolean;
  /** 정렬 — 기본 center(주/일 뷰), start(월 뷰 날짜 셀) */
  align?: 'center' | 'start';
  className?: string;
}

/**
 * 사주 일주(천간+지지) 라벨. 한자 + 한글 병기.
 * 월/주/일 캘린더 뷰의 날짜 셀에서 공용 (계산: lib/saju.ts getDayPillar).
 */
export function SajuPillarLabel({
  dateStr,
  today = false,
  dimmed = false,
  compact = false,
  align = 'center',
  className = '',
}: SajuPillarLabelProps) {
  const pillar = getDayPillar(dateStr);
  const color = today ? 'text-blue-600' : dimmed ? 'text-gray-300' : 'text-gray-500';
  return (
    <div
      className={`flex items-baseline gap-x-1 leading-tight ${color} ${
        align === 'center' ? 'justify-center' : 'justify-start'
      } ${
        compact
          ? 'flex-nowrap overflow-hidden whitespace-nowrap text-[9px] sm:text-[10px]'
          : 'flex-wrap text-[11px]'
      } ${className}`}
    >
      <span className="font-medium">{pillar.hanja}</span>
      <span>{pillar.hangul}</span>
    </div>
  );
}
