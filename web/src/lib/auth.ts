import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  authenticated: boolean;
}

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET ?? 'fallback-secret-must-be-32-chars-long!!',
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
