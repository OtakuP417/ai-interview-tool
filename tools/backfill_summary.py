# -*- coding: utf-8 -*-
"""为缺「海报摘要」节的旧报告补一节（供简略一图流出图）。

原则：**只从该报告自己的正文里抽取压缩，不新增任何内容**。
摘要的每一句都必须能在正文里找到依据；找不到的键写「暂无」或省略。

用法：
  python tools/backfill_summary.py <id>            # 预览将要写入的摘要节
  python tools/backfill_summary.py <id> --apply    # 真正写库（会先备份原值到本地）
  python tools/backfill_summary.py --all           # 列出所有待补的报告

注意：写库改的是 report_md（原始凭证类字段）。本脚本把原值完整备份到
tools/out/summary-backup/<id>.md，可随时人工回滚。
"""
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _admin import BASE, post, load_password  # noqa: E402

PW = load_password()
BK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "summary-backup")


def post(u, p):
    r = urllib.request.Request(u, data=json.dumps(p).encode(),
                               headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=90).read())


def sections(md):
    parts = re.split(r"\s*---SECTION---\s*", md or "")
    out = {}
    for p in parts:
        lines = p.strip().split("\n")
        if not lines:
            continue
        title = re.sub(r"^\s*(?:\d+[.、）)]\s*|#+\s*)", "", lines[0]).strip()
        out[title] = "\n".join(lines[1:]).strip()
    return out


def numbers_in(text):
    """抽出文本里的数字性表达，用于成果带。"""
    found = []
    for m in re.finditer(r"(\d+(?:\.\d+)?\s*(?:万|亿|件|笔|单|天|个月|年|%))", text or ""):
        found.append(m.group(1).strip())
    return found


def first_sentence(text, limit=40):
    t = re.sub(r"\s+", "", str(text or ""))
    t = re.sub(r"^\d+[.、）)]\s*", "", t)
    for sep in ["。", "；", "，"]:
        i = t.find(sep)
        if 4 < i <= limit:
            return t[:i]
    return t[:limit]


def quote_in(text):
    """抽正文里的引号原话（"…" / “…”），这是「示例」最该用的素材。"""
    for m in re.finditer(r'[""“”]([^""“”]{4,40})[""“”]', text or ""):
        return m.group(1).strip()
    return ""


def build_summary(secs, name, topic):
    """从正文派生摘要节。任何一栏找不到依据就不写（宁可少，不编）。"""
    results = secs.get("结果", "")
    acts = secs.get("核心做法", "")
    judge = secs.get("关键判断与取舍", "")
    pits = secs.get("新人容易踩的坑", "") or secs.get("新人注意事项", "")
    points = secs.get("可复制的经验点", "")

    lines = []

    # 钩子句：优先用结果里的数字，没有就用主题兜底
    nums = numbers_in(results)
    hook = ""
    if nums:
        hook = "这个案例做成了一笔【%s】的单子" % nums[0]
    elif nums := numbers_in(topic):
        hook = "案例成果：【%s】" % nums[0]
    else:
        hook = "一条可复制的经验：%s" % first_sentence(topic, 18)
    lines.append("钩子句：" + hook)

    # 成果 1-3：从结果段抽数字短语
    num_list = numbers_in(results)
    for i in range(1, 4):
        if i - 1 < len(num_list):
            lines.append("成果%d：%s|%s" % (i, num_list[i - 1], first_sentence(results, 12)))
        else:
            break

    # 做法标题/做法/示例：从「核心做法」逐条抽
    act_lines = [re.sub(r"^\s*\d+[.、）)]\s*", "", x).strip()
                 for x in acts.split("\n") if x.strip()]
    act_lines = [x for x in act_lines if len(x) > 6][:8]
    for i, a in enumerate(act_lines, 1):
        # 标题取冒号前的短语（去掉"1. "序号与常见后缀）
        head = a.split("：")[0].split(":")[0]
        head = re.sub(r"(主动|持续|通过|借助|做好)$", "", head)
        title = head[:6]
        lines.append("做法%d标题：%s" % (i, title))
        body = a.split("：", 1)[1] if "：" in a else a
        lines.append("做法%d做法：%s" % (i, first_sentence(body, 30)))
        # 示例只写正文里真有原话的；没有就写"暂无原话"，不复制做法凑数
        q = quote_in(a)
        lines.append("做法%d示例：%s" % (i, q if q else "暂无原话，做法见上"))

    if judge:
        # 去掉「判断点：」这类小标题前缀，避免摘要里出现"判断句：判断点：…"
        j = re.sub(r"^(?:判断点|判断|取舍)\s*[:：]\s*", "", judge.strip())
        lines.append("判断句：" + first_sentence(j, 45))
    if pits:
        p = re.sub(r"^\s*\d+[.、）)]\s*", "", pits.strip().split("\n")[0]).strip()
        lines.append("避坑句：" + first_sentence(p, 45))
    if not judge and points:
        lines.append("判断句：" + first_sentence(points, 45))

    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    apply_it = "--apply" in args
    ids = [int(x) for x in args if x.isdigit()]

    l = post(BASE + "/admin", {"action": "login", "password": PW})
    A = {"token": l["token"], "exp": l["exp"]}
    lst = post(BASE + "/admin", dict(A, action="list", page=1, pageSize=50))

    targets = []
    for r in sorted(lst["rows"], key=lambda x: x["id"]):
        d = post(BASE + "/admin", dict(A, action="detail", id=r["id"]))
        md = (d.get("row") or {}).get("report_md") or ""
        has = bool(sections(md).get("海报摘要"))
        if ids:
            if r["id"] in ids:
                targets.append((r, md, has))
        elif not has:
            targets.append((r, md, has))

    if not targets:
        print("没有需要处理的报告。")
        return

    os.makedirs(BK, exist_ok=True)
    for r, md, has in targets:
        if has:
            print("#%s %s 已有海报摘要，跳过。" % (r["id"], r["interviewee_name"]))
            continue
        secs = sections(md)
        summary = build_summary(secs, r["interviewee_name"], r.get("topic") or "")
        print("=" * 74)
        print("#%s %s ｜ %s" % (r["id"], r["interviewee_name"], r.get("topic")))
        print("-" * 74)
        print(summary)
        print("-" * 74)
        print("正文节：%s" % "、".join(secs.keys()))

        if not apply_it:
            continue

        with open(os.path.join(BK, "%s.md" % r["id"]), "w", encoding="utf-8") as f:
            f.write(md)
        newmd = md.rstrip() + "\n---SECTION---\n" + summary + "\n"
        out = post(BASE + "/admin", dict(A, action="update", id=r["id"],
                                        fields={"report_md": newmd}))
        print("→ 写入结果：%s" % json.dumps(out, ensure_ascii=False)[:120])
        print("→ 原值已备份到 tools/out/summary-backup/%s.md" % r["id"])

    if not apply_it:
        print("\n（预览模式，未写库。确认无误后加 --apply 执行）")


if __name__ == "__main__":
    main()
