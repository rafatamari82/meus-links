// Page generator: Review, TSL (text sales letter) and Presell pages.
// A page is a link with kind = 'page': same domains, back-halves, stats and country rules.
// The page's button goes to /<back-half>/go, which counts the click and redirects to the link's destination.

import { cleanDestination, ValidationError } from "./core.js";
import { esc, html, raw } from "./html.js";

export const TEMPLATES = {
  review: { label: "Review", hint: "Análise do produto com nota, prós, contras e veredito." },
  tsl: { label: "TSL", hint: "Carta de vendas em texto longo, com botões ao longo da página." },
  presell: { label: "Presell", hint: "Página curta entre o anúncio e a oferta." },
};

export const ACCENTS = {
  green: "Verde", blue: "Azul", red: "Vermelho", orange: "Laranja", purple: "Roxo", black: "Preto",
};

export const LANGS = { pt: "Português", en: "English", es: "Español" };

const T = {
  pt: {
    disclosure: "Aviso: esta página pode conter links de afiliado. Se você comprar por eles, posso receber uma comissão, sem custo extra para você.",
    rating: "Nota", pros: "Pontos positivos", cons: "Pontos negativos", verdict: "Veredito", guarantee: "Garantia", faq: "Perguntas frequentes",
    ad: "Publicidade", cta: "Quero conhecer",
  },
  en: {
    disclosure: "Disclosure: this page may contain affiliate links. If you buy through them, I may earn a commission at no extra cost to you.",
    rating: "Rating", pros: "Pros", cons: "Cons", verdict: "Verdict", guarantee: "Guarantee", faq: "Frequently asked questions",
    ad: "Advertisement", cta: "Learn more",
  },
  es: {
    disclosure: "Aviso: esta página puede contener enlaces de afiliado. Si compras a través de ellos, puedo recibir una comisión sin costo extra para ti.",
    rating: "Nota", pros: "Ventajas", cons: "Desventajas", verdict: "Veredicto", guarantee: "Garantía", faq: "Preguntas frecuentes",
    ad: "Publicidad", cta: "Quiero saber más",
  },
};
export const pageStrings = (lang) => T[lang] || T.pt;

// Fields per template: [name, max length, required]
const COMMON = [["headline", 200, true], ["subheadline", 400, false], ["image", 2048, false],
  ["cta_text", 60, false], ["disclosure", 600, false], ["notice", 60, false]];
const FIELDS = {
  review: [["product_name", 100, true], ["rating", 3, false], ["intro", 4000, false], ["pros", 2000, false],
    ["cons", 2000, false], ["body", 30000, false], ["verdict", 4000, false], ["faq", 8000, false]],
  tsl: [["body", 60000, true], ["guarantee", 3000, false], ["faq", 8000, false], ["ps", 3000, false]],
  presell: [["body", 8000, false], ["video", 2048, false]],
};

/** FAQ: blocks separated by a blank line; first line is the question, the rest the answer. */
export function parseFaq(text) {
  return String(text || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const [q, ...a] = b.split("\n");
    return { q: q.replace(/^(p|q|pergunta|question)\s*[:.-]\s*/i, "").trim(), a: a.join("\n").replace(/^(r|a|resposta|answer)\s*[:.-]\s*/i, "").trim() };
  });
}

function faqSection(text, s) {
  const items = parseFaq(text);
  if (!items.length) return "";
  return html`<section class="pg-faq"><h2>${s.faq}</h2>${items.map((i) => html`<details><summary>${i.q}</summary>${raw(renderRich(i.a))}</details>`)}</section>`;
}

export function defaultPageData(template, lang = "pt") {
  const s = pageStrings(lang);
  return { lang, accent: "green", cta_text: s.cta, disclosure: s.disclosure, notice: template === "presell" ? s.ad : "" };
}

export function videoEmbed(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return undefined; // given but not supported
}

/** Read and validate a page form. Throws nothing; returns { data, errors }. */
export function cleanPageData(template, get) {
  const errors = {};
  if (!TEMPLATES[template]) return { data: {}, errors: { template: "Modelo inválido." } };
  const data = {};
  data.lang = LANGS[get("lang")] ? get("lang") : "pt";
  data.accent = ACCENTS[get("accent")] ? get("accent") : "green";
  for (const [name, max, required] of [...COMMON, ...FIELDS[template]]) {
    const v = String(get(name) ?? "").replace(/\r\n/g, "\n").trim();
    if (required && !v) errors[name] = "Preencha este campo.";
    else if (v.length > max) errors[name] = `Use no máximo ${max} caracteres.`;
    data[name] = v.slice(0, max);
  }
  if (data.image) {
    try {
      data.image = cleanDestination(data.image);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      errors.image = "Cole o endereço de uma imagem (https://…).";
    }
  }
  if (template === "review" && data.rating) {
    const r = Number(String(data.rating).replace(",", "."));
    if (!(r >= 0 && r <= 5)) errors.rating = "Use uma nota de 0 a 5.";
    else data.rating = String(Math.round(r * 2) / 2);
  }
  if (template === "presell" && data.video && videoEmbed(data.video) === undefined) {
    errors.video = "Use um link do YouTube ou do Vimeo.";
  }
  if (!data.cta_text) data.cta_text = pageStrings(data.lang).cta;
  return { data, errors };
}

// ------------------------------------------------------------- rich text

