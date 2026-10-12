-- 案例经验库：动作阶段分类（客户旅程八阶段）落库
--
-- 起因（2026-10-12，用户提出）：知识库原先把卡片按「**报告主题**」归并 ——
-- 一份访谈只要标题带“棱镜”，它下面所有做法都被塞进棱镜组，包括跟棱镜无关的通用招式。
-- 实测 69 张卡里只有 11 张（16%）的文本能自证自己属于所在组。
--
-- 修法：判据落到**卡片自身**，并补上第二个维度「动作阶段」（客户旅程八阶段）。
-- 分类结果就存在这三列里，与打标（tags/tags_at/tags_model）同一套模式：
-- 属于派生数据，可覆盖、可批量补跑，**不碰 report_md / topic 等原始凭证**。

ALTER TABLE interview_reports ADD COLUMN IF NOT EXISTS kb_stages jsonb;
ALTER TABLE interview_reports ADD COLUMN IF NOT EXISTS kb_stages_at timestamptz;
ALTER TABLE interview_reports ADD COLUMN IF NOT EXISTS kb_stages_model text;

COMMENT ON COLUMN interview_reports.kb_stages IS '案例经验库分类：jsonb 数组，与 kb.js 解析出的做法卡片**按下标对齐**，每项 {"stage":"约见推进","scene":"棱镜签约"}；scene 为「通用」表示这条做法与具体场景无关';
COMMENT ON COLUMN interview_reports.kb_stages_at IS '分类生成时间。NULL 表示尚未分类，可用 /api/admin 的 kb_stage 动作批量补跑';
COMMENT ON COLUMN interview_reports.kb_stages_model IS '生成该分类所用的模型名';
