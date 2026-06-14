const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(cors());

// ── CONFIG ──
const MONNIFY_API_KEY  = process.env.MONNIFY_API_KEY  || "MK_PROD_7N8LKYV3HH";
const MONNIFY_SECRET   = process.env.MONNIFY_SECRET   || "QE4MRPCHQ88YFTJZDZB1XM4VE1Q1FGVW";
const MONNIFY_CONTRACT = process.env.MONNIFY_CONTRACT || "812707482956";
const MONNIFY_BASE     = "https://api.monnify.com";
const FREE_CREDITS     = 500;

// ── FIREBASE ADMIN ──
const admin = require("firebase-admin");

if (!admin.apps.length) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID || "voicegen-11174",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  privateKey,
      }),
    });
    console.log("✅ Firebase initialized with:", process.env.FIREBASE_CLIENT_EMAIL);
  } catch(e) {
    console.error("❌ Firebase init error:", e.message);
  }
}

const db = admin.firestore();

// ── MONNIFY AUTH ──
async function getMonnifyToken() {
  const creds = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET}`).toString("base64");
  const res = await axios.post(
    `${MONNIFY_BASE}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${creds}` } }
  );
  return res.data.responseBody.accessToken;
}

// ── VERIFY FIREBASE TOKEN ──
async function verifyUser(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(auth.split(" ")[1]);
    return decoded;
  } catch (e) {
    console.error("Token verify error:", e.message);
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

// ── JSON body parser for all routes except webhook ──
app.use((req, res, next) => {
  if (req.path === "/api/monnify-webhook") return next();
  express.json()(req, res, next);
});

// ══════════════════════════════════════════
// POST /api/setup-account
// ══════════════════════════════════════════
app.post("/api/setup-account", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;

  const uid   = user.uid;
  const email = user.email;
  const name  = user.name || email.split("@")[0];

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data().virtualAccount && userDoc.data().virtualAccount.length > 0) {
      console.log(`User ${uid} already set up`);
      return res.json({ success: true, data: userDoc.data() });
    }

    const ref = `VG-${uid.slice(0, 8).toUpperCase()}-${Date.now()}`;
    let virtualAccount = [];

    try {
      const token = await getMonnifyToken();
      const mRes = await axios.post(
        `${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts`,
        {
          accountReference:    ref,
          accountName:         `VoiceGen - ${name}`,
          currencyCode:        "NGN",
          contractCode:        MONNIFY_CONTRACT,
          customerEmail:       email,
          customerName:        name,
          getAllAvailableBanks: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const accounts = mRes.data.responseBody?.accounts || [];
      virtualAccount = accounts.map(a => ({
        bankName:      a.bankName,
        accountNumber: a.accountNumber,
        accountName:   a.accountName,
      }));
      console.log(`✅ Created ${virtualAccount.length} virtual accounts for ${uid}`);
    } catch (mErr) {
      console.error("Monnify error:", mErr.response?.data || mErr.message);
    }

    const userData = {
      uid, email, name,
      credits:     FREE_CREDITS,
      totalEarned: FREE_CREDITS,
      virtualAccount,
      accountRef:  ref,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("users").doc(uid).set(userData, { merge: true });
    await db.collection("users").doc(uid).collection("transactions").add({
      type:      "credit",
      amount:    FREE_CREDITS,
      note:      "Welcome bonus — 500 free credits",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ User ${uid} setup complete with ${FREE_CREDITS} credits`);
    return res.json({ success: true, data: userData });

  } catch (e) {
    console.error("setup-account error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// GET /api/balance
// ══════════════════════════════════════════
app.get("/api/balance", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) return res.json({ credits: 0, virtualAccount: [] });
    const data = doc.data();
    return res.json({
      credits:        data.credits || 0,
      virtualAccount: data.virtualAccount || [],
      accountRef:     data.accountRef || "",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// POST /api/deduct-credits
// ══════════════════════════════════════════
app.post("/api/deduct-credits", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  const { characters, voiceName } = req.body;
  if (!characters || characters < 1) return res.status(400).json({ error: "Invalid character count" });
  const cost = parseInt(characters);
  const uid  = user.uid;
  try {
    const ref     = db.collection("users").doc(uid);
    const doc     = await ref.get();
    const current = doc.exists ? (doc.data().credits || 0) : 0;
    if (current < cost) {
      return res.status(402).json({ error: "Insufficient credits", required: cost, available: current });
    }
    await ref.update({ credits: admin.firestore.FieldValue.increment(-cost) });
    await ref.collection("transactions").add({
      type: "debit", amount: -cost,
      note: `Voiceover — ${voiceName || "Unknown"} — ${cost} chars`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true, creditsUsed: cost, remaining: current - cost });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// POST /api/monnify-webhook
// Raw body required for signature verification
// ══════════════════════════════════════════
app.post("/api/monnify-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["monnify-signature"];
    const rawBody   = req.body.toString("utf8");

    console.log("Webhook received, signature:", signature ? "present" : "missing");
    console.log("Raw body length:", rawBody.length);

    // Verify signature
    const hash = crypto
      .createHmac("sha512", MONNIFY_SECRET)
      .update(rawBody)
      .digest("hex");

    console.log("Expected hash:", hash.substring(0, 20) + "...");
    console.log("Received sig:", signature ? signature.substring(0, 20) + "..." : "none");

    if (signature && hash !== signature) {
      console.error("❌ Invalid webhook signature");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const payload   = JSON.parse(rawBody);
    const eventType = payload.eventType;
    const data      = payload.eventData;

    console.log("Webhook eventType:", eventType);

    if (eventType !== "SUCCESSFUL_TRANSACTION") {
      return res.json({ received: true, eventType });
    }

    const amountPaid = data.amountPaid;
    const accountRef = data.product?.reference || data.metaData?.accountReference || "";
    const paymentRef = data.transactionReference;

    console.log("Payment received:", amountPaid, "NGN, accountRef:", accountRef);

    if (!accountRef) {
      console.error("No accountRef found in webhook payload");
      return res.json({ received: true, note: "no accountRef" });
    }

    // Find user by accountRef
    const snap = await db.collection("users")
      .where("accountRef", "==", accountRef)
      .limit(1).get();

    if (snap.empty) {
      console.error("No user found for accountRef:", accountRef);
      return res.json({ received: true, note: "user not found" });
    }

    const uid = snap.docs[0].id;

    // Check duplicate
    const existing = await db.collection("users").doc(uid)
      .collection("transactions")
      .where("paymentRef", "==", paymentRef).get();

    if (!existing.empty) {
      return res.json({ received: true, duplicate: true });
    }

    // ₦100 = 1,000 credits
    const creditsToAdd = Math.floor(amountPaid * 10);

    await db.collection("users").doc(uid).update({
      credits:     admin.firestore.FieldValue.increment(creditsToAdd),
      totalEarned: admin.firestore.FieldValue.increment(creditsToAdd),
    });

    await db.collection("users").doc(uid).collection("transactions").add({
      type: "credit", amount: creditsToAdd,
      amountNGN: amountPaid, paymentRef,
      note: `Top-up — ₦${amountPaid.toLocaleString()} — ${creditsToAdd.toLocaleString()} credits`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Credited ${creditsToAdd} credits to user ${uid}`);
    return res.json({ success: true, creditsAdded: creditsToAdd });

  } catch (e) {
    console.error("Webhook error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// GET /api/transactions
// ══════════════════════════════════════════
app.get("/api/transactions", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  try {
    const snap = await db.collection("users").doc(user.uid)
      .collection("transactions").orderBy("createdAt", "desc").limit(50).get();
    const txns = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt?.toDate()
    }));
    return res.json({ transactions: txns });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Health check
app.get("/", (req, res) => res.json({ status: "VoiceGen API running ✅" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VoiceGen backend running on port ${PORT}`));
