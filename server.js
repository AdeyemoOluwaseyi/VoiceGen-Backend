const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(cors());

// ── CONFIG ──
const MONNIFY_API_KEY  = process.env.MONNIFY_API_KEY  || "MK_PROD_99EVW2RFRB";
const MONNIFY_SECRET   = process.env.MONNIFY_SECRET   || "2GZ8U3ZRZ62D5TJS45VUCS07ZE0RG4QC";
const MONNIFY_CONTRACT = process.env.MONNIFY_CONTRACT || "812707482956";
const MONNIFY_BASE     = "https://api.monnify.com";
const NOW_API_KEY      = process.env.NOW_API_KEY      || "SA090BY-AV64GMA-PWGKNJD-XBZ7FYP";
const NOW_IPN_SECRET   = process.env.NOW_IPN_SECRET   || "O3z/ufyIaTEJ+X2+zfisZ/vohfYGRcsG";
const FREE_CREDITS     = 500;
const REFERRAL_PCT     = 0.05; // 5%
const MIN_WITHDRAWAL   = 10000; // ₦10,000

// ── FIREBASE ──
const admin = require("firebase-admin");
if (!admin.apps.length) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1,-1);
  privateKey = privateKey.replace(/\\n/g,"\n");
  try {
    admin.initializeApp({ credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || "voicegen-11174",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey,
    })});
    console.log("✅ Firebase initialized:", process.env.FIREBASE_CLIENT_EMAIL);
  } catch(e) { console.error("❌ Firebase:", e.message); }
}
const db = admin.firestore();

