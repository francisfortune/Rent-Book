// PWA Registration Script — FINAL
// Silent auto-updates. No more "New version available" banner spam.
(function () {
    'use strict';

    if (window.__pwa_initialized) {
        console.log('[PWA] Already initialized, skipping');
        return;
    }
    window.__pwa_initialized = true;

    // ✅ EMERGENCY KILL-SWITCH: visit yoursite.com/?killsw=1 once
    if (new URLSearchParams(location.search).has('killsw')) {
        (async () => {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const r of regs) await r.unregister();
                const keys = await caches.keys();
                for (const k of keys) await caches.delete(k);
                console.log('[PWA] 🧨 Kill-switch executed');
                alert('Service worker + caches cleared. Reloading clean.');
                location.href = location.pathname;
            } catch (e) {
                console.error('[PWA] Kill-switch failed:', e);
            }
        })();
        return;
    }

    const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '';

    // ============================================
    // SERVICE WORKER REGISTRATION
    // No update banner. New SWs auto-activate via
    // skipWaiting() + clients.claim() in sw.js.
    // ============================================
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                navigator.serviceWorker
                    .register('/sw.js', { scope: '/' })
                    .then((registration) => {
                        console.log('[PWA] ✅ SW registered:', registration.scope);

                        // Silent background update check every 30 min
                        setInterval(() => {
                            registration.update().catch(() => {});
                        }, 30 * 60 * 1000);
                    })
                    .catch((error) => {
                        if (isLocalhost) {
                            console.log('[PWA] ⏭️ SW skipped on localhost');
                        } else {
                            console.warn('[PWA] SW registration failed:', error.message);
                        }
                    });
            }, 500);
        });

        // No auto-reload on controllerchange. The SW handles taking over.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[PWA] Controller changed (new SW active)');
        });
    }

    // ============================================
    // INSTALL PROMPT
    // ============================================
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('[PWA] Install prompt available');
        e.preventDefault();
        deferredPrompt = e;

        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) {
            installBtn.style.display = 'block';
            installBtn.addEventListener('click', promptInstall);
        }

        const hasPrompted = localStorage.getItem('pwa-install-prompted');
        if (!hasPrompted && !isLocalhost) {
            setTimeout(showInstallPrompt, 30000);
        }
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] ✅ App installed');
        deferredPrompt = null;
        localStorage.setItem('pwa-installed', 'true');
        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) installBtn.style.display = 'none';
        const installBanner = document.getElementById('pwa-install-banner');
        if (installBanner) installBanner.remove();
    });

    async function promptInstall() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] Install prompt outcome:', outcome);
        deferredPrompt = null;
        localStorage.setItem('pwa-install-prompted', 'true');
    }

    function showInstallPrompt() {
        if (!deferredPrompt) return;
        if (localStorage.getItem('pwa-installed') === 'true') return;
        if (document.getElementById('pwa-install-banner')) return;

        const installBanner = document.createElement('div');
        installBanner.id = 'pwa-install-banner';
        installBanner.innerHTML = `
            <style>
                #pwa-install-banner {
                    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
                    background: white; padding: 20px 24px; border-radius: 16px;
                    box-shadow: 0 15px 50px rgba(0, 0, 0, 0.2);
                    display: flex; align-items: center; gap: 16px; z-index: 10000;
                    animation: slideUp 0.4s ease; max-width: 90vw;
                }
                #pwa-install-banner .icon { font-size: 2.5rem; }
                #pwa-install-banner .content { flex: 1; }
                #pwa-install-banner h4 { font-weight: 700; margin-bottom: 4px; color: #1a202c; }
                #pwa-install-banner p { font-size: 0.9rem; color: #4a5568; }
                #pwa-install-banner .install-btn {
                    background: purple; color: white; border: none;
                    padding: 12px 24px; border-radius: 10px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s ease;
                }
                #pwa-install-banner .install-btn:hover { transform: scale(1.05); }
                #pwa-install-banner .close-btn {
                    background: none; border: none; font-size: 1.5rem;
                    color: #a0aec0; cursor: pointer; padding: 0 8px;
                }
                @keyframes slideUp {
                    from { transform: translateX(-50%) translateY(100px); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
            </style>
            <button class="close-btn" id="pwa-install-close">×</button>
            <div class="icon">📱</div>
            <div class="content">
                <h4>Install Tracknrent</h4>
                <p>Add to your home screen for quick access</p>
            </div>
            <button class="install-btn" id="install-now-btn">Install</button>
        `;
        document.body.appendChild(installBanner);

        document.getElementById('install-now-btn').addEventListener('click', () => {
            promptInstall();
            installBanner.remove();
        });
        document.getElementById('pwa-install-close').addEventListener('click', () => {
            localStorage.setItem('pwa-install-prompted', 'true');
            installBanner.remove();
        });
    }

    window.promptPWAInstall = promptInstall;
    window.showInstallPrompt = showInstallPrompt;

    // ============================================
    // ONLINE / OFFLINE INDICATOR
    // ============================================
    function updateOnlineStatus() {
        const isOnline = navigator.onLine;
        const existing = document.getElementById('connection-status');
        if (existing) existing.remove();

        if (!isOnline) {
            const indicator = document.createElement('div');
            indicator.id = 'connection-status';
            indicator.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0;
                background: #e41515ff; color: white; text-align: center;
                padding: 8px; font-size: 0.9rem; font-weight: 500; z-index: 10001;
            `;
            indicator.textContent = "📡 You're offline. Some features may be unavailable.";
            document.body.prepend(indicator);
        }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    console.log('[PWA] ✅ Initialized successfully');
})();