"""raw JSON → site/public/data/*.parquet 가공 파이프라인. — 완성본

실행: python scripts/build_data.py
전제: data/raw/ 에 wuthering_gg_ko/, encore_moe_ko/ 압축 해제
     (banner_history.json은 fetch_banners.py가 생성)
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

RAW = Path("data/raw")
MANUAL = Path("data/manual")
OUT = Path("site/public/data")

GAME_LAUNCH = date(2024, 5, 22)  # 1.0 출시일 — 시즌 역산의 앵커


def load(p):
    return json.loads((RAW / p).read_text(encoding="utf-8"))


def build_characters() -> pd.DataFrame:
    chars = load("wuthering_gg_ko/characters.json")
    tiers = load("wuthering_gg_ko/tier-list.json")
    tier_of = {c["Id"]: (t, c["Role"]) for t, lst in tiers.items() for c in lst}

    rows = []
    for c in chars:
        t, role = tier_of.get(c["Id"], (None, None))
        rows.append({
            "character_id": c["Id"],
            "name": c["Name"],
            "name_en": c["NameEn"],
            "rarity": c["QualityId"],
            "element": c["Element"]["Name"],
            "weapon_type": c["WeaponType"],
            "base_hp": c["Stats"].get("Life"),
            "base_atk": c["Stats"].get("Atk"),
            "base_def": c["Stats"].get("Def"),
            "tier": t,
            "role": role,
        })
    df = pd.DataFrame(rows)
    df.to_parquet(OUT / "characters.parquet", index=False)
    return df


def build_banners(chars: pd.DataFrame):
    src = RAW / "banner_history.json"
    if not src.exists():
        print("skip banners (fetch_banners.py 먼저 실행)")
        return
    banners = json.loads(src.read_text(encoding="utf-8"))
    en2id = dict(zip(chars["name_en"], chars["character_id"]))
    rows = []
    for b in banners:
        start = pd.to_datetime(b["time_start"].split()[0], errors="coerce")
        for slot, names in [(5, b["featured_5"]), (4, b["featured_4"])]:
            for n in names:
                rows.append({
                    "banner_name": b["banner_name"],
                    "kind": b["kind"],
                    "banner_start": start,
                    "banner_end": pd.to_datetime(b["time_end"].split()[0], errors="coerce") if b["time_end"] else None,
                    "featured_rarity": slot,
                    "name_en": n,
                    "character_id": en2id.get(n),  # 무기 배너·미매칭은 NULL 유지
                })
    df = pd.DataFrame(rows).dropna(subset=["banner_start"])
    df.to_parquet(OUT / "banner_history.parquet", index=False)
    print(f"banners: {len(df)} rows, id 매칭 실패 {df[df.kind=='resonator']['character_id'].isna().sum()}건 (resonator)")


def build_seasons():
    toa = load("encore_moe_ko/toa.json")["seasons"]
    rotating = [s for s in toa if s["id"] > 0]
    n = len(rotating)
    # 근사: 출시일~오늘을 시즌 수로 등분 (실제 리셋 주기 확인 시 상수로 교체)
    total_days = (date.today() - GAME_LAUNCH).days
    step = total_days / n
    rows = [{
        "season_id": s["id"],
        "season_name": s["name"],
        "areas": s["areas"],
        "approx_start": GAME_LAUNCH + timedelta(days=round(step * (s["id"] - 1))),
        "approx_end": GAME_LAUNCH + timedelta(days=round(step * s["id"]) - 1),
    } for s in rotating]
    pd.DataFrame(rows).to_parquet(OUT / "seasons.parquet", index=False)
    print(f"seasons: {n} (간격 근사 {step:.1f}일 — 검증 필요 라벨)")


def build_toa_usage(chars: pd.DataFrame):
    files = sorted(MANUAL.glob("toa_usage_*.csv"))
    if not files:
        print("skip toa_usage (data/manual/toa_usage_*.csv 없음)")
        return
    df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    need = {"season_id", "character_id", "pick_rate", "sample_size", "source_url"}
    assert need <= set(df.columns), f"CSV 스키마 불일치: {need - set(df.columns)}"
    bad = set(df["character_id"]) - set(chars["character_id"])
    assert not bad, f"존재하지 않는 character_id: {bad}"
    df = df.drop_duplicates(["season_id", "character_id"], keep="last")
    df.to_parquet(OUT / "toa_usage.parquet", index=False)
    print(f"toa_usage: {len(df)} rows / {df.season_id.nunique()} seasons")


def build_skills_long():
    chars = load("wuthering_gg_ko/characters.json")

    def parse_value(s):
        # 표기 예: "24.50%", "575+2.90%", "24.5%*3" — %가 붙은 수들의 합으로 근사, 없으면 첫 숫자
        if not isinstance(s, str):
            return None, None
        pcts = re.findall(r"([\d.]+)\s*%", s)
        if pcts:
            return sum(float(x) for x in pcts), True
        nums = re.findall(r"[\d.]+", s)
        return (float(nums[0]), False) if nums else (None, None)

    rows = []
    for c in chars:
        for sk in c.get("Skills", []):
            for m in sk.get("Multipliers", []):
                for lv, val in enumerate(m.get("SkillDetailNum", [{}])[0].get("ArrayString", []), start=1):
                    v, is_pct = parse_value(val)
                    if v is not None:
                        rows.append({
                            "character_id": c["Id"],
                            "skill_type": sk.get("TypeName"),
                            "skill_name": sk.get("SkillName"),
                            "attribute": m.get("AttributeName"),
                            "level": lv,
                            "value": v,
                            "is_percent": is_pct,
                            "raw": val,
                        })
    df = pd.DataFrame(rows)
    df.to_parquet(OUT / "skills_long.parquet", index=False)
    print(f"skills_long: {len(df)} rows / {df.character_id.nunique()} chars")


def build_skill_tags():
    """반주(아웃트로) 스킬 텍스트에서 버프 대상 추출 + 공명 체인 요약."""
    chars = load("wuthering_gg_ko/characters.json")
    ELEMS = ["용융", "응결", "전도", "기류", "회절", "인멸", "전체"]
    SKT = ["일반 공격", "공명 스킬", "공명 해방", "협동 공격", "변주 스킬"]

    def subst(desc, vals):
        if isinstance(vals, list):
            for i, v in enumerate(vals):
                if isinstance(v, str):
                    desc = desc.replace("{%d}" % i, v)
        return desc

    tag_rows, chain_rows = [], []
    for ch in chars:
        elems, skts, heal = set(), set(), False
        outro_desc = ""
        for sk in ch.get("Skills", []):
            if sk.get("TypeName") != "반주 스킬":
                continue
            d = subst(sk.get("SkillDescribe", ""), sk.get("SkillDetailNum", []))
            outro_desc = re.sub(r"<[^>]+>", "", d)
            buffs = re.findall(r"([가-힣 ]{2,16}?피해)(?:가|를|이)?\s*([\d.]+%)\s*(?:부스트|증폭|강화|증가)", d)
            elems |= {e for b, _ in buffs for e in ELEMS if e in b}
            skts |= {k for b, _ in buffs for k in SKT if k in b}
            heal = heal or ("회복" in d)
        tag_rows.append({
            "character_id": ch["Id"],
            "outro_buff_elements": ",".join(sorted(elems)),
            "outro_buff_skilltypes": ",".join(sorted(skts)),
            "outro_heal": heal,
            "outro_desc": outro_desc[:160],
        })
        for seq, node in enumerate(ch.get("ResonantChainGroup", []) or [], start=1):
            desc = node.get("AttributesDescription", "") or ""
            params = node.get("AttributesDescriptionParams", []) or []
            for i, v in enumerate(params):
                desc = desc.replace("{%d}" % i, str(v))
            desc = re.sub(r"<[^>]+>", "", desc)
            pcts = [float(x) for x in re.findall(r"([\d.]+)%", desc)]
            chain_rows.append({
                "character_id": ch["Id"],
                "chain_no": seq,
                "chain_name": node.get("NodeName"),
                "desc": desc[:200],
                "pct_sum": round(sum(pcts), 1),
            })
    pd.DataFrame(tag_rows).to_parquet(OUT / "skill_tags.parquet", index=False)
    pd.DataFrame(chain_rows).to_parquet(OUT / "chains.parquet", index=False)
    print(f"skill_tags: {len(tag_rows)} | chains: {len(chain_rows)}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    chars = build_characters()
    print(f"characters: {len(chars)}")
    build_banners(chars)
    build_seasons()
    build_toa_usage(chars)
    build_skills_long()
    build_skill_tags()
    print("build complete ->", OUT)
