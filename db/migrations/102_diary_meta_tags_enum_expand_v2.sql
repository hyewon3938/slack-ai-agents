-- diary_meta_tags enum 확장 (22 → 26)
--   evaluation_exposure : 평가·시선 노출 상황 — 면접/발표/리뷰/마감 (관성 매핑)
--   feeling_enough      : 충분함·인정 체감 (인성 매핑)
--   palpitation         : 두근거림·심계 — health_complaint에서 세분 (화 채널)
--   muscle_tension      : 결림·근막 긴장 — health_complaint에서 세분 (목 채널)

ALTER TABLE diary_meta_tags
  DROP CONSTRAINT IF EXISTS diary_meta_tags_tag_check;

ALTER TABLE diary_meta_tags
  ADD CONSTRAINT diary_meta_tags_tag_check
  CHECK (tag IN (
    'irritation','health_complaint','low_energy','mood_down',
    'confidence_high','analytical_mode','deep_thought','rest',
    'peaceful','mood_high','cooking','creating','talkative',
    'nostalgia','anxiety','past_memory',
    'wealth_awareness','self_observation','social_activity',
    'physical_activity','task_completion','clumsy_overflow',
    'evaluation_exposure','feeling_enough','palpitation','muscle_tension'
  ));

-- signal_defs 검증축 편입 (077 tag 신호 등록 패턴과 동일 — 전역 1개, 여러 시드가 공유)
INSERT INTO signal_defs (user_id, name, kind, value_type, domain, tag_name, description, source, status)
SELECT DISTINCT d.user_id, t.tag, 'tag', 'binary', 'diary_meta', t.tag, t.descr, 'seed', 'active'
FROM diary_meta_tags d
CROSS JOIN (VALUES
  ('evaluation_exposure', '평가·시선 노출 상황 (면접/발표/리뷰/마감)'),
  ('feeling_enough', '충분함·인정 체감'),
  ('palpitation', '두근거림·심계'),
  ('muscle_tension', '결림·근막 긴장')
) AS t(tag, descr)
ON CONFLICT (user_id, tag_name) WHERE kind = 'tag' DO NOTHING;
