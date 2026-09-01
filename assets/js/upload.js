import admin from 'firebase-admin';

// Initialize Firebase Admin with Service Account Credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Handle newline breaks in private key
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: "rent-bookv1.appspot.com", // Replace with your exact bucket name
  });
}

const bucket = admin.storage().bucket();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileName, fileData, mimeType } = req.body; 
    // Expecting base64 string in fileData

    const buffer = Buffer.from(fileData.split(',')[1] || fileData, 'base64');
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: { contentType: mimeType },
      public: true, // Optional: makes file accessible publicly
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    
    return res.status(200).json({ success: true, url: publicUrl });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}