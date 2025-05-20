const { ethers } = require("ethers");

const privateKey = "2492a39796be70f94bf62d4a0a9eb05a7ba1d948daff1aa55e29803f1dc94f1e"; // ONLY for dev
const wallet = new ethers.Wallet(privateKey, provider);

// Your Hyperledger EVM-compatible RPC endpoint
const provider = new ethers.JsonRpcProvider("http://3.38.125.193:8545"); // or your actual RPC
