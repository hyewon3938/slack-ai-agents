/**
 * 일회성: 마스터 #434 Phase 2 — user_id=1 사주 시드 풀세트 161개 SQL 생성.
 * 결과를 db/migrations/070_saju_seed_pool.sql로 출력.
 *
 * 실행:
 *   npx tsx scripts/generate-saju-seed-pool.ts > db/migrations/070_saju_seed_pool.sql
 *
 * 본인 사주 컨텍스트 (user_id=1):
 *   일간 경금(庚) / 일지 술토(戌) / 본명 갑경경경 + 자술술술
 *
 * 십신 매핑 (경금 기준):
 *   천간: 갑(편재) 을(정재) 병(편관) 정(정관) 무(편인) 기(정인) 경(비견) 신(겁재) 임(식신) 계(상관)
 *   지지: 본기 천간 십신 매핑. 자 = 상관 (사용자 임상 정정, 식신 X)
 *
 * 풀셋 카운트 (신규 161):
 *   stem 2 (을, 신 — 나머지 8개는 기존 S1/S3/S4/S7/S8/N1/N6/N8)
 *   branch 9 (자, 축, 인, 묘, 진, 사, 미, 신, 유 — 해/술/오는 기존 N2/N5/N7)
 *   ganji 60 (전부 신규)
 *   element_density 9 (5오행 × 과다(3+)/부재(0) 10 - S5_토_과다 = 9)
 *   sibiunsung 11 (12운성 - S6에 포함된 묘 = 11)
 *   relation 70 (지지 61 + 천간 11 - N3 진술충 - S2 사술원진 = 70)
 *
 * 풀셋 시드는 매트릭 없이 등록 (evidence-only) — pattern_matches.matched=NULL,
 * verify_status='no_metric'. 60+일 evidence 누적 후 Phase 6 LLM 매트릭 제안 슬롯
 * 가설 후보 풀로 활용.
 */

const dq = (s: string): string => `$desc$${s}$desc$`;

// 본인 일간 기준 천간 십신 매핑
const STEM_SIPSIN: Record<string, string> = {
  갑: '편재',
  을: '정재',
  병: '편관',
  정: '정관',
  무: '편인',
  기: '정인',
  경: '비견',
  신: '겁재',
  임: '식신',
  계: '상관',
};

// 본인 일간 기준 지지 십신 매핑 (사용자 임상 — 자=상관 정정)
const BRANCH_SIPSIN: Record<string, string> = {
  자: '상관',
  축: '정인',
  인: '편재',
  묘: '정재',
  진: '편인',
  사: '편관',
  오: '정관',
  미: '정인',
  신: '비견',
  유: '겁재',
  술: '편인',
  해: '식신',
};

// 본인 일지 + 본명 컨텍스트
const NATAL_DAY_BRANCH = '술';
const NATAL_DAY_STEM = '경';
const NATAL_BRANCHES = ['자', '술', '술', '술'];
const NATAL_STEMS = ['갑', '경', '경', '경'];

// 천간 description (사용자 임상 반영)
const STEM_DESC: Record<string, string> = {
  갑: '갑목 천간 발현일 — 편재(재물 활성, 충동 지출·투자 명목 지출 주의, 일을 많이 벌이는 경향: 일정 폭주·대청소·다 떠오름)',
  을: '을목 천간 발현일 — 정재(안정적 재물 관리, 계획적 소비, 꾸준한 일정 진행)',
  병: '병화 천간 발현일 — 편관(양화 편관, 외부 압박·도전 증가, 추진력)',
  정: '정화 천간 발현일 — 정관(책임·이직·세금·공식 일정 처리)',
  무: '무토 천간 발현일 — 편인(분석·영화·깊은 사유, 본인 일지 술토와 동기 자기 일치)',
  기: '기토 천간 발현일 — 정인(낮잠·휴식·평온·따뜻한 안정)',
  경: '경금 천간 발현일 — 비견(자신감·완료율 상승, 본인 일간 비화, 자기 동일성 강화)',
  신: '신금 천간 발현일 — 겁재(경쟁심·과시·이성 관심)',
  임: '임수 천간 발현일 — 식신(요리·창작·대화·먹기 활성)',
  계: '계수 천간 발현일 — 상관(배달·루틴 저하·일정 미루기·관성 충돌)',
};

