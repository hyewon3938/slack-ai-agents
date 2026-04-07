interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** 패딩 없이 렌더링 (내부에서 직접 패딩 조절 시) */
  noPadding?: boolean;
}

/** 공통 카드 컨테이너 */
export function Card({ children, className = '', noPadding = false }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm ${noPadding ? '' : 'p-4'} ${className}`}
    >
      {children}
    </div>
  );
}
