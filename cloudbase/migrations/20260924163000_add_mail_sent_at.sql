-- 记录归档报告的邮件发送时间，支撑「提交自动发信 + 保留手动补发」：
--   1. 非空 = 已发送过，管理页按钮显示「重新发送」；
--   2. 手动发送时可用 skipIfSent 做幂等，避免重复收信；
--   3. 自动发信发生在提交之后，即使发送失败也不影响归档本身（字段留空）。
ALTER TABLE interview_reports
  ADD COLUMN IF NOT EXISTS mail_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN interview_reports.mail_sent_at IS
  '邮件成功发出的时间；NULL 表示尚未发送或发送失败';

-- 管理页要按发送状态筛选/展示，加个索引（NULL 值多，部分索引更省）
CREATE INDEX IF NOT EXISTS interview_reports_mail_sent_at_idx
  ON interview_reports (mail_sent_at DESC);
