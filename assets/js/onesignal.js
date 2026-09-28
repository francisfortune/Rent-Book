// ============================================
// ONESIGNAL v16 — COMPLETE FIX
// ============================================

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

// ✅ Detect if running on localhost
const isLocalhost = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname === '';

// ============================================
// ✅ HELPER: Wait for OneSignal SDK to be ready
// ============================================
function waitForOneSignal(timeoutMs = 3000) {
    return new Promise((resolve) => {
        if (window.OneSignal && typeof window.OneSignal.User !== 'undefined') {
            return resolve(true);
        }

        let elapsed = 0;
        const interval = 100;

        const timer = setInterval(() => {
            elapsed += interval;

            if (window.OneSignal && typeof window.OneSignal.User !== 'undefined') {
                clearInterval(timer);
                resolve(true);
            } else if (elapsed >= timeoutMs) {
                clearInterval(timer);
                resolve(false);
            }
        }, interval);
    });
}

// ============================================
// ✅ HELPER: Normalize permission (string OR boolean)
// ============================================
function isPermissionGranted(perm) {
    return perm === 'granted' || perm === true;
}

// ============================================
// ✅ HELPER: Get OneSignal user ID (v16 property)
// ============================================
function getOneSignalUserId() {
    try {
        // v16: it's a property, not a method
        return window.OneSignal?.User?.onesignalId || null;
    } catch (err) {
        console.warn('[OneSignal] Failed to get user ID:', err.message);
        return null;
    }
}

// ============================================
// ✅ MAIN: sendPush — SDK first, then serverless
// ============================================
export async function sendPush(message, url = "/dashboard.html") {
    // Skip on localhost
    if (isLocalhost) {
        console.log('[OneSignal] ⏭️ Skipping push on localhost');
        return { success: true, message: 'Skipped - localhost' };
    }

    console.log('[OneSignal] 📨 Sending push:', { message, url });

    // ============================================
    // ✅ STRATEGY 1: Try OneSignal SDK (instant)
    // ============================================
    try {
        const sdkReady = await waitForOneSignal(3000);

        if (sdkReady && window.OneSignal) {
            const OneSignal = window.OneSignal;

            // ✅ v16: permission is a property (may be string or boolean)
            const rawPermission = OneSignal.Notifications.permission;
            const granted = isPermissionGranted(rawPermission);

            console.log('[OneSignal] SDK permission:', rawPermission, '(granted:', granted + ')');

            if (granted) {
                // ✅ v16: use property, not method
                const userId = getOneSignalUserId();
                console.log('[OneSignal] SDK user ID:', userId);

                if (userId) {
                    await OneSignal.Notifications.add({
                        contents: { en: message },
                        data: { url: url },
                        targetUserId: userId,
                        web_url: url.startsWith('http')
                            ? url
                            : `https://tracknrent.vercel.app${url}`
                    });
                    console.log('[OneSignal] ✅ Push sent via SDK (instant)');
                    return { success: true, method: 'sdk' };
                } else {
                    console.log('[OneSignal] ⚠️ No user ID yet — falling back to serverless');
                }
            } else {
                console.log('[OneSignal] ⚠️ Permission not granted — falling back to serverless');
            }
        } else {
            console.log('[OneSignal] ⚠️ SDK not ready — falling back to serverless');
        }
    } catch (sdkError) {
        console.warn('[OneSignal] ⚠️ SDK send failed:', sdkError.message);
    }

    // ============================================
    // ✅ STRATEGY 2: Fallback to serverless API
    // ============================================
    console.log('[OneSignal] 🔄 Trying serverless fallback...');
    try {
        const response = await fetch("/api/send-push", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({ message, url })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[OneSignal] ❌ Serverless error:', data);
            return { success: false, error: data };
        }

        console.log('[OneSignal] ✅ Push sent via serverless:', data);
        return { success: true, method: 'serverless', data };

    } catch (err) {
        console.error('[OneSignal] ❌ Push network error:', err);
        return { success: false, error: err.message };
    }
}

// ✅ Expose to window for non-module use
window.sendPush = sendPush;

// ============================================
// ✅ LOCALHOST — COMPLETE MOCK
// ============================================
if (isLocalhost) {
    console.log('[OneSignal] ⏭️ Skipping initialization on localhost');

    window.OneSignal = {
        Notifications: {
            permission: 'default',
            add: async () => ({ success: true })
        },
        User: {
            onesignalId: null,
            getOnesignalId: async () => null
        },
        init: async () => {},
        on: () => {},
        emit: () => {},
        off: () => {},
        once: () => {}
    };

    window.OneSignalDeferred = [];

    if (window.OneSignalSDK) {
        window.OneSignalSDK = null;
    }

    console.log('[OneSignal] ✅ Localhost mock applied');

} else {
    // ============================================
    // ✅ PRODUCTION — INITIALIZE ONESIGNAL
    // ============================================
    (function() {
        'use strict';

        if (window.__onesignal_initialized) {
            console.log('[OneSignal] Already initialized, skipping');
            return;
        }
        window.__onesignal_initialized = true;

        const initOneSignal = () => {
            window.OneSignalDeferred = window.OneSignalDeferred || [];

            window.OneSignalDeferred.push(async function(OneSignal) {
                try {
                    console.log('[OneSignal] 🚀 Initializing...');
                    await OneSignal.init({
                        appId: ONESIGNAL_APP_ID,
                        serviceWorkerPath: "/sw.js",
                        serviceWorkerParam: { scope: "/" },
                        allowLocalhostAsSecureOrigin: false,
                        notifyButton: {
                            enable: false
                        }
                    });

                    // ✅ v16: property, may be string or boolean
                    const rawPermission = OneSignal.Notifications.permission;
                    const granted = isPermissionGranted(rawPermission);
                    console.log('[OneSignal] Permission:', rawPermission, '(granted:', granted + ')');

                    if (granted) {
                        // ✅ v16: property, not method
                        const userId = OneSignal.User.onesignalId;
                        console.log('[OneSignal] User ID:', userId || '(not yet assigned)');
                    }

                    console.log('[OneSignal] ✅ Initialized successfully');
                } catch (error) {
                    console.warn('[OneSignal] ⚠️ Init error:', error.message);
                }
            });

            console.log('[OneSignal] ✅ Module loaded for production');
        };

        if (document.readyState === 'complete') {
            initOneSignal();
        } else {
            window.addEventListener('load', initOneSignal);
        }

    })();
}