const nodemailer = require("nodemailer");

nodemailer.createTestAccount((err, account) => {
  if (err) return console.error("❌ Failed to create test account:", err);

  console.log("✅ Test Ethereal account created:");
  console.log("Email:", account.user);
  console.log("Password:", account.pass);
});
