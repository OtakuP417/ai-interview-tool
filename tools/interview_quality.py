# -*- coding: utf-8 -*-
"""对现有报告做访谈质量定量体检：判断 AI 访谈设置是否需优化。
只读（走 /api/admin），不写库。
"""
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _admin import BASE, post, load_password  # noqa: E402

PW = load_password()


def post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def cjk_len(s):
    return len(re.sub(r"\s", "", str(s or "")))


login = post(BASE + "/admin", {"action": "login", "password": PW})
AUTH = {"token": login["token"], "exp": login["exp"]}

lst = post(BASE + "/admin", dict(AUTH, action="list", page=1, pageSize=50))
rows = lst.get("rows", [])

# 判定"动作名 vs 方法层"用的关键词
ACTION_ONLY = ["定期维护", "加强沟通", "主动开口", "多沟通", "做好服务", "用心", "保持耐心",
               "积极", "努力", "做好客户维护"]
METHOD_HINT = ["每周", "每月", "每月月初", "每天", "隔", "一次", "第", "天",
               "微信", "电话", "当面", "群", "朋友圈", "名单", "系统", "话术", "说"]

print("=" * 118)
print("访谈质量体检 · 共 %d 份报告" % len(rows))
print("=" * 118)

detail_cache = {}
for r in rows:
    d = post(BASE + "/admin", dict(AUTH, action="detail", id=r["id"]))
    detail_cache[r["id"]] = d.get("row", {})

hdr = "%-4s %-8s %-6s %-7s %-7s %-9s %-9s %-8s %-8s %s" % (
    "id", "姓名", "轮次", "客户字", "均答字", "≤3字轮", "笼统答", "主题漂移", "方法层", "判定")
print(hdr)
print("-" * 118)

agg = {"rounds": 0, "ans": 0, "short": 0, "vague": 0, "method_ok": 0, "reports": 0}
problems = []

for r in sorted(rows, key=lambda x: x["id"]):
    row = detail_cache[r["id"]]
    tr = row.get("transcript") or []
    answers = [t for t in tr if t.get("role") != "assistant"]
    if not answers:
        continue
    lens = [cjk_len(t.get("content")) for t in answers]
    total_ans = sum(lens)
    avg = total_ans / len(lens)
    tiny = sum(1 for n in lens if n <= 3)
    # 笼统答：含动作名但没方法细节
    vague = 0
    for t in answers:
        c = str(t.get("content") or "")
        if any(k in c for k in ACTION_ONLY) and cjk_len(c) < 30:
            vague += 1
    # 主题漂移：主题关键词在对话里是否被覆盖
    topic = str(row.get("topic") or "")
    kw = [w for w in re.split(r"[，,、\s]+", topic) if len(w) >= 2]
    tail = "".join(str(t.get("content") or "") for t in answers[-4:])
    drift = 0 if any(k in tail for k in kw) else 1
    # 方法层：报告里"可复制的经验点"是否带四要素
    md = str(row.get("report_md") or "")
    has4 = sum(1 for k in ["频次/时机", "话术/方法", "载体/工具", "对方没反应时怎么办"]
               if k in md)
    method_ok = 1 if has4 == 4 else 0

    agg["rounds"] += len(answers)
    agg["ans"] += total_ans
    agg["short"] += tiny
    agg["vague"] += vague
    agg["method_ok"] += method_ok
    agg["reports"] += 1

    flags = []
    if avg < 15:
        flags.append("答过短")
    if tiny / len(lens) > 0.3:
        flags.append("半句应付多")
    if not method_ok:
        flags.append("四要素缺(%d/4)" % has4)
    if drift:
        flags.append("主题漂移")
    verdict = "；".join(flags) if flags else "OK"
    if flags:
        problems.append((r["id"], r["interviewee_name"], verdict))

    print("%-4s %-8s %-6s %-7s %-7.1f %-9s %-9s %-8s %-8s %s" % (
        r["id"], r["interviewee_name"], len(answers), total_ans, avg,
        "%d(%.0f%%)" % (tiny, 100 * tiny / len(lens)), vague, drift,
        "%d/4" % has4, verdict))

print("-" * 118)
n = agg["reports"]
print("合计：%d 份 / %d 轮 / 客户共答 %d 字 / 平均每答 %.1f 字 / "
      "≤3字短答 %d 次(%.0f%%) / 笼统答 %d 次 / 四要素齐全 %d/%d 份"
      % (n, agg["rounds"], agg["ans"], agg["ans"] / max(agg["rounds"], 1),
         agg["short"], 100 * agg["short"] / max(agg["rounds"], 1),
         agg["vague"], agg["method_ok"], n))
print()
print("需要关注的报告：")
for pid, name, v in problems:
    print("  #%s %s → %s" % (pid, name, v))

# 单轮最长/最短，看极端
print()
print("逐份「占比最高的回答长度」分布（判断是否普遍答得极短）：")
for r in sorted(rows, key=lambda x: x["id"]):
    tr = detail_cache[r["id"]].get("transcript") or []
    answers = [cjk_len(t.get("content")) for t in tr if t.get("role") != "assistant"]
    if not answers:
        continue
    buckets = {"1-5字": 0, "6-15字": 0, "16-40字": 0, "40字以上": 0}
    for x in answers:
        if x <= 5:
            buckets["1-5字"] += 1
        elif x <= 15:
            buckets["6-15字"] += 1
        elif x <= 40:
            buckets["16-40字"] += 1
        else:
            buckets["40字以上"] += 1
    tot = len(answers)
    print("  #%-3s %-8s " % (r["id"], r["interviewee_name"]) +
          "  ".join("%s:%d(%.0f%%)" % (k, v, 100 * v / tot) for k, v in buckets.items()))
