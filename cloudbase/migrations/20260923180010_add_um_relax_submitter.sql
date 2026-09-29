-- 归档表字段调整（2026-09-23）
-- 1) 被访谈人信息新增 UM 号（员工统一编号）
-- 2) 归档信息取消「提交人」必填：前端表单已移除该字段，列保留以兼容历史数据
ALTER TABLE interview_reports ADD COLUMN IF NOT EXISTS interviewee_um TEXT;

ALTER TABLE interview_reports ALTER COLUMN submitter_name DROP NOT NULL;

CREATE INDEX IF NOT EXISTS interview_reports_interviewee_um_idx
  ON interview_reports (interviewee_um);
