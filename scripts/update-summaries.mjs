import pg from 'pg';
import { readFileSync } from 'fs';

const DB_URL = readFileSync('/dev/stdin', 'utf8').trim();
const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const updates = [
  { date: '2026-01-01', period: 'yearly', summary: '관성 4중 제련의 해 — 자기 삶 가꾸면 기회가 따라와', advice: '올해 관성 4중이지만 경금련정 구조의 절정이야. 6월 이직, 루틴 유지, 스트레스는 운동으로.', warnings: ['관성 과다 → 스트레스 폭발 반복 가능성 (3/14 선례)', '9월 정유월 — 나태/과식 최대 위험', '재다신약 — 사업 직접 확장 시 에너지 소진'], recommendations: ['6월 전 이직 완료 목표 — 5월 면접, 6월 오퍼 집중', '재생관 전략 — 실력/콘텐츠 가꾸기로 직장 기회 유인', '스트레스-폭식 고리 끊기 — 운동 루틴 핵심', '서울 집 중심 생활 — 본가 방문 최소화'] },
  { date: '2026-03-01', period: 'monthly', summary: '겁재 추진력으로 씨앗 심는 달 — 결과는 4~5월에', advice: '이번 달 이력서 과감하게 보내. 결과는 다음 달. 3/14 이후 회복 집중.', warnings: ['공망 정재 — 즉각 결과 기대 낮추기', '3/14 감정 소진 회복 필요'], recommendations: ['이직 지원서 과감하게 제출', '3주차 갑오일(토) 이직 활동 집중', '루틴 회복 우선'] },
  { date: '2026-04-01', period: 'monthly', summary: '식신 창의 폭발 + 관성 압박 해제 — 이직 면접과 창의 작업 최적', advice: '4월에 이직 면접 적극 잡아. 임진월 식신+정임합으로 자기표현이 자연스러워.', warnings: ['식신-편인 도식 주의', '진술충 몸 에너지 불안정'], recommendations: ['이직 면접 적극 잡기', '창의 작업 집중', '다이어트 루틴 새로 시작'] },
  { date: '2026-05-01', period: 'monthly', summary: '상관견관 최고조 — 이직 결단과 연봉 협상의 달', advice: '5월에 이직 결판 내. 상관 에너지로 협상력 올라와.', warnings: ['상관 과잉 — 표현 조심', '사해충 스트레스 — 폭식 주의'], recommendations: ['이직 협상 과감하게', '운동으로 스트레스 배출'] },
  { date: '2026-06-01', period: 'monthly', summary: '재생관 최대 — 이직 안착과 새 시작의 달', advice: '6월이 이직 결판이야. 에너지 분산 말고 새 직장에 올인해.', warnings: ['재다신약 최고조 — 이직+사업 동시 불가'], recommendations: ['이직 안착 집중', '사업 부채널 유지만'] },
  { date: '2026-07-01', period: 'monthly', summary: '정재+정인으로 새 직장 안착 — 배우면서 자리 잡기', advice: '새 직장에서 빠른 성과 내려 하지 마. 7월은 배우고 파악하는 달.', warnings: ['해묘미 삼합 재성 과강 주의'], recommendations: ['새 직장 파악 집중', '핸드메이드 주문 체크'] },
  { date: '2026-08-01', period: 'monthly', summary: '편관 이중 압박 — 버티고 단련되는 달', advice: '8월은 버티는 달. 힘들어도 경금련정 구조의 제련 과정이야.', warnings: ['편관 과다 → 스트레스, 폭식 주의'], recommendations: ['압박을 성장으로 수용', '루틴 사수'] },
  { date: '2026-09-01', period: 'monthly', summary: '정관 3중 + 인성 압박 — 루틴 사수가 생명인 달', advice: '9월은 루틴 사수야. 식욕 최고조 — 운동 루틴 지켜.', warnings: ['인성 과다 → 나태/과식 위험'], recommendations: ['루틴 사수 최우선', '운동으로 스트레스 배출'] },
  { date: '2026-10-01', period: 'monthly', summary: '편인 4중 관인상생 — 도식 주의하며 깊이 학습하는 달', advice: '10월 편인 4중. 나태함 알아채고 학습에 써.', warnings: ['편인 4중 도식 — 행동력 저하, 식욕 왜곡'], recommendations: ['직장 학습 집중', '깊이 파는 작업'] },
  { date: '2026-11-01', period: 'monthly', summary: '정인+식신 관인상생 — 직장 인정받고 창의 결실 시작', advice: '11월은 한 해 수확 시작. 직장 인정받고 핸드메이드 연말 챙겨.', warnings: ['식신 에너지로 식욕 증가'], recommendations: ['직장 역량 표현', '핸드메이드 연말 마케팅'] },
  { date: '2026-12-01', period: 'monthly', summary: '비견+상관으로 한 해 결산과 내년 결단', advice: '12월에 한 해 정리하고 내년 계획 세워.', warnings: ['자존심 충돌 주의'], recommendations: ['한 해 회고 + 내년 목표 설정'] },
];

for (const u of updates) {
  const res = await pool.query(
    `UPDATE fortune_analyses SET summary=$3, advice=$4, warnings=$5::jsonb, recommendations=$6::jsonb, model='claude-opus-4-6' WHERE user_id=1 AND date=$1 AND period=$2`,
    [u.date, u.period, u.summary, u.advice, JSON.stringify(u.warnings), JSON.stringify(u.recommendations)]
  );
  console.log(`갱신: ${u.date} ${u.period} (${res.rowCount}행)`);
}
await pool.end();
