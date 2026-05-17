/**
 * 일회성: 사주 마스터 seed SQL 생성기.
 * saju-calendar의 계산 로직으로 stems/branches/ganji/sipsin/sibiunsung/relations INSERT 문 생성.
 * 결과를 db/migrations/050_saju_master_seed.sql로 출력.
 *
 * 실행: npx tsx scripts/generate-saju-master-seed.ts > db/migrations/050_saju_master_seed.sql
 */

import {
  getSipsung,
  getJijiSipsung,
  getSibiunsung,
  type Cheongan,
  type Jiji,
} from '../src/shared/saju-calendar.js';

const STEMS: readonly Cheongan[] = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const BRANCHES: readonly Jiji[] = [
  '자',
  '축',
  '인',
  '묘',
  '진',
  '사',
  '오',
  '미',
  '신',
  '유',
  '술',
  '해',
];
const STEM_ELEMENT: Record<Cheongan, string> = {
  갑: '목',
  을: '목',
  병: '화',
  정: '화',
  무: '토',
  기: '토',
  경: '금',
  신: '금',
  임: '수',
  계: '수',
};
const STEM_YINYANG: Record<Cheongan, string> = {
  갑: '양',
  을: '음',
  병: '양',
  정: '음',
  무: '양',
  기: '음',
  경: '양',
  신: '음',
  임: '양',
  계: '음',
};
const BRANCH_ELEMENT: Record<Jiji, string> = {
  자: '수',
  축: '토',
  인: '목',
  묘: '목',
  진: '토',
  사: '화',
  오: '화',
  미: '토',
  신: '금',
  유: '금',
  술: '토',
  해: '수',
};
const BRANCH_YINYANG: Record<Jiji, string> = {
  자: '양',
  축: '음',
  인: '양',
  묘: '음',
  진: '양',
  사: '음',
  오: '양',
  미: '음',
  신: '양',
  유: '음',
  술: '양',
  해: '음',
};

const lines: string[] = [];

lines.push('-- 050: 사주 60갑자 마스터 seed 데이터');
lines.push('-- 자동 생성: scripts/generate-saju-master-seed.ts');
lines.push(
  '-- 합계: stems 10 + branches 12 + ganji 60 + sipsin 220 + sibiunsung 120 + relations ~62',
);
lines.push('');

// 천간 INSERT
lines.push('-- 천간 (10행)');
for (const s of STEMS) {
  lines.push(
    `INSERT INTO stems_master (name, element, yinyang) VALUES ('${s}', '${STEM_ELEMENT[s]}', '${STEM_YINYANG[s]}') ON CONFLICT (name) DO NOTHING;`,
  );
}
lines.push('');

// 지지 INSERT
lines.push('-- 지지 (12행)');
for (const b of BRANCHES) {
  lines.push(
    `INSERT INTO branches_master (name, element, yinyang) VALUES ('${b}', '${BRANCH_ELEMENT[b]}', '${BRANCH_YINYANG[b]}') ON CONFLICT (name) DO NOTHING;`,
  );
}
lines.push('');

// 60갑자 INSERT
lines.push('-- 60갑자 (60행)');
for (let i = 0; i < 60; i++) {
  const sIdx = i % 10;
  const bIdx = i % 12;
  const stem = STEMS[sIdx];
  const branch = BRANCHES[bIdx];
  lines.push(
    `INSERT INTO ganji_master (stem_id, branch_id) SELECT s.id, b.id FROM stems_master s, branches_master b WHERE s.name='${stem}' AND b.name='${branch}' ON CONFLICT (stem_id, branch_id) DO NOTHING;`,
  );
}
lines.push('');

// 십성 lookup INSERT (10 일간 × 22 타겟)
lines.push('-- 십성 lookup (220행)');
for (const dm of STEMS) {
  for (const target of STEMS) {
    const sipsin = getSipsung(dm, target);
    lines.push(
      `INSERT INTO sipsin_lookup (day_master_stem_id, target_id, target_type, sipsin) SELECT dm.id, t.id, 'stem', '${sipsin}' FROM stems_master dm, stems_master t WHERE dm.name='${dm}' AND t.name='${target}' ON CONFLICT (day_master_stem_id, target_id, target_type) DO NOTHING;`,
    );
  }
  for (const target of BRANCHES) {
    const sipsin = getJijiSipsung(dm, target);
    lines.push(
      `INSERT INTO sipsin_lookup (day_master_stem_id, target_id, target_type, sipsin) SELECT dm.id, b.id, 'branch', '${sipsin}' FROM stems_master dm, branches_master b WHERE dm.name='${dm}' AND b.name='${target}' ON CONFLICT (day_master_stem_id, target_id, target_type) DO NOTHING;`,
    );
  }
}
lines.push('');

