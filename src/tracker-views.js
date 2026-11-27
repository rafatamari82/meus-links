// Tracker screens: Resultados, Vendas, Integrações.
import { csrfField, fieldError, fmtDateTime, html, page, raw } from "./views.js";
import { countryName } from "./core.js";

const flag = (cc) => (/^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0))) : "");
const place = (cc) => (cc && cc !== "XX" ? `${flag(cc)} ${countryName(cc)}` : "");
import { AGE_LABEL, convert, fmtMoney, GENDER_LABEL, googleAdsScript, NETWORKS, renderTemplate, SAMPLE_VARS, SOURCES, TEMPLATE_VARS } from "./tracker.js";

const SOURCE_LABEL = { ...SOURCES, none: "Sem rastreio" };
const TYPE_LABEL = { sale: "Venda", upsell: "Upsell", refund: "Reembolso", chargeback: "Chargeback" };
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "—");
const ratio = (x) => (x == null ? "—" : `${x.toFixed(2).replace(".", ",")}x`);
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const hhmm = (iso) => new Date(Date.parse(iso) - 3 * 36e5).toISOString().slice(11, 16);
const RANGE_LABEL = { today: "Hoje", yesterday: "Ontem", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", month: "Este mês", all: "Tudo" };

function rangeForm(range, extra = {}) {
  const opt = (v, l) => html`<option value="${v}" ${range.preset === v ? raw("selected") : ""}>${l}</option>`;
  return html`
<form class="filters" method="get" data-range>
  ${Object.entries(extra).map(([k, v]) => (v ? html`<input type="hidden" name="${k}" value="${v}">` : ""))}
  <label class="sr-only" for="p">Período</label>
  <select id="p" name="p" data-range-preset>
    ${opt("today", "Hoje")}${opt("yesterday", "Ontem")}${opt("7d", "Últimos 7 dias")}${opt("30d", "Últimos 30 dias")}${opt("month", "Este mês")}${opt("all", "Tudo")}${opt("custom", "Escolher datas")}
  </select>
  <span class="range-custom" ${range.preset === "custom" ? "" : raw("hidden")}>
    <label class="sr-only" for="from">De</label><input id="from" name="from" type="date" value="${range.from}">
    <label class="sr-only" for="to">Até</label><input id="to" name="to" type="date" value="${range.to}">
    <button class="btn btn-secondary" type="submit">Ver</button>
  </span>
  <noscript><button class="btn btn-secondary" type="submit">Ver</button></noscript>
</form>`;
}

function stat(label, value, tone = "") {
  return html`<div class="card pad stat"><p class="stat-label">${label}</p><p class="stat-value ${tone}">${value}</p></div>`;
}

// "Desempenho": running totals of this period (lines) against the period before (soft areas), two axes.
function perfChart(sr, cur, keep) {
  const W = 1000, H = 300, L = 72, R = 72, T = 16, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const second = sr.metric === "rc"
    ? { key: "cost", name: "Gasto", money: true }
    : { key: "sales", name: "Vendas", money: false };
  const run = (arr, key) => { let s = 0; return arr.map((x) => (s += x[key] || 0)); };
  const cRev = run(sr.cur, "rev"), c2 = run(sr.cur, second.key);
  const pRev = sr.prev ? run(sr.prev, "rev") : [], p2 = sr.prev ? run(sr.prev, second.key) : [];
  const n = Math.max(sr.cur.length, sr.prev ? sr.prev.length : 0, 2);
  const nice = (v) => {
    if (v <= 0) return 1;
    const e = 10 ** Math.floor(Math.log10(v)), f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  };
  const maxL = nice(Math.max(1, ...cRev, ...pRev));
  // Sales are whole numbers: the right axis steps by 1, 2, 5, 10... so every tick is an integer.
  const intStep = (v) => { const s = Math.max(1, Math.ceil(v / 4)); const e = 10 ** Math.floor(Math.log10(s)); const f = s / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
  const maxR = second.money ? nice(Math.max(1, ...c2, ...p2)) : 4 * intStep(Math.max(4, ...c2, ...p2));
  const x = (i) => L + (pw * i) / (n - 1);
  const yL = (v) => T + ph - (ph * Math.max(0, v)) / maxL;
  const yR = (v) => T + ph - (ph * Math.max(0, v)) / maxR;
  const line = (vals, y) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = (vals, y) => (vals.length ? `${line(vals, y)} L${x(vals.length - 1).toFixed(1)} ${T + ph} L${x(0).toFixed(1)} ${T + ph} Z` : "");
  const short = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(".", ",")} mi` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(".", ",")} mil` : String(Math.round(v)));
  const money = (cents) => short(cents / 100);
  const ticks = [0, 1, 2, 3, 4];
  const label = (k) => (sr.hourly ? `${k.slice(11)}h` : sr.byDayOfMonth ? k.slice(8, 10) : `${k.slice(8, 10)}/${k.slice(5, 7)}`);
  const keys = sr.cur.length >= (sr.prev?.length || 0) ? sr.cur.map((p) => p.k) : sr.prev.map((p) => p.k);
  const step = Math.max(1, Math.ceil(n / 12));
  const totCur = { rev: cRev.at(-1) || 0, two: c2.at(-1) || 0 };
  const totPrev = { rev: pRev.at(-1) || 0, two: p2.at(-1) || 0 };
  const fmt2 = (v) => (second.money ? fmtMoney(v, cur) : String(v));
  const empty = !totCur.rev && !totCur.two && !totPrev.rev && !totPrev.two;
  return html`<section class="card desktop-only perf">
  <div class="perf-head"><h2 class="h-md">Desempenho</h2></div>
  <form class="perf-ctrl" method="get" action="/results">
    ${Object.entries(keep).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <label for="perf-m">Métricas</label>
    <select id="perf-m" name="chart" data-autosubmit-select>
      <option value="rv" ${sr.metric === "rv" ? raw("selected") : ""}>Faturamento e vendas</option>
      <option value="rc" ${sr.metric === "rc" ? raw("selected") : ""}>Faturamento e gasto</option>
    </select>
    <span class="perf-time"><strong>Tempo</strong> ${sr.curLabel}${sr.prev ? ` x ${sr.prevLabel}` : ""}</span>
    <noscript><button class="btn btn-secondary btn-sm" type="submit">Ver</button></noscript>
  </form>
  ${empty ? html`<p class="muted pad">Sem vendas nem gasto neste período.</p>` : html`
  <svg class="perf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Faturamento e ${second.name.toLowerCase()} acumulados, ${sr.curLabel}${sr.prev ? ` comparado com ${sr.prevLabel}` : ""}">
    ${ticks.map((i) => { const yy = T + ph - (ph * i) / 4; return html`<line class="perf-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>
    <text class="perf-axl" x="${L - 10}" y="${yy + 4}" text-anchor="end">${money((maxL * i) / 4)}</text>
    <text class="perf-axr" x="${W - R + 10}" y="${yy + 4}">${second.money ? money((maxR * i) / 4) : short((maxR * i) / 4)}</text>`; })}
    ${keys.map((k, i) => (i % step === 0 || i === keys.length - 1) && (i === keys.length - 1 ? true : keys.length - 1 - i >= step / 2) ? html`<text class="perf-axx" x="${x(i)}" y="${H - 14}" text-anchor="middle">${label(k)}</text>` : "")}
    ${sr.prev ? html`<path class="perf-area-2" d="${area(p2, yR)}"/><path class="perf-area-1" d="${area(pRev, yL)}"/>` : ""}
    <path class="perf-line-2" d="${line(c2, yR)}"/>
    <path class="perf-line-1" d="${line(cRev, yL)}"/>
    ${cRev.length ? html`<circle class="perf-end-2" cx="${x(c2.length - 1).toFixed(1)}" cy="${yR(c2.at(-1)).toFixed(1)}" r="4"/><circle class="perf-end-1" cx="${x(cRev.length - 1).toFixed(1)}" cy="${yL(cRev.at(-1)).toFixed(1)}" r="4"/>` : ""}
    ${sr.cur.map((p, i) => html`<circle class="perf-dot" cx="${x(i).toFixed(1)}" cy="${yL(cRev[i]).toFixed(1)}" r="9"><title>${label(p.k)}: faturamento ${fmtMoney(cRev[i], cur)} · ${second.name.toLowerCase()} ${fmt2(c2[i])}${sr.prev && sr.prev[i] ? ` (antes: ${fmtMoney(pRev[i], cur)} · ${fmt2(p2[i])})` : ""}</title></circle>`)}
    <text class="perf-axt" transform="translate(16 ${T + ph / 2}) rotate(-90)" text-anchor="middle">Faturamento</text>
    <text class="perf-axt perf-axt-2" transform="translate(${W - 14} ${T + ph / 2}) rotate(90)" text-anchor="middle">${second.name}</text>
  </svg>
  <div class="perf-legend">
    <span><i class="lg lg-line-1"></i>Faturamento ${sr.curLabel.toLowerCase()}</span>
    ${sr.prev ? html`<span><i class="lg lg-area-1"></i>Faturamento ${sr.prevLabel.toLowerCase()}</span>` : ""}
    <span><i class="lg lg-line-2"></i>${second.name} ${sr.curLabel.toLowerCase()}</span>
    ${sr.prev ? html`<span><i class="lg lg-area-2"></i>${second.name} ${sr.prevLabel.toLowerCase()}</span>` : ""}
  </div>
  <div class="perf-foot">
    <span>Faturamento: <strong>${fmtMoney(totCur.rev, cur)}</strong>${sr.prev ? html` <span class="muted">vs</span> <strong>${fmtMoney(totPrev.rev, cur)}</strong>` : ""}</span>
    <span>${second.name}: <strong>${fmt2(totCur.two)}</strong>${sr.prev ? html` <span class="muted">vs</span> <strong>${fmt2(totPrev.two)}</strong>` : ""}</span>
  </div>`}
</section>`;
}

