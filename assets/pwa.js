// PWA Registration Script — FIXED (no reload loop, no repeating update banner)
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
    // ============================================
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                navigator.serviceWorker
                    .register('/sw.js', { scope: '/' })
                    .then((registration) => {
                        console.log('[PWA] ✅ SW registered:', registration.scope);

                        // If a SW is already waiting, prompt immediately
                        if (registration.waiting && navigator.serviceWorker.controller) {
                            showUpdateNotification(registration);
                        }

                        // Detect new SW being installed
                        registration.addEventListener('updatefound', () => {
                            const newWorker = registration.installing;
                            if (!newWorker) return;
                            console.log('[PWA] New SW found');

                            newWorker.addEventListener('statechange', () => {
                                console.log('[PWA] SW state:', newWorker.state);
                                if (
                                    newWorker.state === 'installed' &&
                                    navigator.serviceWorker.controller
                                ) {
                                    showUpdateNotification(registration);
                                }
                            });
                        });

                        // Poll for updates every 30 minutes (silent)
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

        // ✅ SINGLE controllerchange listener — NO auto-reload
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            console.log('[PWA] Controller changed (new SW active)');
            // Do NOT reload here. The update button already reloads once.
        });
    }

    // ============================================
    // UPDATE BANNER — actually activates waiting SW
    // ============================================
    function showUpdateNotification(registration) {
        if (document.getElementById('pwa-update-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-update-banner';
        banner.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: #1a202c; color: white; padding: 16px 24px; border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3); z-index: 10001;
            display: flex; align-items: center; gap: 16px; max-width: 90%;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        banner.innerHTML = `
            <span>🚀 New version available</span>
            <button id="pwa-update-btn" style="
                background: purple; color: white; border: none;
                padding: 8px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;
            ">Update</button>
            <button id="pwa-dismiss-btn" style="
                background: transparent; color: #a0aec0; border: none;
                cursor: pointer; font-size: 1.2rem;
            ">✕</button>
        `;
        document.body.appendChild(banner);

        document.getElementById('pwa-update-btn').addEventListener('click', async () => {
            const btn = document.getElementById('pwa-update-btn');
            btn.disabled = true;
            btn.textContent = 'Updating…';

            try {
                let reg = registration;
                if (!reg) reg = await navigator.serviceWorker.getRegistration();

                if (reg && reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });

                    const reloadOnce = () => window.location.reload();
                    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, {
                        once: true,
                    });
                    setTimeout(reloadOnce, 1500); // fallback
                } else {
                    window.location.reload();
                }
            } catch (e) {
                console.warn('[PWA] Update failed, reloading anyway:', e);
                window.location.reload();
            }
        });

        document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
            banner.remove();
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