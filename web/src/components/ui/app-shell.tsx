'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/schedules', label: '일정', icon: '📅' },
  { href: '/backlog', label: '백로그', icon: '📋' },
  { href: '/categories', label: '카테고리', icon: '🏷' },
] as const;

/** 모바일 더보기 메뉴 항목 (하단 탭에 없는 페이지들) */
const MOBILE_MORE_ITEMS = [
  { href: '/categories', label: '카테고리 관리', icon: '🏷' },
  // 확장 예정:
  // { href: '/sleep', label: '수면 기록', icon: '🌙' },
  // { href: '/analytics', label: '분석', icon: '📊' },
] as const;

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

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 데스크탑 상단 네비 */}
      <header className="hidden border-b border-gray-200 bg-white md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <nav className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  pathname === item.href
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* 데스크탑: 로그아웃만 */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
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
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
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
          <a
            href="/schedules"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              pathname === '/schedules' ? 'text-blue-600' : 'text-gray-400'
            }`}
          >
            <span className="text-lg">📅</span>
            <span>일정</span>
          </a>
          <a
            href="/backlog"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              pathname === '/backlog' ? 'text-blue-600' : 'text-gray-400'
            }`}
          >
            <span className="text-lg">📋</span>
            <span>백로그</span>
          </a>

          {/* 모바일 더보기 */}
          <div className="relative flex flex-1" ref={mobileMenuRef}>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                mobileMenuOpen || pathname === '/categories' ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">⋯</span>
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
                    <span>{item.icon}</span>
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
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
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
