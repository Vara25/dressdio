const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  auth: {
    user: process.env.ETHEREAL_USER,
    pass: process.env.ETHEREAL_PASS,
  },
});

exports.sendVerificationCode = async (email, code) => {
  const info = await transporter.sendMail({
    from: '"Dressdio Verification code" <noreply@myabcwallet.com>',
    to: email,
    subject: "Your Dressdio Verification Code",
    text: `
Please Verify Your Email Address

To continue the process of registring as an ABC Wallet User, please input the code below to verify your email address.

${code}

This verification code is only valid for 60 minutes. If you attempt to verify your email after this time, you will be resubmit your email address for comfirmation.

Best regards,

ABC Wallet Support`,
  });

  console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
  return info;
};