export function resultsView(c, { s, range, byAd, srcFilter, netFilter = "", prodFilter = "", list, tot, series, hasAny, sources = [], networks = [], products = [], productNames = [], money = {}, audience = { age: [], gender: [] } }) {
  const cur = s.currency;
  const m = (x) => (x == null ? "—" : fmtMoney(x, cur));
  const tab = (label, params, on) => html`<a class="tab ${on ? "is-current" : ""}" href="/results?${new URLSearchParams(params)}" ${on ? raw('aria-current="page"') : ""}>${label}</a>`;
  const base = { p: range.preset, ...(range.preset === "custom" ? { from: range.from, to: range.to } : {}), ...(netFilter ? { network: netFilter } : {}), ...(prodFilter ? { product: prodFilter } : {}) };
  const withBy = byAd ? { by: "ad" } : {};
  const withSrc = srcFilter ? { source: srcFilter } : {};
  const empty = !hasAny ? html`
<div class="empty card">
  <h2 class="h-lg">Comece a rastrear</h2>
  <p class="muted">1. Em um link, abra “Rastrear vendas” e escolha a rede. 2. Cole a URL de postback na rede (aba Integrações). 3. Use o link no anúncio com o modelo de rastreamento do Google Ads ou da NewsBreak.</p>
  <a class="btn btn-primary" href="/integrations">Abrir Integrações</a>
</div>` : "";
  const opt = (v, l, cur2) => html`<option value="${v}" ${v === cur2 ? raw("selected") : ""}>${l}</option>`;
  const srcOpts = ["google", "newsbreak", ...sources.filter((x) => !["google", "newsbreak", "none"].includes(x))];
  const roi = tot.cost ? tot.profit / tot.cost : null;
  const margin = tot.revenue > 0 ? tot.profit / tot.revenue : null;
  const ticket = tot.sales ? Math.round((money.gross || 0) / tot.sales) : null;
  const card = (label, value, hint, tone = "") => html`<div class="mcard">
    <p class="mcard-label">${label}${hint ? html` <span class="info" title="${hint}" aria-label="${hint}">i</span>` : ""}</p>
    <p class="mcard-value ${tone}">${value}</p></div>`;
  const pctTxt = (x) => (x == null ? "—" : `${(x * 100).toFixed(1).replace(".", ",")}%`);
  const tone = (x) => (x == null ? "" : x < 0 ? "neg" : x > 0 ? "pos" : "");
  const maxProd = Math.max(1, ...products.map((x) => Math.abs(x.revenue)));
  const maxNet = Math.max(1, ...networks.map((x) => Math.abs(x.revenue)));
  return page({ ...c, section: "results" }, "Resumo", html`
<header class="page-head dash-head">
  <div><h1 class="h-xl">Resumo</h1><p class="muted">${RANGE_LABEL[range.preset] || `${ddmm(range.from)} a ${ddmm(range.to)}`} · valores em ${cur} · dólar R$ ${Number(s.usd_brl).toFixed(2).replace(".", ",")}${s.rate_at ? ` (${hhmm(s.rate_at)})` : " (não atualizado)"}</p></div>
  <div class="refresh-box"><span class="muted small">Atualizado às ${hhmm(new Date().toISOString())}</span>
  <a class="btn btn-primary" href="/results?${new URLSearchParams({ ...base, ...(srcFilter ? { source: srcFilter } : {}), ...(byAd ? { by: "ad" } : {}), refresh: "1" })}">Atualizar</a></div>
</header>
${empty}
<form class="card pad dash-filters" method="get" data-range>
  ${byAd ? html`<input type="hidden" name="by" value="ad">` : ""}
  <div class="field"><label for="p">Período</label>
    <select id="p" name="p" data-range-preset data-autosubmit-select>
      ${opt("today", "Hoje", range.preset)}${opt("yesterday", "Ontem", range.preset)}${opt("7d", "Últimos 7 dias", range.preset)}${opt("30d", "Últimos 30 dias", range.preset)}${opt("month", "Este mês", range.preset)}${opt("all", "Tudo", range.preset)}${opt("custom", "Escolher datas", range.preset)}
    </select>
    <span class="range-custom" ${range.preset === "custom" ? "" : raw("hidden")}>
      <label class="sr-only" for="from">De</label><input id="from" name="from" type="date" value="${range.from}">
      <label class="sr-only" for="to">Até</label><input id="to" name="to" type="date" value="${range.to}">
      <button class="btn btn-secondary btn-sm" type="submit">Ver</button>
    </span></div>
  <div class="field desktop-only"><label for="f-source">Fonte de tráfego</label>
    <select id="f-source" name="source" data-autosubmit-select>${opt("", "Todas", srcFilter)}${srcOpts.map((x) => opt(x, SOURCE_LABEL[x] || x, srcFilter))}${opt("none", "Sem rastreio", srcFilter)}</select></div>
  <div class="field desktop-only"><label for="f-network">Plataforma</label>
    <select id="f-network" name="network" data-autosubmit-select>${opt("", "Todas", netFilter)}${Object.entries(NETWORKS).filter(([k]) => k !== "other").map(([k, n]) => opt(k, n.name, netFilter))}</select></div>
  <div class="field desktop-only"><label for="f-product">Produto</label>
    <select id="f-product" name="product" data-autosubmit-select>${opt("", "Todos", prodFilter)}${productNames.map((x) => opt(x, x, prodFilter))}</select></div>
  <noscript><button class="btn btn-secondary" type="submit">Filtrar</button></noscript>
</form>

<div class="m-kpis mobile-only">
  <div class="m-kpi m-kpi-hero"><p class="m-kpi-label">Faturamento</p><p class="m-kpi-value">${m(tot.revenue)}</p></div>
  <div class="m-kpi m-kpi-dark"><p class="m-kpi-label">Vendas</p><p class="m-kpi-value">${tot.sales}</p></div>
  <div class="m-kpi m-kpi-outline"><p class="m-kpi-label">Reembolsos</p><p class="m-kpi-value">${tot.refunds}</p></div>
</div>
${networks.length ? html`<div class="net-cards mobile-only">${networks.map((n) => html`
  <a class="net-card" href="/sales?${new URLSearchParams({ ...base, network: n.network })}">
    <span class="net-name">${netBrand(n.network, c.assetVersion)}</span>
    <span class="net-value">${m(n.revenue)}</span>
    <span class="net-sub">${n.sales} ${n.sales === 1 ? "venda" : "vendas"} · ${n.refunds} reembolso(s)</span>
    <svg class="net-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
  </a>`)}</div>` : ""}
<a class="add-platform mobile-only" href="/platforms"><span aria-hidden="true">+</span> adicionar plataforma</a>

<div class="mgrid mgrid-main desktop-only">
  <div class="mcard mcard-hero"><p class="mcard-label">Faturamento líquido</p><p class="mcard-value">${m(tot.revenue)}</p><p class="mcard-sub">${tot.sales} ${tot.sales === 1 ? "venda" : "vendas"}${tot.refunds ? ` · ${tot.refunds} reembolso(s)` : ""}</p></div>
  ${card("Gastos com anúncios", m(tot.cost), netFilter || prodFilter ? "O gasto é por campanha e não é dividido por plataforma ou produto." : "Soma do gasto das campanhas no período.")}
  ${card("ROAS", ratio(tot.roas), "Faturamento líquido dividido pelo gasto.")}
  ${card("Lucro", m(tot.profit), "Faturamento líquido menos o gasto.", tone(tot.profit))}
</div>

<div class="dash-split desktop-only">
  <div class="dash-side">
    <section class="card pad">
      <h2 class="h-md">Vendas por produto</h2>
      ${products.length ? html`<ul class="rank">${products.map((x) => html`<li>
        <a href="/results?${new URLSearchParams({ ...base, product: x.product, ...(srcFilter ? { source: srcFilter } : {}) })}" class="rank-row">
          <span class="rank-name">${x.product || "Sem nome do produto"}</span><span class="rank-val">${m(x.revenue)}</span></a>
        <svg class="rank-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="6" rx="3" class="rank-bg"/><rect width="${Math.max(2, Math.round((Math.abs(x.revenue) / maxProd) * 100))}" height="6" rx="3" class="rank-fg"/></svg>
        <span class="hint">${x.sales} ${x.sales === 1 ? "venda" : "vendas"}</span></li>`)}</ul>`
    : html`<p class="muted">Nenhuma venda por aqui.</p>`}
    </section>
    <section class="card pad">
      <div class="row-between"><h2 class="h-md">Vendas por plataforma</h2><a class="small" href="/platforms">+ adicionar plataforma</a></div>
      ${networks.some((n) => n.sales || n.refunds) ? html`<ul class="rank">${networks.filter((n) => n.sales || n.refunds).map((n) => html`<li>
        <a href="/sales?${new URLSearchParams({ ...base, network: n.network })}" class="rank-row">
          <span class="rank-name">${NETWORKS[n.network]?.name || n.network}</span><span class="rank-val">${m(n.revenue)}</span></a>
        <svg class="rank-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="6" rx="3" class="rank-bg"/><rect width="${Math.max(2, Math.round((Math.abs(n.revenue) / maxNet) * 100))}" height="6" rx="3" class="rank-fg"/></svg>
        <span class="hint">${n.sales} ${n.sales === 1 ? "venda" : "vendas"} · ${n.refunds} reembolso(s)</span></li>`)}</ul>`
    : html`<p class="muted">Nenhuma venda por aqui.</p>`}
    </section>
  </div>
  <div class="mgrid mgrid-sec">
    ${card("Vendas", String(tot.sales), "Vendas e upsells aprovados no período.")}
    ${card("Ticket médio", m(ticket), "Valor médio de cada venda, antes de reembolsos.")}
    ${card("CPA", m(tot.cpa), "Gasto dividido pelo número de vendas.")}
    ${card("ROI", pctTxt(roi), "Lucro dividido pelo gasto.", tone(roi))}
    ${card("Margem", pctTxt(margin), "Lucro dividido pelo faturamento líquido.", tone(margin))}
    ${card("Cliques", String(tot.clicks), "Cliques nos links rastreados.")}
    ${card("Conversão", pct(tot.trackedSales, tot.clicks), "Vendas rastreadas divididas pelos cliques.")}
    ${card("Vendas reembolsadas", m(money.refunded || 0), "Valor devolvido em reembolsos no período.")}
    ${card("Reembolso", pct(money.refundN || 0, tot.sales), "Reembolsos divididos pelas vendas.")}
    ${card("Chargeback", pct(money.chargeN || 0, tot.sales), "Chargebacks divididos pelas vendas.")}
  </div>
</div>

${perfChart(series, cur, { ...base, ...withSrc, ...withBy })}
${audienceSection(audience, m, cur)}
<section class="card table-wrap desktop-only">
  <div class="table-head">
    <nav class="tabs" aria-label="Agrupar por">
      ${tab("Campanhas", { ...base, ...withSrc }, !byAd)}${tab("Anúncios", { ...base, ...withSrc, by: "ad" }, byAd)}
    </nav>

  </div>
  ${list.length ? html`
  <table class="links-table results-table">
    <thead><tr><th scope="col">${byAd ? "Anúncio" : "Campanha"}</th><th scope="col" class="num">Cliques</th><th scope="col" class="num">Vendas</th>
      <th scope="col" class="num">Conv.</th><th scope="col" class="num">Faturamento</th><th scope="col" class="num">Gasto</th>
      <th scope="col" class="num">Lucro</th><th scope="col" class="num">ROAS</th><th scope="col" class="num">CPA</th></tr></thead>
    <tbody>${list.map((r) => html`
      <tr>
        <td data-label="${byAd ? "Anúncio" : "Campanha"}"><div class="link-title">${(byAd ? r.ad : r.name) || (r.source === "none" ? "Vendas sem clique rastreado" : "(sem nome)")}</div>
          <div class="hint">${SOURCE_LABEL[r.source] || r.source}${byAd && r.name ? ` · ${r.name}` : ""}${r.refunds ? ` · ${r.refunds} reembolso(s)` : ""}</div></td>
        <td data-label="Cliques" class="num">${r.clicks}</td>
        <td data-label="Vendas" class="num">${r.sales}</td>
        <td data-label="Conv." class="num">${pct(r.sales, r.clicks)}</td>
        <td data-label="Faturamento" class="num">${m(r.revenue)}</td>
        <td data-label="Gasto" class="num">${m(r.cost)}</td>
        <td data-label="Lucro" class="num ${r.profit < 0 ? "neg" : r.profit > 0 ? "pos" : ""}">${m(r.profit)}</td>
        <td data-label="ROAS" class="num">${ratio(r.roas)}</td>
        <td data-label="CPA" class="num">${m(r.cpa)}</td>
      </tr>`)}</tbody>
  </table>
  ${byAd ? html`<p class="hint pad-x">O gasto vem por campanha, então na visão por anúncio aparecem só cliques e vendas.</p>` : ""}`
    : html`<p class="muted pad">Nada neste período.</p>`}
</section>`);
}

