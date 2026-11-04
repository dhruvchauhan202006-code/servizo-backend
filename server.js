/**
 * Servizo Free-Tier Backend Micro-Service
 * Runs on 100% Free Hosting (Render Free Tier / Vercel / Cloudflare Workers)
 * No credit card or paid Firebase Blaze plan required.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let firebaseInitStatus = {
  initialized: false,
  mode: 'none',
  projectId: null,
  clientEmail: null,
  error: null,
  rawKeyType: null,
  rawKeyLength: 0
};

/**
 * Robust Firebase Admin SDK initialization supporting:
 * - Environment variables: FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_SERVICE_ACCOUNT, etc.
 * - Raw JSON strings, base64-encoded JSON, or wrapped quotes
 * - Secret files mounted on Render (/etc/secrets/...)
 * - Automatic normalization of escaped private_key newlines (\n)
 */
function initFirebase() {
  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
                 process.env.FIREBASE_SERVICE_ACCOUNT ||
                 process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
                 process.env.SERVICE_ACCOUNT_KEY;

  if (!rawKey) {
    // Check if secret file exists at Render's /etc/secrets/
    const secretFileCandidates = [
      '/etc/secrets/firebase-service-account.json',
      '/etc/secrets/FIREBASE_SERVICE_ACCOUNT_KEY',
      '/etc/secrets/serviceAccountKey.json',
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    ];
    let fileContent = null;
    let foundPath = null;
    for (const filePath of secretFileCandidates) {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fileContent = fs.readFileSync(filePath, 'utf8');
          foundPath = filePath;
          console.log(`Loaded service account from secret file: ${filePath}`);
          break;
        } catch (e) {
          console.warn(`Could not read file ${filePath}:`, e.message);
        }
      }
    }
    if (fileContent) {
      return parseAndInitFirebase(fileContent, `secret_file (${foundPath})`);
    }

    try {
      admin.initializeApp();
      firebaseInitStatus = {
        initialized: false,
        mode: 'standby',
        projectId: null,
        clientEmail: null,
        error: 'No FIREBASE_SERVICE_ACCOUNT_KEY provided. Running in uncredentialed standby mode.'
      };
      console.log("Firebase Admin running in uncredentialed standby mode");
    } catch (e) {
      firebaseInitStatus = {
        initialized: false,
        mode: 'standby_error',
        projectId: null,
        clientEmail: null,
        error: e.message
      };
    }
    return;
  }

  parseAndInitFirebase(rawKey, 'env_variable');
}

function parseAndInitFirebase(raw, source) {
  try {
    let text = raw.trim();
    firebaseInitStatus.rawKeyLength = text.length;

    // Strip leading/trailing quotes if user pasted with wrapping quotes
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.substring(1, text.length - 1).trim();
    }

    let serviceAccount = null;
    if (text.startsWith('{')) {
      serviceAccount = JSON.parse(text);
      firebaseInitStatus.rawKeyType = 'json_string';
    } else {
      // Try Base64 decoding
      try {
        const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
        if (decoded.startsWith('{')) {
          serviceAccount = JSON.parse(decoded);
          firebaseInitStatus.rawKeyType = 'base64_json';
        }
      } catch (b64Err) {
        // Not valid base64
      }
    }

    if (!serviceAccount) {
      // Last resort: try direct JSON.parse
      serviceAccount = JSON.parse(text);
      firebaseInitStatus.rawKeyType = 'direct_json';
    }

    // Fix escaped newlines in private_key if needed
    if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    const projectId = serviceAccount.project_id || 'servizo-id';
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId
    });

    firebaseInitStatus = {
      initialized: true,
      mode: 'service_account',
      source: source,
      projectId: projectId,
      clientEmail: serviceAccount.client_email,
      error: null
    };
    console.log(`Firebase Admin SDK successfully authenticated for project: ${projectId} (source: ${source})`);
  } catch (err) {
    console.error(`Failed to initialize Firebase Admin SDK from ${source}:`, err.message);
    firebaseInitStatus = {
      initialized: false,
      mode: 'error',
      source: source,
      projectId: null,
      clientEmail: null,
      error: `Parse/Credential error: ${err.message}`
    };
  }
}

// Run initialization
initFirebase();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_TvF8BNZbhsjlBv',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_dummy'
});

/**
 * Health Check & Status Endpoint
 * Endpoint: GET /
 */
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Servizo Free-Tier Backend Micro-Service',
    status: 'ONLINE',
    version: '1.0.1',
    firebase: {
      initialized: firebaseInitStatus.initialized,
      mode: firebaseInitStatus.mode,
      projectId: firebaseInitStatus.projectId,
      clientEmail: firebaseInitStatus.clientEmail,
      hasError: !!firebaseInitStatus.error,
      error: firebaseInitStatus.error,
      rawKeyLength: firebaseInitStatus.rawKeyLength,
      rawKeyType: firebaseInitStatus.rawKeyType
    },
    razorpay: {
      keyIdConfigured: !!process.env.RAZORPAY_KEY_ID,
      keySecretConfigured: !!process.env.RAZORPAY_KEY_SECRET
    },
    availableEndpoints: [
      'GET /',
      'GET /api/health',
      'POST /api/create-order',
      'POST /api/verify-payment',
      'POST /api/notify-worker'
    ]
  });
});

