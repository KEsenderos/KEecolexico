// sw.js — アプリ本体をiPhoneに保存して、通信なしでも開けるようにする
var CACHE_VERSION = '0.7.2';                 // APP_VERSION と同じ値にする
var CACHE_PREFIX = 'kx-cache-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
var APP_SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './css/style.css',
  './js/config.js', './js/utils.js', './js/stretch.js', './js/engine.js', './js/mediaSession.js',
  './js/article.js', './js/lexicon.js', './js/db.js', './js/drive.js', './js/sync.js', './js/progress.js', './js/state.js',
  './js/ui.js', './js/main.js', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.svg', './icons/favicon-32.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (c) { return c.addAll(APP_SHELL_FILES); }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME; })
                           .map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  if (e.request.url.indexOf(self.location.origin) !== 0) return;   // GASなど外部はそのまま通す
  e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
});
