/**
 * 일회성: user_id=1 (일간 경금/일지 술토) 16개 시드 + 메트릭 INSERT SQL 생성.
 * 결과를 db/migrations/052_saju_seeds.sql로 출력.
 *
 * 실행: npx tsx scripts/generate-saju-seeds.ts > db/migrations/052_saju_seeds.sql
 */

interface Metric {
  name: string;
  sql: string;
  direction: 'above_avg' | 'below_avg' | 'above_abs' | 'below_abs' | 'flag_present';
  threshold: number | null;
  domain: 'schedule' | 'routine' | 'sleep' | 'expense' | 'diary_meta' | 'audit';
}

interface Seed {
  name: string;
  sipsin: string | null;
  description: string;
  triggerTargetType: 'stem' | 'branch' | 'ganji' | 'element_density' | 'sibiunsung' | 'relation';
  triggerStem?: string;
  triggerBranch?: string;
  triggerAux?: Record<string, unknown>;
  metrics: Metric[];
}

const dq = (sql: string): string => `$sql$${sql}$sql$`;

// 공통 메트릭 SQL 빌더
const M = {
  scheduleCreated: {
    name: 'schedule_created',
    sql: `SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND DATE(created_at AT TIME ZONE 'Asia/Seoul')=$2`,
    domain: 'schedule' as const,
  },
  scheduleDone: {
    name: 'schedule_done',
    sql: `SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND status='done'`,
    domain: 'schedule' as const,
  },
  scheduleCompletionRate: {
    name: 'schedule_completion_rate',
    sql: `SELECT COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM schedules WHERE user_id=$1 AND date=$2`,
    domain: 'schedule' as const,
  },
  scheduleCategory: (category: string, name?: string) => ({
    name: name ?? `schedule_${category}`,
    sql: `SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND category='${category}'`,
    domain: 'schedule' as const,
  }),
  scheduleTaxKeyword: {
    name: 'schedule_tax_keyword',
    sql: `SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND (title ILIKE '%세금%' OR title ILIKE '%공과금%' OR title ILIKE '%국세%' OR title ILIKE '%지방세%' OR title ILIKE '%연말정산%')`,
    domain: 'schedule' as const,
  },
  expenseTotal: {
    name: 'expense_total',
    sql: `SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense'`,
    domain: 'expense' as const,
  },
  expenseCategory: (category: string, name?: string) => ({
    name: name ?? `expense_${category}`,
    sql: `SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='${category}'`,
    domain: 'expense' as const,
  }),
  expenseHospitalExcludeInstallment: {
    name: 'expense_hospital_excl_installment',
    sql: `SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='병원' AND (memo IS NULL OR memo NOT LIKE '%할부%')`,
    domain: 'expense' as const,
  },
  sleepNap: {
    name: 'sleep_nap_count',
    sql: `SELECT COUNT(*) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='nap'`,
    domain: 'sleep' as const,
  },
  sleepTotal: {
    name: 'sleep_total_minutes',
    sql: `SELECT COALESCE(SUM(duration_minutes),0) FROM sleep_records WHERE user_id=$1 AND date=$2`,
    domain: 'sleep' as const,
  },
  sleepNightTotal: {
    name: 'sleep_night_minutes',
    sql: `SELECT COALESCE(SUM(duration_minutes),0) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='night'`,
    domain: 'sleep' as const,
  },
  sleepWakeHour: {
    name: 'sleep_wake_hour',
    sql: `SELECT COALESCE(EXTRACT(HOUR FROM MIN(wake_time::time)),0) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='night'`,
    domain: 'sleep' as const,
  },
  routineCompletionRate: {
    name: 'routine_completion_rate',
    sql: `SELECT COALESCE(SUM(CASE WHEN completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records WHERE user_id=$1 AND date=$2`,
    domain: 'routine' as const,
  },
  routineCategoryRate: (category: string, name?: string) => ({
    name: name ?? `routine_rate_${category}`,
    sql: `SELECT COALESCE(SUM(CASE WHEN rr.completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records rr JOIN routine_templates rt ON rt.id=rr.template_id WHERE rr.user_id=$1 AND rr.date=$2 AND rt.category='${category}'`,
    domain: 'routine' as const,
  }),
  diaryFlag: (tag: string) => ({
    name: `diary_${tag}`,
    sql: `SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='${tag}'`,
    domain: 'diary_meta' as const,
  }),
  auditReschedulePostGrace: {
    name: 'audit_postponed_done',
    sql: `WITH rc AS (SELECT sc.schedule_id, COUNT(*) AS n FROM schedule_changes sc JOIN schedules s ON s.id=sc.schedule_id WHERE sc.user_id=$1 AND sc.change_type='date_changed' AND sc.changed_at > s.created_at + INTERVAL '30 minutes' GROUP BY sc.schedule_id) SELECT COUNT(*) FROM schedules s JOIN rc ON rc.schedule_id=s.id WHERE s.user_id=$1 AND s.date=$2 AND s.status='done' AND rc.n >= 2`,
    domain: 'audit' as const,
  },
  auditDateChangedTotal: {
    name: 'audit_date_changed',
    sql: `SELECT COUNT(*) FROM schedule_changes WHERE user_id=$1 AND change_type='date_changed' AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2`,
    domain: 'audit' as const,
  },
};

