# Meus links: encurtador pessoal com domínio próprio

Seu painel para três coisas:
- criar links curtos no seu domínio;
- trocar o destino quantas vezes quiser;
- contar cliques sem robôs.

Roda de graça no Cloudflare Workers, com o banco D1. Foi feito com as skills da Replica, de forma clean-room, a partir do Rebrandly; o mapa e as decisões estão em `replica/`.

## Colocar no ar (tudo pelo navegador)

1. **GitHub:** este código num repositório seu.
2. **Cloudflare** (dash.cloudflare.com, conta grátis): **Workers & Pages → Create → Import a repository**. Conecte o GitHub e escolha o repositório. Deixe tudo como vier e clique em **Deploy**. O banco de dados é criado sozinho.
3. Abra o endereço `https://meus-links.<sua-conta>.workers.dev` e crie a conta do dono. A primeira visita abre a tela de cadastro.
   Para usar o painel num domínio seu, ajuste `APP_HOST` em `wrangler.jsonc` e conecte esse endereço em Custom domain. O endereço workers.dev continua funcionando como acesso reserva.
4. **Domínio dos links:** compre o domínio na Cloudflare (**Domain Registration → Register Domains**) ou mova um domínio que você já tem para a Cloudflare.
5. No Worker, abra **Settings → Domains & Routes → Add → Custom domain** e digite `go.seudominio.com`. A Cloudflare cria o DNS e o HTTPS sozinha.
6. No painel do app, abra **Domínios**, adicione `go.seudominio.com` e clique em **Verificar**.

Cada push no GitHub publica uma versão nova sozinho.

## Custos

O plano gratuito dá 100 mil requisições por dia, e o D1 grátis aguenta cerca de 50 mil cliques por dia. O único gasto é o domínio, cobrado por ano.

## Rodar e testar no computador (opcional)

```bash
node dev/server.mjs                # http://localhost:8787 (Node 22+, sem instalar nada)
node --test tests/core.test.mjs    # regras
python3 tests/test_e2e.py          # 25 testes no Chrome (precisa de playwright para Python)
```

Se editar algo em `static/`, rode `node tools/gen-assets.mjs`.
