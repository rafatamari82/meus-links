// Ajustes: the phone settings screen. Short on purpose; the full setup stays in Integrações (desktop).
import { csrfField, fieldError, fmtDateTime, html, page, raw } from "./views.js";
import { checkPassword, hashPassword } from "./security.js";
import { NETWORKS } from "./tracker.js";
import { freshRates, getSettings, ratesLater, setSetting } from "./tracker-routes.js";

const chev = raw('<svg class="row-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>');

export async function settingsPage(c) {
  const s = ratesLater(c, await getSettings(c.db));
  const nets = Object.keys(NETWORKS).filter((n) => n !== "other"); // every network the panel supports
  const devices = (await c.db.prepare("select count(*) as n from push_subs").first()).n;
  return c.respond(settingsView(c.view(), { s, nets, devices, email: c.user.email, emailReady: !!c.env.EMAIL, emailTo: c.env.EMAIL_TO || "" }));
}

function settingsView(c, { s, nets, devices, email, emailReady, emailTo }) {
  const sw = (action, name, on, label, extra = "") => html`
    <form method="post" action="/settings/${action}" class="set-row">
      ${csrfField(c)}${extra}
      <label class="set-switch"><span class="set-label">${label}</span>
        <input type="checkbox" role="switch" name="${name}" value="1" ${on ? raw("checked") : ""} data-autosubmit>
        <span class="switch" aria-hidden="true"></span></label>
    </form>`;
  return page({ ...c, section: "settings" }, "Ajustes", html`
<header class="page-head"><h1 class="h-xl">Ajustes</h1></header>

<h2 class="set-title">Conta</h2>
<div class="set-group">
  <div class="set-row"><span class="set-label">E-mail</span><span class="set-value muted">${email}</span></div>
  <a class="set-row" href="/settings/password"><span class="set-label">Trocar a senha</span>${chev}</a>
</div>

<h2 class="set-title">Moeda</h2>
<div class="set-group">
  <form method="post" action="/settings/currency" class="set-row set-seg">
    ${csrfField(c)}
    <span class="set-label">Mostrar valores em</span>
    <span class="seg2">
      <button type="submit" name="currency" value="BRL" class="${s.currency === "BRL" ? "is-on" : ""}" aria-pressed="${s.currency === "BRL"}">Real</button>
      <button type="submit" name="currency" value="USD" class="${s.currency === "USD" ? "is-on" : ""}" aria-pressed="${s.currency === "USD"}">Dólar</button>
    </span>
  </form>
  <div class="set-row"><span class="set-label">Dólar hoje<span class="hint">${s.rate_auto ? (s.rate_at ? `comercial · ${fmtDateTime(s.rate_at)}` : "ainda não atualizado") : "digitado à mão"}</span></span>
    <span class="set-value">R$ ${s.usd_brl.toFixed(4).replace(".", ",")}</span></div>
  ${s.rate_auto ? html`<form method="post" action="/settings/rate" class="set-row">${csrfField(c)}<span class="set-label">Cotação</span>
    <button class="btn btn-primary btn-sm btn-icon" type="submit">${raw('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>')}Atualizar agora</button></form>` : ""}
</div>
<p class="set-note">Dólar comercial do momento${s.rate_src ? ` (fonte: ${s.rate_src})` : ""}, atualizado a cada 15 minutos. Apps de banco e de câmbio podem mostrar um pouco acima, porque somam a margem deles.${s.rate_err ? ` Falhas na última busca: ${s.rate_err}.` : ""}</p>

<h2 class="set-title">Notificações de venda</h2>
<div class="set-group">
  <form method="post" action="/integrations/push-subscribe" class="set-row" data-push data-push-key="${s.vapid.publicKey}">
    ${csrfField(c)}
    <input type="hidden" name="endpoint"><input type="hidden" name="p256dh"><input type="hidden" name="auth"><input type="hidden" name="label">
    <span class="set-label">Avisos neste celular<span class="hint" data-push-status role="status">${devices ? `${devices} aparelho(s) ativado(s)` : ""}</span></span>
    <button class="btn btn-primary btn-sm" type="button" data-push-enable>Ativar</button>
  </form>
  ${nets.map((n) => sw("mute", "on", !s.notify_muted.includes(n), NETWORKS[n].name, html`<input type="hidden" name="network" value="${n}">`))}
  ${emailReady ? sw("email", "on", s.email_on, html`Aviso por e-mail<span class="hint">${emailTo}</span>`) : html`<div class="set-row"><span class="set-label">Aviso por e-mail<span class="hint">Falta ativar o envio de e-mail na Cloudflare</span></span></div>`}
  ${sw("refunds", "on", s.notify_refunds, "Avisar reembolsos")}
  <form method="post" action="/integrations/notify-test" class="set-row">${csrfField(c)}<input type="hidden" name="back" value="/settings">
    <button class="set-link" type="submit">Testar aviso</button></form>
</div>
<p class="set-note">No iPhone, abra o Cutti pelo ícone da Tela de Início antes de ativar.</p>

<h2 class="set-title">Mais</h2>
<div class="set-group">
  <a class="set-row" href="/tracking"><span class="set-label">Trackeamento<span class="hint">Postbacks, Google Ads, NewsBreak · melhor no computador</span></span>${chev}</a>
  <a class="set-row" href="/integrations"><span class="set-label">Avisos e moeda<span class="hint">ntfy, Telegram, texto do aviso, câmbio</span></span>${chev}</a>
  <a class="set-row" href="/domains"><span class="set-label">Domínios</span>${chev}</a>
  <form method="post" action="/logout" class="set-row">${csrfField(c)}<button class="set-link danger-text" type="submit">Sair</button></form>
</div>`);
}

