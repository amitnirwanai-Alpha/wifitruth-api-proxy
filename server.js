const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Anthropic with API key from environment
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

    const diagnosis = message.content[0].type === 'text' ? message.content[0].text : '';

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
});