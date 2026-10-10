# -*- coding: utf-8 -*-
"""
生成「AI 访谈工具 · 两个入口」简版转发图（HTML 源 → 浏览器截图 PNG）

与 make-usage-card.py 的分工：
  · make-usage-card.py  = 完整的一页使用说明（六节：四步走 / 六个格子 / 怎么说 / 运营流程 / 经验 / 二维码）
  · 本脚本             = 只讲一件事：两个入口在哪、各扫哪个。专门用于群里转发。

用法:
    python make-qr-card.py            # 生成 HTML 源
    python make-qr-card.py --shot     # 打印截图用的 PowerShell 片段

设计要点（沿用一页说明的视觉口径）:
  · 竖版 1080 宽，高度由内容决定（截图后量底边裁）
  · 二维码走 SVG data URI：纯色块图形，放大不糊，纠错级别 H
  · 平安橙 #EA5504 主色 + 浅色底；左上角不放序号（用户明确偏好）
  · 全部文字为真实 HTML 文本，改文案只动上面的文案区
"""
import io
import os
import sys

try:
    import segno            # 二维码（纯 Python，可输出矢量 SVG）
except ImportError:         # 缺库时只留文字，不阻断整张图
    segno = None

D = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.join(D, 'out', 'qr-card.html')
OUT_PNG = os.path.join(D, 'out', 'qr-card.png')
WIDTH = 1080

# ── 两个入口地址（二维码指向这里）────────────────────────────
# 与「访谈工具入口-二维码卡」「一页使用说明」同域同路径，避免同事手上链接不一致。
QR_ADVISOR_URL = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com/'
QR_ADMIN_URL = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com/admin.html'

# ─────────────────────────────────────────────────────────────
# 文案区（改文案只动这一段）
# ─────────────────────────────────────────────────────────────

HERO_KICKER = '平安融易陕分 · 销售团队经验萃取'
HERO_TITLE = 'AI 访谈工具'
HERO_SUB = '两个入口，各扫各的'

CARDS = [
    {
        'role': '咨询顾问',
        'name': '访谈入口',
        'line1': '填 4 项 · 跟 AI 聊 20 分钟',
        'line2': '生成报告并提交',
        'who': '被访谈的人扫这个',
        'url': QR_ADVISOR_URL,
        'show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com',
        'alt': False,
    },
    {
        'role': '运营岗',
        'name': '管理入口',
        'line1': '看报告 · 审核状态',
        'line2': '补发邮件',
        'who': '需要口令，口令单独发',
        'url': QR_ADMIN_URL,
        'show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com<wbr>/admin.html',
        'alt': True,
    },
]

TIP_HTML = (
    '<b>微信「扫一扫」也能打开链接，页面照常能用。</b>'
    '只是微信里的语音输入有可能录不上音 —— 真遇到了，改用输入法的「语音转文字」，一样不用打字。'
    '想录音最稳，用手机自带「相机」扫码后选「用浏览器打开」。'
    '第一次打开会看到一次风险提醒页，点「确定访问」，以后不再出现。'
)

FOOT_L = ('平安融易陕西分公司',
          '访谈链接由对应运营岗一对一发送 · 链接打不开，找发链接给你的那个人')
FOOT_R = ('两个入口 · 简版', '一张图转发即可')


def qr_data_uri(url):
    """二维码 → SVG data URI。

    纠错级别 H（约 30% 容错）：打印折痕、屏幕反光、二次转发压缩后仍可识别。
    缺 segno 时返回空串 —— 卡片照常渲染，只是没有码，不阻断整张图。
    """
    if segno is None:
        return ''
    qr = segno.make(url, error='h')
    return qr.svg_data_uri(scale=10, dark='#1A1D24', light='#FFFFFF', border=0)


def build_html():
    def card_html(c):
        return f'''      <div class="qr-card">
        <div class="qr-role{' alt' if c['alt'] else ''}">{c['role']}</div>
        <div class="qr-img"><img src="{qr_data_uri(c['url'])}" alt="{c['name']}二维码"></div>
        <div class="qr-name">{c['name']}</div>
        <div class="qr-line">{c['line1']}<br>{c['line2']}</div>
        <div class="qr-who">{c['who']}</div>
        <div class="qr-url">{c['show']}</div>
      </div>'''

    cards = '\n'.join(card_html(c) for c in CARDS)

    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>AI 访谈工具 · 两个入口</title>
<style>
:root {{
  --orange: #EA5504;
  --orange-dp: #C24303;
  --orange-lt: #FFF1E8;
  --ink: #1A1D24;
  --ink-2: #454B57;
  --ink-3: #7A8291;
  --line: #E7E9EE;
  --card: #FFFFFF;
  --page: #FAF7F4;
}}
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

