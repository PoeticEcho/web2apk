#!/usr/bin/env python3
"""web2apk 기본 런처 아이콘 생성기 (Pillow).

앱 이름의 첫 글자(한글/영문/이모지)를 브랜드 색 배경 위에 그려 1024x1024 PNG 로 저장한다.
Node 쪽(scripts/lib/icon.mjs)이 Pillow 가 없을 때만 순수 JS 로 대체하므로, 이 스크립트는
"있으면 쓰는" 경로다. 결과 요약을 JSON 으로 stdout 에 출력한다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic-Bold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
]


def parse_color(value: str) -> tuple[int, int, int, int]:
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise SystemExit(f"색상 형식이 올바르지 않습니다: {value}")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), 255)


def pick_font(text: str, explicit: str | None):
    from PIL import ImageFont

    candidates = []
    if explicit:
        candidates.append(explicit)
    env_font = os.environ.get("WEB2APK_FONT")
    if env_font:
        candidates.append(env_font)
    candidates.extend(FONT_CANDIDATES)

    for path in candidates:
        if not path or not os.path.exists(path):
            continue
        try:
            font = ImageFont.truetype(path, 620)
        except Exception:
            continue
        try:
            mask = font.getmask(text)
            if mask.getbbox() is None:  # 글리프가 없으면 두부(빈 사각형)
                continue
        except Exception:
            pass
        return font, path
    return ImageFont.load_default(), "(Pillow 기본 폰트)"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True, help="아이콘에 그릴 글자(보통 앱 이름 첫 글자)")
    parser.add_argument("--out", required=True, help="출력 PNG 경로")
    parser.add_argument("--bg", default="#111827")
    parser.add_argument("--fg", default="#FFFFFF")
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--font", default=None)
    args = parser.parse_args()

    try:
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError:
        print(json.dumps({"ok": False, "reason": "pillow-not-installed"}))
        sys.exit(3)

    size = args.size
    bg = parse_color(args.bg)
    fg = parse_color(args.fg)

    # 배경: 위에서 아래로 아주 살짝 어두워지는 그라데이션
    img = Image.new("RGBA", (size, size), bg)
    top = tuple(min(255, int(c * 1.12)) if i < 3 else c for i, c in enumerate(bg))
    bottom = tuple(max(0, int(c * 0.86)) if i < 3 else c for i, c in enumerate(bg))
    gradient = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        gradient.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    img = gradient.resize((size, size))

    draw = ImageDraw.Draw(img)
    text = args.text.strip() or "A"
    if len(text) > 2:
        text = text[0]

    font, font_path = pick_font(text, args.font)
    # 글자가 아이콘의 약 52% 를 차지하도록 크기 보정
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        height = max(1, bbox[3] - bbox[1])
        scale = (size * 0.52) / height
        if abs(scale - 1) > 0.01:
            from PIL import ImageFont

            font = ImageFont.truetype(font_path, max(16, int(620 * scale))) if os.path.exists(font_path) else font
    except Exception:
        pass

    try:
        draw.text((size / 2, size / 2), text, font=font, fill=fg, anchor="mm")
    except Exception:
        draw.text((size / 2, size / 2), text, font=font, fill=fg)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    img.convert("RGB").save(args.out, "PNG", optimize=True)
    print(json.dumps({"ok": True, "out": args.out, "font": font_path, "size": size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
