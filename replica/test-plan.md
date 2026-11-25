# Plano de testes

Automático: `python3 tests/test_core.py` (14 testes de regras) e `python3 tests/test_e2e.py` (23 testes no Chrome, servidor real).

| caso | o que garante | auto |
| --- | --- | --- |
| F01-H1 | criar link, copiar automático, redirect 302 com query repassada, clique contado | sim |
| F01-H2 | final aleatório com 6 caracteres sem ambíguos | sim |
| F01-E1 | final duplicado (sem diferenciar maiúsculas) mostra erro e mantém o formulário | sim |
| F01-E2 | `javascript:` recusado, nada criado | sim |
| F01-E3 | final reservado (`login`) recusado | sim |
| F01-E4 | duplo clique em Criar gera um link só | sim |
| F01-E5 | criar só com teclado | sim |
| F01-E6 | Esc fecha o painel | sim |
| F02-E1 | WhatsApp, Facebook, Telegram redirecionam mas não contam | sim |
| F02-E2 | HEAD não conta | sim |
| F02-E3 | final inexistente = 404; redirect com `no-store` | sim |
| F03-H1 | 15 trocas seguidas de destino, a última vale (edições ilimitadas) | sim |
| F03-H2 | apagar link: passa a dar 404 | sim |
| F04-H1 | domínio próprio: pendente → verificar → ativo → link funciona nele, painel invisível nele, fallback, Caddy aprova, não remove domínio com links | sim |
| F04-E1 | IP não é aceito como domínio | sim |
| F04-E2 | DNS apontando para outro IP explica o que encontrou | sim |
| F04-E3 | endpoint do Caddy recusa domínio desconhecido | sim |
| F05-H1 | estatísticas: total, 30 dias, robôs separados | sim |
| F08-H1 | busca e busca sem resultado | sim |
| N1 | deslogado: sem acesso, sem POST, /setup some | sim |
| N2 | senha errada e bloqueio após 10 tentativas | sim |
| N3 | CSP sem inline e X-Frame-Options | sim |
| L1 | 390px sem rolagem lateral | sim |
| M1 | HTTPS real num domínio novo (Caddy) | manual, no servidor |
| M2 | clique de verdade pelo Instagram/WhatsApp no celular | manual |