function audienceSection(audience, m) {
  const any = audience.age.length || audience.gender.length;
  const table = (title, rows, labels) => {
    const order = Object.keys(labels);
    rows = [...rows].sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
    const total = rows.reduce((a, r) => a + r.cost, 0) || 1;
    return html`<div class="aud-col"><h3 class="h-md">${title}</h3>
    <table class="simple aud-table"><thead><tr><th scope="col">${title === "Idade" ? "Faixa" : "Sexo"}</th><th scope="col" class="num">Gasto</th><th scope="col" class="num">Cliques</th><th scope="col" class="num">Conversões</th><th scope="col" class="num">Custo/conv.</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td>${labels[r.bucket] || r.bucket}<svg class="rank-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="6" rx="3" class="rank-bg"/><rect width="${Math.max(2, Math.round((r.cost / total) * 100))}" height="6" rx="3" class="rank-fg"/></svg></td>
      <td class="num">${m(r.cost)}<div class="hint">${Math.round((r.cost / total) * 100)}%</div></td>
      <td class="num">${r.clicks}</td>
      <td class="num">${(Math.round(r.conv * 10) / 10).toString().replace(".", ",")}</td>
      <td class="num">${r.conv >= 0.5 ? m(Math.round(r.cost / r.conv)) : "—"}</td></tr>`)}</tbody></table></div>`;
  };
  return html`<section class="card pad desktop-only" id="publico">
  <h2 class="h-md">Público do Google Ads: idade e sexo</h2>
  ${any ? html`<p class="hint">Dados do próprio Google, no período escolhido. As conversões são as que o Google registrou, incluindo as vendas que o Cutti envia para ele.</p>
  <div class="aud-grid">${table("Idade", audience.age, AGE_LABEL)}${table("Sexo", audience.gender, GENDER_LABEL)}</div>`
    : html`<p class="muted">Ainda sem dados. Copie de novo o script em <a href="/tracking">Trackeamento</a> e cole no Google Ads por cima do antigo: a versão nova também manda idade e sexo.</p>`}
