const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
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
// PAYMENT ENDPOINTS
// ============================================

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order
 */
app.post('/api/payments/create-order', (req, res) => {
  try {
    console.log('📍 /api/payments/create-order called');
    
    const { amount, planId, trialDays, userEmail, userId } = req.body;

    // Validate
    if (!amount || !planId || !userEmail || !userId) {
      console.error('❌ Missing fields:', { amount, planId, userEmail, userId });
      return res.status(400).json({
        error: 'Missing required fields: amount, planId, userEmail, userId',
      });
    }

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('❌ Razorpay credentials missing');
      return res.status(500).json({
        error: 'Razorpay not configured',
      });
    }

    // Create Razorpay order
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    
    const orderData = JSON.stringify({
      amount: amount,
      currency: 'INR',
      receipt: `order_${userId}_${Date.now()}`,
      notes: {
        userId,
        planId,
        trialDays,
        userEmail,
      },
    });

    console.log('📋 Creating order with:', orderData);

    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: '/v1/orders',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': orderData.length,
      },
    };

    const httpsReq = https.request(options, (httpsRes) => {
      let data = '';

      httpsRes.on('data', (chunk) => {
        data += chunk;
      });

      httpsRes.on('end', () => {
        try {
          const order = JSON.parse(data);

          if (httpsRes.statusCode === 200) {
            console.log('✅ Order created:', order.id);
            return res.json({
              success: true,
              orderId: order.id,
              amount: order.amount,
              currency: order.currency,
            });
          } else {
            console.error('❌ Razorpay error:', order);
            return res.status(httpsRes.statusCode).json({
              error: 'Failed to create order',
              details: order,
            });
          }
        } catch (parseErr) {
          console.error('❌ Parse error:', parseErr, 'Data:', data);
          return res.status(500).json({ 
            error: 'Parse error',
            message: parseErr.message,
          });
        }
      });
    });

    httpsReq.on('error', (error) => {
      console.error('❌ HTTPS error:', error);
      return res.status(500).json({
        error: 'Failed to create order',
        message: error.message,
      });
    });

    httpsReq.write(orderData);
    httpsReq.end();

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
 * Verifies payment signature
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

    // Verify signature
    const signatureBody = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(signatureBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('❌ Signature mismatch');
      return res.status(401).json({
        error: 'Invalid signature',
      });
    }

    console.log('✅ Signature verified');

    const premiumUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    res.json({
      success: true,
      message: 'Payment verified',
      premiumUntil: premiumUntil.toISOString(),
      orderId,
      paymentId,
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

    res.json({
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
});