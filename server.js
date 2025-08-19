import express from "express";
import Razorpay from "razorpay";
import bodyParser from "body-parser";
import fs from "fs";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// __dirname fix for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Env variables
const { RZP_KEY_ID, RZP_KEY_SECRET, WEBHOOK_SECRET, ALLOWED_ORIGIN } = process.env;

app.use(bodyParser.json());

// ✅ CORS setup
app.use(cors({
  origin: ALLOWED_ORIGIN === "*" ? "*" : [ALLOWED_ORIGIN],
}));

// ✅ Razorpay instance
const razorpay = new Razorpay({
  key_id: RZP_KEY_ID,
  key_secret: RZP_KEY_SECRET,
});

// ✅ Serve frontend static files
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ✅ Create payment link
app.post("/create-link", async (req, res) => {
  try {
    const { amount, name, email, contact } = req.body;
    const amtPaise = Math.round(Number(amount) * 100);

    const paymentLink = await razorpay.paymentLink.create({
      amount: amtPaise,
      currency: "INR",
      customer: { name, email, contact },
      notify: { sms: true, email: true },
      reminder_enable: true,
      callback_url: "https://rozorpay.onrender.com/success",
      callback_method: "get",
    });

    res.json(paymentLink);
  } catch (err) {
    console.error("Create link error:", err);
    res.status(500).json({ error: "Failed to create link. Check server logs." });
  }
});

// ✅ Webhook handler
app.post("/webhook", (req, res) => {
  const secret = WEBHOOK_SECRET;
  const shasum = crypto.createHmac("sha256", secret);
  shasum.update(JSON.stringify(req.body));
  const digest = shasum.digest("hex");

  if (req.headers["x-razorpay-signature"] === digest) {
    console.log("Webhook verified:", req.body.event);

    // Save data to payments.json
    if (!fs.existsSync("payments.json")) fs.writeFileSync("payments.json", "[\n");
    fs.appendFileSync("payments.json", JSON.stringify(req.body, null, 2) + ",\n");

    res.json({ status: "ok" });
  } else {
    res.status(400).send("Invalid signature");
  }
});

// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
