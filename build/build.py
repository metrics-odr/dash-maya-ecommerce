#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dashboard de Controle de Tráfego Pago — Funil ECOMMERCE (mídia paga × GA4 × Compras).
Os valores do cliente (planilha, abas, taxa, rótulos, metas, worker da IA)
ficam em `build/config.py` — veja `build/config.example.py` para o modelo e
comentários de cada campo. Este arquivo (build.py) é a ENGINE do template.

Lê abas de uma planilha Google (export CSV público) e emite os REGISTROS BRUTOS
(media[] / ga[] / sales[]) dentro do HTML. Todo o cálculo/filtro/gráfico roda no
navegador (ver build/template.html). Somente leitura; nunca escreve nas planilhas.

Fontes:
  • Meta Ads / Google Ads / TikTok Ads : gasto, impressões, cliques (por campanha/conjunto/anúncio)
  • GA4  : funil por SESSÕES (page_view → view_item → add_to_cart → begin_checkout), separado por
           canal pela coluna Session source / medium (Google Ads = google / cpc)
  • Compras : 1 linha por item; Compras = Order IDs distintos, Faturamento = soma do Preço

Funil: Gasto → Impressões → Cliques → Page Views → Product View → AddToCart → Checkouts → Compras → Faturamento

Teste local: python build/build.py --google-file g.csv --ga4-file ga.csv --sales-file s.csv --out dist/index.html
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone, timedelta

try:
    import config as cfg
except ImportError:
    sys.exit(
        "ERRO: build/config.py não encontrado.\n"
        "Copie o modelo e preencha os valores do cliente:\n"
        "    cp build/config.example.py build/config.py\n"
        "Veja os comentários em cada campo de build/config.example.py."
    )

_REQUIRED = ("SPREADSHEET_ID", "GID_SALES", "GID_GA4", "CLIENT_NAME")
_missing = [name for name in _REQUIRED if not getattr(cfg, name, "")]
if _missing:
    sys.exit(
        "ERRO: build/config.py está com campo(s) obrigatório(s) vazio(s): "
        + ", ".join(_missing) + ".\n"
        "Preencha build/config.py antes de rodar o build (ver build/config.example.py)."
    )

SPREADSHEET_ID = cfg.SPREADSHEET_ID
GID_SALES = cfg.GID_SALES
GID_GA4 = cfg.GID_GA4
# Abas de mídia paga: GID vazio = canal ainda sem planilha ("aguardando")
GID_META = getattr(cfg, "GID_META", "") or ""
GID_GOOGLE = getattr(cfg, "GID_GOOGLE", "") or ""
GID_TIKTOK = getattr(cfg, "GID_TIKTOK", "") or ""
# abas de gasto por estado (uma por canal; só entram no mapa da Visão Geral)
GEO_GIDS = {"meta": getattr(cfg, "GID_GEO_META", "") or "", "google": getattr(cfg, "GID_GEO_GOOGLE", "") or ""}
TAX_FACTOR = cfg.TAX_FACTOR
COUNT_ALL_AS_PAID = cfg.COUNT_ALL_AS_PAID
CLIENT_NAME = cfg.CLIENT_NAME
CLIENT_SUB = cfg.CLIENT_SUB
TAX_LABEL = cfg.TAX_LABEL
MAIN_PRODUCT = getattr(cfg, "MAIN_PRODUCT", "") or "Todos os produtos"
CAC_TARGET = cfg.CAC_TARGET
ROAS_TARGET = cfg.ROAS_TARGET
REPORT_BAND_LOW = cfg.REPORT_BAND_LOW
REPORT_BAND_HIGH = cfg.REPORT_BAND_HIGH
IA_WORKER_URL = cfg.IA_WORKER_URL
# Regras de classificação de canal (Session source / medium e utm_source / utm_medium)
META_SOURCES = tuple(getattr(cfg, "META_SOURCES", ("facebook", "fb", "instagram", "ig", "meta", "an")))
GOOGLE_SOURCES = tuple(getattr(cfg, "GOOGLE_SOURCES", ("google", "googleads", "google ads")))
GOOGLE_PAID_MEDIUMS = tuple(getattr(cfg, "GOOGLE_PAID_MEDIUMS", ("cpc", "ppc", "paid", "paidsearch", "paid search", "cpm", "display")))
TIKTOK_SOURCES = tuple(getattr(cfg, "TIKTOK_SOURCES", ("tiktok", "tik tok", "tt")))
ORGANIC_MEDIUMS = tuple(getattr(cfg, "ORGANIC_MEDIUMS", (
    "", "(none)", "(not set)", "none", "organic", "referral", "social", "bio", "link_in_bio",
    "story", "stories", "email", "direct", "sem utm")))

EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
BRT = timezone(timedelta(hours=-3))   # horário de Brasília (exibição)


# --------------------------------------------------------------------------- #
# Leitura (só leitura das planilhas)
# --------------------------------------------------------------------------- #
def fetch_csv(url: str) -> list[list[str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "dash-vsl-bot/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return list(csv.reader(io.StringIO(raw)))


def read_csv_file(path: str) -> list[list[str]]:
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        return list(csv.reader(f))


def load_rows(url: str, local: str | None) -> list[list[str]]:
    return read_csv_file(local) if local else fetch_csv(url)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str | None) -> str:
    return strip_accents((s or "").strip().lower())


def to_float(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v).strip())
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(v: str) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for fmt in ("%Y%m%d", "%d/%m/%Y", "%m/%d/%Y", "%d/%m/%y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def is_test_row(rowtext: str) -> bool:
    return "<test lead" in rowtext.lower()


def is_paid(status: str) -> bool:
    """Considera venda apenas status pago/aprovado. Sem coluna Status -> conta."""
    sn = norm(status)
    if not sn:
        return True
    return any(k in sn for k in ("pag", "aprov", "paid", "conclu", "complet", "ativ"))


def is_active_status(status: str) -> bool:
    return norm(status) in ("active", "ativo", "ativa")


# ----- Máscara de PII (a página publicada é pública) ----- #
def mask_email(e: str) -> str:
    e = (e or "").strip()
    if "@" not in e:
        return "—"
    user, dom = e.split("@", 1)
    keep = user[:2] if len(user) > 2 else user[:1]
    return f"{keep}****@{dom}"


def first_last_initial(name: str) -> str:
    parts = (name or "").strip().split()
    if not parts:
        return "—"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][:1]}."


# --------------------------------------------------------------------------- #
# Perfil dos compradores: gênero (por nome/e-mail) e UF
# --------------------------------------------------------------------------- #
_UFS = {"AC": "acre", "AL": "alagoas", "AP": "amapa", "AM": "amazonas", "BA": "bahia", "CE": "ceara",
        "DF": "distrito federal", "ES": "espirito santo", "GO": "goias", "MA": "maranhao", "MT": "mato grosso",
        "MS": "mato grosso do sul", "MG": "minas gerais", "PA": "para", "PB": "paraiba", "PR": "parana",
        "PE": "pernambuco", "PI": "piaui", "RJ": "rio de janeiro", "RN": "rio grande do norte",
        "RS": "rio grande do sul", "RO": "rondonia", "RR": "roraima", "SC": "santa catarina",
        "SP": "sao paulo", "SE": "sergipe", "TO": "tocantins"}
_UF_BY_NAME = {v: k for k, v in _UFS.items()}


def normalize_uf(v: str) -> str:
    """'SP', 'sp', 'São Paulo', 'Sao Paulo - SP' -> 'SP'; desconhecido -> ''."""
    v = norm(v or "")
    if not v:
        return ""
    if v.upper() in _UFS:
        return v.upper()
    if v in _UF_BY_NAME:
        return _UF_BY_NAME[v]
    m = re.search(r"\b([a-z]{2})$", v)
    if m and m.group(1).upper() in _UFS:
        return m.group(1).upper()
    return _UF_BY_NAME.get(re.sub(r"\s*[-/,(].*$", "", v).strip(), "")


