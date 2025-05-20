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
      return res.status(401).json({ message: "Invalid credentials" });
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

//API to get all ipNFTs(Tested)
app.post("/api/ipnft/mint", upload.single("imageFile"), async (req, res) => {
  const db = client.db("Dressdio_DB");
  const ipnfts = db.collection("ipNFTs");

  const { userId, name, description, price, influencerShare, ipfsURI, txHash } = req.body;
//   const imageFile = req.file;

  if (!userId || !name || !description || !price || !influencerShare || !ipfsURI || !txHash) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Upload to IPFS (mock or real)
    // const ipfsURI = await uploadToIPFS(imageFile.buffer, imageFile.originalname);

    // const transactionHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    const result = await ipnfts.insertOne({
      creatorId: new ObjectId(userId),
      name,
      description,
      ipfsURI,
      price: parseFloat(price),
      influencerShare: parseFloat(influencerShare),
      txHash,
      createdAt: new Date(),
    });

    res.json({
      ipnftId: result.insertedId,
      ipfsURI,
      txHash,
    });
  } catch (err) {
    console.error("IP NFT mint error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

//API to create a NFT project
app.post("/api/project/create", async (req, res) => {
  const db = client.db("Dressdio_DB");
  const projects = db.collection("projects");
  const ipnfts = db.collection("ipnfts");

  const { influencerId, name, description, ipnftIds, maxSupply } = req.body;

  if (!influencerId || !name || !description || !ipnftIds || !maxSupply) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Convert IP NFT IDs to ObjectIds
    const ipnftObjectIds = ipnftIds.map((id) => new ObjectId(id));

    // Fetch IP NFTs to get their creator IDs
    const ipnftDocs = await ipnfts
      .find({ _id: { $in: ipnftObjectIds } })
      .toArray();

    // Extract unique creator IDs
    const uniqueCreators = [
      ...new Set(ipnftDocs.map((ipnft) => ipnft.creatorId.toString())),
    ].map((id) => new ObjectId(id));

    // Build approvals list
    const approvals = uniqueCreators.map((creatorId) => ({
      creatorId,
      signed: false,
    }));

    const result = await projects.insertOne({
      influencerId: new ObjectId(influencerId),
      name,
      description,
      ipnftIds: ipnftObjectIds,
      approvals,
      maxSupply: parseInt(maxSupply),
      status: "PENDING",
      createdAt: new Date(),
    });

    res.json({
      projectId: result.insertedId,
      status: "PENDING",
    });
  } catch (err) {
    console.error("Project creation error:", err);
    res.status(500).json({ message: "Server error" });
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
