interface PageContentProps {
  children: React.ReactNode;
  /** 콘텐츠 최대 너비. default: 'max-w-5xl' */
  maxWidth?: string;
  className?: string;
}

/** 탭 아래 콘텐츠 영역 공통 래퍼 */
export function PageContent({ children, maxWidth = 'max-w-5xl', className = '' }: PageContentProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`mx-auto ${maxWidth} px-4 py-4 md:py-6 ${className}`}>
        {children}
      </div>
    </div>
  );
}
