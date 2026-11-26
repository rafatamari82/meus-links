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
