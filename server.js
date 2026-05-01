const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
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
  });
});

// ============================================
// 1. CREATE ORDER
// ============================================
app.post('/api/payments/create-order', async (req, res) => {
  try {
    const { amount, planId, trialDays, userEmail, userName, userId } = req.body;

    console.log('💳 Creating order:', { amount, planId, userEmail });

    if (!amount || !userEmail || !userName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
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
    });
  } catch (error) {
    console.error('❌ Order creation failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// 2. VERIFY SIGNATURE
// ============================================
app.post('/api/payments/verify-signature', async (req, res) => {
  try {
    const { orderId, paymentId, signature, userId } = req.body;

    console.log('🔐 Verifying signature:', { orderId, paymentId });

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
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
      });
    }

    console.log('✅ Signature verified!');

    const premiumUntil = new Date();
    premiumUntil.setMonth(premiumUntil.getMonth() + 1);

    const { error } = await supabase
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
      console.error('❌ Database update failed:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to save subscription',
      });
    }

    console.log('✅ Subscription saved');

    res.json({
      success: true,
      message: 'Payment verified',
      subscriptionId: paymentId,
      premiumUntil: premiumUntil.toISOString(),
    });
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
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
      return res.status(500).json({
        success: false,
        error: 'Failed to cancel',
      });
    }

    console.log('✅ Subscription cancelled');

    res.json({
      success: true,
      message: 'Subscription cancelled',
    });
  } catch (error) {
    console.error('❌ Cancellation failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// 4. DIAGNOSE
// ============================================
app.post('/api/diagnose', (req, res) => {
  res.json({
    success: true,
    diagnosis: 'Test diagnosis',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// START
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 WiFiTruth API on port ${PORT}`);
  console.log(`✅ Razorpay: ${RAZORPAY_KEY_ID ? 'Ready' : 'Missing'}`);
  console.log(`✅ Supabase: ${SUPABASE_URL ? 'Ready' : 'Missing'}`);
});