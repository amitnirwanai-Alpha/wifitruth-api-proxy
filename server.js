const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Payment endpoints - BARE MINIMUM
app.post('/api/payments/create-order', (req, res) => {
  res.json({
    success: true,
    orderId: 'order_test_' + Date.now(),
    amount: 9900,
    currency: 'INR',
  });
});

app.post('/api/payments/verify-signature', (req, res) => {
  res.json({
    success: true,
    message: 'Payment verified',
  });
});

app.post('/api/payments/cancel-subscription', (req, res) => {
  res.json({
    success: true,
    message: 'Subscription cancelled',
  });
});

// Diagnose endpoint
app.post('/api/diagnose', (req, res) => {
  res.json({
    success: true,
    diagnosis: 'Test diagnosis',
    timestamp: new Date().toISOString(),
  });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 WiFiTruth API running on port ${PORT}`);
});