</section>`;
}

const netMark = (name) => html`<span class="net-mark" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>`;
// Official logos sent by the owner (static/net-<key>.png); the others show an initial and the name.
const NET_LOGOS = new Set(["hotmart", "kiwify", "clickbank", "buygoods", "digistore24", "maxweb", "gurumedia", "smartadv", "smashloud", "clickadv", "medisscalers"]);
const netBrand = (k, v) => {
  const name = NETWORKS[k]?.name || k;
  return NET_LOGOS.has(k)
    ? html`<img class="net-logo nl-${k}" src="/static/net-${k}.png?v=${v}" alt="${name}">`
    : html`${netMark(name)}<span>${name}</span>`;
};

export function platformsView(c, { selected }) {
  const nets = Object.entries(NETWORKS).filter(([k]) => k !== "other");
  return page({ ...c, section: "results" }, "Adicionar plataforma", html`
<nav class="crumbs"><a href="/results">‹ Dashboard</a></nav>
<header class="page-head"><div><h1 class="h-xl">Adicionar plataforma</h1><p class="muted">Toque nas plataformas que você usa. Elas aparecem no Dashboard e ganham o postback pronto.</p></div></header>
<form method="post" action="/platforms" class="plat-form">
  ${csrfField(c)}
  <div class="plat-grid">${nets.map(([k, n]) => html`
    <label class="plat-tile">
      <input type="checkbox" name="net" value="${k}" ${selected.includes(k) ? raw("checked") : ""}>
      <span class="plat-name">${netBrand(k, c.assetVersion)}</span>
      <span class="plat-check" aria-hidden="true">✓</span>
    </label>`)}</div>
  <div class="plat-bar"><button class="btn btn-primary btn-block plat-next" type="submit">Avançar</button></div>
</form>`);
}

export function platformsSetupView(c, { s, base, selected, added }) {
  const pb = (k) => {
    const n = NETWORKS[k];
    return n.json ? `${base}/pb/${s.key}/${k}` : `${base}/pb/${s.key}/${k}?${n.query}`;
  };
  const show = added.length ? added : selected;
  return page({ ...c, section: "results" }, "Configurar plataformas", html`
