// MUST BE LINE 1: Import OneSignal ServiceWorker SDK
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

// Prevent multiple installations
let isInstalling = false;

// Message handler for Service Worker updates
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

const CACHE_NAME = 'Tracknrent-v1.0.5';
const DYNAMIC_CACHE = 'Tracknrent-dynamic-v1';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/offline.html',
    '/dashboard.html',
    '/bookings.html',
    '/add.html',
    '/inventory.html',
    '/settings.html',
    '/log-in.html',
    '/signup.html',
    '/setup.html',
    '/styles.css',
    '/assets/css/booking.css',
    '/assets/css/inventory.css',
    '/assets/js/firebase.js',
    '/assets/js/auth.js',
    '/assets/js/dashboard.js',
    '/assets/js/bookings.js',
    '/assets/js/add.js',
    '/assets/js/inventory.js',
    '/assets/js/avatar.js',
    '/assets/js/onboarding.js',
    '/assets/js/shared.js',
    '/assets/imgs/logo.png',
    '/assets/imgs/logo.ico',
    '/manifest.json'
];

// Install event with lock to prevent loops
self.addEventListener('install', (event) => {
    if (isInstalling) {
        event.waitUntil(Promise.resolve());
        return;
    }
    isInstalling = true;
    
    console.log('[ServiceWorker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err => console.log(`[ServiceWorker] Failed to cache: ${url}`))
                    )
                );
            })
            .then(() => {
                console.log('[ServiceWorker] Installation complete');
                return self.skipWaiting();
            })
            .finally(() => {
                isInstalling = false;
            })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME && name !== DYNAMIC_CACHE)
                        .map(name => caches.delete(name))
                );
            })
            .then(() => {
                return self.clients.claim();
            })
    );
});

// Fetch event with network-first strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    // Skip Firebase, Google APIs, OneSignal
    if (url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('firebase.google.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('onesignal.com')) {
        return;
    }

    // Network-first for all requests
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok && response.type === 'basic') {
                    const responseClone = response.clone();
                    caches.open(DYNAMIC_CACHE).then(cache => {
                        cache.put(request, responseClone).catch(() => {});
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(request).then(cachedResponse => {
                    if (cachedResponse) return cachedResponse;
                    if (request.mode === 'navigate') return caches.match('/offline.html');
                    return new Response('Offline', { status: 503 });
                });
            })
    );
});

// Sync event
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-bookings') {
        event.waitUntil(syncBookings());
    }
});

async function syncBookings() {
    // Implement sync logic if needed
    return [];
}

console.log('[ServiceWorker] Service Worker loaded');