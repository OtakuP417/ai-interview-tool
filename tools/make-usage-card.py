# -*- coding: utf-8 -*-
"""
生成「AI 访谈工具 · 一页使用说明」竖版长图（HTML 源 → 浏览器截图 PNG）

分工（2026-10-12 起）：
  · 本脚本 = **只讲怎么用**（五节：四步走 / 六个格子 / 怎么说 / 运营岗动作 / 三条经验）
  · 三个入口的二维码与访问边界，走 make-three-ends.py —— 说明件和入口件分开，
    避免同一张图上既讲用法又贴码，转发时口径互相打架。

用法:
    python make-usage-card.py            # 生成 HTML 源
    python make-usage-card.py --shot     # 打印截图用的 PowerShell 片段
    python make-usage-card.py --trim     # 截完图后裁掉底部空白

设计要点:
  · 竖版 1080 宽（小红书 3:4 / 抖音 9:16 均可裁切），高度不限（长图）
  · 全部文字为真实 HTML 文本（非图片文字），零错字风险
  · 留出「底图槽」：AI 底图到位后，把 <body> 的 --base-img 指过去即可，文字排版不动
  · 配色：平安橙 #EA5504 主色 + 浅色底（符合项目视觉口径）
  · 图上不放二维码（改版前有第⑥节，已摘掉）
"""
import io
import os
import subprocess
import sys

D = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.join(D, 'out', 'usage-card.html')
OUT_PNG = os.path.join(D, 'out', 'usage-card.png')
WIDTH = 1080

# ─────────────────────────────────────────────────────────────
# 文案区（改文案只动这一段，别再碰 CSS）
# ─────────────────────────────────────────────────────────────

STEPS_ADVISOR = [
    ('1', '点开链接，填 4 项', '你的姓名 · UM 号 · 本次访谈主题 · 后线对接人（= 找你要案例的运营岗）',
     '对接人选对了，所属中心会自动带出，报告才知道该发给谁'),
    ('2', '点「开始访谈」，像聊天一样讲', 'AI 提问，你回答。讲你真实做过的那件事，不用写成材料',
     '桌上放台电脑、手机开在旁边也一样；不想打字就点麦克风说'),
    ('3', '边聊边看六个格子亮没亮', '案例背景 / 具体做法 / 方法层细节 / 结果与数据 / 判断与取舍 / 新人易踩的坑',
     '看的是「内容够不够」，不是「聊了多少轮」——聊到够为止，没有轮数上限'),
    ('4', '点「生成报告」，检查后「提交归档」', '报告出来先自己读一遍，事实不对可以用「复制报告」改完再交',
     '提交后系统自动把报告邮件发给后线对接人，你不用再转发'),
]

# 「问到什么程度算够」——用工具真实的提问口径，不是编的
ENOUGH = [
    ('背景', '客户什么情况、怎么接触上的'),
    ('做法', '一步步怎么做的、关键动作'),
    ('方法层', '多久一次、第一句怎么说、用什么载体、对方不回怎么办'),
    ('结果', '带来什么结果，有没有数字'),
    ('判断', '当时怎么判断的、为什么这么选'),
    ('避坑', '新人做这件事容易错在哪'),
]

ADVISOR_SAY = [
    ('话不用漂亮', '「我平时就这么干的」比「规范的表达」有用得多'),
    ('数字越具体越好', '「大概有效果」→「一个月里谈成 3 个」'),
    ('想不起来的就先跳过', 'AI 会绕回来问，别卡在一个问题上'),
    ('原话可以直接说', '你当时跟客户怎么讲的，照着说一遍就行'),
]

OPS_FLOW = [
    ('产生萃取需求', '哪条经验值得沉淀、想给谁看'),
    ('把链接发给这位咨询顾问', '顺带说清：要的是他做过的那件事'),
    ('顾问自己填表 → 访谈 → 生成报告', '全程顾问自助，不用你陪着聊'),
    ('报告邮件自动送达你邮箱', '主题会带上你的名字，方便认领'),
    ('转发给对应业务条线 + 领导', '报告可直接用，也可复制成文本再加工'),
]

# 运营岗视角的经验。第三条的落点要写清「顾问要自己选后线对接人」这个因果 ——
# 运营岗容易以为归因是系统自动的，其实全靠顾问在下拉框里选对人。
# 「退回要有信息量」已移除：退回动作实际由分公司侧操作，不是运营岗的日常动作，
# 放在给运营岗的经验里会分散注意力。
OPS_TIPS = [
    ('找人比找事重要', '选「最近刚做成这件事」的人，不要选「经验最丰富」的人'),
    ('一个主题只找一个顾问', '同一个人一次只聊一件事，讲得才深'),
    ('发链接前先看一眼名单', '顾问填表时要自己选后线对接人，得提醒他选对你的名字'),
]

