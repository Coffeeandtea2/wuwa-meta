"""외부 사이트 티어 평가 수집 → external_tiers.parquet — 완성본

현재 소스: PocketTactics (EN, 접근 가능 확인). Prydwen/Game8(EN)/나무위키는 봇 차단,
gamewith(JP)는 파싱 비협조적 구조라 보류 — 소스가 늘면 SOURCES에 파서만 추가.
실행: python scripts/fetch_external_tiers.py
"""
import re
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

OUT = Path("site/public/data")
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126"}

ALIASES = {  # 외부 표기 → characters.parquet name_en
    "yangayng xuanling": "Yangyang: Xuanling",
    "yangyang xuanling": "Yangyang: Xuanling",
    "rover aero": "Rover (Aero)",
    "rover havoc": "Rover (Havoc)",
    "rover spectro": "Rover (Spectro)",
    "rover electro": "Rover (Electro)",
    "the shorekeeper": "Shorekeeper",
}


def norm(name: str) -> str:
    return re.sub(r"[^a-z ]", "", name.lower().replace("(", " ").replace(")", " ")).strip()


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def parse_pockettactics() -> list[tuple[str, str]]:
    html = fetch("https://www.pockettactics.com/wuthering-waves/tier-list")
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"\n+", "\n", text)
    i = text.find("Rank\nWuthering Waves character")
    seg = text[i : i + 3000]
    pairs = []
    for m in re.finditer(r"^(SS|S|A|B|C|D)\n([^\n]+)$", seg, re.M):
        tier, names = m.group(1), m.group(2)
        for n in names.split(","):
            n = n.strip()
            if n:
                pairs.append((n, tier))
    return pairs


def main():
    chars = pd.read_parquet(OUT / "characters.parquet")[["character_id", "name_en"]]
    by_norm = {norm(r.name_en): r.character_id for r in chars.itertuples()}

    rows = []
    for source, parser in [("PocketTactics", parse_pockettactics)]:
        try:
            pairs = parser()
        except Exception as e:
            print(f"{source} FAIL: {e}")
            continue
        miss = []
        for name, tier in pairs:
            key = norm(ALIASES.get(norm(name), name))
            cid = by_norm.get(key)
            if cid is None:
                miss.append(name)
                continue
            rows.append({"source": source, "character_id": cid, "tier": tier,
                         "fetched": str(date.today())})
        print(f"{source}: {len(pairs)}건 중 매칭 {len(pairs)-len(miss)}, 실패 {miss}")

    if rows:
        pd.DataFrame(rows).drop_duplicates(["source", "character_id"]).to_parquet(
            OUT / "external_tiers.parquet", index=False)
        print("saved external_tiers.parquet")


if __name__ == "__main__":
    main()
