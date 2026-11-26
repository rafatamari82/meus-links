(function () {
  "use strict";
  var live = function (msg) {
    var el = document.getElementById("live");
    if (el) { el.textContent = ""; setTimeout(function () { el.textContent = msg; }, 30); }
  };
  function copy(text, btn) {
    var done = function () {
      live("Link copiado");
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = "Copiado";
      btn.classList.add("is-done");
      setTimeout(function () { btn.textContent = old; btn.classList.remove("is-done"); }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    } else { fallback(text); done(); }
  }
  function fallback(text) {
    var t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.className = "sr-only";
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(t);
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-copy]");
    if (c) { e.preventDefault(); copy(c.getAttribute("data-copy"), c); return; }
    var o = e.target.closest("[data-open]");
    if (o) {
      var d = document.getElementById(o.getAttribute("data-open"));
      if (d && d.showModal) { d.showModal(); var f = d.querySelector("input:not([type=hidden])"); if (f) f.focus(); }
      return;
    }
    var x = e.target.closest("[data-close]");
    if (x) { var dlg = x.closest("dialog"); if (dlg) dlg.close(); }
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    var msg = f.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    var b = f.querySelector("button[type=submit]");
    if (b) { b.setAttribute("aria-busy", "true"); b.classList.add("is-loading"); }
    var cp = f.querySelector("[data-copy-after]");
    try { sessionStorage.setItem("copyAfter", cp && cp.checked ? "1" : "0"); } catch (err) {}
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches("[data-autosubmit]")) e.target.form.submit();
    if (e.target.matches("[data-geo-mode]")) {
      var picker = e.target.closest("details").querySelector(".geo-picker");
      if (picker) picker.hidden = e.target.value === "off";
    }
    if (e.target.matches("[data-network]")) {
      var opt = e.target.selectedOptions[0];
      var inp = e.target.form.querySelector("[name=sub_param]");
      if (opt && inp) inp.value = opt.getAttribute("data-param") || "";
    }
    if (e.target.matches("[data-range-preset]")) {
      var box2 = e.target.form.querySelector(".range-custom");
      if (box2) box2.hidden = e.target.value !== "custom";
      if (e.target.value !== "custom") e.target.form.submit();
    } else if (e.target.matches("[data-autosubmit-select]")) {
      e.target.form.submit();
    }
    if (e.target.matches("input[name=geo_countries]")) {
      var box = e.target.closest(".geo-picker");
      var n = box.querySelectorAll("input[name=geo_countries]:checked").length;
      var out = box.querySelector("[data-geo-count]");
      if (out) out.textContent = n;
    }
  });
  document.addEventListener("input", function (e) {
    if (!e.target.matches("[data-geo-filter]")) return;
    var q = e.target.value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    e.target.closest(".geo-picker").querySelectorAll(".geo-item").forEach(function (item) {
      var name = item.getAttribute("data-name").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      item.hidden = q && name.indexOf(q) < 0;
    });
  });
  // App Cutti: service worker and push notifications.
  var canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if ("serviceWorker" in navigator && document.body && document.body.classList.contains("panel")) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }
  function keyBytes(k) {
    var s = atob(k.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((k.length + 3) % 4));
    var a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function deviceLabel() {
    var ua = navigator.userAgent;
    if (/iphone/i.test(ua)) return "iPhone";
    if (/ipad/i.test(ua)) return "iPad";
    if (/android/i.test(ua)) return "Android";
    if (/mac/i.test(ua)) return "Mac";
    if (/windows/i.test(ua)) return "Windows";
    return "Aparelho";
  }
  function setupPush() {
    var form = document.querySelector("[data-push]");
    if (!form) return;
    var btn = form.querySelector("[data-push-enable]");
    var status = form.querySelector("[data-push-status]");
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    if (!canPush) {
      btn.disabled = true;
      status.textContent = ios && !standalone
        ? "No iPhone, primeiro adicione o Cutti à Tela de Início e abra pelo ícone. Depois toque aqui."
        : "Este navegador não aceita notificações. Use o Chrome no Android ou o app instalado no iPhone.";
      return;
    }
    btn.addEventListener("click", function () {
      btn.classList.add("is-loading");
      status.textContent = "Pedindo permissão…";
      Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") throw new Error("Você não permitiu as notificações. Libere nas configurações do aparelho e tente de novo.");
        return navigator.serviceWorker.register("/sw.js").then(function () { return navigator.serviceWorker.ready; });
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(form.getAttribute("data-push-key")) });
        });
      }).then(function (sub) {
        var j = sub.toJSON();
        form.elements.endpoint.value = j.endpoint;
        form.elements.p256dh.value = j.keys.p256dh;
        form.elements.auth.value = j.keys.auth;
        form.elements.label.value = deviceLabel();
        form.submit();
      }).catch(function (err) {
        btn.classList.remove("is-loading");
        status.textContent = err && err.message && /permit|Libere/.test(err.message) ? err.message : "Não consegui ativar: " + (err && err.message || "erro");
      });
    });
  }
  document.addEventListener("DOMContentLoaded", setupPush);
  // Open the collapsed box a link points into (e.g. /tracking#google after connecting).
  document.addEventListener("DOMContentLoaded", function () {
    if (!location.hash) return;
    var el = document.getElementById(location.hash.slice(1));
    for (var d = el && el.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
    if (el) el.scrollIntoView();
  });

  // Notification text editor: live preview and variable chips.
  var lastTpl = null;
  function renderTpl(tpl, vars) {
    var out = tpl.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
    return out.split(/\s*·\s*/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !/^(pedido|clique)$/i.test(x); }).join(" · ").replace(/\s{2,}/g, " ").trim();
  }
  function refreshPreview(form) {
    var el = document.getElementById("tpl-sample");
    if (!el) return;
    var sample = JSON.parse(el.textContent);
    ["sale", "refund"].forEach(function (kind) {
      var vars = Object.assign({}, sample, kind === "refund" ? { emoji: "↩️", tipo: "Reembolso" } : {});
      var box = form.querySelector('[data-preview="' + kind + '"]');
      box.querySelector("[data-preview-title]").textContent = renderTpl(form.elements[kind + "_title"].value, vars) || "Cutti";
      box.querySelector("[data-preview-body]").textContent = renderTpl(form.elements[kind + "_body"].value, vars);
    });
  }
  document.addEventListener("input", function (e) {
    if (e.target.matches("[data-tpl]")) { lastTpl = e.target; refreshPreview(e.target.form); }
  });
  document.addEventListener("focusin", function (e) { if (e.target.matches("[data-tpl]")) lastTpl = e.target; });
  document.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-var]");
    if (!chip) return;
    var form = chip.closest("form");
    var inp = lastTpl && lastTpl.form === form ? lastTpl : form.querySelector("[data-tpl]");
    var v = chip.getAttribute("data-var");
    var at = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    inp.value = inp.value.slice(0, at) + v + inp.value.slice(inp.selectionEnd == null ? at : inp.selectionEnd);
    inp.focus();
    inp.setSelectionRange(at + v.length, at + v.length);
    lastTpl = inp;
    refreshPreview(form);
  });

  document.addEventListener("DOMContentLoaded", function () {
    var d = document.querySelector("dialog[data-open-on-load]");
    if (d && d.showModal) {
      d.showModal();
      var bad = d.querySelector("[aria-invalid=true]") || d.querySelector("input:not([type=hidden])");
      if (bad) bad.focus();
    }
    var row = document.querySelector("tr.is-new");
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      var want = "1";
      try { want = sessionStorage.getItem("copyAfter") || "1"; sessionStorage.removeItem("copyAfter"); } catch (err) {}
      var btn = row.querySelector("[data-copy]");
      if (btn && want === "1") copy(btn.getAttribute("data-copy"), btn);
    }
    setTimeout(function () {
      document.querySelectorAll(".toast").forEach(function (t) { t.classList.add("is-hiding"); });
    }, 5000);
  });
})();