// ── HELPERS ──
async function getMonnifyToken() {
  const creds = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET}`).toString("base64");
  const res = await axios.post(`${MONNIFY_BASE}/api/v1/auth/login`,{},{ headers:{ Authorization:`Basic ${creds}` }});
  return res.data.responseBody.accessToken;
}

async function verifyUser(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error:"Unauthorized" }); return null; }
  try { return await admin.auth().verifyIdToken(auth.split(" ")[1]); }
  catch(e) { res.status(401).json({ error:"Invalid token" }); return null; }
}

// Generate unique referral code
function genRefCode(uid) {
  return uid.slice(0,6).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();
}

// JSON for all except webhooks
app.use((req,res,next) => {
  if(["/api/monnify-webhook","/api/crypto-webhook"].includes(req.path)) return next();
  express.json()(req,res,next);
});

// ══════════════════════════════════════════
// POST /api/setup-account
// ══════════════════════════════════════════
app.post("/api/setup-account", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  const uid = user.uid, email = user.email, name = user.name || email.split("@")[0];
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data().virtualAccount?.length > 0) {
      return res.json({ success:true, data:userDoc.data() });
    }

    // Check if referred
    const refCode = req.body?.refCode || "";
    let referredBy = null;
    if (refCode) {
      const refSnap = await db.collection("users").where("referralCode","==",refCode).limit(1).get();
      if (!refSnap.empty && refSnap.docs[0].id !== uid) {
        referredBy = refSnap.docs[0].id;
      }
    }

    const ref = `VG-${uid.slice(0,8).toUpperCase()}-${Date.now()}`;
    const myRefCode = genRefCode(uid);
    let virtualAccount = [];

    try {
      const token = await getMonnifyToken();
      const mRes = await axios.post(`${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts`,{
        accountReference:ref, accountName:`VoiceGen - ${name}`,
        currencyCode:"NGN", contractCode:MONNIFY_CONTRACT,
        customerEmail:email, customerName:name, getAllAvailableBanks:true,
      },{ headers:{ Authorization:`Bearer ${token}` }});
      virtualAccount = (mRes.data.responseBody?.accounts||[]).map(a=>({
        bankName:a.bankName, accountNumber:a.accountNumber, accountName:a.accountName,
      }));
      console.log(`✅ Created ${virtualAccount.length} virtual accounts for ${uid}`);
    } catch(mErr) { console.error("Monnify:", mErr.response?.data||mErr.message); }

    const userData = {
      uid, email, name,
      credits: FREE_CREDITS, totalEarned: FREE_CREDITS,
      virtualAccount, accountRef: ref,
      referralCode: myRefCode,
      referredBy: referredBy || null,
      referralEarningsNGN: 0,
      referralCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("users").doc(uid).set(userData, { merge:true });
    await db.collection("users").doc(uid).collection("transactions").add({
      type:"credit", amount:FREE_CREDITS, note:"Welcome bonus — 500 free credits",
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notify referrer
    if (referredBy) {
      await db.collection("users").doc(referredBy).update({
        referralCount: admin.firestore.FieldValue.increment(1),
      });
      console.log(`✅ User ${uid} referred by ${referredBy}`);
    }

    console.log(`✅ User ${uid} setup, refCode: ${myRefCode}`);
    return res.json({ success:true, data:userData });
  } catch(e) { console.error("setup-account:", e.message); return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// GET /api/balance
// ══════════════════════════════════════════
app.get("/api/balance", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) return res.json({ credits:0, virtualAccount:[], referralCode:"", referralEarningsNGN:0, referralCount:0 });
    const d = doc.data();
    return res.json({
      credits: d.credits||0,
      virtualAccount: d.virtualAccount||[],
      accountRef: d.accountRef||"",
      referralCode: d.referralCode||"",
      referralEarningsNGN: d.referralEarningsNGN||0,
      referralCount: d.referralCount||0,
    });
  } catch(e) { return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// POST /api/deduct-credits
// ══════════════════════════════════════════
app.post("/api/deduct-credits", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  const { characters, voiceName } = req.body;
  const cost = parseInt(characters);
  if (!cost||cost<1) return res.status(400).json({ error:"Invalid" });
  try {
    const ref = db.collection("users").doc(user.uid);
    const doc = await ref.get();
    const current = doc.exists?(doc.data().credits||0):0;
    if (current<cost) return res.status(402).json({ error:"Insufficient credits", required:cost, available:current });
    await ref.update({ credits:admin.firestore.FieldValue.increment(-cost) });
    await ref.collection("transactions").add({
      type:"debit", amount:-cost,
      note:`Voiceover — ${voiceName||"Unknown"} — ${cost} chars`,
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success:true, creditsUsed:cost, remaining:current-cost });
  } catch(e) { return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// POST /api/create-crypto-payment
// Creates a NOWPayments invoice for credit top-up
// ══════════════════════════════════════════
app.post("/api/create-crypto-payment", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  const { amountUSD, creditsAmount } = req.body;
  if (!amountUSD||amountUSD<0.5) return res.status(400).json({ error:"Minimum $0.50" });
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    const userData = doc.data()||{};
    const orderId = `VG-CRYPTO-${user.uid.slice(0,8)}-${Date.now()}`;

    const response = await axios.post("https://api.nowpayments.io/v1/payment",{
      price_amount: amountUSD,
      price_currency: "usd",
      pay_currency: "usdttrc20",
      order_id: orderId,
      order_description: `VoiceGen ${creditsAmount.toLocaleString()} credits`,
      ipn_callback_url: "https://voicegen-production-0b6b.up.railway.app/api/crypto-webhook",
      success_url: "https://www.adeyemoseyi.com/voicegen",
      cancel_url: "https://www.adeyemoseyi.com/voicegen",
    },{ headers:{ "x-api-key":NOW_API_KEY, "Content-Type":"application/json" }});

    const payment = response.data;

    // Save pending payment
    await db.collection("cryptoPayments").doc(orderId).set({
      uid: user.uid,
      email: user.email,
      orderId,
      paymentId: payment.payment_id,
      amountUSD,
      creditsAmount: parseInt(creditsAmount),
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Crypto payment created: ${orderId}, ${amountUSD} USD`);
    return res.json({
      success: true,
      paymentId: payment.payment_id,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      payCurrency: payment.pay_currency,
      orderId,
    });
  } catch(e) {
    console.error("Crypto payment error:", e.response?.data||e.message);
    return res.status(500).json({ error: e.response?.data?.message||e.message });
  }
});

