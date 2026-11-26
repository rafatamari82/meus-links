# Arquitetura: rastreador de vendas (dentro do app.cutti.us)

Stack: o mesmo Worker do encurtador (Cloudflare Workers + D1, plano grátis). Sem serviço novo.

## Tabelas novas
- `tk_clicks` (id = click ID `ct…`, link_id, at, source, campaign, adset, ad, keyword, gclid, nb_callback, country, device). Índices: (at), (source, campaign, at).
- `tk_conversions` (id, click_id, network, txid, type sale|upsell|refund|chargeback, amount_cents, currency, at). Único (network, txid, type): postback repetido não conta duas vezes.
- `tk_costs` (date, source, campaign_key, campaign_name, cost_cents, currency, clicks, impressions). Chave (date, source, campaign_key): o script reenviar só atualiza.
- `tk_events` (log dos últimos postbacks, para conferir integração).
- `links` ganha `track`, `network`, `sub_param`.
- `settings`: `tk_key` (chave secreta das URLs), `currency`, `usd_brl`, `eur_brl`, `nb_postback`, `gads_conv_name`.

## Rotas
| rota | o quê |
| --- | --- |
| GET short link com track=1 | grava clique, gera click ID, põe no sub_param, aceita `lp` do mesmo host (template do Google) |
| GET /t.js | script da presell |
| GET/POST /pb/:key/:network | postback e webhook; responde 200 sempre |
| POST /cost/:key/google | gasto vindo do script do Google Ads |
| GET /export/:key/google.csv | conversões offline com gclid |
| GET /results | painel: cards e tabela por campanha ou anúncio |
| GET /sales | vendas e log de postbacks |
| GET/POST /integrations | URLs, script, CSV da NewsBreak, câmbio, chave |

## Partes que mordem
- Fuso: dias em America/Sao_Paulo; o script do Google manda a data no fuso da conta.
- Moeda: tudo convertido para a moeda do painel com câmbio manual.
- Idempotência: índices únicos em vendas e custos.
- Segurança: chave aleatória de 24 bytes na URL, comparada em tempo constante; só no host do painel.

## Ordem
1. Fatia: link rastreado → clique → postback → venda na tela de resultados.
2. Gasto Google e NewsBreak, Vendas, Integrações.
3. Conversões offline e postback NewsBreak.