// 지지 description (사용자 임상 반영)
const BRANCH_DESC: Record<string, string> = {
  자: '자수 지지 발현일 — 상관(충동적 식사·배달·과식, 다 뒤집어 엎기·전면 개편, 관성 충돌)',
  축: '축토 지지 발현일 — 정인(차분한 휴식·내면 안정·잔잔한 회복)',
  인: '인목 지지 발현일 — 편재(새로운 시작·역동, 재물 활성)',
  묘: '묘목 지지 발현일 — 정재(꾸준한 노력·계획적 진행)',
  진: '진토 지지 발현일 — 편인(침묵·내면 침잠·과거 기억, 본인 일지 술 충 동반 가능성)',
  사: '사화 지지 발현일 — 편관(추진·도전 + 신체 증상: 대상포진·피부 트러블·탈진. 사술원진/오행 쏠림 동반 시 강화 — 분리 검증 필요)',
  오: '오화 지지 발현일 — 정관(공식 일정·세금·이직 처리)',
  미: '미토 지지 발현일 — 정인(부드러운 휴식·따뜻한 분위기)',
  신: '신금 지지 발현일 — 비견(자기 동질감·동기 영역, 비견 충돌 가능)',
  유: '유금 지지 발현일 — 겁재(경쟁·과시·이성 관심)',
  술: '술토 지지 발현일 — 편인(본인 일지 비화, 깊은 몰입·철학적 사고·영화·책 깊게 봄)',
  해: '해수 지지 발현일 — 식신(요리·창작 활성)',
};

// element_density 풀셋 description
const ELEMENT_OVER_DESC: Record<string, string> = {
  목: '목 오행 과다일 (10자 중 3+) — 재다신약(편재·정재 폭주, 일간 약화)',
  화: '화 오행 과다일 (10자 중 3+) — 화극금(본인 일간 경금 피해, 신체적 피로·발열·피부 트러블)',
  금: '금 오행 과다일 (10자 중 3+) — 비견·겁재 폭주, 자기주장·고집',
  수: '수 오행 과다일 (10자 중 3+) — 식상 폭주, 식사·창작·말 많음',
};
const ELEMENT_LACK_DESC: Record<string, string> = {
  목: '목 오행 부재일 (10자 중 0) — 편재·정재 결핍, 동력 부족',
  화: '화 오행 부재일 (10자 중 0) — 관성 결핍, 책임 회피 경향',
  토: '토 오행 부재일 (10자 중 0) — 인성 결핍, 의지처 부족',
  금: '금 오행 부재일 (10자 중 0) — 일간 동기 결핍, 자신감 저하',
  수: '수 오행 부재일 (10자 중 0) — 식상 결핍, 표현·먹기 저하',
};

// sibiunsung 12운성 description
const SIBIUNSUNG_DESC: Record<string, string> = {
  장생: '장생일 — 새로운 시작·기획·신선한 에너지',
  목욕: '목욕일 — 변화·정리·기분 전환',
  관대: '관대일 — 성숙·책임감 강화',
  건록: '건록일 — 활력·열정·업무 폭주·운동 잘됨',
  제왕: '제왕일 — 최고 활력·자기 주장 강화',
  쇠: '쇠일 — 활력 저하·정리 단계',
  병: '병일 — 컨디션 저하·신체 증상 주의',
  사: '사일 — 단절 + 체력 저하·몸 무거움·지침',
  절: '절일 — 단절·새 출발 직전 침잠',
  태: '태일 — 잠재·내부 성장 단계',
  양: '양일 — 부드러운 회복·따뜻함',
};

const STEMS_ORDER = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const BRANCHES_ORDER = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];

// 60갑자 — 갑자/을축/병인/정묘/.../계해 — 천간(10) 순회하며 지지(12)와 cyclic 매칭
const ganjiList = (): Array<{ stem: string; branch: string }> => {
  const result: Array<{ stem: string; branch: string }> = [];
  const branchesByCycle = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
  for (let i = 0; i < 60; i++) {
    result.push({ stem: STEMS_ORDER[i % 10], branch: branchesByCycle[i % 12] });
  }
  return result;
};

// 기존 시드 이름 (충돌 방지 + 제외 처리)
const EXISTING_STEMS = new Set(['갑', '계', '기', '경', '무', '임', '정', '병']);
const EXISTING_BRANCHES = new Set(['해', '술', '오']);

// SQL 출력
const out: string[] = [];
out.push('-- 070: 마스터 #434 Phase 2 — 사주 시드 풀세트 161개 INSERT');
out.push('-- 자동 생성: scripts/generate-saju-seed-pool.ts');
out.push('-- 풀셋은 매트릭 없이 등록 (evidence-only). pattern_matches.matched=NULL,');
out.push("-- verify_status='no_metric'. 60+일 evidence 누적 → Phase 6 LLM 매트릭 제안 슬롯");
out.push('-- 가설 후보 풀로 활용 (ADR-0027).');
out.push('--');
out.push('-- 본인 컨텍스트 (user_id=1): 일간 경금 / 일지 술토 / 본명 갑경경경 자술술술');
out.push('-- 자수 십신 정정: 자 = 상관 (사용자 임상, 식신 X)');
out.push('');
out.push('BEGIN;');
out.push('');

