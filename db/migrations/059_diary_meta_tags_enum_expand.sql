-- diary_meta_tags enum 확장 (16 → 22)
-- ADR-0019 Phase 4: 가설 검증에 필요한 새 태그 6개 추가
--   wealth_awareness   : 돈 관련 인식·결정 (재성 매핑)
--   self_observation   : 본인 사주·신살·일진 직접 언급 (가설 검증 골드 시그널)
--   social_activity    : 가족·친구·지인 만남/통화 (비겁/관성)
--   physical_activity  : 운동·산책·외출/이동 (역마)
--   task_completion    : 업무·과제 처리/완료 (식상/관성)
--   clumsy_overflow    : 실수·물건 떨어뜨림·놓침 (충/공망)

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
    'physical_activity','task_completion','clumsy_overflow'
  ));
