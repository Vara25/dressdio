// import pinataSDK from '@pinata/sdk';
const pinataSDK = require('@pinata/sdk');

const pinata = new pinataSDK({
  pinataApiKey: '557ee1d4a3a71c6d9c31',
  pinataSecretApiKey: '4012f693cd0efe7a797ae7b09b39f4a7176597f68f72b589e275da1ff544dc57'
});

async function testPinata() {
  try {
    const res = await pinata.testAuthentication();
    console.log('✅ Pinata connected:', res);
  } catch (err) {
    console.error('❌ Pinata error:', err);
  }
}

testPinata();
