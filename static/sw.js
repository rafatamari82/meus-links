// Cutti service worker: shows sale notifications, opens the panel when tapped,
// and starts loading a panel page as soon as a finger touches its link.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Cutti", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Cutti", {
    body: d.body || "", icon: "/static/logo-192.png", badge: "/static/logo-192.png",
    tag: d.tag || undefined, data: { url: d.url || "/sales" },
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/sales";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ("focus" in list[i]) { list[i].navigate(url); return list[i].focus(); }
    }
    return self.clients.openWindow(url);
  }));
});

// Pages fetched on touch, kept a few seconds for the navigation that follows.
var held = {};
var HOLD_MS = 8000;
self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type !== "prefetch" || typeof d.url !== "string") return;
  var u;
  try { u = new URL(d.url); } catch (err) { return; }
  if (u.origin !== self.location.origin) return;
  var now = Date.now();
  for (var k in held) if (now - held[k].at > HOLD_MS) delete held[k];
  if (held[u.href]) return;
  var p = fetch(u.href, { credentials: "same-origin", headers: { "X-Cutti-Prefetch": "1" } });
  p.catch(function () {});
  held[u.href] = { at: now, p: p };
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") { held = {}; return; } // something changed: pages fetched earlier may be stale
  if (req.mode !== "navigate") return;
  var h = held[req.url];
  if (!h) return;
  delete held[req.url];
  if (Date.now() - h.at > HOLD_MS) return;
  e.respondWith(h.p.then(function (r) {
    // A navigation cannot be answered with a followed redirect or an error; load it normally then.
    return r.ok && !r.redirected && r.type === "basic" ? r : fetch(req);
  }).catch(function () { return fetch(req); }));
});
