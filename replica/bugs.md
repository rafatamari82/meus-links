# Bugs

| ID | sev | o quê | status |
| --- | --- | --- | --- |
| B1 | S4 | Coluna de ações com `display:flex` direto no `<td>` quebrava as bordas da tabela | corrigido (wrapper `.actions` dentro do td) |
| B2 | S3 | Página 404 dos domínios de links ficava sem CSS (o `/static` era tratado como final de link) | corrigido |
| B3 | S3 | Teste de domínio próprio navegava para a página errada antes do fallback | corrigido no teste |

Abertos: nenhum S1 ou S2.

## A conferir
- Caddyfile não foi validado aqui (Caddy não está instalado nesta sessão). Rodar `caddy validate --config deploy/Caddyfile` no servidor.
- Navegadores headless (robôs de monitoramento) não contam clique, por desenho.
