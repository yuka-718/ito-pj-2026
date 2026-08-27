#!/usr/bin/env python3

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from skimage.morphology import skeletonize as skimage_skeletonize


def canonical_line(line):
    x1, y1, x2, y2 = (float(value) for value in line)
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 2:
        return None
    ux, uy = dx / length, dy / length
    if ux < 0 or (abs(ux) < 1e-9 and uy < 0):
        ux, uy = -ux, -uy
        x1, y1, x2, y2 = x2, y2, x1, y1
    nx, ny = -uy, ux
    rho = x1 * nx + y1 * ny
    return {
        "angle": math.atan2(uy, ux),
        "rho": rho,
        "points": ((x1, y1), (x2, y2)),
    }


def merge_lines(lines, angle_tolerance=math.radians(1.5), rho_tolerance=3.5, gap=6.0):
    groups = []
    for raw in lines:
        value = canonical_line(raw)
        if value is None:
            continue
        target = None
        for group in groups:
            angle_delta = abs(value["angle"] - group["angle"])
            angle_delta = min(angle_delta, math.pi - angle_delta)
            if angle_delta <= angle_tolerance and abs(value["rho"] - group["rho"]) <= rho_tolerance:
                target = group
                break
        if target is None:
            target = {**value, "members": []}
            groups.append(target)
        target["members"].append(value)

    merged = []
    for group in groups:
        members = group["members"]
        angle = float(np.median([member["angle"] for member in members]))
        rho = float(np.median([member["rho"] for member in members]))
        ux, uy = math.cos(angle), math.sin(angle)
        nx, ny = -uy, ux
        intervals = sorted(
            (
                min(point[0] * ux + point[1] * uy for point in member["points"]),
                max(point[0] * ux + point[1] * uy for point in member["points"]),
            )
            for member in members
        )
        joined = []
        for start, end in intervals:
            if not joined or start > joined[-1][1] + gap:
                joined.append([start, end])
            else:
                joined[-1][1] = max(joined[-1][1], end)
        for start, end in joined:
            if end - start < 6:
                continue
            merged.append((
                (start * ux + rho * nx, start * uy + rho * ny),
                (end * ux + rho * nx, end * uy + rho * ny),
            ))
    return merged


def skeletonize(mask):
    return (skimage_skeletonize(mask > 0).astype(np.uint8) * 255)


def extract_segments(mask):
    thinned = skeletonize(mask)
    raw = cv2.HoughLinesP(
        thinned,
        rho=1,
        theta=math.pi / 720,
        threshold=10,
        minLineLength=7,
        maxLineGap=4,
    )
    if raw is None:
        return []
    return merge_lines([entry[0] for entry in raw])


def strongest_edge(gray, axis, position, span_start, span_end, radius=6):
    candidates = []
    for offset in range(-radius, radius + 1):
        coordinate = position + offset
        if axis == "x":
            if coordinate < 0 or coordinate >= gray.shape[1]:
                continue
            values = gray[span_start:span_end + 1, coordinate]
        else:
            if coordinate < 0 or coordinate >= gray.shape[0]:
                continue
            values = gray[coordinate, span_start:span_end + 1]
        candidates.append((float(np.mean(values < 96)), coordinate))
    return max(candidates, default=(0.0, position))


def detect_square(gray, color_mask):
    ys, xs = np.nonzero(color_mask)
    if len(xs) < 20:
        raise ValueError("red/blue crease lines were not found")
    initial = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    left = strongest_edge(gray, "x", initial[0], initial[1], initial[3])
    right = strongest_edge(gray, "x", initial[2], initial[1], initial[3])
    top = strongest_edge(gray, "y", initial[1], initial[0], initial[2])
    bottom = strongest_edge(gray, "y", initial[3], initial[0], initial[2])
    scores = [left[0], right[0], top[0], bottom[0]]
    if min(scores) < 0.65:
        raise ValueError(f"continuous square boundary not found: {scores}")
    x0, x1, y0, y1 = left[1], right[1], top[1], bottom[1]
    width, height = x1 - x0, y1 - y0
    if width <= 20 or height <= 20 or abs(width - height) / max(width, height) > 0.03:
        raise ValueError("crease-pattern boundary is not a square")
    return x0, y0, x1, y1


def coverage(mask, segments):
    rendered = np.zeros_like(mask)
    for first, second in segments:
        # Allow a three-pixel registration tolerance for anti-aliased source
        # lines and Hough estimates. This changes only the quality metric, not
        # the exported line coordinates.
        cv2.line(rendered, tuple(round(value) for value in first), tuple(round(value) for value in second), 255, 7)
    source = mask > 0
    if not np.any(source):
        return 0.0
    return float(np.count_nonzero(source & (rendered > 0)) / np.count_nonzero(source))


def normalize_segment(segment, bounds):
    x0, y0, x1, y1 = bounds
    width, height = x1 - x0, y1 - y0
    result = []
    for x, y in segment:
        result.append([
            round(min(1.0, max(0.0, x / width)), 8),
            round(min(1.0, max(0.0, y / height)), 8),
        ])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--item-id", required=True)
    parser.add_argument("--title", required=True)
    args = parser.parse_args()

    image = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("image could not be read")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    red = cv2.inRange(hsv, np.array([0, 90, 100]), np.array([12, 255, 255]))
    red |= cv2.inRange(hsv, np.array([168, 90, 100]), np.array([179, 255, 255]))
    blue = cv2.inRange(hsv, np.array([80, 55, 90]), np.array([112, 255, 255]))
    color = red | blue
    bounds = detect_square(gray, color)
    x0, y0, x1, y1 = bounds
    red_crop = red[y0:y1 + 1, x0:x1 + 1]
    blue_crop = blue[y0:y1 + 1, x0:x1 + 1]
    red_segments = extract_segments(red_crop)
    blue_segments = extract_segments(blue_crop)
    extraction_method = "skeletonized_hough"
    red_coverage = coverage(red_crop, red_segments)
    blue_coverage = coverage(blue_crop, blue_segments)
    combined = min(red_coverage, blue_coverage)
    creases = []
    for assignment, segments in (("M", red_segments), ("V", blue_segments)):
        for segment in segments:
            a, b = normalize_segment(segment, bounds)
            if math.dist(a, b) < 0.004:
                continue
            creases.append({"a": a, "b": b, "assignment": assignment, "confidence": round(combined, 4)})
    result = {
        "item_id": args.item_id,
        "title": args.title,
        "completeness": "complete" if combined >= 0.9 else "partial",
        "source_coordinate_system": "original_square",
        "crease_pattern": {
            "present": True,
            "creases": creases,
            "confidence": round(combined, 4),
        },
        "steps": [],
        "issues": [
            f"color vectorization coverage red={red_coverage:.3f}, blue={blue_coverage:.3f}",
            "coverage uses a three-pixel registration tolerance; exported coordinates are not widened",
            f"vectorization method={extraction_method}",
            "red lines mapped to M and blue lines mapped to V using Oriedita color convention",
            "folding sequence remains unverified",
        ],
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
