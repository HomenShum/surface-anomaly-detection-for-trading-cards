#!/usr/bin/env python
"""Build a shareable GIF from the live API DING probe.

The input is the replayable API response written by the full flywheel:
data/proof/full-system-flywheel/live_dataset_card_api_analysis.json

This keeps the friend-facing GIF grounded in a real dataset card and real model
findings instead of a hand-drawn placeholder.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data" / "proof" / "full-system-flywheel" / "live_dataset_card_api_analysis.json"
GIF_NAME = "real-dataset-card-corner-wear-model-annotations.gif"
FRAME_NAME = "real-dataset-card-corner-wear-model-annotations-frame.png"
OUTPUTS = [
    ROOT / "public" / "demo" / "gifs" / GIF_NAME,
    ROOT / "apps" / "web" / "public" / "demo" / "gifs" / GIF_NAME,
]
FRAME_OUTPUT = ROOT / "docs" / "screenshots" / FRAME_NAME


def main() -> int:
    if not INPUT.is_file():
        raise SystemExit(f"Missing live API probe: {INPUT}")

    payload = json.loads(INPUT.read_text(encoding="utf-8-sig"))
    report = payload.get("report") or {}
    findings = report.get("findings") or []
    if not findings:
        raise SystemExit("Live dataset probe has no findings to animate.")

    normalized = payload["normalized"]
    image = Image.open(io.BytesIO(base64.b64decode(normalized["image_base64"]))).convert("RGB")
    frames = build_frames(image, findings, report)

    for output in OUTPUTS:
        output.parent.mkdir(parents=True, exist_ok=True)
        frames[0].save(
            output,
            save_all=True,
            append_images=frames[1:],
            duration=110,
            loop=0,
            optimize=False,
        )

    FRAME_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frames[-1].save(FRAME_OUTPUT)

    print(
        json.dumps(
            {
                "ok": True,
                "gif": str(OUTPUTS[0]),
                "webGif": str(OUTPUTS[1]),
                "verificationFrame": str(FRAME_OUTPUT),
                "findings": [
                    {
                        "kind": finding.get("kind"),
                        "confidence": round(float(finding.get("confidence", 0)), 3),
                        "bbox": finding.get("bbox"),
                    }
                    for finding in findings
                ],
                "manifestSha256": report.get("evidence_manifest", {}).get("manifest_sha256"),
            },
            indent=2,
        )
    )
    return 0


def build_frames(image: Image.Image, findings: list[dict], report: dict) -> list[Image.Image]:
    font_title = load_font(28, bold=True)
    font = load_font(18)
    font_small = load_font(15)
    font_label = load_font(16, bold=True)

    canvas_size = (1000, 650)
    card = fit(image, (390, 546))
    card_x, card_y = 48, 70
    scale_x = card.width / image.width
    scale_y = card.height / image.height

    expanded_bbox = union_bbox([finding["bbox"] for finding in findings])
    crop = crop_bbox(image, expanded_bbox, pad=34)
    zoom = fit(crop, (465, 360))
    zoom_x, zoom_y = 500, 155

    frames: list[Image.Image] = []
    for index in range(26):
        t = index / 25
        frame = Image.new("RGB", canvas_size, (13, 16, 20))
        draw = ImageDraw.Draw(frame)
        draw.text((44, 24), "Real model DING annotations", font=font_title, fill=(246, 248, 250))
        draw.text(
            (44, 55),
            "Live Roboflow dataset card -> inference API -> labeled visible-condition findings",
            font=font_small,
            fill=(166, 176, 189),
        )

        frame.paste(card, (card_x, card_y))
        draw.rounded_rectangle((card_x - 6, card_y - 6, card_x + card.width + 6, card_y + card.height + 6), radius=10, outline=(74, 87, 104), width=2)

        pulse = int(18 * abs(0.5 - ((index % 10) / 10)))
        for finding_idx, finding in enumerate(findings):
            x1, y1, x2, y2 = finding["bbox"]
            box = (
                card_x + int(x1 * scale_x) - pulse,
                card_y + int(y1 * scale_y) - pulse,
                card_x + int(x2 * scale_x) + pulse,
                card_y + int(y2 * scale_y) + pulse,
            )
            color = (255, 192, 72) if finding_idx == 0 else (86, 220, 184)
            draw.rectangle(box, outline=color, width=4)
            if index > 7:
                label = f"{finding['kind']} {float(finding['confidence']) * 100:.0f}%"
                label_width = draw.textbbox((0, 0), label, font=font_label)[2]
                label_x = max(card_x + 8, min(box[0], card_x + card.width - label_width - 16))
                draw_label(
                    draw,
                    (label_x, max(78, box[1] - 28)),
                    label,
                    font_label,
                    color,
                )

        zoom_alpha = 1 if index > 4 else t
        if zoom_alpha:
            panel = Image.new("RGB", (480, 460), (24, 29, 36))
            panel_draw = ImageDraw.Draw(panel)
            panel_draw.rounded_rectangle((0, 0, 479, 459), radius=10, fill=(24, 29, 36), outline=(74, 87, 104), width=2)
            panel_draw.text((18, 18), "Zoomed inspection crop", font=font, fill=(246, 248, 250))
            panel_draw.text((18, 44), "Detector result: visible corner wear candidates", font=font_small, fill=(166, 176, 189))
            panel.paste(zoom, (8, 78))
            panel_draw.rectangle((8, 78, 8 + zoom.width, 78 + zoom.height), outline=(255, 192, 72), width=3)

            y = 85 + zoom.height + 16
            for finding in findings:
                panel_draw.text(
                    (18, y),
                    f"DING label: {finding['kind']} | confidence {float(finding['confidence']) * 100:.1f}%",
                    font=font_small,
                    fill=(246, 248, 250),
                )
                y += 24
            frame.paste(panel, (zoom_x, zoom_y))

        sha = report.get("evidence_manifest", {}).get("manifest_sha256", "")
        draw.text((44, 622), f"Evidence manifest: {sha[:24]}..." if sha else "Evidence manifest saved", font=font_small, fill=(166, 176, 189))
        draw.text((500, 622), "Not an official grade. AI-assisted visible-condition evidence only.", font=font_small, fill=(166, 176, 189))
        frames.append(frame)
    return frames


def draw_label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.ImageFont, color: tuple[int, int, int]) -> None:
    x, y = xy
    bbox = draw.textbbox((x, y), text, font=font)
    pad = 5
    draw.rounded_rectangle((bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad), radius=5, fill=(12, 14, 18), outline=color, width=2)
    draw.text((x, y), text, font=font, fill=(246, 248, 250))


def fit(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    copy = image.copy()
    copy.thumbnail(box, Image.Resampling.LANCZOS)
    return copy


def union_bbox(boxes: list[list[float]]) -> tuple[float, float, float, float]:
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def crop_bbox(image: Image.Image, bbox: tuple[float, float, float, float], pad: int) -> Image.Image:
    x1, y1, x2, y2 = bbox
    return image.crop(
        (
            max(0, int(x1) - pad),
            max(0, int(y1) - pad),
            min(image.width, int(x2) + pad),
            min(image.height, int(y2) + pad),
        )
    )


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


if __name__ == "__main__":
    raise SystemExit(main())
