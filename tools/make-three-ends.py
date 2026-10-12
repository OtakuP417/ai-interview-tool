# -*- coding: utf-8 -*-
"""
生成「AI 访谈工具 · 三个入口」一张转发图（HTML 源 → 浏览器截图 PNG）

一张图讲完两件事（2026-10-12 由「说明图 + 入口图」两张合并而来）：
  · 谁能扫／扫哪个 —— 三个二维码并排
  · 扫进去各看什么、能做什么 —— 每列自带职责要点

合并时砍掉的重复项：页眉、页脚、三个列标题、三个角色名各只出现一次；
说明图里「入口 index.html」那行与码下地址重复，删掉；微信语音录音那段提示删掉。
独有内容保留：数据流向带、边界由来说明。

与 make-usage-card.py 的分工：
  · make-usage-card.py = 一页使用说明（五节，只讲怎么用，**图上不放码**）
  · 本脚本             = 只讲「入口与边界」，专门用于群里转发 / 张贴

用法:
    python make-three-ends.py            # 生成 HTML 源
    python make-three-ends.py --shot     # 打印截图用的 PowerShell 片段
    python make-three-ends.py --trim     # 截完图后裁掉底部空白
    python make-three-ends.py --check    # 回读成品图，验三个码的内容

设计要点（沿用一页说明的视觉口径）:
  · 竖版 1080 宽，高度由内容决定（截图后量底边裁）
  · 二维码走 SVG data URI：纯色块图形，放大不糊，纠错级别 H
  · 平安橙 #EA5504 主色 + 浅色底；左上角不放序号（用户明确偏好）
  · 三端同一套色标：橙=访谈端（一线） / 墨=管理端（有口令） / 浅橙=案例经验库（开放只读）
    —— 越开放越浅、越受限越深，颜色自己会说话
  · 二维码块用 margin-top:auto 顶到列底，三列等高 → 三个码横平对齐
  · 全部文字为真实 HTML 文本，改文案只动下面的文案区
"""
import io
import os
import sys

try:
    import segno            # 二维码（纯 Python，可输出矢量 SVG）
except ImportError:         # 缺库时只留文字，不阻断整张图
    segno = None

D = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(D, 'out')
OUT_HTML = os.path.join(OUT_DIR, 'three-ends.html')
OUT_PNG = os.path.join(OUT_DIR, 'three-ends.png')
WIDTH = 1080

# ── 三个入口地址（二维码指向这里）────────────────────────────
# 与「一页使用说明」同域同路径，避免同事手上链接不一致。
BASE = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com'
QR_ADVISOR_URL = BASE + '/'
QR_ADMIN_URL = BASE + '/admin.html'
QR_KB_URL = BASE + '/kb.html'

# ─────────────────────────────────────────────────────────────
# 文案区（改文案只动这一段）
# ─────────────────────────────────────────────────────────────

HERO_KICKER = '平安融易陕分 · 销售团队经验萃取'
HERO_TITLE = 'AI 访谈工具'
HERO_SUB = '三个入口，三个功能'

# 色标贯穿全图：a=橙（访谈端） / b=墨（管理端） / c=浅橙（案例经验库，开放只读）
ENDS = [
    {
        'tone': 'a',
        'end': '访谈端',
        'who': '咨询顾问 · 被访谈人本人填',
        'rows': [
            ('口令', '无 · 凭链接进'),
            ('能看什么', '只看自己这一次的访谈'),
            ('能做什么', '填表 · 访谈 · 出报告'),
        ],
        'qr_url': QR_ADVISOR_URL,
        'qr_show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com',
        'alt': '访谈入口二维码',
    },
    {
        'tone': 'b',
        'end': '管理端',
        'who': '运营岗 · 发起萃取的人',
        'rows': [
            ('口令', '有 · 口令单独发'),
            ('能看什么', '报告正文 · 对话原文<br>姓名 · 工号'),
            ('能做什么', '审核 · 编辑 · 补发邮件'),
        ],
        'qr_url': QR_ADMIN_URL,
        'qr_show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com<wbr>/admin.html',
        'alt': '管理入口二维码',
    },
    {
        'tone': 'c',
        'end': '案例经验库',
        'who': '全体同事 · 不用申请',
        'rows': [
            ('口令', '无 · 凭链接看'),
            ('能看什么', '只有脱敏后的做法与要点'),
            ('能做什么', '只读浏览<br>按动作或场景检索'),
        ],
        'qr_url': QR_KB_URL,
        'qr_show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com<wbr>/kb.html',
        'alt': '案例经验库二维码',
    },
]

