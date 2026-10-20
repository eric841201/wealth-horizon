/**
 * WEALTH HORIZON - Service Worker (純本地離線快取引擎 V3)
 * 100% 同源離線封包，徹底消除 iOS 飛航模式網路提示
 */

const CACHE_NAME = 'wealth-horizon-v3';

const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    './vendor/bootstrap/bootstrap.min.css',
    './vendor/bootstrap/bootstrap.bundle.min.js',
    './vendor/bootstrap-icons/bootstrap-icons.min.css',
    './vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
    './vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
    './vendor/chartjs/chart.umd.min.js',
    './vendor/confetti/confetti.browser.min.js'
];

// 安裝並預快取所有同源靜態檔案
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching 100% local assets...');
            return cache.addAll(STATIC_ASSETS);
        }).catch((err) => {
            console.error('[Service Worker] Cache addAll error:', err);
        })
    );
});

// 啟動並立即接管所有客戶端，清理舊版本快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.map((key) => {
                        if (key !== CACHE_NAME) {
                            console.log('[Service Worker] Deleting old cache:', key);
                            return caches.delete(key);
                        }
                    })
                );
            }),
            self.clients.claim()
        ])
    );
});

// 離線請求攔截 (Cache-First 嚴格本地策略)
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // 處理導航請求 (點開 App / 重新整理)
    if (event.request.mode === 'navigate') {
        event.respondWith(
            caches.match('./index.html').then((cached) => {
                return cached || fetch(event.request).catch(() => caches.match('./index.html'));
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200) {
                    return networkResponse;
                }
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return networkResponse;
            }).catch(() => {
                // 離線降級
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