<nav class="crumbs"><a href="/platforms">‹ Plataformas</a></nav>
<header class="page-head"><div><h1 class="h-xl">${added.length ? "Falta só o postback" : "Postbacks das plataformas"}</h1>
  <p class="muted">Copie a URL de cada plataforma e cole no painel dela. É assim que a venda chega no Cutti.</p></div></header>
${show.map((k) => html`<section class="card pad plat-setup">
  <h2 class="h-md">${netBrand(k, c.assetVersion)}</h2>
  <div class="copy-row"><input value="${pb(k)}" readonly aria-label="URL de postback ${NETWORKS[k].name}" spellcheck="false"><button class="btn btn-secondary btn-sm" type="button" data-copy="${pb(k)}">Copiar</button></div>
  <p class="hint">${WHERE[k] || ""}</p>
  <p class="hint">No link do anúncio: abra o link no Encurtador, ligue <strong>Rastrear vendas</strong> e escolha ${NETWORKS[k].name}.</p>
</section>`)}
<div class="plat-bar"><a class="btn btn-primary btn-block" href="/results">Concluir</a></div>`);
}

export function salesView(c, { s, range, sales, events, network = "", days = {}, today = "" }) {
  return page({ ...c, section: "sales" }, "Vendas", html`
<header class="page-head">
  <div><h1 class="h-xl">Vendas</h1><p class="muted">${sales.length} registro(s) · ${RANGE_LABEL[range.preset] || `${ddmm(range.from)} a ${ddmm(range.to)}`}</p></div>
  ${rangeForm(range, network ? { network } : {})}
</header>
${network ? html`<p><a class="chip-filter" href="/sales?${new URLSearchParams({ p: range.preset, ...(range.preset === "custom" ? { from: range.from, to: range.to } : {}) })}">${NETWORKS[network]?.name || network} <span aria-hidden="true">✕</span><span class="sr-only">tirar filtro</span></a></p>` : ""}
${sales.length ? html`<ul class="sale-list" aria-label="Vendas">${sales.map((v) => {
  const neg = v.type === "refund" || v.type === "chargeback";
  const net = NETWORKS[v.network]?.name || v.network;
  const day = days[v.day];
  const isToday = v.day === today;
  const rows = [
    ["Produto", v.product], ["Valor", `${neg ? "−" : ""}${fmtMoney(v.amount_cents, v.currency)}`],
    ["Em reais", v.currency !== "BRL" ? `${neg ? "−" : ""}${fmtMoney(convert(v.amount_cents, v.currency, "BRL", s), "BRL")}` : ""],
    ["Rede", net], ["País", place(v.country) || "Não informado"], ["Origem", v.click_id ? SOURCE_LABEL[v.source] || v.source : "Sem clique rastreado"],
    ["Campanha", v.campaign], ["Anúncio", v.ad], ["Palavra-chave", v.keyword], ["Pedido", v.txid], ["Data", fmtDateTime(v.at)],
    [isToday ? "Vendas hoje" : "Vendas no dia", day ? String(day.sales) : ""],
    [isToday ? "Faturamento hoje" : "Faturamento no dia", day ? fmtMoney(day.revenue, s.currency) : ""],
  ].filter(([, x]) => x);
  return html`<li class="sale-item"><details class="sale-details">
    <summary class="sale-sum">
      <div class="sale-main">
        <strong>${v.product || net}</strong>
        <span class="hint">${fmtDateTime(v.at)} · ${net}<span class="sale-more">${place(v.country) ? ` · ${place(v.country)}` : ""}${v.click_id ? ` · ${SOURCE_LABEL[v.source] || v.source}` : ""}</span></span>
      </div>
      <div class="sale-side">
        <span class="sale-amount ${neg ? "neg" : ""}">${neg ? "−" : ""}${fmtMoney(v.amount_cents, v.currency)}</span>
        <span class="badge ${neg ? "badge-warning" : "badge-success"}">${TYPE_LABEL[v.type]}</span>
      </div>
    </summary>
    <dl class="sale-facts">${rows.map(([k, x]) => html`<div><dt>${k}</dt><dd>${x}</dd></div>`)}</dl>
    <div class="sale-foot"><form method="post" action="/sales/${v.id}/delete" data-confirm="Remover este registro? Ele sai dos resultados.">${csrfField(c)}<button class="btn btn-ghost btn-xs danger-text" type="submit">Remover registro</button></form></div>
  </details></li>`;
})}</ul>` : ""}
${sales.length ? "" : html`<section class="card"><p class="muted pad">Nenhuma venda neste período.</p></section>`}
<details class="card pad events-box">
  <summary class="h-lg">Últimos avisos recebidos</summary>
  <p class="hint">Tudo o que as redes e o Google Ads mandaram, inclusive o que foi ignorado. Use para conferir se a integração está certa.</p>
  ${events.length ? html`<table class="simple events"><tbody>${events.map((e) => html`
    <tr><td class="nowrap">${fmtDateTime(e.at)}</td><td>${NETWORKS[e.network]?.name || e.network}</td>
      <td><span class="badge ${e.outcome === "ok" ? "badge-success" : "badge-warning"}">${e.outcome}</span></td>
      <td>${e.detail}${e.raw ? html`<details class="raw"><summary>ver dados</summary><pre>${e.raw}</pre></details>` : ""}</td></tr>`)}</tbody></table>`
    : html`<p class="muted">Nada recebido ainda.</p>`}
</details>`);
}

function copyBox(id, label, value, rows = 0) {
  return html`<div class="field">
  <label for="${id}">${label}</label>
  <div class="copy-row">
    ${rows ? html`<textarea id="${id}" rows="${rows}" readonly spellcheck="false">${value}</textarea>`
    : html`<input id="${id}" value="${value}" readonly spellcheck="false">`}
    <button class="btn btn-secondary btn-sm" type="button" data-copy="${value}">Copiar</button>
  </div>
