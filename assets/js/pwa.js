// PWA Registration Script
// Add this script to all main pages for PWA functionality

(function () {
    'use strict';

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js', {
                    scope: '/'
                });

                console.log('[PWA] Service Worker registered successfully:', registration.scope);

                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('[PWA] New service worker found, installing...');

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New update available
                            showUpdateNotification();
                        }
                    });
                });

            } catch (error) {
                console.error('[PWA] Service Worker registration failed:', error);
            }
        });

        // Handle controller change (when new SW takes over)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[PWA] New service worker activated, page may need refresh');
        });
    }

    // Show update notification
function showUpdateNotification() {
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.innerHTML = `
        🚀 New version available
        <button onclick="location.reload()">Update</button>
        <button onclick="this.parentElement.remove()">Later</button>
    `;
    document.body.appendChild(banner);
}
    // Install prompt handling
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('[PWA] Install prompt available');
        e.preventDefault();
        deferredPrompt = e;

        // Show install button if exists
        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) {
            installBtn.style.display = 'block';
            installBtn.addEventListener('click', promptInstall);
        }

        // Auto-show install prompt after 30 seconds on first visit
        const hasPrompted = localStorage.getItem('pwa-install-prompted');
        if (!hasPrompted) {
          // Only show install prompt when user interacts
        }
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed successfully');
        deferredPrompt = null;
        localStorage.setItem('pwa-installed', 'true');

        // Hide install UI
        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) installBtn.style.display = 'none';

        const installBanner = document.getElementById('pwa-install-banner');
        if (installBanner) installBanner.remove();
    });

    // Prompt install
    async function promptInstall() {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] Install prompt outcome:', outcome);

        deferredPrompt = null;
        localStorage.setItem('pwa-install-prompted', 'true');
    }

    // Show install prompt UI
    function showInstallPrompt() {
        if (!deferredPrompt) return;
        if (localStorage.getItem('pwa-installed')) return;

        const installBanner = document.createElement('div');
        installBanner.id = 'pwa-install-banner';
        installBanner.innerHTML = `
      <style>
        #pwa-install-banner {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: white;
          padding: 20px 24px;
          border-radius: 16px;
          box-shadow: 0 15px 50px rgba(0, 0, 0, 0.2);
          display: flex;
          align-items: center;
          gap: 16px;
          z-index: 10000;
          animation: slideUp 0.4s ease;
          max-width: 90vw;
        }
        #pwa-install-banner .icon {
          font-size: 2.5rem;
        }
        #pwa-install-banner .content {
          flex: 1;
        }
        #pwa-install-banner h4 {
          font-weight: 700;
          margin-bottom: 4px;
          color: #1a202c;
        }
        #pwa-install-banner p {
          font-size: 0.9rem;
          color: #718096;
        }
        #pwa-install-banner .install-btn {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        #pwa-install-banner .install-btn:hover {
          transform: scale(1.05);
        }
        #pwa-install-banner .close-btn {
          position: absolute;
          top: 8px;
          right: 12px;
          background: none;
          border: none;
          font-size: 1.2rem;
          color: #a0aec0;
          cursor: pointer;
        }
        @keyframes slideUp {
          from {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }
        }
      </style>
      <button class="close-btn" onclick="this.parentElement.remove(); localStorage.setItem('pwa-install-prompted', 'true');">×</button>
      <div class="icon">📱</div>
      <div class="content">
        <h4>Install RentBook</h4>
        <p>Add to your home screen for quick access</p>
      </div>
      <button class="install-btn" id="install-now-btn">Install</button>
    `;
        document.body.appendChild(installBanner);

        document.getElementById('install-now-btn').addEventListener('click', () => {
            promptInstall();
            installBanner.remove();
        });
    }

    // Expose for manual triggering
    window.promptPWAInstall = promptInstall;
    window.showInstallPrompt = showInstallPrompt;

    // Online/Offline status handling
function updateOnlineStatus() {
    const isOnline = navigator.onLine;

    let bar = document.getElementById('connection-bar');

    // create if not exists
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'connection-bar';
        document.body.appendChild(bar);
    }

    // STYLE (applied via JS so no CSS file needed)
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.right = '0';
    bar.style.zIndex = '99999';
    bar.style.padding = '12px';
    bar.style.textAlign = 'center';
    bar.style.fontFamily = 'sans-serif';
    bar.style.fontWeight = '600';
    bar.style.transition = 'all 0.3s ease';

    if (isOnline) {
        bar.style.background = '#16a34a'; // green
        bar.style.color = 'white';
        bar.innerHTML = '🟢 You are back online';

        setTimeout(() => {
            bar.style.transform = 'translateY(-100%)';
            bar.style.opacity = '0';
        }, 2000);

        setTimeout(() => {
            if (bar) bar.remove();
        }, 2600);

    } else {
        bar.style.background = '#dc2626'; // red
        bar.style.color = 'white';
        bar.style.transform = 'translateY(0)';
        bar.style.opacity = '1';
        bar.innerHTML = '🔴 No internet connection - you are offline';
    }
}


    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Check on load
    updateOnlineStatus();

})();
