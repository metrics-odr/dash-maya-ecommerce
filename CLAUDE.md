# CLAUDE.md — Dashboard de Controle de Tráfego Pago (TEMPLATE)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o repositório.
> Este é o repositório **TEMPLATE**, genérico — ainda não configurado para
> nenhum cliente. A engine (`build/template.html`, `build/build.py`,
> `ia-worker/worker.js`) é genérica e não deve ser editada por cliente; os
> valores do cliente ficam em **`build/config.py`** (config do funil) e
> **`config.js`** (metadados de publicação no GitHub). Veja também `README.md`
> para a visão geral e o passo a passo completo de publicação.

---

## ✅ CHECKLIST DE NOVO CLIENTE

Ordem para colocar um cliente novo no ar. Cada item aponta o arquivo e o marcador.

1. [ ] **Config do cliente** — copie `build/config.example.py` para
   `build/config.py` e preencha (comentado campo a campo no próprio arquivo):
   - `SPREADSHEET_ID`, `GID_META`, `GID_SALES` (planilha do cliente)
   - `TAX_FACTOR`, `MAIN_PRODUCT_PREFIX`, `COUNT_ALL_AS_PAID` (regras de negócio)
   - `UPSELL_PRODUCT_PREFIX`/`UPSELL_SPLIT_VALUE`/`UPSELL_USL_LABEL`/`UPSELL_DSL_LABEL`
     (OPCIONAL — só se o funil tiver upsell/downsell pós-compra do mesmo produto)
   - `CLIENT_NAME`, `CLIENT_SUB`, `TAX_LABEL`, `MAIN_PRODUCT` (rótulos exibidos)
   - `CAC_TARGET`, `ROAS_TARGET`, `REPORT_BAND_LOW`, `REPORT_BAND_HIGH` (metas da aba Relatórios)
2. [ ] **Este arquivo (`CLAUDE.md`)** — preencher a seção "Fontes de dados" abaixo
   com a planilha real do cliente (abas/colunas) e ajustar a regra de
   atribuição/produto principal se for diferente do padrão do template.
3. [ ] **`README.md`** — preencher: título, nome do produto principal (o resto
   já lê de `config.js`/`build/config.py`).
4. [ ] **`config.js`** (raiz do repo) — copie `config.example.js` para
   `config.js` e preencha `GITHUB_USERNAME`, `GITHUB_REPOSITORY`,
   `PROJECT_NAME`. Depois substitua manualmente os placeholders
   `<GITHUB_USERNAME>`/`<GITHUB_REPOSITORY>` que aparecem em `SETUP-CRON.md` e
   `README.md` pelos mesmos valores (são docs Markdown estáticos, a
   substituição não é automática).
5. [ ] **`SETUP-CRON.md`** — depois do passo acima, gere um **token
   fine-grained novo** (GitHub → Settings → Developer settings → Fine-grained
   tokens) escopado só para esse repositório, permissão Actions: Read and
   write; cadastre no cron-job.org (nunca commitar o token).
6. [ ] **GitHub Pages** — confirmar que o workflow `.github/workflows/deploy.yml`
   está na branch `main` e que o Pages foi habilitado (ele se autoconfigura na
   1ª execução via `actions/configure-pages`).
