'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  max_users: '현재 가입 인원이 가득 찼어요',
  auth_failed: '로그인에 실패했어요. 다시 시도해주세요',
  invalid_state: '잘못된 요청이에요. 다시 시도해주세요',
  invalid_request: '잘못된 요청이에요',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-bold text-gray-800">Life Dashboard</h1>
        <p className="mb-8 text-sm text-gray-500">일정 관리 대시보드</p>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {ERROR_MESSAGES[error] ?? '알 수 없는 오류가 발생했어요'}
          </p>
        )}

        <a
          href="/api/auth/kakao"
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-medium transition hover:brightness-95"
          style={{ backgroundColor: '#FEE500', color: '#000000' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M9 0.6C4.03 0.6 0 3.73 0 7.55C0 9.94 1.56 12.05 3.93 13.27L2.93 16.82C2.85 17.1 3.18 17.32 3.43 17.15L7.69 14.39C8.12 14.44 8.55 14.47 9 14.47C13.97 14.47 18 11.37 18 7.55C18 3.73 13.97 0.6 9 0.6Z"
              fill="black"
            />
          </svg>
          카카오 로그인
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
