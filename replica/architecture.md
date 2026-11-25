# Architecture: encurtador de links próprio (clone do Rebrandly)

Para: um único dono (Rafael). Sem planos, cobrança, equipes ou workspaces.
Lê: `recon.md`, `features.csv`. Data: 2026-11-25.

## Stack

| camada | escolha | por quê |
| --- | --- | --- |
| app web | Python 3 + Flask, páginas renderizadas no servidor (Jinja) + JS mínimo | um processo só, sem etapa de build; um painel pessoal não precisa de SPA |
| estilo | CSS puro com variáveis dos tokens do replica-design | sem build; os tokens viram `tokens.css` |
| banco | SQLite em modo WAL | um arquivo, backup é copiar o arquivo; folga enorme para um usuário |
| acesso a dados | SQL direto (módulo `sqlite3` da biblioteca padrão) | 6 tabelas, consultas simples |
| auth | e-mail + senha com hash (werkzeug, vem com o Flask), cookie de sessão assinado | só existe um dono; o cadastro se fecha depois da primeira conta |
| HTTPS nos domínios | Caddy na frente, com "on-demand TLS" e um endpoint `ask` | emite certificado automático para cada domínio que você verificar; resolve a parte mais difícil sem código |
| servidor de produção | gunicorn atrás do Caddy | instalado no servidor (`pip install gunicorn`) |
| hospedagem | uma VPS pequena (Hetzner, DigitalOcean) ou Fly.io com volume | precisa de IP fixo para os registros A dos seus domínios e de disco para o SQLite |
| testes | Playwright (Python) + Chrome | já disponíveis aqui |

Nota: o padrão do pack é Next.js + Postgres. Não usei porque a instalação de pacotes está desligada nesta sessão, e porque, para um encurtador pessoal, um servidor só com SQLite e Caddy é mais simples de manter e mais barato.

## Schema

Em `schema.sql`. Diferenças do padrão Postgres, por ser SQLite:
- ids são UUID em texto; horários são texto ISO 8601 em UTC (`...Z`).
- Acesso: uma checagem de dono por consulta na camada de dados (`WHERE user_id = ?`). Não existe RLS no SQLite.

Tabelas: `users`, `domains`, `links`, `tags`, `link_tags`, `clicks` (6).

Restrições que importam:
- `unique (domain_id, slashtag_lower)`: dois links não podem ter o mesmo back-half no mesmo domínio. Fica no banco, não só na tela.
- `unique (full_name)` em domínios.
- `destination` só aceita `http://` ou `https://` (check), para bloquear `javascript:` e similares.

## Rotas

Painel: só responde no host do app (`APP_HOST`). Links curtos: respondem em qualquer domínio verificado e também no `APP_HOST`.

### F01 Criar link / F08 achar links

| método | caminho | faz | quem | entrada | saída |
| --- | --- | --- | --- | --- | --- |
| GET | /links | lista (S02), busca `q`, filtro `domain` | dono | query | HTML |
| POST | /links | cria link (S03) | dono | destination, domain_id, slashtag?, title? | redirect para /links com o novo link em destaque |

### F02 Visitante clica

| método | caminho | faz | quem | entrada | saída |
| --- | --- | --- | --- | --- | --- |
| GET | /<slashtag> | acha (host, slashtag), registra clique, redireciona 302 | público | Host, slashtag, query | 302 para o destino (com query repassada se ligado), ou 404 |
| GET | / (em domínio curto) | raiz do domínio | público | Host | 302 para a URL de fallback do domínio, ou página simples |

302 e não 301: o navegador guarda 301 para sempre, e aí trocar o destino deixaria de funcionar para quem já clicou.

### F03 Editar / apagar

| método | caminho | faz | quem |
| --- | --- | --- | --- |
| GET | /links/<id>/edit | formulário de edição (S04) | dono |
| POST | /links/<id> | salva destino, back-half, nome | dono |
| POST | /links/<id>/delete | apaga | dono |

### F04 Domínios