# 数据流向（一条线讲清三个端怎么接起来）
FLOW = [
    ('a', '访谈端 · 写入'),
    ('b', '管理端 · 审核归档'),
    ('c', '经验库 · 只读同步（自动）'),
]
FLOW_CAP = '数据只往一个方向走：经验库拿到的永远是审核过的、脱敏后的'

# 为什么这样分（口径与 kb.html 页脚一致，改一处要同步另一处）
NOTE_HTML = (
    '<b>边界是按「谁能看到什么」划的</b>：访谈端凭链接即可填，所以不承载任何他人数据；'
    '管理端看得到姓名与对话原文，所以必须加口令；经验库面向全体同事、凭链接即看，所以'
    '<b>在服务端就把姓名、工号、所属机构与原始对话全部剔除</b> —— 页面本身拿不到这些字段，不是靠前端隐藏。'
    '<b>经验库不用维护</b>：新报告一归档就自动出现在那里，不需要谁去整理。'
)
TIP_HTML = '第一次扫码打开会看到一次风险提醒页，点「确定访问」即可，之后不再出现。'

FOOT_L = ('平安融易陕西分公司',
          '访谈链接由对应运营岗一对一发送 · 链接打不开，找发链接给你的那个人')
FOOT_R = ('三个入口 · 一张图', '扫哪个 · 谁能看什么')

# ─────────────────────────────────────────────────────────────
# 以下为实现，改样式才需要动
# ─────────────────────────────────────────────────────────────

def qr_data_uri(url):
    """二维码 → SVG data URI。

    纠错级别 H（约 30% 容错）：打印折痕、屏幕反光、二次转发压缩后仍可识别。
    缺 segno 时返回空串 —— 卡片照常渲染，只是没有码，不阻断整张图。
    """
    if segno is None:
        return ''
    qr = segno.make(url, error='h')
    return qr.svg_data_uri(scale=10, dark='#1A1D24', light='#FFFFFF', border=0)


CSS = '''
:root {
  --orange: #EA5504;
  --orange-dp: #C24303;
  --orange-lt: #FFF1E8;
  --ink: #1A1D24;
  --ink-2: #454B57;
  --ink-3: #7A8291;
  --line: #E7E9EE;
  --card: #FFFFFF;
  --page: #FAF7F4;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body { background: #E9E5E1; }
body {
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Segoe UI", sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

.page {
  width: @@W@@px;
  margin: 0 auto;
  background: var(--page);
  overflow: hidden;
}

/* ── 页眉 ── */
.hero {
  padding: 44px 56px 40px;
  background: linear-gradient(140deg, var(--orange) 0%, #F2762B 62%, #FF9A4D 100%);
  color: #fff;
  position: relative;
  overflow: hidden;
  text-align: center;
}
.hero::after {
  content: '';
  position: absolute; right: -90px; top: -120px;
  width: 320px; height: 320px; border-radius: 50%;
  background: rgba(255,255,255,.13);
}
.hero-kicker {
  display: inline-block;
  font-size: 20px; letter-spacing: 3px;
  padding: 7px 18px; border-radius: 999px;
  background: rgba(255,255,255,.20);
  border: 1px solid rgba(255,255,255,.42);
  margin-bottom: 22px;
}
.hero-title {
  font-size: 62px; line-height: 1.15; font-weight: 800;
  letter-spacing: 1px;
  text-shadow: 0 3px 10px rgba(120,55,0,.20);
}
.hero-sub {
  margin-top: 14px;
  font-size: 28px; line-height: 1.5;
  color: rgba(255,255,255,.96);
}

/* ── 主体 ── */
.main { padding: 40px 40px 34px; }

/* 三列卡片：职责在上、二维码顶到列底，三列等高 → 三个码横平对齐 */
.grid { display: flex; gap: 20px; }
.col {
  flex: 1;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 22px 20px 22px;
  text-align: center;
  box-shadow: 0 3px 14px rgba(30,20,10,.05);
  display: flex; flex-direction: column;
}
.col-head {
  display: block;
  font-size: 25px; font-weight: 800; letter-spacing: 1px;
  padding: 10px 0; border-radius: 14px;
}
.col-head.a { background: var(--orange); color: #fff; }
.col-head.b { background: var(--ink); color: #fff; }
.col-head.c { background: var(--orange-lt); color: var(--orange-dp); }
.col-who {
  margin-top: 14px;
  font-size: 19px; line-height: 1.45; font-weight: 700;
  color: var(--ink-2);
}

/* 职责要点：标签用浅底小胶囊，值左对齐 */
.rows { margin-top: 16px; text-align: left; }
.row { display: flex; align-items: flex-start; gap: 10px; margin-top: 11px; }
.row:first-child { margin-top: 0; }
.row .k {
  flex: none; width: 72px;
  font-size: 13.5px; line-height: 26px; text-align: center;
  color: var(--ink-3); background: #F4F1EE; border-radius: 8px;
}
.row .v { flex: 1; font-size: 17px; line-height: 26px; color: var(--ink); }

/* 二维码块：margin-top:auto 把它顶到列底 */
.qr-block { margin-top: auto; padding-top: 18px; }
.qr-img { display: flex; justify-content: center; }
.qr-img img { width: 244px; height: 244px; display: block; }
.qr-url {
  margin-top: 10px; font-size: 13px; line-height: 1.5;
  color: #A6ADB8;   /* 断行交给 URL 里的 <wbr>，落在「.」前 */
}

/* 数据流向 */
.flow {
  margin-top: 24px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 18px 20px;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  flex-wrap: wrap;
}
.fnode { font-size: 17px; font-weight: 700; padding: 8px 16px; border-radius: 999px; }
.fnode.a { background: var(--orange); color: #fff; }
.fnode.b { background: var(--ink); color: #fff; }
.fnode.c { background: var(--orange-lt); color: var(--orange-dp); }
.farr { font-size: 20px; color: var(--ink-3); font-weight: 700; }
.flow-cap { margin-top: 12px; text-align: center; font-size: 16px; color: var(--ink-3); }

/* 提示与边界说明 */
.tip {
  margin-top: 22px;
  background: var(--orange-lt);
  border: 1px solid #FBD8BE;
  border-radius: 18px;
  padding: 20px 24px;
  font-size: 19px; line-height: 1.68;
  color: #7A3A05;
}
.tip b { color: var(--orange-dp); }

/* ── 页脚 ── */
.foot {
  padding: 26px 56px 38px;
  border-top: 2px dashed var(--line);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
}
.foot-brand { font-size: 24px; font-weight: 700; }
.foot-sub { font-size: 19px; color: var(--ink-3); margin-top: 7px; line-height: 1.5; }
.foot-r { flex: none; text-align: right; font-size: 19px; color: var(--ink-3); line-height: 1.6; }
'''.replace('@@W@@', str(WIDTH))


