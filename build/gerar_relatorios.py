#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auxiliar da aba RELATÓRIOS — calcula as MÉTRICAS por período do funil ecommerce.

Uso pela Routine diária (1×/dia às 23h59 BRT) que regenera os briefings do Gestor:
este script NÃO escreve texto e NÃO chama nenhuma IA/API. Ele só faz a
matemática (fonte única de verdade, reaproveitando build.process) e emite um
JSON com os números de cada período. A Routine (Claude Code) lê esses números +
build/GUIA-RELATORIOS.md e redige os 9 briefings em build/relatorios.json.

Entradas (opcionais — sem elas busca ao vivo no Google Sheets, como o build.py):
    --meta-file --google-file --tiktok-file --ga4-file --sales-file   (CSVs locais)

Saída:
    --out relatorios_metrics.json   (default: build/relatorios_metrics.json)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

# Reaproveita TODA a lógica de leitura/atribuição do build (mesma fonte de verdade)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

BRT = timezone(timedelta(hours=-3))
PAID = ("meta", "google", "tiktok")


# --------------------------------------------------------------------------- #
# Métricas (mesma matemática do app.js: derive/agg)
# --------------------------------------------------------------------------- #
def new_bucket() -> dict:
    return dict(sp=0.0, im=0.0, cl=0.0, pv=0.0, pvp=0.0, vi=0.0, atc=0.0, ck=0.0, vendas=0, fat=0.0)


def add_media(a: dict, m: dict, tax: float) -> None:
    a["sp"] += m["sp"] * (tax if m["ch"] == "meta" else 1.0)
    a["im"] += m["im"]
    a["cl"] += m["cl"]


def add_ga(a: dict, g: dict) -> None:
    a["pv"] += g["pv"]
    if g["ch"] != "outros":
        a["pvp"] += g["pv"]
    for k in ("vi", "atc", "ck"):
        a[k] += g[k]


def add_sale(a: dict, s: dict) -> None:
    a["vendas"] += s["main"]
    a["fat"] += s["val"]


def sd(n, d):
    return (n / d) if d else None


def derive(a: dict) -> dict:
    g = a["sp"]
    return dict(
        gasto=g, impr=a["im"], cliques=a["cl"], pv=a["pv"], vi=a["vi"], atc=a["atc"], ck=a["ck"],
        vendas=a["vendas"], fat=a["fat"],
        cpm=sd(g * 1000, a["im"]), ctr=sd(a["cl"], a["im"]), cpc=sd(g, a["cl"]),
        cpv=sd(g, a["pvp"]), cr=sd(a["pvp"], a["cl"]), pvr=sd(a["vi"], a["pv"]),
        acr=sd(a["atc"], a["vi"]), vischk=sd(a["ck"], a["atc"]), cpic=sd(g, a["ck"]),
        convchk=sd(a["vendas"], a["ck"]),
        cac=sd(g, a["vendas"]) if g else None, roas=sd(a["fat"], g), ticket=sd(a["fat"], a["vendas"]),
    )


def in_range(d, a, b) -> bool:
    return bool(d) and a <= d <= b


def presets(today: str, dmin: str, dmax: str) -> dict:
    def addd(s, n):
        return (date.fromisoformat(s) + timedelta(days=n)).isoformat()

    def month_first(s):
        return s[:8] + "01"

    y, m, _ = today.split("-")
    y, m = int(y), int(m)
    last_day_prev = date(y, m, 1) - timedelta(days=1)
    first_prev = last_day_prev.replace(day=1)
    return {
        "hoje": (today, today),
        "ontem": (addd(today, -1), addd(today, -1)),
        "3d": (addd(today, -2), today),
        "7d": (addd(today, -6), today),
        "14d": (addd(today, -13), today),
        "30d": (addd(today, -29), today),
        "mes": (month_first(today), today),
        "mespass": (first_prev.isoformat(), last_day_prev.isoformat()),
        "todo": (dmin, dmax),
    }


def totals(media, ga, sales, a, b, chs, tax):
    bk = new_bucket()
    ok = lambda r: in_range(r["d"], a, b) and (chs is None or r["ch"] in chs)
    for m in media:
        if ok(m):
            add_media(bk, m, tax)
    for g in ga:
        if ok(g):
            add_ga(bk, g)
    for s in sales:
        if ok(s):
            add_sale(bk, s)
    return bk


def by_key(media, sales, a, b, keyfn, tax):
    mp = {}
    for m in media:
        if in_range(m["d"], a, b):
            add_media(mp.setdefault(keyfn(m), new_bucket()), m, tax)
    for s in sales:
        if in_range(s["d"], a, b) and s["ch"] in PAID:
            add_sale(mp.setdefault(keyfn(s), new_bucket()), s)
    return mp


