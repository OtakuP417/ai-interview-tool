# -*- coding: utf-8 -*-
"""生成「访谈工具入口」分享卡（二维码 + 使用说明），用于发到微信群 / 打印张贴。

背景：CloudBase 默认域名对浏览器导航请求会插入腾讯云「风险提醒」中间页，
微信内置浏览器还会额外提示「非微信官方网页」。所以卡片要引导同事
用手机「相机」扫码（走系统浏览器），而不是微信「扫一扫」。

用法：python make-share-card.py
产物：tools/out/访谈工具入口-二维码卡.png
"""
import os
from PIL import Image, ImageDraw, ImageFont
import segno

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "out")
os.makedirs(OUT_DIR, exist_ok=True)

URL = "https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com/"
BUILD = "v2026.09.24-b"
ORANGE = (234, 85, 4)          # 平安橙 #EA5504
INK = (42, 33, 27)             # 暖黑
GRAY = (122, 112, 104)
LIGHT = (250, 246, 242)

W = 1000
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"   # 微软雅黑 Bold
FONT_R = "C:/Windows/Fonts/msyh.ttc"     # 微软雅黑 Regular


def font(path, size):
    return ImageFont.truetype(path, size)


def text_c(d, cx, y, s, f, fill):
    """水平居中绘制"""
    w = d.textlength(s, font=f)
    d.text((cx - w / 2, y), s, font=f, fill=fill)
    return w


def main():
    # ── 1) 二维码：高纠错，保证打印/截图后仍可识别 ──
    qr = segno.make(URL, error="h")
    qr_path = os.path.join(OUT_DIR, "_qr_tmp.png")
    qr.save(qr_path, scale=20, border=0, dark="#2A211B", light="#FFFFFF")
    qrimg = Image.open(qr_path).convert("RGB")
    QR = 520
    qrimg = qrimg.resize((QR, QR), Image.LANCZOS)

    # ── 2) 画布 ──
    H = 1380
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)

    # 顶部橙条
    d.rectangle([0, 0, W, 172], fill=ORANGE)
    d.text((60, 40), "销售团队经验萃取", font=font(FONT_B, 52), fill="white")
    d.text((62, 108), "AI 访谈工具 · 访谈入口", font=font(FONT_R, 26),
           fill=(255, 232, 216))

    # 引导语
    y = 216
    text_c(d, W / 2, y, "微信里点不开这个链接，请用手机「相机」扫码", font(FONT_B, 30), INK)

    # 二维码 + 橙框
    qx, qy = (W - QR) // 2, 276
    pad = 18
    d.rounded_rectangle([qx - pad, qy - pad, qx + QR + pad, qy + QR + pad],
                        radius=16, outline=ORANGE, width=4)
    img.paste(qrimg, (qx, qy))

    # 网址
    y = qy + QR + pad + 22
    text_c(d, W / 2, y, URL.replace("https://", ""), font(FONT_R, 21), GRAY)

    # 分隔线
    y += 52
    d.line([80, y, W - 80, y], fill=(232, 224, 217), width=2)

    # 三步说明
    steps = [
        ("1", "打开手机自带「相机」，对准二维码",
         "不要用微信的「扫一扫」，那样还是会走微信浏览器"),
        ("2", "屏幕上方出现链接横幅，点它，选「用浏览器打开」",
         "iPhone 用 Safari；安卓选 Chrome 或系统浏览器"),
        ("3", "第一次会看到「风险提醒」页，点「确定访问」",
         "只用点这一次，以后不再出现"),
    ]
    y += 34
    for num, title, sub in steps:
        # 序号圆标
        d.ellipse([80, y + 2, 122, y + 44], fill=ORANGE)
        nf = font(FONT_B, 26)
        nw = d.textlength(num, font=nf)
        d.text((101 - nw / 2, y + 8), num, font=nf, fill="white")
        d.text((144, y), title, font=font(FONT_B, 27), fill=INK)
        d.text((144, y + 38), sub, font=font(FONT_R, 21), fill=GRAY)
        y += 96

    # 底部提示条
    y += 10
    d.rounded_rectangle([60, y, W - 60, y + 96], radius=14, fill=LIGHT)
    d.text((88, y + 16), "打开后请翻到页面最底部，确认这一行：", font=font(FONT_R, 22), fill=GRAY)
    d.text((88, y + 48), "程序版本 " + BUILD, font=font(FONT_B, 28), fill=ORANGE)

    out = os.path.join(OUT_DIR, "访谈工具入口-二维码卡.png")
    img.save(out, "PNG")
    try:
        os.remove(qr_path)
    except OSError:
        pass
    print("OK", out, os.path.getsize(out), "bytes")
    return out


if __name__ == "__main__":
    main()
