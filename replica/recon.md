# Recon map: Rebrandly (web)

Scope: o loop principal de links de marca: domínio próprio → link curto → redirect → cliques medidos → editar destino. Mais QR code, tags, UTM e estatísticas básicas.
For: uso próprio do Rafael (um único dono; sem planos, cobrança nem equipes)
Date: 2026-11-25

Fontes: só páginas públicas. O app (app.rebrandly.com/links) fica atrás de login e não foi acessado.
Os termos de uso do Rebrandly ainda não foram lidos. Ler antes de usar uma conta sua como referência.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help: criar link | https://support.rebrandly.com/en/articles/469629 | campos do formulário de novo link |
| 2 | help: editar destino | https://support.rebrandly.com/en/articles/469603 | Links → Branded links → Edit |
| 3 | help: coleção Links & Domains | https://support.rebrandly.com/en/collections/1123244-links-domains | lista de recursos: bulk, CSV, senha, deep link, emoji, export, presets UTM |
| 4 | help: guia de domínios | https://support.rebrandly.com/en/articles/750459-rebrandly-s-guide-to-custom-domains | domínio próprio via DNS, ou comprado |
| 5 | help: DNS | https://support.rebrandly.com/en/articles/469571 | apontar DNS para o IP deles |
| 6 | help: alias de domínio | https://support.rebrandly.com/en/articles/469576 | New domain → Connect a domain you already own |
| 7 | product updates | https://support.rebrandly.com/en/articles/469559-product-updates | QR scans como métrica, exports, conversões |
| 8 | API: modelo | https://developers.rebrandly.com/docs/model-overview | Workspace, Domain, Link, Tag, Script |
| 9 | API: link entity | https://developers.rebrandly.com/docs/link-entity.md | campos do link |
| 10 | API: domain entity | https://developers.rebrandly.com/docs/branded-domain-model.md | campos do domínio |
| 11 | API: analytics | https://developers.rebrandly.com/docs/link-analytics.md | clicks, sessions, lastClickAt |
| 12 | API: rate limits | https://support.rebrandly.com/en/articles/469686-what-is-the-rebrandly-api | workspaces classic vs extended |
| 13 | blog: novo editor de link | https://www.rebrandly.com/blog/link-editing-update | painel lateral: destino, slug, preview, UTM, routing |
| 14 | pricing (terceiros) | https://toolradar.com/tools/rebrandly/pricing | Free 10 links/mês; Essentials 250; Professional 1.500 |

## Core loop

Criar um link curto no seu próprio domínio, compartilhar, medir os cliques e trocar o destino quando quiser sem mudar o link.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Entrar / criar conta | /login, /signup | acesso | form, botão Google | vazio, erro, carregando |
| S02 | Lista de links | /links (tela inicial) | achar e gerenciar links | tabela, busca, filtros (domínio, tag, favorito), seleção em massa, botão Novo link | vazio (primeiro link), cheio, carregando, sem resultado na busca |
| S03 | Novo link | botão "New link" → painel | criar link | destino (até 2.048), domínio, back-half (até 50, aleatório ou custom), nome, tags, preview social, senha, copiar ao criar | padrão, back-half já existe, URL inválida, limite do plano |
| S04 | Editar link | ícone de editar → painel lateral | trocar destino, slug, preview, UTM, routing | form em abas/seções, UTM builder, QR | salvo, erro, limite de edições |
| S05 | Estatísticas do link | link → stats | ver desempenho | gráfico de cliques/dia, sessões, países, dispositivos, referrers, scans de QR | sem cliques, com dados |
| S06 | QR code | ação no link | baixar QR | preview, PNG/SVG, cor | padrão |
| S07 | Domínios | menu Domains | ver domínios | lista com status ativo/pendente, domínio padrão | só domínio do serviço, pendente, ativo |
| S08 | Adicionar domínio | Domains → New domain → Connect a domain you already own | conectar domínio | input do domínio, registros DNS a copiar, verificar | aguardando DNS, verificado, erro |
| S09 | Tags | menu / dentro do link | organizar | lista, cor, contagem | vazio, cheio |
| S10 | Importar em massa | Links → importar CSV | criar muitos links | upload, mapeamento de colunas, relatório | linhas com erro |
| S11 | Configurações | avatar → settings | conta, chaves de API, plano | abas | — |
| S12 | Páginas públicas | o próprio link curto | redirect, senha, 404, expirado | página de senha, página de link não encontrado | senha errada, expirado |

## Flows

