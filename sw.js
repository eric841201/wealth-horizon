/**
 * WEALTH HORIZON - Service Worker (純本地離線快取引擎 V4)
 * 動態適配 GitHub Pages 子路徑，提供 100% 離線秒開導航保底
 */

const CACHE_NAME = 'wealth-horizon-v4';

// 自動獲取當前 SW 所在基礎路徑 (例如 '/wealth-horizon/')
const BASE_PATH = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);

const ASSET_FILES = [
    '',
    'index.html',
    'css/style.css',
    'js/app.js',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon.svg',
    'vendor/bootstrap/bootstrap.min.css',
    'vendor/bootstrap/bootstrap.bundle.min.js',
    'vendor/bootstrap-icons/bootstrap-icons.min.css',
    'vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
    'vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
    'vendor/chartjs/chart.umd.min.js',
    'vendor/confetti/confetti.browser.min.js'
];

const FULL_ASSET_URLS = ASSET_FILES.map(file => BASE_PATH + file);

// 安裝並預快取所有靜態資源
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW V4] Caching assets for base path:', BASE_PATH);
            return cache.addAll(FULL_ASSET_URLS);
        }).catch((err) => {
            console.error('[SW V4] Cache addAll error:', err);
        })
    );
});

// 啟動並清理舊版本快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.map((key) => {
                        if (key !== CACHE_NAME) {
                            console.log('[SW V4] Deleting old cache:', key);
                            return caches.delete(key);
                        }
                    })
                );
            }),
            self.clients.claim()
        ])
    );
});

// 離線請求攔截 (Cache-First + 絕對導航保底)
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isNavigation = event.request.mode === 'navigate' || 
                         event.request.destination === 'document' || 
                         event.request.headers.get('accept')?.includes('text/html');

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            // 導航請求若未直接命中，以 index.html 保底
            if (isNavigation) {
                return caches.match(BASE_PATH + 'index.html').then((fallback) => {
                    return fallback || caches.match(BASE_PATH) || fetch(event.request);
                });
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
            });
        }).catch(() => {
            // 斷網離線保底
            if (isNavigation) {
                return caches.match(BASE_PATH + 'index.html') || caches.match(BASE_PATH);
            }
        })
    );
});
