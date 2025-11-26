const express = require("express")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const Users = require("../models/auth")
const Companies = require("../models/companies")
const { verifyToken, verifySuperAdmin } = require("../middlewares/auth")
const { getRandomId } = require("../config/global")
const sendMail = require("../utils/sendMail")

const router = express.Router()

const { JWT_SECRET_KEY } = process.env

router.post("/register", async (req, res) => {
    try {

        const { firstName, lastName, fullName, email, password } = req.body

        const user = await Users.findOne({ email })
        if (user) { return res.status(401).json({ message: "Email is already in use", isError: true }) }

        const hashedPassword = await bcrypt.hash(password, 10)
        const uid = getRandomId()

        const newUserData = { firstName, lastName, fullName, email, password: hashedPassword, uid, createdBy: uid }

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

        const match = await bcrypt.compare(password, user.password)

        if (match) {

            const { uid } = user

            const token = jwt.sign({ uid }, JWT_SECRET_KEY, { expiresIn: "1d" })

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

        const { uid } = req

        const user = await Users.findOne({ uid }).select("-password").exec()
        if (!user) { return res.status(404).json({ message: "User not found" }) }

        res.status(200).json({ user })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

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
            { new: true, runValidators: false } // IMPORTANT
        );

        if (user.companyId) {
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
            { otp, otpExpiresAt },
            { new: true }
        );
        const pathUrl = `/auth/otp-verify?email=${email}`;

        await sendMail(email, "Password Reset OTP", `Your OTP for password reset is ${otp}. It will expire in 2 minutes.`);

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

        if (new Date() > new Date(user.otpExpiresAt)) return res.status(400).json({ message: "OTP has expired" });

        const token = jwt.sign({ email }, JWT_SECRET_KEY, { expiresIn: "5m" });

        await Users.findOneAndUpdate(
            { email },
            { otp: null, otpExpiresAt: null },
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