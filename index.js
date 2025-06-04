require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");
// const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");   
const jwt = require("jsonwebtoken");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage });
const { sendVerificationCode } = require("./mail/mailer");
const { saveCode } = require("./verifyCode/codeStore");
const { getCode, removeCode } = require("./verifyCode/codeStore");

const { ethers } = require("ethers");
const { ObjectId } = require('mongodb');



dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB URI from .env
const mongoURI = process.env.MONGO_URI;

const client = new MongoClient(mongoURI, {
  serverApi: ServerApiVersion.v1,
});

// CORS Configuration
const corsOptions = {
  origin: ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
// app.use(bodyParser.json());
const JWT_SECRET = process.env.JWT_SECRET;


// Connect to MongoDB once
client.connect().then(() => {
  console.log("MongoDB connected");
  const db = client.db("Dressdio_DB");
  const usersCollection = db.collection("Accounts");

  // POST /api/auth/register
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, name, walletAddress, role } = req.body;

    if (!email || !password || !name || !walletAddress || !role) {
      return res.status(400).json({ message: "Missing fields" });
    }

    try {
      const existing = await usersCollection.findOne({ email, walletAddress });
      if (existing) {
        return res.status(409).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const code = Math.floor(100000 + Math.random() * 900000).toString();

        await sendVerificationCode(email, code);
        saveCode(email, code);

        await usersCollection.insertOne({
        email,
        password: hashedPassword,
        name,
        walletAddress,
        role: role.toUpperCase(),
        sbtId: null,
        isVerified: false,
        createdAt: new Date(),
        });


      const token = jwt.sign({ id: result.insertedId }, JWT_SECRET);

      res.status(201).json({
        userId: result.insertedId,
        walletAddress,
        token,
      });
    } catch (err) {
      console.error("Registration error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });


    app.post("/api/auth/verify-code", async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.status(400).json({ message: "Missing email or code" });
    }

    const expected = getCode(email);
    if (!expected || expected.code !== code) {
        return res.status(401).json({ message: "Invalid or expired code" });
    }

    const db = client.db("Dressdio_DB");
    const users = db.collection("Accounts");

    await users.updateOne({ email }, { $set: { isVerified: true } });
    removeCode(email);

    res.json({ message: "Email verified successfully" });
    });

    app.post("/api/auth/resend-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required" });

  const db = client.db("Dressdio_DB");
  const users = db.collection("Accounts");

  const user = await users.findOne({ email });
  if (!user || user.isVerified) {
    return res.status(400).json({ message: "No unverified user found" });
  }

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  saveCode(email, newCode);
  await sendVerificationCode(email, newCode);

  res.json({ message: "Verification code resent" });
});



  // ✅ Login
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "User not Registered." });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: "Email not verified" });
    }

    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET);

    res.json({
      token,
      userId: user._id,
      role: user.role || null,
      walletAddress: user.walletAddress,
    });
  });


  app.get("/api/nonce/:walletAddress", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const nonces = db.collection("walletNonces");

  const walletAddress = req.params.walletAddress.toLowerCase();

  // generate a 6-digit nonce
  const nonce = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // upsert the nonce for the wallet
    await nonces.updateOne(
      { walletAddress },
      {
        $set: {
          nonce,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ walletAddress, nonce });
  } catch (err) {
    console.error("Nonce error:", err);
    res.status(500).json({ message: "Failed to generate nonce" });
  }
});


app.post("/api/sign/message", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const nonces = db.collection("walletNonces");

  const { walletAddress, signature } = req.body;

  if (!walletAddress || !signature) {
    return res.status(400).json({ message: "Missing walletAddress or signature" });
  }

  try {
    // 1. Get nonce for this wallet
    const walletEntry = await nonces.findOne({ walletAddress: walletAddress.toLowerCase() });

    if (!walletEntry || !walletEntry.nonce) {
      return res.status(404).json({ message: "Nonce not found or expired" });
    }

    const nonce = walletEntry.nonce;

    // 2. Reconstruct the message and verify signer
    const recoveredAddress = ethers.verifyMessage(nonce, signature);

    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({ message: "Signature invalid" });
    }

    // 3. Optionally: delete nonce (one-time use)
    await nonces.deleteOne({ walletAddress: walletAddress.toLowerCase() });

    // 4. Optional: Log or create user session/token here
    // For now, just respond success
    res.json({
      message: "Wallet verified",
      walletAddress: recoveredAddress,
    });
  } catch (err) {
    console.error("Signature verification error:", err);
    res.status(500).json({ message: "Server error" });
  }
});





  function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}


  // API to request a role(un-tested)
  const { ObjectId } = require("mongodb");