_FEM = set("""maria ana julia juliana fernanda amanda patricia camila mariana beatriz luciana aline bruna carolina
daniela renata vanessa leticia larissa gabriela jessica natalia priscila tatiane tatiana thais thaisa isabela isabel
isabella isadora raquel rafaela rebeca sandra simone sonia sabrina silvia viviane vivian luana luiza luisa laura lais
livia lorena manuela marcela marina marta michele michelle monica nathalia paula paloma pamela paola rosa rose rosana
rosangela sara sarah talita tais yasmin yara andreia andrea adriana alessandra alice amelia angela angelica barbara
bianca bruna carla carmen cecilia claudia cristiane cristina debora denise diana eduarda elaine eliane elisa elizabeth
elisabete erica eva fabiana fabricia fatima flavia francisca gisele giovana giovanna helena heloisa ingrid irene
iris janaina jaqueline joana juliane kelly karina katia keila lara leila lidiane liliane lilian lucia lucimara luzia
magda mara margarida marilia marisa mayara melissa milena miriam monique nadia natasha nicole olivia patrícia pietra
poliana rafaela regina roberta rosemary samara selma sheila silmara stella stephanie suelen suzana tereza teresa
valeria vera veronica vitoria wanessa zilda ester esther emilia emily evelyn eloisa clara clarice dandara debora
gleice graziela gisela jade kamila kamilla laiza lavinia lilia luma maiara maisa maite manoela maria nayara nara
neusa nilza noemi odete paulina rita roseli rosimeire sueli suely tamires thamires thalita thayna thaina vitória
yohana ariane ariadne bia bruna cintia cinthia cleide dayane dayana edna eliana fabiola gabrielle jennifer joice
josiane kaila kauane kelen kethlen leidiane lenita lidia lourdes madalena marlene mirela nair noelia otavia pricila
priscilla rayane rosilene rute ruth sirlene solange sonia tamara tatiele telma thalia valentina vania vilma wendy""".split())
_MASC = set("""joao jose antonio francisco carlos paulo pedro lucas luiz luis marcos luciano gabriel rafael daniel marcelo
bruno eduardo felipe filipe rodrigo manoel manuel jorge fernando fabio leandro gustavo andre anderson ricardo
roberto sergio alexandre alex diego thiago tiago vinicius vitor victor guilherme henrique matheus mateus leonardo
renato rogerio claudio cesar augusto adriano alan alberto alisson amilton ariel arthur artur benedito caio carlo
celso cleber cristiano danilo davi david denis diogo douglas edson edgar edmilson elias emerson enzo erick erik
evandro fabricio flavio francisco geraldo german gilberto gilson heitor helio hugo igor isaac ivan jonas jonathan
junior kaio kleber leonel lourival marcio mario mauricio mauro miguel murilo nelson nicolas otavio patrick paulo
raul renan reinaldo robson rubens samuel saulo sebastiao silvio stefano tales tarcisio thales ulisses valter
vagner valdir wagner walter wellington wesley willian william wilson yuri zeca ronaldo rodolfo rubem sandro
jeferson jefferson joel jonatan josue juan juliano lauro lazaro lindomar luan lucio marlon moises natan nathan
neto noel osvaldo oswaldo pablo percival ramon raimundo reginaldo ruan rui tadeu tulio vando vicente washington
orlando olavo otto levi lorenzo bento benicio theo breno cauan cauã dante enrico heitor joaquim henry thomas""".split())
_NAME_STOP = {"sr", "sra", "dr", "dra", "srta", "prof", "de", "da", "do", "dos", "das"}


def _guess_first(token: str) -> str:
    """'F'/'M'/'' para um primeiro nome (dicionário + terminações do português)."""
    t = norm(token)
    t = re.sub(r"[^a-z]", "", t)
    if len(t) < 2:
        return ""
    if t in _FEM:
        return "F"
    if t in _MASC:
        return "M"
    if t.endswith(("ssa", "ele", "ine", "ane", "ana", "ene", "ice", "ila", "ola", "ula", "ela", "ura", "iza",
                   "eia", "ria", "lia", "nia", "cia", "dia", "tia", "via", "sia", "gia", "bia", "mia")):
        return "F"
    if t.endswith("a") and t not in ("luca", "joshua", "garcia", "costa"):
        return "F"
    if t.endswith(("o", "os", "son", "ton", "ldo", "rto", "lio", "rio", "ano", "avo", "ilo", "elo", "eu", "ur", "ir", "or", "el", "im", "an")):
        return "M"
    return ""


def guess_gender(name: str, email: str = "") -> str:
    """'f' | 'm' | 'nd'. Usa o 1º nome; se não decidir, tenta o início do e-mail. Nunca sai do navegador
    nem do JSON como dado pessoal — só a letra final é exportada."""
    toks = [t for t in re.split(r"[\s._-]+", norm(name or "")) if t and t not in _NAME_STOP]
    for t in toks[:1]:
        g = _guess_first(t)
        if g:
            return g.lower()
    local = norm((email or "").split("@")[0])
    for t in re.split(r"[._\-\d]+", local)[:2]:
        if len(t) >= 3:
            g = _guess_first(t)
            if g and (t in _FEM or t in _MASC):
                return g.lower()
    return "nd"