def r(v, p=4):
    return None if v is None else round(v, p)


MONEY = ("gasto", "cpm", "cpc", "cpv", "cpic", "cac", "fat", "ticket", "roas")


def pack(d):
    return {k: r(d[k], 2 if k in MONEY else 4) for k in d}


def period_metrics(media, ga, sales, a, b, tax):
    tot = derive(totals(media, ga, sales, a, b, None, tax))
    paid = derive(totals(media, ga, sales, a, b, PAID, tax))
    canais = {ch: pack(derive(totals(media, ga, sales, a, b, (ch,), tax))) for ch in PAID + ("outros",)}
    camps = []
    for (ch, name), bk in sorted(by_key(media, sales, a, b, lambda x: (x["ch"], x["camp"]), tax).items(),
                                 key=lambda kv: -kv[1]["sp"]):
        camps.append({"canal": ch, "nome": name, **pack(derive(bk))})
    ads = []
    for (ch, camp, name), bk in by_key(media, sales, a, b, lambda x: (x["ch"], x["camp"], x["ad"]), tax).items():
        if bk["sp"] <= 0 or name == "(sem anúncio)":
            continue
        d = derive(bk)
        ads.append({"nome": name, "canal": ch, "campanha": camp, "gasto": r(d["gasto"], 2),
                    "vendas": d["vendas"], "cac": r(d["cac"], 2), "roas": r(d["roas"], 2)})
    ads.sort(key=lambda x: (-(x["roas"] if x["roas"] is not None else -1),
                            x["cac"] if x["cac"] is not None else 9e9))
    top = ads[:5]
    top_keys = {(x["nome"], x["canal"], x["campanha"]) for x in top}
    worst = [x for x in ads if (x["nome"], x["canal"], x["campanha"]) not in top_keys][-5:][::-1]
    return {"de": a, "ate": b, "total": pack(tot), "trafego_pago": pack(paid), "canais": canais,
            "campanhas": camps, "top_anuncios": top, "piores_anuncios": worst}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta-file")
    ap.add_argument("--google-file")
    ap.add_argument("--tiktok-file")
    ap.add_argument("--google-shop-file")
    ap.add_argument("--ga4-file")
    ap.add_argument("--sales-file")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "relatorios_metrics.json"))
    args = ap.parse_args()

    # Sem arquivos locais: busca ao vivo via CSV público do Google Sheets (mesmo caminho do
    # build.py) — usado pelo GitHub Actions, que alcança docs.google.com (o sandbox do agente não).
    media_rows = {}
    for ch, gid, local in (("meta", build.GID_META, args.meta_file), ("google", build.GID_GOOGLE, args.google_file),
                           ("tiktok", build.GID_TIKTOK, args.tiktok_file)):
        media_rows[ch] = build.load_rows(build.EXPORT_URL.format(sid=build.SPREADSHEET_ID, gid=gid), local) if (gid or local) else []
    if build.GID_GOOGLE_SHOP or args.google_shop_file:
        media_rows["google_shop"] = build.load_rows(build.EXPORT_URL.format(sid=build.SPREADSHEET_ID, gid=build.GID_GOOGLE_SHOP), args.google_shop_file)
    ga_rows = build.load_rows(build.EXPORT_URL.format(sid=build.SPREADSHEET_ID, gid=build.GID_GA4), args.ga4_file)
    sales_rows = build.load_rows(build.EXPORT_URL.format(sid=build.SPREADSHEET_ID, gid=build.GID_SALES), args.sales_file)
    data = build.process(media_rows, ga_rows, sales_rows)
    media, ga, sales, B = data["media"], data["ga"], data["sales"], data["build"]
    tax = B["tax_factor"]  # imposto Meta aplicado (mesmo default da UI: ON)

    ps = presets(B["today"], B["date_min"], B["date_max"])
    out = {
        "gerado_em": datetime.now(BRT).strftime("%d/%m/%Y %H:%M"),
        "hoje": B["today"], "periodo_dados": {"de": B["date_min"], "ate": B["date_max"]},
        "metas": {"cac": B.get("cac_target"), "roas": B.get("roas_target")},
        "canais_com_midia": B.get("channels_with_data"),
        "ticket_medio_geral": r(derive(totals(media, ga, sales, B["date_min"], B["date_max"], None, tax))["ticket"], 2),
        "periodos": {k: period_metrics(media, ga, sales, a, b, tax) for k, (a, b) in ps.items()},
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("== métricas geradas ==", file=sys.stderr)
    print(f"  hoje={out['hoje']} dados={B['date_min']}->{B['date_max']}", file=sys.stderr)
    print(f"  out={args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
