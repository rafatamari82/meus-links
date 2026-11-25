# Componentes

Sem capturas de tela do original (o app fica atrás de login). O sistema segue padrões comuns de painel SaaS: barra lateral, tabela, painel de criação. Paleta, textos e ícones são próprios (ícones em SVG inline desenhados aqui, traço simples).

```
Button
  variants  primary, secondary, ghost, danger
  sizes     sm 32px, md 40px
  states    default, hover, active, focus-visible (anel 2px accent), disabled, loading
  tokens    primary: bg accent / on-accent, hover accent-hover; radius md; font sm/600
  a11y      <button> de verdade; loading mantém o rótulo e usa aria-busy
  used on   S01-S08

Input (texto, URL, e-mail, senha)
  variants  simples, com prefixo (domínio + "/" antes do back-half), com contador
  states    default, focus (borda accent + anel), error (borda danger + mensagem), disabled
  tokens    borda border-input, radius md, altura 40px
  a11y      <label> sempre visível; erro ligado por aria-describedby e aria-invalid
  used on   S01, S03, S04, S08

Select (domínio)
  states    default, focus, disabled
  a11y      <select> nativo
  used on   S03, S04, S02 (filtro)

LinksTable
  colunas   link curto (com Copiar), destino, cliques, criado em, ações
  states    vazia (convite para criar o primeiro link), cheia, busca sem resultado
  mobile    vira lista de cartões abaixo de 760px
  a11y      <table> com <th scope>; ações com aria-label que inclui o link
  used on   S02

Drawer (Novo link)
  states    fechado, aberto, enviando, erro de validação (fica aberto com os valores)
  tokens    largura 440px, shadow pop, bg bg
  a11y      <dialog> nativo; Esc fecha; foco vai para o primeiro campo
  used on   S03

CopyButton
  states    default, copiado (2s, "Copiado")
  a11y      anúncio por região aria-live
  used on   S02, S03

Toast
  variants  success, error
  a11y      role=status
  used on   todas

Badge (status do domínio)
  variants  ativo (success), pendente (warning), padrão (accent-soft)
  used on   S07

DnsRecord
  campos    tipo, nome, valor, botão copiar
  used on   S08

BarChart (cliques por dia)
  states    vazio ("Ainda sem cliques"), com dados
  a11y      tabela equivalente escondida para leitores de tela
  used on   S05

ConfirmDelete
  forma     <form> com confirm() nativo
  used on   S02, S07
```
