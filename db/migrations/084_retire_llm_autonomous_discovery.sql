-- 084: v2 LLM 자율 발견 서브시스템 은퇴 (#393 Phase 2 폐기)
-- 배경: #393 v2 "LLM 자율 발견 슬롯"(weekly/monthly + outcome 검증)은 llm_insights 테이블에 생애 0건 산출
--   (한 번도 발견 메시지 발송 안 됨). #477 헌장(정량 통계 1차 + LLM 의존 최소화)으로 발견 역할이 통계
--   기반 P5a(여집합 발굴) + P5b(LLM 신호 제안, 판정은 통계)로 이관됨 → 본 서브시스템 폐기.
-- 변경: ① notification_settings에서 cron 슬롯 3개 제거(스케줄러 미등록) ② llm_insights 테이블 DROP(0행).
-- 안전: llm_insights FK 의존 0 + 0행 확인 후 진행(데이터 손실 없음). 코드(crons·fast path·shared)는 PR에서 삭제.
-- 관련: ADR-0016(Superseded), [048] llm_insights 신설을 역행.

-- ① cron 슬롯 제거 (life-cron SLOT_TASKS에서 키 제거와 동기화 — 아니면 orphan 슬롯)
DELETE FROM notification_settings
 WHERE slot_name IN ('weeklyLlmInsight', 'monthlyLlmInsight', 'verifyLlmInsights');

-- ② v2 자율 발견 영속 테이블 제거 (생애 0행, FK 의존 0)
DROP TABLE IF EXISTS llm_insights;

-- ③ 정합 검증 (RAISE 시 파일 트랜잭션 롤백)
DO $$
DECLARE
  slots_left INT;
  table_left INT;
BEGIN
  SELECT count(*) INTO slots_left FROM notification_settings
   WHERE slot_name IN ('weeklyLlmInsight', 'monthlyLlmInsight', 'verifyLlmInsights');
  IF slots_left <> 0 THEN
    RAISE EXCEPTION '[084] notification_settings에 LLM 자율 발견 슬롯 % 개 잔존', slots_left;
  END IF;

  SELECT count(*) INTO table_left FROM information_schema.tables WHERE table_name = 'llm_insights';
  IF table_left <> 0 THEN
    RAISE EXCEPTION '[084] llm_insights 테이블 DROP 실패';
  END IF;

  RAISE NOTICE '[084] v2 LLM 자율 발견 은퇴 완료 — 슬롯 3개 제거 + llm_insights DROP';
END $$;