</div>`;
}

export function trackingView(c, { s, base, linkDomain, costCount, settingsError, csvError, csvValue, costError, google, gErrors }) {
  const pb = (net) => `${base}/pb/${s.key}/${net}`;
  const last = (src) => costCount.find((x) => x.source === src);
  const curOpt = (v, sel) => html`<option ${v === sel ? raw("selected") : ""}>${v}</option>`;
  const gTemplate = `https://${linkDomain}/SEU-LINK?src=google&cmp={campaignid}&adg={adgroupid}&ad={creative}&kw={keyword}&gclid={gclid}&lp={lpurl}`;
  const nbUrl = `https://${linkDomain}/SEU-LINK?src=newsbreak&cmp=__CAMPAIGN_NAME__&adg=__FLIGHT_NAME__&ad=__CREATIVE_NAME__&nbcb=__CALLBACK_PARAM__`;
  return page({ ...c, section: "tracking" }, "Trackeamento", html`
<header class="page-head"><div><h1 class="h-xl">Trackeamento</h1><p class="muted">Como o clique do anúncio chega até a venda, e a venda volta para o anúncio.</p></div></header>

<section class="card pad">
  <h2 class="h-lg">Como funciona</h2>
  <ol class="steps">
    <li>Crie ou edite um link e abra <strong>Rastrear vendas</strong>. Escolha a rede: o link passa a gerar um código por clique (começa com <code>ct</code>) e manda esse código para a rede no parâmetro certo.</li>
    <li>Cole a <strong>URL de postback</strong> da rede (logo abaixo) no painel da rede. Quando sai uma venda, a rede devolve o código e a comissão.</li>
    <li>Use o link no anúncio com o modelo do Google Ads ou da NewsBreak, e mande o gasto para cá. Pronto: lucro por campanha em Resultados.</li>
  </ol>
  <p class="hint">Se você usa presell, cole este script na presell. Ele passa o código para os links da oferta: <code>&lt;script src="${base}/t.js" data-param="tid" defer&gt;&lt;/script&gt;</code>. Troque <code>tid</code> pelo parâmetro da rede, ou coloque <code>data-param</code> em cada link.</p>
</section>

<section class="card table-wrap">
  <div class="pad"><h2 class="h-lg">Redes e plataformas</h2>
  <p class="hint">Nas redes marcadas com “conferir”, os nomes dos campos (macros) variam. Troque o que está entre chaves pelos nomes que o painel da rede mostra. O código do clique é achado mesmo se o nome do campo for outro.</p></div>
  <table class="links-table">
    <thead><tr><th scope="col">Rede</th><th scope="col">Parâmetro no link</th><th scope="col">Onde colar e o quê</th></tr></thead>
    <tbody>${Object.entries(NETWORKS).filter(([k]) => k !== "other").map(([k, n]) => {
      const url = n.json ? pb(k) : `${pb(k)}?${n.query}`;
      return html`<tr>
        <td data-label="Rede"><strong>${n.name}</strong>${n.check ? html` <span class="badge badge-warning">conferir</span>` : ""}</td>
        <td data-label="Parâmetro"><code>${n.param}</code></td>
        <td data-label="URL"><div class="copy-row"><input value="${url}" readonly aria-label="URL de postback ${n.name}" spellcheck="false"><button class="btn btn-secondary btn-xs" type="button" data-copy="${url}">Copiar</button></div>
          <p class="hint">${WHERE[k] || ""}</p></td>
      </tr>`;
    })}</tbody>
  </table>
</section>

<section class="card pad" id="google-ads">
  <h2 class="h-lg">Google Ads</h2>
  <p class="muted">Jeito fácil: um script só, colado uma vez. Ele traz o gasto e manda as vendas para o Google a cada hora. Sem Google Cloud e sem token.</p>
  <ol class="steps">
    <li><strong>Crie a conversão</strong> (uma vez): Metas → Conversões → <strong>+ Nova ação de conversão</strong> → Importar → Outras fontes de dados ou CRMs → Rastrear conversões de cliques. Nome: <strong>${s.gads_conv_name}</strong>, categoria Compra.</li>
    <li><strong>Cole o script</strong>: Ferramentas → Ações em massa → <strong>Scripts</strong> → botão + → cole o código abaixo → <strong>Autorizar</strong> → Salvar → em Frequência, escolha <strong>A cada hora</strong>.</li>
    <li><strong>Use o link rastreado</strong> no modelo de rastreamento da conta ou da campanha (logo abaixo).</li>
  </ol>
  ${copyBox("g-script", "Script do Cutti", googleAdsScript(`${base}/cost/${s.key}/google`), 10)}
  <p class="hint">${s.gscript_at ? `Script rodou pela última vez em ${fmtDateTime(s.gscript_at)}.` : "O script ainda não rodou. Depois de colar, clique em Visualizar ou Executar para testar."} Se você já tinha colado o script antigo, troque pelo novo.</p>
  <form method="post" action="/integrations/tracking-settings" class="field-row" novalidate>
    ${csrfField(c)}<input type="hidden" name="back" value="/tracking">
    <div class="field grow"><label for="gads_conv_name">Nome da conversão no Google Ads</label><input id="gads_conv_name" name="gads_conv_name" maxlength="100" value="${s.gads_conv_name}"></div>
    <input type="hidden" name="nb_postback" value="${s.nb_postback}">
    <div class="field field-end"><button class="btn btn-secondary" type="submit">Salvar</button></div>
  </form>
  <p class="hint">Tem que ser exatamente o mesmo nome da conversão criada no passo 1.</p>
  ${copyBox("g-template", "Modelo de rastreamento (no nível da conta ou da campanha)", gTemplate)}
  <p class="hint">Troque <code>SEU-LINK</code> pelo final do seu link rastreado. O URL final do anúncio continua sendo a sua página; o link precisa ter como destino a mesma página (mesmo domínio).</p>
</section>

${google ? html`<details class="card pad adv-box" ${gErrors ? raw("open") : ""}><summary class="h-lg">Avançado: conectar pela API do Google Ads</summary>
  <p class="hint">Só se você quiser as vendas no Google na hora, em vez de a cada hora. Precisa de projeto no Google Cloud e token de desenvolvedor aprovado.</p>
  ${google}</details>` : ""}

<section class="card pad">
  <h2 class="h-lg">NewsBreak</h2>
  ${copyBox("nb-url", "URL do anúncio (Landing page URL)", nbUrl)}
  <p class="hint">Troque <code>SEU-LINK</code> pelo final do seu link rastreado.</p>
  <form method="post" action="/integrations/newsbreak-csv" class="stack" novalidate>
    ${csrfField(c)}<input type="hidden" name="back" value="/tracking">
    <div class="field">
      <label for="csv">Importar gasto (CSV do relatório da NewsBreak, por dia e por campanha)</label>
      <textarea id="csv" name="csv" rows="6" spellcheck="false" placeholder="Date,Campaign Name,Spend&#10;2026-11-24,Oferta X - US,35.20" ${csvError ? raw('aria-invalid="true" aria-describedby="csv-err"') : ""}>${csvValue || ""}</textarea>
      ${fieldError("csv-err", csvError)}
      <p class="hint">Linhas repetidas só atualizam o valor. ${last("newsbreak") ? `Última importação: ${fmtDateTime(last("newsbreak").last)}.` : ""}</p>
    </div>
    <div class="field-row">
      <div class="field"><label for="csv-cur">Moeda do CSV</label><select id="csv-cur" name="currency">${["USD", "BRL", "EUR"].map((x) => curOpt(x, "USD"))}</select></div>
      <div class="field field-end"><button class="btn btn-primary" type="submit">Importar</button></div>
    </div>
  </form>
  <form method="post" action="/integrations/tracking-settings" class="stack" novalidate>
    ${csrfField(c)}<input type="hidden" name="back" value="/tracking">
    <input type="hidden" name="gads_conv_name" value="${s.gads_conv_name}">
    <div class="field">
      <label for="nb_postback">Postback da NewsBreak (a NewsBreak aprende com cada venda)</label>
      <input id="nb_postback" name="nb_postback" type="url" maxlength="1000" value="${s.nb_postback}" placeholder="https://…{clickid}…{value}" ${settingsError ? raw('aria-invalid="true" aria-describedby="nb-err"') : ""}>
      ${fieldError("nb-err", settingsError)}
      <p class="hint">Cole a URL que a NewsBreak dá em Event management e troque o lugar do click ID por <code>{clickid}</code> e o do valor por <code>{value}</code> (em dólar).</p>
    </div>
    <div class="row-end"><button class="btn btn-secondary" type="submit">Salvar postback</button></div>
  </form>
</section>

<section class="card pad">
  <h2 class="h-lg">Lançar gasto à mão</h2>
  <form method="post" action="/integrations/cost" class="field-row" novalidate>
    ${csrfField(c)}<input type="hidden" name="back" value="/tracking">
    <div class="field"><label for="c-date">Data</label><input id="c-date" name="date" type="date" required></div>
    <div class="field"><label for="c-src">Origem</label><select id="c-src" name="source"><option value="newsbreak">NewsBreak</option><option value="google">Google Ads</option><option value="other">Outros</option></select></div>
    <div class="field grow"><label for="c-camp">Campanha</label><input id="c-camp" name="campaign" maxlength="200" placeholder="Nome na NewsBreak, ou ID no Google"></div>
    <div class="field"><label for="c-amount">Valor</label><input id="c-amount" name="amount" inputmode="decimal" placeholder="35,20"></div>
    <div class="field"><label for="c-cur">Moeda</label><select id="c-cur" name="currency">${["USD", "BRL", "EUR"].map((x) => curOpt(x, "USD"))}</select></div>
    <div class="field field-end"><button class="btn btn-secondary" type="submit">Salvar</button></div>
  </form>
  ${fieldError("cost-err", costError)}
</section>

<section class="card pad narrow">
  <h2 class="h-lg">Chave secreta</h2>
  <p class="muted">Ela está em todas as URLs acima. Troque se alguém de fora a viu; depois atualize as redes e o script.</p>
  <form method="post" action="/integrations/key" data-confirm="Trocar a chave? As URLs antigas param de funcionar na hora.">
    ${csrfField(c)}<input type="hidden" name="back" value="/tracking"><button class="btn btn-ghost danger-text" type="submit">Trocar chave</button>
  </form>
</section>`);
}