export async function settingsPost(c, action) {
  const f = await c.form();
  if (action === "currency") {
    const cur = String(f.get("currency")) === "USD" ? "USD" : "BRL";
    await setSetting(c.db, "currency", cur);
    c.flash("success", cur === "USD" ? "Valores em dólar." : "Valores em real.");
  } else if (action === "rate") {
    const before = await getSettings(c.db);
    const after = await freshRates(c, before, { force: true });
    if (after.rate_at && after.rate_at !== before.rate_at) c.flash("success", `Dólar atualizado: R$ ${after.usd_brl.toFixed(4).replace(".", ",")}.`);
    else c.flash("error", `Não consegui buscar a cotação agora (${after.rate_err || "sem resposta"}).`);
  } else if (action === "email") {
    await setSetting(c.db, "email_on", f.get("on") ? "1" : "0");
  } else if (action === "refunds") {
    await setSetting(c.db, "notify_refunds", f.get("on") ? "1" : "0");
  } else if (action === "mute") {
    const n = String(f.get("network") || "");
    if (NETWORKS[n]) {
      const s = await getSettings(c.db);
      const muted = new Set(s.notify_muted);
      if (f.get("on")) muted.delete(n); else muted.add(n);
      await setSetting(c.db, "notify_muted", [...muted].join(","));
    }
  }
  return c.redirect("/settings");
}

export function passwordPage(c, errors = {}, status = 200) {
  return c.respond(page({ ...c.view(), section: "settings" }, "Trocar a senha", html`
<nav class="crumbs"><a href="/settings">Ajustes</a> <span aria-hidden="true">/</span> <span>Trocar a senha</span></nav>
<header class="page-head"><h1 class="h-xl">Trocar a senha</h1></header>
<form method="post" action="/settings/password" class="card pad stack narrow" novalidate>
  ${csrfField(c.view())}
  <div class="field"><label for="current">Senha atual</label>
    <input id="current" name="current" type="password" autocomplete="current-password" required ${errors.current ? raw('aria-invalid="true" aria-describedby="cur-err"') : ""}>
    ${fieldError("cur-err", errors.current)}</div>
  <div class="field"><label for="new">Senha nova</label>
    <input id="new" name="new" type="password" autocomplete="new-password" required minlength="12" ${errors.new ? raw('aria-invalid="true" aria-describedby="new-err"') : ""}>
    ${fieldError("new-err", errors.new)}<p class="hint">Pelo menos 12 caracteres.</p></div>
  <button class="btn btn-primary btn-block" type="submit">Salvar senha</button>
</form>`), status);
}

export async function passwordPost(c) {
  const f = await c.form();
  const cur = String(f.get("current") || "");
  const pw = String(f.get("new") || "");
  const errors = {};
  if (!(await checkPassword(cur, c.user.password_hash))) errors.current = "A senha atual não confere.";
  if (pw.length < 12) errors.new = "Use pelo menos 12 caracteres.";
  if (Object.keys(errors).length) return passwordPage(c, errors, 422);
  await c.db.prepare("update users set password_hash = ?, updated_at = ? where id = ?")
    .bind(await hashPassword(pw), new Date().toISOString(), c.user.id).run();
  c.flash("success", "Senha trocada.");
  return c.redirect("/settings");
}