def build_html():
    cols = []
    for e in ENDS:
        rows = '\n'.join(
            '        <div class="row"><span class="k">%s</span><span class="v">%s</span></div>'
            % (k, v) for k, v in e['rows'])
        cols.append(
            '      <div class="col">\n'
            '        <div class="col-head %s">%s</div>\n'
            '        <div class="col-who">%s</div>\n'
            '        <div class="rows">\n%s\n        </div>\n'
            '        <div class="qr-block">\n'
            '          <div class="qr-img"><img src="%s" alt="%s"></div>\n'
            '          <div class="qr-url">%s</div>\n'
            '        </div>\n'
            '      </div>' % (e['tone'], e['end'], e['who'], rows,
                                qr_data_uri(e['qr_url']), e['alt'], e['qr_show']))

    parts = []
    for i, (t, n) in enumerate(FLOW):
        if i:
            parts.append('      <span class="farr">→</span>')
        parts.append('      <span class="fnode %s">%s</span>' % (t, n))
    flow = '\n'.join(parts)

    body = (
        '  <div class="hero">\n'
        '    <div class="hero-kicker">%s</div>\n'
        '    <div class="hero-title">%s</div>\n'
        '    <div class="hero-sub">%s</div>\n'
        '  </div>\n' % (HERO_KICKER, HERO_TITLE, HERO_SUB)
        + '  <div class="main">\n'
        + '    <div class="grid">\n' + '\n'.join(cols) + '\n    </div>\n\n'
        + '    <div class="flow">\n' + flow + '\n    </div>\n'
        + '    <div class="flow-cap">' + FLOW_CAP + '</div>\n\n'
        + '    <div class="tip">' + NOTE_HTML + '</div>\n'
        + '    <div class="tip">' + TIP_HTML + '</div>\n'
        + '  </div>\n\n'
        + '  <div class="foot">\n'
        '    <div class="foot-l">\n'
        '      <div class="foot-brand">%s</div>\n'
        '      <div class="foot-sub">%s</div>\n'
        '    </div>\n'
        '    <div class="foot-r">%s<br>%s</div>\n'
        '  </div>\n' % (FOOT_L[0], FOOT_L[1], FOOT_R[0], FOOT_R[1]))

    return ('<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
            '<title>AI 访谈工具 · 三个入口</title>\n<style>%s</style>\n</head>\n<body>\n'
            '<div class="page">\n\n%s\n</div>\n</body>\n</html>\n' % (CSS, body))


