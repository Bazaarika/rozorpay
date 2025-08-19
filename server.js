// server.js
require("dotenv").config();
const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

// --------- Config ----------
const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const DATA_DIR = path.join(__dirname, "data");
const JSON_PATH = path.join(DATA_DIR, "payments.json");
const CSV_PATH = path.join(DATA_DIR, "payments.csv");

// Ensure data dir/files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(JSON_PATH)) fs.writeFileSync(JSON_PATH, JSON.stringify([] , null, 2));
if (!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, "timestamp,plink_id,status,amount,contact,email,payment_id,order_id,method,captured\n");

const app = express();

// CORS for your static site (GitHub Pages or any)
app.use(cors({
  origin: ALLOWED_ORIGIN === "*" ? true : [ALLOWED_ORIGIN],
}));

// JSON for normal routes
app.use(express.json());

// Razorpay SDK
const rzp = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET,
});

// Serve static (optional; if you want to host frontend here)
// app.use(express.static(path.join(__dirname, "public")));

// ---------- Helpers ----------
function appendCSV(row) {
  fs.appendFileSync(CSV_PATH, row + "\n");
}

function saveRecord(obj) {
  const list = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  list.push(obj);
  fs.writeFileSync(JSON_PATH, JSON.stringify(list, null, 2));
}

function updateRecord(plink_id, patch) {
  const list = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  const idx = list.findIndex(x => x.plink_id === plink_id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...patch };
    fs.writeFileSync(JSON_PATH, JSON.stringify(list, null, 2));
  }
}

// ---------- API: Create Payment Link (Dynamic Amount) ----------
app.post("/create-link", async (req, res) => {
  try {
    const { amount, name, email, contact, description } = req.body || {};
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Valid amount (INR) required" });
    }

    // amount in paise
    const amtPaise = Math.round(Number(amount) * 100);

    const payload = {
      amount: amtPaise,
      currency: "INR",
      description: description || "Bazaarika Payment",
      customer: {},
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: null, // optional if you want post-payment redirect
      callback_method: "get"
    };

    if (name) payload.customer.name = name;
    if (email) payload.customer.email = email;
    if (contact) payload.customer.contact = contact;

    // Create Payment Link
    const plink = await rzp.paymentLink.create(payload);

    // Save initial record
    const now = new Date().toISOString();
    const record = {
      timestamp: now,
      plink_id: plink.id,
      status: plink.status, // created
      amount: amount,
      contact: contact || "",
      email: email || "",
      short_url: plink.short_url
    };
    saveRecord(record);
    appendCSV([now, plink.id, plink.status, amount, contact || "", email || "", "", "", "", ""].join(","));

    res.json({
      id: plink.id,
      short_url: plink.short_url,
      status: plink.status
    });
  } catch (err) {
    console.error("Create-link error:", err?.error || err);
    res.status(500).json({ error: "Failed to create payment link", details: err?.error || String(err) });
  }
});

// ---------- API: Get status by payment_link_id ----------
app.get("/status/:plink_id", (req, res) => {
  const { plink_id } = req.params;
  const list = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  const rec = list.find(x => x.plink_id === plink_id);
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json(rec);
});

// ---------- API: List all records (simple) ----------
app.get("/records", (req, res) => {
  const list = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  res.json(list);
});

// ---------- Webhook (RAW body required) ----------
app.post("/webhook",
  express.raw({ type: "*/*" }), // use raw body for signature verification
  (req, res) => {
    try {
      const secret = process.env.WEBHOOK_SECRET;
      const signature = req.headers["x-razorpay-signature"];
      const body = req.body; // Buffer

      const expected = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");

      if (expected !== signature) {
        console.warn("Invalid webhook signature");
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(body.toString("utf-8"));
      // You can receive many events: payment_link.paid, payment.captured, etc.
      const type = event.event;

      // Useful payloads:
      // payment_link.paid -> event.payload.payment_link.entity
      // payment.captured  -> event.payload.payment.entity
      let now = new Date().toISOString();

      if (type === "payment_link.paid" || type === "payment_link.partially_paid") {
        const pl = event.payload.payment_link.entity;
        const plink_id = pl && pl.id;
        const status = pl && pl.status;
        updateRecord(plink_id, { status, timestamp_update: now });

        appendCSV([now, plink_id, status, "", "", "", "", "", "", ""].join(","));
      }

      if (type === "payment.captured") {
        const p = event.payload.payment.entity;
        const payment_id = p?.id;
        const order_id = p?.order_id || "";
        const method = p?.method || "";
        const captured = p?.captured || false;
        const email = p?.email || "";
        const contact = p?.contact || "";
        // Find if linked to a payment link:
        const notes = p?.notes || {};
        const plink_id = notes.payment_link_id || notes.plink_id || "";

        // Update/append
        updateRecord(plink_id, {
          status: "paid",
          payment_id,
          order_id,
          method,
          captured,
          email,
          contact,
          timestamp_paid: now
        });

        appendCSV([now, plink_id, "paid", "", contact, email, payment_id, order_id, method, captured].join(","));
      }

      res.status(200).send("ok");
    } catch (e) {
      console.error("Webhook error:", e);
      res.status(500).send("server error");
    }
  }
);

app.listen(PORT, () => {
  console.log(`✅ Server listening on ${PORT}`);
});
