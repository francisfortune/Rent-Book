// /api/send-push.js
// Vercel Serverless Function for OneSignal

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

export default async function handler(req, res) {
    // ✅ Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ✅ Get API key from environment
    const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
    
    // ✅ DEBUG - Check key format
    console.log('[API] API Key exists:', !!ONESIGNAL_API_KEY);
    if (ONESIGNAL_API_KEY) {
        console.log('[API] Key prefix:', ONESIGNAL_API_KEY.substring(0, 15) + '...');
        console.log('[API] Starts with os_v2_app_:', ONESIGNAL_API_KEY.startsWith('os_v2_app_'));
    }
    
    if (!ONESIGNAL_API_KEY) {
        console.error('[API] ❌ OneSignal API key missing');
        return res.status(500).json({ 
            error: 'OneSignal API key missing',
            details: 'Set ONESIGNAL_API_KEY in Vercel environment variables'
        });
    }

    try {
        const { message, url = '/dashboard.html' } = req.body;

        console.log('[API] 📨 Received request:', { message, url });

        if (!message || message.trim() === '') {
            console.error('[API] ❌ Message is empty');
            return res.status(400).json({ 
                error: 'Message is required',
                details: 'Please provide a non-empty message in the request body'
            });
        }

        // ✅ Build OneSignal payload
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            contents: { en: message },
            headings: { en: 'Tracknrent' },
            web_url: url,
            chrome_web_image: 'https://tracknrent.vercel.app/assets/imgs/logo.png',
            data: { 
                url: url,
                timestamp: new Date().toISOString()
            },
            included_segments: ['All']
        };

        console.log('[API] 📤 Sending to OneSignal...');

        // ✅ Send to OneSignal API
        const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[API] ❌ OneSignal API error:', JSON.stringify(data, null, 2));
            return res.status(response.status).json({
                error: 'OneSignal API error',
                details: data
            });
        }

        console.log('[API] ✅ Push sent successfully! ID:', data.id);
        return res.status(200).json({
            success: true,
            notificationId: data.id,
            message: 'Push notification sent successfully'
        });

    } catch (error) {
        console.error('[API] ❌ Unexpected error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
}