# --------------------------------------------------------------------------- #
# Indexação de colunas (por nome, com fallback posicional)
# --------------------------------------------------------------------------- #
def header_index(header, wanted, fallback):
    idx = {}
    hn = [norm(h) for h in header]
    for key, aliases in wanted.items():
        found = None
        for a in aliases:
            a = norm(a)
            for i, h in enumerate(hn):
                if h == a or (a and a in h):
                    found = i
                    break
            if found is not None:
                break
        idx[key] = found if found is not None else fallback.get(key)
    return idx


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


CHANNELS = ("meta", "google", "tiktok")      # canais de mídia paga; "outros" = orgânico/direto/etc.


def _src_token(s: str) -> str:
    """'l.instagram.com' / 'm.facebook.com' -> 'instagram' / 'facebook'."""
    s = norm(s)
    s = re.sub(r"^(l|m|lm|web|business)\.", "", s)
    return re.sub(r"\.(com|com\.br)$", "", s)


def classify_channel(source: str, medium: str) -> str:
    """Separa Meta Ads / Google Ads / TikTok Ads do resto pelo par source/medium.
    Google Ads = google / cpc. Meta/TikTok = source da plataforma com medium que
    NÃO seja orgânico (referral/social/bio/...). Qualquer outro caso = 'outros'."""
    s, m = _src_token(source), norm(medium)
    if s in GOOGLE_SOURCES:
        return "google" if m in GOOGLE_PAID_MEDIUMS else "outros"
    if s in TIKTOK_SOURCES or "tiktok" in s:
        return "outros" if m in ORGANIC_MEDIUMS else "tiktok"
    # Meta: source exato ("fb", "ig", "facebook"...) ou variações de posicionamento/macro do
    # Meta ("Instagram_Reels", "facebook_mobile_feed", "fb_ads", "ig-stories"...)
    if s in META_SOURCES or re.search(r"facebook|instagram|meta\b", s) or re.match(r"^(fb|ig)[\s_\-]", s):
        return "outros" if m in ORGANIC_MEDIUMS else "meta"
    return "outros"


def classify_source(source: str, medium: str, ch: str) -> str:
    """Grupo de origem p/ o filtro "Canal" da Visão Geral (utm_source):
    meta | google (Ads) | tiktok | instagram_org | gpt | google_org | direto | outros."""
    if ch != "outros":
        return ch
    s, m = _src_token(source), norm(medium)
    if re.search(r"chatgpt|openai|gpt", s):
        return "gpt"
    if re.search(r"instagram", s) or s == "ig":
        return "instagram_org"
    if s in GOOGLE_SOURCES:
        return "google_org"
    if s in ("", "(direct)", "direct", "(none)", "(not set)", "sem utm", "null", "undefined"):
        return "direto"
    return "outros"


def split_source_medium(v: str) -> tuple[str, str]:
    parts = [p.strip() for p in (v or "").split("/", 1)]
    return parts[0], (parts[1] if len(parts) > 1 else "")


def _clean_utm(v: str) -> str:
    v = (v or "").strip()
    return "" if norm(v) in ("sem utm", "(not set)", "(none)", "null", "undefined") else v


def _clean_kw(v: str) -> str:
    """Palavra-chave normalizada p/ cruzar mídia (aba Google Ads) x compras (utm_term):
    minúscula, sem colchetes/aspas/+ (símbolos de tipo de correspondência) e espaços colapsados."""
    v = _clean_utm(v)
    v = re.sub(r'[\[\]"+]', " ", v.lower())
    return " ".join(v.split())


