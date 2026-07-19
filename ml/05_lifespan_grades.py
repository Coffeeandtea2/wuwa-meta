"""⑤ 메타 수명 등급 — 완성본 (픽률 시계열 확보 전 프록시 로직 포함).

원래 설계: toa_usage 픽률 곡선의 반감 시즌 → 3등급.
현재: 픽률 시즌 수 < 3이면 프록시(출시 경과 × 현재 티어)로 등급 산출하고 method='proxy' 표기.
픽률 CSV가 쌓이면 자동으로 곡선 방식으로 전환됨.
출력: site/public/data/gold_lifespan.parquet
"""
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path("site/public/data")


def from_curves(usage: pd.DataFrame, chars: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for cid, g in usage.sort_values("season_id").groupby("character_id"):
        peak = g.pick_rate.max()
        half = g[g.pick_rate < peak * 0.5]
        first_season = g.season_id.min()
        if len(half):
            hl = int(half.season_id.iloc[0] - first_season)
            rows.append({"character_id": cid, "half_life_seasons": hl, "censored": False})
        else:
            rows.append({"character_id": cid,
                         "half_life_seasons": int(g.season_id.max() - first_season),
                         "censored": True})
    df = pd.DataFrame(rows)
    q1, q3 = df.half_life_seasons.quantile([0.33, 0.66])
    df["grade"] = np.select(
        [df.half_life_seasons >= q3, df.half_life_seasons >= q1],
        ["장수형", "평균형"], default="단명형")
    df.loc[df.censored & (df.grade == "단명형"), "grade"] = "관측중"
    df["method"] = "curve"
    return df


def from_proxy(chars: pd.DataFrame) -> pd.DataFrame:
    # 프록시: 출시 후 오래 지났는데 티어가 높음 = 장수형 신호
    pc = pd.read_parquet(OUT / "gold_powercreep.parquet")[["character_id", "release_date"]]
    df = chars.merge(pc, on="character_id", how="left")
    age_days = (pd.Timestamp.today() - df.release_date).dt.days.fillna(0)
    tier_score = df.tier.map({"S": 4, "A": 3, "B": 2, "C": 1, "D": 0}).fillna(2)
    old = age_days > age_days.median()
    df["grade"] = np.select(
        [old & (tier_score >= 3), old & (tier_score <= 1), ~old],
        ["장수형", "단명형", "관측중"], default="평균형")
    df["half_life_seasons"] = None
    df["censored"] = True
    df["method"] = "proxy"
    return df[["character_id", "grade", "half_life_seasons", "censored", "method"]]


def main():
    chars = pd.read_parquet(OUT / "characters.parquet")
    try:
        usage = pd.read_parquet(OUT / "toa_usage.parquet")
    except Exception:
        usage = pd.DataFrame(columns=["season_id", "character_id", "pick_rate"])
    if usage.season_id.nunique() >= 3:
        df = from_curves(usage, chars)
    else:
        df = from_proxy(chars)
        print("픽률 시즌 <3 → proxy 모드 (CSV가 쌓이면 curve로 자동 전환)")
    df.to_parquet(OUT / "gold_lifespan.parquet", index=False)
    print("gold_lifespan:", df.grade.value_counts().to_dict())


if __name__ == "__main__":
    main()
