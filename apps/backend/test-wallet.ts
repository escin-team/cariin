import { app } from './src/bootstrap/app.js';
import { prismaApp } from './src/db/client.js';

async function runTests() {
  console.log('--- Setup Database ---');
  const testUserId = "123e4567-e89b-12d3-a456-426614174000";
  
  // Create or ensure GlobalUser exists
  let user = await prismaApp.globalUser.findUnique({ where: { id: testUserId } });
  if (!user) {
    user = await prismaApp.globalUser.create({
      data: {
        id: testUserId,
        phone: "+6281234567890",
        fullName: "Test User",
      }
    });
    console.log('Created test user');
  } else {
    console.log('Test user already exists');
  }

  // Create or ensure wallet exists
  let wallet = await prismaApp.wallet.findUnique({ where: { userId: testUserId } });
  if (!wallet) {
    wallet = await prismaApp.wallet.create({
      data: {
        userId: testUserId,
        balance: 0,
      }
    });
    console.log('Created test wallet');
  } else {
    console.log('Test wallet already exists');
  }

  console.log('\n--- Testing Initiate Topup ---');
  
  // Fake JWT: header.payload.signature
  const fakePayload = Buffer.from(JSON.stringify({ sub: testUserId })).toString('base64url');
  const fakeToken = `header.${fakePayload}.signature`;

  // 1. Initiate Topup (requires auth)
  let transactionId = '';
  const initiateRes = await app.request('/v1/wallet/topup/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${fakeToken}`
    },
    body: JSON.stringify({
      amount: 50000,
      paymentMethod: 'VIRTUAL_ACCOUNT_BCA'
    })
  });
  
  const initiateBody = await initiateRes.json();
  console.log('Initiate Status:', initiateRes.status);
  console.log('Initiate Body:', JSON.stringify(initiateBody, null, 2));
  
  if (initiateRes.status === 201) {
    transactionId = initiateBody.data.transactionId;
  } else {
    console.log('Failed to initiate topup, aborting test.');
    return;
  }

  console.log('\n--- Testing Confirm Topup ---');
  
  // 2. Confirm Topup (requires internal auth)
  // Check what the internal secret is in .env
  const internalSecret = "dummy-internal-secret-key-at-least-32-chars"; // from .env
  
  const confirmRes = await app.request('/v1/wallet/topup/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret
    },
    body: JSON.stringify({
      referenceId: "ext-ref-999",
      transactionId: transactionId
    })
  });
  
  console.log('Confirm Status:', confirmRes.status);
  console.log('Confirm Body:', await confirmRes.json());
}

runTests().catch(console.error);