app.post("/roles/request", authenticate, async (req, res) => {
  const { role } = req.body;
  const allowedRoles = ["ARTIST", "DESIGNER", "INFLUENCER"];

  if (!role || !allowedRoles.includes(role.toUpperCase())) {
    return res.status(400).json({ message: "Invalid role requested" });
  }

  const db = client.db("vNFTy_Metadata");
  const users = db.collection("users");

  const updated = await users.updateOne(
    { _id: new ObjectId(req.user.id) },
    {
      $set: {
        roleRequest: role.toUpperCase(),
        roleStatus: "PENDING",
      },
    }
  );

  if (updated.modifiedCount === 1) {
    res.json({ message: "Role request submitted" });
  } else {
    res.status(500).json({ message: "Could not submit role request" });
  }
});

//API get to approve a role request(un-tested)
app.get("/admin/roles/requests", authenticate, async (req, res) => {
  const db = client.db("vNFTy_Metadata");
  const users = db.collection("users");

  const admin = await users.findOne({ _id: new ObjectId(req.user.id) });
  if (admin.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

  const requests = await users
    .find({ roleStatus: "PENDING" })
    .project({ email: 1, name: 1, roleRequest: 1 })
    .toArray();

  res.json({ requests });
});

//API to approve or reject a role request(un-tested)
app.post("/admin/roles", authenticate, async (req, res) => {
  const { userId, decision } = req.body; // decision: "APPROVE" or "REJECT"

  const db = client.db("vNFTy_Metadata");
  const users = db.collection("users");

  const admin = await users.findOne({ _id: new ObjectId(req.user.id) });
  if (admin.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

  if (!["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ message: "Invalid decision" });
  }

  const user = await users.findOne({ _id: new ObjectId(userId) });
  if (!user) return res.status(404).json({ message: "User not found" });

  const updates =
    decision === "APPROVE"
      ? {
          role: user.roleRequest,
          roleStatus: "APPROVED",
          roleRequest: null,
        }
      : {
          roleStatus: "REJECTED",
        };

  await users.updateOne({ _id: new ObjectId(userId) }, { $set: updates });

  res.json({ message: `User role ${decision.toLowerCase()}d` });
});

//API to mint ipNFTs(Tested)
// const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/ipnft/mint", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const ipnfts = db.collection("ipNFTs");

  const { userId, name, description, price, priceSupplied } = req.body;
  // const imageFile = req.file;

  if (!userId || !name || !description || !price || !priceSupplied) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Simulate IPFS upload (replace with real call)
    // const ipfsURI = `ipfs://bafy${Math.random().toString(36).substring(2, 8)}/${imageFile.originalname}`;

    const result = await ipnfts.insertOne({
      creatorId: new ObjectId(userId),
      name,
      description,
      // ipfsURI,
      price: parseFloat(price),
      priceSupplied: parseFloat(priceSupplied),
      createdAt: new Date(),
      transactionHash: `0x${Math.random().toString(16).substring(2, 66)}`
    });

    res.status(201).json({
      ipnftId: result.insertedId,
      // ipfsURI,
      transactionHash: result.transactionHash,
      metadata: {
        name,
        creator: userId
      }
    });
  } catch (err) {
    console.error("IPNFT Mint Error:", err);
    res.status(500).json({ message: "Failed to mint IPNFT" });
  }
});


//API to get all IP NFTs(un-tested, ambiguous)
app.get("/api/ipnft/list", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const ipnfts = db.collection("ipNFTs");

  const { userId } = req.query;

  const query = {};

  if (userId) {
    if (ObjectId.isValid(userId)) {
      query.creatorId = new ObjectId(userId);
    } else {
      return res.status(400).json({ message: "Invalid userId format" });
    }
  }

  try {
    const nfts = await ipnfts.find(query).toArray();

    const formatted = nfts.map((nft) => ({
      ipnftId: nft._id,
      name: nft.name,
      ipfsURI: nft.ipfsURI,
      price: nft.price
    }));

    res.json(formatted);
  } catch (err) {
    console.error("❌ IPNFT List Error:", err);
    res.status(500).json({ message: "Failed to fetch IPNFTs" });
  }
});

