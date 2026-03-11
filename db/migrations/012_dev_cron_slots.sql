-- 개발자 리뷰 + 작업 요약 크론 슬롯 추가
INSERT INTO notification_settings (slot_name, label, time_value) VALUES
  ('devReview',    '개발자 리뷰',  '09:00'),
  ('workSummary',  '작업 요약',    '09:05')
ON CONFLICT (slot_name) DO NOTHING;
