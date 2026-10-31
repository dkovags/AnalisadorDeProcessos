// Service worker do Analisador de Processos: deixa o app abrir sem internet.
// Página: rede primeiro, conferida no site a cada abertura (para receber atualizações); cópia salva se estiver offline.
// Arquivos com hash no nome (JS, CSS, fontes, o leitor de PDF): cópia salva primeiro, pois nunca mudam.
// Os dados (processos e arquivos) ficam no IndexedDB e não passam por aqui.
const CACHE = "autos-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("autos-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // aviso de versão nova: sempre do site
  if (url.pathname.endsWith("/version.json")) return;
  const immutable = url.pathname.includes("/assets/");
  if (immutable) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }
  // a página sempre conferida no site (sem usar a cópia do navegador), para não abrir uma versão antiga depois de uma publicação
  const fresh = req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req);
  event.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "./" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "./" : req).then((hit) => hit || caches.match("./"))),
  );
});
