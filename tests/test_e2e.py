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
        expect(p.locator(".toast-error")).to_contain_text("Ainda não chega neste app")

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