//API to get a specific IP NFT by ID(un-tested, ambiguous)
app.get("/api/ipnft/:ipnftId", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const ipnfts = db.collection("ipNFTs");
  const sbts = db.collection("sbts");

  const { ipnftId } = req.params;

  if (!ObjectId.isValid(ipnftId)) {
    return res.status(400).json({ message: "Invalid IPNFT ID format" });
  }

  try {
    const nft = await ipnfts.findOne({ _id: new ObjectId(ipnftId) });
    if (!nft) {
      return res.status(404).json({ message: "IPNFT not found" });
    }

    const creatorSBT = await sbts.findOne({ userId: nft.creatorId });

    res.json({
      name: nft.name,
      description: nft.description,
      imageURI: nft.ipfsURI,
      creatorSBT: {
        sbtId: creatorSBT?._id,
        creatorType: creatorSBT?.creatorType,
        creatorName: creatorSBT?.creatorName || "Unknown"
      },
      usageCount: nft.usageCount || 0,
      royaltySplits: {
        creator: 70,
        influencer: 20,
        platform: 10
      },
      mintedAt: nft.createdAt
    });
  } catch (err) {
    console.error("IPNFT Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch IPNFT metadata" });
  }
});

//API to apply to Creator role(tested - optinal) 
app.post("/api/creator/apply", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const applications = db.collection("creatorApplications");
  const users = db.collection("Accounts");

  const { userId, creatorType, portfolioLink, applicationMessage } = req.body;

  if (!userId || !creatorType || !portfolioLink || !applicationMessage) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid userId format" });
  }

  try {
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const result = await applications.insertOne({
      userId: new ObjectId(userId),
      creatorType: creatorType.toUpperCase(),
      portfolioLink,
      applicationMessage,
      status: "PENDING",
      submittedAt: new Date()
    });

    res.status(201).json({
      message: "Application submitted successfully",
      applicationId: result.insertedId
    });
  } catch (err) {
    console.error("❌ Creator Application Error:", err);
    res.status(500).json({ message: "Failed to submit application" });
  }
});


//API to create a NFT project(tested)
app.post("/api/project/create", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const projects = db.collection("projects");
  const ipnfts = db.collection("ipNFTs");

  const { influencerId, name, description, ipnftIds, maxSupply } = req.body;

  if (!influencerId || !name || !description || !Array.isArray(ipnftIds) || maxSupply === undefined) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!ObjectId.isValid(influencerId)) {
    return res.status(400).json({ message: "Invalid influencerId format" });
  }

  try {
    // Validate IPNFT IDs
    const ipnftObjectIds = ipnftIds.map(id => new ObjectId(id));
    const ipnftDocs = await ipnfts.find({ _id: { $in: ipnftObjectIds } }).toArray();

    if (ipnftDocs.length !== ipnftIds.length) {
      return res.status(400).json({ message: "One or more IPNFT IDs are invalid" });
    }

    // Create the project
    const result = await projects.insertOne({
      influencerId: new ObjectId(influencerId),
      name,
      description,
      ipnftIds: ipnftObjectIds,
      maxSupply: parseInt(maxSupply),
      status: "PENDING_APPROVAL",
      createdAt: new Date()
    });

    res.status(201).json({
      projectId: result.insertedId,
      status: "PENDING_APPROVAL"
    });
  } catch (err) {
    console.error("❌ Project Create Error:", err);
    res.status(500).json({ message: "Failed to create project" });
  }
});

//API to Approve or reject a project application(tested)

app.post("/api/project/approve", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const projects = db.collection("projects");

  const { projectId, influencerId, decision, signature } = req.body;

  if (!projectId || !influencerId || !decision || !signature) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ message: "Invalid decision" });
  }

  if (!ObjectId.isValid(projectId) || !ObjectId.isValid(influencerId)) {
    return res.status(400).json({ message: "Invalid projectId or influencerId format" });
  }

  try {
    const project = await projects.findOne({
      _id: new ObjectId(projectId),
      influencerId: new ObjectId(influencerId)
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found or unauthorized" });
    }

    const newStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

    await projects.updateOne(
      { _id: new ObjectId(projectId) },
      {
        $set: {
          status: newStatus,
          approvedBy: new ObjectId(influencerId),
          approvalSignature: signature,
          updatedAt: new Date()
        }
      }
    );

    res.json({
      approvalStatus: newStatus,
      approvedBy: influencerId
    });
  } catch (err) {
    console.error("❌ Project Approval Error:", err);
    res.status(500).json({ message: "Failed to update project status" });
  }
});

//API to get project by ID(tested)
app.get("/api/project/:projectId", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const projects = db.collection("projects");

  const { projectId } = req.params;

  if (!ObjectId.isValid(projectId)) {
    return res.status(400).json({ message: "Invalid projectId format" });
  }

  try {
    const project = await projects.findOne({ _id: new ObjectId(projectId) });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({
      projectId: project._id,
      name: project.name,
      description: project.description,
      influencerId: project.influencerId,
      ipnftIds: project.ipnftIds,
      maxSupply: project.maxSupply,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt || null
    });
  } catch (err) {
    console.error("❌ Project Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch project" });
  }
});

