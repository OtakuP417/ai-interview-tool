# -*- coding: utf-8 -*-
"""诊断「AI 追问是否有效」：找出 AI 提问后客户短答、AI 未补问就换话题的段落。
这是判断访谈设置能否优化的核心证据。只读。"""
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _admin import BASE, load_password  # noqa: E402

PW = load_password()

# 「方法层」标志词：出现说明这轮真的问到了做法
METHOD_WORDS = ["多久", "几次", "每周", "每月", "每天", "第几天", "什么时候", "频率",
                "怎么说的", "原话", "念一下", "发的是", "微信", "电话", "当面", "群里",
                "名单", "系统", "哪个位置", "怎么筛", "不回", "没反应", "拒绝", "怎么办"]


def post(u, p):
    r = urllib.request.Request(u, data=json.dumps(p).encode(),
                               headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


def n(s):
    return len(re.sub(r"\s", "", str(s or "")))


l = post(BASE + "/admin", {"action": "login", "password": PW})
A = {"token": l["token"], "exp": l["exp"]}
lst = post(BASE + "/admin", dict(A, action="list", page=1, pageSize=50))

print("=" * 100)
print("A. 短答是否被追问：找出「客户答得极短 → AI 未追问关键点」的样本")
print("=" * 100)

total_short = 0
unprobed = 0
cases = []

for r in sorted(lst["rows"], key=lambda x: x["id"]):
    d = post(BASE + "/admin", dict(A, action="detail", id=r["id"]))
    tr = d["row"].get("transcript") or []
    for i, t in enumerate(tr):
        if t.get("role") == "assistant":
            continue
        ans = n(t.get("content"))
        if ans > 8:
            continue
        total_short += 1
        nxt = tr[i + 1] if i + 1 < len(tr) else None
        if not nxt or nxt.get("role") != "assistant":
            continue
        q = str(nxt.get("content") or "")
        # AI 下一轮是「补问同一个点」（含方法层词）还是「换话题」？
        has_method = any(w in q for w in METHOD_WORDS)
        if not has_method:
            unprobed += 1
            cases.append((r["id"], r["interviewee_name"], i, str(t.get("content") or "")[:14],
                          q[:56]))

print("客户 ≤8 字短答共 %d 次；其中 AI 下一轮没追问方法层、直接换话题的 %d 次（%.0f%%）"
      % (total_short, unprobed, 100 * unprobed / max(total_short, 1)))
print()
for pid, name, i, ans, q in cases[:18]:
    print("  #%-3s %-7s 第%02d轮 客户答「%s」→ AI 接着说：%s…" % (pid, name, i, ans, q))

print()
print("=" * 100)
print("B. 「方法层五问」覆盖度：报告里真正落到频次/话术/载体/应对的比例")
print("=" * 100)
ELEMS = ["频次/时机", "话术/方法", "载体/工具", "对方没反应时怎么办"]
print("%-4s %-8s %-6s %-6s %-6s %-6s %s" % ("id", "姓名", "频次", "话术", "载体", "应对", "空答"))
print("-" * 100)
for r in sorted(lst["rows"], key=lambda x: x["id"]):
    d = post(BASE + "/admin", dict(A, action="detail", id=r["id"]))
    md = d["row"].get("report_md") or ""
    if not any(e in md for e in ELEMS):
        print("%-4s %-8s %-6s %-6s %-6s %-6s 旧模板(无四要素)" %
              (r["id"], r["interviewee_name"], "-", "-", "-", "-"))
        continue
    unexp = md.count("访谈中未展开") + md.count("（访谈中未展开）")
    cnt = [md.count(e) for e in ELEMS]
    print("%-4s %-8s %-6s %-6s %-6s %-6s %d" % (
        r["id"], r["interviewee_name"], cnt[0], cnt[1], cnt[2], cnt[3], unexp))

print()
print("=" * 100)
print("C. AI 提问长度：过长会让被访谈人偷懒（一句顶多问）")
print("=" * 100)
for r in sorted(lst["rows"], key=lambda x: x["id"]):
    d = post(BASE + "/admin", dict(A, action="detail", id=r["id"]))
    tr = d["row"].get("transcript") or []
    qs = [n(t.get("content")) for t in tr if t.get("role") == "assistant"]
    ans = [n(t.get("content")) for t in tr if t.get("role") != "assistant"]
    if not qs:
        continue
    multi = sum(1 for t in tr if t.get("role") == "assistant"
                and str(t.get("content") or "").count("？") + str(t.get("content") or "").count("?") > 1)
    print("  #%-3s %-7s AI均长%.0f字/最长%d字 | 问号>1 的轮次 %d/%d | 客户均答%.0f字"
          % (r["id"], r["interviewee_name"], sum(qs) / len(qs), max(qs), multi, len(qs),
             sum(ans) / max(len(ans), 1)))
