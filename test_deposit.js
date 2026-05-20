#!/usr/bin/env node
// test_deposit.js — end-to-end deposit test for Ghost Bank
// Usage: node test_deposit.js
// Requires the server to be running on port 5000.

const fs   = require("fs");
const path = require("path");
const http = require("http");

const GHOST_BANK_FILE = path.join(__dirname, "data", "ghostBank.json");
const BASE_URL        = "http://localhost:5000";

const TEST_JID        = "2349000000001@s.whatsapp.net";
const TEST_PHONE      = "2349000000001";
const TEST_ACCT_NUM   = "9900000001";
const TEST_TX_REF     = `GHOST_${TEST_PHONE}_test_${Date.now()}`;
const TEST_FLW_REF    = `FLW-TEST-${Date.now()}`;
const TEST_AMOUNT     = 2500;

function log(icon, msg) { console.log(`${icon}  ${msg}`); }

// ── helpers ──────────────────────────────────────────────────────────────────
function readGhostBank() {
  try { return JSON.parse(fs.readFileSync(GHOST_BANK_FILE, "utf8")); }
  catch { return {}; }
}

function writeGhostBank(data) {
  fs.writeFileSync(GHOST_BANK_FILE, JSON.stringify(data, null, 2));
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request(
      { hostname: "localhost", port: 5000, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end",  ()  => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  let passed = 0;
  let failed = 0;

  log("🔧", "Starting Ghost Bank deposit test...\n");

  // ── STEP 1: Seed a fake account ───────────────────────────────────────────
  const bankBefore = readGhostBank();
  bankBefore[TEST_JID] = {
    accountNumber: TEST_ACCT_NUM,
    bankName:      "Indulge MFB",
    acctName:      "Test User MFG",
    txRef:         TEST_TX_REF,
    balance:       1000,
    transactions:  [],
    createdAt:     new Date().toISOString()
  };
  writeGhostBank(bankBefore);
  log("📝", `Seeded test account: ${TEST_ACCT_NUM} (balance ₦1,000)`);

  // ── STEP 2: Wait 200ms for server to have fresh disk state ────────────────
  await new Promise(r => setTimeout(r, 200));

  // ── STEP 3: Simulate Flutterwave webhook (match by account_number) ─────────
  const flwPayload = {
    event:  "charge.completed",
    data: {
      status:         "successful",
      tx_ref:         TEST_TX_REF,
      flw_ref:        TEST_FLW_REF,
      amount:         TEST_AMOUNT,
      currency:       "NGN",
      account_number: TEST_ACCT_NUM,
      narration:      "Test deposit from sender",
      customer:       { name: "Sender Name", email: "sender@test.com", phone_number: "08000000000" }
    }
  };

  log("📡", "POSTing webhook to /webhook/flutterwave...");
  let res;
  try {
    res = await post("/webhook/flutterwave", flwPayload);
    log("📨", `Server replied: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  } catch (e) {
    log("❌", `HTTP request failed: ${e.message}`);
    log("❌", "Is the server running on port 5000?");
    process.exit(1);
  }

  if (res.status === 200) {
    log("✅", "Webhook acknowledged (HTTP 200)"); passed++;
  } else {
    log("❌", `Unexpected status: ${res.status}`); failed++;
  }

  // ── STEP 4: Wait for async processPaymentEvent to complete ────────────────
  await new Promise(r => setTimeout(r, 800));

  // ── STEP 5: Verify balance updated on disk ────────────────────────────────
  const bankAfter  = readGhostBank();
  const acct       = bankAfter[TEST_JID];

  if (!acct) {
    log("❌", "Test account missing from ghostBank.json after webhook!"); failed++;
  } else {
    const expectedBalance = 1000 + TEST_AMOUNT; // 3500
    if (acct.balance === expectedBalance) {
      log("✅", `Balance updated correctly: ₦1,000 → ₦${acct.balance.toLocaleString()} (+₦${TEST_AMOUNT})`); passed++;
    } else {
      log("❌", `Balance wrong: expected ₦${expectedBalance}, got ₦${acct.balance}`); failed++;
    }

    const tx = (acct.transactions || []).find(t => t.flwRef === TEST_FLW_REF);
    if (tx) {
      log("✅", `Transaction recorded: +₦${tx.amount} — "${tx.narration}" — ${tx.date}`); passed++;
    } else {
      log("❌", "Transaction NOT recorded in transactions array"); failed++;
    }
  }

  // ── STEP 6: Duplicate guard — send same event again ───────────────────────
  log("\n🔁", "Testing duplicate guard (same flwRef)...");
  await post("/webhook/flutterwave", flwPayload);
  await new Promise(r => setTimeout(r, 600));

  const bankDup = readGhostBank();
  const acctDup = bankDup[TEST_JID];
  const dupeCount = (acctDup?.transactions || []).filter(t => t.flwRef === TEST_FLW_REF).length;
  if (dupeCount === 1) {
    log("✅", "Duplicate guard works — transaction only recorded once"); passed++;
  } else {
    log("❌", `Duplicate guard FAILED — transaction recorded ${dupeCount} times`); failed++;
  }

  // ── STEP 7: Match by txRef (no account_number in payload) ─────────────────
  log("\n🔁", "Testing txRef-based matching (no account_number in payload)...");
  const txRefPayload = {
    event: "charge.completed",
    data: {
      status:    "successful",
      tx_ref:    TEST_TX_REF,
      flw_ref:   `${TEST_FLW_REF}_txref`,
      amount:    500,
      currency:  "NGN",
      narration: "txRef match test",
      customer:  { name: "Another Sender" }
    }
  };
  await post("/webhook/flutterwave", txRefPayload);
  await new Promise(r => setTimeout(r, 600));
  const bankTxRef = readGhostBank();
  const acctTxRef = bankTxRef[TEST_JID];
  if (acctTxRef?.balance === 3500 + 500) {
    log("✅", `txRef match works — balance now ₦${acctTxRef.balance.toLocaleString()}`); passed++;
  } else {
    log("❌", `txRef match FAILED — balance: ₦${acctTxRef?.balance}`); failed++;
  }

  // ── STEP 8: Clean up test data ────────────────────────────────────────────
  const bankFinal = readGhostBank();
  delete bankFinal[TEST_JID];
  writeGhostBank(bankFinal);
  log("\n🧹", "Cleaned up test account from ghostBank.json");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("✅  ALL TESTS PASSED — deposits are working correctly");
  } else {
    console.log("❌  SOME TESTS FAILED — check output above");
    process.exit(1);
  }
})();
