import { randomBytes } from 'node:crypto';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  authenticated: boolean;
}

// iron-session은 32자 이상 필요. 미설정이거나 짧으면 자동 생성 (재시작 시 세션 무효화됨)
const envSecret = process.env.SESSION_SECRET;
const isValidSecret = envSecret && envSecret.length >= 32;
if (!isValidSecret) {
  console.warn('[auth] SESSION_SECRET 미설정 또는 32자 미만 — 임시 시크릿 생성 (서버 재시작 시 세션 무효화)');
}
const secret = isValidSecret ? envSecret : randomBytes(32).toString('hex');

const SESSION_OPTIONS = {
  password: secret,
  cookieName: 'life-dashboard-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export const getSession = async () => {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
};

export const requireAuth = async (): Promise<boolean> => {
  const session = await getSession();
  return session.authenticated === true;
};
