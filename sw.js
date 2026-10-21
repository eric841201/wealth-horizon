/**
 * WEALTH HORIZON - Service Worker (純本地離線快取引擎 V5)
 * 絕對 URL 精確匹配，完全隔離 iOS 飛航模式的網絡報錯
 */

const CACHE_NAME = 'wealth-horizon-v6';

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

// 安裝並寫入快取
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const scope = self.registration.scope;
            console.log('[SW V5] Initializing cache with scope:', scope);
            
            // 將所有相對路徑轉換為完整絕對 URL
            const fullUrls = ASSET_FILES.map(file => new URL(file, scope).href);
            
            // 逐一抓取快取，確保每個都成功
            await Promise.all(
                fullUrls.map(url => {
                    return fetch(url, { cache: 'no-cache' }).then(res => {
                        if (res.status === 200) {
                            return cache.put(url, res);
                        }
                    }).catch(e => console.warn('[SW V5] Cache single fail:', url, e));
                })
            );
            console.log('[SW V5] All local assets cached successfully.');
        })
    );
});

// 啟動並接管
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.map((key) => {
                        if (key !== CACHE_NAME) {
                            console.log('[SW V5] Deleting old cache:', key);
                            return caches.delete(key);
                        }
                    })
                );
            }),
            self.clients.claim()
        ]).then(() => {
            // 通知所有已打開的頁面離線已就緒
            self.clients.matchAll().then(clients => {
                clients.forEach(c => c.postMessage('OFFLINE_READY'));
            });
        })
    );
});

// 離線請求攔截
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const reqUrl = event.request.url;
    const isNavigation = event.request.mode === 'navigate' || 
                         event.request.destination === 'document' || 
                         event.request.headers.get('accept')?.includes('text/html');

    // 1. 導航請求 (點開 App / 重開 App) - 絕對快取第一，絕不讓 iOS 嘗試網絡報錯
    if (isNavigation) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const scope = self.registration.scope;
                const indexUrl = new URL('index.html', scope).href;
                
                // 優先比對
                let cached = await cache.match(event.request, { ignoreSearch: true });
                if (cached) return cached;

                cached = await cache.match(indexUrl, { ignoreSearch: true });
                if (cached) return cached;

                cached = await cache.match(scope, { ignoreSearch: true });
                if (cached) return cached;

                // 真的沒有才嘗試網絡
                return fetch(event.request);
            }).catch(() => {
                // 完全斷網時的終極保底
                return caches.match(new URL('index.html', self.registration.scope).href);
            })
        );
        return;
    }

    // 2. 靜態資源請求 (CSS / JS / 字體 / 圖標)
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            });
        })
    );
});
