-- Opus 개발자 리뷰 분석 결과 저장 (Scheduled Task → DB → 아침 크론 참조)
CREATE TABLE IF NOT EXISTS dev_analyses (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  analysis TEXT NOT NULL,
  commit_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
