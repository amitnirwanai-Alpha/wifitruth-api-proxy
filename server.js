const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Anthropic
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Razorpay credentials
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

app.use(cors());
app.use(express.json());

// Rate limiter
const requestLog = {};

function getRateLimitKey(ip) {
  return `${ip}-${new Date().toDateString()}`;
}

function checkRateLimit(ip) {
  const key = getRateLimitKey(ip);
  if (!requestLog[key]) {
    requestLog[key] = 0;
  }
  requestLog[key]++;
  return requestLog[key] <= 10;
}

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'WiFiTruth API proxy is running' });
});

// ============================================
// PAYMENT ENDPOINTS (MOCK VERSION - NO RAZORPAY)
// ============================================

/**
 * POST /api/payments/create-order
 * MOCK: Returns fake order without calling Razorpay
 */
app.post('/api/payments/create-order', (req, res) => {
  try {
    console.log('📍 /api/payments/create-order called');
    
    const { amount, planId, trialDays, userEmail, userId } = req.body;

    // Validate
    if (!amount || !planId || !userEmail || !userId) {
      console.error('❌ Missing fields');
      return res.status(400).json({
        error: 'Missing required fields: amount, planId, userEmail, userId',
      });
    }

    // MOCK: Generate fake order ID
    const mockOrderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log('✅ Mock order created:', mockOrderId);

    return res.json({
      success: true,
      orderId: mockOrderId,
      amount: amount,
      currency: 'INR',
      notes: {
        userId,
        planId,
        trialDays,
      },
    });
  } catch (error) {
    console.error('❌ Error in /api/payments/create-order:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /api/payments/verify-signature
 * MOCK: Always verifies successfully
 */
app.post('/api/payments/verify-signature', (req, res) => {
  try {
    console.log('📍 /api/payments/verify-signature called');

    const { orderId, paymentId, signature, userId } = req.body;

    if (!orderId || !paymentId || !signature || !userId) {
      return res.status(400).json({
        error: 'Missing required fields',
      });
    }

    console.log('✅ Signature verified (MOCK)');

    const premiumUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    return res.json({
      success: true,
      message: 'Payment verified',
      premiumUntil: premiumUntil.toISOString(),
      orderId,
      paymentId,
      userId,
    });
  } catch (error) {
    console.error('❌ Error in /api/payments/verify-signature:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /api/payments/cancel-subscription
 * MOCK: Always cancels successfully
 */
app.post('/api/payments/cancel-subscription', (req, res) => {
  try {
    console.log('📍 /api/payments/cancel-subscription called');

    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'Missing userId',
      });
    }

    console.log('✅ Subscription cancelled (MOCK)');

    return res.json({
      success: true,
      message: 'Subscription cancelled',
      userId,
    });
  } catch (error) {
    console.error('❌ Error in /api/payments/cancel-subscription:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// ============================================
// EXISTING ENDPOINTS
// ============================================

app.post('/api/diagnose', async (req, res) => {
  try {
    const clientIp = req.ip;
    
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Max 10 tests per day.',
      });
    }

    const { download, upload, ping, jitter, loss, isp, location } = req.body;

    if (!download || !upload || !ping) {
      return res.status(400).json({
        error: 'Missing required fields: download, upload, ping',
      });
    }

    const prompt = `You are WiFiTruth, an Indian WiFi speed test diagnosis AI.
User test results:
- Download: ${download} Mbps
- Upload: ${upload} Mbps
- Ping: ${ping} ms
- Jitter: ${jitter || 'N/A'} ms
- Packet Loss: ${loss || 'N/A'}%
- ISP: ${isp || 'Unknown'}
- Location: ${location || 'Unknown'}

Give a 2-sentence plain-language diagnosis.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 110,
      messages: [{ role: 'user', content: prompt }],
    });

    const diagnosis = message.content[0].type === 'text' ? message.content[0].text : '';

    res.json({
      success: true,
      diagnosis: diagnosis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/diagnose:', error);
    res.status(500).json({
      error: 'Failed to generate diagnosis',
      message: error.message,
    });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 WiFiTruth API proxy running on port ${PORT}`);
  console.log(`Environment:`);
  console.log(`  - Anthropic API: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`);
  console.log(`  - Razorpay Key ID: ${RAZORPAY_KEY_ID ? '✅' : '❌'}`);
  console.log(`  - Razorpay Key Secret: ${RAZORPAY_KEY_SECRET ? '✅' : '❌'}`);
  console.log(`\n📝 NOTE: Payment endpoints are using MOCK responses (no real Razorpay calls)`);
});