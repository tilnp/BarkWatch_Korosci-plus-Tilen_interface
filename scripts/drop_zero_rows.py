#!/usr/bin/env python3
"""Remove rows where a specified column equals 0 from a CSV file.

Usage:
    python drop_zero_rows.py <column> <file.csv> [file2.csv ...]

Output is saved alongside the original with _no_zeros appended to the stem.
"""

import sys
from pathlib import Path
import pandas as pd

if len(sys.argv) < 3:
    print("Usage: python drop_zero_rows.py <column> <file.csv> [file2.csv ...]")
    sys.exit(1)

column = sys.argv[1]

for path in sys.argv[2:]:
    p = Path(path)
    df = pd.read_csv(p)

    if column not in df.columns:
        print(f"SKIP {p.name} — column '{column}' not found (available: {list(df.columns)})")
        continue

    before = len(df)
    df_filtered = df[pd.to_numeric(df[column], errors="coerce").fillna(0) != 0]
    dropped = before - len(df_filtered)

    out = p.with_name(p.stem + "_no_zeros" + p.suffix)
    df_filtered.to_csv(out, index=False)
    print(f"OK   {p.name} → {out.name}  (dropped {dropped:,} / {before:,} rows)")
