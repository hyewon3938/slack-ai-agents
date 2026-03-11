'use client';

import { useEffect, useState } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, children }: BottomSheetProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      const t = setTimeout(() => setAnimating(true), 50);
      return () => clearTimeout(t);
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] md:hidden">
      {/* 백드롭 */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-500 ${
          animating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      {/* 시트 */}
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl transition-transform duration-500 ease-out ${
          animating ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* 핸들 바 */}
        <div className="sticky top-0 z-10 flex justify-center rounded-t-2xl bg-white pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>
        {children}
      </div>
    </div>
  );
}
