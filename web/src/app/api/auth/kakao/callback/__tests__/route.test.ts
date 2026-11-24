import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/kakao', () => ({
  exchangeCodeForToken: vi.fn(),
  fetchKakaoUserInfo: vi.fn(),
}));

vi.mock('@/lib/users', () => ({
  findOrCreateUser: vi.fn(),
}));

import { getSession } from '@/lib/auth';
import { exchangeCodeForToken, fetchKakaoUserInfo } from '@/lib/kakao';
import { findOrCreateUser } from '@/lib/users';
import type { KakaoUserInfo } from '@/lib/kakao';
import type { UserRow } from '@/lib/users';
import { GET } from '../route';

const ORIGIN = 'http://localhost';
const STATE = 'state-abc';

interface FakeSession {
  userId?: number;
  nickname?: string;
  oauthState?: string;
  save: ReturnType<typeof vi.fn>;
}

let session: FakeSession;

// 합성 픽스처 (실제 사용자 데이터 아님)
const KAKAO_USER: KakaoUserInfo = {
  kakaoId: 100,
  nickname: '카카오닉',
  email: null,
  gender: null,
  birthday: null,
  ageRange: null,
  profileImage: null,
};

const USER_ROW: UserRow = {
  id: 5,
  kakao_id: '100',
  nickname: '테스트',
  email: null,
  gender: null,
  birthday: null,
  age_range: null,
  profile_image: null,
  created_at: '2026-01-01T00:00:00Z',
};

const callback = (query: string): Request =>
  new Request(`${ORIGIN}/api/auth/kakao/callback?${query}`);

const redirectTarget = (res: Response): string => {
  const location = res.headers.get('location');
  if (!location) throw new Error('location 헤더 없음');
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  session = { oauthState: STATE, save: vi.fn().mockResolvedValue(undefined) };
  // route가 쓰는 필드와 save만 가진 가짜 세션
  vi.mocked(getSession).mockResolvedValue(
    session as unknown as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(exchangeCodeForToken).mockResolvedValue('access-token');
  vi.mocked(fetchKakaoUserInfo).mockResolvedValue(KAKAO_USER);
  vi.mocked(findOrCreateUser).mockResolvedValue(USER_ROW);
});

describe('GET /api/auth/kakao/callback', () => {
  it('카카오가 error를 돌려주면 로그인으로 이동하고 토큰을 교환하지 않는다', async () => {
    const res = await GET(callback('error=access_denied&state=state-abc'));

    expect(redirectTarget(res)).toBe('/login');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it.each([
    ['code가 없으면', 'state=state-abc'],
    ['state가 없으면', 'code=c1'],
  ])('%s invalid_request로 이동한다', async (_label, query) => {
    const res = await GET(callback(query));

    expect(redirectTarget(res)).toBe('/login?error=invalid_request');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('state가 세션에 저장된 값과 다르면 invalid_state로 이동하고 토큰을 교환하지 않는다', async () => {
    const res = await GET(callback('code=c1&state=other-state'));

    expect(redirectTarget(res)).toBe('/login?error=invalid_state');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
  });

  it('세션에 저장된 state가 없으면 invalid_state로 이동한다', async () => {
    session.oauthState = undefined;

    const res = await GET(callback('code=c1&state=state-abc'));

    expect(redirectTarget(res)).toBe('/login?error=invalid_state');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('성공하면 저장된 state를 지우고 userId를 세션에 저장한 뒤 일정 화면으로 이동한다', async () => {
    const res = await GET(callback('code=c1&state=state-abc'));

    expect(fetchKakaoUserInfo).toHaveBeenCalledWith('access-token');
    expect(findOrCreateUser).toHaveBeenCalledWith(KAKAO_USER);
    expect(exchangeCodeForToken).toHaveBeenCalledWith('c1', `${ORIGIN}/api/auth/kakao/callback`);
    expect(session.oauthState).toBeUndefined();
    expect(session.userId).toBe(5);
    expect(session.nickname).toBe('테스트');
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(redirectTarget(res)).toBe('/schedules');
  });

  it('유저 닉네임이 없으면 기본 닉네임을 저장한다', async () => {
    vi.mocked(findOrCreateUser).mockResolvedValue({ ...USER_ROW, nickname: null });

    await GET(callback('code=c1&state=state-abc'));

    expect(session.nickname).toBe('사용자');
  });

  it('가입 상한에 걸리면 max_users로 이동하고 세션을 저장하지 않는다', async () => {
    vi.mocked(findOrCreateUser).mockRejectedValue(new Error('MAX_USERS_REACHED'));

    const res = await GET(callback('code=c1&state=state-abc'));

    expect(redirectTarget(res)).toBe('/login?error=max_users');
    expect(session.save).not.toHaveBeenCalled();
  });

  it('토큰 교환이 실패하면 auth_failed로 이동하고 세션을 저장하지 않는다', async () => {
    vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error('token exchange failed'));

    const res = await GET(callback('code=c1&state=state-abc'));

    expect(redirectTarget(res)).toBe('/login?error=auth_failed');
    expect(session.save).not.toHaveBeenCalled();
  });
});
