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
const { contractAddress, rpcEndpoint, contractABI, privateKey } = require("./contractDetails/index"); // Adjust the path as needed
const { ethers } = require("ethers");
const { uploadJSONToIPFS, uploadFileToIPFS } = require('./ipfsUpload/upload'); // Adjust the path as needed
const { ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use(express.urlencoded({ extended: true })); // Add this line to parse x-www-form-urlencoded bodies
// app.use(bodyParser.json());
const JWT_SECRET = process.env.JWT_SECRET;


// Connect to MongoDB once
client.connect().then(() => {
  console.log("MongoDB connected");
  const db = client.db("Dressdio_DB");
  const usersCollection = db.collection("Accounts");

  // POST /api/auth/register
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, name, role,
      code, overage, agree, collect, thirdParty, advertise, serviceId } = req.body;

    if (!email || !password || !name || !role || !code || !overage || !agree || !collect || !thirdParty || !advertise || !serviceId) {
      return res.status(400).json({ message: "Missing fields" });
    }

    try {
      const existing = await usersCollection.findOne({ email });
      if (existing) {
        return res.status(409).json({ message: "User already exists" });
      }

      // Call external API to add user
      const params = new URLSearchParams();
      params.append("username", email);
      params.append("password", password);
      params.append("agree", agree);
      params.append("thirdParty", thirdParty);
      params.append("advertise", advertise);
      params.append("serviceid", serviceId);
      params.append("collect", collect);
      params.append("overage", overage);
      params.append("code", code);

      const addUserResponse = await fetch(
        "https://api.waas.myabcwallet.com/member/user-management/users/v2/adduser",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded",
              "secure-channel" : "380f0ebb1e764d8ab04689950b1725c5"
           },
          body: params,
        }
      );

      if (!addUserResponse.ok) {
        const errorText = await addUserResponse.text();
        return res.status(500).json({ message: "Failed to register user in external system", error: errorText });
      }

      // Return walletAddress immediately after successful waas API call
      res.status(200).json({ walletAddress });
      console.log(walletAddress)

      // After responding, update the DB in the background
      (async () => {
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          // const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

          // await sendVerificationCode(email, verificationCode);
          // saveCode(email, verificationCode);

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
        } catch (bgErr) {
          console.error("Background DB update error after waas registration:", bgErr);
        }
      })();

    } catch (err) {
      console.error("Registration error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  //API to verify email code(tested)
    app.post("/api/auth/verify-code", async (req, res) => {
      const { email, code, serviceId } = req.body;

      if (!email || !code || !serviceId) {
        return res.status(400).json({ message: "Missing email or code" });
      }

      try {
        // Call external API to verify code
        // const serviceId = "https://mw.myabcwallet.com"; // Hardcoded service ID
        const params = new URLSearchParams();
        params.append("code", code);
        params.append("serviceId", serviceId);

        const response = await fetch(
          `https://api.waas.myabcwallet.com/member/mail-service/${email}/verifycode`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          }
        );

        if (!response.ok) {
          return res.status(401).json({ message: "Invalid or expired code" });
        }

        const db = client.db("Dressdio_DB");
        const users = db.collection("Accounts");

        await users.updateOne({ email }, { $set: { isVerified: true } });

        res.json({ message: "Email verified successfully" });
      } catch (err) {
        console.error("Verify code error:", err);
        res.status(500).json({ message: "Server error verifying code" });
      }
    });


  //API to send verification code to email(tested)
  app.post("/api/auth/send-code", async (req, res) => {
    const { email } = req.body;
    console.log("Sending code to:", email);

    if (!email) {
      return res.status(400).json({ message: "Missing email" });
    }

    try {
      const response = await fetch(
        `https://api.waas.myabcwallet.com/member/mail-service/${email}/sendcode?lang=en&template=verify`,
        { method: "GET" }
      );
      console.log(email);

      if (!response.ok) {
        return res.status(500).json({ message: "Failed to send verification code" });
      }

      res.json({ message: "Verification code sent successfully" });
    } catch (err) {
      console.error("Send code error:", err);
      res.status(500).json({ message: "Server error sending code" });
    }
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
const { ethers } = require("ethers");

app.post("/roles/request", authenticate, async (req, res) => {
  const { role } = req.body;
  const allowedRoles = ["ARTIST", "DESIGNER", "INFLUENCER"];

  if (!role || !allowedRoles.includes(role.toUpperCase())) {
    return res.status(400).json({ message: "Invalid role requested" });
  }

  const db = client.db("Dressdio_DB");
  const users = db.collection("Accounts");

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

app.post("/api/ipnft/mint", upload.single("imageFile"), async (req, res) => {
  const db = client.db("Dressdio_DB");
  const ipnfts = db.collection("ipNFTs");

  const { userId, name, description, price, priceSupplied } = req.body;
  const imageFile = req.file;

  if (!userId || !name || !description || !imageFile || !price || !priceSupplied) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Upload image to IPFS
    const ipfsURI = await uploadFileToIPFS(imageFile.buffer, imageFile.originalname);

    // Simulate blockchain transaction hash
    const transactionHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    const result = await ipnfts.insertOne({
      creatorId: new ObjectId(userId),
      name,
      description,
      ipfsURI,
      price: parseFloat(price),
      priceSupplied: parseFloat(priceSupplied),
      createdAt: new Date(),
      transactionHash
    });

    res.status(201).json({
      ipnftId: result.insertedId,
      ipfsURI,
      transactionHash,
      metadata: { 
        name
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
    const total = nfts.length;

    const formatted = nfts.map((nft) => ({
      ipnftId: nft._id,
      name: nft.name,
      ipfsURI: nft.ipfsURI,
      price: nft.price
    }));

    res.json({
      nfts: formatted,
      total
    });
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
app.post("/api/merchnft/mint", upload.single("image"), async (req, res) => {
  const db = client.db("Dressdio_DB");
  const projects = db.collection("projects");
  const merchNFTs = db.collection("merchNFTs");

  const { projectId, buyerId, paymentTxHash } = req.body;
  const imageFile = req.file;

  // Multer expects the file field to be named "image" in the form-data.
  if (!projectId || !buyerId || !paymentTxHash || !imageFile) {
    return res.status(400).json({ message: "Missing required fields or image file" });
  }

  if (!ObjectId.isValid(String(projectId)) || !ObjectId.isValid(String(buyerId))) {
    return res.status(400).json({ message: "Invalid projectId or buyerId format" });
  }

  try {
    const project = await projects.findOne({ _id: new ObjectId(String(projectId)) });

    if (!project) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    if (project.status !== "APPROVED") {
      return res.status(403).json({ message: "Project not approved for minting" });
    }

    const mintedCount = await merchNFTs.countDocuments({ projectId: new ObjectId(String(projectId)) });
    if (mintedCount >= project.maxSupply) {
      return res.status(409).json({ message: "Project sold out" });
    }

    // ✅ Upload the image file to IPFS
    const ipfsURI = await uploadFileToIPFS(imageFile.buffer, imageFile.originalname);

    // ✅ Simulate blockchain mint transaction hash
    const blockchainTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // ✅ Save minted NFT record
    const result = await merchNFTs.insertOne({
      projectId: new ObjectId(String(projectId)),
      buyerId: new ObjectId(String(buyerId)),
      paymentTxHash,
      ipfsURI,
      transactionHash: blockchainTxHash,
      mintedAt: new Date()
    });

    res.status(201).json({
      nftId: result.insertedId,
      ipfsURI,
      transactionHash: blockchainTxHash,
            projectDetails: {
        name: project.name,
        // remainingSupply: project.maxSupply; need to clarify if this is needed
      }
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

  const { walletAddress, userId, creatorType, tokenURI, description } = req.body;

  if (!userId || !creatorType || !tokenURI || !description || !walletAddress) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Replace with your contract details
  // Use imported contract details from ./contractDetails/index
  const CONTRACT_ADDRESS = contractAddress; // Already imported
  const CONTRACT_ABI = contractABI; // Already imported
  const RPC_URL = rpcEndpoint;
  const PRIVATE_KEY = privateKey; // Server wallet for issuing
  
  if (!CONTRACT_ADDRESS || !CONTRACT_ABI.length || !RPC_URL || !PRIVATE_KEY) {
    return res.status(500).json({ message: "Contract configuration missing" });
  }

  try {
    // Validate user
    if (!ObjectId.isValid(String(userId))) {
      return res.status(400).json({ message: "Invalid userId format" });
    }
    const user = await users.findOne({ _id: new ObjectId(String(userId)) });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Interact with contract
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    // Example: assume contract has a mintSBT(address to, uint8 role, string creatorType, string tokenURI)
    let tx;
    let role = 1;
    try {
      // No gas estimation needed, blockchain is 0- gas

        tx = await contract.mintSBT(
        walletAddress,
        role,
        creatorType,
        tokenURI,
        { gasLimit: 500000 } // Use a reasonable gas limit
      );
      await tx.wait();
    } catch (err) {
      console.error("❌ Contract interaction error:", err);
      return res.status(500).json({ message: "Failed to issue SBT on-chain" });
    }

    // Save SBT record in DB
    const transactionHash = tx.hash;
    const sbtResult = await sbts.insertOne({
      walletAddress: walletAddress,
      userId: user._id,
      creatorType: creatorType.toUpperCase(),
      tokenURI,
      description,
      usageCount: 0,
      transactionHash,
      issuedAt: new Date()
    });

    // Update user's role and link SBT
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

app.get("/api/sbt/:userId", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const sbts = db.collection("SBTs");

  const { userId } = req.params;

  if (!ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid userId format" });
  }

  try {
    const sbt = await sbts.findOne({ userId: new ObjectId(userId) });

    if (!sbt) {
      return res.status(404).json({ message: "User has no SBT" });
    }

    res.json({
      sbtData: {
        sbtId: sbt._id,
        creatorType: sbt.creatorType,
        usageCount: sbt.usageCount,
        tokenURI: sbt.tokenURI,
        issuedAt: sbt.issuedAt
      }
    });
  } catch (err) {
    console.error("❌ SBT Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch SBT details" });
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
  const db = client.db("Dressdio_DB");
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
app.post("/api/sign/transaction", async (req, res) => {
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

//API to mint poersonal NFTs
app.post("/api/personalnft/mint", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const personalNFTs = db.collection("personalNFTs");
  const ipnfts = db.collection("ipnfts");

  const { buyerId, designIpNftId, artworkIpNftId, paymentTxHash } = req.body;

  if (!buyerId || !designIpNftId || !artworkIpNftId || !paymentTxHash) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (
    !ObjectId.isValid(buyerId) ||
    !ObjectId.isValid(designIpNftId) ||
    !ObjectId.isValid(artworkIpNftId)
  ) {
    return res.status(400).json({ message: "Invalid ID format" });
  }

  try {
    // Validate referenced IPNFTs
    const designNft = await ipnfts.findOne({ _id: new ObjectId(designIpNftId) });
    const artworkNft = await ipnfts.findOne({ _id: new ObjectId(artworkIpNftId) });

    if (!designNft || !artworkNft) {
      return res.status(403).json({ message: "Invalid design or artwork IPNFT permissions" });
    }

    // ✅ Compose metadata for personal NFT
    const metadata = {
      name: `${designNft.name} + ${artworkNft.name} Custom NFT`,
      description: "Personalized NFT composed from selected design and artwork.",
      composedFrom: {
        design: designIpNftId,
        artwork: artworkIpNftId
      },
      buyerId: buyerId,
      timestamp: new Date().toISOString()
    };

    // ✅ Upload metadata to IPFS via Pinata
    const ipfsURI = await uploadFileToIPFS(imageFile.buffer, imageFile.originalname);


    // ✅ Simulate blockchain mint tx hash
    const blockchainTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // ✅ Save personal NFT record
    const result = await personalNFTs.insertOne({
      buyerId: new ObjectId(buyerId),
      designIpNftId: new ObjectId(designIpNftId),
      artworkIpNftId: new ObjectId(artworkIpNftId),
      ipfsURI,
      paymentTxHash,
      transactionHash: blockchainTxHash,
      mintedAt: new Date()
    });

    res.status(201).json({
      nftId: result.insertedId,
      ipfsURI,
      composedFrom: {
        design: designIpNftId,
        artwork: artworkIpNftId
      }
    });
  } catch (err) {
    console.error("❌ Personal NFT Mint Error:", err);
    res.status(500).json({ message: "Failed to mint personal NFT" });
  }
});

//API to upload an image to IPFS and return the URI
app.post('/api/ipfs/upload', upload.single('image'), async (req, res) => {
  const imageFile = req.file;

  if (!imageFile) {
    return res.status(400).json({ message: 'No image file uploaded' });
  }

  try {
    const ipfsURI = await uploadFileToIPFS(imageFile.buffer, imageFile.originalname);
    res.json({
      message: 'Image uploaded successfully',
      ipfsURI
    });
  } catch (err) {
    console.error('❌ Error uploading to IPFS:', err);
    res.status(500).json({ message: 'Failed to upload image to IPFS' });
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
