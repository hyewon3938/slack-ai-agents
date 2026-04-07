interface SectionHeaderProps {
  title: string;
  /** 우측 액션 영역 (버튼 등) */
  children?: React.ReactNode;
}

/** 섹션 타이틀 + 우측 액션 레이아웃 */
export function SectionHeader({ title, children }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}
