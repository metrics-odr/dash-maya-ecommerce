# -*- coding: utf-8 -*-
"""
Configuração do cliente — TEMPLATE (funil ECOMMERCE: mídia paga × GA4 × Compras).

Copie este arquivo para `build/config.py` (mesmo diretório) e preencha os
valores abaixo. `build/config.py` é o único arquivo que você precisa editar
para colocar um cliente novo no ar.

    cp build/config.example.py build/config.py

Depois de editar, teste localmente:
    python build/build.py --google-file g.csv --ga4-file ga.csv --sales-file s.csv --out dist/index.html

Mantenha este arquivo (`config.example.py`) intacto — ele serve de referência
e para restaurar `config.py` caso precise começar do zero de novo.
"""
from __future__ import annotations

# ==========================================================================
# 1) PLANILHA DO CLIENTE (Google Sheets)
# ==========================================================================
# Todas as abas ficam na MESMA planilha (mudam só os gids).
# SPREADSHEET_ID: o trecho entre /d/ e /edit na URL da planilha
# GID_*: o número depois de "gid=" na URL de cada aba.
# A planilha precisa estar com o link público em modo "Qualquer pessoa com
# o link pode visualizar" (o build lê via export CSV, somente leitura).
SPREADSHEET_ID = ""   # ex.: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg"
GID_GA4 = ""          # OBRIGATÓRIO · aba GA4 (Date · Event name · Session source/medium · Event count · Sessions · Total users)
GID_SALES = ""        # OBRIGATÓRIO · aba Compras (1 linha por item: Data · Produto · Preço · Order ID · utm_*)
# Mídia paga: deixe "" no canal que ainda não tem planilha — a página do canal
# mostra "Aguardando dados" e o build segue normalmente.
GID_META = ""         # aba Meta Ads  (Day · Campaign Name · Ad Set Name · Ad Name · Amount Spent · Impressions · Link Clicks · ...)
GID_GOOGLE = ""       # aba Google Ads (Day · Campaign · Ad Group · Ad Name · Cost · Impressions · Clicks)
GID_TIKTOK = ""       # aba TikTok Ads (mesmo formato do Meta/Google)
# Gasto por estado (alimenta o mapa da Visão Geral): uma aba por canal, com Estado/Região + Gasto (+ Data, se houver).
GID_GEO_META = ""    # aba "Local do Meta"
GID_GEO_GOOGLE = ""  # aba "Local no Google"

# ==========================================================================
# 2) REGRAS DE NEGÓCIO
# ==========================================================================
# Fator de imposto aplicado sobre o gasto do Meta Ads quando o toggle
# "Imposto Meta" estiver ligado. Use 1.0 se o cliente não tiver imposto
# (com 1.0 o toggle some da interface).
TAX_FACTOR = 1.0
TAX_LABEL = "Imposto Meta"

# A aba Compras é uma lista de pedidos concretizados (sem coluna de status
# utilizável)? True = toda linha é compra paga. False = filtra por is_paid()
# usando a coluna "Status".
COUNT_ALL_AS_PAID = True

# Canais (opcional — os padrões abaixo já cobrem o comum). Aplicados ao
# "Session source / medium" do GA4 e a utm_source / utm_medium das compras.
#   Google Ads = source google + medium cpc/ppc/paid...
#   Meta/TikTok = source da plataforma + medium que NÃO seja orgânico.
#   Tudo que não cair em nenhum canal pago vira "Outros" (só entra na Visão Geral).
# META_SOURCES = ("facebook", "fb", "instagram", "ig", "meta", "an")
# GOOGLE_SOURCES = ("google", "googleads", "google ads")
# GOOGLE_PAID_MEDIUMS = ("cpc", "ppc", "paid", "paidsearch", "paid search", "cpm", "display")
# TIKTOK_SOURCES = ("tiktok", "tik tok", "tt")
# ORGANIC_MEDIUMS = ("", "(none)", "(not set)", "none", "organic", "referral", "social", "bio",
#                    "link_in_bio", "story", "stories", "email", "direct", "sem utm")

# ==========================================================================
# 3) RÓTULOS EXIBIDOS NA INTERFACE
# ==========================================================================
CLIENT_NAME = ""    # ex.: "Nome do Cliente" — aparece no topo do menu lateral
CLIENT_SUB = ""     # ex.: "Ecommerce · Linha de produtos" — subtítulo abaixo do nome
MAIN_PRODUCT = "Todos os produtos"   # rótulo exibido nas notas (em ecommerce todas as compras contam)

# ==========================================================================
# 4) METAS (aba Insights) — código de cor de CAC/ROAS
# ==========================================================================
#   • ROAS: quanto MAIOR, melhor  -> desempenho = roas / ROAS_TARGET
#   • CAC : quanto MENOR, melhor  -> desempenho = CAC_TARGET / cac
# 0.0 = sem meta (a Saúde do funil usa o histórico da conta como referência).
CAC_TARGET = 0.0
ROAS_TARGET = 0.0
REPORT_BAND_LOW = 0.70
REPORT_BAND_HIGH = 1.30

# ==========================================================================
# 5) IA INSIGHTS (Cloudflare Worker) — legado/opcional, ver SETUP-IA.md
# ==========================================================================
IA_WORKER_URL = ""   # ex.: "https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev"
