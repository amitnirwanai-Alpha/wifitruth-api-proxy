const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Anthropic with API key from environment
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://akjjqevacgjnwuusctge.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_q7xrGSnoZwXo-exnTU_nw_FsZLT...';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Razorpay credentials
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

app.use(cors());
app.use(express.json());

// Rate limiter: max 10 requests per user per day
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
// PAYMENT ENDPOINTS (NEW)
// ============================================

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order for premium subscription
 * 
 * Body: {
 *   amount: number (in paise, e.g., 9900 for ₹99)
 *   planId: string
 *   trialDays: number
 *   userEmail: string
 *   userName: string
 *   userId: string
 * }
 */
app.post('/api/payments/create-order', async (req, res) => {
  try {
    console.log('📍 Payment /create-order endpoint called');
    
    const { amount, planId, trialDays, userEmail, userName, userId } = req.body;

    // Validate inputs
    if (!amount || !planId || !userEmail || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: amount, planId, userEmail, userId',
      });
    }

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('❌ Razorpay keys not configured');
      return res.status(500).json({
        error: 'Payment service not configured',
      });
    }

    // Create Razorpay order using basic auth
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    
    const orderData = {
      amount: amount, // in paise
      currency: 'INR',
      receipt: `order_${userId}_${Date.now()}`,
      notes: {
        userId,
        planId,
        trialDays,
        userName,
        userEmail,
      },
    };

    console.log('📋 Creating Razorpay order with data:', orderData);

    // Make API call to Razorpay
    const https = require('https');
    
    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: '/v1/orders',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    };

    const razorpayReq = https.request(options, (razorpayRes) => {
      let data = '';

      razorpayRes.on('data', (chunk) => {
        data += chunk;
      });

      razorpayRes.on('end', () => {
        try {
          const order = JSON.parse(data);

          if (razorpayRes.statusCode === 200) {
            console.log('✅ Razorpay order created:', order.id);
            return res.json({
              success: true,
              orderId: order.id,
              amount: order.amount,
              currency: order.currency,
              notes: order.notes,
            });
          } else {
            console.error('❌ Razorpay error:', order);
            return res.status(razorpayRes.statusCode).json({
              error: 'Failed to create order',
              details: order,
            });
          }
        } catch (parseError) {
          console.error('❌ Parse error:', parseError);
          return res.status(500).json({
            error: 'Failed to parse Razorpay response',
          });
        }
      });
    });

    razorpayReq.on('error', (error) => {
      console.error('❌ Razorpay request error:', error);
      res.status(500).json({
        error: 'Failed to communicate with Razorpay',
        message: error.message,
      });
    });

    razorpayReq.write(JSON.stringify(orderData));
    razorpayReq.end();
  } catch (error) {
    console.error('❌ Error in create-order:', error);
    res.status(500).json({
      error: 'Failed to create order',
      message: error.message,
    });
  }
});

/**
 * POST /api/payments/verify-signature
 * Verifies Razorpay payment signature and updates user premium status
 * 
 * Body: {
 *   orderId: string
 *   paymentId: string
 *   signature: string
 *   userId: string
 *   userEmail: string
 * }
 */
app.post('/api/payments/verify-signature', async (req, res) => {
  try {
    console.log('📍 Payment /verify-signature endpoint called');

    const { orderId, paymentId, signature, userId, userEmail } = req.body;

    // Validate inputs
    if (!orderId || !paymentId || !signature || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: orderId, paymentId, signature, userId',
      });
    }

    // Verify signature
    const signatureBody = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(signatureBody)
      .digest('hex');

    console.log('🔐 Verifying signature...');
    console.log('Expected:', expectedSignature);
    console.log('Received:', signature);

    if (expectedSignature !== signature) {
      console.error('❌ Signature mismatch');
      return res.status(401).json({
        error: 'Invalid payment signature',
      });
    }

    console.log('✅ Signature verified');

    // Calculate premium expiry (3 days from now)
    const now = new Date();
    const premiumUntil = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Update Supabase: Set user as premium
    const { data, error } = await supabase
      .from('users_consent')
      .update({
        premium: true,
        premium_until: premiumUntil.toISOString(),
        user_type: 'premium',
        order_id: orderId,
        payment_id: paymentId,
      })
      .eq('user_id', userId);

    if (error) {
      console.error('❌ Supabase update error:', error);
      return res.status(500).json({
        error: 'Failed to update premium status',
        details: error,
      });
    }

    console.log('✅ Premium status updated in Supabase');

    res.json({
      success: true,
      message: 'Payment verified and premium activated',
      premiumUntil: premiumUntil.toISOString(),
      orderId,
      paymentId,
    });
  } catch (error) {
    console.error('❌ Error in verify-signature:', error);
    res.status(500).json({
      error: 'Failed to verify payment',
      message: error.message,
    });
  }
});

