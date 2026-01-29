const express = require("express")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const Users = require("../models/auth")
const Companies = require("../models/companies")
const { verifyToken, verifySuperAdmin } = require("../middlewares/auth")
const { getRandomId } = require("../config/global")
const sendMail = require("../utils/sendMail")
const dayjs = require("dayjs")

const router = express.Router()

const { JWT_SECRET_KEY } = process.env

router.post("/register", async (req, res) => {
    try {

        // const { uid } = req;
        // if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }) }

        const { firstName, lastName, fullName, email, password } = req.body

        const user = await Users.findOne({ email })
        if (user) { return res.status(401).json({ message: "This email is already in use", isError: true }) }

        const hashedPassword = await bcrypt.hash(password, 10)
        const userId = getRandomId()

        const newUserData = { firstName, lastName, fullName, email, password: hashedPassword, uid: userId, createdBy: userId, }

        const newUser = new Users(newUserData)
        await newUser.save()

        res.status(201).json({ message: "User registered successfully", isError: false, user: newUser })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.post("/login", async (req, res) => {
    try {

        const { email, password, } = req.body

        const user = await Users.findOne({ email })
        if (!user) { return res.status(404).json({ message: "User not found" }) }
        if (user && user.status === "inactive") { return res.status(400).json({ message: "Your account has been deactivated by the Super Admin." }) }

        const match = await bcrypt.compare(password, user.password)

        if (match) {
            const { uid, roles, standardRate } = user
            const token = jwt.sign({ uid, roles, standardRate }, JWT_SECRET_KEY, { expiresIn: "1d" })
            res.status(200).json({ message: "User loggedIn successfully", isError: false, token })
        } else {
            return res.status(404).json({ message: "Password is incorrect" })
        }

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.get("/all-users", verifySuperAdmin, async (req, res) => {
    try {

        const users = await Users.find({ roles: { $in: ["guard"] } }).select("-password").exec()
        res.status(200).json({ users })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.get("/user", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.aggregate([
            { $match: { uid } },
            { $project: { password: 0 } },
            {
                $lookup: {
                    from: "companies",
                    localField: "companyId",
                    foreignField: "id",
                    as: "company"
                }
            },
            { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
        ]);

        if (!user.length) { return res.status(404).json({ message: "User not found" }); }

        res.status(200).json({ user: user[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error });
    }
});


router.patch("/update", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const newData = req.body

        const user = await Users.findOne({ uid })
        if (!user) { return res.status(404).json({ message: "User not found" }) }

        const updatedUser = await Users.findOneAndUpdate({ uid }, newData, { new: true })

        res.status(200).json({ message: "User updated successfully", isError: false, user: updatedUser })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.patch("/change-password", verifyToken, async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword) { return res.status(400).json({ message: "Please enter all fields", isError: true }); }

        const { uid } = req

        const user = await Users.findOne({ uid }).select("password").exec()
        if (!user) { return res.status(404).json({ message: "User not found", isError: true }) }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await Users.updateOne({ uid }, { password: hashedPassword });

        return res.status(200).json({ message: "Your password has been successfully changed.", isError: false });

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})


router.patch("/user-change-password", verifyToken, async (req, res) => {
    try {
        const { newPassword, uid } = req.body;

        if (!uid || !newPassword) { return res.status(400).json({ message: "Please enter all fields", isError: true }); }

        const user = await Users.findOne({ uid }).select("password").exec()
        if (!user) { return res.status(404).json({ message: "User not found", isError: true }) }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await Users.updateOne({ uid }, { password: hashedPassword });

        return res.status(200).json({ message: "User password has been successfully changed.", isError: false });

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.post("/set-password", async (req, res) => {
    try {
        const { token, email, password } = req.body;

        const user = await Users.findOne({ email, verifyToken: token });

        if (!user) { return res.status(400).json({ message: "Invalid or expired link", isError: true }); }

        const hashedPassword = await bcrypt.hash(password, 10);

        await Users.findOneAndUpdate(
            { email, verifyToken: token },
            {
                password: hashedPassword,
                isEmailVerify: true,
                verifyToken: ""
            },
            { new: true, runValidators: false }
        );

        if (user.companyId && user.roles[0] === "admin") {
            await Companies.findOneAndUpdate(
                { id: user.companyId },
                { status: "active" },
                { new: true }
            );
        }

        res.status(200).json({ message: "Password set successfully", isError: false });

    } catch (error) {
        console.error("Set Password Error:", error);
        res.status(500).json({ message: "Server error", isError: true });
    }
});

router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        const user = await Users.findOne({ email });

        if (!user) return res.status(404).json({ message: "User not found" });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const otpExpiresAt = new Date(Date.now() + 1 * 60 * 1000); // 1 minutes

        await Users.findOneAndUpdate(
            { email },
            { otp, otpExpires: otpExpiresAt },
            { new: true }
        );
        const pathUrl = `/auth/otp-verify?email=${email}`;

        const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Password Reset OTP</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f8; font-family:Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">

          <tr>
            <td style="background-color:#BF0603; padding:20px; text-align:center;">
              <h2 style="margin:0; color:#ffffff; font-size:22px;">
                Password Reset Request
              </h2>
            </td>
          </tr>

          <tr>
            <td style="padding:30px;">
              <p style="font-size:16px; color:#333333; margin:0 0 10px;">
                Hello,
              </p>

              <p style="font-size:15px; color:#555555; line-height:1.6; margin:0 0 20px;">
                We received a request to reset your account password.
                Please use the OTP below to continue.
              </p>

              <div style="
                text-align:center;
                font-size:28px;
                letter-spacing:6px;
                font-weight:bold;
                color:#BF0603;
                background-color:#fdecec;
                padding:15px;
                border-radius:6px;
                margin:20px 0;
              ">
                ${otp}
              </div>

              <p style="font-size:14px; color:#555555;">
                This OTP is valid for <strong>1 minute</strong>.
              </p>

              <p style="font-size:14px; color:#777777; line-height:1.6;">
                If you did not request a password reset, please ignore this email.
              </p>

               <p style="font-size:14px; color:#555555; margin:25px 0 0;">
                Regards,<br />
                <strong>Security Matrix AI Team</strong>
              </p>
            </td>
          </tr>

           <tr>
            <td style="background-color:#f1f3f5; padding:15px; text-align:center;">
              <p style="font-size:12px; color:#999999; margin:0;">
                © ${dayjs().toDate().getFullYear()} Security Matrix AI. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

        await sendMail(
            email,
            "Password Reset OTP",
            bodyHtml
        );

        res.status(200).json({ message: "OTP sent successfully", url: pathUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", error });
    }
});

router.post("/verify-otp", async (req, res) => {
    try {
        const formData = req.body;
        const { email, otp } = formData

        const user = await Users.findOne({ email });

        if (!user || !user.otp) return res.status(404).json({ message: "OTP not found or user invalid" });
        if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });

        if (new Date() > new Date(user.otpExpires)) return res.status(400).json({ message: "OTP has expired" });

        let token;
        try {
            token = jwt.sign({ email }, JWT_SECRET_KEY, { expiresIn: "5m" });
        } catch (err) { return res.status(401).json({ message: "Your session has expired. Please try verifying OTP again.", error: err.message }); }

        await Users.findOneAndUpdate(
            { email },
            { otp: null, otpExpires: null },
            { new: true }
        );

        const pathUrl = `/auth/change-password?token=${token}`

        res.status(200).json({ message: "OTP verified", pathUrl, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", error });
    }
});

router.post("/reset-password", async (req, res) => {
    try {
        const formData = req.body;

        const { newPassword, token } = formData

        if (!token) return res.status(400).json({ message: "Token required" });

        const decoded = jwt.verify(token, JWT_SECRET_KEY);
        const user = await Users.findOne({ email: decoded.email });

        const uid = user.uid

        if (!user) return res.status(404).json({ message: "User not found" });

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await Users.findOneAndUpdate(
            { uid },
            { password: hashedPassword },
            { new: true }
        );

        res.status(200).json({ message: "Password reset successfully", pathUrl: "/login" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", error });
    }
});


module.exports = router