FIRST_TIME = [
    '填表（3 分钟）→ 访谈（20 分钟）→ 生成报告（1 分钟）→ 提交归档',
    '第一次不熟很正常，聊到六个格子都亮了就算完成',
]

def build_html():
    def li_steps(items):
        out = []
        for no, title, desc, tip in items:
            out.append(f'''      <div class="step">
        <div class="step-no">{no}</div>
        <div class="step-body">
          <div class="step-title">{title}</div>
          <div class="step-desc">{desc}</div>
          <div class="step-tip">{tip}</div>
        </div>
      </div>''')
        return '\n'.join(out)

    def li_two_col(items, cls='pair'):
        out = []
        for a, b in items:
            out.append(f'''      <div class="{cls}">
        <div class="pair-k">{a}</div>
        <div class="pair-v">{b}</div>
      </div>''')
        return '\n'.join(out)

    def li_flow(items):
        out = []
        for i, (title, desc) in enumerate(items):
            out.append(f'''      <div class="flow-item">
        <div class="flow-dot">{i + 1}</div>
        <div class="flow-body">
          <div class="flow-title">{title}</div>
          <div class="flow-desc">{desc}</div>
        </div>
      </div>''')
        return '\n'.join(out)

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>AI 访谈工具 · 一页使用说明</title>
<style>
:root {{
  /* 底图槽：AI 底图到位后，把下面这行换成 url('base.png')，其余不用动 */
  --base-img: none;
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
  position: relative;
  width: {WIDTH}px;
  margin: 0 auto;
  background: var(--page);
  background-image: var(--base-img);
  background-size: cover;
  background-position: center top;
  overflow: hidden;
}}
/* 底图之上的浅色纱罩：保证文字永远可读 */
.page::before {{
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(250,247,244,.82) 0%, rgba(250,247,244,.94) 34%, rgba(250,247,244,.97) 100%);
  pointer-events: none;
  z-index: 0;
}}
.page > * {{ position: relative; z-index: 1; }}

