// server.js

// Import necessary libraries
const express = require('express');
const Razorpay = require('razorpay');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming requests
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Razorpay instance with keys from environment variables
const instance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Endpoint to create a payment order and generate a QR code
app.post('/create-order', async (req, res) => {
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Please provide a valid amount.' });
  }

  const options = {
    amount: amount * 100, // Amount in paise
    currency: 'INR',
    receipt: 'receipt_' + Date.now(),
    payment_capture: 1 // Auto capture payment
  };

  try {
    const order = await instance.orders.create(options);

    // Create a QR code specifically for this order
    const qrCode = await instance.qrCode.create({
      type: 'upi_qr',
      name: 'Order Payment',
      usage: 'single_use',
      fixed_amount: true,
      amount: order.amount,
      payment_link: {
        amount: order.amount,
        currency: order.currency,
        description: 'Payment for your order',
        expire_by: Math.floor(Date.now() / 1000) + 300, // 5 minutes validity
        notify: {
          sms: false,
          email: false
        },
        reminder_enable: false
      }
    });

    res.status(200).json({
      orderId: order.id,
      qrCodeImageUrl: qrCode.image_url,
    });
  } catch (error) {
    console.error('Error creating order or QR code:', error);
    res.status(500).json({ error: 'Failed to create order or QR code.' });
  }
});

// Endpoint to handle webhooks for payment status updates
// Note: This endpoint is crucial for getting real-time payment success notifications
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(req.body);
  const digest = shasum.digest('hex');

  if (digest === req.headers['x-razorpay-signature']) {
    console.log('Webhook request is valid');
    
    // Parse the event data
    const event = JSON.parse(req.body);
    
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      console.log('Payment successful:', payment.id, 'for amount:', payment.amount / 100);
      
      // Here, you would update your database or fulfill the order
      // based on the payment ID
    }
  } else {
    console.log('Invalid webhook signature!');
  }

  res.json({ status: 'ok' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
