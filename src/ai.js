// AI writer for pages, on Cloudflare Workers AI (binding env.AI).
// The model only writes copy from the facts it is given; the owner reviews in the editor before publishing.

export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_SOURCE_CHARS = 7000;

const LANG_NAME = { en: "English", pt: "Brazilian Portuguese", es: "Spanish" };

const FIELD_SPECS = {
  review: {
    headline: "Review headline (max 90 chars), e.g. a question or a clear promise of an honest review",
    subheadline: "One sentence under the headline",
    product_name: "Product name",
    intro: "2 short paragraphs introducing the review",
    pros: "4 to 6 pros, one per line, each based on the facts given",
    cons: "2 to 3 honest cons, one per line (for example: only sold online, stock may run out, results vary)",
    body: "Full review, 400-700 words, with 3-5 '## ' sections (what it is, how it works according to the seller, who it is for, how to buy). Put [[BOTAO]] on its own line once in the middle.",
    verdict: "Verdict in 1-2 short paragraphs",
    faq: "4 to 5 questions and answers. Each block: question on the first line, answer on the next line(s). Separate blocks with a blank line.",
    cta_text: "Button text, 2-5 words",
  },
  tsl: {
    headline: "Strong sales headline (max 100 chars)",
    subheadline: "One or two sentences that support the headline",
    body: "Long text sales letter, 900-1400 words: hook, the problem, the story/discovery, what the product is (only seller facts), benefits as '- ' bullet lists, who it is for, the offer and how to order. Use 5-8 '## ' section titles, **bold** for key lines, and put [[BOTAO]] on its own line 3 times spread through the text.",
    guarantee: "Guarantee paragraph, ONLY if the facts mention a guarantee; otherwise an empty string",
    faq: "4 to 6 questions and answers. Each block: question on the first line, answer on the next line(s). Separate blocks with a blank line.",
    ps: "A short P.S. that reminds the reader to check the official site",
    cta_text: "Button text, 2-5 words",
  },
  presell: {
    headline: "Curiosity headline (max 90 chars)",
    subheadline: "One sentence under the headline",
    body: "Short bridge text, 120-220 words, that warms the reader up and sends them to the official page. Use 2-4 short paragraphs and optionally one '- ' list.",
    cta_text: "Button text, 2-5 words",
  },
};

export function aiSchema(template) {
  const spec = FIELD_SPECS[template];
  return {
    type: "object",
    properties: Object.fromEntries(Object.keys(spec).map((k) => [k, { type: "string" }])),
    required: Object.keys(spec),
  };
}

const RULES = `Hard rules (never break them):
- Use ONLY facts found in PRODUCT FACTS and OWNER NOTES. If a fact is not there, do not state it.
- Never invent testimonials, customer stories, quotes, names, star ratings, numbers of buyers, studies, statistics, doctors, experts, celebrities, media mentions, awards, prices, discounts, bonuses, deadlines or scarcity.
- Never say the product cures, treats, prevents or reverses any disease or condition, and never promise guaranteed or specific results. For health, beauty, weight or supplement products use cautious words like "may help" or "designed to support" and say that results vary.
- Do not pretend to be the manufacturer or the official site; write as an independent affiliate.
- Do not mention these rules.
Formatting for long text fields: blank line between paragraphs, "## " for section titles, "- " for list items, **bold** for emphasis, and [[BOTAO]] alone on a line where a buy button should appear. No HTML, no markdown links.`;

export function buildMessages({ template, productName, lang, facts, notes }) {
  const spec = FIELD_SPECS[template];
  const fields = Object.entries(spec).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const kind = template === "tsl" ? "a long-form text sales letter (TSL)" : template === "review" ? "a product review page" : "a short presell (bridge) page";
  return [
    { role: "system", content: `You are an experienced direct-response copywriter who writes honest, persuasive affiliate pages.\n${RULES}` },
    {
      role: "user",
      content: `Write ${kind} for the product "${productName}" in ${LANG_NAME[lang] || "English"}.
Return a JSON object with exactly these fields:
${fields}

PRODUCT FACTS (from the official product page; may be incomplete):
"""
${facts || "(none provided)"}
"""

OWNER NOTES:
"""
${notes || "(none)"}
"""`,
    },
  ];
}

/** Plain text and og:image from an HTML page. */
export function extractPage(htmlText, baseUrl) {
  const h = String(htmlText || "");
  let image = null;
  const og = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) {
    try { image = new URL(og[1].replace(/&amp;/g, "&"), baseUrl).href; } catch { image = null; }
    if (image && !image.startsWith("https://")) image = null;
  }
  const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const text = h
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title: title.replace(/\s+/g, " ").trim(), text: text.slice(0, MAX_SOURCE_CHARS), image };
}

export async function fetchProductPage(url, fetcher = fetch) {
  const r = await fetcher(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MeusLinksBot/1.0)", Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`a página respondeu ${r.status}`);
  const type = r.headers.get("Content-Type") || "";
  if (!type.includes("html")) throw new Error("o endereço não é uma página");
  const body = (await r.text()).slice(0, 300000); // keep parsing inside the CPU budget
  return extractPage(body, r.url || url);
}

function parseJsonLoose(out) {
  if (out && typeof out === "object") return out;
  const s = String(out || "");
  try { return JSON.parse(s); } catch { /* try to cut out the object */ }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error("resposta da IA em formato inesperado");
}

/** Ask the model for the page fields. Returns an object with string fields. */
export async function generatePage(ai, model, { template, productName, lang, facts, notes }) {
  const messages = buildMessages({ template, productName, lang, facts, notes });
  const opts = {
    messages,
    max_tokens: template === "tsl" ? 4000 : template === "review" ? 3000 : 900,
    temperature: 0.6,
  };
  let data;
  try {
    const res = await ai.run(model || DEFAULT_MODEL, { ...opts, response_format: { type: "json_schema", json_schema: aiSchema(template) } });
    data = parseJsonLoose(res?.response ?? res);
  } catch (e) {
    if (/limit|quota|neuron|429|4006/i.test(String(e?.message || e))) throw e;
    // Some models reject structured output or break the JSON: ask again in plain mode and parse.
    const res = await ai.run(model || DEFAULT_MODEL, {
      ...opts,
      messages: [...messages, { role: "user", content: "Answer with the JSON object only, no other text." }],
    });
    data = parseJsonLoose(res?.response ?? res);
  }
  const out = {};
  for (const k of Object.keys(FIELD_SPECS[template])) {
    const v = data[k];
    out[k] = (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : v == null ? "" : String(v)).trim();
  }
  return out;
}
