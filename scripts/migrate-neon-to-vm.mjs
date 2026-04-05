/**
 * Neon DB → VM DB 데이터 이관 스크립트.
 *
 * 사용법:
 *   NEON_DATABASE_URL="postgresql://..." DATABASE_URL="postgresql://..." node scripts/migrate-neon-to-vm.mjs
 *
 * - Neon(소스)에서 전체 데이터를 읽어 VM(타겟)에 upsert
 * - schema_migrations는 건너뜀 (마이그레이션은 앱 시작 시 자동 실행)
 * - UNIQUE 제약이 있는 테이블은 ON CONFLICT DO UPDATE
 * - UNIQUE 제약이 없는 테이블은 ON CONFLICT (id) DO NOTHING (이미 있으면 스킵)
 * - 시퀀스 자동 리셋
 */

import pg from 'pg';

const { Pool } = pg;

// ─── 설정 ────────────────────────────────────────────────

const NEON_URL = process.env.NEON_DATABASE_URL;
const VM_URL = process.env.DATABASE_URL;

if (!NEON_URL || !VM_URL) {
  console.error('❌ NEON_DATABASE_URL과 DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}

/** 테이블별 이관 설정 */
const TABLES = [
  // FK 의존성 순서: 부모 → 자식
  { name: 'users', conflict: 'id', columns: ['id', 'kakao_id', 'nickname', 'email', 'gender', 'birthday', 'age_range', 'profile_image', 'created_at'] },
  { name: 'categories', conflict: 'id', columns: ['id', 'name', 'color', 'sort_order', 'created_at', 'type', 'user_id', 'parent_id'] },
  { name: 'custom_instructions', conflict: 'id', columns: ['id', 'instruction', 'created_at', 'category', 'source', 'active', 'user_id'] },
  { name: 'diary_entries', conflict: 'id', columns: ['id', 'user_id', 'date', 'content', 'created_at', 'updated_at'] },
  { name: 'fortune_analyses', conflict: 'id', columns: ['id', 'user_id', 'date', 'day_pillar', 'month_pillar', 'year_pillar', 'analysis', 'summary', 'warnings', 'recommendations', 'advice', 'model', 'created_at', 'period'] },
  { name: 'life_themes', conflict: 'id', columns: ['id', 'user_id', 'theme', 'category', 'detail', 'active', 'source', 'first_mentioned', 'mention_count', 'created_at'] },
  { name: 'notification_settings', conflict: 'id', columns: ['id', 'slot_name', 'label', 'time_value', 'active', 'created_at'] },
  { name: 'reminders', conflict: 'id', columns: ['id', 'title', 'time_value', 'date', 'frequency', 'active', 'created_at', 'days_of_week', 'days_of_month', 'repeat_interval', 'reference_date', 'end_date', 'remaining_count'] },
  { name: 'routine_templates', conflict: 'id', columns: ['id', 'name', 'time_slot', 'frequency', 'active', 'created_at', 'user_id'] },
  { name: 'routine_records', conflict: 'id', columns: ['id', 'template_id', 'date', 'completed', 'created_at', 'memo', 'completed_at', 'user_id'] },
  { name: 'saju_profiles', conflict: 'id', columns: ['id', 'user_id', 'year_pillar', 'month_pillar', 'day_pillar', 'hour_pillar', 'gender', 'daewun_start_age', 'daewun_direction', 'daewun_list', 'gyeokguk', 'yongshin', 'profile_summary', 'birth_date', 'birth_time', 'created_at', 'strength', 'heeshin', 'gishin', 'hanshin'] },
  { name: 'saju_patterns', conflict: 'id', columns: ['id', 'user_id', 'pattern_type', 'trigger_element', 'description', 'evidence', 'active', 'detection_count', 'first_detected', 'last_detected', 'activated_at', 'deactivated_at', 'source', 'confidence', 'created_at', 'updated_at'] },
  { name: 'schedules', conflict: 'id', columns: ['id', 'title', 'date', 'end_date', 'status', 'category', 'memo', 'created_at', 'important', 'user_id', 'subcategory', 'updated_at'] },
  { name: 'slack_user_mappings', conflict: 'id', columns: ['id', 'user_id', 'slack_user_id', 'created_at'] },
  { name: 'sleep_events', conflict: 'id', columns: ['id', 'date', 'event_time', 'memo', 'created_at'] },
  { name: 'sleep_records', conflict: 'id', columns: ['id', 'date', 'bedtime', 'wake_time', 'duration_minutes', 'memo', 'created_at', 'sleep_type', 'user_id'] },
];

// ─── 유틸 ────────────────────────────────────────────────

function buildUpsertSQL(table, columns) {
  const colList = columns.join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${updateSet}`;
}

// ─── 메인 ────────────────────────────────────────────────

async function main() {
  const neonPool = new Pool({
    connectionString: NEON_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  const useSSL = VM_URL.includes('sslmode=require');
  const vmPool = new Pool({
    connectionString: VM_URL,
    ...(useSSL && { ssl: { rejectUnauthorized: false } }),
    max: 3,
  });

  try {
    // 연결 테스트
    const neonClient = await neonPool.connect();
    neonClient.release();
    console.log('✅ Neon DB 연결 성공');

    const vmClient = await vmPool.connect();
    vmClient.release();
    console.log('✅ VM DB 연결 성공');

    let totalRows = 0;

    for (const table of TABLES) {
      const { name, columns } = table;

      // Neon에서 읽기
      const { rows } = await neonPool.query(`SELECT ${columns.join(', ')} FROM ${name} ORDER BY id`);

      if (rows.length === 0) {
        console.log(`⏭️  ${name}: 데이터 없음`);
        continue;
      }

      // VM에 upsert
      const sql = buildUpsertSQL(name, columns);
      const client = await vmPool.connect();

      try {
        await client.query('BEGIN');

        for (const row of rows) {
          const values = columns.map((col) => row[col]);
          await client.query(sql, values);
        }

        // 시퀀스 리셋 (max id + 1)
        const maxId = Math.max(...rows.map((r) => r.id));
        await client.query(`SELECT setval('${name}_id_seq', $1, true)`, [maxId]);

        await client.query('COMMIT');
        console.log(`✅ ${name}: ${rows.length}건 이관 완료 (seq → ${maxId})`);
        totalRows += rows.length;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ ${name}: 이관 실패 —`, err.message);
      } finally {
        client.release();
      }
    }

    console.log(`\n🎉 이관 완료: 총 ${totalRows}건`);
  } finally {
    await neonPool.end();
    await vmPool.end();
  }
}

main().catch((err) => {
  console.error('❌ 이관 스크립트 오류:', err);
  process.exit(1);
});