const mk = (
  m: { name: string; sql: string; domain: Metric['domain'] },
  direction: Metric['direction'],
  threshold: number | null = null,
): Metric => ({
  name: m.name,
  sql: m.sql,
  direction,
  threshold,
  domain: m.domain,
});

const seeds: Seed[] = [
  {
    name: 'S1_갑목_편재_천간',
    sipsin: '편재',
    description: '일운 천간 갑목(편재) → 일정/지출 폭증 가능성',
    triggerTargetType: 'stem',
    triggerStem: '갑',
    metrics: [
      mk(M.scheduleCreated, 'above_avg'),
      mk(M.expenseTotal, 'above_avg'),
      mk(M.scheduleDone, 'above_avg'),
    ],
  },
  {
    name: 'S2_사화_편관_사술원진',
    sipsin: '편관',
    description: '일운 지지 사 + 본명 술 원진+귀문 → 짜증/건강 + 책임처리 + 분석/영화/책 다층 가설',
    triggerTargetType: 'relation',
    triggerAux: {
      day_branch: '사',
      natal_branches: ['술'],
      relation_types: ['원진'],
    },
    metrics: [
      mk(M.diaryFlag('irritation'), 'flag_present', 1),
      mk(M.diaryFlag('health_complaint'), 'flag_present', 1),
      mk(M.scheduleCompletionRate, 'above_avg'),
      mk(M.auditReschedulePostGrace, 'above_abs', 1),
      mk(M.diaryFlag('analytical_mode'), 'flag_present', 1),
      mk(M.diaryFlag('deep_thought'), 'flag_present', 1),
      mk(M.scheduleCategory('영화'), 'above_abs', 1),
    ],
  },
  {
    name: 'S3_계수_상관_천간',
    sipsin: '상관',
    description: '일운 천간 계수(상관) → 배달/루틴↓/일정 미루기',
    triggerTargetType: 'stem',
    triggerStem: '계',
    metrics: [
      mk(M.expenseCategory('배달음식'), 'above_avg'),
      mk(M.routineCompletionRate, 'below_avg'),
      mk(M.auditDateChangedTotal, 'above_avg'),
    ],
  },
  {
    name: 'S4_기토_정인_천간',
    sipsin: '정인',
    description: '일운 천간 기토(정인) → 낮잠/휴식/평온',
    triggerTargetType: 'stem',
    triggerStem: '기',
    metrics: [
      mk(M.sleepNap, 'above_abs', 1),
      mk(M.sleepTotal, 'above_avg'),
      mk(M.diaryFlag('rest'), 'flag_present', 1),
      mk(M.diaryFlag('peaceful'), 'flag_present', 1),
      mk(M.diaryFlag('mood_high'), 'flag_present', 1),
    ],
  },
  {
    name: 'S5_토_과다',
    sipsin: null,
    description: '본명 토 2개 + 일운 토 합산 ≥ 4 → 무기력/수면↑',
    triggerTargetType: 'element_density',
    triggerAux: { element: '토', min_count: 4 },
    metrics: [
      mk(M.diaryFlag('low_energy'), 'flag_present', 1),
      mk(M.routineCompletionRate, 'below_avg'),
      mk(M.sleepWakeHour, 'above_avg'),
    ],
  },
  {
    name: 'S6_사지묘지',
    sipsin: null,
    description: '일간 경 기준 12운성 사/묘 (지지 자/축) → 컨디션↓/병원',
    triggerTargetType: 'sibiunsung',
    triggerAux: { states: ['사', '묘'] },
    metrics: [
      mk(M.diaryFlag('low_energy'), 'flag_present', 1),
      mk(M.diaryFlag('mood_down'), 'flag_present', 1),
      mk(M.sleepNightTotal, 'above_avg'),
      mk(M.routineCategoryRate('운동'), 'below_avg'),
      mk(M.expenseHospitalExcludeInstallment, 'above_abs', 1),
    ],
  },
  {
    name: 'S7_경금_비견_천간',
    sipsin: '비견',
    description: '일운 천간 경금(비견) → 자신감/완료율↑',
    triggerTargetType: 'stem',
    triggerStem: '경',
    metrics: [
      mk(M.diaryFlag('confidence_high'), 'flag_present', 1),
      mk(M.scheduleCompletionRate, 'above_avg'),
    ],
  },
  {
    name: 'S8_무토_편인_천간',
    sipsin: '편인',
    description: '일운 천간 무토(편인) → 분석/영화/깊은 사유',
    triggerTargetType: 'stem',
    triggerStem: '무',
    metrics: [
      mk(M.diaryFlag('analytical_mode'), 'flag_present', 1),
      mk(M.diaryFlag('deep_thought'), 'flag_present', 1),
      mk(M.scheduleCategory('영화'), 'above_abs', 1),
    ],
  },
  {
    name: 'N1_임수_식신_천간',
    sipsin: '식신',
    description: '일운 천간 임수(식신) → 요리/창작/대화/먹기',
    triggerTargetType: 'stem',
    triggerStem: '임',
    metrics: [
      mk(M.expenseCategory('식재료'), 'above_avg'),
      mk(M.expenseCategory('외식'), 'above_avg'),
      mk(M.expenseCategory('배달음식'), 'above_avg'),
      mk(M.diaryFlag('cooking'), 'flag_present', 1),
      mk(M.diaryFlag('creating'), 'flag_present', 1),
      mk(M.diaryFlag('talkative'), 'flag_present', 1),
    ],
  },
  {
    name: 'N2_해수_식신_지지',
    sipsin: '식신',
    description: '일운 지지 해수(식신) → N1과 천간/지지 발현 비교',
    triggerTargetType: 'branch',
    triggerBranch: '해',
    metrics: [
      mk(M.expenseCategory('식재료'), 'above_avg'),
      mk(M.expenseCategory('외식'), 'above_avg'),
      mk(M.expenseCategory('배달음식'), 'above_avg'),
      mk(M.diaryFlag('cooking'), 'flag_present', 1),
      mk(M.diaryFlag('creating'), 'flag_present', 1),
      mk(M.diaryFlag('talkative'), 'flag_present', 1),
    ],
  },
  {
    name: 'N3_진토_편인_진술충',
    sipsin: '편인',
    description: '일운 지지 진 + 본명 술 충 → 향수/불안/과거 기억',
    triggerTargetType: 'relation',
    triggerAux: {
      day_branch: '진',
      natal_branches: ['술'],
      relation_types: ['충'],
    },
    metrics: [
      mk(M.diaryFlag('nostalgia'), 'flag_present', 1),
      mk(M.diaryFlag('anxiety'), 'flag_present', 1),
      mk(M.diaryFlag('past_memory'), 'flag_present', 1),
    ],
  },
  {
    name: 'N4_축미_정인_지지',
    sipsin: '정인',
    description: '일운 지지 축 또는 미(정인) → S4와 천간/지지 발현 비교',
    triggerTargetType: 'branch',
    triggerBranch: '축',
    triggerAux: { or_branches: ['미'] },
    metrics: [
      mk(M.sleepNap, 'above_abs', 1),
      mk(M.sleepTotal, 'above_avg'),
      mk(M.diaryFlag('rest'), 'flag_present', 1),
      mk(M.diaryFlag('peaceful'), 'flag_present', 1),
      mk(M.diaryFlag('mood_high'), 'flag_present', 1),
    ],
  },
  {
    name: 'N5_술_편인_지지',
    sipsin: '편인',
    description: '일운 지지 술(편인, 본명 일지 술 비화) → S8과 비교',
    triggerTargetType: 'branch',
    triggerBranch: '술',
    metrics: [
      mk(M.diaryFlag('analytical_mode'), 'flag_present', 1),
      mk(M.diaryFlag('deep_thought'), 'flag_present', 1),
      mk(M.scheduleCategory('영화'), 'above_abs', 1),
    ],
  },
  {
    name: 'N6_정화_정관_천간',
    sipsin: '정관',
    description: '일운 천간 정화(정관) → 책임/이직/세금 처리',
    triggerTargetType: 'stem',
    triggerStem: '정',
    metrics: [
      mk(M.scheduleCompletionRate, 'above_avg'),
      mk(M.scheduleCategory('이직'), 'above_abs', 1),
      mk(M.scheduleTaxKeyword, 'above_abs', 1),
      mk(M.auditReschedulePostGrace, 'above_abs', 1),
    ],
  },
  {
    name: 'N7_오화_정관_지지',
    sipsin: '정관',
    description: '일운 지지 오화(정관) → N6과 비교',
    triggerTargetType: 'branch',
    triggerBranch: '오',
    metrics: [
      mk(M.scheduleCompletionRate, 'above_avg'),
      mk(M.scheduleCategory('이직'), 'above_abs', 1),
      mk(M.scheduleTaxKeyword, 'above_abs', 1),
      mk(M.auditReschedulePostGrace, 'above_abs', 1),
    ],
  },
  {
    name: 'N8_병화_편관_천간',
    sipsin: '편관',
    description: '일운 천간 병화(편관) → 양화 편관 발현 비교',
    triggerTargetType: 'stem',
    triggerStem: '병',
    metrics: [
      mk(M.scheduleCompletionRate, 'above_avg'),
      mk(M.scheduleCategory('이직'), 'above_abs', 1),
      mk(M.scheduleTaxKeyword, 'above_abs', 1),
      mk(M.auditReschedulePostGrace, 'above_abs', 1),
    ],
  },
];