GA_EVENTS = {"page_view": "pv", "view_item": "vi", "item_view": "vi",
             "add_to_cart": "atc", "begin_checkout": "ck"}


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos
# --------------------------------------------------------------------------- #
def load_media(rows, ch):
    """Aba de mídia paga (Meta/Google/TikTok) -> linhas brutas {d,ch,camp,adset,ad,sp,im,cl,...}.
    Funil (pageviews/product view/addtocart/checkout) NÃO vem daqui: vem do GA4."""
    if not rows:
        return [], {}
    midx = header_index(
        rows[0],
        {"day": ["day", "data", "date"], "campaign": ["campaign name", "campaign", "campanha"],
         "adset": ["ad set name", "adset", "ad set", "ad group name", "ad group", "grupo de anuncios"],
         "ad": ["ad name", "anuncio"],
         "kw": ["keyword", "search keyword", "keyword text", "palavra-chave", "palavra chave", "palavras-chave", "palavras chave"],
         "spent": ["amount spent", "cost (spend)", "cost", "spend", "valor gasto", "gasto"],
         "impr": ["impressions", "impress"],
         "clicks": ["link clicks", "clicks", "cliques"],
         "vv3": ["3-second video views", "3 second video views"],
         "vv50": ["video watches at 50%", "video watches 50%"],
         "vv95": ["video watches at 95%", "video watches 95%"],
         "link": ["creative instagram permalink", "instagram permalink", "permalink",
                  "creative link", "link do anuncio", "link do criativo"],
         "campaign_status": ["campaign status", "status da campanha"],
         "adset_status": ["ad set status", "adset status", "status do conjunto"],
         "ad_status": ["ad status", "status do anuncio"]},
        {"day": 0, "campaign": 1, "adset": 2, "ad": 3, "spent": 4})
    out, ad_links = [], {}
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        if is_test_row(" ".join(str(c) for c in row)):
            continue
        day = parse_date(cell(row, midx["day"]))
        if not day:
            continue
        camp = cell(row, midx["campaign"]) or "(sem campanha)"
        adset = cell(row, midx["adset"]) or "(sem conjunto)"
        ad = cell(row, midx["ad"]) or "(sem anúncio)"
        link = cell(row, midx["link"])
        if link and ad not in ad_links:
            ad_links[ad] = link
        rec = {"d": day, "ch": ch, "camp": camp, "adset": adset, "ad": ad,
               "sp": round(to_float(cell(row, midx["spent"])), 4),
               "im": to_float(cell(row, midx["impr"])),
               "cl": to_float(cell(row, midx["clicks"]))}
        if ch == "google":
            rec["kw"] = _clean_kw(cell(row, midx["kw"])) or "(sem palavra-chave)"
        for k in ("vv3", "vv50", "vv95"):
            v = to_float(cell(row, midx[k]))
            if v:
                rec[k] = v
        for k, f in (("cs", "campaign_status"), ("as", "adset_status"), ("ds", "ad_status")):
            st = cell(row, midx[f])
            rec[k] = is_active_status(st) if st else None
        out.append(rec)
    return out, ad_links


def load_ga4(rows):
    """GA4 (Date · Event name · Session source/medium · Event count · Sessions · Total users)
    -> [{d,ch,pv,vi,atc,ck}] somando as SESSIONS de cada evento do funil por dia e canal."""
    if not rows:
        return []
    gidx = header_index(
        rows[0],
        {"date": ["date", "data", "day"], "event": ["event name", "evento"],
         "sm": ["session source / medium", "session source/medium", "session manual source / medium",
                "session source", "source / medium"],
         "medium": ["session medium", "session manual medium"],
         "sessions": ["sessions", "sessoes"]},
        {"date": 0, "event": 1, "sm": 2, "sessions": 4})
    if gidx["sm"] is None or gidx["sessions"] is None:
        sys.exit("ERRO: GA4 sem coluna de Session source/medium ou Sessions. Cabeçalho: " + repr(rows[0]))
    acc = {}
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        ev = GA_EVENTS.get(norm(cell(row, gidx["event"])))
        d = parse_date(cell(row, gidx["date"]))
        if not ev or not d:
            continue
        src, med = split_source_medium(cell(row, gidx["sm"]))
        if gidx["medium"] is not None:
            med = cell(row, gidx["medium"]) or med
        ch = classify_channel(src, med)
        sg = classify_source(src, med, ch)
        a = acc.setdefault((d, ch, sg), {"d": d, "ch": ch, "src": sg, "pv": 0.0, "vi": 0.0, "atc": 0.0, "ck": 0.0})
        a[ev] += to_float(cell(row, gidx["sessions"]))
    return sorted(acc.values(), key=lambda r: (r["d"], r["ch"], r["src"]))