app.get('/api/health', (req, res) => {
  res.redirect('/');
});

/**
 * 1. SECURE RAZORPAY ORDER CREATION
 * Endpoint: POST /api/create-order
 * Request Body: { bookingId, amountInRupees, customerEmail, customerPhone }
 */
app.post('/api/create-order', async (req, res) => {
  try {
    const { bookingId, amountInRupees, customerEmail, customerPhone } = req.body;
    if (!bookingId || !amountInRupees) {
      return res.status(400).json({ error: 'Missing bookingId or amountInRupees' });
    }

    const options = {
      amount: amountInRupees * 100, // Amount in paise
      currency: 'INR',
      receipt: `rcpt_${bookingId}`,
      notes: {
        bookingId: bookingId,
        customerPhone: customerPhone || ''
      }
    };

    const order = await razorpay.orders.create(options);
    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 2. SECURE PAYMENT SIGNATURE VERIFICATION
 * Endpoint: POST /api/verify-payment
 * Request Body: { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_dummy';

    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      return res.status(400).json({ success: false, error: 'Invalid Razorpay payment signature' });
    }

    // Update paymentStatus directly in Firestore via Admin SDK if credentialed
    if (firebaseInitStatus.initialized && firebaseInitStatus.mode === 'service_account') {
      try {
        const db = admin.firestore();
        const docRef = db.collection('bookings').doc(bookingId);
        await docRef.set({
          paymentStatus: 'Paid',
          razorpayOrderId: razorpayOrderId,
          razorpayPaymentId: razorpayPaymentId,
          razorpaySignature: razorpaySignature,
          paidAt: Date.now()
        }, { merge: true });
        console.log(`Firestore booking ${bookingId} updated to Paid successfully.`);
      } catch (dbErr) {
        console.warn("Firestore update notice:", dbErr.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Payment successfully verified' });
  } catch (error) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 3. HIGH-PRIORITY FCM PUSH NOTIFICATION TRIGGER
 * Endpoint: POST /api/notify-worker
 * Request Body: { targetToken, title, body, bookingId }
 */
app.post('/api/notify-worker', async (req, res) => {
  try {
    const { targetToken, title, body, bookingId } = req.body;
    if (!targetToken) {
      return res.status(400).json({ error: 'Missing targetToken' });
    }

    if (!firebaseInitStatus.initialized || firebaseInitStatus.mode !== 'service_account') {
      return res.status(503).json({
        error: 'Firebase Admin is not authenticated with a valid Service Account key yet.',
        details: firebaseInitStatus.error,
        help: 'Ensure FIREBASE_SERVICE_ACCOUNT_KEY is configured in Render Environment Variables and redeploy.'
      });
    }

    const message = {
      token: targetToken,
      notification: {
        title: title || 'New Chore Request (नया काम)',
        body: body || 'A new chore has been requested nearby.'
      },
      data: {
        bookingId: bookingId || '',
        channelId: 'servizo_urgent_channel'
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'servizo_urgent_channel',
          sound: 'default'
        }
      }
    };

    const response = await admin.messaging().send(message);
    return res.status(200).json({ success: true, messageId: response });
  } catch (error) {
    console.error('Error sending FCM push:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 4. BROADCAST CATCHY PROMOTIONAL NOTIFICATIONS (SUPERADMIN)
 * Endpoint: POST /api/broadcast-notification
 * Request Body: { title, body, audience }
 */
app.post('/api/broadcast-notification', async (req, res) => {
  try {
    const { title, body, audience = 'all' } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }

    if (!firebaseInitStatus.initialized || firebaseInitStatus.mode !== 'service_account') {
      return res.status(503).json({
        error: 'Firebase Admin is not authenticated with a valid Service Account key yet.',
        details: firebaseInitStatus.error
      });
    }

    const topics = audience === 'workers' ? ['workers'] :
                   audience === 'customers' ? ['customers'] : ['customers', 'workers'];

    const sendPromises = topics.map(topic => {
      const message = {
        topic: topic,
        notification: {
          title: title,
          body: body
        },
        data: {
          audience: audience,
          timestamp: Date.now().toString()
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'servizo_urgent_channel',
            sound: 'default'
          }
        }
      };
      return admin.messaging().send(message);
    });

    const results = await Promise.all(sendPromises);

    // Save as active announcement in Firestore for in-app feed
    try {
      const db = admin.firestore();
      const annId = 'ann_' + Date.now();
      await db.collection('announcements').doc(annId).set({
        id: annId,
        title: title,
        message: body,
        actionText: 'Book Now',
        isUrgent: true,
        active: true,
        createdAt: Date.now()
      });
    } catch (e) {
      console.warn('Could not save broadcast to announcements collection:', e.message);
    }

    return res.status(200).json({ success: true, messageIds: results });
  } catch (error) {
    console.error('Error broadcasting notification:', error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servizo Free-Tier Backend listening on port ${PORT}`);
});
