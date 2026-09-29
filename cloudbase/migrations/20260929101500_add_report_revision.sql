-- 报告正文可编辑 + 修订留痕
--
-- 背景：归档的 report_md 是模型产出，原设计「不可改」以保护原始性。
--       实际使用中出现「个别措辞需要修一下」的合理诉求（如口径错字、
--       把客户行业写偏），只能靠改库，风险更高。
--
-- 折中方案：**放开编辑，但强制留痕**。
--   report_rev        修订次数。0/ NULL = 从未人工编辑过。
--   report_orig       首次被编辑前的正文快照，只存一次，之后不再覆盖。
--                     用来回溯「模型原本写的什么」，是留痕的核心。
--   report_edited_at  最近一次人工编辑时间，NULL = 从未编辑。
--   report_edited_by  编辑人标识（管理端登录身份，暂为固定值「管理员」）。
--
-- 前端在详情页对「已编辑」的记录给出显著提示，并在报告头部标注修订状态，
-- 避免读者把人工修改过的内容误当成模型的原始输出。

ALTER TABLE interview_reports
  ADD COLUMN IF NOT EXISTS report_rev       integer,
  ADD COLUMN IF NOT EXISTS report_orig      text,
  ADD COLUMN IF NOT EXISTS report_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_edited_by text;

COMMENT ON COLUMN interview_reports.report_rev IS '报告正文人工修订次数；NULL/0 = 未编辑过';
COMMENT ON COLUMN interview_reports.report_orig IS '首次人工编辑前的正文快照（只存一次），用于追溯模型原始输出';
COMMENT ON COLUMN interview_reports.report_edited_at IS '最近一次人工编辑报告正文的时间；NULL = 未编辑过';
COMMENT ON COLUMN interview_reports.report_edited_by IS '报告正文编辑人标识';