//API to mint a Merch NFT(tested, ambiguous)
app.post("/api/merchnft/mint", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const projects = db.collection("projects");
  const merchNFTs = db.collection("merchNFTs");

  const { projectId, buyerId, paymentTxHash } = req.body;

  if (!projectId || !buyerId || !paymentTxHash) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!ObjectId.isValid(projectId) || !ObjectId.isValid(buyerId)) {
    return res.status(400).json({ message: "Invalid projectId or buyerId format" });
  }

  try {
    const project = await projects.findOne({ _id: new ObjectId(projectId) });

    if (!project) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    if (project.status !== "APPROVED") {
      return res.status(403).json({ message: "Buyer not authorized or Project not approved" });
    }

    // Check sold-out condition
    const mintedCount = await merchNFTs.countDocuments({ projectId: new ObjectId(projectId) });
    if (mintedCount >= project.maxSupply) {
      return res.status(409).json({ message: "Project sold out" });
    }

    // (Optional) Check buyer eligibility here if needed
    // For now we assume any buyerId is authorized

    // Simulate IPFS metadata upload (replace with actual IPFS call)
    const ipfsURI = `ipfs://bafy${Math.random().toString(36).substring(2, 8)}/merch-nft.json`;

    // Simulate blockchain mint transaction hash
    const blockchainTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // Save NFT record
    const result = await merchNFTs.insertOne({
      projectId: new ObjectId(projectId),
      buyerId: new ObjectId(buyerId),
      paymentTxHash,
      ipfsURI,
      transactionHash: blockchainTxHash,
      mintedAt: new Date()
    });

    res.status(201).json({
      nftId: result.insertedId,
      ipfsURI,
      transactionHash: blockchainTxHash
    });
  } catch (err) {
    console.error("❌ Merch NFT Mint Error:", err);
    res.status(500).json({ message: "Failed to mint merch NFT" });
  }
});












//API to issue a Soulbound Token (SBT) to a user(un-tested)
app.post("/api/sbt/issue", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const users = db.collection("Accounts");
  const sbts = db.collection("SBTs");

  const { email, creatorType, tokenURI, description } = req.body;

  if (!email || !creatorType || !tokenURI || !description) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // ✅ Find user by email
    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Simulate a transaction hash
    const transactionHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // ✅ Create SBT record
    const sbtResult = await sbts.insertOne({
      userId: user._id,
      creatorType: creatorType.toUpperCase(),
      tokenURI,
      description,
      usageCount: 0,
      transactionHash,
      issuedAt: new Date()
    });

    // ✅ Update user's role and link SBT
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          role: creatorType.toUpperCase(),
          sbtId: sbtResult.insertedId
        }
      }
    );

    res.status(200).json({
      sbtId: sbtResult.insertedId,
      transactionHash
    });
  } catch (err) {
    console.error("❌ SBT Issue Error:", err);
    res.status(500).json({ message: "Server error issuing SBT" });
  }
});


app.get("/api/collection/getReviewApplications", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const collections = db.collection("collections");

  try {
    const pending = await collections
      .find({ status: { $in: ["PENDING", "REVIEW"] } })
      .toArray();

    res.json(pending);
  } catch (err) {
    console.error("❌ Error fetching review collections:", err);
    res.status(500).json({ message: "Failed to fetch collections" });
  }
});

// API to approve or reject a collection application
app.post("/api/collection/reviewApplication", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const collections = db.collection("collections");

  const { collectionId, decision } = req.body;

  if (!collectionId || !["APPROVED", "REJECTED"].includes(decision)) {
    return res.status(400).json({ message: "Missing or invalid fields" });
  }

  try {
    await collections.updateOne(
      { _id: new ObjectId(collectionId) },
      {
        $set: {
          status: decision,
          reviewedAt: new Date(),
        },
      }
    );

    res.json({ message: `Collection ${decision.toLowerCase()} successfully.` });
  } catch (err) {
    console.error("❌ Error updating collection:", err);
    res.status(500).json({ message: "Failed to update collection status" });
  }
});

