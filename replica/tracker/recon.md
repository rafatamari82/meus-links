# Recon map: UTMify (web)

Scope (proposta): o loop principal de rastreamento de tráfego direto. As UTMs do anúncio (com os IDs de campanha, conjunto e anúncio) chegam na venda pelo webhook da plataforma. Isso é cruzado com o gasto da Meta e vira um painel de lucro, ROAS e CPA por campanha, conjunto e anúncio.
For: uso próprio (Rafael). Tráfego: Google Ads e NewsBreak (não Meta). Vendas: Hotmart, Kiwify, BuyGoods, ClickBank, Digistore24, MaxWeb, GuruMedia, SmartADV, SmashLoud, ClickADV. Fica dentro do painel app.cutti.us.
Date: 2026-11-25

Fontes: só páginas públicas, a ficha da App Store e tutoriais públicos. O app (app.utmify.com.br) fica atrás de login e não foi acessado. Os termos de uso da UTMify ainda não foram lidos: ler antes de usar uma conta sua como referência.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Store (descrição e notas de versão) | https://apps.apple.com/app/id6504533155 | dashboard, múltiplos dashboards, gerir campanhas pelo relatório, duplicar campanha em outra conta, regras automáticas, tela de vendas, custo de produto |
| 2 | Tutorial público: integrar com a Hotmart | https://recapio.com/digest/como-integrar-a-utmify-com-a-hotmart-2025-by-guilhermo-pressi | escolhe a plataforma, copia a URL de webhook, cola na plataforma; cola o código de UTM nos "parâmetros de URL" do anúncio |
| 3 | Tutorial público: configurar a operação na Meta | https://recapio.com/digest/aprenda-a-configurar-a-sua-operacao-do-meta-ads-na-utmify-by-utmify | conectar perfis, BMs e contas de anúncio; o código de UTM muda conforme a plataforma de venda |
| 4 | Tutorial público: dúvidas de UTM | https://recapio.com/digest/principais-duvidas-sobre-a-configuracao-de-utms-na-utmify-by-utmify | script em todas as páginas do funil (presell, VSL, checkout); cloakers precisam repassar UTM; vendas orgânicas |
| 5 | Ajuda da VTurb (integração UTMify) | https://help.vturb.com/en-us/article/wb56zh | aba Integrações; destino sem parâmetros + código de UTM nos parâmetros de URL; conflito com GTM |
| 6 | Blog HeroSpark | https://herospark.com/blog/utmify-para-o-infoprodutor-e-como-integrar-com-a-herospark/amp/ | criar links com UTM no painel (fonte, mídia, campanha) |
| 7 | Lista de plataformas de um concorrente (referência de mercado) | https://docs.nemu.com.br/en/onboarding/integrations | as plataformas que esse mercado espera: Hotmart, Kiwify, Eduzz, Monetizze, Braip, Buygoods, Cartpanda, Shopify, Yampi… |

## Core loop

Saber quanto cada campanha, conjunto e anúncio da Meta vendeu e lucrou, e agir (pausar, escalar) a partir desse número.

## Como funciona (mecânica inferida)