// ── 1) STEM 풀셋 (신규 2개: 을, 신) ───────────────────────
out.push('-- ── 1) STEM 풀셋 (신규 2개: 을 정재, 신 겁재) ──');
for (const stem of STEMS_ORDER) {
  if (EXISTING_STEMS.has(stem)) continue;
  const sipsin = STEM_SIPSIN[stem];
  const desc = STEM_DESC[stem];
  out.push('DO $$');
  out.push('DECLARE t_id INTEGER;');
  out.push('BEGIN');
  out.push(`  SELECT id INTO t_id FROM stems_master WHERE name='${stem}';`);
  out.push(`  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_${stem}_천간', '${sipsin}', ${dq(desc)}, 'stem', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;`);
  out.push('END $$;');
  out.push('');
}

// ── 2) BRANCH 풀셋 단일 (신규 9개) ─────────────────────────
out.push('-- ── 2) BRANCH 풀셋 단일 (신규 9개: 자, 축, 인, 묘, 진, 사, 미, 신, 유) ──');
for (const branch of BRANCHES_ORDER) {
  if (EXISTING_BRANCHES.has(branch)) continue;
  const sipsin = BRANCH_SIPSIN[branch];
  const desc = BRANCH_DESC[branch];
  out.push('DO $$');
  out.push('DECLARE t_id INTEGER;');
  out.push('BEGIN');
  out.push(`  SELECT id INTO t_id FROM branches_master WHERE name='${branch}';`);
  out.push(`  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_${branch}_지지', '${sipsin}', ${dq(desc)}, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;`);
  out.push('END $$;');
  out.push('');
}

// ── 3) GANJI 풀셋 (신규 60개) ───────────────────────────
out.push('-- ── 3) GANJI 풀셋 (신규 60개 — 60갑자 콤보) ──');
for (const { stem, branch } of ganjiList()) {
  const stemSipsin = STEM_SIPSIN[stem];
  const branchSipsin = BRANCH_SIPSIN[branch];
  const isNatalDayJu = stem === NATAL_DAY_STEM && branch === NATAL_DAY_BRANCH;
  const isNatalBranchHwa = branch === NATAL_DAY_BRANCH;
  const isNatalStemHwa = stem === NATAL_DAY_STEM;
  let note = '';
  if (isNatalDayJu) note = ' — 본인 일주와 동일';
  else if (isNatalBranchHwa) note = ' — 본인 일지 비화';
  else if (isNatalStemHwa) note = ' — 본인 일간 비화';
  const desc = `${stem}${branch} 60갑자일 — ${stem}(${stemSipsin}) + ${branch}(${branchSipsin}) 콤보${note}`;
  out.push('DO $$');
  out.push('DECLARE t_id INTEGER;');
  out.push('BEGIN');
  out.push(`  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '${stem}' AND b.name = '${branch}';`);
  out.push(`  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_${stem}${branch}', NULL, ${dq(desc)}, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;`);
  out.push('END $$;');
  out.push('');
}

// ── 4) ELEMENT_DENSITY 풀셋 (신규 9개) ──────────────────
out.push('-- ── 4) ELEMENT_DENSITY 풀셋 (신규 9개 — 토_과다는 S5 보존) ──');
for (const element of ['목', '화', '금', '수']) {
  const desc = ELEMENT_OVER_DESC[element];
  const auxJson = JSON.stringify({ element, min_count: 3 });
  out.push(`INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_${element}_과다', NULL, ${dq(desc)}, 'element_density', NULL, '${auxJson}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;`);
  out.push('');
}
for (const element of ['목', '화', '토', '금', '수']) {
  const desc = ELEMENT_LACK_DESC[element];
  const auxJson = JSON.stringify({ element, max_count: 0 });
  out.push(`INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_${element}_부재', NULL, ${dq(desc)}, 'element_density', NULL, '${auxJson}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;`);
  out.push('');
}

// ── 5) SIBIUNSUNG 풀셋 (신규 11개 — S6에 포함된 묘 제외) ─────────
out.push('-- ── 5) SIBIUNSUNG 풀셋 (신규 11개 — S6 사·묘 통합에 포함된 묘 제외) ──');
for (const state of Object.keys(SIBIUNSUNG_DESC)) {
  if (state === '묘') continue;
  const desc = SIBIUNSUNG_DESC[state];
  const auxJson = JSON.stringify({ states: [state] });
  out.push(`INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_${state}', NULL, ${dq(desc)}, 'sibiunsung', NULL, '${auxJson}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;`);
  out.push('');
}

