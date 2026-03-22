-- 일정/리뷰 알림 시간을 낮/밤 체계에 맞춤
UPDATE notification_settings SET time_value = '23:55' WHERE slot_name = 'nightReview';