1. O anúncio leva, nos "parâmetros de URL", um código de UTM com macros da Meta: nome e ID da campanha, do conjunto e do anúncio.
2. Um script colocado em todas as páginas do funil guarda as UTMs e as repassa adiante, inclusive para o link do checkout.
3. A plataforma de venda (Hotmart, Kiwify etc.) manda cada venda por webhook para a ferramenta, com as UTMs.
4. A ferramenta puxa da API da Meta o gasto por campanha, conjunto e anúncio, cruza com as vendas pelos IDs e calcula lucro, ROAS, CPA e ROI.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Entrar / criar conta | /login | acesso | form | erro, carregando |
| S02 | Dashboard (resumo) | tela inicial | visão geral da operação | cartões: faturamento, gasto, lucro, ROAS, ROI, vendas, CPA, ticket médio, reembolsos; filtros de período, produto e conta; gráfico por dia | sem dados (primeira vez), cheio |
| S03 | Campanhas Meta | menu | resultado e ação por campanha, conjunto e anúncio | tabela por nível, colunas de gasto, vendas, faturamento, lucro, ROAS, CPA; liga/desliga; editar orçamento | sem conta conectada, cheio |
| S04 | Vendas | menu (nova na versão 2.5.0) | ver e filtrar vendas | tabela com status, produto, valor, UTMs, origem; filtros | vazio, cheio |
| S05 | Integrações | menu | ligar plataformas de venda e de anúncio | cartões por plataforma, URL de webhook para copiar, botão conectar Meta | não conectado, conectado, erro |
| S06 | Configurar UTMs | dentro de Integrações | código de UTM para o anúncio e script das páginas | blocos para copiar, seleção da plataforma de venda | — |
| S07 | Produtos e custos | menu | custo do produto, taxas e impostos para o lucro real | lista agrupada por produto, campos de custo | vazio |
| S08 | Regras automáticas | menu | pausar ou escalar sozinho por condição | lista de regras, editor "se X então Y" | vazio |
| S09 | Múltiplos dashboards | seletor no topo | um dashboard por produto ou operação | seletor, criar e renomear | — |
| S10 | Configurações | avatar | conta, fuso, moeda | abas | — |

## Flows

```
F01 Configurar a operação (uma vez)
    S05 conectar Meta → escolher contas de anúncio → S05 escolher plataforma de venda → copiar webhook → colar na plataforma
    → S06 copiar o código de UTM → colar nos parâmetros de URL dos anúncios → copiar o script → colar nas páginas
    edge: token da Meta expira, conta de anúncio sem permissão, cloaker que corta as UTMs

F02 Venda chega
    webhook da plataforma → validar → gravar venda com status e UTMs → ligar ao anúncio pelo ID
    edge: venda sem UTM (orgânica), reembolso ou chargeback depois, a mesma venda chegando duas vezes, moeda diferente

F03 Ver o resultado (o loop principal)
    S02 → S03 (campanha → conjunto → anúncio)
    happy path: 2 cliques

F04 Agir na campanha pelo relatório
    S03 → desligar ou mudar orçamento → confirmação → API da Meta

F05 Ajustar o lucro real
    S07 → custo por produto, taxas e impostos

F06 Regras automáticas
    S08 → criar regra → executa sozinha num horário

F07 Ver vendas
    S04 → filtros
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Cartão de métrica | moeda, número, porcentagem, com variação | carregando, vazio | S02 |
| Filtro de período | hoje, ontem, 7d, 30d, personalizado | — | S02, S03, S04 |
| Tabela de campanhas | níveis campanha, conjunto e anúncio, colunas ordenáveis | carregando, vazia | S03 |
| Interruptor de status | ativo, pausado | salvando, erro | S03 |
| Edição de orçamento | inline | salvando, erro | S03 |
| Bloco "copiar" | código, URL | copiado | S05, S06 |
| Cartão de integração | plataforma | conectado, desconectado, erro | S05 |
| Gráfico de barras/linha | por dia | vazio | S02 |
| Seletor de dashboard | — | — | todas |
| Toast | sucesso, erro | — | todas |

## Inferred data model

```
User            id, email, password_hash, timezone, currency
Dashboard       id, user_id, name, filters (produtos, contas)              confidence: medium
AdAccount       id, user_id, platform ('meta'), external_id, name, currency, token_ref, active
Campaign/AdSet/Ad  external_id, account_id, name, status, daily_budget, parent_id   (cache da API)
AdSpendDaily    date, level, external_id, spend, impressions, clicks         (puxado da API da Meta)
SalesPlatform   id, user_id, kind ('hotmart'|'kiwify'|…), webhook_secret, created_at
Sale            id, user_id, platform_id, external_order_id (único por plataforma), status
                (pending|approved|refunded|chargeback|canceled), product_name, product_id,
                amount, currency, fees, commission, customer_email_hash, created_at, approved_at,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term, src, sck,
                campaign_id, adset_id, ad_id (extraídos das UTMs)
                evidence: tutoriais de webhook, tela de vendas    confidence: high (campos exatos: palpite)
