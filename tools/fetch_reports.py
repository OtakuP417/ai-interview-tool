#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从访谈工具后台拉取已归档报告并做量化分析 / 合规巡检。

用法：
  python fetch_reports.py list                 # 列出全部报告
  python fetch_reports.py show <id>            # 打印某份的对话与报告全文
  python fetch_reports.py stats                # 横向指标对比
  python fetch_reports.py json <id>            # 导出某份为 JSON 到 _report_<id>.json
  python fetch_reports.py scan                 # 全库 PII 巡检（手机号/身份证/小区名/单位名等）

说明：报告正文由 REPORT_PROMPT 约束脱敏，但**对话原文（transcript）是用户
原始输入，不经过模型**，因此小区名、单位名这类"能定位到人"的信息最容易从
对话里漏出去。归档后跑一次 scan 是必要的收尾动作。
改库请走 CloudBase 的 managePgDatabase（UPDATE ... replace(...)::jsonb），
本脚本只读，不做写入。

依赖：仅标准库。
"""
import json, sys, re, os, urllib.request

ADMIN_URL = "https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/admin"

# ─── 管理端口令读取顺序（★ 口令绝不写死在源码里，本文件要进版本库）───
# ① 环境变量 ADMIN_PASSWORD
# ② 同目录下的 fetch_reports.secret（已 gitignore，只存在本机）
# 读取失败则报错退出，不会静默用空口令去请求。
def _load_password():
    p = os.environ.get("ADMIN_PASSWORD", "").strip()
    if p:
        return p
    secret = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_reports.secret")
    if os.path.exists(secret):
        with open(secret, "r", encoding="utf-8") as f:
            return f.read().strip()
    sys.exit(
        "未找到管理端口令。请二选一：\n"
        "  ① 设置环境变量 ADMIN_PASSWORD\n"
        "  ② 在 tools/ 下新建 fetch_reports.secret，内容写口令（该文件已被 .gitignore 忽略）"
    )

PASSWORD = _load_password()

# ─── 合规巡检用的 PII 特征 ───
# 说明：除了标准的证件类，真正容易漏的是「能定位到具体客户」的软信息——
# 小区/楼盘名、具体办理单位名。信贷场景下这类信息结合行业足以反推客户身份。
PII_PATTERNS = {
    "手机号": r"1[3-9]\d{9}",
    "身份证": r"\d{17}[\dXx]",
    "银行卡": r"\b\d{16,19}\b",
    "车牌": r"[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{5}",
    "小区/楼盘": r"[\u4e00-\u9fa5]{2,6}(?:小区|花园|公寓|公馆|华府|新城|广场|大厦|壹号|国际城|苑|湾|府|院|庭|阁|邸|墅)",
    "具体单位": r"[\u4e00-\u9fa5]{2,8}(?:房管局|支行|分行|档案室|不动产登记中心)",
    "企业全称": r"[\u4e00-\u9fa5]{2,10}(?:有限公司|有限责任公司|经营部|商行|门市部)",
}


def _post(payload):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ADMIN_URL, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def login():
    """登录拿 token。注意：后续请求必须同时带 token 和 exp，漏 exp 会被拒。"""
    d = _post({"action": "login", "password": PASSWORD})
    if not d.get("token"):
        raise SystemExit("登录失败：" + json.dumps(d, ensure_ascii=False))
    return d["token"], d["exp"]


def call(action, **kw):
    token, exp = login()
    payload = {"token": token, "exp": exp, "action": action}
    payload.update(kw)
    d = _post(payload)
    if d.get("error"):
        raise SystemExit("接口返回错误：" + str(d["error"]))
    return d


def rows_all():
    return call("list", q="", city="", page=1, pageSize=200).get("rows", [])


def detail(rid):
    d = call("detail", id=rid)
    return d.get("row") or d


def transcript_of(row):
    tr = row.get("transcript") or []
    if isinstance(tr, str):
        tr = json.loads(tr)
    return tr


def cmd_list():
    rows = rows_all()
    print("%-4s %-8s %-14s %-16s %-7s %s" % ("id", "姓名", "UM 号", "主题", "城市", "轮次"))
    print("-" * 72)
    for r in rows:
        print("%-4s %-8s %-14s %-16s %-7s %s" % (
            r.get("id"), r.get("interviewee_name"), r.get("interviewee_um"),
            (r.get("topic") or "")[:14], r.get("city"), r.get("round_count")))
    print("\n共 %d 份" % len(rows))


def cmd_show(rid):
    r = detail(rid)
    print("=" * 70)
    print("%s（%s） · %s · %s" % (
        r.get("interviewee_name"), r.get("interviewee_position"),
        r.get("topic"), r.get("city")))
    print("UM %s | %s 轮 | 后线对接人 %s（%s）" % (
        r.get("interviewee_um"), r.get("round_count"),
        r.get("backend_owner_name"), r.get("backend_owner_org")))
    print("=" * 70)
    print("\n【报告正文】\n")
    print(r.get("report_md", ""))
    print("\n【对话逐轮】\n")
    for i, m in enumerate(transcript_of(r)):
        tag = "AI " if m.get("role") == "assistant" else "客户"
        c = (m.get("content") or "").replace("\n", " ")
        print("#%02d %s (%d字) %s" % (i, tag, len(c), c))


def cmd_stats():
    rows = rows_all()
    print("%-4s %-8s %-10s %5s %7s %6s %7s %7s" % (
        "id", "姓名", "主题", "轮次", "均答字", "最短", "最长", "短于20"))
    print("-" * 66)
    for r in rows:
        tr = transcript_of(detail(r["id"]))
        lens = [len(m.get("content") or "") for m in tr if m.get("role") == "user"]
        if not lens:
            continue
        print("%-4s %-8s %-10s %5s %7.0f %6d %7d %7d" % (
            r["id"], r.get("interviewee_name"), (r.get("topic") or "")[:8],
            r.get("round_count"), sum(lens) / len(lens),
            min(lens), max(lens), sum(1 for l in lens if l < 20)))


def cmd_json(rid):
    r = detail(rid)
    # ★ 固定输出到工具所在目录（.gitignore 已忽略 _report_*.json），
    # 不跟随 cwd —— 否则在仓库根目录执行会落到根目录，绕过忽略规则（2026-10-10 踩过）。
    fn = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_report_%s.json" % rid)
    with open(fn, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    print("已导出 -> " + fn)


def cmd_scan():
    """全库 PII 巡检：报告正文 + 对话原文分别扫，指出哪一份哪一类有命中。
    退出码：有命中返回 1，全干净返回 0（方便接进自动化流程）。"""
    rows = rows_all()
    print("全库 PII 巡检（报告正文 + 对话原文）")
    print("=" * 74)
    total = 0
    for r in rows:
        d = detail(r["id"])
        rep = d.get("report_md") or ""
        tr = " ".join((m.get("content") or "") for m in transcript_of(d))
        hits = {}
        for k, p in PII_PATTERNS.items():
            a = sorted(set(re.findall(p, rep)))
            b = sorted(set(re.findall(p, tr)))
            if a or b:
                hits[k] = (a, b)
        print("#%-3s %-12s" % (r["id"], r.get("interviewee_name") or ""), end="  ")
        if not hits:
            print("干净")
            continue
        print("发现 %d 类" % len(hits))
        for k, (a, b) in hits.items():
            total += len(a) + len(b)
            print("      %-8s 报告%s 对话%s" % (k, a or "-", b or "-"))
    print("=" * 74)
    if total:
        print("合计 %d 处待核查 —— 注意：报告正文里的「某小区」等泛称属正常写法，" % total)
        print("需人工确认的是能定位到具体客户/商户的原名。")
    else:
        print("未发现 PII 命中 ✓")
    return 1 if total else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "list":
        cmd_list()
    elif cmd == "show":
        cmd_show(args[0])
    elif cmd == "stats":
        cmd_stats()
    elif cmd == "json":
        cmd_json(args[0])
    elif cmd == "scan":
        sys.exit(cmd_scan())
    else:
        print(__doc__)
