/** 카카오 OAuth 설정 + 유틸리티 */

const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID ?? '';
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET;

const MAX_USERS = 5;

export const getKakaoAuthUrl = (redirectUri: string, state: string): string => {
  const params = new URLSearchParams({
    client_id: KAKAO_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `https://kauth.kakao.com/oauth/authorize?${params}`;
};

interface KakaoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export const exchangeCodeForToken = async (
  code: string,
  redirectUri: string,
): Promise<string> => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KAKAO_CLIENT_ID,
    redirect_uri: redirectUri,
    code,
  });
  if (KAKAO_CLIENT_SECRET) {
    body.set('client_secret', KAKAO_CLIENT_SECRET);
  }

  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`카카오 토큰 교환 실패: ${err}`);
  }

  const data = (await res.json()) as KakaoTokenResponse;
  return data.access_token;
};

interface KakaoProfile {
  id: number;
  properties?: {
    nickname?: string;
    profile_image?: string;
  };
  kakao_account?: {
    email?: string;
    gender?: string;
    birthday?: string;
    age_range?: string;
  };
}

export interface KakaoUserInfo {
  kakaoId: number;
  nickname: string | null;
  email: string | null;
  gender: string | null;
  birthday: string | null;
  ageRange: string | null;
  profileImage: string | null;
}

export const fetchKakaoUserInfo = async (accessToken: string): Promise<KakaoUserInfo> => {
  const res = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error('카카오 유저 정보 조회 실패');
  }

  const data = (await res.json()) as KakaoProfile;
  return {
    kakaoId: data.id,
    nickname: data.properties?.nickname ?? null,
    email: data.kakao_account?.email ?? null,
    gender: data.kakao_account?.gender ?? null,
    birthday: data.kakao_account?.birthday ?? null,
    ageRange: data.kakao_account?.age_range ?? null,
    profileImage: data.properties?.profile_image ?? null,
  };
};

export { MAX_USERS };
