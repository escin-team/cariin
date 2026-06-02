import { app } from './src/bootstrap/app.js';
import { prismaApp } from './src/db/client.js';
import crypto from 'crypto';

// Fungsi untuk membuat JWT Token asli (RS256) menggunakan Private Key
function generateRealJWT(userId: string, privateKey: string): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    iat: now,
    exp: now + 3600 // Valid selama 1 jam
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  // Pastikan newline character dirender dengan benar dari string .env
  const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${encodedHeader}.${encodedPayload}`);
    sign.end();
    const signature = sign.sign(formattedPrivateKey).toString('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  } catch (err) {
    console.warn("\n⚠️ PERINGATAN KELAYAKAN KUNCI: Gagal menandatangani token menggunakan crypto module.");
    console.warn("⚠️ Alasan: JWT_PRIVATE_KEY di .env adalah format dummy/invalid.");
    console.warn("⚠️ Jatuh kembali ke mode Mock Signature...\n");
    return `${encodedHeader}.${encodedPayload}.mock_signature_bypass`;
  }
}

async function runTests() {
  console.log('--- Setup Database ---');
  const testUserId = "123e4567-e89b-12d3-a456-426614174000";
  
  let user = await prismaApp.globalUser.findUnique({ where: { id: testUserId } });
  if (!user) {
    user = await prismaApp.globalUser.create({
      data: {
        id: testUserId,
        phone: "+6281234567890",
        fullName: "Real Tester User",
        email: "tester.user@example.com"
      }
    });
    console.log('✅ Created real tester user in DB');
  } else {
    console.log('ℹ️ Real tester user already exists in DB');
  }

  let wallet = await prismaApp.wallet.findUnique({ where: { userId: testUserId } });
  if (!wallet) {
    wallet = await prismaApp.wallet.create({
      data: {
        userId: testUserId,
        balance: 0,
      }
    });
    console.log('✅ Created wallet for tester user');
  } else {
    console.log(`ℹ️ Wallet already exists. Current Balance: ${wallet.balance}`);
  }

  console.log('\n--- Generating Authenticated JWT Token ---');
  
  // Menggunakan JWT_PRIVATE_KEY sesuai di .env app kamu
  const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
  if (!jwtPrivateKey) {
    console.error('❌ Error: JWT_PRIVATE_KEY tidak ditemukan di process.env! Pastikan file .env sudah benar.');
    return;
  }
  
  const token = generateRealJWT(testUserId, jwtPrivateKey);
  console.log('✅ JWT Token Generated Process Finished.');

  console.log('\n--- Testing Initiate Topup ---');
  
  let transactionId = '';
  const initiateRes = await app.request('/v1/wallet/topup/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      amount: 50000,
      paymentMethod: 'VIRTUAL_ACCOUNT_BCA'
    })
  });
  
  const initiateBody = await initiateRes.json();
  console.log('Initiate Status:', initiateRes.status);
  console.log('Initiate Body:', JSON.stringify(initiateBody, null, 2));
  
  if (initiateRes.status === 201 && initiateBody.success) {
    transactionId = initiateBody.data.transactionId;
    console.log(`✅ Topup berhasil diinisiasi. Transaction ID: ${transactionId}`);
  } else {
    console.error('❌ Failed to initiate topup. Aborting remaining tests.');
    return;
  }

  console.log('\n--- Testing Confirm Topup (Internal Webhook Simulation) ---');
  
  // Menggunakan key yang tepat sesuai di file env-validation.ts
  const internalSecret = process.env.INTERNAL_SECRET_KEY || "dummy-internal-secret-key-at-least-32-chars";
  
  const confirmRes = await app.request('/v1/wallet/topup/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret
    },
    body: JSON.stringify({
      referenceId: `ext-ref-${Date.now()}`,
      transactionId: transactionId
    })
  });
  
  const confirmStatus = confirmRes.status;
  const confirmBody = await confirmRes.json();
  
  console.log('Confirm Status:', confirmStatus);
  console.log('Confirm Body:', JSON.stringify(confirmBody, null, 2));
  
  if (confirmStatus === 200 && confirmBody.success) {
    console.log('\n🎉 TEST SUCCESS: Saldo berhasil ditambahkan secara aman!');
    console.log(`Saldo Akhir: ${confirmBody.data.wallet.balance}`);
  } else {
    console.error('\n❌ TEST FAILED: Gagal mengonfirmasi topup.');
  }
}

runTests().catch(console.error);