def load_sales(rows, media):
    """Compras (1 linha por ITEM do pedido) -> linhas agregadas por (dia, canal, campanha,
    conjunto, anúncio, produto) com `main` = nº de PEDIDOS (Order ID distintos), `val` =
    faturamento (soma dos itens) e `n` = itens. Mais `buyers` (últimos pedidos, PII mascarada)."""
    if not rows:
        return [], [], []
    sidx = header_index(
        rows[0],
        {"created": ["data de criacao", "data", "created", "created_time"],
         "name": ["cliente / nome", "comprador(a)", "comprador", "nome", "full_name"],
         "email": ["cliente / e-mail", "e-mail", "email"],
         "prod": ["produto", "product"],
         "val": ["preco", "faturamento", "valor da venda", "valor", "value", "amount"],
         "order": ["order id", "id do pedido", "pedido", "order"],
         "utm_source": ["utm source", "utm_source"],
         "utm_medium": ["utm medium", "utm_medium"],
         "utm_campaign": ["utm campaign", "utm_campaign"],
         "utm_content": ["utm content", "utm_content"],
         "utm_term": ["utm term", "utm_term"],
         "status": ["status"],
         "uf": ["cliente / estado", "estado", "state", "provincia", "province"]},
        {"created": 0, "name": 1, "email": 2, "prod": 4, "val": 5, "order": 11})
    # campanha (normalizada) -> (canal, nome real) vindo das abas de mídia; ambígua entre canais = ignora
    if sidx.get("uf") is None:           # coluna "UF" exata (substring "uf" seria arriscado)
        for i, h in enumerate(rows[0]):
            if norm(h) in ("uf", "cliente / uf", "estado (uf)"):
                sidx["uf"] = i
                break
    camp_map, ad_map, adname_map = {}, {}, {}
    for m in media:
        if m["ch"] == "meta" and m["ad"] != "(sem anúncio)":
            adname_map.setdefault(norm(m["ad"]), set()).add((m["camp"], m["adset"]))
        k = norm(m["camp"])
        if k in camp_map and camp_map[k][0] != m["ch"]:
            camp_map[k] = (None, m["camp"])
        else:
            camp_map.setdefault(k, (m["ch"], m["camp"]))
        ad_map.setdefault((norm(m["camp"]), norm(m["ad"])), m["adset"])

    perfil = {}                    # order_id -> {d,ch,src,g,uf,val} (sem PII: só gênero e UF)
    order_attr = {}                # order_id -> atributos do 1º item (data/canal/campanha)
    groups = {}                    # chave de agregação -> registro
    buyers = []
    for i, row in enumerate(rows[1:]):
        if not any((c or "").strip() for c in row):
            continue
        if is_test_row(" ".join(str(c) for c in row)):
            continue
        if not COUNT_ALL_AS_PAID and not is_paid(cell(row, sidx["status"])):
            continue
        oid = cell(row, sidx["order"]) or f"__row{i}"
        first = oid not in order_attr
        if first:
            src, med = cell(row, sidx["utm_source"]), cell(row, sidx["utm_medium"])
            ch = classify_channel(src, med)
            sg = classify_source(src, med, ch)
            utm_camp, utm_ad = _clean_utm(cell(row, sidx["utm_campaign"])), _clean_utm(cell(row, sidx["utm_content"]))
            camp = utm_camp or "(sem campanha)"
            hit = camp_map.get(norm(utm_camp)) if utm_camp else None
            if hit and hit[0]:
                ch, camp = hit[0], hit[1]          # campanha real da plataforma manda no canal
                sg = ch
            elif utm_ad and len(adname_map.get(norm(utm_ad), ())) == 1:
                # sem campanha reconhecível, mas utm_content = Ad Name único do Meta: herda campanha/conjunto
                ch = sg = "meta"
                camp, adset_hit = next(iter(adname_map[norm(utm_ad)]))
            adset = adset_hit if (ch == "meta" and not hit and utm_ad and len(adname_map.get(norm(utm_ad), ())) == 1) else ""
            if ch == "meta" and not adset:
                adset = ad_map.get((norm(camp), norm(utm_ad))) or _clean_utm(cell(row, sidx["utm_medium"]))
            order_attr[oid] = {"d": parse_date(cell(row, sidx["created"])), "ch": ch, "src": sg, "camp": camp,
                               "adset": adset or "(sem conjunto)",
                               # utm_content só identifica anúncio no Meta (no Google costuma ser posicionamento/link)
                               "ad": (utm_ad if ch == "meta" else "") or "(sem anúncio)",
                               # utm_term = palavra-chave ({keyword}) só nas compras do Google Ads
                               "kw": (_clean_kw(cell(row, sidx["utm_term"])) or "(sem palavra-chave)") if ch == "google" else ""}
        at = order_attr[oid]
        prod = cell(row, sidx["prod"]) or "—"
        val = to_float(cell(row, sidx["val"]))
        key = (at["d"], at["ch"], at["src"], at["camp"], at["adset"], at["ad"], at["kw"], prod)
        g = groups.get(key)
        if g is None:
            g = groups[key] = {"d": at["d"], "ch": at["ch"], "src": at["src"], "camp": at["camp"], "adset": at["adset"],
                               "ad": at["ad"], "prod": prod, "main": 0, "val": 0.0, "n": 0}
            if at["kw"]:
                g["kw"] = at["kw"]
        g["val"] += val
        g["n"] += 1
        if first:
            perfil[oid] = {"d": at["d"], "ch": at["ch"], "src": at["src"],
                           "g": guess_gender(cell(row, sidx["name"]), cell(row, sidx["email"])),
                           "uf": normalize_uf(cell(row, sidx["uf"])), "val": 0.0}
        perfil[oid]["val"] += val
        if first:
            g["main"] += 1
            buyers.append({"d": at["d"], "ch": at["ch"], "camp": at["camp"], "ad": at["ad"], "prod": prod,
                           "oid": oid, "val": val,
                           "nm": first_last_initial(cell(row, sidx["name"])),
                           "em": mask_email(cell(row, sidx["email"]))})
        else:
            for b in reversed(buyers):             # soma o item extra no valor do pedido
                if b["oid"] == oid:
                    b["val"] += val
                    break
    sales = []
    for g in groups.values():
        g["val"] = round(g["val"], 2)
        sales.append(g)
    sales.sort(key=lambda r: (r["d"] or "", r["ch"]))
    buyers.sort(key=lambda b: b["d"] or "", reverse=True)
    buyers = buyers[:400]
    for b in buyers:
        b["val"] = round(b["val"], 2)
        del b["oid"]
    perfil_l = list(perfil.values())
    for p in perfil_l:
        p["val"] = round(p["val"], 2)
    return sales, buyers, perfil_l


