// /api/send-push.js
// Vercel Serverless Function

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
    
    if (!ONESIGNAL_API_KEY) {
        return res.status(500).json({ 
            error: 'OneSignal API key missing',
            details: 'Set ONESIGNAL_API_KEY in Vercel environment variables'
        });
    }

    try {
        const { message, url = '/dashboard.html' } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const payload = {
            app_id: ONESIGNAL_APP_ID,
            contents: { en: message },
            headings: { en: 'Tracknrent' },
            web_url: url,
            chrome_web_image: 'https://tracknrent.vercel.app/assets/imgs/logo.png',
            data: { url: url },
            included_segments: ['All']
        };

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
            console.error('[API] OneSignal error:', data);
            return res.status(response.status).json({ error: data });
        }

        return res.status(200).json({
            success: true,
            notificationId: data.id
        });

    } catch (error) {
        console.error('[API] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}