export function integrationsView(c, { s, settingsError, tgError, devices = [] }) {
  const curOpt = (v, sel) => html`<option ${v === sel ? raw("selected") : ""}>${v}</option>`;
  return page({ ...c, section: "integrations" }, "Avisos e moeda", html`
<header class="page-head"><div><h1 class="h-xl">Avisos e moeda</h1><p class="muted">Notificações de venda e câmbio.</p></div></header>

${notifySection(c, s, tgError, devices)}

<section class="card pad narrow">
  <h2 class="h-lg">Moeda e câmbio</h2>
  ${settingsError ? html`<p class="alert alert-error" role="alert">${settingsError}</p>` : ""}
  <form method="post" action="/integrations/settings" class="stack" novalidate>
    ${csrfField(c)}
    <div class="field-row">
      <div class="field"><label for="currency">Mostrar valores em</label><select id="currency" name="currency">${["BRL", "USD", "EUR"].map((x) => curOpt(x, s.currency))}</select></div>
      <div class="field"><label class="check"><input type="checkbox" name="rate_auto" value="1" ${s.rate_auto ? raw("checked") : ""}> Cotação automática do dia</label>
        <p class="hint">${s.rate_at ? `Atualizada em ${fmtDateTime(s.rate_at)}.` : "Busca a cotação na próxima abertura."} Desmarque para digitar à mão.</p></div>
      <div class="field"><label for="usd_brl">1 dólar = R$</label><input id="usd_brl" name="usd_brl" inputmode="decimal" value="${String(s.usd_brl).replace(".", ",")}"></div>
      <div class="field"><label for="eur_brl">1 euro = R$</label><input id="eur_brl" name="eur_brl" inputmode="decimal" value="${String(s.eur_brl).replace(".", ",")}"></div>
    </div>
    <div class="row-end"><button class="btn btn-primary" type="submit">Salvar</button></div>
  </form>
  <form method="post" action="/integrations/awesome-token" class="field-row" novalidate>
    ${csrfField(c)}
    <div class="field grow"><label for="aw-token">Chave da AwesomeAPI <span class="muted">(opcional, grátis)</span></label>
      <input id="aw-token" name="token" autocomplete="off" spellcheck="false" placeholder="${s.awesome_token ? "chave salva — cole outra para trocar" : "cole aqui"}">
      <p class="hint">Deixa o dólar ao vivo mais confiável: sem chave, a AwesomeAPI às vezes recusa por excesso de uso. Crie em awesomeapi.com.br.</p></div>
    <div class="field field-end"><button class="btn btn-secondary" type="submit">Salvar</button></div>
  </form>
</section>`);
}

const WHERE = {
  clickbank: "Integrações → Postback/Pixels → adicionar integração, evento de venda. Para reembolso, outra URL igual com &type=refund.",
  buygoods: "Profile → Postback Pixels → Add New. Vale para todas as ofertas.",
  digistore24: "Visão de afiliado → Conta → S2S Postback.",
  maxweb: "Menu → Postback Pixels → Add new. Vale para todas as ofertas.",
  gurumedia: "No painel da GuruMedia, campo de postback (no mesmo lugar do postback que você já usa). O código do clique vai em sub1.",
  smartadv: "No painel da SmartADV, campo de postback (no mesmo lugar do postback que você já usa). O código do clique vai em sub1.",
  smashloud: "No painel da SmashLoud, campo de postback (no mesmo lugar do postback que você já usa). O código do clique vai em sub1.",
  clickadv: "No painel da ClickADV, campo de postback (no mesmo lugar do postback que você já usa). O código do clique vai em sub1. O valor é a sua comissão, não o preço da venda.",
  medisscalers: "No painel da MediaScalers, campo de postback (onde está o da outra ferramenta). O código do clique vai em sub1. Conversão pendente conta como venda; se depois vier recusada, ela é descontada.",
  hotmart: "Ferramentas → Webhook → Cadastrar. Eventos: compra aprovada, reembolso, chargeback. O código vai no sck (ou src, como afiliado).",
  kiwify: "Apps → Webhooks → Criar webhook. Eventos: compra aprovada, reembolso, chargeback.",
};