def load_geo(rows, ch):
    """Aba de gasto por estado de um canal -> [{d,ch,uf,sp}]. Tolerante: acha a linha de cabeçalho nas
    primeiras 10 linhas e aceita nome do estado ou UF; linhas sem estado reconhecido são ignoradas."""
    wanted = {"day": ["day", "data", "date", "dia"],
              "uf": ["region", "regiao", "estado", "state", "uf", "province", "user location", "location", "localizacao"],
              "spent": ["amount spent", "cost (spend)", "cost", "spend", "valor gasto", "gasto", "custo"]}
    hdr, gidx = None, None
    for i, row in enumerate(rows[:10]):
        idx = header_index(row, wanted, {})
        if idx["uf"] is not None and idx["spent"] is not None:
            hdr, gidx = i, idx
            break
    if hdr is None:
        return []
    out = []
    for row in rows[hdr + 1:]:
        uf = normalize_uf(re.sub(r"^(state of|estado de|estado do|estado da)\s+", "", norm(cell(row, gidx["uf"]))))
        if not uf or is_test_row(" ".join(str(c) for c in row)):
            continue
        sp = to_float(cell(row, gidx["spent"]))
        if sp:
            out.append({"d": (parse_date(cell(row, gidx["day"])) if gidx["day"] is not None else None) or "",
                        "ch": ch, "uf": uf, "sp": round(sp, 4)})
    return out


def process(media_rows, ga_rows, sales_rows, geo_rows=None):
    """media_rows = {"meta": rows|None, "google": rows|None, "tiktok": rows|None}"""
    media, ad_links = [], {}
    for ch in CHANNELS:
        recs, links = load_media(media_rows.get(ch) or [], ch)
        media += recs
        ad_links.update(links)
    ga = load_ga4(ga_rows)
    sales, buyers, perfil = load_sales(sales_rows, media)

    geo = []
    for ch, rows in (geo_rows or {}).items():
        geo += load_geo(rows or [], ch)
    dates = sorted({r["d"] for r in media + ga + sales if r["d"]})
    now_brt = datetime.now(BRT)
    return {
        "build": {
            "generated_at_brt": now_brt.strftime("%d/%m/%Y %H:%M"),
            "build_id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "today": now_brt.strftime("%Y-%m-%d"),
            "date_min": dates[0] if dates else None,
            "date_max": dates[-1] if dates else None,
            "tax_factor": TAX_FACTOR,
            "client_name": CLIENT_NAME,
            "client_sub": CLIENT_SUB,
            "tax_label": TAX_LABEL,
            "main_product": MAIN_PRODUCT,
            "ia_worker_url": IA_WORKER_URL,
            "channels_with_data": {ch: any(r["ch"] == ch for r in media) for ch in CHANNELS},
            "cac_target": CAC_TARGET,
            "roas_target": ROAS_TARGET,
            "report_band_low": REPORT_BAND_LOW,
            "report_band_high": REPORT_BAND_HIGH,
        },
        "media": media,
        "ga": ga,
        "sales": sales,
        "buyers": buyers,
        "perfil": perfil,
        "geo": geo,
        "ad_links": ad_links,
        # Briefings do Gestor por período (build/relatorios.json); {} se não existir.
        "briefings": {},
    }