7. [ ] **Routine do Briefing do Gestor** — configure uma Routine do Claude Code (ou
   equivalente) que rode **23:59 BRT**, leia `build/relatorios_metrics.json` e
   escreva `build/relatorios.json` seguindo `build/GUIA-RELATORIOS.md` (ver "Aba
   Relatórios" abaixo). É o que preenche o Briefing do Gestor; o resto da aba
   (cards, Saúde do funil, Top/Piores anúncios) roda 100% no navegador, sem essa
   Routine.
8. [ ] *(OPCIONAL/legado — não é preciso para o cliente ir ao ar)* **Worker da IA
   Insights** — o dashboard não tem mais uma aba de geração de insights ao vivo
   (foi substituída pela Routine acima + o card "Saúde do funil", que não usa IA);
   `ia-worker/` fica no repo só como infraestrutura reaproveitável, caso um cliente
   específico volte a precisar de geração ao vivo. Se for usar: criar um Worker na
   Cloudflare, ajustar `ia-worker/wrangler.toml` (`name = "..."`, troque o
   placeholder `nomecliente-ia-insights`), cadastrar os secrets
   `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/`ANTHROPIC_API_KEY`/
   `INSIGHTS_PASSWORD` e preencher `IA_WORKER_URL` em `build/config.py`. Passo a
   passo completo em `SETUP-IA.md`.

---

## O que é

Dashboard de **Controle de Tráfego Pago** do cliente **Maya Massafera** (Ecommerce ·
BodySplash & Eau de Parfum) — app de BI estático (HTML/CSS/JS + Chart.js via CDN) publicado
no **GitHub Pages**, que cruza **Meta Ads / Google Ads / TikTok Ads** com o **GA4** e a lista
de **Compras**, e se atualiza a cada ~30 min (build na nuvem via GitHub Actions, disparado
pelo cron-job.org). **Somente leitura** das planilhas.

- **URL pública:** `https://metrics-odr.github.io/dash-maya-ecommerce/`
- **Cliente/projeto:** `build/config.py` (`CLIENT_NAME`/`CLIENT_SUB`)
- **Tipo de funil:** Ecommerce —
  `Gasto → Impressões → Cliques → Page Views → Product View → AddToCart → Checkouts → Compras → Faturamento`

## Fontes de dados (Google Sheets)

Planilha "Maya | Planilha Central de Ecommerce" (`SPREADSHEET_ID` em `build/config.py`),
leitura via export CSV (link público).

| Aba | gid (config) | Colunas usadas |
|-----|-----|----------------|
| **Google Ads📥** | `GID_GOOGLE` = 888044421 | Day · Campaign · Ad Group · Ad Name · Cost (Spend) · Impressions · Clicks |
| **GA4 📥** | `GID_GA4` = 1669456740 | Date · Event name · Session source/medium · Event count · **Sessions** · Total users |
| **Compras 🛒** | `GID_SALES` = 1836439885 | Data · Nome · Email · Produto · **Preço** · **Order ID** · utm_source/campaign/medium/term/content |
| **Meta Ads📥** | `GID_META` = 1195145852 | Day · Campaign Name · Ad Set Name · Ad Name · Amount Spent · Impressions · Link Clicks · vídeo · status · permalink |
| TikTok Ads | `GID_TIKTOK` = *vazio — aguardando* | (mesmo formato do Meta/Google) |

Canal sem GID = página do canal mostra "Aguardando dados" (o build segue normalmente). Para
ligar: preencher o GID em `build/config.py`.

### Regras do funil (`build.py` + `app.js`)
- **Funil de conversão vem do GA4**: soma de **Sessions** dos eventos `page_view` (Page Views),
  `view_item`/`item_view` (Product View), `add_to_cart` (AddToCart) e `begin_checkout` (Checkouts),
  por dia e canal. O GA4 **não tem campanha/anúncio**: tabelas Campanha/Conjunto/Anúncio mostram só
  mídia + compras (sem etapas do GA4); com filtro de campanha ativo, Page Views→Checkouts ficam ocultos.
- **Canal** (`classify_channel` em `build/build.py`, aplicado ao Session source/medium do GA4 e a
  utm_source/utm_medium das compras): **Google Ads = `google / cpc`**; Meta = facebook/fb/instagram/ig/meta
  com medium NÃO orgânico (referral/social/bio… = Outros); TikTok idem; o resto = **Outros**
  (só entra na Visão Geral). Listas ajustáveis (opcional) em `build/config.py`.
- **Compras** = nº de **Order IDs distintos** (a aba tem 1 linha por item); **Faturamento** = soma do
  **Preço** de todos os itens. Todas as compras contam (não há "produto principal"). Atribuição: canal
  pelo UTM; se `utm_campaign` bate com uma campanha das abas de mídia, a compra herda canal e nome
  reais da plataforma. `utm_content` só vira anúncio no Meta (Ad Name).
- **Palavras-chave (só página Google Ads)**: tabela "Palavras-chave" (+ gráfico de CAC por dia) que cruza a
  coluna de keyword da aba Google Ads (`Keyword`/`Palavra-chave`, campo `kw` em `media[]`) com o **utm_term** das
  compras (campo `kw` em `sales[]`, só canal Google). A chave é normalizada em `_clean_kw` (minúscula, sem `[ ] " +`);
  sem utm_term/keyword = "(sem palavra-chave)". Respeita período e campanha selecionada (não conjunto/anúncio).
- **Métricas**: CPM · CTR · CPC · CR (Page Views pagos/Cliques) · CPV · PVR (Product View/Page Views) · CPPV ·
  ACR (AddToCart/Product View) · CPAC · VisCHK (Checkouts/AddToCart) · CPIC · ConvCHK (Compras/Checkouts) ·
  CAC (Gasto/Compras) · Ticket Médio · ROAS (Faturamento/Gasto). Na Visão Geral, CAC/ROAS são *blended*
  (gasto de mídia paga ÷ todas as compras) e CR/CPV usam só os page views dos canais pagos.
- **Visão Geral** ("Acumulado total") = acumulado de todos os canais (+ tabela "Resultado por canal"), com dois filtros no topo da seção: **Tráfego** (Todos/Pago/Orgânico — Pago = canais de mídia paga) e **Canal** por utm_source (Todos/Meta Ads/Google Ads/GPT/Google Org/Direto, via `classify_source` em `build.py`, campo `src` em `ga[]`/`sales[]`); "Remover Filtros" os reseta; **Meta/Google/TikTok** =
  só o respectivo canal.
- **Metas e verba** (botão 🎯 na topbar, popup no padrão do seletor de período): meta de investimento mensal (R$) + divisão em % por fonte (Google, Meta, TikTok, Shopee, Amazon, Mercado Livre; soma precisa dar 100%). Salvo só no navegador (`localStorage` `dm_budget`, por dispositivo); mostra o realizado do mês corrente (já com imposto do Meta) para Google/Meta/TikTok. Shopee/Amazon/ML não têm fonte de gasto ainda.
- **Imposto**: `TAX_FACTOR = 1.13806` (+13,806% sobre o gasto do Meta Ads; toggle "Imposto Meta" no topo). Incide só sobre o gasto do Meta. Com 1.0 o toggle some.
- **Sem metas** de CAC/ROAS por enquanto (`0.0`): a Saúde do funil usa o histórico da conta.
- **Indicativo ATIVO/PAUSADO** e **HR/BR/ER** (retenção de vídeo): aparecem no Meta se a planilha tiver as
  colunas (resolvido no navegador; nunca agregue status por nome no `build.py`).

⚠️ Pontos a conferir quando houver acesso aos dados reais: (1) se `Preço` é o valor do item (soma) ou do
pedido repetido por item; (2) se `Cost (Spend)` do Google está em R$ (não micros); (3) o texto exato de
Session source/medium para Meta pago (ajustar `META_SOURCES`/`ORGANIC_MEDIUMS`); (4) o GA4 cobre menos
dias que a aba Compras — em "Máximo" as taxas de conversão misturam períodos diferentes.

## IA Insights (legado)

O dashboard **não tem mais uma aba própria de geração de insights ao vivo**. O que
existia (botão "Gerar insights" chamando um Worker via POST) foi substituído por:
o card **"Saúde do funil"** (nota 0-100 calculada no navegador, sem IA — ver "Aba
Relatórios" abaixo) e o **Briefing do Gestor** (texto pré-gerado 1×/dia por uma
Routine, sem chamada de API no navegador). O backend (`ia-worker/worker.js`,
`ia-worker/wrangler.toml`, `IA_WORKER_URL` em `build/config.py`) continua no repo
como infraestrutura reaproveitável para quem quiser voltar a ter geração ao vivo —
ver `SETUP-IA.md` para o passo a passo de deploy (Cloudflare Worker + GitHub
Actions), item 8 (opcional) do checklist acima.

## Arquitetura / arquivos

A dashboard é montada a partir de **arquivos separados** (visual x lógica), costurados
pelo `build.py` no `render()` — assim dá para mexer só em cor/layout sem tocar na lógica:

```
build/build.py             # ENGINE: lê os 2 CSVs (read-only), emite meta[]/sales[] e COSTURA os arquivos abaixo
build/config.py            # CONFIG DO CLIENTE (copie de config.example.py e preencha)
build/config.example.py    # modelo comentado de build/config.py
build/template.html        # esqueleto HTML (placeholders __STYLES__ / __APP_JS__ / __DATA_JSON__)
build/identidade-visual.css # ⭐ TODAS as cores (temas claro/escuro, paleta de gráficos, heatmap). Edite AQUI p/ mexer só em cor.
build/estilos.css          # layout/componentes (CSS não-cor)
build/app.js               # lógica + renderização (gráficos/heatmap leem as cores via CSS vars)
.github/workflows/deploy.yml         # roda build.py e publica no Pages
.github/workflows/deploy-worker.yml  # publica o Worker de IA (legado/opcional — ver "IA Insights (legado)")
.github/workflows/gerar-relatorios-metrics.yml # 23:50 BRT: busca as planilhas e commita relatorios_metrics.json
ia-worker/worker.js    # backend de IA legado/opcional (ENGINE — não editar por cliente; não usado pela UI atual)
ia-worker/wrangler.toml # nome do Worker (preencher por cliente, placeholder nomecliente-ia-insights)
build/relatorios.json  # briefings do Gestor por período (aba Relatórios) — VERSIONADO
build/relatorios_metrics.json # números por período (total, mídia paga, por canal, campanhas) — gerado pelo Actions, lido pela Routine
build/gerar_relatorios.py # calcula as métricas por período (rodado pelo Actions, não pela Routine)
build/GUIA-RELATORIOS.md  # passo a passo da Routine que regenera os briefings + particularidades deste funil
build/METODO-ODR-ANALISE.md # ⭐ método de raciocínio (Método ODR) p/ redigir os briefings — genérico, não editar por cliente
dist/index.html        # saída gerada (gitignored; o Actions reconstrói)
GUIA-REPLICACAO.md     # engine explicada + solução dos problemas de publicação
config.js               # metadados de publicação (GitHub) — copie de config.example.js
SETUP-CRON.md          # valores do cron-job.org (owner/repo com placeholders)
SETUP-IA.md            # passo a passo do backend de IA legado/opcional (ver "IA Insights (legado)")
```

### Aba Relatórios / "Insights de IA" (relatórios automáticos do funil)
Última aba do menu (nome exibido "Insights de IA", id interno `page-rel`).
Reaproveita os filtros de data da topbar e os dados já embutidos (`meta[]`/
`sales[]`) — tudo calculado no navegador (custo zero): card **Saúde do funil**
(nota 0-100 — ver abaixo), visão por campanha, **Top 5 / Piores 5 anúncios**
(Top 5 exige um mínimo de 3 vendas no período; com link do criativo via coluna
*Creative Instagram Permalink* → `ad_links`, se a planilha do cliente tiver essa
coluna), cards **Visão Geral Total** (todas as vendas) e **Tráfego** (só Meta
Ads), e o **Briefing do Gestor** (texto pré-gerado por IA). **Código de cor**
(vermelho/amarelo/verde/ciano) em **CAC** e **ROAS** (visão por campanha/Top-
Piores), conforme `CAC_TARGET`/`ROAS_TARGET` em `build/config.py` (desempenho =
ROAS `valor/meta`, CAC `meta/valor`).

**Saúde do funil** — nota 0-100 calculada no navegador (sem IA), ancorada numa
meta de **CAC** editável direto no card (persistida em `localStorage`, ou
`CAC_TARGET` de `build/config.py` como valor inicial) e numa meta de **ROAS**
(`ROAS_TARGET`); os demais componentes (CTR, CR, VisCHK, ConvCHK) usam como piso
85% da taxa histórica da própria conta (todo o período, sem filtro de data).
ROAS pesa mais na nota (35%) por ser o único componente que garante lucro, não
só desempenho operacional.

O **Briefing do Gestor** (texto interpretativo por período) é **pré-gerado por IA**
e lido de `build/relatorios.json` — **sem chamada de API no navegador nem créditos
da Anthropic**. Regeneração em **2 etapas diárias** (o sandbox do agente não alcança
o Google Sheets, só o runner do GitHub Actions — ver "problemas conhecidos" #4):
**23:50 BRT** o workflow `gerar-relatorios-metrics.yml` busca as planilhas e commita
`build/relatorios_metrics.json` (só números); **23:59 BRT** uma **Routine do
Claude Code** lê esse arquivo, migra o texto que estava em "hoje" para "ontem" e
redige os 9 briefings do zero seguindo `build/GUIA-RELATORIOS.md`, commitando
`relatorios.json`. Rodar no fim do dia (não de manhã) garante que "hoje" seja
analisado com o dia quase completo. Se o JSON não existir, a aba mostra tudo
menos o briefing (cards/tabelas seguem funcionando). Configure essa Routine (ou
equivalente) por cliente — não vem pronta neste template.

O `build.py` **não agrega**: exporta as linhas cruas e toda a lógica (filtros, KPIs,
tabelas, gráficos, heatmap, imposto, tema) roda no navegador.

Teste local:
`python build/build.py --meta-file meta.csv --sales-file sales.csv --out dist/index.html`

## Publicação — problemas conhecidos e soluções

1. **Push com integração somente‑leitura:** se `git push`/MCP derem `403 Resource not
   accessible by integration`, faça push com o **PAT do usuário** direto ao github.com
   (`git push https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git main:main`).
   **Nunca** grave o token no `.git/config` (use a URL efêmera).
2. **cron-job.org só funciona na `main`:** `workflow_dispatch` só existe na branch padrão.
3. **Pages liga sozinho:** `actions/configure-pages@v5` com `enablement: true`
   (+ `permissions: {pages: write, id-token: write}`).
4. **Proxy do sandbox:** o agente NÃO alcança `docs.google.com`, `*.github.io` nem a API
   REST de Actions/Pages e nem `api.cloudflare.com` — mas o runner do Actions alcança
   tudo. Teste dados com CSV local; deploys da Cloudflare passam pelo GitHub Actions.
5. **Token exposto no chat:** revogar e gerar um novo (fine‑grained, só Actions: r/w no repo).
6. **"Senha incorreta" no backend de IA legado (se estiver em uso):** normalmente
   indica que os secrets `ANTHROPIC_API_KEY`/`INSIGHTS_PASSWORD` não estão
   cadastrados como Secrets do repositório no GitHub — o workflow `deploy-worker.yml`
   os reaplica no Worker a cada deploy; sem eles cadastrados, o Worker fica sem
   senha válida. Só se aplica a quem reativou o Worker (ver "IA Insights (legado)").
7. **Briefing do Gestor não aparece:** confirme que `build/relatorios.json` existe e
   que a Routine (item 7 do checklist) está rodando 1×/dia; sem esse arquivo, a aba
   mostra tudo (cards, Saúde do funil, tabelas) menos o briefing.
8. **Venda não aparece na aba Meta Ads (ou aparece na campanha errada):** confirme
   qual coluna UTM da planilha do cliente carrega o identificador real do anúncio do
   Meta (`Ad Name`) — nem sempre é `UTM Content`; `UTM Term` costuma carregar o
   **posicionamento** (`Instagram_Reels`/`Feed`/`Stories`), não o nome do anúncio.
   Casar pela coluna errada zera as atribuições. Além disso, nomes de anúncio podem se
   repetir entre campanhas diferentes — o match precisa ser **campanha+anúncio juntos**
   (`UTM Campaign`+`UTM Content`), senão a venda pode ser atribuída à campanha errada.
   Confira o valor real do `Ad Name` na API/painel do Meta e compare com as colunas
   UTM antes de mexer no alias.
