// server.js

// Import necessary libraries
const express = require('express');
const Razorpay = require('razorpay');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files (like index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Razorpay instance with keys from .env
const instance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Endpoint to create a payment order and generate a QR code
app.post('/create-order', async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Please provide a valid amount.' });
  }

  const options = {
    amount: amount * 100, // Amount in paise
    currency: 'INR',
    receipt: 'receipt_' + Date.now(),
  };

  try {
    const order = await instance.orders.create(options);
    const qrCode = await instance.qrCode.create({
      type: 'upi_qr',
      name: 'Payment for your order',
      usage: 'single_use',
      fixed_amount: true,
      payments: {
        method: 'upi',
      },
    });

    res.status(200).json({
      orderId: order.id,
      qrCodeImageUrl: qrCode.image_url,
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// Endpoint to handle webhook for payment status updates
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(JSON.stringify(req.body));
  const digest = shasum.digest('hex');

  if (digest === req.headers['x-razorpay-signature']) {
    console.log('Request is valid');
    // Process the webhook event here
    const event = req.body.event;
    if (event === 'payment.captured') {
      const payment = req.body.payload.payment.entity;
      console.log('Payment successful:', payment);
      // Here you can update your database, fulfill the order, etc.
    }
  } else {
    console.log('Invalid signature');
  }

  res.json({ status: 'ok' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