# --------------------------------------------------------------------------- #
# Briefings do Gestor (aba Relatórios) — texto gerado por IA 1x/dia
# --------------------------------------------------------------------------- #
def load_briefings(path: str) -> dict:
    """Lê build/relatorios.json (gerado pela Routine diária). Estrutura:
        {"generated_at": "...", "periodos": {"<preset>": {...}, ...}}
    Retorna o dict de períodos (ou {} se o arquivo não existir/for inválido).
    A geração NÃO acontece aqui — este build só lê o texto já pronto, sem
    chamar nenhuma API (custo zero no build/no navegador)."""
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else {}
    except (ValueError, OSError):
        return {}


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #
def render(data, template_path):
    # A dashboard é montada a partir de arquivos separados (visual x lógica):
    #   template.html          -> esqueleto HTML (com placeholders __STYLES__/__APP_JS__)
    #   identidade-visual.css  -> TODAS as cores (edite aqui p/ mexer só em cor)
    #   estilos.css            -> layout/componentes
    #   app.js                 -> lógica + renderização
    # Esta função só COSTURA os arquivos e injeta os dados; não altera nada deles.
    base = os.path.dirname(os.path.abspath(template_path))
    def readf(name):
        with open(os.path.join(base, name), "r", encoding="utf-8") as f:
            return f.read()
    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    styles = readf("identidade-visual.css") + "\n" + readf("estilos.css")
    tpl = tpl.replace("__STYLES__", styles)
    # mapa-brasil.js entra logo após o "use strict" de app.js (BR_MAP usado pela seção Perfil dos compradores)
    tpl = tpl.replace("__APP_JS__", readf("app.js").replace('"use strict";', '"use strict";\n' + readf("mapa-brasil.js"), 1))
    tpl = tpl.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta-file")
    ap.add_argument("--google-file")
    ap.add_argument("--tiktok-file")
    ap.add_argument("--geo-meta-file")
    ap.add_argument("--geo-google-file")
    ap.add_argument("--ga4-file")
    ap.add_argument("--sales-file")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    media_rows = {}
    for ch, gid, local in (("meta", GID_META, args.meta_file), ("google", GID_GOOGLE, args.google_file),
                           ("tiktok", GID_TIKTOK, args.tiktok_file)):
        # canal sem planilha ainda (GID vazio e sem arquivo local) = "aguardando"
        media_rows[ch] = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=gid), local) if (gid or local) else []
    ga_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_GA4), args.ga4_file)
    sales_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_SALES), args.sales_file)
    geo_rows = {}
    for ch, local in (("meta", args.geo_meta_file), ("google", args.geo_google_file)):
        gid = GEO_GIDS[ch]
        geo_rows[ch] = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=gid), local) if (gid or local) else []
    data = process(media_rows, ga_rows, sales_rows, geo_rows)

    # Briefings do Gestor (texto por IA, gerado 1x/dia pela Routine) — lidos do
    # arquivo versionado ao lado do template. Sem chamada de API no build.
    briefings_path = os.path.join(os.path.dirname(os.path.abspath(args.template)), "relatorios.json")
    data["briefings"] = load_briefings(briefings_path)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(data, args.template))

    b = data["build"]
    compras = sum(s["main"] for s in data["sales"])
    fat = sum(s["val"] for s in data["sales"])
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo : {b['date_min']} -> {b['date_max']}", file=sys.stderr)
    for ch in CHANNELS:
        n = sum(1 for m in data["media"] if m["ch"] == ch)
        print(f"  {ch:7s} : {n} linhas de mídia" + ("" if n else " (aguardando planilha)"), file=sys.stderr)
    print(f"  ga4     : {len(data['ga'])} linhas (dia x canal)", file=sys.stderr)
    print(f"  sales   : {len(data['sales'])} grupos · Compras: {compras} · Fat: R$ {fat:,.2f}", file=sys.stderr)
    print(f"  out     : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
