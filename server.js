const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const MONNIFY_API_KEY  = process.env.MONNIFY_API_KEY  || "MK_PROD_7N8LKYV3HH";
const MONNIFY_SECRET   = process.env.MONNIFY_SECRET   || "QE4MRPCHQ88YFTJZDZB1XM4VE1Q1FGVW";
const MONNIFY_CONTRACT = process.env.MONNIFY_CONTRACT || "812707482956";
const MONNIFY_BASE     = "https://api.monnify.com";
const FREE_CREDITS     = 500;

// ── FIREBASE ADMIN ──
const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    // Build service account from env variables
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
    // Handle all escape variations
    privateKey = privateKey.replace(/\\n/g, "\n").replace(/^"|"$/g, "");

    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID || "voicegen-11174",
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase initialized with:", serviceAccount.client_email);
  } catch(e) {
    console.error("❌ Firebase init error:", e.message);
  }
}

const db = admin.firestore();

// ── MONNIFY AUTH ──
async function getMonnifyToken() {
  const creds = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET}`).toString("base64");
  const res = await axios.post(`${MONNIFY_BASE}/api/v1/auth/login`, {},
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
    res.status(401).json({ error: "Invalid token: " + e.message });
    return null;
  }
}

// ── SETUP ACCOUNT ──
app.post("/api/setup-account", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;

  const uid   = user.uid;
  const email = user.email;
  const name  = user.name || email.split("@")[0];

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data().virtualAccount && userDoc.data().virtualAccount.length > 0) {
      return res.json({ success: true, data: userDoc.data() });
    }

    const ref = `VG-${uid.slice(0, 8).toUpperCase()}-${Date.now()}`;
    let virtualAccount = [];

    try {
      const token = await getMonnifyToken();
      const mRes = await axios.post(
        `${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts`,
        {
          accountReference: ref,
          accountName: `VoiceGen - ${name}`,
          currencyCode: "NGN",
          contractCode: MONNIFY_CONTRACT,
          customerEmail: email,
          customerName: name,
          getAllAvailableBanks: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const accounts = mRes.data.responseBody?.accounts || [];
      virtualAccount = accounts.map(a => ({
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        accountName: a.accountName,
      }));
      console.log(`✅ Created ${virtualAccount.length} virtual accounts for ${uid}`);
    } catch (mErr) {
      console.error("Monnify error:", mErr.response?.data || mErr.message);
    }

    const userData = {
      uid, email, name,
      credits: FREE_CREDITS,
      totalEarned: FREE_CREDITS,
      virtualAccount,
      accountRef: ref,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("users").doc(uid).set(userData, { merge: true });
    await db.collection("users").doc(uid).collection("transactions").add({
      type: "credit",
      amount: FREE_CREDITS,
      note: "Welcome bonus — 500 free credits",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ User ${uid} setup complete with ${FREE_CREDITS} credits`);
    return res.json({ success: true, data: userData });

  } catch (e) {
    console.error("setup-account error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── BALANCE ──
app.get("/api/balance", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) return res.json({ credits: 0, virtualAccount: [] });
    const data = doc.data();
    return res.json({ credits: data.credits || 0, virtualAccount: data.virtualAccount || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── DEDUCT CREDITS ──
app.post("/api/deduct-credits", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  const { characters, voiceName } = req.body;
  const cost = parseInt(characters);
  if (!cost || cost < 1) return res.status(400).json({ error: "Invalid character count" });
  try {
    const ref = db.collection("users").doc(user.uid);
    const doc = await ref.get();
    const current = doc.exists ? (doc.data().credits || 0) : 0;
    if (current < cost) return res.status(402).json({ error: "Insufficient credits", required: cost, available: current });
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

// ── MONNIFY WEBHOOK ──
app.post("/api/monnify-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const body = req.body.toString();
    const hash = crypto.createHmac("sha512", MONNIFY_SECRET).update(body).digest("hex");
    if (hash !== req.headers["monnify-signature"]) return res.status(400).json({ error: "Invalid signature" });

    const payload = JSON.parse(body);
    if (payload.eventType !== "SUCCESSFUL_TRANSACTION") return res.json({ received: true });

    const data = payload.eventData;
    const amountPaid = data.amountPaid;
    const accountRef = data.product?.reference || "";
    const paymentRef = data.transactionReference;

    const snap = await db.collection("users").where("accountRef", "==", accountRef).limit(1).get();
    if (snap.empty) return res.json({ received: true });

    const uid = snap.docs[0].id;
    const existing = await db.collection("users").doc(uid).collection("transactions").where("paymentRef", "==", paymentRef).get();
    if (!existing.empty) return res.json({ received: true, duplicate: true });

    const creditsToAdd = Math.floor(amountPaid * 10);
    await db.collection("users").doc(uid).update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
      totalEarned: admin.firestore.FieldValue.increment(creditsToAdd),
    });
    await db.collection("users").doc(uid).collection("transactions").add({
      type: "credit", amount: creditsToAdd, amountNGN: amountPaid, paymentRef,
      note: `Top-up — ₦${amountPaid.toLocaleString()} — ${creditsToAdd.toLocaleString()} credits`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true, creditsAdded: creditsToAdd });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── TRANSACTIONS ──
app.get("/api/transactions", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  try {
    const snap = await db.collection("users").doc(user.uid)
      .collection("transactions").orderBy("createdAt", "desc").limit(50).get();
    return res.json({ transactions: snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.json({ status: "VoiceGen API running ✅" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VoiceGen backend running on port ${PORT}`));