| método | caminho | faz | quem |
| --- | --- | --- | --- |
| GET | /domains | lista (S07) com status | dono |
| POST | /domains | adiciona domínio pendente (S08) | dono |
| POST | /domains/<id>/verify | resolve o domínio e confere se aponta para `SERVER_IP` | dono |
| POST | /domains/<id>/default | define o domínio padrão do formulário | dono |
| POST | /domains/<id>/delete | remove (bloqueado se tiver links) | dono |
| GET | /internal/tls-allowed?domain= | o Caddy pergunta se pode emitir certificado; 200 só para domínio verificado | só localhost |

### F05 Estatísticas

| método | caminho | faz | quem |
| --- | --- | --- | --- |
| GET | /links/<id> | total, último clique, cliques por dia em 30 dias (S05) | dono |

### Auth

| método | caminho | faz | quem |
| --- | --- | --- | --- |
| GET/POST | /setup | cria a conta do dono; some depois que ela existe | qualquer um, uma vez |
| GET/POST | /login | entra | público |
| POST | /logout | sai | dono |

Sem webhooks e sem tarefas agendadas na v1.

## As partes que mordem

- **Disputa pelo back-half:** dois envios ao mesmo tempo com o mesmo back-half. O índice único resolve; o app captura o erro e mostra "já está em uso".
- **Back-half aleatório:** 6 caracteres sem ambíguos (sem 0/O, 1/l/I); se colidir, tenta de novo até 5 vezes.
- **Maiúsculas:** back-half único sem diferenciar maiúsculas, para `/Oferta` e `/oferta` não virarem links diferentes.
- **Caminhos reservados no host do app:** `login`, `links`, `domains`, `static` etc. não podem ser back-half.
- **Host header:** o painel só abre no `APP_HOST`; num domínio curto, `/login` é tratado como back-half e dá 404. Assim, ninguém acha o painel pelo seu domínio de links.
- **Robôs:** WhatsApp, Facebook, Slack, Telegram e crawlers abrem o link para gerar a prévia. Eles são redirecionados normalmente, mas o clique não conta (lista de user-agents).
- **Fuso horário:** tudo é gravado em UTC e mostrado em America/Sao_Paulo.
- **SQLite concorrente:** modo WAL; uma escrita por clique é tranquilo para este volume.
- **Domínio do site principal:** apontar o domínio raiz do seu site para cá derruba o site. A tela de domínio avisa para usar um domínio ou subdomínio dedicado (ex.: `go.primevitality.co`).
- **Rate limit:** limite simples de tentativas de login por IP.

## Ordem de construção

1. **Fatia vertical**: `/setup`, `/login`, criar link no `APP_HOST`, redirect com clique contado, contagem na lista.
   Telas: S01, S02, S03. Tabelas: users, domains, links, clicks.
2. **Obrigatórias restantes**: back-half custom com validação, busca, copiar, editar (S04), apagar, domínios com verificação e endpoint do Caddy (S07, S08).
3. **Desejáveis**: estatísticas por dia (S05), filtro de robôs, tags, favoritos, UTM, repassar query, fallback 404, prévia social, QR.
4. **Opcionais**: senha, expiração, importar/exportar CSV, API.

---

## Revisão 2026-11-25: Cloudflare Workers + D1 (substitui Flask/SQLite/Caddy)

Motivo: o dono não quer custo mensal (Railway custaria US$ 5/mês, o mesmo que pagava antes).

| camada | escolha | por quê |
| --- | --- | --- |
| app | Cloudflare Worker em JavaScript, sem dependências | plano gratuito (100 mil req/dia), redirect na borda |
| banco | D1 (SQLite gerenciado), criado no primeiro deploy | grátis até 5 GB / 100 mil gravações por dia |
| HTTPS de domínios | Custom Domains do Workers | a Cloudflare cria DNS e certificado; domínio precisa estar na conta Cloudflare |
| segredo de assinatura | gerado no primeiro acesso e guardado no D1 | zero configuração para o dono |
| verificação de domínio | o primeiro request que chega naquele host ativa o domínio; o botão Verificar busca um token em `/.well-known/shortlinks-verify` | só a conta Cloudflare do dono consegue rotear um domínio para este Worker |
| senha | PBKDF2-SHA256, 30 mil iterações | o limite de CPU do plano grátis é 10 ms; o limite de tentativas no D1 (10 por 15 min por IP) compensa |
| cliques | gravados com `waitUntil` depois do redirect | o visitante não espera o banco |
