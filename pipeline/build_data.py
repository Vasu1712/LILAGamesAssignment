"""
LILA BLACK telemetry -> compact static JSON for the web visualizer.

Usage:
    pip install -r pipeline/requirements.txt
    python pipeline/build_data.py --src data/player_data --out web/public

What it does
  1. Reads every parquet journey file (no .parquet extension) under February_*/.
  2. Decodes the `event` column from bytes to str.
  3. Fixes the timestamp unit: `ts` is typed timestamp[ms] but the stored integers are
     Unix *seconds* (1770681535 -> 2026-02-10). We treat the raw integer as seconds.
  4. De-duplicates journey files that appear in more than one day folder, and exact
     duplicate movement samples.
  5. Classifies each journey as human or bot from its telemetry (Position vs
     BotPosition), and records whether the user_id looks like a UUID.
  6. Projects world (x, z) to minimap pixels (1024 x 1024 space) using the per-map
     scale/origin from the data README. `y` (elevation) is kept for tooltips only.
  7. Writes one columnar JSON per map plus a small index, and downsizes minimaps.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

MAPS = {
    # map_id: (scale, origin_x, origin_z, minimap file)
    "AmbroseValley": (900.0, -370.0, -473.0, "AmbroseValley_Minimap.png"),
    "GrandRift": (581.0, -290.0, -290.0, "GrandRift_Minimap.png"),
    "Lockdown": (1000.0, -500.0, -500.0, "Lockdown_Minimap.jpg"),
}
MAP_PX = 1024  # coordinate space of the minimap (README); images are resized to fit it

# Event codes shared with the frontend (web/src/data/types.ts).
EVENT_CODES = {
    "Position": 0,
    "BotPosition": 1,
    "Kill": 2,
    "Killed": 3,
    "BotKill": 4,
    "BotKilled": 5,
    "KilledByStorm": 6,
    "Loot": 7,
}
MOVEMENT = {"Position", "BotPosition"}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def world_to_px(x: np.ndarray, z: np.ndarray, map_id: str) -> tuple[np.ndarray, np.ndarray]:
    scale, ox, oz, _ = MAPS[map_id]
    u = (x - ox) / scale
    v = (z - oz) / scale
    return u * MAP_PX, (1.0 - v) * MAP_PX  # image Y axis points down


def load(src: Path) -> tuple[pd.DataFrame, dict]:
    frames, stats = [], defaultdict(int)
    seen_files: dict[str, str] = {}
    for day_dir in sorted(p for p in src.iterdir() if p.is_dir() and p.name.startswith("February")):
        for f in sorted(day_dir.iterdir()):
            if f.name.startswith("."):
                continue
            stats["files_total"] += 1
            if f.name in seen_files:
                # Same {user}_{match} journey exported into two day folders (match crossed midnight).
                stats["files_duplicate_across_days"] += 1
                continue
            try:
                tbl = pq.read_table(f)
                # Read the raw integer behind `ts` (see note 3 above) instead of letting
                # pandas interpret it as milliseconds since 1970.
                tbl = tbl.set_column(tbl.schema.get_field_index("ts"), "ts", tbl.column("ts").cast(pa.int64()))
                t = tbl.to_pandas()
            except Exception:  # noqa: BLE001 - corrupt/non-parquet files are skipped and counted
                stats["files_unreadable"] += 1
                continue
            if t.empty:
                stats["files_empty"] += 1
                continue
            seen_files[f.name] = day_dir.name
            t["day"] = day_dir.name
            frames.append(t)
    df = pd.concat(frames, ignore_index=True)
    stats["files_loaded"] = len(frames)
    return df, dict(stats)


def clean(df: pd.DataFrame, stats: dict) -> pd.DataFrame:
    df["event"] = df["event"].map(lambda b: b.decode("utf-8") if isinstance(b, (bytes, bytearray)) else str(b))
    unknown = ~df["event"].isin(EVENT_CODES)
    stats["rows_unknown_event"] = int(unknown.sum())
    df = df[~unknown].copy()

    # ts is labelled milliseconds but holds Unix seconds.
    df["ts_s"] = df["ts"].astype("int64")
    df["match_id"] = df["match_id"].str.replace(r"\.nakama-0$", "", regex=True)

    before = len(df)
    dup = df.duplicated(["user_id", "match_id", "ts_s", "event", "x", "y", "z"]) & df["event"].isin(MOVEMENT)
    df = df[~dup]
    stats["rows_duplicate_movement_dropped"] = before - len(df)
    # Identical Loot/combat rows are kept: several items picked up (or bots killed) in the
    # same second at the same spot are real, separate events.
    stats["rows"] = len(df)
    return df


def build(src: Path, out: Path) -> None:
    df, stats = load(src)
    df = clean(df, stats)

    # Player classification from telemetry, cross-checked with the id format.
    per_journey = df.groupby(["match_id", "user_id"])["event"].agg(set)
    kind = {}
    for (mid, uid), evs in per_journey.items():
        is_uuid = bool(UUID_RE.match(uid))
        if "Position" in evs:
            human = True
        elif "BotPosition" in evs:
            human = False
        else:
            human = is_uuid  # no movement samples: fall back to the README id rule
        if human != is_uuid:
            stats["journeys_id_rule_disagrees_with_telemetry"] = stats.get("journeys_id_rule_disagrees_with_telemetry", 0) + 1
        kind[(mid, uid)] = (human, is_uuid)

    out_data = out / "data"
    out_data.mkdir(parents=True, exist_ok=True)
    index = {"maps": {}, "days": sorted(df["day"].unique().tolist()), "stats": stats, "eventCodes": EVENT_CODES}

    for map_id, mdf in df.groupby("map_id"):
        if map_id not in MAPS:
            stats.setdefault("unknown_maps", []).append(map_id)
            continue
        mdf = mdf.sort_values(["match_id", "ts_s"]).copy()
        px, py = world_to_px(mdf["x"].to_numpy("float64"), mdf["z"].to_numpy("float64"), map_id)
        mdf["px"], mdf["py"] = px, py

        matches, players = [], []
        player_idx: dict[tuple[str, str], int] = {}
        match_idx: dict[str, int] = {}
        for mid, g in mdf.groupby("match_id", sort=False):
            start, end = int(g["ts_s"].min()), int(g["ts_s"].max())
            pids = []
            for uid in g["user_id"].unique():
                human, is_uuid = kind[(mid, uid)]
                pj = g[g["user_id"] == uid]
                ev = pj["event"].value_counts().to_dict()
                player_idx[(mid, uid)] = len(players)
                pids.append(len(players))
                players.append({
                    "id": uid,
                    "human": human,
                    "uuid": is_uuid,
                    "m": len(matches),
                    # outcome for humans: last terminal event in their journey, else survived/extracted
                    "fate": _fate(pj) if human else _bot_fate(pj),
                })
            ev = g["event"].value_counts().to_dict()
            match_idx[mid] = len(matches)
            matches.append({
                "id": mid,
                "day": g["day"].min(),
                "start": start,
                "dur": end - start,
                "players": pids,
                "humans": sum(players[p]["human"] for p in pids),
                "bots": sum(not players[p]["human"] for p in pids),
                "counts": {k: int(v) for k, v in ev.items() if k not in MOVEMENT},
            })

        rows = {
            "p": [player_idx[(m, u)] for m, u in zip(mdf["match_id"], mdf["user_id"])],
            "t": [int(t - matches[match_idx[m]]["start"]) for m, t in zip(mdf["match_id"], mdf["ts_s"])],
            "x": np.round(mdf["px"].to_numpy(), 1).tolist(),
            "y": np.round(mdf["py"].to_numpy(), 1).tolist(),
            "h": np.round(mdf["y"].to_numpy("float64"), 1).tolist(),
            "e": [EVENT_CODES[e] for e in mdf["event"]],
        }
        scale, ox, oz, img = MAPS[map_id]
        payload = {"map": map_id, "config": {"scale": scale, "originX": ox, "originZ": oz, "size": MAP_PX},
                   "matches": matches, "players": players, "rows": rows}
        (out_data / f"{map_id}.json").write_text(json.dumps(payload, separators=(",", ":")))
        index["maps"][map_id] = {
            "matches": len(matches),
            "rows": len(mdf),
            "humans": int(mdf.loc[[kind[k][0] for k in zip(mdf["match_id"], mdf["user_id"])], "user_id"].nunique()),
            "image": f"minimaps/{map_id}.webp",
        }
        print(f"{map_id}: {len(matches)} matches, {len(players)} journeys, {len(mdf)} rows")

    (out_data / "index.json").write_text(json.dumps(index, indent=1))
    print(json.dumps(stats, indent=1))
    build_minimaps(src / "minimaps", out / "minimaps")


def _fate(pj: pd.DataFrame) -> str:
    deaths = pj[pj["event"].isin(["Killed", "BotKilled", "KilledByStorm"])]
    if deaths.empty:
        return "survived"
    return {"Killed": "killed_by_player", "BotKilled": "killed_by_bot", "KilledByStorm": "storm"}[deaths.iloc[-1]["event"]]


def _bot_fate(pj: pd.DataFrame) -> str:
    return "killed" if (pj["event"] == "BotKilled").any() else "survived"


def build_minimaps(src: Path, out: Path, size: int = 2048) -> None:
    if not src.exists():
        print(f"minimaps: {src} not found, keeping existing images in {out}")
        return
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    out.mkdir(parents=True, exist_ok=True)
    for map_id, (*_, fname) in MAPS.items():
        p = src / fname
        if not p.exists():
            continue
        im = Image.open(p).convert("RGB")
        # GrandRift ships as 2160x2158; the README defines a square UV space, so we
        # stretch every image to a square rather than letterboxing it.
        im = im.resize((size, size), Image.LANCZOS)
        im.save(out / f"{map_id}.webp", "WEBP", quality=82, method=6)
        print(f"minimap {map_id}: {os.path.getsize(out / f'{map_id}.webp') // 1024} KB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path("data/player_data"))
    ap.add_argument("--out", type=Path, default=Path("web/public"))
    a = ap.parse_args()
    build(a.src, a.out)