// ══════════════════════════════════════════
// POST /api/crypto-webhook
// NOWPayments IPN webhook
// ══════════════════════════════════════════
app.post("/api/crypto-webhook", express.raw({ type:"*/*" }), async (req,res) => {
  try {
    const rawBody = req.body.toString("utf8");
    const signature = req.headers["x-nowpayments-sig"];

    // Verify signature
    const sorted = JSON.parse(rawBody);
    const sortedStr = JSON.stringify(sorted, Object.keys(sorted).sort());
    const hash = crypto.createHmac("sha512", NOW_IPN_SECRET).update(sortedStr).digest("hex");

    if (signature && hash !== signature) {
      console.error("Invalid NOWPayments signature");
      return res.status(400).json({ error:"Invalid signature" });
    }

    const data = JSON.parse(rawBody);
    const { payment_status, order_id, actually_paid, pay_amount } = data;

    console.log(`Crypto webhook: ${order_id} — ${payment_status}`);

    if (!["finished","confirmed","partially_paid"].includes(payment_status)) {
      return res.json({ received:true, status:payment_status });
    }

    // Get pending payment
    const payDoc = await db.collection("cryptoPayments").doc(order_id).get();
    if (!payDoc.exists) { console.error("Payment not found:", order_id); return res.json({ received:true }); }

    const payData = payDoc.data();
    if (payData.status === "completed") return res.json({ received:true, duplicate:true });

    const uid = payData.uid;
    let creditsToAdd = payData.creditsAmount;

    // Handle partial payment
    if (payment_status === "partially_paid" && actually_paid < pay_amount) {
      const ratio = actually_paid / pay_amount;
      creditsToAdd = Math.floor(creditsToAdd * ratio);
    }

    // Credit user
    await db.collection("users").doc(uid).update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
      totalEarned: admin.firestore.FieldValue.increment(creditsToAdd),
    });

    await db.collection("users").doc(uid).collection("transactions").add({
      type:"credit", amount:creditsToAdd,
      note:`Crypto top-up — $${payData.amountUSD} USDT — ${creditsToAdd.toLocaleString()} credits`,
      paymentId: data.payment_id, orderId: order_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update payment record
    await db.collection("cryptoPayments").doc(order_id).update({ status:"completed", completedAt:admin.firestore.FieldValue.serverTimestamp() });

    // Pay referral commission (5% of USD value in NGN — approx ₦1,600/$1)
    const userDoc = await db.collection("users").doc(uid).get();
    const referredBy = userDoc.data()?.referredBy;
    if (referredBy) {
      const usdToNgn = 1600;
      const commissionNGN = Math.floor(payData.amountUSD * usdToNgn * REFERRAL_PCT);
      await db.collection("users").doc(referredBy).update({
        referralEarningsNGN: admin.firestore.FieldValue.increment(commissionNGN),
      });
      await db.collection("users").doc(referredBy).collection("referralEarnings").add({
        fromUid:uid, fromEmail:payData.email, amountNGN:commissionNGN,
        note:`5% referral from $${payData.amountUSD} USDT payment`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ Referral commission ₦${commissionNGN} to ${referredBy}`);
    }

    console.log(`✅ Credited ${creditsToAdd} to ${uid}`);
    return res.json({ success:true, creditsAdded:creditsToAdd });
  } catch(e) { console.error("Crypto webhook:", e.message); return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// POST /api/monnify-webhook
// ══════════════════════════════════════════
app.post("/api/monnify-webhook", express.raw({ type:"*/*" }), async (req,res) => {
  try {
    const rawBody = req.body.toString("utf8");
    const signature = req.headers["monnify-signature"];
    const hash = crypto.createHmac("sha512",MONNIFY_SECRET).update(rawBody).digest("hex");
    if (signature && hash!==signature) { console.error("Invalid Monnify sig"); }

    const payload = JSON.parse(rawBody);
    if (payload.eventType!=="SUCCESSFUL_TRANSACTION") return res.json({ received:true });

    const data = payload.eventData;
    const amountPaid = data.amountPaid;
    const accountRef = data.product?.reference||data.metaData?.accountReference||"";
    const paymentRef = data.transactionReference;

    const snap = await db.collection("users").where("accountRef","==",accountRef).limit(1).get();
    if (snap.empty) { console.error("No user for ref:", accountRef); return res.json({ received:true }); }

    const uid = snap.docs[0].id;
    const existing = await db.collection("users").doc(uid).collection("transactions")
      .where("paymentRef","==",paymentRef).get();
    if (!existing.empty) return res.json({ received:true, duplicate:true });

    const creditsToAdd = Math.floor(amountPaid*10);
    await db.collection("users").doc(uid).update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
      totalEarned: admin.firestore.FieldValue.increment(creditsToAdd),
    });
    await db.collection("users").doc(uid).collection("transactions").add({
      type:"credit", amount:creditsToAdd, amountNGN:amountPaid, paymentRef,
      note:`Top-up — ₦${amountPaid.toLocaleString()} — ${creditsToAdd.toLocaleString()} credits`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Referral commission for Naira payment
    const userDoc = await db.collection("users").doc(uid).get();
    const referredBy = userDoc.data()?.referredBy;
    if (referredBy) {
      const commissionNGN = Math.floor(amountPaid*REFERRAL_PCT);
      await db.collection("users").doc(referredBy).update({
        referralEarningsNGN: admin.firestore.FieldValue.increment(commissionNGN),
      });
      await db.collection("users").doc(referredBy).collection("referralEarnings").add({
        fromUid:uid, amountNGN:commissionNGN,
        note:`5% referral from ₦${amountPaid.toLocaleString()} Naira payment`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ Referral ₦${commissionNGN} to ${referredBy}`);
    }

    console.log(`✅ Credited ${creditsToAdd} to ${uid}`);
    return res.json({ success:true, creditsAdded:creditsToAdd });
  } catch(e) { console.error("Monnify webhook:", e.message); return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// GET /api/transactions
// ══════════════════════════════════════════
app.get("/api/transactions", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  try {
    const snap = await db.collection("users").doc(user.uid).collection("transactions")
      .orderBy("createdAt","desc").limit(50).get();
    return res.json({ transactions: snap.docs.map(d=>({ id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate() })) });
  } catch(e) { return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// GET /api/referral-earnings
// ══════════════════════════════════════════
app.get("/api/referral-earnings", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  try {
    const snap = await db.collection("users").doc(user.uid).collection("referralEarnings")
      .orderBy("createdAt","desc").limit(50).get();
    return res.json({ earnings: snap.docs.map(d=>({ id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate() })) });
  } catch(e) { return res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════
// POST /api/request-withdrawal
// ══════════════════════════════════════════
app.post("/api/request-withdrawal", async (req,res) => {
  const user = await verifyUser(req,res);
  if (!user) return;
  const { amount, bankName, accountNumber, accountName } = req.body;
  if (!amount||amount<MIN_WITHDRAWAL) return res.status(400).json({ error:`Minimum withdrawal is ₦${MIN_WITHDRAWAL.toLocaleString()}` });
  if (!bankName||!accountNumber||!accountName) return res.status(400).json({ error:"Bank details required" });
  try {
    const ref = db.collection("users").doc(user.uid);
    const doc = await ref.get();
    const balance = doc.data()?.referralEarningsNGN||0;
    if (balance<amount) return res.status(400).json({ error:"Insufficient referral balance" });

    // Deduct and create withdrawal request
    await ref.update({ referralEarningsNGN:admin.firestore.FieldValue.increment(-amount) });
    await db.collection("withdrawalRequests").add({
      uid:user.uid, email:user.email, amount,
      bankName, accountNumber, accountName,
      status:"pending",
      note:"Manual processing — within 20 hours",
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.collection("transactions").add({
      type:"withdrawal", amount:-amount,
      note:`Withdrawal request — ₦${amount.toLocaleString()} to ${bankName} ${accountNumber}`,
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✅ Withdrawal request: ₦${amount} from ${user.uid}`);
    return res.json({ success:true, message:"Withdrawal request submitted. Processing within 20 hours." });
  } catch(e) { return res.status(500).json({ error:e.message }); }
});

app.get("/", (req,res) => res.json({ status:"VoiceGen API ✅" }));
const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>console.log(`VoiceGen backend on port ${PORT}`));
    
