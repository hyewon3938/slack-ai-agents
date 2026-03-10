'use client';

import { usePathname, useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/schedules', label: '캘린더', icon: '📅' },
  { href: '/backlog', label: '백로그', icon: '📋' },
  { href: '/categories', label: '카테고리', icon: '🏷' },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
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
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 pb-16 md:pb-0">{children}</main>

      {/* 모바일 하단 탭 */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white md:hidden">
        <div className="flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                pathname === item.href ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