def trim(path):
    """按内容实际底边裁掉多余空白。

    无头 Edge 的 --screenshot 只能截「窗口大小」，窗口高度得给足（否则内容被切），
    给足了又会在底部留一段 body 背景色。

    做法：**从下往上分块扫，找全图最后一个非背景行**，它下面全是空白。
    两个坑都在这：①不能取「整幅里最靠上的空白行」——页面中间的留白会被当成底边；
    ②不能「扫到第一个含空白的块就收工」——那一块整块都是空白时，块顶离内容还差一整块。
    分块是为了省内存：整张 2160×11200 一次性转 int 会吃掉几百兆。
    """
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        print('[skip] 未安装 Pillow/numpy，跳过裁剪')
        return
    if not os.path.exists(path):
        print('[skip] 截图不存在，跳过裁剪 ->', path)
        return
    im = Image.open(path).convert('RGB')
    w, h = im.size
    bg = np.array([233, 229, 225], dtype=np.int16)      # body 背景 = 页面之外的空白
    step = 240
    bottom = None
    y = h
    while y > 0:
        y0 = max(0, y - step)
        band = np.asarray(im.crop((0, y0, w, y))).astype(np.int16)
        miss = np.where(~(np.abs(band - bg).max(axis=2) < 10).all(axis=1))[0]
        if len(miss):
            bottom = y0 + int(miss.max()) + 1
            break
        y = y0
    if not bottom:
        print('[trim] 整幅都是背景色，保持原尺寸', (w, h))
        return
    if bottom >= h:
        print('[trim] 内容触到窗口底边（窗口给矮了），未裁剪', (w, h))
        return
    im.crop((0, 0, w, bottom)).save(path)
    print('[ok] 裁剪为', (w, bottom), '->', path)


def check_qrs(png_path):
    """截图后回读二维码：用 OpenCV 解码成品 PNG，确认码里真是那三个地址。

    这是端到端验证 —— 不信任「生成时传对了参数」，直接验产物。
    三张码必须**同时**被解出来且与三个地址逐一相等（少一张 = 图上有码没解出来，要人工看）。
    """
    try:
        import cv2
    except ImportError:
        print('[skip] 未安装 opencv，跳过二维码回读')
        return
    if not os.path.exists(png_path):
        print('[skip] 截图不存在，跳过二维码回读 ->', png_path)
        return
    img = cv2.imread(png_path)
    det = cv2.QRCodeDetector()
    ok, decoded, _pts, _q = det.detectAndDecodeMulti(img)
    got = sorted(s for s in (decoded or []) if s)
    want = sorted(e['qr_url'] for e in ENDS)
    if ok and got == want:
        print('[ok] 二维码回读一致（%d 张）' % len(got))
        return
    print('[FAIL] 二维码回读不一致')
    print('  期望:', want)
    print('  实得:', got)
    sys.exit(1)


def shot():
    """打印截图片段 —— 在 PowerShell 工具里执行（PowerShell 里直调 Edge 才稳定）。"""
    out = OUT_PNG.replace('/', '\\')
    src = OUT_HTML.replace('/', '\\')
    print('[shot] 在 PowerShell 工具里执行：')
    print('$ErrorActionPreference = \'SilentlyContinue\'')
    print('Get-Process msedge | Stop-Process -Force')
    print('Start-Sleep -Milliseconds 1500')
    print('$ud = Join-Path $env:TEMP (\'edge-\' + [guid]::NewGuid().ToString(\'N\'))')
    print('Start-Process -FilePath msedge -ArgumentList @(')
    print('  \'--headless\', \'--disable-gpu\', \'--no-first-run\', \'--hide-scrollbars\',')
    print('  \'--force-device-scale-factor=2\',')
    print('  \'--window-size=%d,2400\',' % WIDTH)
    print('  "--user-data-dir=$ud",')
    print('  "--screenshot=%s",' % out)
    print('  "file:///%s"' % src)
    print(') -Wait')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    html = build_html()
    with io.open(OUT_HTML, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('[ok] HTML ->', OUT_HTML, '（字符数 %d）' % len(html))
    if segno is None:
        print('[warn] 未安装 segno，二维码为空（pip install segno）')
    if '--shot' in sys.argv:
        shot()
    if '--trim' in sys.argv:
        trim(OUT_PNG)
    if '--check' in sys.argv:
        check_qrs(OUT_PNG)


if __name__ == '__main__':
    main()