ProductCost     id, user_id, product_key, cost, tax_pct, fee_pct              evidence: nota 2.4.5   confidence: medium
Rule            id, user_id, level, condition (métrica, operador, valor, período), action (pausar, orçamento ±%), schedule
                evidence: App Store "regras automatizadas"   confidence: medium
```

Relationships: User 1-n AdAccount, AdAccount 1-n Campaign 1-n AdSet 1-n Ad; Sale n-1 Ad (pelos IDs nas UTMs); User 1-n SalesPlatform 1-n Sale.

## Feature matrix

See `features.csv`.

## Out of scope (cannot or should not be cloned)

- O app de celular (iOS e Android): primeiro a versão web.
- Integrações prontas com dezenas de plataformas de venda de uma vez: o clone começa com as que você usa.
- A marca, os textos e os vídeos de tutorial da UTMify.
- Acesso à API da Meta para outras pessoas: exige app aprovado pela Meta. Para uso próprio, um app em modo de desenvolvimento com o seu token basta.

## Size

Screens 10, flows 7, entities 9. Hard parts:
1. API de Marketing da Meta: token, permissões, limites de chamadas, gasto por nível e ações (pausar, orçamento).
2. Webhook de cada plataforma de venda: formato, status, reembolso e chargeback diferentes em cada uma, e venda duplicada.
3. Atribuição: tirar os IDs das UTMs com segurança, venda sem UTM, fuso horário (Meta e plataforma em fusos diferentes) e moeda (venda em dólar, gasto em real).

Size: L para tudo; M para o loop principal (Meta + 1 ou 2 plataformas + dashboard + campanhas + vendas).


## Revisão após as respostas (2026-11-25)

O dono é afiliado em rede e anuncia no Google Ads e na NewsBreak. Isso troca a mecânica:

1. **Clique com ID próprio.** O link do cutti.us gera um click ID (`ct` + 10 caracteres) a cada clique, guarda campanha, conjunto, anúncio, palavra, gclid e o callback da NewsBreak, e coloca o ID no parâmetro de sub-ID da rede (tid no ClickBank, cid na Digistore24, subid na BuyGoods e MaxWeb, sub1 na GuruMedia, sck ou src na Hotmart e Kiwify).
2. **Presell no meio.** Um script (`/t.js`) na presell repassa o click ID para os links da oferta.
3. **Postback da rede.** Cada rede chama `/pb/<chave>/<rede>` com o click ID, a comissão e o ID do pedido. Hotmart e Kiwify mandam JSON; o click ID é achado pelo formato, em qualquer campo.
4. **Gasto.** Google Ads: um script colado em Ferramentas → Scripts manda o gasto diário por campanha (sem token de desenvolvedor). NewsBreak: importação do CSV exportado do Ads Manager; a API de relatórios da NewsBreak não tem documentação pública confirmada, fica para depois.
5. **Volta para o anúncio (opcional).** CSV de conversões offline com gclid para o Google buscar agendado; postback para a NewsBreak com o callback.

Fontes novas: ClickBank e NewsBreak (support.clickbank.com/en/articles/12462999), Digistore24 (help.digistore24.com/hc/en-us/articles/24293197806225), BuyGoods (backoffice.buygoods.com/faq), MaxWeb e GuruMedia (help.redtrack.io), Hotmart SRC/SCK e webhook sem UTM (help.hotmart.com/pt-br/article/360002403031), Google Ads Scripts UrlFetchApp (developers.google.com/google-ads/scripts/docs/features/third-party-apis).

Fora do escopo por enquanto: Meta, pausar e editar orçamento pelo painel (precisa de token de desenvolvedor do Google), regras automáticas, múltiplos dashboards.
