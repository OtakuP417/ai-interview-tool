-- 主题回归与自动打标（P2）
-- 背景：归档的 topic 由运营岗口头下达，经顾问手填，常常只写结果或产品名
--       （如「200万棱镜签约」），既看不出经验内容，也没法横向检索。
--       改为在归档时按「报告正文」自动归纳规范主题 + 打结构化标签。
--
-- ai_topic        按报告内容重写的规范主题句。topic 原文一律保留不动，
--                 作为运营岗原始意图的凭证，可对比「口述 vs 实际」的偏差。
-- tags            结构化标签数组，元素形如 "获客方式:转介绍"。
--                 固定词表内直接取值，词表外以「自由:xxx」存放待人工归并。
-- tags_model      打标所用模型名，便于换模型后回溯口径差异。
-- tags_at         打标时间；NULL = 尚未打标（旧数据），可批量补跑。
--
-- 全部可空，且不触及 report_md / transcript（归档原始凭证不可改）。

ALTER TABLE interview_reports
  ADD COLUMN IF NOT EXISTS ai_topic   text,
  ADD COLUMN IF NOT EXISTS tags       jsonb,
  ADD COLUMN IF NOT EXISTS tags_model text,
  ADD COLUMN IF NOT EXISTS tags_at    timestamptz;

-- 标签检索：jsonb 数组包含查询（tags @> '["获客方式:转介绍"]'）
CREATE INDEX IF NOT EXISTS idx_interview_reports_tags
  ON interview_reports USING gin (tags);

COMMENT ON COLUMN interview_reports.ai_topic IS '按报告内容自动归纳的规范主题，topic 原文保留不覆盖';
COMMENT ON COLUMN interview_reports.tags IS '结构化标签数组，元素形如 维度:取值（固定词表）或 自由:取值（待归并）';
COMMENT ON COLUMN interview_reports.tags_at IS '自动打标时间，NULL 表示未打标';
