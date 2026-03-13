import { query, queryOne } from '@/lib/db';
import type { KakaoUserInfo } from '@/lib/kakao';
import { MAX_USERS } from '@/lib/kakao';

export interface UserRow {
  id: number;
  kakao_id: string; // BIGINT → string in JS
  nickname: string | null;
  email: string | null;
  gender: string | null;
  birthday: string | null;
  age_range: string | null;
  profile_image: string | null;
  created_at: string;
}

/** kakao_id로 유저 조회. 없으면 null */
export const findUserByKakaoId = async (kakaoId: number): Promise<UserRow | null> =>
  queryOne<UserRow>('SELECT * FROM users WHERE kakao_id = $1', [kakaoId]);

/** 유저 수 확인 */
export const getUserCount = async (): Promise<number> => {
  const result = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM users');
  return Number(result?.count ?? 0);
};

/** 카카오 유저 정보로 유저 조회 또는 생성 */
export const findOrCreateUser = async (info: KakaoUserInfo): Promise<UserRow> => {
  // 기존 유저 조회
  const existing = await findUserByKakaoId(info.kakaoId);
  if (existing) {
    // 닉네임 업데이트 (카카오에서 변경했을 수 있음)
    if (info.nickname && info.nickname !== existing.nickname) {
      await query('UPDATE users SET nickname = $1 WHERE id = $2', [info.nickname, existing.id]);
      existing.nickname = info.nickname;
    }
    return existing;
  }

  // 가입 제한 확인
  const count = await getUserCount();
  if (count >= MAX_USERS) {
    throw new Error('MAX_USERS_REACHED');
  }

  // 신규 유저 생성
  const result = await query<UserRow>(
    `INSERT INTO users (kakao_id, nickname, email, gender, birthday, age_range, profile_image)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      info.kakaoId,
      info.nickname,
      info.email,
      info.gender,
      info.birthday,
      info.ageRange,
      info.profileImage,
    ],
  );

  const user = result.rows[0];
  if (!user) throw new Error('유저 생성 실패');
  return user;
};
