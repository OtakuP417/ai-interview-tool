# -*- coding: utf-8 -*-
"""把已采纳报告批量生成「可分享」素材：每份出 一图流(简略) + 完整报告(长图) 两套 HTML。
海报摘要缺失的报告会自动回退到六节版式，本脚本同时标出哪些缺摘要。
只读 DB + 只调 /api/poster，不写库。
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _admin import BASE, post, load_password  # noqa: E402

PW = load_password()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "share")


def post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def standalone(markup, css):
    return ('<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8">'
            '<style>html,body{margin:0;padding:0;background:#fff;}</style>'
            + (css or "") + "</head>\n<body>\n" + markup + "\n</body></html>")


login = post(BASE + "/admin", {"action": "login", "password": PW})
A = {"token": login["token"], "exp": login["exp"]}
lst = post(BASE + "/admin", dict(A, action="list", page=1, pageSize=50))

os.makedirs(OUT, exist_ok=True)
index = []
print("%-4s %-8s %-24s %-12s %s" % ("id", "姓名", "主题", "一图流", "完整报告"))
print("-" * 82)

for r in sorted(lst["rows"], key=lambda x: x["id"]):
    d = post(BASE + "/admin", dict(A, action="detail", id=r["id"]))
    row = d.get("row") or {}
    md = row.get("report_md") or ""
    if not md:
        continue
    y = str(row.get("created_at") or "")[:4] or "2026"
    meta = {
        "name": row.get("interviewee_name") or "—",
        "position": row.get("interviewee_position") or "",
        "um": row.get("interviewee_um") or "",
        "city": row.get("city") or "",
        "topic": row.get("topic") or "",
        "owner": row.get("backend_owner_name") or "",
        "ownerOrg": row.get("backend_owner_org") or "",
        "code": "IV-" + y + "-" + str(row["id"]).zfill(4),
        "date": str(row.get("created_at") or "")[:10],
    }
    got = {}
    for kind in ("flow", "full"):
        p = post(BASE + "/poster", {"report_md": md, "meta": meta, "kind": kind})
        got[kind] = p
        fn = "%02d-%s-%s.html" % (row["id"], meta["name"], kind)
        if p.get("ok"):
            with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
                f.write(standalone(p.get("html") or "", p.get("css") or ""))
    # 服务端现在对「显式要 flow 但缺摘要」回 ok:false，不再静默降级 —— 如实标注
    if got["flow"].get("ok"):
        tag = "一图流✓"
    elif got["flow"].get("error") == "poster_summary_missing":
        tag = "无摘要·仅长图"
    else:
        tag = "出图失败"
    print("%-4s %-8s %-24s %-14s w=%s h=%s" % (
        row["id"], meta["name"], str(meta["topic"])[:22], tag,
        got["full"].get("w"), got["full"].get("h")))
    index.append({
        "id": row["id"], "name": meta["name"], "topic": meta["topic"],
        "status": row.get("status"),
        "flow_ok": bool(got["flow"].get("ok")),
        "flow_error": got["flow"].get("error") or "",
        "full_ok": bool(got["full"].get("ok")),
        "make": meta["code"], "date": meta["date"],
    })

with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
    json.dump(index, f, ensure_ascii=False, indent=2)
print("\n产物目录：" + OUT)
print("可出简略一图流的：#%s" % [i["id"] for i in index if i["flow_ok"]])
print("只能出完整报告长图的：#%s" % [i["id"] for i in index if not i["flow_ok"]])
