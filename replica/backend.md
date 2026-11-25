# Backend (versão Cloudflare Workers)

- **Auth:** uma conta (o dono), criada em `/setup` na primeira visita; o insert só acontece se não existir usuário (sem corrida). Sessão em cookie assinado com HMAC-SHA256, httpOnly, SameSite=Lax, Secure em HTTPS, 30 dias.
- **CSRF:** cookie + campo do formulário (double submit) em todo POST.
- **Login:** limite de 10 tentativas por IP a cada 15 minutos, guardado no D1 (vale entre instâncias).
- **Banco:** D1; o schema roda sozinho a cada cold start (`create table if not exists`). Toda consulta de dados do dono filtra por `user_id`.
- **Redirect:** 302 com `no-store` (trocar o destino vale na hora), `noindex`, repasse de query, clique gravado depois da resposta.
- **Pronto para virar produto:** tudo já tem `user_id`; o que falta para vender: cadastro aberto, planos, cobrança e tratamento de abuso.

## Checklist
- [x] nenhum segredo no código; o segredo de assinatura é gerado e guardado no banco
- [x] validação no servidor em todas as entradas
- [x] dono checado em toda leitura e escrita
- [x] CSRF em todo POST
- [x] limite de tentativas de login persistente
- [x] painel só no host do painel; domínios de links não expõem login
- [x] CSP sem inline, X-Frame-Options DENY, nosniff
- [ ] confirmar no ar: domínio próprio + HTTPS (primeiro deploy real)
