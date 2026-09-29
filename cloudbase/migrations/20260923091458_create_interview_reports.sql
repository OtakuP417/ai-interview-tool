-- AI 案例访谈提交归档表
-- 访问模型：只有云函数（service_role）读写；对 anon / authenticated 全拒。
-- 做法：开启 RLS 且不创建任何策略 —— PostgreSQL 默认拒绝，service_role 绕过 RLS。
CREATE TABLE interview_reports (
  id                   BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  city                 TEXT,
  interviewee_name     TEXT        NOT NULL,
  interviewee_position TEXT        NOT NULL,
  topic                TEXT        NOT NULL,
  submitter_name       TEXT        NOT NULL,
  backend_owner_name   TEXT,
  backend_owner_org    TEXT,
  round_count          INTEGER     NOT NULL DEFAULT 0,
  report_md            TEXT        NOT NULL,
  transcript           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status               TEXT        NOT NULL DEFAULT '待审'
);

ALTER TABLE interview_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX interview_reports_created_at_idx ON interview_reports (created_at DESC);
CREATE INDEX interview_reports_city_idx       ON interview_reports (city);