/**
 * POST /api/payments/cancel-subscription
 * Cancels user's premium subscription
 * 
 * Body: {
 *   userId: string
 *   orderId: string
 * }
 */
app.post('/api/payments/cancel-subscription', async (req, res) => {
  try {
    console.log('📍 Payment /cancel-subscription endpoint called');

    const { userId, orderId } = req.body;

    // Validate inputs
    if (!userId) {
      return res.status(400).json({
        error: 'Missing required field: userId',
      });
    }

    // Update Supabase: Remove premium status
    const { data, error } = await supabase
      .from('users_consent')
      .update({
        premium: false,
        premium_until: null,
        user_type: 'free',
      })
      .eq('user_id', userId);

    if (error) {
      console.error('❌ Supabase update error:', error);
      return res.status(500).json({
        error: 'Failed to cancel subscription',
        details: error,
      });
    }

    console.log('✅ Subscription cancelled in Supabase');

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      userId,
      orderId,
    });
  } catch (error) {
    console.error('❌ Error in cancel-subscription:', error);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      message: error.message,
    });
  }
});

// ============================================
// EXISTING ENDPOINTS
// ============================================

// Health check endpoint (Railway needs this)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'WiFiTruth API proxy is running' });
});

// Main endpoint: AI diagnosis
app.post('/api/diagnose', async (req, res) => {
  try {
    const clientIp = req.ip;
    // Check rate limit
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Max 10 tests per day.',
      });
    }

    const { download, upload, ping, jitter, loss, isp, location } = req.body;

    // Validate input
    if (!download || !upload || !ping) {
      return res.status(400).json({
        error: 'Missing required fields: download, upload, ping',
      });
    }

    // Build the prompt for Claude
    const prompt = `You are WiFiTruth, an Indian WiFi speed test diagnosis AI.
User test results:
- Download: ${download} Mbps
- Upload: ${upload} Mbps
- Ping: ${ping} ms
- Jitter: ${jitter || 'N/A'} ms
- Packet Loss: ${loss || 'N/A'}%
- ISP: ${isp || 'Unknown'}
- Location: ${location || 'Unknown'}

Give a 2-sentence plain-language diagnosis that:
1. Names the ISP and what went right or wrong
2. Gives one specific actionable tip

Be honest. If WiFi is bad, say it. If it's being dishonest (claiming high-speed but delivering low), call that out.

Example good response: "Jio is delivering only 12 Mbps here but your plan promises 100 Mbps — you're getting 12% of what you paid for. Switch to 5GHz band on the router or file a complaint on TRAI portal."

Keep response under 100 words.`;

    // Call Claude API
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 110,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const diagnosis =
      message.content[0].type === 'text' ? message.content[0].text : '';

    res.json({
      success: true,
      diagnosis: diagnosis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error calling Claude API:', error);
    res.status(500).json({
      error: 'Failed to generate diagnosis',
      message: error.message,
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`WiFiTruth API proxy running on port ${PORT}`);
  console.log(`Environment:`);
  console.log(`  - Razorpay Key ID: ${RAZORPAY_KEY_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`  - Supabase URL: ${SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
  console.log(`  - Anthropic API: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
});
