interface SkeletonProps {
  className?: string;
}

/** 기본 스켈레톤 블록 */
export function Skeleton({ className = 'h-4 w-full' }: SkeletonProps) {
  return <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />;
}

/** 탭 바 스켈레톤 — 탭 영역 border에 붙지 않도록 pb-2 적용 */
export function TabsSkeleton({ count = 3, maxWidth = 'max-w-5xl' }: { count?: number; maxWidth?: string }) {
  return (
    <div className="border-b border-gray-200 bg-white px-4 pt-2">
      <div className={`mx-auto flex ${maxWidth} gap-1 pb-2`}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** 카드 형태 스켈레톤 */
export function CardSkeleton({ className = 'h-40' }: SkeletonProps) {
  return <Skeleton className={`rounded-xl ${className}`} />;
}

/** 리스트 스켈레톤 */
export function ListSkeleton({ rows = 5, rowHeight = 'h-14' }: { rows?: number; rowHeight?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`rounded-lg ${rowHeight}`} />
      ))}
    </div>
  );
}
