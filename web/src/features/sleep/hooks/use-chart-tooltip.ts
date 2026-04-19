'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * 데스크톱 hover / 모바일 tap 공통 툴팁 훅.
 * - 모바일: 차트 영역 외부 tap 시 닫힘
 * - 데스크톱: mouseleave로 닫힘
 */
export function useChartTooltip<T>() {
  const [tooltip, setTooltip] = useState<T | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tooltip) return;
    const handler = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [tooltip]);

  return { tooltip, setTooltip, ref };
}
