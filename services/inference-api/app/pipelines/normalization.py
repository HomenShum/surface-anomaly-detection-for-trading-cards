from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import math

import numpy as np

try:  # pragma: no cover - exercised indirectly when cv2 is installed
    import cv2
except Exception:  # pragma: no cover - fallback path is tested without patching imports
    cv2 = None  # type: ignore[assignment]


DEFAULT_OUTPUT_SIZE = (640, 896)


@dataclass(frozen=True)
class NormalizationQuality:
    score: float
    blur: float
    brightness: float
    contrast: float
    edge_confidence: float
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class NormalizationResult:
    image: np.ndarray
    quality: NormalizationQuality
    transform: dict[str, Any]


def load_image(path: str | Path) -> np.ndarray:
    if cv2 is not None:
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Unable to load image: {path}")
        return image

    raise RuntimeError("OpenCV is required to load images from disk")


def save_image(path: str | Path, image: np.ndarray) -> None:
    if cv2 is None:
        raise RuntimeError("OpenCV is required to save images")

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(output_path), image)
    if not ok:
        raise ValueError(f"Unable to write normalized image: {path}")


def normalize_card_image(
    image: np.ndarray,
    output_size: tuple[int, int] = DEFAULT_OUTPUT_SIZE,
    *,
    enhance: bool = True,
) -> NormalizationResult:
    if image is None or image.size == 0:
        raise ValueError("normalize_card_image requires a non-empty image")

    working = _ensure_uint8_bgr(image)
    original_shape = working.shape
    warnings: list[str] = []

    corners = _find_card_corners(working)
    if corners is not None:
        normalized = _warp_perspective(working, corners, output_size)
        transform: dict[str, Any] = {
            "method": "perspective",
            "corners": corners.astype(float).round(2).tolist(),
            "input_shape": list(original_shape),
            "output_size": list(output_size),
        }
        edge_confidence = 0.95
    else:
        normalized = _center_crop_resize(working, output_size)
        warnings.append("card_edges_not_found")
        transform = {
            "method": "center_crop_resize",
            "input_shape": list(original_shape),
            "output_size": list(output_size),
        }
        edge_confidence = 0.35

    if enhance:
        normalized = _enhance_image(normalized)

    quality = score_image_quality(normalized, edge_confidence=edge_confidence, warnings=warnings)
    return NormalizationResult(image=normalized, quality=quality, transform=transform)


def normalize_card_file(
    input_path: str | Path,
    output_path: str | Path | None = None,
    output_size: tuple[int, int] = DEFAULT_OUTPUT_SIZE,
) -> NormalizationResult:
    result = normalize_card_image(load_image(input_path), output_size=output_size)
    if output_path is not None:
        save_image(output_path, result.image)
    return result


