# Servizo 100% Free-Tier Backend Micro-Service

This lightweight micro-service solves the **Firebase Free Spark Plan** limitation where Google Cloud Functions cannot be deployed without adding a credit card for the Blaze plan.

It runs **100% free forever** on platforms that do not require credit cards (e.g. **Vercel Hobby Plan**, **Cloudflare Workers**, or **Render Free Web Service**).

---

## Capabilities Provided

1. **Secure Razorpay Order Creation (`POST /api/create-order`):**
   - Keeps your `RAZORPAY_KEY_SECRET` off the Android app.
   - Generates genuine Razorpay orders using your secret key.

2. **Tamper-Proof Webhook Signature Verification (`POST /api/verify-payment`):**
   - Computes `HMAC_SHA256` of `order_id|payment_id` against your `RAZORPAY_KEY_SECRET`.
   - Prevents payment spoofing or malicious client-side status tampering.
   - Updates Firestore document `/bookings/{bookingId}` to `paymentStatus = "Paid"`.

3. **High-Priority FCM Push Notification Dispatch (`POST /api/notify-worker`):**
   - Sends Firebase Cloud Messaging alerts to helpers' phones when a new chore is booked.

---

## 1-Click Free Deployment Options (Zero Credit Card Required)

### Option A: Deploy to Vercel (100% Free Forever)
1. Go to [vercel.com](https://vercel.com) and sign up with GitHub.
2. Import this repository folder (`servizo/backend`).
3. Under Environment Variables, add:
   - `RAZORPAY_KEY_ID`: `rzp_test_...`
   - `RAZORPAY_KEY_SECRET`: Your Razorpay private secret
   - `FIREBASE_SERVICE_ACCOUNT_KEY`: *(Optional for Admin SDK)* The contents of your Firebase Service Account JSON file.
4. Click **Deploy**. Vercel will give you a public URL (e.g. `https://servizo-backend.vercel.app`).

### Option B: Deploy to Render (100% Free Forever)
1. Go to [render.com](https://render.com) and create a free Web Service from this repo.
2. Select runtime: **Node.js**.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Free tier includes 750 free hours/month.

---

## Testing Locally
```bash
cd backend
npm install
node server.js
```
The server will start at `http://localhost:8080`.