function notifySection(c, s, tgError, devices) {
  const tgOn = s.tg_token && s.tg_chat;
  const any = tgOn || devices.length;
  return html`
<section class="card pad" id="avisos">
  <h2 class="h-lg">Avisos de venda no celular</h2>
  <p class="muted">Cada venda (e, se quiser, cada reembolso) chega como notificação no celular, com valor, rede e campanha. Use um jeito só ou vários.</p>
  <div class="notify-grid">
    <div class="notify-box notify-main">
      <h3 class="h-md">App Cutti ${devices.length ? html`<span class="badge badge-success">${devices.length} aparelho(s)</span>` : html`<span class="badge badge-accent">recomendado</span>`}</h3>
      <p class="hint">O próprio painel vira um app no celular, com ícone na tela de início e notificação de venda. Grátis, sem loja de apps.</p>
      <ol class="steps">
        <li><strong>iPhone:</strong> abra <code>app.cutti.us</code> no Safari, toque em Compartilhar → <strong>Adicionar à Tela de Início</strong>, e abra o Cutti pelo ícone novo.</li>
        <li><strong>Android:</strong> abra no Chrome e toque em <strong>Instalar app</strong> (ou menu ⋮ → Adicionar à tela inicial).</li>
        <li>Dentro do app, venha até aqui e toque no botão abaixo. Permita as notificações.</li>
      </ol>
      <form method="post" action="/integrations/push-subscribe" data-push data-push-key="${s.vapid.publicKey}">
        ${csrfField(c)}
        <input type="hidden" name="endpoint"><input type="hidden" name="p256dh"><input type="hidden" name="auth"><input type="hidden" name="label">
        <button class="btn btn-primary" type="button" data-push-enable>Ativar avisos neste aparelho</button>
        <p class="hint" data-push-status role="status"></p>
      </form>
      ${devices.length ? html`<table class="simple"><tbody>${devices.map((d) => html`<tr><td>${d.label || "Aparelho"}<div class="hint">ativado em ${fmtDateTime(d.created_at)}${d.last_ok_at ? ` · último aviso ${fmtDateTime(d.last_ok_at)}` : ""}</div></td>
        <td class="actions-cell"><form method="post" action="/integrations/push-delete-${d.id}">${csrfField(c)}<button class="btn btn-ghost btn-xs danger-text" type="submit">Remover</button></form></td></tr>`)}</tbody></table>` : ""}
    </div>
    <div class="notify-box">
      <h3 class="h-md">Telegram ${tgOn ? html`<span class="badge badge-success">Ligado${s.tg_name ? ` · @${s.tg_name}` : ""}</span>` : ""}</h3>
      ${tgOn ? html`
      <p class="hint">As vendas chegam como mensagem do seu bot${s.tg_name ? ` @${s.tg_name}` : ""}.</p>
      <form method="post" action="/integrations/telegram">${csrfField(c)}<input type="hidden" name="off" value="1"><button class="btn btn-ghost btn-xs danger-text" type="submit">Desligar</button></form>`
    : html`
      <ol class="steps">
        <li>No Telegram, abra o <strong>@BotFather</strong>, mande <code>/newbot</code> e escolha um nome. Ele te dá um token.</li>
        <li>Abra o seu bot novo e mande <code>/start</code>.</li>
        <li>Cole o token aqui e clique em Conectar.</li>
      </ol>
      <form method="post" action="/integrations/telegram" class="stack" novalidate>
        ${csrfField(c)}
        <div class="field">
          <label for="tg-token">Token do bot</label>
          <input id="tg-token" name="token" autocomplete="off" spellcheck="false" placeholder="${s.tg_token ? "token salvo, deixe vazio" : "123456789:ABC…"}" ${tgError ? raw('aria-invalid="true" aria-describedby="tg-err"') : ""}>
          ${fieldError("tg-err", tgError)}
        </div>
        <button class="btn btn-primary" type="submit">Conectar</button>
      </form>`}
    </div>
  </div>
  ${templateEditor(c, s)}
  <div class="row notify-foot">
    <form method="post" action="/integrations/notify-prefs" class="row">
      ${csrfField(c)}
      <label class="check"><input type="checkbox" name="refunds" value="1" ${s.notify_refunds ? raw("checked") : ""} data-autosubmit> Avisar também reembolsos e chargebacks</label>
    </form>
    ${any ? html`<form method="post" action="/integrations/notify-test">${csrfField(c)}<button class="btn btn-secondary" type="submit">Testar aviso</button></form>` : ""}
  </div>
</section>`;
}

function templateEditor(c, s) {
  const t = s.templates;
  const field = (k, label) => html`<div class="field"><label for="tpl-${k}">${label}</label>
    <input id="tpl-${k}" name="${k}" maxlength="200" value="${t[k]}" data-tpl="${k}" spellcheck="false"></div>`;
  const preview = (kind) => html`<div class="push-preview" data-preview="${kind}">
    <img src="/static/logo-192.png" alt="" width="36" height="36">
    <div><strong data-preview-title>${renderTemplate(t[`${kind}_title`], kind === "sale" ? SAMPLE_VARS : { ...SAMPLE_VARS, emoji: "↩️", tipo: "Reembolso" })}</strong>
    <span data-preview-body>${renderTemplate(t[`${kind}_body`], kind === "sale" ? SAMPLE_VARS : { ...SAMPLE_VARS, emoji: "↩️", tipo: "Reembolso" })}</span></div>
  </div>`;
  return html`
<details class="utm tpl-editor">
  <summary>Personalizar o texto do aviso</summary>
  <form method="post" action="/integrations/templates" class="stack" novalidate>
    ${csrfField(c)}
    <script type="application/json" id="tpl-sample">${raw(JSON.stringify(SAMPLE_VARS).replace(/</g, "\\u003c"))}</script>
    <div class="tpl-grid">
      <div class="stack">
        <h3 class="h-md">Venda e upsell</h3>
        ${field("sale_title", "Título")}${field("sale_body", "Texto")}
        ${preview("sale")}
      </div>
      <div class="stack">
        <h3 class="h-md">Reembolso e chargeback</h3>
        ${field("refund_title", "Título")}${field("refund_body", "Texto")}
        ${preview("refund")}
      </div>
    </div>
    <div>
      <p class="hint">Escreva o que quiser, com emojis. Clique numa variável para inserir no último campo que você tocou. Variável vazia some sozinha, junto com o “·”.</p>
      <div class="chips">${Object.entries(TEMPLATE_VARS).map(([k, d]) => html`<button type="button" class="chip" data-var="{${k}}" title="${d}">{${k}}</button>`)}</div>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" type="submit" name="reset" value="1">Voltar ao padrão</button>
      <button class="btn btn-primary" type="submit">Salvar texto</button>
    </div>
  </form>
</details>`;
}

function googleConnect(c, g) {
  if (!g) return "";
  return g;
}
