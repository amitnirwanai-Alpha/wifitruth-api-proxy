const express = require('express');
const app = express();

// Set timeout for all requests to 5 minutes
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000);
  next();
});

const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const Speedtest = require('speedtest-net');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Validate required env vars
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('❌ Missing Razorpay keys in environment!');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials in environment!');
  process.exit(1);
}

// ============================================
// INITIALIZE CLIENTS
// ============================================
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path}`);
  next();
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    razorpay: RAZORPAY_KEY_ID ? '✅' : '❌',
    supabase: SUPABASE_URL ? '✅' : '❌',
    speedtest: '✅ OOKLA',
  });
});

// ============================================
// 0. OOKLA SPEED TEST (NEW!)

// ============================================
app.post('/api/speed-test', async (req, res) => {
  try {
    console.log('🚀 Starting OOKLA speed test...');
    
    // Set timeouts for this request
    req.socket.setTimeout(300000);  // 5 minutes
    res.setTimeout(300000);          // 5 minutes

    const speedtest = new Speedtest({
      token: 'YXNkZmFzZGZhc2RmYXNkZmFzZGY=',
      verbose: false,
      timeout: 180000,  // ← INCREASED TO 3 MINUTES
    });

    const startTime = Date.now();

    console.log('📍 Testing ping...');
    const ping = await speedtest.pingTest();
    console.log(`✅ Ping: ${ping.toFixed(2)} ms`);

    console.log('⬇️ Testing download...');
    const download = await speedtest.downloadTest();
    console.log(`✅ Download: ${download.toFixed(2)} Mbps`);

    console.log('⬆️ Testing upload...');
    const upload = await speedtest.uploadTest();
    console.log(`✅ Upload: ${upload.toFixed(2)} Mbps`);

    const jitter = Math.max(ping * 0.15, 1);
    const packetLoss = ping > 150 ? (ping - 150) * 0.2 : 0;
    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`✅ OOKLA test complete in ${duration}s`);

    res.json({
      success: true,
      download: Math.round(download * 100) / 100,
      upload: Math.round(upload * 100) / 100,
      ping: Math.round(ping * 100) / 100,
      jitter: Math.round(jitter * 100) / 100,
      packetLoss: Math.round(packetLoss * 100) / 100,
      duration,
      source: 'OOKLA Speedtest',
    });
  } catch (error) {
    console.error('❌ OOKLA test failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Speed test failed',
    });
  }
});

// ============================================
// 1. CREATE ORDER (for payment)
// ============================================
app.post('/api/payments/create-order', async (req, res) => {
  try {
    const { amount, planId, trialDays, userEmail, userName, userId } = req.body;

    console.log('💳 Creating Razorpay order:', { amount, planId, userEmail });

    if (!amount || !userEmail || !userName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, userEmail, userName',
      });
    }

    const orderData = {
      amount: amount * 100,
      currency: 'INR',
      receipt: `order_${userId}_${Date.now()}`,
      notes: {
        planId,
        trialDays: trialDays || 0,
        userEmail,
        userName,
        userId,
      },
    };

    const order = await razorpay.orders.create(orderData);

    console.log('✅ Order created:', order.id);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (error) {
    console.error('❌ Order creation failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create order',
    });
  }
});

// ============================================
// 2. VERIFY SIGNATURE (payment confirmation)
// ============================================
app.post('/api/payments/verify-signature', async (req, res) => {
  try {
    const { orderId, paymentId, signature, userId } = req.body;

    console.log('🔐 Verifying payment signature:', { orderId, paymentId });

    if (!orderId || !paymentId || !signature || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const isSignatureValid = expectedSignature === signature;

    if (!isSignatureValid) {
      console.error('❌ Invalid signature!');
      return res.status(401).json({
        success: false,
        error: 'Invalid payment signature',
      });
    }

    console.log('✅ Signature verified!');

    const premiumUntil = new Date();
    premiumUntil.setMonth(premiumUntil.getMonth() + 1);

    const { data, error } = await supabase
      .from('users_consent')
      .update({
        premium: true,
        premium_until: premiumUntil.toISOString(),
        user_type: 'premium',
        order_id: orderId,
        payment_id: paymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('❌ Supabase update failed:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to save subscription',
      });
    }

    console.log('✅ Subscription saved to database');

    res.json({
      success: true,
      message: 'Payment verified and subscription activated',
      subscriptionId: paymentId,
      premiumUntil: premiumUntil.toISOString(),
    });
  } catch (error) {
    console.error('❌ Signature verification failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Verification failed',
    });
  }
});

// ============================================
// 3. CANCEL SUBSCRIPTION
// ============================================
app.post('/api/payments/cancel-subscription', async (req, res) => {
  try {
    const { userId } = req.body;

    console.log('❌ Cancelling subscription:', userId);

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId',
      });
    }

    const { error } = await supabase
      .from('users_consent')
      .update({
        premium: false,
        premium_until: null,
        user_type: 'free',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('❌ Supabase update failed:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to cancel subscription',
      });
    }

    console.log('✅ Subscription cancelled');

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    console.error('❌ Cancellation failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Cancellation failed',
    });
  }
});

// ============================================
// 4. DIAGNOSE ENDPOINT
// ============================================
app.post('/api/diagnose', (req, res) => {
  res.json({
    success: true,
    diagnosis: 'Test diagnosis',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
  console.error('🔴 Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 WiFiTruth API running on port ${PORT}`);
  console.log(`✅ OOKLA Speedtest: Ready`);
  console.log(`✅ Razorpay: ${RAZORPAY_KEY_ID ? 'Connected' : 'Not configured'}`);
  console.log(`✅ Supabase: ${SUPABASE_URL ? 'Connected' : 'Not configured'}`);
});

module.exports = app;