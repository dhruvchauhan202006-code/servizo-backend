/**
 * Servizo Free-Tier Backend Micro-Service
 * Runs on 100% Free Hosting (Cloudflare Workers / Vercel / Render Free Tier)
 * No credit card or paid Firebase Blaze plan required.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK (Optional: Provide service account JSON or use default credentials)
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  try {
    admin.initializeApp();
  } catch (e) {
    console.log("Firebase Admin running in uncredentialed standby mode");
  }
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_1DP5mmOlF5G5ag',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_dummy'
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

    // Update paymentStatus directly in Firestore via Admin SDK
    try {
      const db = admin.firestore();
      await db.collection('bookings').document(bookingId).update({
        paymentStatus: 'Paid',
        razorpayOrderId: razorpayOrderId,
        razorpayPaymentId: razorpayPaymentId,
        razorpaySignature: razorpaySignature,
        paidAt: Date.now()
      });
    } catch (dbErr) {
      console.warn("Firestore update notice:", dbErr.message);
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servizo Free-Tier Backend listening on port ${PORT}`);
});
