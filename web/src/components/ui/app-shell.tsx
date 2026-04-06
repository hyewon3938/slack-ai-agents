'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarIcon,
  ArrowPathIcon,
  WalletIcon,
  ClipboardListIcon,
  TagIcon,
  EllipsisHorizontalIcon,
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
} from '@/components/ui/icons';

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/schedules', label: '일정', Icon: CalendarIcon },
  { href: '/routines', label: '루틴', Icon: ArrowPathIcon },
  { href: '/budget', label: '지출', Icon: WalletIcon },
  { href: '/backlog', label: '백로그', Icon: ClipboardListIcon },
  { href: '/categories', label: '카테고리', Icon: TagIcon },
];

/** 모바일 하단 탭 (4개) */
const MOBILE_TAB_ITEMS: NavItem[] = [
  { href: '/schedules', label: '일정', Icon: CalendarIcon },
  { href: '/routines', label: '루틴', Icon: ArrowPathIcon },
  { href: '/budget', label: '지출', Icon: WalletIcon },
];

/** 모바일 더보기 메뉴 항목 */
const MOBILE_MORE_ITEMS: NavItem[] = [
  { href: '/backlog', label: '백로그', Icon: ClipboardListIcon },
  { href: '/categories', label: '카테고리 관리', Icon: TagIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  };

  useEffect(() => {
    if (!menuOpen && !mobileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (mobileMenuOpen && mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen, mobileMenuOpen]);

  const moreActive = mobileMenuOpen || MOBILE_MORE_ITEMS.some((item) => pathname === item.href);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 데스크탑 상단 네비 */}
      <header className="hidden border-b border-gray-200 bg-white md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <nav className="flex gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <item.Icon size={16} />
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* 데스크탑: 햄버거 메뉴 */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
            >
              <Bars3Icon size={20} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-500 transition hover:bg-gray-50"
                >
                  <ArrowRightStartOnRectangleIcon size={16} />
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>

      {/* 모바일 하단 탭 */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex">
          {MOBILE_TAB_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                  isActive ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                <item.Icon size={22} />
                <span>{item.label}</span>
              </a>
            );
          })}

          {/* 모바일 더보기 */}
          <div className="relative flex flex-1" ref={mobileMenuRef}>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                moreActive ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              <EllipsisHorizontalIcon size={22} />
              <span>더보기</span>
            </button>

            {mobileMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {MOBILE_MORE_ITEMS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm ${
                      pathname === item.href ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    <item.Icon size={16} />
                    {item.label}
                  </a>
                ))}
                <div className="my-1 border-t border-gray-100" />
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-500"
                >
                  <ArrowRightStartOnRectangleIcon size={16} />
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}
