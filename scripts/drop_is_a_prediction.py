#!/usr/bin/env python3
"""Remove the is_a_prediction column from a CSV file, saving to a new file."""

import sys
from pathlib import Path
import pandas as pd

if len(sys.argv) < 2:
    print("Usage: python drop_is_a_prediction.py <file.csv> [file2.csv ...]")
    sys.exit(1)

for path in sys.argv[1:]:
    p = Path(path)
    df = pd.read_csv(p)
    if "is_a_prediction" not in df.columns:
        print(f"SKIP {path} — column 'is_a_prediction' not found")
        continue
    out = p.with_name(p.stem + "_" + p.suffix)
    df.drop(columns=["is_a_prediction"]).to_csv(out, index=False)
    print(f"OK   {path} -> {out.name}")
