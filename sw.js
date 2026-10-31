// Dugout Blood Bowl — fonctionnement hors ligne.
// Changez VERSION à chaque mise à jour des fichiers pour forcer le rafraîchissement.
const VERSION = "dugout-v20";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  // cache: "reload" : toujours prendre les fichiers frais sur GitHub, jamais ceux du cache du navigateur.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // Polices Google + bibliothèque Firebase (gstatic) gardées pour le hors-ligne.
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
  if (!sameOrigin && !fonts) return; // la synchro Google passe directement au réseau

  // Cache d'abord (démarrage instantané, même sans réseau), mise à jour en arrière-plan.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    const network = fetch(sameOrigin ? new Request(req, { cache: "no-cache" }) : req).then(res => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    if (res) return res;
    if (req.mode === "navigate") return cache.match("./index.html");
    return new Response("", { status: 504 });
  }));
});
