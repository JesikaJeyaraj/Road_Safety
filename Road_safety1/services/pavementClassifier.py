import json
import sys
import time


def normalize_label(label):
    raw = str(label or "").strip().lower()
    if raw == "good condition" or raw == "good":
        return "good_condition", "Good condition"
    if raw == "poor condition" or raw == "poor":
        return "poor_condition", "Poor condition"
    return raw.replace(" ", "_") or "unknown", str(label or "Unknown")


def run_yolov8_classifier(weights_path, image_path):
    from ultralytics import YOLO

    started = time.time()
    model = YOLO(weights_path)
    result = model(image_path, verbose=False)[0]

    if getattr(result, "probs", None) is None:
        raise RuntimeError("The supplied .pt file did not return classification probabilities.")

    names = result.names or {}
    top_index = int(result.probs.top1)
    confidence = round(float(result.probs.top1conf) * 100, 1)
    model_label = names.get(top_index, str(top_index))
    category, display_name = normalize_label(model_label)
    detected = category == "poor_condition"
    severity = "High" if detected else "Low"

    class_scores = {}
    for idx, score in enumerate(result.probs.data.tolist()):
        label = names.get(idx, str(idx))
        class_scores[label] = round(float(score) * 100, 1)

    return {
        "detected": detected,
        "primaryClass": category,
        "defectCategory": category,
        "displayName": display_name,
        "description": "Road surface requires attention." if detected else "Road surface appears usable.",
        "confidence": confidence,
        "confidenceScore": confidence,
        "severity": severity,
        "severityLevel": severity,
        "detections": [],
        "classScores": class_scores,
        "inferenceTimeMs": round((time.time() - started) * 1000),
    }


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: pavementClassifier.py <weights.pt> <image>")

    try:
        print(json.dumps(run_yolov8_classifier(sys.argv[1], sys.argv[2])))
    except ImportError as exc:
        raise SystemExit(
            "Missing Python dependency. Install with: pip install ultralytics torch pillow. "
            f"Details: {exc}"
        )


if __name__ == "__main__":
    main()