/* ── 页眉 ── */
.hero {{
  padding: 54px 56px 40px;
  background: linear-gradient(140deg, var(--orange) 0%, #F2762B 62%, #FF9A4D 100%);
  color: #fff;
  position: relative;
  overflow: hidden;
}}
.hero::after {{
  content: '';
  position: absolute; right: -90px; top: -110px;
  width: 340px; height: 340px; border-radius: 50%;
  background: rgba(255,255,255,.13);
}}
.hero-kicker {{
  display: inline-block;
  font-size: 21px; letter-spacing: 3px;
  padding: 7px 18px; border-radius: 999px;
  background: rgba(255,255,255,.20);
  border: 1px solid rgba(255,255,255,.42);
  margin-bottom: 26px;
}}
.hero-title {{
  font-size: 66px; line-height: 1.14; font-weight: 800;
  letter-spacing: 1px;
  text-shadow: 0 3px 10px rgba(120,55,0,.20);
}}
.hero-title em {{ font-style: normal; color: #FFE9C9; }}
.hero-sub {{
  margin-top: 22px;
  font-size: 26px; line-height: 1.62;
  color: rgba(255,255,255,.95);
  max-width: 880px;
}}
.hero-meta {{
  margin-top: 30px;
  display: flex; gap: 14px; flex-wrap: wrap;
}}
.hero-chip {{
  font-size: 21px; line-height: 1;
  padding: 12px 20px; border-radius: 999px;
  background: rgba(255,255,255,.16);
  border: 1px solid rgba(255,255,255,.34);
}}

/* ── 主体 ── */
.main {{ padding: 46px 56px 40px; }}

.band {{
  display: flex; align-items: center; gap: 16px;
  margin: 0 0 26px;
}}
.band-idx {{
  flex: none;
  width: 58px; height: 58px; border-radius: 16px;
  background: var(--orange); color: #fff;
  font-size: 30px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px rgba(234,85,4,.26);
}}
.band-idx.alt {{ background: var(--ink); box-shadow: 0 6px 16px rgba(26,29,36,.22); }}
.band-txt .band-t {{
  font-size: 38px; font-weight: 800; line-height: 1.2; letter-spacing: .5px;
}}
.band-txt .band-s {{
  font-size: 22px; color: var(--ink-3); margin-top: 5px; line-height: 1.4;
}}
.band-rule {{ flex: 1; height: 2px; background: var(--line); border-radius: 2px; }}

.block {{ margin-bottom: 42px; }}

/* ── 步骤卡 ── */
.step {{
  display: flex; gap: 20px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 24px 26px;
  margin-bottom: 14px;
  box-shadow: 0 2px 10px rgba(30,20,10,.045);
}}
.step-no {{
  flex: none;
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--orange-lt); color: var(--orange-dp);
  font-size: 28px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}}
.step-body {{ flex: 1; min-width: 0; }}
.step-title {{ font-size: 30px; font-weight: 700; line-height: 1.34; }}
.step-desc {{ font-size: 23px; color: var(--ink-2); line-height: 1.56; margin-top: 9px; }}
.step-tip {{
  font-size: 21px; color: var(--orange-dp); line-height: 1.5; margin-top: 11px;
  padding-left: 20px; position: relative;
}}
.step-tip::before {{
  content: '▸'; position: absolute; left: 0; top: 0; color: var(--orange); font-weight: 700;
}}

/* ── 两列对照 ── */
.pairs {{
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 8px 26px;
  box-shadow: 0 2px 10px rgba(30,20,10,.045);
}}
.pair {{
  display: flex; gap: 20px; align-items: baseline;
  padding: 15px 0;
  border-bottom: 1px dashed var(--line);
}}
.pair:last-child {{ border-bottom: none; }}
.pair-k {{
  flex: none; width: 260px;
  font-size: 25px; font-weight: 700; color: var(--orange-dp); line-height: 1.46;
}}
.pair-v {{ flex: 1; font-size: 23px; color: var(--ink-2); line-height: 1.56; }}

/* ── 流程 ── */
.flow {{ position: relative; padding-left: 6px; }}
.flow-item {{
  display: flex; gap: 18px;
  padding-bottom: 22px;
  position: relative;
}}
.flow-item:last-child {{ padding-bottom: 0; }}
.flow-item::before {{
  content: '';
  position: absolute; left: 21px; top: 46px; bottom: 0;
  width: 2px; background: var(--line);
}}
.flow-item:last-child::before {{ display: none; }}
.flow-dot {{
  flex: none; position: relative; z-index: 1;
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--orange); color: #fff;
  font-size: 23px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}}
.flow-body {{ flex: 1; min-width: 0; padding-top: 3px; }}
.flow-title {{ font-size: 27px; font-weight: 700; line-height: 1.34; }}
.flow-desc {{ font-size: 22px; color: var(--ink-3); line-height: 1.5; margin-top: 6px; }}

/* ── 提示条 ── */
.note {{
  border-radius: 16px;
  padding: 22px 26px;
  font-size: 23px; line-height: 1.62;
  background: var(--orange-lt);
  border: 1px solid #FBD8BE;
  color: #7A3A05;
  margin-bottom: 16px;
}}
.note b {{ color: var(--orange-dp); }}
.note.dark {{
  background: #F2F3F6; border-color: #E2E5EB; color: var(--ink-2);
}}
.note.dark b {{ color: var(--ink); }}

/* ── 页脚 ── */
.foot {{
  margin-top: 8px;
  padding: 30px 56px 44px;
  border-top: 2px dashed var(--line);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
}}
.foot-l {{ }}
.foot-brand {{ font-size: 25px; font-weight: 700; }}
.foot-sub {{ font-size: 20px; color: var(--ink-3); margin-top: 7px; line-height: 1.5; }}
.foot-r {{
  flex: none; text-align: right;
  font-size: 20px; color: var(--ink-3); line-height: 1.6;
}}
.qr-tip b {{ color: var(--orange-dp); }}
</style>
</head>
<body>
<div class="page">

  <div class="hero">
    <div class="hero-kicker">平安融易陕分 · 销售团队经验萃取</div>
    <div class="hero-title">AI 访谈工具<br><em>一页上手说明</em></div>
    <div class="hero-sub">不用写材料、不用做准备。点开链接，跟 AI 聊 20 分钟你做过的一件事，系统自动整理成一份可转发的案例报告。</div>
    <div class="hero-meta">
      <span class="hero-chip">全程约 25 分钟</span>
      <span class="hero-chip">支持语音输入 · 不用打字</span>
      <span class="hero-chip">报告自动邮件送达</span>
    </div>
  </div>

  <div class="main">

    <!-- ① 咨询顾问 -->
    <div class="band">
      <div class="band-idx">壹</div>
      <div class="band-txt">
        <div class="band-t">咨询顾问：四步走完</div>
        <div class="band-s">你是被访谈的人。这一步只有你做了，经验才留得下来。</div>
      </div>
      <div class="band-rule"></div>
    </div>

    <div class="block">
{li_steps(STEPS_ADVISOR)}
    </div>

    <!-- ② 六个格子 -->
    <div class="band">
      <div class="band-idx alt">贰</div>
      <div class="band-txt">
        <div class="band-t">问到什么程度算「够」</div>
        <div class="band-s">报告页有六个格子。聊到它们都亮，报告就有肉；有一个空着，那一块就会是空话。</div>
      </div>
      <div class="band-rule"></div>
    </div>

    <div class="block">
      <div class="pairs">
{li_two_col([(k, v) for k, v in ENOUGH])}
      </div>
    </div>

    <!-- ③ 怎么说 -->
    <div class="band">
      <div class="band-idx alt">叁</div>
      <div class="band-txt">
        <div class="band-t">访谈时这么说，出来的报告才好看</div>
        <div class="band-s">AI 会一路追问。它问得越细，报告里能直接照搬的动作就越多。</div>
      </div>
      <div class="band-rule"></div>
    </div>

    <div class="block">
{li_two_col(ADVISOR_SAY)}
    </div>

    <!-- ④ 运营岗 -->
    <div class="band">
      <div class="band-idx">肆</div>
      <div class="band-txt">
        <div class="band-t">运营岗：你的动作只有两个</div>
        <div class="band-s">发起 + 转发。中间的访谈和报告生成，顾问自助完成。</div>
      </div>
      <div class="band-rule"></div>
    </div>

    <div class="block">
      <div class="flow">
{li_flow(OPS_FLOW)}
      </div>
    </div>

    <!-- ⑤ 运营岗注意事项 -->
    <div class="band">
      <div class="band-idx alt">伍</div>
      <div class="band-txt">
        <div class="band-t">三条经验，影响能不能出好案例</div>
      </div>
      <div class="band-rule"></div>
    </div>

    <div class="block">
{li_two_col(OPS_TIPS)}
    </div>

    <div class="note">
      <b>第一次用，记不住上面这些也没关系。</b>打开链接照着填、照着聊就行，
      工具会在过程中自己提醒你什么时候可以生成报告。
    </div>
    <div class="note dark">
      <b>报告里的内容以你讲的事实为准。</b>地名、客户全称、手机号这类敏感信息不用讲，
      系统会自动遮盖；生成后可以先自己看一遍再提交。
    </div>

  </div>

  <div class="foot">
    <div class="foot-l">
      <div class="foot-brand">平安融易陕西分公司</div>
      <div class="foot-sub">访谈链接由对应运营岗一对一发送 · 如链接打不开，找发链接给你的那个人</div>
    </div>
    <div class="foot-r">
      一页说明 · 竖版<br>
      建议手机竖屏查看
    </div>
  </div>

</div>
</body>
</html>
'''
    return html


def trim():
    """按内容实际底边裁掉多余空白。

    窗口高度得给足（否则内容被切），给足了底部又会留一段 body 背景色。
    做法：**从下往上分块扫，找全图最后一个非背景行**，它下面全是空白。
    取「整幅最靠上的空白行」会把页面中间的留白当底边；扫到第一个含空白的块就收工，
    则整块都是空白时块顶离内容还差一整块 —— 两个坑都避开。
    分块是为了省内存：整张 2160×11200 一次性转 int 会吃掉几百兆。
    """
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        print('[skip] 未安装 Pillow/numpy，跳过裁剪')
        return
    if not os.path.exists(OUT_PNG):
        print('[skip] 截图不存在，跳过裁剪 ->', OUT_PNG)
        return
    im = Image.open(OUT_PNG).convert('RGB')
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
    im.crop((0, 0, w, bottom)).save(OUT_PNG)
    print('[ok] 裁剪为', (w, bottom), '->', OUT_PNG)


def shot():
    """用 Edge 无头截图。必须在 PowerShell 里跑才可靠（bash 直调会被静默终止）。"""
    ps = f'''
$ErrorActionPreference = 'SilentlyContinue'
Get-Process msedge | Stop-Process -Force
Start-Sleep -Milliseconds 1500
$ud = Join-Path $env:TEMP ('edge-usage-' + [guid]::NewGuid().ToString('N'))
$out = "{OUT_PNG.replace('/', '\\')}"
$src = "{OUT_HTML.replace('/', '\\')}"
Start-Process -FilePath msedge -ArgumentList @(
  '--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--window-size={WIDTH},5600',
  "--user-data-dir=$ud",
  "--screenshot=$out",
  "file:///$src"
) -Wait
'''
    print('[shot] 请改用 PowerShell 执行以下脚本：')
    print(ps)


def main():
    os.makedirs(os.path.join(D, 'out'), exist_ok=True)
    html = build_html()
    with io.open(OUT_HTML, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('[ok] HTML ->', OUT_HTML)
    print('[ok] 字符数', len(html))
    if '--shot' in sys.argv:
        shot()
    if '--trim' in sys.argv:
        trim()


if __name__ == '__main__':
    main()