// 12운성 lookup INSERT (10 일간 × 12 지지 = 120행)
lines.push('-- 12운성 lookup (120행)');
for (const dm of STEMS) {
  for (const branch of BRANCHES) {
    const state = getSibiunsung(dm, branch);
    lines.push(
      `INSERT INTO sibiunsung_lookup (day_master_stem_id, branch_id, state) SELECT dm.id, b.id, '${state}' FROM stems_master dm, branches_master b WHERE dm.name='${dm}' AND b.name='${branch}' ON CONFLICT (day_master_stem_id, branch_id) DO NOTHING;`,
    );
  }
}
lines.push('');

// 지지 관계 INSERT (단방향)
lines.push('-- 지지 관계 (단방향 저장)');
const branchPairs: [Jiji, Jiji, string][] = [
  // 육합 (6쌍)
  ['자', '축', '육합'],
  ['인', '해', '육합'],
  ['묘', '술', '육합'],
  ['진', '유', '육합'],
  ['사', '신', '육합'],
  ['오', '미', '육합'],
  // 삼합 (4 × 3 = 12쌍)
  ['신', '자', '삼합'],
  ['자', '진', '삼합'],
  ['신', '진', '삼합'],
  ['해', '묘', '삼합'],
  ['묘', '미', '삼합'],
  ['해', '미', '삼합'],
  ['인', '오', '삼합'],
  ['오', '술', '삼합'],
  ['인', '술', '삼합'],
  ['사', '유', '삼합'],
  ['유', '축', '삼합'],
  ['사', '축', '삼합'],
  // 방합 (4 × 3 = 12쌍)
  ['인', '묘', '방합'],
  ['묘', '진', '방합'],
  ['인', '진', '방합'],
  ['사', '오', '방합'],
  ['오', '미', '방합'],
  ['사', '미', '방합'],
  ['신', '유', '방합'],
  ['유', '술', '방합'],
  ['신', '술', '방합'],
  ['해', '자', '방합'],
  ['자', '축', '방합'],
  ['해', '축', '방합'],
  // 충 (6쌍)
  ['자', '오', '충'],
  ['축', '미', '충'],
  ['인', '신', '충'],
  ['묘', '유', '충'],
  ['진', '술', '충'],
  ['사', '해', '충'],
  // 형 (8쌍: 삼형 인사신 + 축술미 + 자묘)
  ['인', '사', '형'],
  ['사', '신', '형'],
  ['인', '신', '형'],
  ['축', '술', '형'],
  ['술', '미', '형'],
  ['축', '미', '형'],
  ['자', '묘', '형'],
  // 파 (6쌍)
  ['자', '유', '파'],
  ['축', '진', '파'],
  ['인', '해', '파'],
  ['묘', '오', '파'],
  ['사', '신', '파'],
  ['술', '미', '파'],
  // 해 (6쌍)
  ['자', '미', '해'],
  ['축', '오', '해'],
  ['인', '사', '해'],
  ['묘', '진', '해'],
  ['신', '해', '해'],
  ['유', '술', '해'],
  // 원진 (6쌍)
  ['자', '미', '원진'],
  ['축', '오', '원진'],
  ['인', '유', '원진'],
  ['묘', '신', '원진'],
  ['진', '해', '원진'],
  ['사', '술', '원진'],
];

for (const [a, b, rel] of branchPairs) {
  lines.push(
    `INSERT INTO branch_relations (branch_a_id, branch_b_id, relation_type) SELECT ba.id, bb.id, '${rel}' FROM branches_master ba, branches_master bb WHERE ba.name='${a}' AND bb.name='${b}' ON CONFLICT (branch_a_id, branch_b_id, relation_type) DO NOTHING;`,
  );
}
lines.push('');

// 천간 관계 INSERT
lines.push('-- 천간 관계 (단방향 저장)');
const stemPairs: [Cheongan, Cheongan, string][] = [
  // 천간합 5쌍
  ['갑', '기', '합'],
  ['을', '경', '합'],
  ['병', '신', '합'],
  ['정', '임', '합'],
  ['무', '계', '합'],
  // 천간극 5쌍 (양극 — 같은 음양 간 극)
  ['갑', '무', '극'],
  ['을', '기', '극'],
  ['병', '경', '극'],
  ['정', '신', '극'],
  ['무', '임', '극'],
  ['기', '계', '극'],
];

for (const [a, b, rel] of stemPairs) {
  lines.push(
    `INSERT INTO stem_relations (stem_a_id, stem_b_id, relation_type) SELECT sa.id, sb.id, '${rel}' FROM stems_master sa, stems_master sb WHERE sa.name='${a}' AND sb.name='${b}' ON CONFLICT (stem_a_id, stem_b_id, relation_type) DO NOTHING;`,
  );
}

console.log(lines.join('\n'));
