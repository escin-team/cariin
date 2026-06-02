import crypto from 'node:crypto';

function generateKeys() {
  console.log('Generating RSA 2048-bit key pair...\n');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki', // standard public key format
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8', // standard private key format
      format: 'pem',
    },
  });

  // Mengubah newline betulan (enter) menjadi literal karakter "\n" 
  // agar bisa ditaruh di dalam satu baris string di file .env
  const envPrivateKey = privateKey.replace(/\r?\n/g, '\\n');
  const envPublicKey = publicKey.replace(/\r?\n/g, '\\n');

  console.log('✅ Kunci berhasil dibuat!\n');
  console.log('👇 COPY PASTE BARIS DI BAWAH INI KE DALAM FILE .env KAMU 👇\n');
  console.log(`JWT_PRIVATE_KEY="${envPrivateKey}"`);
  console.log(`JWT_PUBLIC_KEY="${envPublicKey}"\n`);
  console.log('👆 -------------------------------------------------------- 👆\n');
  console.log('⚠️ CATATAN: Jangan pernah membagikan JWT_PRIVATE_KEY kepada siapa pun!');
}

generateKeys();