```
F01 Criar e compartilhar um link (o loop principal)
    S02 → S03 (cola destino, escolhe domínio, back-half) → criado e copiado
    happy path clicks: 3 (Novo link, colar, Criar)
    edge: back-half já usado, URL sem https, domínio inativo, limite mensal atingido

F02 Visitante clica no link
    shortUrl → [registra clique] → 301/302 para o destino (repassa query params se ligado)
    edge: slug não existe (404 do domínio), link expirado, link com senha, bots/preview de redes sociais não contam como clique

F03 Trocar o destino de um link já publicado
    S02 → S04 → salvar
    happy path clicks: 3
    edge: QR impresso continua funcionando, limite de edições do plano

F04 Conectar domínio próprio
    S07 → S08 (digita domínio → copia registros DNS → Verificar) → ativo
    edge: DNS ainda propagando, domínio é o site principal (derrubaria o site), SSL pendente

F05 Ver estatísticas
    S02 → S05
    edge: sem cliques, fuso horário

F06 Gerar QR code
    S02 ou S04 → S06 → baixar

F07 Importar CSV
    S02 → S10 → relatório de sucesso/erro

F08 Organizar e achar links
    S02 (busca, filtro por tag/domínio, favoritar)

F09 Usar pela API
    S11 (gerar chave) → POST /links
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, hover, focus, disabled, loading | todas |
| Input texto/URL | com prefixo de domínio, com contador | default, focus, error, disabled | S03, S04, S08 |
| Select de domínio | — | aberto, desabilitado | S03, S04 |
| Tabela de links | linha com cópia rápida, checkbox | hover, selecionada, vazia | S02 |
| Painel lateral (drawer) | criar, editar | aberto, salvando | S03, S04 |
| Chip de tag | cores | removível | S02, S03, S09 |
| Botão copiar | — | copiado | S02, S03 |
| Toast | sucesso, erro | — | todas |
| Gráfico de linha | cliques/dia | vazio, carregando | S05 |
| Tabela de breakdown | país, dispositivo, referrer | vazia | S05 |
| Bloco de registro DNS | tipo, nome, valor, copiar | — | S08 |
| Badge de status | ativo, pendente, erro | — | S07 |
| Modal de confirmação | apagar | — | S02, S07, S09 |
| Banner de limite do plano | — | — | S02, S03 |

## Inferred data model

```
Workspace  id, name, owner_id, created_at
           evidence: API model overview (links, domains, tags e scripts vivem num workspace)
           confidence: high

User       id, email, name, created_at
Membership user_id, workspace_id, role (owner | admin | member)
           evidence: teammates por plano, permissões por workspace
           confidence: medium

Domain     id, workspace_id, full_name, tld, type (service | user), active,
           verified_at, is_default, not_found_url, created_at, updated_at
           evidence: API domain entity; help de DNS; "forward 404 errors to my website"
           confidence: high (campos da API), medium (not_found_url, is_default)

Link       id, workspace_id, domain_id, slashtag, destination, title, favourite,
           forward_parameters, password_hash, expires_at, og_title, og_description,
           og_image, clicks, last_click_at, created_by, created_at, updated_at
           unique (domain_id, lower(slashtag))
           evidence: API link entity; formulário de novo link; help de senha e preview
           confidence: high

Tag        id, workspace_id, name, color
LinkTag    link_id, tag_id
           evidence: API tags (attach/detach)
           confidence: high

Click      id, link_id, at, country, device, os, browser, referrer_host,
           is_qr, session_hash, is_bot
           evidence: analytics (clicks, sessions, país, device, referral); QR scans como métrica própria
           confidence: medium (os campos exatos são palpite)

ApiKey     id, workspace_id, name, hash, last_used_at
UtmPreset  id, workspace_id, name, source, medium, campaign, term, content
           confidence: medium
```

Relationships: Workspace 1-n Domain, Workspace 1-n Link, Domain 1-n Link, Link n-n Tag, Link 1-n Click, Workspace n-n User (Membership).

## Feature matrix

See `features.csv`. Must: 13, should: 11, could: 8, skip: 5.

## Out of scope (cannot or should not be cloned)

- Vender/registrar domínios: depende de parceria com registrador.
- O domínio de serviço deles (rebrand.ly). O clone usa um domínio de serviço seu.
- Integrações de terceiros já listadas (Zapier, Hootsuite, Slack etc.): são acordos e apps publicados deles. Dá para fazer as suas depois.
- Rebrandly AI (sugestões de back-half, melhor horário para postar): é uma camada de produto, não o loop. Fica como "could" com IA sua.
- SSO empresarial.

## Size

Screens 12, flows 9, entities 9. Hard parts:
1. Domínios de clientes com HTTPS automático (certificado para qualquer domínio que o usuário conectar).
2. Redirect rápido e confiável. É o produto: se cair, todos os links de todo mundo caem.
3. Contagem de cliques honesta: filtrar bots e robôs de preview, geolocalização, sessões.

Size: M (algumas semanas para o loop completo com domínio próprio e estatísticas).
