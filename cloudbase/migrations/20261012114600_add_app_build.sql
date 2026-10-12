-- 归档时一并记录前端程序版本（APP_BUILD）
--
-- 起因（2026-10-12）：d 版 11:26 上线，但 11:35 归档的 id=22 跑的仍是用户
--       上午打开的旧页面 —— 静态托管的 JS 只在页面加载时取一次，不刷新就
--       一直用旧代码。结果是那份访谈的 L1/L2/L4 全部未参与，而且花了多轮
--       推理才判定出来：
--         · gate_log 为 null 时无法区分"旧版前端"与"新版但零事件" ——
--           cleanGateLog 对空数组也返回 null，两种情况入库后长得一模一样；
--         · 归档时间不等于页面加载时间，不能用 created_at 推断前端版本。
--
-- 记录这一列之后，任何一份报告都能自证是哪个版本产出的，不必再推理。

ALTER TABLE interview_reports
  ADD COLUMN IF NOT EXISTS app_build text;

COMMENT ON COLUMN interview_reports.app_build IS '归档时前端程序版本（APP_BUILD），用于判断该报告由哪一版前端产出';
