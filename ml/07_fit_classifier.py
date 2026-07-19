"""⑦ 궁합 피처 — KMeans role_cluster + 캐릭터 피처 테이블. — 완성본

개인 사용 로그(라벨)가 없으므로 v1은 피처 생성까지: role_cluster(KMeans, 실루엣으로 k 선택),
소속 클러스터·티어·수명 등급을 묶은 gold_fit_features. 궁합 점수 계산은 사이트에서
보유 인벤토리와 조합해 실시간 산출 (main.js renderTeamRecs/renderVerdict).
출력: site/public/data/gold_fit_features.parquet
"""
from pathlib import Path

import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

OUT = Path("site/public/data")


def main():
    chars = pd.read_parquet(OUT / "characters.parquet")
    life = pd.read_parquet(OUT / "gold_lifespan.parquet")[["character_id", "grade"]]
    pc = pd.read_parquet(OUT / "gold_powercreep.parquet")[["character_id", "risk_grade", "residual"]]

    X = chars[["base_hp", "base_atk", "base_def"]].astype(float)
    Xs = StandardScaler().fit_transform(X)
    best_k, best_s = 2, -1.0
    for k in range(2, 7):
        labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(Xs)
        s = silhouette_score(Xs, labels)
        if s > best_s:
            best_k, best_s = k, s
    chars["role_cluster"] = KMeans(n_clusters=best_k, n_init=10, random_state=42).fit_predict(Xs)

    df = (chars[["character_id", "name", "rarity", "element", "role", "tier", "role_cluster"]]
          .merge(life, on="character_id", how="left")
          .merge(pc, on="character_id", how="left")
          .rename(columns={"grade": "lifespan_grade"}))
    df.to_parquet(OUT / "gold_fit_features.parquet", index=False)
    print(f"gold_fit_features: {len(df)} rows, k={best_k} (silhouette {best_s:.3f})")


if __name__ == "__main__":
    main()
