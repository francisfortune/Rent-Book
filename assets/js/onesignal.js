// ============================================
// ONESIGNAL - COMPLETE FIX (Block on localhost)
// ============================================

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

// ✅ Detect if running on localhost
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname === '';

// ✅ Export sendPush at MODULE scope
export async function sendPush(message, url = "/dashboard.html") {
    // ✅ Skip push on localhost
    if (isLocalhost) {
        console.log('[OneSignal] ⏭️ Skipping push on localhost');
        return { success: true, message: 'Skipped - localhost' };
    }

    try {
        // Try OneSignal SDK first
        if (window.OneSignal && typeof window.OneSignal.Notifications !== 'undefined') {
            try {
                const OneSignal = window.OneSignal;
                const userId = await OneSignal.User.getOnesignalId();
                
                if (userId) {
                    await OneSignal.Notifications.add({
                        contents: { en: message },
                        data: { url: url },
                        targetUserId: userId,
                        web_url: url
                    });
                    console.log('[OneSignal] ✅ Push sent via SDK');
                    return { success: true };
                }
            } catch (sdkError) {
                console.warn('[OneSignal] SDK send failed:', sdkError.message);
            }
        }

        // Fallback: Serverless API
        console.log('[OneSignal] Trying serverless fallback...');
        const response = await fetch("/api/send-push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, url })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[OneSignal] Serverless error:', data);
            return { success: false, error: data };
        }

        console.log('[OneSignal] ✅ Push sent via serverless');
        return { success: true, data };

    } catch (err) {
        console.error('[OneSignal] Push failed:', err);
        return { success: false, error: err.message };
    }
}

// ✅ Expose to window
window.sendPush = sendPush;

// ============================================
// ✅ COMPLETELY SKIP ONESIGNAL ON LOCALHOST
// ============================================
if (isLocalhost) {
    console.log('[OneSignal] ⏭️ Skipping initialization on localhost');
    
    // ✅ Mock OneSignal completely to prevent any errors
    window.OneSignal = {
        Notifications: {
            permission: 'default',
            add: async () => ({ success: true })
        },
        User: {
            getOnesignalId: async () => null
        },
        init: async () => {},
        on: () => {},
        emit: () => {},
        off: () => {},
        once: () => {}
    };
    
    // ✅ Prevent OneSignalDeferred from running
    window.OneSignalDeferred = [];
    
    // ✅ Also mock the global OneSignal SDK
    if (window.OneSignalSDK) {
        window.OneSignalSDK = null;
    }
    
    console.log('[OneSignal] ✅ Localhost mock applied');
    
} else {
    // ============================================
    // ✅ PRODUCTION - Initialize OneSignal
    // ============================================
    (function() {
        'use strict';

        if (window.__onesignal_initialized) {
            console.log('[OneSignal] Already initialized, skipping');
            return;
        }
        window.__onesignal_initialized = true;

        window.OneSignalDeferred = window.OneSignalDeferred || [];

        window.OneSignalDeferred.push(async function(OneSignal) {
            try {
                await OneSignal.init({
                    appId: ONESIGNAL_APP_ID,
                    serviceWorkerPath: "/sw.js",
                    serviceWorkerParam: { scope: "/" },
                    allowLocalhostAsSecureOrigin: false,
                    notifyButton: {
                        enable: false
                    }
                });

                const permission = await OneSignal.Notifications.permission;
                console.log('[OneSignal] Permission:', permission);

                if (permission === 'granted') {
                    const userId = await OneSignal.User.getOnesignalId();
                    console.log('[OneSignal] User ID:', userId);
                }

                console.log('[OneSignal] ✅ Initialized successfully');
            } catch (error) {
                console.warn('[OneSignal] Init error:', error.message);
            }
        });

        console.log('[OneSignal] Module loaded for production');

    })();
}