# -*- coding: utf-8 -*-
"""
生成「AI 访谈工具 · 三个入口」两张转发图（HTML 源 → 浏览器截图 PNG）

两张图的分工（一张讲分工，一张给入口）：
  · three-ends.png    = 三端说明图：三个入口各管什么、谁能看什么、为什么这样分
  · three-ends-qr.png = 三端二维码入口图：三个码并排，扫哪个看你是什么角色

与 make-usage-card.py 的分工：
  · make-usage-card.py = 完整的一页使用说明（六节，面向拿到链接的人）
  · 本脚本             = 只讲「入口与边界」，专门用于群里转发 / 张贴

用法:
    python make-three-ends.py            # 生成两张 HTML 源
    python make-three-ends.py --shot     # 打印截图用的 PowerShell 片段（两张各一段）
    python make-three-ends.py --trim     # 截完图后裁掉底部空白

设计要点（沿用一页说明的视觉口径）:
  · 竖版 1080 宽，高度由内容决定（截图后量底边裁）
  · 二维码走 SVG data URI：纯色块图形，放大不糊，纠错级别 H
  · 平安橙 #EA5504 主色 + 浅色底；左上角不放序号（用户明确偏好）
  · 三端用同一套色标贯穿两张图：橙=访谈端（一线） / 墨=管理端（有口令） / 浅橙=案例经验库（开放只读）
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
WIDTH = 1080

# ── 三个入口地址（二维码指向这里）────────────────────────────
# 与「访谈工具入口-二维码卡」「一页使用说明」同域同路径，避免同事手上链接不一致。
BASE = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com'
QR_ADVISOR_URL = BASE + '/'
QR_ADMIN_URL = BASE + '/admin.html'
QR_KB_URL = BASE + '/kb.html'

# ─────────────────────────────────────────────────────────────
# 文案区（改文案只动这一段）
# ─────────────────────────────────────────────────────────────

HERO_KICKER = '平安融易陕分 · 销售团队经验萃取'
HERO_TITLE = 'AI 访谈工具'

# 说明图（three-ends.png）
NOTE_SUB = '三个入口，各看各的'
# 入口图（three-ends-qr.png）
QR_SUB = '三个入口，各扫各的'

# 色标贯穿两张图：a=橙（访谈端） / b=墨（管理端） / c=浅橙（案例经验库，开放只读）
ENDS = [
    {
        'tone': 'a',
        'end': '访谈端',
        'who': '咨询顾问 · 被访谈人本人填',
        'rows': [
            ('口令', '无 · 凭链接进'),
            ('能看什么', '只看自己这一次的访谈'),
            ('能做什么', '填表 · 访谈 · 出报告'),
            ('入口', '<code>index.html</code>'),
        ],
        'qr_name': '访谈入口',
        'qr_line': '填 4 项 · 跟 AI 聊 20 分钟<br>生成报告并提交',
        'qr_who': '被访谈的人扫这个',
        'qr_url': QR_ADVISOR_URL,
        'qr_show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com',
    },
    {
        'tone': 'b',
        'end': '管理端',
        'who': '运营岗 · 发起萃取的人',
        'rows': [
            ('口令', '有 · 口令单独发'),
            ('能看什么', '报告正文 · 对话原文<br>姓名 · 工号'),
            ('能做什么', '审核 · 编辑 · 补发邮件'),
            ('入口', '<code>admin.html</code>'),
        ],
        'qr_name': '管理入口',
        'qr_line': '看报告 · 审核状态<br>补发邮件 · 打标',
        'qr_who': '需要口令，口令单独发',
        'qr_url': QR_ADMIN_URL,
        'qr_show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com<wbr>/admin.html',
    },
    {
        'tone': 'c',
        'end': '案例经验库',
        'who': '全体同事 · 不用申请',
        'rows': [
            ('口令', '无 · 凭链接看'),
            ('能看什么', '只有脱敏后的做法与要点'),
            ('能做什么', '只读浏览<br>按动作或场景检索'),
            ('入口', '<code>kb.html</code>'),
        ],
        'qr_name': '经验库入口',
        'qr_line': '看所有人的做法要点<br>按动作或场景检索',
        'qr_who': '免口令 · 内容已脱敏',
        'qr_url': QR_KB_URL,
        'qr_show': 'interview-work-d1gs0jzrg2277d75e<wbr>.webapps<wbr>.tcloudbase<wbr>.com<wbr>/kb.html',
    },
]

# 说明图：数据流向（一条线讲清三个端怎么接起来）
FLOW = [
    ('a', '访谈端 · 写入'),
    ('b', '管理端 · 审核归档'),
    ('c', '经验库 · 只读同步（自动）'),
]

# 说明图：为什么这样分（口径与 kb.html 页脚一致，改一处要同步另一处）
NOTE_HTML = (
    '<b>边界是按「谁能看到什么」划的</b>：访谈端凭链接即可填，所以不承载任何他人数据；'
    '管理端看得到姓名与对话原文，所以必须加口令；经验库面向全体同事、凭链接即看，所以'
    '<b>在服务端就把姓名、工号、所属机构与原始对话全部剔除</b> —— 页面本身拿不到这些字段，不是靠前端隐藏。'
    '<b>经验库不用维护</b>：新报告一归档就自动出现在那里，不需要谁去整理。'
)

QR_TIP_HTML = (
    '<b>微信「扫一扫」也能打开链接，页面照常能用。</b>'
    '只是微信里的语音输入有可能录不上音 —— 真遇到了，改用输入法的「语音转文字」，一样不用打字。'
    '想录音最稳，用手机自带「相机」扫码后选「用浏览器打开」。'
    '第一次打开会看到一次风险提醒页，点「确定访问」，以后不再出现。'
    '<b>案例经验库是只读的</b>，上面没有任何可编辑的东西，可以放心转发给任何人。'
)

FOOT_L = ('平安融易陕西分公司',
          '访谈链接由对应运营岗一对一发送 · 链接打不开，找发链接给你的那个人')
# 说明图页脚右栏 / 入口图页脚右栏
NOTE_FOOT_R = ('三个入口 · 说明版', '怎么分工，一图看懂')
QR_FOOT_R = ('三个入口 · 一图转发', '扫哪个，看你是谁')

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

/* 三列卡片：两张图共用同一套列宽与色标 */
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

/* 说明图：标签行 */
.rows { margin-top: 16px; text-align: left; }
.row { display: flex; align-items: flex-start; gap: 10px; margin-top: 11px; }
.row:first-child { margin-top: 0; }
.row .k {
  flex: none; width: 72px;
  font-size: 13.5px; line-height: 26px; text-align: center;
  color: var(--ink-3); background: #F4F1EE; border-radius: 8px;
}
.row .v { flex: 1; font-size: 17px; line-height: 26px; color: var(--ink); }
.row .v code {
  font-family: "SF Mono", Consolas, "Courier New", monospace;
  font-size: 15.5px; color: var(--ink-3);
}

/* 说明图：数据流向 */
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

/* 入口图：二维码 */
.qr-img { display: flex; justify-content: center; margin-top: 20px; }
.qr-img img { width: 264px; height: 264px; display: block; }
.qr-name { margin-top: 18px; font-size: 30px; font-weight: 800; letter-spacing: .5px; }
.qr-line { margin-top: 10px; font-size: 19px; line-height: 1.6; color: var(--ink-2); }
.qr-who {
  margin-top: 12px; font-size: 18px; line-height: 1.5;
  color: var(--orange-dp); font-weight: 600;
}
.qr-url {
  margin-top: 12px; font-size: 13px; line-height: 1.5;
  color: #A6ADB8;   /* 断行交给 URL 里的 <wbr>，落在「.」前 */
}

/* 提示框 */
.tip {
  margin-top: 24px;
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


def hero_html(sub):
    return ('  <div class="hero">\n'
            '    <div class="hero-kicker">%s</div>\n'
            '    <div class="hero-title">%s</div>\n'
            '    <div class="hero-sub">%s</div>\n'
            '  </div>\n' % (HERO_KICKER, HERO_TITLE, sub))


def foot_html(right):
    return ('  <div class="foot">\n'
            '    <div class="foot-l">\n'
            '      <div class="foot-brand">%s</div>\n'
            '      <div class="foot-sub">%s</div>\n'
            '    </div>\n'
            '    <div class="foot-r">%s<br>%s</div>\n'
            '  </div>\n' % (FOOT_L[0], FOOT_L[1], right[0], right[1]))


def page(title, body):
    return ('<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
            '<title>%s</title>\n<style>%s</style>\n</head>\n<body>\n'
            '<div class="page">\n\n%s\n</div>\n</body>\n</html>\n' % (title, CSS, body))


def build_note_html():
    """三端说明图：谁用 / 口令 / 能看什么 / 能做什么 + 数据流向 + 为什么这样分。"""
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
            '      </div>' % (e['tone'], e['end'], e['who'], rows))
    parts = []
    for i, (t, n) in enumerate(FLOW):
        if i:
            parts.append('      <span class="farr">→</span>')
        parts.append('      <span class="fnode %s">%s</span>' % (t, n))
    flow = '\n'.join(parts)

    body = (hero_html(NOTE_SUB)
            + '  <div class="main">\n'
            + '    <div class="grid">\n' + '\n'.join(cols) + '\n    </div>\n\n'
            + '    <div class="flow">\n' + flow + '\n    </div>\n'
            + '    <div class="flow-cap">数据只往一个方向走：经验库拿到的永远是审核过的、脱敏后的</div>\n\n'
            + '    <div class="tip">' + NOTE_HTML + '</div>\n'
            + '  </div>\n\n'
            + foot_html(NOTE_FOOT_R))
    return page('AI 访谈工具 · 三个入口怎么分工', body)


def build_qr_html():
    """三端二维码入口图：三个码并排，扫哪个看你是什么角色。"""
    cards = []
    for e in ENDS:
        cards.append(
            '      <div class="col">\n'
            '        <div class="col-head %s">%s</div>\n'
            '        <div class="qr-img"><img src="%s" alt="%s二维码"></div>\n'
            '        <div class="qr-name">%s</div>\n'
            '        <div class="qr-line">%s</div>\n'
            '        <div class="qr-who">%s</div>\n'
            '        <div class="qr-url">%s</div>\n'
            '      </div>' % (e['tone'], e['end'], qr_data_uri(e['qr_url']),
                             e['qr_name'], e['qr_name'], e['qr_line'],
                             e['qr_who'], e['qr_show']))

    body = (hero_html(QR_SUB)
            + '  <div class="main">\n'
            + '    <div class="grid">\n' + '\n'.join(cards) + '\n    </div>\n\n'
            + '    <div class="tip">' + QR_TIP_HTML + '</div>\n'
            + '  </div>\n\n'
            + foot_html(QR_FOOT_R))
    return page('AI 访谈工具 · 三个入口', body)


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
    if not os.path.exists(path):
        print('[skip] 截图不存在，跳过裁剪 ->', path)
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
    """打印两张图的截图片段 —— 在 PowerShell 工具里逐段执行（一次一张）。"""
    for name, out_png in (('three-ends', 'three-ends.png'),
                          ('three-ends-qr', 'three-ends-qr.png')):
        src = os.path.join(OUT_DIR, name + '.html').replace('/', '\\')
        out = os.path.join(OUT_DIR, out_png).replace('/', '\\')
        print('[shot] %s —— 在 PowerShell 工具里执行：' % name)
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
        print('Test-Path "%s"' % out)
        print()


def check_qrs(png_path):
    """截图后回读二维码：用 OpenCV 解码成品 PNG，确认码里真是那三个地址。

    这是端到端验证 —— 不信任「生成时传对了参数」，直接验产物。
    三张码必须**同时**被解出来且各不相同（少一张 = 图上有码没解出来，要人工看）。
    缺 opencv 时跳过，不阻断流程。
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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = (('three-ends', build_note_html), ('three-ends-qr', build_qr_html))
    for name, builder in targets:
        path = os.path.join(OUT_DIR, name + '.html')
        html = builder()
        with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)
        print('[ok] HTML ->', path, '（字符数 %d）' % len(html))
    if segno is None:
        print('[warn] 未安装 segno，二维码为空（pip install segno）')
    if '--shot' in sys.argv:
        shot()
    if '--trim' in sys.argv:
        trim(os.path.join(OUT_DIR, 'three-ends.png'))
        trim(os.path.join(OUT_DIR, 'three-ends-qr.png'))
    if '--check' in sys.argv:
        check_qrs(os.path.join(OUT_DIR, 'three-ends-qr.png'))


if __name__ == '__main__':
    main()