function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Safe "text with a few marks" renderer:
 *   ## Title   ### Subtitle   - list item   ![](https://image)   [[BOTAO]] (a button)
 *   **bold**   blank line = new paragraph
 */
export function renderRich(text, button) {
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list.length) out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); list = []; };
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trimEnd();
    const t = line.trim();
    let m;
    if (!t) { flushPara(); flushList(); continue; }
    if (/^\[\[(botao|botão|button|boton|botón|cta)\]\]$/i.test(t)) {
      flushPara(); flushList();
      if (button) out.push(button);
      continue;
    }
    if ((m = t.match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/))) {
      flushPara(); flushList();
      out.push(`<img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy">`);
      continue;
    }
    if ((m = t.match(/^(#{2,3})\s+(.+)$/))) {
      flushPara(); flushList();
      const tag = m[1].length === 2 ? "h2" : "h3";
      out.push(`<${tag}>${inline(m[2])}</${tag}>`);
      continue;
    }
    if ((m = t.match(/^[-*•]\s+(.+)$/))) {
      flushPara();
      list.push(m[1]);
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return out.join("\n");
}

const lines = (t) => String(t || "").split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);

function stars(rating) {
  const r = Number(rating);
  let s = "";
  for (let i = 1; i <= 5; i++) s += r >= i ? "★" : r >= i - 0.5 ? "⯪" : "☆";
  return s;
}

// ------------------------------------------------------------- page HTML

export function renderPage({ link, data, assetVersion }) {
  const d = data || {};
  const s = pageStrings(d.lang);
  const button = `<p class="pg-cta-wrap"><a class="pg-cta" href="/${encodeURIComponent(link.slashtag)}/go" rel="nofollow sponsored">${esc(d.cta_text || s.cta)}</a></p>`;
  const hero = d.image ? html`<img class="pg-hero" src="${d.image}" alt="" loading="eager">` : "";
  let main;
  if (link.template === "review") {
    const pros = lines(d.pros);
    const cons = lines(d.cons);
    main = html`
<header class="pg-head">
  <h1>${d.headline}</h1>
  ${d.subheadline ? html`<p class="pg-sub">${d.subheadline}</p>` : ""}
</header>
<div class="pg-product">
  ${hero}
  <div>
    <p class="pg-product-name">${d.product_name}</p>
    ${d.rating ? html`<p class="pg-rating" aria-label="${s.rating}: ${d.rating}/5"><span aria-hidden="true">${stars(d.rating)}</span> <strong>${d.rating}</strong>/5</p>` : ""}
  </div>
</div>
${raw(renderRich(d.intro, button))}
${pros.length || cons.length ? html`<div class="pg-proscons">
  ${pros.length ? html`<div class="pg-pros"><h2>${s.pros}</h2><ul>${pros.map((p) => html`<li>${p}</li>`)}</ul></div>` : ""}
  ${cons.length ? html`<div class="pg-cons"><h2>${s.cons}</h2><ul>${cons.map((p) => html`<li>${p}</li>`)}</ul></div>` : ""}
</div>` : ""}
${raw(renderRich(d.body, button))}
${d.verdict ? html`<section class="pg-verdict"><h2>${s.verdict}</h2>${raw(renderRich(d.verdict, button))}</section>` : ""}
${raw(button)}
${faqSection(d.faq, s)}`;
  } else if (link.template === "tsl") {
    main = html`
<header class="pg-head pg-head-center">
  <h1>${d.headline}</h1>
  ${d.subheadline ? html`<p class="pg-sub">${d.subheadline}</p>` : ""}
</header>
${hero}
${raw(renderRich(d.body, button))}
${raw(button)}
${d.guarantee ? html`<section class="pg-guarantee"><h2>${s.guarantee}</h2>${raw(renderRich(d.guarantee, button))}</section>` : ""}
${faqSection(d.faq, s)}
${d.guarantee || d.faq ? raw(button) : ""}
${d.ps ? html`<section class="pg-ps">${raw(renderRich(d.ps, button))}</section>` : ""}`;
  } else {
    const video = videoEmbed(d.video);
    main = html`
<header class="pg-head pg-head-center">
  <h1>${d.headline}</h1>
  ${d.subheadline ? html`<p class="pg-sub">${d.subheadline}</p>` : ""}
</header>
${video ? html`<div class="pg-video"><iframe src="${video}" title="Vídeo" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : hero}
${raw(renderRich(d.body, button))}
${raw(button)}`;
  }
  return html`<!doctype html>
<html lang="${d.lang === "en" ? "en" : d.lang === "es" ? "es" : "pt-BR"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${d.headline}</title>
${d.subheadline ? html`<meta name="description" content="${d.subheadline}">` : ""}
<meta property="og:title" content="${d.headline}">
${d.image ? html`<meta property="og:image" content="${d.image}">` : ""}
<link rel="stylesheet" href="/static/page.css?v=${assetVersion}">
</head>
<body class="pg accent-${d.accent || "green"} pg-${link.template}">
${d.notice ? html`<p class="pg-notice">${d.notice}</p>` : ""}
<main class="pg-main">${main}</main>
${d.disclosure ? html`<footer class="pg-foot"><p>${d.disclosure}</p></footer>` : ""}
</body></html>`.s;
}

export const PAGE_CSP = "default-src 'none'; img-src https: data:; style-src 'self'; " +
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com; base-uri 'none'; form-action 'none'";