// SQL 출력
const out: string[] = [];
out.push('-- 052: 사주 시드 16개 + 메트릭 등록 (user_id=1, 일간 경금 / 일지 술토)');
out.push('-- 자동 생성: scripts/generate-saju-seeds.ts');
out.push('-- 트리거 분기:');
out.push("--   'stem'/'branch'/'sibiunsung': trigger_target_id로 마스터 참조");
out.push("--   'relation'/'element_density': trigger_aux JSONB로 복합 조건 표현");
out.push('');

for (const seed of seeds) {
  const auxJson = seed.triggerAux ? JSON.stringify(seed.triggerAux) : null;
  out.push(`-- ── ${seed.name} ──`);
  out.push('DO $$');
  out.push('DECLARE');
  out.push('  s_id INTEGER;');
  out.push('  t_id INTEGER;');
  out.push('BEGIN');

  // trigger_target_id 결정
  if (seed.triggerTargetType === 'stem' && seed.triggerStem) {
    out.push(`  SELECT id INTO t_id FROM stems_master WHERE name='${seed.triggerStem}';`);
  } else if (seed.triggerTargetType === 'branch' && seed.triggerBranch) {
    out.push(`  SELECT id INTO t_id FROM branches_master WHERE name='${seed.triggerBranch}';`);
  } else {
    out.push('  t_id := NULL;');
  }

  // catalog INSERT
  const auxClause = auxJson ? `'${auxJson.replace(/'/g, "''")}'::jsonb` : 'NULL';
  const sipsinClause = seed.sipsin ? `'${seed.sipsin}'` : 'NULL';
  out.push(`  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, '${seed.name}', ${sipsinClause}, ${dq(seed.description)}, '${seed.triggerTargetType}', t_id, ${auxClause}, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;`);

  // metrics INSERT
  for (const m of seed.metrics) {
    const thresh = m.threshold === null ? 'NULL' : String(m.threshold);
    out.push(`  INSERT INTO pattern_metrics (pattern_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, '${m.name}', ${dq(m.sql)}, '${m.direction}', ${thresh}, '${m.domain}')
    ON CONFLICT (pattern_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;`);
  }

  out.push('END $$;');
  out.push('');
}

console.log(out.join('\n'));
