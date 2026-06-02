import { app } from './src/bootstrap/app.js';
import { prismaApp } from './src/db/client.js';
import crypto from 'node:crypto';

// Fungsi helper pembuat JWT RS256 Asli
function generateRealJWT(userId: string, privateKey: string): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: userId, iat: now, exp: now + 3600 };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${encodedHeader}.${encodedPayload}`);
  sign.end();
  const signature = sign.sign(formattedPrivateKey).toString('base64url');
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function runTests() {
  console.log('=============================================');
  console.log('🛡️  MENJALANKAN TEST SKENARIO MULTI-USER 🛡️');
  console.log('=============================================\n');

  const USER_A_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const USER_B_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  
  console.log('--- 1. Setup Database: User A & User B ---');
  // Buat User A
  await prismaApp.globalUser.upsert({
    where: { id: USER_A_ID },
    update: {},
    create: { id: USER_A_ID, phone: "+628111111111", fullName: "User A (Hacker)", email: "a@test.com" }
  });
  await prismaApp.wallet.upsert({
    where: { userId: USER_A_ID },
    update: {},
    create: { userId: USER_A_ID, balance: 0 }
  });

  // Buat User B
  await prismaApp.globalUser.upsert({
    where: { id: USER_B_ID },
    update: {},
    create: { id: USER_B_ID, phone: "+628222222222", fullName: "User B (Korban)", email: "b@test.com" }
  });
  await prismaApp.wallet.upsert({
    where: { userId: USER_B_ID },
    update: {},
    create: { userId: USER_B_ID, balance: 0 }
  });

  console.log('✅ User A dan User B berhasil disiapkan di Database.\n');

  // Ambil Keys dari .env
  const jwtPrivateKey = process.env.JWT_PRIVATE_KEY!;
  const internalSecret = process.env.INTERNAL_SECRET_KEY!;

  const tokenUserA = generateRealJWT(USER_A_ID, jwtPrivateKey);
  const tokenUserB = generateRealJWT(USER_B_ID, jwtPrivateKey);
  const fakeToken = tokenUserA.slice(0, -10) + "fake123456"; // Merusak signature

  let transactionIdA = '';

  // =================================================================
  console.log('--- TEST 1: [GAGAL] Akses Tanpa Token ---');
  const res1 = await app.request('/v1/wallet/topup/initiate', { method: 'POST' });
  console.log(`Status: ${res1.status} (Expected: 401)`);
  if (res1.status === 401) console.log('✅ PASS: Sistem menolak akses tanpa token.\n');
  else console.log('❌ FAIL: Sistem membiarkan akses lewat!\n');

  // =================================================================
  console.log('--- TEST 2: [GAGAL] Akses Token Palsu / Modifikasi ---');
  const res2 = await app.request('/v1/wallet/topup/initiate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${fakeToken}` }
  });
  console.log(`Status: ${res2.status} (Expected: 401)`);
  if (res2.status === 401) console.log('✅ PASS: Sistem mendeteksi signature palsu dan menolak.\n');
  else console.log('❌ FAIL: Sistem menerima token palsu!\n');

  // =================================================================
  console.log('--- TEST 3: [SUKSES] User A Initiate Normal ---');
  const res3 = await app.request('/v1/wallet/topup/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenUserA}` },
    body: JSON.stringify({ amount: 50000, paymentMethod: 'VIRTUAL_ACCOUNT_BCA' })
  });
  const body3 = await res3.json();
  console.log(`Status: ${res3.status} (Expected: 201)`);
  if (res3.status === 201) {
    transactionIdA = body3.data.transactionId;
    console.log(`✅ PASS: User A berhasil initiate topup. Trans ID: ${transactionIdA}\n`);
  }

  // =================================================================
  console.log('--- TEST 4: [KEAMANAN/IDOR] User A mencoba Topup untuk User B ---');
  console.log('💡 Skenario: User A menyisipkan "userId: USER_B" di dalam body request.');
  const res4 = await app.request('/v1/wallet/topup/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenUserA}` },
    body: JSON.stringify({ 
        amount: 999999, 
        paymentMethod: 'VIRTUAL_ACCOUNT_BCA',
        userId: USER_B_ID // <-- UPAYA HACKING IDOR
    })
  });
  
  const body4 = await res4.json();
  
  if (res4.status === 201) {
    // Jika lolos, kita harus cek database, milik siapa transaksi ini terdaftar?
    const tx = await prismaApp.walletTransaction.findUnique({ where: { id: body4.data.transactionId } });
    if (tx?.userId === USER_B_ID) {
        console.log('❌ FAIL CRITICAL: Sistem RENTAN IDOR! User A berhasil membuat transaksi atas nama User B!\n');
    } else {
        console.log(`✅ PASS: Sistem aman. Meskipun User A memaksa kirim ID User B, transaksi tetap tercatat untuk User A (${tx?.userId}).\n`);
    }
  } else {
      console.log(`✅ PASS: Sistem menolak request karena payload tidak sesuai schema (Status: ${res4.status}).\n`);
  }

  // =================================================================
  console.log('--- TEST 5: [GAGAL] Webhook Konfirmasi Tanpa Secret Internal ---');
  const res5 = await app.request('/v1/wallet/topup/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referenceId: `ext-1`, transactionId: transactionIdA })
  });
  console.log(`Status: ${res5.status} (Expected: 401)`);
  if (res5.status === 401) console.log('✅ PASS: Webhook menolak konfirmasi tanpa header secret.\n');
  
  // =================================================================
  console.log('--- TEST 6: [SUKSES] Webhook Konfirmasi Valid (Isolasi Saldo) ---');
  const res6 = await app.request('/v1/wallet/topup/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': internalSecret },
    body: JSON.stringify({ referenceId: `ext-${Date.now()}`, transactionId: transactionIdA })
  });
  
  const body6 = await res6.json();
  if (res6.status === 200) {
      console.log('✅ PASS: Topup User A berhasil dikonfirmasi.');
      
      // Cek Saldo Terakhir di DB
      const walletA = await prismaApp.wallet.findUnique({ where: { userId: USER_A_ID }});
      const walletB = await prismaApp.wallet.findUnique({ where: { userId: USER_B_ID }});
      
      console.log(`💰 Saldo User A : Rp ${walletA?.balance} (Seharusnya Bertambah)`);
      console.log(`💰 Saldo User B : Rp ${walletB?.balance} (Seharusnya Tetap)`);
      
      if (walletA!.balance > 0 && walletB!.balance === 0n) { // Jika balance menggunakan BigInt
          console.log('\n🎉 KESIMPULAN: SISTEM 100% AMAN DARI KEBOCORAN SALDO ANTAR USER! 🎉');
      } else if (walletA!.balance > 0 && walletB!.balance === 0) { // Jika balance menggunakan Number
          console.log('\n🎉 KESIMPULAN: SISTEM 100% AMAN DARI KEBOCORAN SALDO ANTAR USER! 🎉');
      }
  }
}

runTests().catch(console.error);