html, body {{ background: #E9E5E1; }}
body {{
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Segoe UI", sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}}

.page {{
  width: {WIDTH}px;
  margin: 0 auto;
  background: var(--page);
  overflow: hidden;
}}

/* ── 页眉 ── */
.hero {{
  padding: 44px 56px 40px;
  background: linear-gradient(140deg, var(--orange) 0%, #F2762B 62%, #FF9A4D 100%);
  color: #fff;
  position: relative;
  overflow: hidden;
  text-align: center;
}}
.hero::after {{
  content: '';
  position: absolute; right: -90px; top: -120px;
  width: 320px; height: 320px; border-radius: 50%;
  background: rgba(255,255,255,.13);
}}
.hero-kicker {{
  display: inline-block;
  font-size: 20px; letter-spacing: 3px;
  padding: 7px 18px; border-radius: 999px;
  background: rgba(255,255,255,.20);
  border: 1px solid rgba(255,255,255,.42);
  margin-bottom: 22px;
}}
.hero-title {{
  font-size: 62px; line-height: 1.15; font-weight: 800;
  letter-spacing: 1px;
  text-shadow: 0 3px 10px rgba(120,55,0,.20);
}}
.hero-sub {{
  margin-top: 14px;
  font-size: 28px; line-height: 1.5;
  color: rgba(255,255,255,.96);
}}

/* ── 主体 ── */
.main {{ padding: 42px 56px 34px; }}

.qr-row {{ display: flex; gap: 26px; }}
.qr-card {{
  flex: 1;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 26px 22px 24px;
  text-align: center;
  box-shadow: 0 3px 14px rgba(30,20,10,.05);
}}
.qr-role {{
  display: inline-block;
  font-size: 21px; font-weight: 700; letter-spacing: 1px;
  color: #fff; background: var(--orange);
  padding: 7px 22px; border-radius: 999px;
}}
.qr-role.alt {{ background: var(--ink); }}
.qr-img {{ display: flex; justify-content: center; margin-top: 20px; }}
.qr-img img {{ width: 300px; height: 300px; display: block; }}
.qr-name {{ margin-top: 20px; font-size: 33px; font-weight: 800; letter-spacing: .5px; }}
.qr-line {{ margin-top: 10px; font-size: 21px; line-height: 1.62; color: var(--ink-2); }}
.qr-who {{
  margin-top: 12px; font-size: 20px; line-height: 1.5;
  color: var(--orange-dp); font-weight: 600;
}}
.qr-url {{
  margin-top: 14px; font-size: 14px; line-height: 1.5;
  color: #A6ADB8;   /* 断行交给 URL 里的 <wbr>，落在「.」前 */
}}

.tip {{
  margin-top: 26px;
  background: var(--orange-lt);
  border: 1px solid #FBD8BE;
  border-radius: 18px;
  padding: 22px 26px;
  font-size: 21px; line-height: 1.68;
  color: #7A3A05;
}}
.tip b {{ color: var(--orange-dp); }}

/* ── 页脚 ── */
.foot {{
  padding: 26px 56px 38px;
  border-top: 2px dashed var(--line);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
}}
.foot-brand {{ font-size: 24px; font-weight: 700; }}
.foot-sub {{ font-size: 19px; color: var(--ink-3); margin-top: 7px; line-height: 1.5; }}
.foot-r {{ flex: none; text-align: right; font-size: 19px; color: var(--ink-3); line-height: 1.6; }}
</style>
</head>
<body>
<div class="page">

  <div class="hero">
    <div class="hero-kicker">{HERO_KICKER}</div>
    <div class="hero-title">{HERO_TITLE}</div>
    <div class="hero-sub">{HERO_SUB}</div>
  </div>

  <div class="main">
    <div class="qr-row">
{cards}
    </div>
    <div class="tip">{TIP_HTML}</div>
  </div>

  <div class="foot">
    <div class="foot-l">
      <div class="foot-brand">{FOOT_L[0]}</div>
      <div class="foot-sub">{FOOT_L[1]}</div>
    </div>
    <div class="foot-r">
      {FOOT_R[0]}<br>{FOOT_R[1]}
    </div>
  </div>

</div>
</body>
</html>
'''


def trim(path):
    """按内容实际底边裁掉多余空白。

    无头 Edge 的 --screenshot 只能截「窗口大小」，窗口高度得给足（否则内容被切），
    给足了又会在底部留一段 body 背景色。这里从下往上找第一整行的空白，
    那一行就是页面底边。缺 Pillow/numpy 时跳过，不阻断流程。
    """
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        print('[skip] 未安装 Pillow/numpy，跳过裁剪')
        return
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(int)
    h, w, _ = a.shape
    bg = np.array([233, 229, 225])       # body 背景 = 页面之外的空白
    is_bg = (np.abs(a - bg).sum(axis=2) < 10).all(axis=1)
    rows = np.where(is_bg)[0]
    if not len(rows) or rows.min() == 0:
        print('[trim] 没找到整行空白，保持原尺寸', (w, h))
        return
    bottom = int(rows.min())
    im.crop((0, 0, w, bottom)).save(path)
    print('[ok] 裁剪为', (w, bottom), '->', path)


def shot():
    ps = f'''
$ErrorActionPreference = 'SilentlyContinue'
Get-Process msedge | Stop-Process -Force
Start-Sleep -Milliseconds 1500
$ud = Join-Path $env:TEMP ('edge-qrcard-' + [guid]::NewGuid().ToString('N'))
$out = "{OUT_PNG.replace('/', '\\')}"
$src = "{OUT_HTML.replace('/', '\\')}"
Start-Process -FilePath msedge -ArgumentList @(
  '--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--window-size={WIDTH},1300',
  "--user-data-dir=$ud",
  "--screenshot=$out",
  "file:///$src"
) -Wait
'''
    print('[shot] 在 PowerShell 工具里执行：')
    print(ps)


def main():
    os.makedirs(os.path.join(D, 'out'), exist_ok=True)
    html = build_html()
    with io.open(OUT_HTML, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('[ok] HTML ->', OUT_HTML)
    print('[ok] 字符数', len(html))
    if segno is None:
        print('[warn] 未安装 segno，二维码为空（pip install segno）')
    if '--shot' in sys.argv:
        shot()
    if '--trim' in sys.argv:
        trim(OUT_PNG)


if __name__ == '__main__':
    main()