// ── 6) RELATION 풀셋 (신규 70개 — 지지 61 + 천간 11, 기존 N3/S2 제외) ──
out.push('-- ── 6) RELATION 풀셋 (신규 70개) ──');
out.push('-- 지지 관계 (61개) — branch_relations LOOP, 기존 N3(진술충)/S2(사술원진) 제외');
out.push(`DO $$
DECLARE rel RECORD;
  desc_text TEXT;
  aux_json JSONB;
  name_text TEXT;
  ba_sipsin TEXT;
  bb_sipsin TEXT;
  natal_member TEXT;
  is_existing BOOLEAN;
BEGIN
  FOR rel IN
    SELECT br.relation_type, ba.name AS ba_name, bb.name AS bb_name
      FROM branch_relations br
      JOIN branches_master ba ON ba.id = br.branch_a_id
      JOIN branches_master bb ON bb.id = br.branch_b_id
      ORDER BY br.id
  LOOP
    -- 기존 시드 제외 (진-술 충, 사-술 원진)
    is_existing := (rel.ba_name = '진' AND rel.bb_name = '술' AND rel.relation_type = '충')
                OR (rel.ba_name = '술' AND rel.bb_name = '진' AND rel.relation_type = '충')
                OR (rel.ba_name = '사' AND rel.bb_name = '술' AND rel.relation_type = '원진')
                OR (rel.ba_name = '술' AND rel.bb_name = '사' AND rel.relation_type = '원진');
    IF is_existing THEN
      CONTINUE;
    END IF;

    name_text := 'pool_' || rel.relation_type || '_' || rel.ba_name || rel.bb_name;
    desc_text := '지지 ' || rel.relation_type || ' 발현일 — ' || rel.ba_name || '·' || rel.bb_name;

    -- 본인 일지(술) 또는 본명 지지(자/술)와 관련된 관계는 추가 단서
    IF rel.ba_name = '술' OR rel.bb_name = '술' THEN
      desc_text := desc_text || ' (본인 일지 ' || rel.relation_type || ', 자기 영역 흔들림)';
    ELSIF rel.ba_name = '자' OR rel.bb_name = '자' THEN
      desc_text := desc_text || ' (본인 본명 자 ' || rel.relation_type || ')';
    END IF;

    aux_json := jsonb_build_object(
      'type', 'branch_' || rel.relation_type,
      'members', jsonb_build_array(rel.ba_name, rel.bb_name)
    );

    INSERT INTO pattern_catalog
      (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, name_text, NULL, desc_text, 'relation', NULL, aux_json, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
  END LOOP;
END $$;`);
out.push('');

out.push('-- 천간 관계 (11개) — stem_relations LOOP');
out.push(`DO $$
DECLARE rel RECORD;
  desc_text TEXT;
  aux_json JSONB;
  name_text TEXT;
BEGIN
  FOR rel IN
    SELECT sr.relation_type, sa.name AS sa_name, sb.name AS sb_name
      FROM stem_relations sr
      JOIN stems_master sa ON sa.id = sr.stem_a_id
      JOIN stems_master sb ON sb.id = sr.stem_b_id
      ORDER BY sr.id
  LOOP
    name_text := 'pool_' || rel.relation_type || '_' || rel.sa_name || rel.sb_name;
    desc_text := '천간 ' || rel.relation_type || ' 발현일 — ' || rel.sa_name || '·' || rel.sb_name;

    -- 본인 본명 천간(갑/경)과 관련된 관계는 추가 단서
    IF rel.sa_name = '경' OR rel.sb_name = '경' THEN
      desc_text := desc_text || ' (본인 일간 ' || rel.relation_type || ')';
    ELSIF rel.sa_name = '갑' OR rel.sb_name = '갑' THEN
      desc_text := desc_text || ' (본인 본명 갑 ' || rel.relation_type || ')';
    END IF;

    aux_json := jsonb_build_object(
      'type', 'stem_' || rel.relation_type,
      'members', jsonb_build_array(rel.sa_name, rel.sb_name)
    );

    INSERT INTO pattern_catalog
      (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, name_text, NULL, desc_text, 'relation', NULL, aux_json, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
  END LOOP;
END $$;`);
out.push('');

out.push('COMMIT;');
out.push('');

console.log(out.join('\n'));
