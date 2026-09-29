# -*- coding: utf-8 -*-
"""tools/ 下所有脚本共用的后台接口与口令读取。

口令来源（按优先级）：
  1. 环境变量 ADMIN_PASSWORD
  2. tools/fetch_reports.secret（本机专用，已被 .gitignore 忽略）

★ 口令绝不写进任何入库文件。本模块是唯一出口。
"""
import json
import os
import sys
import urllib.request

BASE = "https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api"
_SECRET = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_reports.secret")


def load_password():
    p = (os.environ.get("ADMIN_PASSWORD") or "").strip()
    if p:
        return p
    if os.path.exists(_SECRET):
        with open(_SECRET, "r", encoding="utf-8") as f:
            v = f.read().strip()
        if v:
            return v
    sys.exit(
        "未找到管理端口令。请二选一：\n"
        "  ① 设置环境变量 ADMIN_PASSWORD\n"
        "  ② 在 tools/fetch_reports.secret 里写上口令（该文件已被 .gitignore 忽略）"
    )


_PW = None


def post(url, payload, timeout=60):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def admin(payload, timeout=60):
    """带 token 的后台调用；首次自动登录。"""
    global _PW
    if "token" not in payload:
        if _PW is None:
            _PW = load_password()
        if "action" not in payload:
            payload = dict(payload, action="")
        if payload.get("action") != "login":
            lg = post(BASE + "/admin", {"action": "login", "password": _PW}, timeout)
            payload = dict(payload, token=lg["token"], exp=lg.get("exp"))
    return post(BASE + "/admin", payload, timeout)
