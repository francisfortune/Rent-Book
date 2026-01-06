// RentBook Service Worker - Production Level PWA
const CACHE_NAME = 'rentbook-v1.0.0';
const DYNAMIC_CACHE = 'rentbook-dynamic-v1';

// Core assets to cache for offline use
const STATIC_ASSETS = [
    '/',
    '/index.html',
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
    '/assets/js/shared.js',
    '/assets/imgs/logo.png',
    '/assets/imgs/logo.ico',
    '/manifest.json'
];

// External CDN resources to cache
const CDN_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/ionicons@5.5.2/dist/ionicons/ionicons.esm.js',
    'https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[ServiceWorker] Caching static assets');
                // Cache static assets - don't fail if some assets are missing
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err => console.log(`[ServiceWorker] Failed to cache: ${url}`))
                    )
                );
            })
            .then(() => {
                // Cache CDN assets separately
                return caches.open(CACHE_NAME).then(cache => {
                    return Promise.allSettled(
                        CDN_ASSETS.map(url =>
                            fetch(url, { mode: 'cors' })
                                .then(response => {
                                    if (response.ok) {
                                        return cache.put(url, response);
                                    }
                                })
                                .catch(err => console.log(`[ServiceWorker] Failed to cache CDN: ${url}`))
                        )
                    );
                });
            })
            .then(() => {
                console.log('[ServiceWorker] Installation complete');
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating...');

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME && name !== DYNAMIC_CACHE)
                        .map(name => {
                            console.log(`[ServiceWorker] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[ServiceWorker] Activation complete');
                return self.clients.claim();
            })
    );
});

// Fetch event - Network first with cache fallback for API, Cache first for static
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip Firebase/external API requests (let them go to network)
    if (url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('firebase.google.com') ||
        url.hostname.includes('firebaseio.com')) {
        return;
    }

    // For CDN assets - Cache first, then network
    if (url.hostname !== location.hostname) {
        event.respondWith(
            caches.match(request)
                .then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    return fetch(request)
                        .then(response => {
                            if (response.ok) {
                                const responseClone = response.clone();
                                caches.open(DYNAMIC_CACHE)
                                    .then(cache => cache.put(request, responseClone));
                            }
                            return response;
                        });
                })
        );
        return;
    }

    // For local assets - Network first with cache fallback (for fresh data)
    event.respondWith(
        fetch(request)
            .then(response => {
                // Clone the response for caching
                const responseClone = response.clone();

                caches.open(DYNAMIC_CACHE)
                    .then(cache => {
                        cache.put(request, responseClone);
                    });

                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(request)
                    .then(cachedResponse => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }

                        // Return offline page for navigation requests
                        if (request.mode === 'navigate') {
                            return caches.match('/offline.html');
                        }

                        // Return a placeholder for images
                        if (request.destination === 'image') {
                            return new Response(
                                '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#ddd" width="200" height="200"/><text fill="#999" x="100" y="100" text-anchor="middle" dy=".3em">Offline</text></svg>',
                                { headers: { 'Content-Type': 'image/svg+xml' } }
                            );
                        }

                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});

// Background sync for offline bookings
self.addEventListener('sync', (event) => {
    console.log('[ServiceWorker] Background sync:', event.tag);

    if (event.tag === 'sync-bookings') {
        event.waitUntil(syncBookings());
    }
});

// Sync pending bookings when back online
async function syncBookings() {
    try {
        // Get pending bookings from IndexedDB
        const pendingBookings = await getPendingBookings();

        for (const booking of pendingBookings) {
            // Attempt to sync each booking
            // This would integrate with your Firebase service
            console.log('[ServiceWorker] Syncing booking:', booking.id);
        }
    } catch (error) {
        console.error('[ServiceWorker] Sync failed:', error);
    }
}

// Helper to get pending bookings (placeholder - implement with IndexedDB)
async function getPendingBookings() {
    return [];
}

// Push notification support
self.addEventListener('push', (event) => {
    console.log('[ServiceWorker] Push received');

    const options = {
        body: event.data ? event.data.text() : 'New notification from RentBook',
        icon: '/assets/imgs/logo.png',
        badge: '/assets/imgs/logo.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            { action: 'view', title: 'View' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('RentBook', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('[ServiceWorker] Notification clicked:', event.action);

    event.notification.close();

    if (event.action === 'view') {
        event.waitUntil(
            clients.openWindow('/bookings.html')
        );
    }
});

// Periodic background sync for reminders
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-reminders') {
        event.waitUntil(checkReminders());
    }
});

async function checkReminders() {
    // Check for upcoming return dates and send notifications
    console.log('[ServiceWorker] Checking reminders...');
}

console.log('[ServiceWorker] Service Worker loaded');
