// Demo service worker: answers cart requests itself, so a browser that lets it run would never
// send them to the network. FlowCheck blocks service workers in test browsers (criterion 31).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname === '/api/cart/items') {
    event.respondWith(
      new Response(JSON.stringify({ fromServiceWorker: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }
});
