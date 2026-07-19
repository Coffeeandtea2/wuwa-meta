"""④ 파워크리프 회귀 — 출시일 vs 기준 배율(궁극기 최대레벨 % 합). — 완성본

기준 배율 정의: TypeName='공명 해방' 스킬의 최대 레벨 % 배율 합 (없으면 전 스킬 최대).
출력: site/public/data/gold_powercreep.parquet
"""
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path("site/public/data")


def main():
    skills = pd.read_parquet(OUT / "skills_long.parquet")
    chars = pd.read_parquet(OUT / "characters.parquet")
    banners = pd.read_parquet(OUT / "banner_history.parquet")

    # 캐릭터별 출시일 = 첫 픽업 배너 시작일 (상시 캐릭터는 게임 출시일)
    first_run = (
        banners[(banners.kind == "resonator") & (banners.featured_rarity == 5)]
        .groupby("character_id")["banner_start"].min()
    )
    launch = pd.Timestamp("2024-05-22")
    chars["release_date"] = chars["character_id"].map(first_run).fillna(launch)
    chars["release_days"] = (chars["release_date"] - launch).dt.days

    # 기준 배율
    pct = skills[skills.is_percent]
    ult = pct[pct.skill_type == "공명 해방"]
    base = ult if len(ult) else pct
    max_lv = base.groupby(["character_id", "attribute"])["value"].max().reset_index()
    ref = max_lv.groupby("character_id")["value"].sum().rename("ref_multiplier")
    df = chars.merge(ref, on="character_id", how="left").dropna(subset=["ref_multiplier"])

    # 성급 분리 회귀 (섞으면 성급 효과가 지배)
    rows = []
    for rarity, g in df.groupby("rarity"):
        x = g["release_days"].values.astype(float)
        y = g["ref_multiplier"].values.astype(float)
        if len(g) < 3 or np.std(x) == 0:  # 표본 부족·전원 동일 출시일(상시 4성 등)
            slope, intercept = 0.0, float(np.mean(y))
        else:
            slope, intercept = np.polyfit(x, y, 1)
        pred = slope * x + intercept
        resid = y - pred
        for (_, r), p, e in zip(g.iterrows(), pred, resid):
            rows.append({
                "character_id": r.character_id,
                "rarity": rarity,
                "release_date": r.release_date,
                "ref_multiplier": r.ref_multiplier,
                "predicted": round(float(p), 1),
                "residual": round(float(e), 1),
                "inflation_slope_per_100d": round(slope * 100, 2),
            })
    out = pd.DataFrame(rows)
    # 대체 위험: 출시 오래됨 + 배율이 추세선 아래 → 위험
    age_med = out.groupby("rarity")["release_date"].transform("median")
    out["risk_grade"] = np.select(
        [(out.release_date < age_med) & (out.residual < 0),
         (out.release_date < age_med) | (out.residual < 0)],
        ["높음", "중간"], default="낮음")
    out.to_parquet(OUT / "gold_powercreep.parquet", index=False)
    print("gold_powercreep:", len(out), "| slope(5성)/100d:",
          out[out.rarity == 5].inflation_slope_per_100d.iloc[0])


if __name__ == "__main__":
    main()