//API to create a collection
app.post("/api/collection/createCollection", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const collections = db.collection("collections");

  const {
    walletAddress,
    collectionName,
    collectionDescription,
    category,
    royalty,
    collectionImage
  } = req.body;

  if (
    !walletAddress || !collectionName || !collectionDescription ||
    !category || royalty === undefined || !collectionImage
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Optional: Check if collection name already exists for the wallet
    const duplicate = await collections.findOne({
      walletAddress: walletAddress.toLowerCase(),
      collectionName
    });

    if (duplicate) {
      return res.status(409).json({ message: "Collection already exists" });
    }

    const result = await collections.insertOne({
      walletAddress: walletAddress.toLowerCase(),
      collectionName,
      collectionDescription,
      category,
      royalty: parseFloat(royalty),
      collectionImage,
      status: "PENDING",
      createdAt: new Date()
    });

    res.status(201).json({
      message: "Collection created successfully",
      collectionId: result.insertedId
    });
  } catch (err) {
    console.error("❌ Error creating collection:", err);
    res.status(500).json({ message: "Failed to create collection" });
  }
});


const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const { uploadToIPFS } = require("./ipfsUpload/upload"); // your IPFS handler

//API to upload image to IPFS server(un-tested)
app.post("/image/uploadImage2Server", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }

    const ipfsURI = await uploadToIPFS(file.buffer, file.originalname);

    res.json({
      message: "Image uploaded successfully",
      ipfsURI
    });
  } catch (err) {
    console.error("Image upload error:", err);
    res.status(500).json({ message: "Image upload failed" });
  }
});

//API to mint a new NFT(un-tested)
app.post("/nft/mint", async (req, res) => {
  const db = client.db("vNFTy_Metadata");
  const nfts = db.collection("nfts");

  const { collectionId, name, description, imageURI, price, walletAddress } = req.body;

  if (!collectionId || !name || !description || !imageURI || price === undefined || !walletAddress) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Save NFT metadata in DB
    const result = await nfts.insertOne({
      collectionId: new ObjectId(collectionId),
      name,
      description,
      imageURI,
      price: parseFloat(price),
      walletAddress: walletAddress.toLowerCase(),
      createdAt: new Date()
    });

    // Prepare mock transaction data (replace with real contract call preparation)
    const dataToSign = {
      to: "0xCollectionContractAddress", // replace with your actual contract address
      data: "0xabcdef123456...",         // encoded contract call (e.g., mint function)
      value: "0",
      nonce: 1 // optional
    };

    res.json({
      message: "NFT metadata saved",
      dataToSign
    });
  } catch (err) {
    console.error("NFT minting error:", err);
    res.status(500).json({ message: "Failed to mint NFT" });
  }
});

//API to sign a transaction(un-tested)
app.post("/blockchain/sign/transaction", async (req, res) => {
  const { walletAddress, dataToSign } = req.body;

  if (!walletAddress || !dataToSign) {
    return res.status(400).json({ message: "Missing walletAddress or dataToSign" });
  }

  try {
    // Simulate signing step (real signing happens in frontend or wallet)
    const fakeSignature = `0xsignedpayload${Math.random().toString(16).substring(2, 10)}`;

    res.json({
      signature: fakeSignature
    });
  } catch (err) {
    console.error("Transaction signing error:", err);
    res.status(500).json({ message: "Failed to sign transaction" });
  }
});

//API to send a raw transaction to the blockchain(un-tested)
app.post("/blockchain/raw-tx/send", async (req, res) => {
  const { signedTx } = req.body;

  if (!signedTx) {
    return res.status(400).json({ message: "Missing signedTx" });
  }

  try {
    // Simulate sending transaction (replace with real Web3 or ethers.js send)
    const fakeTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    res.json({
      transactionHash: fakeTxHash,
      status: "submitted"
    });
  } catch (err) {
    console.error("Raw tx send error:", err);
    res.status(500).json({ message: "Failed to send transaction" });
  }
});


//API to get approved collections
app.get("/collection/getmintablecollections", async (req, res) => {
  const db = client.db("vNFTy_Metadata");
  const collections = db.collection("collections");

  try {
    const mintableCollections = await collections
      .find({ status: "APPROVED" })
      .toArray();

    res.json(mintableCollections);
  } catch (err) {
    console.error("Error fetching mintable collections:", err);
    res.status(500).json({ message: "Failed to fetch mintable collections" });
  }
});













  app.get("/", (req, res) => {
  res.send("Welcome to the NFT Server!");
});

  client.connect()
  .then(() => {
    app.listen(PORT, () => {
      // console.log(`Server is running on https://live-server:${PORT}`);
      console.log(`Server is running on http://localhost:${PORT}`);
    });

  })
  .catch(error => {
    console.error("Error connecting to MongoDB:", error);
  });
});
