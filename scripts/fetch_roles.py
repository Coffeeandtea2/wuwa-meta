"""Fandom 위키 인포박스에서 캐릭터 역할 수집 → roles.parquet — 완성본"""
import concurrent.futures as cf
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

OUT = Path("site/public/data")
API = "https://wutheringwaves.fandom.com/api.php"
HDR = {"User-Agent": "Mozilla/5.0 (wuwa-meta data pipeline)"}

PAGE_ALIASES = {
    "Shorekeeper": "The Shorekeeper",
    "Suisui": "Suisui",
    "Yangyang: Xuanling": "Yangyang· Xuanling",  # 1차 시도 실패 시 후보들 순회
}
FALLBACKS = ["{n}", "{n} (Resonator)"]

ROLE_KO = [  # (영문 키워드, 섹션)
    ("Main Damage Dealer", "메인 딜러"),
    ("Main DPS", "메인 딜러"),
    ("Sub Damage Dealer", "서브 딜러"),
    ("Sub DPS", "서브 딜러"),
    ("Hybrid", "서브 딜러"),
    ("Healer", "힐러"),
    ("Support", "서포트"),
    ("Concerto", "서포트"),
]


def get_wikitext(title: str) -> str | None:
    qs = urllib.parse.urlencode({"action": "parse", "page": title, "format": "json", "prop": "wikitext"})
    req = urllib.request.Request(f"{API}?{qs}", headers=HDR)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
        return d["parse"]["wikitext"]["*"] if "parse" in d else None
    except Exception:
        return None


def fetch_role(name_en: str):
    candidates = [PAGE_ALIASES.get(name_en, name_en)]
    for f in FALLBACKS:
        c = f.format(n=name_en)
        if c not in candidates:
            candidates.append(c)
    for title in candidates:
        wt = get_wikitext(title)
        if not wt:
            continue
        m = re.search(r"\|\s*role\s*=\s*([^\n]+)", wt, re.I)
        if m:
            full = re.sub(r"\[\[|\]\]|\{\{[^}]*\}\}", "", m.group(1)).strip()
            primary = next((ko for en, ko in ROLE_KO if en.lower() in full.lower()), None)
            return full, primary
    return None, None


def main():
    chars = pd.read_parquet(OUT / "characters.parquet")[["character_id", "name_en"]]
    rows = []
    with cf.ThreadPoolExecutor(8) as ex:
        for (cid, name), (full, primary) in zip(
            chars.itertuples(index=False), ex.map(fetch_role, chars["name_en"])
        ):
            rows.append({"character_id": cid, "role_full": full, "role_section": primary})
    df = pd.DataFrame(rows)
    miss = df[df.role_section.isna()]
    print(f"수집 {len(df)-len(miss)}/{len(df)}, 실패:",
          chars[chars.character_id.isin(miss.character_id)].name_en.tolist())
    df.to_parquet(OUT / "roles.parquet", index=False)


if __name__ == "__main__":
    main()
