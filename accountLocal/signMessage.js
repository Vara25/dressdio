const { ethers } = require("ethers");
const fetch = require("node-fetch"); // for HTTP POST
// const { wallet } = require("../accountLocal/walletDetails"); // Import the provider from walletDetails.js

// ✅ Step 1: Connect to your Hyperledger RPC
// Your Hyperledger EVM-compatible RPC endpoint
const provider = new ethers.JsonRpcProvider("http://3.38.125.193:8545"); // or your actual RPC // Or Besu RPC URL

// ✅ Step 2: Your test wallet (Dev only — never expose real private keys)
const privateKey = "2492a39796be70f94bf62d4a0a9eb05a7ba1d948daff1aa55e29803f1dc94f1e"; // ONLY for dev
const wallet = new ethers.Wallet(privateKey, provider);

// ✅ Step 3: Use the nonce from your backend
const nonce = "183314"; // Replace with actual nonce you got from /account/nonce/:walletAddress

async function signAndSend() {
  try {
    const signature = await wallet.signMessage(nonce);
    console.log("📌 Signature:", signature);

    const response = await fetch("http://localhost:5000/api/sign/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: wallet.address,
        signature,
      }),  
    });

    // console.log(response);
    const result = await response.json();
    console.log("✅ API Response:", result);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

signAndSend();
