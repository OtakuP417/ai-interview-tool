# -*- coding: utf-8 -*-
"""把 memory 日志里的明文管理口令替换为指引（文件可能是 GBK 编码）。"""
import sys, os

target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".workbuddy", "memory", "2026-09-23.md")
raw = open(target, "rb").read()

txt = None
enc_used = None
for enc in ("utf-8", "gb18030", "latin-1"):
    try:
        txt = raw.decode(enc)
        enc_used = enc
        break
    except Exception:
        continue

if txt is None:
    print("无法解码"); sys.exit(1)

n = txt.count("REDACTED_SEE_tools/fetch_reports.secret")
txt = txt.replace("管理口令 REDACTED_SEE_tools/fetch_reports.secret", "管理口令见 tools/fetch_reports.secret（本机，勿外发）")
txt = txt.replace("REDACTED_SEE_tools/fetch_reports.secret", "<ADMIN_PASSWORD 见 tools/fetch_reports.secret>")

open(target, "w", encoding=enc_used, newline="").write(txt)
print("编码:", enc_used, "| 替换:", n, "处")
print("剩余命中:", open(target, encoding=enc_used, errors="replace").read().count("REDACTED_SEE_tools/fetch_reports.secret"))
