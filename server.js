const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(cors());

const MONNIFY_API_KEY  = process.env.MONNIFY_API_KEY  || "MK_PROD_99EVW2RFRB";
const MONNIFY_SECRET   = process.env.MONNIFY_SECRET   || "2GZ8U3ZRZ62D5TJS45VUCS07ZE0RG4QC";
const MONNIFY_CONTRACT = process.env.MONNIFY_CONTRACT || "812707482956";
const MONNIFY_BASE     = "https://api.monnify.com";
const FREE_CREDITS     = 500;

const admin = require("firebase-admin");
if (!admin.apps.length) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
  privateKey = privateKey.replace(/\\n/g, "\n");
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID || "voicegen-11174",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    console.log("✅ Firebase initialized:", process.env.FIREBASE_CLIENT_EMAIL);
  } catch(e) { console.error("❌ Firebase init error:", e.message); }
}
const db = admin.firestore();

async function getMonnifyToken() {
  const creds = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET}`).toString("base64");
  const res = await axios.post(`${MONNIFY_BASE}/api/v1/auth/login`, {}, {
    headers: { Authorization: `Basic ${creds}` }
  });
  return res.data.responseBody.accessToken;
}

async function verifyUser(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return null; }
  try {
    return await admin.auth().verifyIdToken(auth.split(" ")[1]);
  } catch(e) { res.status(401).json({ error: "Invalid token" }); return null; }
}

// JSON parser for all except webhook
app.use((req, res, next) => {
  if (req.path === "/api/monnify-webhook") return next();
  express.json()(req, res, next);
});

// ── SETUP ACCOUNT ──
app.post("/api/setup-account", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  const uid = user.uid, email = user.email, name = user.name || email.split("@")[0];
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data().virtualAccount?.length > 0) {
      return res.json({ success: true, data: userDoc.data() });
    }
    const ref = `VG-${uid.slice(0,8).toUpperCase()}-${Date.now()}`;
    let virtualAccount = [];
    try {
      const token = await getMonnifyToken();
      const mRes = await axios.post(`${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts`, {
        accountReference: ref, accountName: `VoiceGen - ${name}`,
        currencyCode: "NGN", contractCode: MONNIFY_CONTRACT,
        customerEmail: email, customerName: name, getAllAvailableBanks: true,
      }, { headers: { Authorization: `Bearer ${token}` } });
      virtualAccount = (mRes.data.responseBody?.accounts || []).map(a => ({
        bankName: a.bankName, accountNumber: a.accountNumber, accountName: a.accountName,
      }));
      console.log(`✅ Created ${virtualAccount.length} virtual accounts for ${uid}`);
    } catch(mErr) { console.error("Monnify error:", mErr.response?.data || mErr.message); }
    const userData = { uid, email, name, credits: FREE_CREDITS, totalEarned: FREE_CREDITS, virtualAccount, accountRef: ref, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    await db.collection("users").doc(uid).set(userData, { merge: true });
    await db.collection("users").doc(uid).collection("transactions").add({ type: "credit", amount: FREE_CREDITS, note: "Welcome bonus — 500 free credits", createdAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`✅ User ${uid} setup with ${FREE_CREDITS} credits, accountRef: ${ref}`);
    return res.json({ success: true, data: userData });
  } catch(e) { console.error("setup-account error:", e.message); return res.status(500).json({ error: e.message }); }
});

// ── BALANCE ──
app.get("/api/balance", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) return res.json({ credits: 0, virtualAccount: [] });
    const data = doc.data();
    return res.json({ credits: data.credits || 0, virtualAccount: data.virtualAccount || [], accountRef: data.accountRef || "" });
  } catch(e) { return res.status(500).json({ error: e.message }); }
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
    await ref.collection("transactions").add({ type: "debit", amount: -cost, note: `Voiceover — ${voiceName || "Unknown"} — ${cost} chars`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ success: true, creditsUsed: cost, remaining: current - cost });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// ── MONNIFY WEBHOOK ──
app.post("/api/monnify-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["monnify-signature"];
    const rawBody   = req.body.toString("utf8");

    console.log("=== WEBHOOK RECEIVED ===");
    console.log("Signature present:", !!signature);
    console.log("Body:", rawBody.substring(0, 500));

    // Verify signature
    const hash = crypto.createHmac("sha512", MONNIFY_SECRET).update(rawBody).digest("hex");
    console.log("Hash match:", hash === signature);

    if (signature && hash !== signature) {
      console.error("❌ Signature mismatch");
      // Don't reject — log and continue to help debug
    }

    const payload   = JSON.parse(rawBody);
    const eventType = payload.eventType;
    const data      = payload.eventData;

    console.log("Event type:", eventType);
    console.log("Event data keys:", Object.keys(data || {}));

    if (eventType !== "SUCCESSFUL_TRANSACTION") {
      return res.json({ received: true, eventType });
    }

    const amountPaid = data.amountPaid;
    // Try all possible locations for the account reference
    const accountRef = data.product?.reference
      || data.metaData?.accountReference
      || data.accountReference
      || data.reservedAccountCode
      || "";

    console.log("Amount paid:", amountPaid);
    console.log("Account ref found:", accountRef);
    console.log("Full product:", JSON.stringify(data.product));
    console.log("Full metaData:", JSON.stringify(data.metaData));

    // Search all users to find by accountRef
    const snap = await db.collection("users").where("accountRef", "==", accountRef).limit(1).get();
    console.log("User found:", !snap.empty, "for ref:", accountRef);

    if (snap.empty) {
      // Log ALL users to help debug
      const allUsers = await db.collection("users").get();
      console.log("All user accountRefs:");
      allUsers.forEach(d => console.log(" -", d.data().accountRef, "uid:", d.id));
      return res.json({ received: true, note: "user not found for ref: " + accountRef });
    }

    const uid = snap.docs[0].id;
    const paymentRef = data.transactionReference;

    // Check duplicate
    const existing = await db.collection("users").doc(uid).collection("transactions")
      .where("paymentRef", "==", paymentRef).get();
    if (!existing.empty) return res.json({ received: true, duplicate: true });

    // ₦100 = 1,000 credits
    const creditsToAdd = Math.floor(amountPaid * 10);
    await db.collection("users").doc(uid).update({
      credits:     admin.firestore.FieldValue.increment(creditsToAdd),
      totalEarned: admin.firestore.FieldValue.increment(creditsToAdd),
    });
    await db.collection("users").doc(uid).collection("transactions").add({
      type: "credit", amount: creditsToAdd, amountNGN: amountPaid, paymentRef,
      note: `Top-up — ₦${amountPaid.toLocaleString()} — ${creditsToAdd.toLocaleString()} credits`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Credited ${creditsToAdd} to user ${uid}`);
    return res.json({ success: true, creditsAdded: creditsToAdd });

  } catch(e) {
    console.error("Webhook error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── TRANSACTIONS ──
app.get("/api/transactions", async (req, res) => {
  const user = await verifyUser(req, res);
  if (!user) return;
  try {
    const snap = await db.collection("users").doc(user.uid).collection("transactions")
      .orderBy("createdAt", "desc").limit(50).get();
    return res.json({ transactions: snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() })) });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

app.get("/", (req, res) => res.json({ status: "VoiceGen API running ✅" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VoiceGen backend running on port ${PORT}`));
