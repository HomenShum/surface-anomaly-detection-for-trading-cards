#!/usr/bin/env python
"""Download Roboflow YOLO datasets and convert them into the unified manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from PIL import Image

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCES = ROOT / "ml/configs/roboflow_sources.yaml"
DEFAULT_LABEL_MAP = ROOT / "ml/configs/alpha_label_map.yaml"
RAW_ROOT = ROOT / "ml/datasets/raw/roboflow"
MANIFEST_OUT = ROOT / "ml/datasets/manifests/roboflow_alpha_manifest.jsonl"
AUDIT_OUT = ROOT / "ml/datasets/manifests/roboflow_alpha_manifest.audit.json"


def read_yaml(path: Path) -> dict[str, Any]:
    if yaml is None:
        raise RuntimeError("PyYAML is required for Roboflow ingestion")
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_link(source: dict[str, Any], api_key: str) -> tuple[str, dict[str, Any]]:
    api_url = (
        f"https://api.roboflow.com/{source['workspace']}/{source['project']}"
        f"/{source['version']}/{source.get('format', 'yolov8')}?api_key={api_key}"
    )
    try:
        with urllib.request.urlopen(api_url, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(
            f"Failed to create Roboflow export for {source['id']}. "
            "Confirm ROBOFLOW_API_KEY has access to the dataset and retry."
        ) from exc
    link = payload.get("export", {}).get("link")
    if not link:
        raise RuntimeError(f"Roboflow did not return an export link for {source['id']}")
    return str(link), payload


def redact_url_secret(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    redacted = [(key, "${ROBOFLOW_EXPORT_KEY}" if key in {"key", "api_key"} else value) for key, value in query]
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(redacted)))


def download_source(source: dict[str, Any], api_key: str, raw_root: Path, force: bool) -> Path:
    source_dir = raw_root / source["id"]
    complete_marker = source_dir / ".download-complete.json"
    if complete_marker.is_file() and not force:
        return source_dir

    if source_dir.exists() and force:
        shutil.rmtree(source_dir)
    source_dir.mkdir(parents=True, exist_ok=True)
    archive_path = source_dir / f"{source['id']}.zip"
    download_url, export_payload = export_link(source, api_key)
    try:
        urllib.request.urlretrieve(download_url, archive_path)
    except Exception as exc:
        raise RuntimeError(
            f"Failed to download {source['id']} from Roboflow. "
            "Confirm ROBOFLOW_API_KEY has access to the dataset and retry."
        ) from exc

    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(source_dir)
    complete_marker.write_text(
        json.dumps(
            {
                "source_id": source["id"],
                "api_url_template": (
                    f"https://api.roboflow.com/{source['workspace']}/{source['project']}"
                    f"/{source['version']}/{source.get('format', 'yolov8')}?api_key=${{ROBOFLOW_API_KEY}}"
                ),
                "download_url_template": redact_url_secret(download_url),
                "roboflow_images": export_payload.get("version", {}).get("images"),
                "archive_sha256": sha256_file(archive_path),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return source_dir


def find_dataset_yaml(source_dir: Path) -> Path:
    candidates = list(source_dir.rglob("data.yaml")) + list(source_dir.rglob("dataset.yaml"))
    if not candidates:
        raise FileNotFoundError(f"No data.yaml or dataset.yaml found under {source_dir}")
    return candidates[0]


def resolve_path(base: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    resolved = base / path
    if resolved.exists():
        return resolved
    parts = path.parts
    if parts and parts[0] == "..":
        repaired = base / Path(*parts[1:])
        if repaired.exists():
            return repaired
    return resolved


def names_from_data_yaml(path: Path) -> list[str]:
    data = read_yaml(path)
    names = data.get("names", [])
    if isinstance(names, dict):
        return [str(names[index]) for index in sorted(names)]
    return [str(name) for name in names]


def split_dirs(data_yaml: Path) -> dict[str, Path]:
    data = read_yaml(data_yaml)
    base = data_yaml.parent
    return {
        "train": resolve_path(base, str(data.get("train", "train/images"))),
        "val": resolve_path(base, str(data.get("val", data.get("valid", "valid/images")))),
        "test": resolve_path(base, str(data.get("test", "test/images"))),
    }


def split_label_dir(image_dir: Path) -> Path:
    parts = list(image_dir.parts)
    for index, part in enumerate(parts):
        if part.lower() == "images":
            parts[index] = "labels"
            return Path(*parts)
    return image_dir.parent / "labels"


def read_yolo_label(label_path: Path, width: int, height: int, names: list[str], source: dict[str, Any]) -> list[dict[str, Any]]:
    annotations: list[dict[str, Any]] = []
    if not label_path.is_file():
        return annotations
    label_map = {str(key): str(value) for key, value in source.get("label_map", {}).items()}
    for line_number, raw_line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue
        parts = raw_line.split()
        source_class_id = int(float(parts[0]))
        source_class_name = names[source_class_id]
        mapped_name = label_map.get(source_class_name, "unknown_damage")
        values = [float(value) for value in parts[1:]]
        if len(values) == 4:
            cx, cy, nw, nh = values
            box_width = nw * width
            box_height = nh * height
            x = max(0.0, (cx * width) - box_width / 2.0)
            y = max(0.0, (cy * height) - box_height / 2.0)
        elif len(values) >= 6 and len(values) % 2 == 0:
            xs = values[0::2]
            ys = values[1::2]
            x = max(0.0, min(xs) * width)
            y = max(0.0, min(ys) * height)
            box_width = max(1.0, (max(xs) - min(xs)) * width)
            box_height = max(1.0, (max(ys) - min(ys)) * height)
        else:
            raise ValueError(f"{label_path}:{line_number}: expected YOLO bbox or segmentation polygon")
        box_width = min(box_width, width - x)
        box_height = min(box_height, height - y)
        annotations.append(
            {
                "class_name": mapped_name,
                "bbox_xywh": [round(x, 3), round(y, 3), round(box_width, 3), round(box_height, 3)],
                "confidence": 1.0,
                "source_label": source_class_name,
                "confidence_source": "roboflow_human_dataset_label",
            }
        )
    return annotations


def class_ids(label_map_path: Path) -> dict[str, int]:
    data = read_yaml(label_map_path)
    return {str(item["name"]): int(item["id"]) for item in data.get("classes", [])}


def manifest_records(source: dict[str, Any], source_dir: Path, label_map_path: Path) -> list[dict[str, Any]]:
    data_yaml = find_dataset_yaml(source_dir)
    names = names_from_data_yaml(data_yaml)
    ids = class_ids(label_map_path)
    records: list[dict[str, Any]] = []
    for split, image_dir in split_dirs(data_yaml).items():
        if not image_dir.is_dir():
            continue
        label_dir = split_label_dir(image_dir)
        for image_path in sorted(list(image_dir.glob("*.jpg")) + list(image_dir.glob("*.jpeg")) + list(image_dir.glob("*.png"))):
            with Image.open(image_path) as image:
                width, height = image.size
            annotations = read_yolo_label(label_dir / f"{image_path.stem}.txt", width, height, names, source)
            for annotation in annotations:
                annotation["class_id"] = ids.get(annotation["class_name"], ids["unknown_damage"])
            rel_path = image_path.relative_to(ROOT).as_posix()
            records.append(
                {
                    "image_id": f"{source['id']}_{split}_{image_path.stem}",
                    "source_dataset": source["id"],
                    "split": split,
                    "image_path": rel_path,
                    "width": width,
                    "height": height,
                    "license": source["license"],
                    "license_status": source["license_status"],
                    "annotations": annotations,
                    "metadata": {
                        "source_url": source["url"],
                        "dataset_url": source.get("dataset_url"),
                        "downloaded_from": "roboflow_universe",
                        "source_classes": names,
                    },
                }
            )
    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def audit(records: list[dict[str, Any]], manifest_path: Path, *, configured_sources: list[str] | None = None, missing_sources: list[dict[str, str]] | None = None) -> dict[str, Any]:
    digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest() if manifest_path.is_file() else ""
    splits: dict[str, int] = {}
    sources: dict[str, int] = {}
    classes: dict[str, int] = {}
    for record in records:
        splits[record["split"]] = splits.get(record["split"], 0) + 1
        sources[record["source_dataset"]] = sources.get(record["source_dataset"], 0) + 1
        for annotation in record["annotations"]:
            classes[annotation["class_name"]] = classes.get(annotation["class_name"], 0) + 1
    return {
        "status": "verified" if records else "empty",
        "records": len(records),
        "sources": sources,
        "configured_sources": configured_sources or sorted(sources),
        "downloaded_sources": sorted(sources),
        "missing_sources": missing_sources or [],
        "splits": splits,
        "classes": classes,
        "manifest": str(manifest_path.relative_to(ROOT)),
        "manifest_sha256": digest,
        "license_status": "verified",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--label-map", type=Path, default=DEFAULT_LABEL_MAP)
    parser.add_argument("--out", type=Path, default=MANIFEST_OUT)
    parser.add_argument("--raw-root", type=Path, default=RAW_ROOT)
    parser.add_argument("--api-key", default=os.environ.get("ROBOFLOW_API_KEY", ""))
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-download", action="store_true", help="Parse already-downloaded Roboflow folders only.")
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="When used with --skip-download, record configured-but-missing sources in the audit instead of failing.",
    )
    args = parser.parse_args()

    if not args.api_key and not args.skip_download:
        raise SystemExit(
            "ROBOFLOW_API_KEY is required to download public Roboflow exports. "
            "Set it, or run with --skip-download after placing YOLO exports under ml/datasets/raw/roboflow/<source_id>."
        )

    source_config = read_yaml(args.sources)
    all_records: list[dict[str, Any]] = []
    configured_sources = [str(source["id"]) for source in source_config.get("sources", [])]
    missing_sources: list[dict[str, str]] = []
    for source in source_config.get("sources", []):
        source_dir = args.raw_root / source["id"]
        if not args.skip_download:
            try:
                source_dir = download_source(source, args.api_key, args.raw_root, args.force)
            except Exception as exc:
                if args.allow_missing:
                    missing_sources.append(
                        {
                            "id": str(source["id"]),
                            "dataset_url": str(source.get("dataset_url") or source.get("url") or ""),
                            "reason": f"download_failed: {exc}",
                        }
                    )
                    continue
                raise
        if not source_dir.is_dir():
            if args.skip_download and args.allow_missing:
                missing_sources.append(
                    {
                        "id": str(source["id"]),
                        "dataset_url": str(source.get("dataset_url") or source.get("url") or ""),
                        "reason": "local_export_missing",
                    }
                )
                continue
            raise FileNotFoundError(f"Missing source directory: {source_dir}")
        try:
            all_records.extend(manifest_records(source, source_dir, args.label_map))
        except Exception as exc:
            if args.allow_missing:
                missing_sources.append(
                    {
                        "id": str(source["id"]),
                        "dataset_url": str(source.get("dataset_url") or source.get("url") or ""),
                        "reason": f"parse_failed: {exc}",
                    }
                )
                continue
            raise

    write_jsonl(args.out, all_records)
    report = audit(all_records, args.out, configured_sources=configured_sources, missing_sources=missing_sources)
    AUDIT_OUT.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
