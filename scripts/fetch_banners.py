"""Fandom 위키에서 배너 히스토리 수집 (⑥ 복각 간격의 원천). — 완성본

출력: data/raw/banner_history.json
실행: python scripts/fetch_banners.py
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://wutheringwaves.fandom.com/api.php"
HDR = {"User-Agent": "Mozilla/5.0 (wuwa-meta data pipeline)"}
OUT = Path("data/raw/banner_history.json")


def api_get(params: dict) -> dict:
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{API}?{qs}", headers=HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def list_banner_pages(category: str) -> list[str]:
    titles, cont = [], {}
    while True:
        d = api_get({
            "action": "query", "list": "categorymembers",
            "cmtitle": f"Category:{category}",
            "cmlimit": 500, "format": "json", **cont,
        })
        titles += [m["title"] for m in d["query"]["categorymembers"]]
        cont = d.get("continue", {})
        if not cont:
            return titles


def parse_banner(title: str) -> dict | None:
    d = api_get({"action": "parse", "page": title, "format": "json", "prop": "wikitext"})
    if "parse" not in d:
        return None
    wt = d["parse"]["wikitext"]["*"]

    def field(name: str) -> str:
        m = re.search(rf"\|{name}\s*=\s*([^|\n}}]*)", wt)
        return m.group(1).strip() if m else ""

    def split_names(raw: str) -> list[str]:
        return [x.strip() for x in raw.split(";") if x.strip()]

    banner_name, _, start_from_title = title.partition("/")
    return {
        "page": title,
        "banner_name": banner_name,
        "time_start": field("time_start") or start_from_title,
        "time_end": field("time_end"),
        "featured_5": split_names(field("resonator_5_F") or field("weapon_5_F")),
        "featured_4": split_names(field("resonator_4_F") or field("weapon_4_F")),
    }


def main():
    rows = []
    for category, kind in [
        ("Featured Resonator Convenes", "resonator"),
        ("Featured Weapon Convenes", "weapon"),
    ]:
        pages = list_banner_pages(category)
        print(f"{category}: {len(pages)} pages")
        for i, t in enumerate(pages, 1):
            b = parse_banner(t)
            if b and b["featured_5"]:
                b["kind"] = kind
                rows.append(b)
            time.sleep(0.4)
            if i % 20 == 0:
                print(f"  {i}/{len(pages)}")
    rows.sort(key=lambda r: r["time_start"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"saved {len(rows)} banners -> {OUT}")


if __name__ == "__main__":
    main()
