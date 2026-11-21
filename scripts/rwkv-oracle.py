#!/usr/bin/env python3
"""Generate browser-port checks from the published SM99 NumPy reference.

Requires numpy, and the unmodified release package downloaded from:
https://github.com/JSchoreels/anki-rwkv/releases/tag/rwkv-family-2026-11-13

Example:
  python scripts/rwkv-oracle.py /path/to/rwkv-big-instant-only

The package contains synthetic histories, not user or training-dataset rows.
The FP32 expectations are the upstream golden values, independently checked
against its recurrent implementation. The INT8-state expectations are computed
by that reference, with FP32 weights and its state_bits=8 option.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")

import numpy as np


STREAMS = ["card_id", "deck_id", "note_id", "preset_id", "user_id"]
WEIGHTS_SHA256 = "682ba1ff207c51af7de5e2abeb25593362aa706b292cbcc338a1591fad0d935c"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--rows", type=int, default=384)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]
                        / "src/lib/rwkv/__fixtures__/big-sm99-reference.json")
    args = parser.parse_args()
    package = args.package.resolve()
    assert sha256(package / "weights.f32.bin") == WEIGHTS_SHA256, "Unexpected weights"
    sys.path.insert(0, str(package / "reference"))
    from small_model_recurrent import RecurrentModel
    from weights_io import load_package

    weights, spec = load_package(package, "fp32")
    fixture = {
        "provenance": {
            "release": "https://github.com/JSchoreels/anki-rwkv/releases/tag/rwkv-family-2026-11-13",
            "asset": "rwkv-big-instant-only.zip",
            "model": "Big Instant-only SM99",
            "weightsSha256": WEIGHTS_SHA256,
            "weightsPrecision": "FP32",
            "referenceSha256": sha256(package / "reference/small_model_recurrent.py"),
            "source": "Synthetic users 900001 and 900002 published with the release",
            "fp32Expected": "Upstream golden NPZ, independently verified with recurrent NumPy reference",
            "int8StateExpected": "Recurrent NumPy reference state_bits=8; K=32 row scales and float16 shifts",
            "entityIds": "Remapped to dense positive indices per stream; original int64 identities exceed JavaScript safe integers. This does not change state sharing or features.",
            "tolerance": 0.00001,
            "rowsPerUser": args.rows,
        },
        "users": [],
    }
    feature_fixture = {
        "provenance": {
            "release": fixture["provenance"]["release"],
            "source": fixture["provenance"]["source"],
            "columns": "First 24 numeric features; ID encodings and calendar encodings are excluded",
        },
        "users": [],
    }
    for path in sorted((package / "testvectors").glob("user_*.npz")):
        vec = np.load(path)
        # The model uses these only as state-store keys. Several upstream note
        # IDs exceed 2**53, so never convert them through JavaScript numbers.
        id_codes = {stream: {int(entity): index + 1 for index, entity in
                            enumerate(np.unique(vec["id_" + stream]))} for stream in STREAMS}
        feature_rows = []
        for i in range(min(512, int(vec["n_rows"]))):
            feature_rows.append({
                "features": vec["features"][i][:24].tolist(),
                "ids": [id_codes[stream][int(vec["id_" + stream][i])] for stream in STREAMS],
                "skip": bool(vec["skip"][i]),
                "isQuery": bool(vec["is_query"][i]),
                "reviewTh": int(vec["review_th"][i]),
                "raw": {name[4:]: float(vec[name][i]) for name in vec.files if name.startswith("raw_")},
            })
        feature_fixture["users"].append({"user": int(vec["user"]), "rows": feature_rows})
        n = min(args.rows, int(vec["n_rows"]))
        models = {bits: RecurrentModel(weights, spec, state_bits=bits) for bits in (0, 8)}
        stores = {bits: model.new_store() for bits, model in models.items()}
        rows = []
        max_error = 0
        for i in range(n):
            ids = {stream: int(vec["id_" + stream][i]) for stream in STREAMS}
            features = vec["features"][i]
            skip = bool(vec["skip"][i])
            expected = {}
            for bits, model in models.items():
                heads = model.step(features, ids, skip, stores[bits])
                recall, ratings = model.instant(heads)
                if bits == 0:
                    golden_recall = float(vec["fp32_p_imm"][i])
                    golden_ratings = vec["fp32_p_rating"][i]
                    max_error = max(max_error, abs(recall - golden_recall),
                                    float(np.abs(ratings - golden_ratings).max()))
                    recall, ratings = golden_recall, golden_ratings
                expected[str(bits)] = {"recall": float(recall), "ratings": ratings.tolist()}
            rows.append({"features": features.tolist(), "ids": [id_codes[stream][ids[stream]] for stream in STREAMS],
                         "skip": skip, "expected": expected})
        assert max_error < 1e-5, (path.name, max_error)
        fixture["users"].append({"user": int(vec["user"]), "vectorSha256": sha256(path),
                                 "referenceMaxError": max_error, "rows": rows})
        print(f"PASS user {int(vec['user'])}: {n} rows, FP32 reference max error {max_error:.3g}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    feature_output = args.output.with_name("big-sm99-features.json")
    feature_output.write_text(json.dumps(feature_fixture, separators=(",", ":")) + "\n")
    print(f"Wrote {feature_output} ({feature_output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
