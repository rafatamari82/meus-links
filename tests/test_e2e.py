"""End-to-end tests: real server, real Chrome.

Runs the Worker locally (node dev/server.mjs, D1 simulated on SQLite).
Run: python3 tests/test_e2e.py
Needs: Node 22+, playwright (Python) and Chrome.
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import http.client
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
HUMAN_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"
EMAIL, PASSWORD = "dono@exemplo.com", "senhasegura123"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class E2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        cls.base = f"http://localhost:{cls.port}"
        cls.short = f"http://127.0.0.1:{cls.port}"
        cls.tmp = tempfile.mkdtemp()
        env = dict(os.environ, DB_PATH=os.path.join(cls.tmp, "t.db"), PORT=str(cls.port),
                   TEST_ROUTES=f"go.verifica.com=http://127.0.0.1:{cls.port}")
        cls.server = subprocess.Popen(["node", "dev/server.mjs"], cwd=ROOT, env=env,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.base + "/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        cls.ctx = cls.browser.new_context(viewport={"width": 1440, "height": 900}, user_agent=HUMAN_UA)
        cls.page = cls.ctx.new_page()
        cls.console = []
        cls.server_errors = []
        cls.page.on("console", lambda m: m.type == "error" and "422" not in m.text and cls.console.append(m.text))
        cls.page.on("pageerror", lambda e: cls.console.append(str(e)))
        cls.page.on("response", lambda r: r.status >= 500 and cls.server_errors.append(r.url))
        # F00: first visit creates the owner account.
        p = cls.page
        p.goto(cls.base + "/")
        expect(p).to_have_url(re.compile(r"/setup$"))
        p.get_by_label("E-mail").fill(EMAIL)
        p.get_by_label("Senha").fill(PASSWORD)
        p.get_by_role("button", name="Criar conta").click()
        expect(p.get_by_role("heading", name="Crie seu primeiro link")).to_be_visible()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.terminate()
        cls.server.wait()

    def tearDown(self):
        self.assertEqual(self.console, [], "erros no console")
        self.assertEqual(self.server_errors, [], "respostas 5xx")

    # helpers
    def create(self, destination, slug="", title="", domain=None):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        dlg = p.get_by_role("dialog")
        dlg.get_by_label("Destino").fill(destination)
        if domain:
            dlg.get_by_label("Domínio").select_option(label=domain)
        dlg.get_by_label("Final do link").fill(slug)
        dlg.get_by_label("Nome").fill(title)
        dlg.get_by_role("button", name="Criar link").click()

    def hit(self, url, ua=HUMAN_UA):
        r = self.page.request.get(url, max_redirects=0, headers={"User-Agent": ua})
        return r.status, r.headers.get("location")

    def clicks_for(self, slug):
        self.page.goto(self.base + "/links")
        cell = self.page.get_by_role("link", name=re.compile(rf"^Estatísticas de {slug}:"))
        return int(cell.inner_text())

    # F01 happy path
    def test_f01_h1_create_copy_redirect_count(self):
        self.create("loja.exemplo.com/produto?ref=bio", "promo", "Promo bio")
        p = self.page
        expect(p.locator("tr.is-new")).to_contain_text("localhost/promo")
        expect(p.locator("tr.is-new").get_by_role("button", name=re.compile("Cop"))).to_have_text("Copiado")
        status, loc = self.hit(self.base + "/promo?utm_source=ig")
        self.assertEqual(status, 302)
        self.assertEqual(loc, "https://loja.exemplo.com/produto?ref=bio&utm_source=ig")
        self.assertEqual(self.clicks_for("promo"), 1)

    def test_f01_h2_random_back_half(self):
        self.create("https://exemplo.com/sem-final")
        txt = self.page.locator("tr.is-new .short-url").inner_text()
        self.assertRegex(txt, r"^localhost/[A-Za-z2-9]{6}$")

    def test_f01_e1_duplicate_back_half_case_insensitive(self):
        self.create("https://a.exemplo.com", "dup")
        self.create("https://b.exemplo.com", "DUP")
        expect(self.page.get_by_role("dialog")).to_be_visible()
        expect(self.page.locator("#slashtag-err")).to_contain_text("já está em uso")
        expect(self.page.get_by_label("Destino")).to_have_value("https://b.exemplo.com")

    def test_f01_e2_bad_destination(self):
        self.create("javascript:alert(1)", "xss")
        expect(self.page.locator("#destination-err")).to_be_visible()
        self.assertEqual(self.hit(self.base + "/xss")[0], 404)

    def test_f01_e3_reserved_back_half(self):
        self.create("https://exemplo.com", "login")
        expect(self.page.locator("#slashtag-err")).to_contain_text("reservado")

    def test_f01_e4_double_submit_creates_one(self):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        p.get_by_label("Destino").fill("https://exemplo.com/duplo")
        p.get_by_label("Final do link").fill("duplo")
        p.get_by_role("button", name="Criar link").dblclick()
        p.wait_for_load_state("networkidle")
        p.goto(self.base + "/links?q=duplo")
        expect(p.locator("tbody tr")).to_have_count(1)

    def test_f01_e5_keyboard_only(self):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.focus()
        p.keyboard.press("Enter")
        expect(p.get_by_label("Destino")).to_be_focused()
        p.keyboard.type("https://exemplo.com/teclado")
        p.keyboard.press("Tab")  # domínio
        p.keyboard.press("Tab")  # final
        p.keyboard.type("teclado")
        p.keyboard.press("Enter")
        expect(p.locator("tr.is-new")).to_contain_text("localhost/teclado")

    def test_f01_e6_escape_closes_drawer(self):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        expect(p.get_by_role("dialog")).to_be_visible()
        p.keyboard.press("Escape")
        expect(p.get_by_role("dialog")).to_be_hidden()

    # F02 visitor
    def test_f02_bots_and_previews_do_not_count(self):
        self.create("https://exemplo.com/bot", "botcheck")
        for ua in ["WhatsApp/2.23.1", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)"]:
            self.assertEqual(self.hit(self.base + "/botcheck", ua)[0], 302)
        self.assertEqual(self.clicks_for("botcheck"), 0)
        self.hit(self.base + "/botcheck")
        self.assertEqual(self.clicks_for("botcheck"), 1)

    def test_f02_head_does_not_count(self):
        self.create("https://exemplo.com/head", "headcheck")
        r = self.page.request.head(self.base + "/headcheck", max_redirects=0, headers={"User-Agent": HUMAN_UA})
        self.assertEqual(r.status, 302)
        self.assertEqual(self.clicks_for("headcheck"), 0)

    def test_f02_unknown_and_no_cache(self):
        self.assertEqual(self.hit(self.base + "/nao-existe")[0], 404)
        self.create("https://exemplo.com/cache", "cache")
        r = self.page.request.get(self.base + "/cache", max_redirects=0, headers={"User-Agent": HUMAN_UA})
        self.assertIn("no-store", r.headers.get("cache-control", ""))

    # F03 unlimited edits
    def test_f03_unlimited_destination_edits(self):
        self.create("https://exemplo.com/v0", "edita")
        p = self.page
        for i in range(1, 16):
            p.goto(self.base + "/links?q=edita")
            p.get_by_role("link", name="Editar edita").click()
            p.get_by_label("Destino").fill(f"https://exemplo.com/v{i}")
            p.get_by_role("button", name="Salvar").click()
            expect(p.get_by_text("Alterações salvas.")).to_be_visible()
        self.assertEqual(self.hit(self.base + "/edita")[1], "https://exemplo.com/v15")

    def test_f03_delete(self):
        self.create("https://exemplo.com/apagar", "apagar")
        p = self.page
        p.once("dialog", lambda d: d.accept())
        p.get_by_role("button", name="Apagar apagar").click()
        expect(p.get_by_text("Link /apagar apagado.")).to_be_visible()
        self.assertEqual(self.hit(self.base + "/apagar")[0], 404)

    # F04 domains
    def raw_get(self, host, path, ua=HUMAN_UA):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("GET", path, headers={"Host": f"{host}:{self.port}", "User-Agent": ua})
        r = c.getresponse()
        body = r.read()
        c.close()
        return r.status, r.getheader("Location"), body

    def add_domain(self, name):
        p = self.page
        p.goto(self.base + "/domains")
        p.get_by_label("Domínio", exact=True).fill(name)
        p.get_by_role("button", name="Adicionar").click()
        return p.get_by_role("row", name=re.compile(re.escape(name.lower().split("/")[2] if "://" in name else name.lower())))

    def test_f04_connect_and_use_domain(self):
        p = self.page
        row = self.add_domain("https://Go.Teste.com/")
        expect(row).to_contain_text("Aguardando")
        # Cloudflare routes the domain to the Worker: the first request activates it.
        self.assertEqual(self.raw_get("go.teste.com", "/qualquer")[0], 404)
        p.goto(self.base + "/domains")
        expect(p.get_by_role("row", name=re.compile("go.teste.com"))).to_contain_text("Ativo")
        self.create("https://exemplo.com/no-dominio", "meu", domain="go.teste.com")
        expect(p.locator("tr.is-new")).to_contain_text("go.teste.com/meu")
        status, loc, _ = self.raw_get("go.teste.com", "/meu")
        self.assertEqual((status, loc), (302, "https://exemplo.com/no-dominio"))
        # the same back-half on another domain is a different link
        self.assertEqual(self.raw_get("localhost", "/meu")[0], 404)
        # panel is invisible on the short domain
        status, _, body = self.raw_get("go.teste.com", "/login")
        self.assertEqual(status, 404)
        self.assertNotIn("Senha".encode(), body)
        # fallback for unknown back-halves
        p.goto(self.base + "/domains")
        fb = p.get_by_role("row", name=re.compile("go.teste.com"))
        fb.get_by_label("Link que não existe leva para").fill("https://seusite.exemplo.com")
        fb.get_by_role("button", name="Salvar").click()
        expect(p.get_by_text("Página de fallback salva.")).to_be_visible()
        self.assertEqual(self.raw_get("go.teste.com", "/nao-tem")[1], "https://seusite.exemplo.com")
        # a domain with links cannot be removed
        p.once("dialog", lambda d: d.accept())
        p.get_by_role("row", name=re.compile("go.teste.com")).get_by_role("button", name="Remover").click()
        expect(p.locator(".toast-error")).to_contain_text("ainda tem links")

    def test_f04_verify_button(self):
        row = self.add_domain("go.verifica.com")
        row.get_by_role("button", name="Verificar").click()
        expect(self.page.get_by_text("go.verifica.com verificado e ativo.")).to_be_visible()
        expect(self.page.get_by_role("row", name=re.compile("go.verifica.com"))).to_contain_text("Ativo")

    def test_f04_unknown_host_is_not_served(self):
        self.assertEqual(self.raw_get("nao-cadastrado.com", "/qualquer")[0], 404)

    def test_f04_ip_is_not_a_domain(self):
        p = self.page
        p.goto(self.base + "/domains")
        p.get_by_label("Domínio", exact=True).fill("127.0.0.1")
        p.get_by_role("button", name="Adicionar").click()
        expect(p.locator("#domain-err")).to_be_visible()

    def test_f04_pending_domain_explains_dns(self):
        p = self.page
        p.goto(self.base + "/domains")
        p.get_by_label("Domínio", exact=True).fill("go.errado.com")
        p.get_by_role("button", name="Adicionar").click()
        p.get_by_role("button", name="Verificar").click()
        expect(p.locator(".toast-error")).to_contain_text("Não consegui confirmar daqui")

    def test_f04_token_only_for_known_domains(self):
        self.assertEqual(self.raw_get("desconhecido.com", "/.well-known/shortlinks-verify")[0], 404)
        status, _, body = self.raw_get("localhost", "/.well-known/shortlinks-verify")
        self.assertEqual(status, 200)
        self.assertEqual(len(body.strip()), 32)

    # F05 stats
    def test_f05_stats_page(self):
        self.create("https://exemplo.com/stats", "stats", "Stats")
        self.hit(self.base + "/stats")
        self.hit(self.base + "/stats", "WhatsApp/2")
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("link", name=re.compile(r"^Estatísticas de stats:")).click()
        expect(p.get_by_role("heading", name="Stats")).to_be_visible()
        expect(p.locator(".stat-value").first).to_have_text("1")
        expect(p.get_by_text(re.compile("1 acesso de robôs"))).to_be_visible()

    def test_f05_country_device_breakdown(self):
        self.create("https://exemplo.com/paises", "paises", "Países")
        iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
        for ua, cc in [(iphone, "BR"), (iphone, "BR"), (HUMAN_UA, "US")]:
            self.page.request.get(self.base + "/paises", max_redirects=0,
                                  headers={"User-Agent": ua, "CF-IPCountry": cc})
        p = self.page
        p.goto(self.base + "/links?q=paises")
        p.get_by_role("link", name="Ver estatísticas de paises").click()
        paises = p.get_by_role("region", name="Países") if False else p.locator("section", has=p.get_by_role("heading", name="Países"))
        expect(paises).to_contain_text("Brasil")
        expect(paises.get_by_role("row", name=re.compile("Brasil"))).to_contain_text("67%")
        expect(paises).to_contain_text("Estados Unidos")
        aparelho = p.locator("section", has=p.get_by_role("heading", name="Aparelho"))
        expect(aparelho.get_by_role("row", name=re.compile("Celular"))).to_contain_text("2")
        expect(aparelho).to_contain_text("Computador")
        sistema = p.locator("section", has=p.get_by_role("heading", name="Sistema"))
        expect(sistema).to_contain_text("iPhone (iOS)")
        expect(sistema).to_contain_text("Mac")

    def geo_hit(self, slug, cc):
        r = self.page.request.get(self.base + "/" + slug, max_redirects=0,
                                  headers={"User-Agent": HUMAN_UA, **({"CF-IPCountry": cc} if cc else {})})
        return r.status, r.text() if r.status != 302 else ""

    def set_geo(self, slug, mode_label, countries):
        p = self.page
        p.goto(self.base + "/links?q=" + slug)
        p.get_by_role("link", name=f"Editar {slug}").click()
        p.locator("details.geo summary").click()
        p.get_by_label(mode_label).check()
        for name in countries:
            p.get_by_placeholder("Procurar país…").fill(name)
            p.get_by_role("checkbox", name=name, exact=True).check()
        p.get_by_role("button", name="Salvar").click()
        expect(p.get_by_text("Alterações salvas.")).to_be_visible()

    def test_f06_block_countries(self):
        self.create("https://exemplo.com/geo1", "geobloq")
        self.set_geo("geobloq", "Bloquear os países marcados", ["Brasil", "Estados Unidos"])
        expect(self.page.locator("tbody")).to_contain_text("Bloqueado em Brasil, Estados Unidos")
        status, body = self.geo_hit("geobloq", "BR")
        self.assertEqual(status, 403)
        self.assertIn("Oi, curioso! Aqui não.", body)
        self.assertEqual(self.geo_hit("geobloq", "PT")[0], 302)
        self.assertEqual(self.geo_hit("geobloq", None)[0], 302)  # unknown country passes
        self.assertEqual(self.clicks_for("geobloq"), 2)  # the blocked visit is not counted
        self.page.get_by_role("link", name="Ver estatísticas de geobloq").click()
        expect(self.page.get_by_text("1 acesso de país bloqueado foi barrado")).to_be_visible()

    def test_f06_allow_only(self):
        self.create("https://exemplo.com/geo2", "geolib")
        self.set_geo("geolib", "Funcionar só nos países marcados", ["Portugal"])
        self.assertEqual(self.geo_hit("geolib", "PT")[0], 302)
        self.assertEqual(self.geo_hit("geolib", "BR")[0], 403)
        self.assertEqual(self.geo_hit("geolib", None)[0], 403)  # unknown country is not on the list
        # back to everywhere
        p = self.page
        p.goto(self.base + "/links?q=geolib")
        p.get_by_role("link", name="Editar geolib").click()
        # the section is already open when a rule is active
        expect(p.locator("details.geo")).to_have_attribute("open", "")
        p.get_by_label("Funciona em todos os países").check()
        p.get_by_role("button", name="Salvar").click()
        self.assertEqual(self.geo_hit("geolib", "BR")[0], 302)

    def test_f06_needs_a_country(self):
        self.create("https://exemplo.com/geo3", "geovazio")
        p = self.page
        p.goto(self.base + "/links?q=geovazio")
        p.get_by_role("link", name="Editar geovazio").click()
        p.locator("details.geo summary").click()
        p.get_by_label("Bloquear os países marcados").check()
        p.get_by_role("button", name="Salvar").click()
        expect(p.locator("#geo-err")).to_have_text("Marque pelo menos um país para bloquear.")

    # F08 search
    def test_f08_search(self):
        self.create("https://exemplo.com/a", "busca-alpha", "Alpha")
        self.create("https://exemplo.com/b", "busca-beta", "Beta")
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_label("Buscar links").fill("alpha")
        p.get_by_role("button", name="Buscar").click()
        expect(p.locator("tbody")).to_contain_text("busca-alpha")
        expect(p.locator("tbody")).not_to_contain_text("busca-beta")
        p.get_by_label("Buscar links").fill("zzzz-nada")
        p.get_by_role("button", name="Buscar").click()
        expect(p.get_by_text("Nenhum link encontrado")).to_be_visible()

    # Auth and security
    def test_n1_logged_out_cannot_see_or_change(self):
        anon = self.browser.new_context()
        r = anon.request.get(self.base + "/links", max_redirects=0)
        self.assertIn(r.status, (302, 303))
        self.assertIn("/login", r.headers["location"])
        r = anon.request.post(self.base + "/links", form={"destination": "https://x.com"}, max_redirects=0)
        self.assertEqual(r.status, 400)  # no CSRF token, no session
        r = anon.request.get(self.base + "/setup", max_redirects=0)
        self.assertIn(r.status, (302, 303))  # setup is gone once the owner exists
        anon.close()

    def test_n2_wrong_password_and_rate_limit(self):
        anon = self.browser.new_context()
        p = anon.new_page()
        for _ in range(10):
            p.goto(self.base + "/login")
            p.get_by_label("E-mail").fill(EMAIL)
            p.get_by_label("Senha").fill("errada")
            p.get_by_role("button", name="Entrar").click()
            expect(p.get_by_role("alert")).to_have_text("E-mail ou senha incorretos.")
        p.goto(self.base + "/login")
        p.get_by_label("E-mail").fill(EMAIL)
        p.get_by_label("Senha").fill(PASSWORD)
        p.get_by_role("button", name="Entrar").click()
        expect(p.get_by_role("alert")).to_contain_text("Muitas tentativas")
        anon.close()

    def test_n3_csp_blocks_inline(self):
        r = self.page.request.get(self.base + "/links")
        self.assertIn("script-src 'self'", r.headers.get("content-security-policy", ""))
        self.assertEqual(r.headers.get("x-frame-options"), "DENY")

    # T: sales tracker
    def tracker_key(self):
        self.page.goto(self.base + "/tracking")
        url = self.page.get_by_label("URL de postback BuyGoods").input_value()
        return re.search(r"/pb/([\w-]+)/", url).group(1)

    def test_t01_tracked_link_click_postback_results(self):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        dlg = p.get_by_role("dialog")
        dlg.get_by_label("Destino").fill("https://presell.exemplo.com/bolo")
        dlg.get_by_label("Final do link").fill("bolo-g")
        dlg.locator("summary", has_text="Rastrear vendas").click()
        dlg.get_by_label("Gerar um código por clique").check()
        dlg.get_by_label("Rede ou plataforma").select_option(label="ClickBank")
        expect(dlg.get_by_label("Parâmetro do código")).to_have_value("tid")
        dlg.get_by_role("button", name="Criar link").click()
        expect(p.locator("tr.is-new")).to_contain_text("Rastreado · ClickBank")

        r0 = p.request.get(self.base + "/bolo-g?src=google&cmp=9001&ad=77&gclid=GX&lp=https%3A%2F%2Fpresell.exemplo.com%2Fbolo%3Fv%3D2",
                           max_redirects=0, headers={"User-Agent": HUMAN_UA, "CF-IPCountry": "US"})
        status, loc = r0.status, r0.headers.get("location")
        self.assertEqual(status, 302)
        cid = re.search(r"tid=(ct[a-z2-7]{10})", loc).group(1)
        self.assertTrue(loc.startswith("https://presell.exemplo.com/bolo?v=2"), loc)

        key = self.tracker_key()
        r = p.request.get(f"{self.base}/pb/{key}/clickbank?cid={cid}&amount=60&txid=CB1&product=HoneyBoost")
        self.assertEqual(r.text(), "ok")
        self.assertEqual(p.request.get(f"{self.base}/pb/{key}/clickbank?cid={cid}&amount=60&txid=CB1").text(), "ok (repetido)")
        self.assertEqual(p.request.get(f"{self.base}/pb/nao-e-a-chave/clickbank?cid={cid}").status, 403)
        cost = p.request.post(f"{self.base}/cost/{key}/google", data='{"currency":"USD","rows":[{"date":"%s","campaign_id":"9001","campaign_name":"Bolo EUA","cost_micros":20000000}]}'
                              % time.strftime("%Y-%m-%d", time.gmtime(time.time() - 3 * 3600)),
                              headers={"Content-Type": "application/json"})
        self.assertEqual(cost.text(), "ok 1")

        p.goto(self.base + "/results?p=today")
        row = p.locator("tr", has_text="Bolo EUA")
        expect(row).to_contain_text("Google Ads")
        expect(row.locator("td[data-label=Vendas]")).to_have_text("1")
        expect(row.locator("td[data-label=ROAS]")).to_have_text("3,00x")
        p.get_by_role("link", name="Anúncios").click()
        expect(p.locator("tr", has_text="77")).to_be_visible()

        p.goto(self.base + "/sales?p=today")
        sale_row = p.locator("tr", has=p.locator("td[data-label=Tipo]")).filter(has_text="pedido CB1")
        expect(sale_row).to_contain_text("Venda")
        expect(sale_row.locator("td[data-label=Produto]")).to_have_text("HoneyBoost")
        expect(sale_row.locator("td[data-label=País]")).to_contain_text("Estados Unidos")
        p.locator("summary", has_text="Últimos avisos recebidos").click()
        expect(p.get_by_text(f"clique {cid}").first).to_be_visible()
        p.goto(self.base + "/results?p=today")
        p.get_by_label("Produto").select_option(label="HoneyBoost")
        p.wait_for_url(re.compile(r"product=HoneyBoost"))
        expect(p.locator(".rank").first).to_contain_text("HoneyBoost")
        expect(p.locator(".mcard", has_text="Ticket médio")).to_contain_text("R$")
        csv = p.request.get(f"{self.base}/export/{key}/google.csv").text()
        self.assertIn('"GX","Cutti - Venda"', csv)

    def test_t02_newsbreak_csv_and_settings(self):
        p = self.page
        p.goto(self.base + "/tracking")
        p.get_by_label("Importar gasto").fill("Date,Campaign Name,Spend\n2026-11-20,NB teste,10.00")
        p.get_by_role("button", name="Importar").click()
        expect(p.get_by_text("1 linha(s) de gasto da NewsBreak importadas")).to_be_visible()
        p.get_by_label("Importar gasto").fill("sem colunas")
        p.get_by_role("button", name="Importar").click()
        expect(p.locator("#csv-err")).to_be_visible()
        p.goto(self.base + "/integrations")
        p.get_by_label("1 dólar = R$").fill("0")
        p.locator('form[action="/integrations/settings"]').get_by_role("button", name="Salvar").click()
        expect(p.get_by_role("alert")).to_contain_text("câmbio maior que zero")

    def test_t04_phone_notifications(self):
        p = self.page
        p.goto(self.base + "/integrations")
        expect(p.get_by_text("App ntfy")).to_have_count(0)
        expect(p.locator("main").get_by_role("link", name="Trackeamento")).to_have_count(0)
        p.goto(self.base + "/settings")  # on a computer the sidebar has these, so Ajustes does not repeat them
        expect(p.get_by_role("heading", name="Mais")).to_be_hidden()
        expect(p.locator("main").get_by_role("link", name=re.compile("^Trackeamento"))).to_be_hidden()
        p.goto(self.base + "/integrations")
        p.get_by_label("Token do bot").fill("isso-nao-e-token")
        p.get_by_role("button", name="Conectar").click()
        expect(p.locator("#tg-err")).to_contain_text("BotFather")
        p.goto(self.base + "/integrations")
        p.get_by_label("Avisar também reembolsos").uncheck()
        expect(p.get_by_text("Preferência salva")).to_be_visible()
        expect(p.get_by_label("Avisar também reembolsos")).not_to_be_checked()

    def test_t05_cutti_app_install_and_push(self):
        p = self.page
        self.assertEqual(p.request.get(self.base + "/static/manifest.webmanifest").json()["name"], "Cutti")
        icon = p.request.get(self.base + "/static/logo-192.png")
        self.assertEqual(icon.headers["content-type"], "image/png")
        self.assertEqual(icon.body()[:4], b"\x89PNG")
        self.assertIn("showNotification", p.request.get(self.base + "/sw.js").text())
        p.goto(self.base + "/integrations")
        expect(p.get_by_role("button", name="Ativar avisos neste aparelho")).to_be_visible()
        csrf = p.locator("[data-push] input[name=csrf]").input_value()
        fake = {"csrf": csrf, "endpoint": "https://push.example.com/send/abc123xyz",
                "p256dh": "B" + "A" * 86, "auth": "QUFBQUFBQUFBQUFBQUFBQQ", "label": "iPhone"}
        r = p.request.post(self.base + "/integrations/push-subscribe", form=fake)
        self.assertEqual(r.status, 200)
        p.goto(self.base + "/integrations")
        box = p.locator(".notify-main")
        expect(box).to_contain_text("iPhone")
        expect(box).to_contain_text("1 aparelho(s)")
        p.get_by_role("button", name="Testar aviso").click()
        # The fake device's server is not real, so the test may report it; what matters is it tried that device.
        expect(p.get_by_text(re.compile("Aviso de teste enviado|iPhone"))).not_to_have_count(0)
        expect(p.get_by_text("Nenhum aviso configurado")).to_have_count(0)
        box = p.locator(".notify-main")
        box.get_by_role("button", name="Remover").click()
        expect(p.get_by_text("Aparelho removido")).to_be_visible()
        expect(p.locator(".notify-main")).not_to_contain_text("ativado em")

    def test_t06_custom_notification_text(self):
        p = self.page
        p.goto(self.base + "/integrations")
        p.locator("summary", has_text="Personalizar o texto do aviso").click()
        title = p.locator("#tpl-sale_title")
        title.fill("🤑 Caiu ")
        p.get_by_role("button", name="{valor_painel}").click()
        expect(title).to_have_value("🤑 Caiu {valor_painel}")
        expect(p.locator('[data-preview="sale"] [data-preview-title]')).to_have_text("🤑 Caiu R$ 472,50")
        p.get_by_role("button", name="Salvar texto").click()
        expect(p.get_by_text("Texto do aviso salvo")).to_be_visible()
        expect(p.locator("#tpl-sale_title")).to_have_value("🤑 Caiu {valor_painel}")
        p.locator("summary", has_text="Personalizar o texto do aviso").click()
        p.get_by_role("button", name="Voltar ao padrão").click()
        expect(p.locator("#tpl-sale_title")).to_have_value("{emoji} {tipo}! {valor}")

    def test_t07_organic_youtube_video(self):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        dlg = p.get_by_role("dialog")
        dlg.get_by_label("Destino").fill("https://oferta.exemplo.com/yt")
        dlg.get_by_label("Final do link").fill("yt-bolo")
        dlg.get_by_label("Nome").fill("Vídeo: bolo de cenoura")
        dlg.locator("summary", has_text="Rastrear vendas").click()
        dlg.get_by_label("Gerar um código por clique").check()
        dlg.get_by_label("Rede ou plataforma").select_option(label="BuyGoods")
        dlg.get_by_label("De onde vem o clique").select_option(label="YouTube")
        dlg.get_by_role("button", name="Criar link").click()
        expect(p.locator("tr.is-new")).to_contain_text("Rastreado · BuyGoods · YouTube")
        status, loc = self.hit(self.base + "/yt-bolo")
        cid = re.search(r"subid=(ct[a-z2-7]{10})", loc).group(1)
        key = self.tracker_key()
        self.assertEqual(p.request.get(f"{self.base}/pb/{key}/buygoods?cid={cid}&amount=33&txid=YT1").text(), "ok")
        p.goto(self.base + "/results?p=today")
        p.get_by_label("Fonte de tráfego").select_option(label="YouTube")
        p.wait_for_url(re.compile(r"source=youtube"))
        row = p.locator("tr", has_text="Vídeo: bolo de cenoura")
        expect(row.locator("td[data-label=Vendas]")).to_have_text("1")
        expect(row).to_contain_text("YouTube")

    def test_t08_app_look_mobile(self):
        m = self.browser.new_context(viewport={"width": 390, "height": 844},
                                     storage_state=self.ctx.storage_state()).new_page()
        m.goto(self.base + "/results")
        bar = m.get_by_role("navigation", name="Navegação principal")
        expect(bar).to_be_visible()
        expect(bar.get_by_role("link", name="Resumo")).to_have_attribute("aria-current", "page")
        kpis = m.locator(".m-kpis")
        expect(kpis).to_be_visible()
        expect(kpis.locator(".m-kpi-hero")).to_contain_text("Faturamento")
        expect(kpis.locator(".m-kpi-dark")).to_contain_text("Vendas")
        expect(kpis.locator(".m-kpi-outline")).to_contain_text("Reembolsos")
        cards = m.locator(".net-cards.mobile-only .net-card")
        if cards.count():
            expect(cards.first).to_be_visible()
            self.assertIn("/sales?", cards.first.get_attribute("href"))
        # phone shows the short version: only the period filter, no full dashboard
        expect(m.locator("#p")).to_be_visible()
        expect(m.get_by_label("Plataforma")).to_be_hidden()
        expect(m.locator(".dash-split")).to_be_hidden()
        expect(m.locator(".results-table")).to_be_hidden()
        m.screenshot(path="/tmp/mobile-resumo.png")
        # the top bar stays a bar on phones, and the dashboard starts right under it
        self.assertLess(m.locator(".sidebar").bounding_box()["height"], 120)
        # phone top bar: "Dashboard" on the left, logo on the right, no Sair and no Resumo header
        title = m.locator(".topbar-title")
        expect(title).to_have_text("Dashboard")
        self.assertLess(title.bounding_box()["x"], m.locator(".sidebar .brand").bounding_box()["x"])
        expect(m.locator(".sidebar").get_by_role("button", name="Sair")).to_be_hidden()
        expect(m.get_by_role("heading", name="Resumo", exact=True)).to_be_hidden()
        expect(m.get_by_role("link", name="Atualizar")).to_be_hidden()
        first = m.locator(".main > :visible").first.bounding_box()["y"]
        self.assertLess(first, 110)
        self.assertLess(m.locator(".m-kpis").bounding_box()["y"] - (m.locator(".dash-filters").bounding_box()["y"] + m.locator(".dash-filters").bounding_box()["height"]), 40)
        bar.get_by_role("link", name="Vendas").click()
        expect(m.get_by_role("heading", name="Vendas", exact=True)).to_be_visible()
        expect(bar.get_by_role("link", name="Trackeamento")).to_have_count(0)
        bar.get_by_role("link", name="Ajustes").click()
        m.get_by_role("link", name=re.compile("^Trackeamento")).click()
        expect(m.get_by_role("heading", name="Trackeamento", exact=True)).to_be_visible()
        expect(bar.get_by_role("link", name="Ajustes")).to_have_attribute("aria-current", "page")
        m.get_by_label("Postback da NewsBreak").fill("https://nb.exemplo.com/pb?c={clickid}&v={value}")
        m.get_by_role("button", name="Salvar postback").click()
        expect(m.get_by_label("Postback da NewsBreak")).to_have_value("https://nb.exemplo.com/pb?c={clickid}&v={value}")
        bar.get_by_role("link", name="Ajustes").click()
        expect(m.get_by_role("link", name="Domínios")).to_be_visible()
        m.context.close()

    def test_t09_phone_settings(self):
        m = self.browser.new_context(viewport={"width": 390, "height": 844},
                                     storage_state=self.ctx.storage_state()).new_page()
        m.goto(self.base + "/results")
        m.get_by_role("navigation", name="Navegação principal").get_by_role("link", name="Ajustes").click()
        expect(m.get_by_role("heading", name="Ajustes", exact=True)).to_be_visible()
        expect(m.get_by_text("R$ 5,4000")).to_be_visible()
        m.get_by_role("button", name="Atualizar agora").click()
        expect(m.get_by_text("Dólar atualizado: R$ 5,4000.")).to_be_visible()
        m.get_by_role("button", name="Dólar").click()
        expect(m.get_by_role("button", name="Dólar")).to_have_attribute("aria-pressed", "true")
        m.goto(self.base + "/results")
        expect(m.locator(".mcard-hero")).to_contain_text("US$")
        m.goto(self.base + "/settings")
        m.get_by_role("button", name="Real").click()
        expect(m.get_by_role("button", name="Real")).to_have_attribute("aria-pressed", "true")
        for name in ["ClickBank", "BuyGoods", "Digistore24", "MaxWeb", "GuruMedia", "SmartADV", "SmashLoud", "ClickADV", "MediaScalers", "Hotmart", "Kiwify"]:
            expect(m.get_by_role("switch", name=name)).to_be_visible()
        expect(m.get_by_role("switch", name="Aviso por e-mail")).to_be_checked()
        expect(m.get_by_text("voce@exemplo.com")).to_be_visible()
        sw = m.get_by_role("switch", name="Avisar reembolsos")
        was = sw.is_checked()
        m.locator("label.set-switch", has_text="Avisar reembolsos").click()
        expect(m.get_by_role("switch", name="Avisar reembolsos")).to_be_checked(checked=not was)
        m.get_by_role("link", name="Trocar a senha").click()
        m.get_by_label("Senha atual").fill("errada-errada-1")
        m.get_by_label("Senha nova").fill("curta")
        m.get_by_role("button", name="Salvar senha").click()
        expect(m.locator("#cur-err")).to_be_visible()
        expect(m.locator("#new-err")).to_be_visible()
        width = m.evaluate("document.documentElement.scrollWidth")
        self.assertLessEqual(width, 390)
        m.context.close()

    def test_t10_connect_google_ads(self):
        p = self.page
        p.goto(self.base + "/tracking")
        p.locator("summary", has_text="Avançado: conectar pela API").click()
        box = p.locator("#google")
        box.get_by_label("ID do cliente").fill("errado")
        box.get_by_role("button", name="Salvar dados").click()
        expect(p.locator("#g-client_id-err")).to_be_visible()
        box = p.locator("#google")
        box.get_by_label("ID do cliente").fill("123-abc.apps.googleusercontent.com")
        box.get_by_label("Chave secreta do cliente").fill("GOCSPX-teste")
        box.get_by_label("Token de desenvolvedor").fill("dev-token-teste")
        box.get_by_role("button", name="Salvar dados").click()
        expect(p.get_by_role("link", name="2. Conectar com Google")).to_be_attached()
        r = p.request.get(self.base + "/tracking/google/connect", max_redirects=0)
        self.assertEqual(r.status, 302)
        loc = r.headers["location"]
        self.assertIn("accounts.google.com", loc)
        self.assertIn("access_type=offline", loc)
        state = re.search(r"state=([\w-]+)", loc).group(1)
        p.goto(self.base + f"/tracking/google/callback?code=abc&state={state}")
        expect(p.get_by_text("Google conectado. Agora escolha a conta")).to_be_visible()
        sel = p.get_by_label("Conta do Google Ads")
        expect(sel.locator("option")).to_have_count(1)
        p.get_by_role("button", name="Usar esta conta").click()
        expect(p.get_by_text("Conta Teste conectada")).to_be_visible()
        expect(p.locator("#google")).to_contain_text("Conectado")
        # a sale with a gclid goes to Google right away
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        dlg = p.get_by_role("dialog")
        dlg.get_by_label("Destino").fill("https://presell.exemplo.com/g")
        dlg.get_by_label("Final do link").fill("g-api")
        dlg.locator("summary", has_text="Rastrear vendas").click()
        dlg.get_by_label("Gerar um código por clique").check()
        dlg.get_by_label("Rede ou plataforma").select_option(label="ClickBank")
        dlg.get_by_role("button", name="Criar link").click()
        expect(p.locator("tr.is-new")).to_be_visible()
        status, loc = self.hit(self.base + "/g-api?src=google&cmp=777&gclid=GCLIDAPI")
        cid = re.search(r"tid=(ct[a-z2-7]{10})", loc).group(1)
        key = self.tracker_key()
        self.assertEqual(p.request.get(f"{self.base}/pb/{key}/clickbank?cid={cid}&amount=50&txid=GA1").text(), "ok")
        time.sleep(0.5)
        p.goto(self.base + "/tracking")
        expect(p.locator("#google")).to_contain_text("Vendas enviadas ao Google na hora")
        expect(p.locator("#google")).to_contain_text("“Cutti - Venda”: 1")
        p.goto(self.base + "/results?p=today")
        expect(p.locator("tr", has_text="Campanha API")).to_be_visible()
        p.goto(self.base + "/tracking")
        p.locator("summary", has_text="Avançado: conectar pela API").click()
        p.locator("#google").get_by_role("button", name="Sincronizar agora").click()
        expect(p.get_by_text("Sincronizado:")).to_be_visible()
        p.once("dialog", lambda d: d.accept())
        p.locator("#google").get_by_role("button", name="Desconectar").click()
        expect(p.get_by_text("Google Ads desconectado")).to_be_visible()

    def test_t11_google_script_uploads_sales(self):
        p = self.page
        p.goto(self.base + "/links")
        p.get_by_role("button", name="Novo link").first.click()
        dlg = p.get_by_role("dialog")
        dlg.get_by_label("Destino").fill("https://presell.exemplo.com/s")
        dlg.get_by_label("Final do link").fill("g-script")
        dlg.locator("summary", has_text="Rastrear vendas").click()
        dlg.get_by_label("Gerar um código por clique").check()
        dlg.get_by_label("Rede ou plataforma").select_option(label="ClickBank")
        dlg.get_by_role("button", name="Criar link").click()
        expect(p.locator("tr.is-new")).to_be_visible()
        status, loc = self.hit(self.base + "/g-script?src=google&cmp=888&gclid=GCLIDSCRIPT")
        cid = re.search(r"tid=(ct[a-z2-7]{10})", loc).group(1)
        key = self.tracker_key()
        self.assertEqual(p.request.get(f"{self.base}/pb/{key}/clickbank?cid={cid}&amount=42&txid=GS1").text(), "ok")
        r = p.request.post(f"{self.base}/cost/{key}/google", data='{"currency":"USD","rows":[],"want_conversions":true}',
                           headers={"Content-Type": "application/json"}).json()
        mine = [x for x in r["conversions"] if x["gclid"] == "GCLIDSCRIPT"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["value"], "42.00")
        self.assertRegex(mine[0]["time"], r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}$")
        self.assertEqual(r["conversion_name"], "Cutti - Venda")
        ack = p.request.post(f"{self.base}/cost/{key}/google/ack", data='{"ids":["%s"]}' % mine[0]["id"], headers={"Content-Type": "application/json"})
        self.assertEqual(ack.text(), "ok 1")
        r2 = p.request.post(f"{self.base}/cost/{key}/google", data='{"currency":"USD","rows":[],"want_conversions":true}',
                            headers={"Content-Type": "application/json"}).json()
        self.assertFalse([x for x in r2["conversions"] if x["gclid"] == "GCLIDSCRIPT"])
        p.goto(self.base + "/tracking")
        self.assertIn("want_conversions: true", p.get_by_label("Script do Cutti").input_value())

    def test_t12_touch_prefetch_opens_right_page(self):
        p = self.page
        seen = []
        handler = lambda r: r.headers.get("x-cutti-prefetch") and seen.append(r.url)
        self.ctx.on("request", handler)
        try:
            p.goto(self.base + "/results")
            p.wait_for_function("navigator.serviceWorker.ready.then(() => true)")
            p.reload()  # the worker controls the page from the second load
            p.wait_for_function("!!navigator.serviceWorker.controller")
            link = p.locator(".sidebar nav").get_by_role("link", name="Vendas")
            link.dispatch_event("mousedown")
            p.wait_for_timeout(400)
            link.click()
            expect(p).to_have_url(re.compile(r"/sales$"))
            expect(p.get_by_role("heading", name="Vendas", exact=True)).to_be_visible()
            self.assertTrue(any(u.endswith("/sales") for u in seen), seen)
            # Back on Resumo, its filters still work (the page came whole, scripts included).
            p.locator(".sidebar nav").get_by_role("link", name="Resumo").click()
            expect(p).to_have_url(re.compile(r"/results$"))
        finally:
            self.ctx.remove_listener("request", handler)

    def test_t03_tracker_pages_fit_mobile(self):
        m = self.browser.new_context(viewport={"width": 390, "height": 844},
                                     storage_state=self.ctx.storage_state()).new_page()
        for path in ["/results", "/sales?p=today&network=clickadv", "/integrations", "/tracking", "/settings", "/links", "/domains"]:
            m.goto(self.base + path)
            self.assertLess(m.locator(".sidebar").bounding_box()["height"], 90, f"{path}: barra do topo alta demais")
            width = m.evaluate("document.documentElement.scrollWidth")
            self.assertLessEqual(width, 390, f"{path} rola para o lado no celular")
        m.context.close()

    # Layout
    def test_l1_mobile_width(self):
        m = self.browser.new_context(viewport={"width": 390, "height": 844},
                                     storage_state=self.ctx.storage_state()).new_page()
        m.goto(self.base + "/links")
        expect(m.get_by_role("button", name="Novo link").first).to_be_visible()
        width = m.evaluate("document.documentElement.scrollWidth")
        self.assertLessEqual(width, 390, "a página não pode rolar para o lado no celular")
        m.context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