def normalize_bytes(raw_bytes: bytes, output_size: tuple[int, int] = DEFAULT_OUTPUT_SIZE) -> dict[str, Any]:
    if cv2 is None:
        raise RuntimeError("OpenCV is required to normalize image bytes")
    image_array = cv2.imdecode(np.frombuffer(raw_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_array is None:
        raise ValueError("unable to decode image bytes")
    result = normalize_card_image(image_array, output_size=output_size)
    ok, encoded = cv2.imencode(".png", result.image)
    if not ok:
        raise ValueError("unable to encode normalized image")
    height, width = result.image.shape[:2]
    return {
        "bytes": encoded.tobytes(),
        "width": width,
        "height": height,
        "warnings": list(result.quality.warnings),
        "metadata": {
            "normalizer": "opencv-v0.1",
            "quality": result.quality.__dict__,
            "transform": result.transform,
        },
    }


def detect_card_contour(image: np.ndarray) -> list[list[float]] | None:
    corners = _find_card_corners(_ensure_uint8_bgr(image))
    return None if corners is None else corners.astype(float).round(2).tolist()


def order_corners(points: np.ndarray | list[list[float]]) -> list[list[float]]:
    return _order_points(np.asarray(points, dtype=np.float32)).astype(float).round(2).tolist()


def perspective_warp(
    image: np.ndarray,
    corners: np.ndarray | list[list[float]],
    output_size: tuple[int, int] = DEFAULT_OUTPUT_SIZE,
) -> np.ndarray:
    return _warp_perspective(_ensure_uint8_bgr(image), np.asarray(corners, dtype=np.float32), output_size)


def crop_corners(image: np.ndarray, crop_fraction: float = 0.18) -> dict[str, np.ndarray]:
    working = _ensure_uint8_bgr(image)
    height, width = working.shape[:2]
    crop_w = max(1, int(width * crop_fraction))
    crop_h = max(1, int(height * crop_fraction))
    return {
        "top_left": working[:crop_h, :crop_w],
        "top_right": working[:crop_h, width - crop_w :],
        "bottom_right": working[height - crop_h :, width - crop_w :],
        "bottom_left": working[height - crop_h :, :crop_w],
    }


def crop_edges(image: np.ndarray, strip_fraction: float = 0.08) -> dict[str, np.ndarray]:
    working = _ensure_uint8_bgr(image)
    height, width = working.shape[:2]
    strip_w = max(1, int(width * strip_fraction))
    strip_h = max(1, int(height * strip_fraction))
    return {
        "top": working[:strip_h, :],
        "right": working[:, width - strip_w :],
        "bottom": working[height - strip_h :, :],
        "left": working[:, :strip_w],
    }


def compute_basic_centering(corners: np.ndarray | list[list[float]], image_shape: tuple[int, ...]) -> dict[str, float]:
    points = np.asarray(corners, dtype=np.float32)
    height, width = image_shape[:2]
    left = float(min(points[:, 0]))
    right = float(width - max(points[:, 0]))
    top = float(min(points[:, 1]))
    bottom = float(height - max(points[:, 1]))
    horizontal_total = max(1.0, left + right)
    vertical_total = max(1.0, top + bottom)
    return {
        "left_pct": round(left / horizontal_total, 4),
        "right_pct": round(right / horizontal_total, 4),
        "top_pct": round(top / vertical_total, 4),
        "bottom_pct": round(bottom / vertical_total, 4),
    }


def score_blur(image: np.ndarray) -> float:
    return round(min(1.0, _laplacian_variance(_to_gray(_ensure_uint8_bgr(image))) / 160.0), 4)


def score_glare(image: np.ndarray) -> float:
    gray = _to_gray(_ensure_uint8_bgr(image))
    bright_ratio = float(np.mean(gray > 242))
    return round(max(0.0, min(1.0, bright_ratio * 8.0)), 4)


def score_edge_visibility(image: np.ndarray) -> float:
    corners = _find_card_corners(_ensure_uint8_bgr(image))
    return 0.95 if corners is not None else 0.35


def score_scan_quality(image: np.ndarray) -> NormalizationQuality:
    return score_image_quality(image, edge_confidence=score_edge_visibility(image))


def score_image_quality(
    image: np.ndarray,
    *,
    edge_confidence: float = 0.5,
    warnings: list[str] | None = None,
) -> NormalizationQuality:
    working = _ensure_uint8_bgr(image)
    gray = _to_gray(working)

    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    blur = _laplacian_variance(gray)

    brightness_score = _score_range(brightness, ideal_min=85, ideal_max=185, hard_min=35, hard_max=230)
    contrast_score = min(1.0, contrast / 55.0)
    blur_score = min(1.0, blur / 160.0)
    edge_score = max(0.0, min(1.0, edge_confidence))

    score = (
        0.30 * brightness_score
        + 0.25 * contrast_score
        + 0.25 * blur_score
        + 0.20 * edge_score
    )

    quality_warnings = list(warnings or [])
    if brightness_score < 0.45:
        quality_warnings.append("poor_brightness")
    if contrast_score < 0.35:
        quality_warnings.append("low_contrast")
    if blur_score < 0.35:
        quality_warnings.append("possible_blur")

    return NormalizationQuality(
        score=round(float(max(0.0, min(1.0, score))), 4),
        blur=round(float(blur), 4),
        brightness=round(brightness, 4),
        contrast=round(contrast, 4),
        edge_confidence=round(edge_score, 4),
        warnings=quality_warnings,
    )


def _ensure_uint8_bgr(image: np.ndarray) -> np.ndarray:
    array = np.asarray(image)
    if array.ndim == 2:
        if cv2 is not None:
            array = cv2.cvtColor(array, cv2.COLOR_GRAY2BGR)
        else:
            array = np.repeat(array[:, :, None], 3, axis=2)
    if array.ndim != 3 or array.shape[2] not in (3, 4):
        raise ValueError("image must be grayscale, BGR/RGB, or BGRA/RGBA")
    if array.shape[2] == 4:
        array = array[:, :, :3]
    if array.dtype != np.uint8:
        array = np.clip(array, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(array)


def _to_gray(image: np.ndarray) -> np.ndarray:
    if cv2 is not None:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return np.round(np.mean(image[:, :, :3], axis=2)).astype(np.uint8)


def _resize(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    if cv2 is not None:
        return cv2.resize(image, size, interpolation=cv2.INTER_AREA)

    height, width = image.shape[:2]
    target_width, target_height = size
    y_idx = np.linspace(0, height - 1, target_height).astype(int)
    x_idx = np.linspace(0, width - 1, target_width).astype(int)
    return image[y_idx][:, x_idx]


def _laplacian_variance(gray: np.ndarray) -> float:
    if cv2 is not None:
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    gy, gx = np.gradient(gray.astype(np.float32))
    return float((np.gradient(gx, axis=1) + np.gradient(gy, axis=0)).var())


def _find_card_corners(image: np.ndarray) -> np.ndarray | None:
    if cv2 is None:
        return None

    gray = _to_gray(image)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    image_area = image.shape[0] * image.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        area = cv2.contourArea(contour)
        if area < image_area * 0.15:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            return _order_points(approx.reshape(4, 2).astype(np.float32))

    return None


def _order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    rect[0] = points[np.argmin(sums)]
    rect[2] = points[np.argmax(sums)]
    rect[1] = points[np.argmin(diffs)]
    rect[3] = points[np.argmax(diffs)]
    return rect


def _warp_perspective(image: np.ndarray, corners: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    if cv2 is None:
        return _center_crop_resize(image, size)

    width, height = size
    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(corners, destination)
    return cv2.warpPerspective(image, matrix, (width, height))


def _center_crop_resize(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    target_width, target_height = size
    height, width = image.shape[:2]
    target_aspect = target_width / target_height
    current_aspect = width / height

    if current_aspect > target_aspect:
        crop_width = int(round(height * target_aspect))
        x0 = max(0, (width - crop_width) // 2)
        cropped = image[:, x0 : x0 + crop_width]
    else:
        crop_height = int(round(width / target_aspect))
        y0 = max(0, (height - crop_height) // 2)
        cropped = image[y0 : y0 + crop_height, :]

    return _resize(cropped, size)


def _enhance_image(image: np.ndarray) -> np.ndarray:
    if cv2 is None:
        return image

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(l_channel)
    enhanced = cv2.merge((enhanced_l, a_channel, b_channel))
    return cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)


def _score_range(
    value: float,
    *,
    ideal_min: float,
    ideal_max: float,
    hard_min: float,
    hard_max: float,
) -> float:
    if ideal_min <= value <= ideal_max:
        return 1.0
    if value < ideal_min:
        return max(0.0, (value - hard_min) / max(1.0, ideal_min - hard_min))
    return max(0.0, (hard_max - value) / max(1.0, hard_max - ideal_max))


def aspect_ratio_error(width: float, height: float, target_ratio: float = 2.5 / 3.5) -> float:
    if width <= 0 or height <= 0:
        return math.inf
    return abs((width / height) - target_ratio)
