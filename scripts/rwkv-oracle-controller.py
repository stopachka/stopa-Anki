#!/usr/bin/env python3
"""Check app feature/controller assembly against independent NumPy inference.

Usage: python scripts/rwkv-oracle-controller.py /path/to/rwkv-big-instant-only
Requires numpy and Node.js 24. Inputs are synthetic app review records; expected
predictions use the published model reference. Feature formulas have separate
upstream-vector tests; this fixture verifies the assembled replay/query path.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('VECLIB_MAXIMUM_THREADS', '1')
import numpy as np

package = Path(sys.argv[1]).resolve()
scripts = Path(__file__).resolve().parent
app = scripts.parent
weights_hash = hashlib.sha256((package / 'weights.f32.bin').read_bytes()).hexdigest()
assert weights_hash == '682ba1ff207c51af7de5e2abeb25593362aa706b292cbcc338a1591fad0d935c'
sys.path.insert(0, str(package / 'reference'))
from small_model_recurrent import RecurrentModel
from weights_io import load_package

fixture = json.loads(subprocess.check_output(
    ['node', '--experimental-strip-types', str(scripts / 'rwkv-oracle-controller.mjs')], cwd=app))
weights, spec = load_package(package, 'fp32')
model = RecurrentModel(weights, spec, state_bits=0)
store = model.new_store()
streams = ['card_id', 'deck_id', 'note_id', 'preset_id', 'user_id']
expected = [[] for _ in fixture['steps']]
for operation in fixture.pop('operations'):
    if operation['kind'] == 'reset':
        store = model.new_store()
        continue
    heads = model.step(np.array(operation['features'], dtype=np.float32),
                       dict(zip(streams, operation['ids'])), not operation['commit'], store)
    recall, ratings = model.instant(heads)
    if not operation['commit']:
        expected[operation['step']].append({'id': operation['wordId'], 'recall': recall})
for step, predictions in zip(fixture['steps'], expected):
    step['expected'] = sorted(predictions, key=lambda value: (value['recall'], value['id']))
fixture['provenance'] = {
    'release': 'https://github.com/JSchoreels/anki-rwkv/releases/tag/rwkv-family-2026-11-13',
    'model': 'Big Instant-only SM99', 'weightsSha256': weights_hash, 'statePrecision': 'FP32',
    'inputSource': 'Synthetic app records assembled by the production feature/controller code',
    'predictionSource': 'Published unmodified RecurrentModel NumPy reference, FP32 weights and state',
    'tolerance': 0.00001,
}
output = app / 'src/lib/rwkv/__fixtures__/controller-reference.json'
output.write_text(json.dumps(fixture, indent=2) + '\n')
print(f'Wrote {output}: {len(fixture["records"])} records, {len(fixture["steps"])} replay/query scenarios')
