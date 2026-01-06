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
        const updateBanner = document.createElement('div');
        updateBanner.id = 'pwa-update-banner';
        updateBanner.innerHTML = `
      <style>
        #pwa-update-banner {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 16px 24px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          gap: 16px;
          z-index: 10000;
          animation: slideUp 0.3s ease;
          max-width: 90vw;
        }
        #pwa-update-banner button {
          background: white;
          color: #667eea;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        #pwa-update-banner button:hover {
          transform: scale(1.05);
        }
        #pwa-update-banner .dismiss {
          background: transparent;
          color: white;
          opacity: 0.8;
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
      <span>🚀 A new version is available!</span>
      <button onclick="location.reload()">Update Now</button>
      <button class="dismiss" onclick="this.parentElement.remove()">Later</button>
    `;
        document.body.appendChild(updateBanner);
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
            setTimeout(() => {
                showInstallPrompt();
            }, 30000);
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

        // Remove existing status indicator
        const existingIndicator = document.getElementById('connection-status');
        if (existingIndicator) existingIndicator.remove();

        if (!isOnline) {
            const indicator = document.createElement('div');
            indicator.id = 'connection-status';
            indicator.innerHTML = `
        <style>
          #connection-status {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #f56565;
            color: white;
            text-align: center;
            padding: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            z-index: 10001;
          }
        </style>
        <span>📡 You're offline. Some features may be unavailable.</span>
      `;
            document.body.prepend(indicator);
        }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Check on load
    updateOnlineStatus();

})();
