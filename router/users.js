const express = require("express")
const multer = require("multer");
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth")
const { cloudinary, deleteFileFromCloudinary } = require("../config/cloudinary")
const { getRandomId, cleanObjectValues, } = require("../config/global")

const sendMail = require("../utils/sendMail");

const storage = multer.memoryStorage()
const upload = multer({ storage })

const router = express.Router()

const { APP_URL } = process.env

router.post("/add", verifyToken, upload.single("image"), async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Permission denied" });

        let { firstName, lastName, fullName, email, phone, gender, perHour, expireFrom, expireTo, companyId } = req.body;

        const existUser = Users.findOne({ email }).lean()
        if (existUser) return res.status(401).json({ message: "This is Email already used.", isError: true })

        let photoURL = "", photoPublicId = "";
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'GuardHouse/users' },
                    (error, result) => {
                        if (error) { return reject(error); }
                        photoURL = result.secure_url; photoPublicId = result.public_id;
                        resolve();
                    }
                )
                uploadStream.end(req.file.buffer);
            });
        }

        const newUserUID = getRandomId();
        const token = getRandomId();

        const newUser = new Users({ firstName, lastName, companyId, verifyToken: token, fullName, email, phone, gender, uid: newUserUID, password: null, photoURL, createdBy: uid, perHour, expireFrom, expireTo, photoPublicId });

        await newUser.save();

        const verifyUrl = `${APP_URL}/auth/set-password?token=${token}&email=${email}`;
        const bodyHtml = `<p>Hello ${fullName},</p>
                         <p>Please click the link below to set your password:</p>
                         <a href="${verifyUrl}" style="color: blue; text-decoration: underline;">Set Password</a>`

        await sendMail(email, "Set admin profile password for Guard House", bodyHtml);

        res.status(201).json({ message: "Guard added successfully, Verification email sent.", guard: newUser });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", error });
    }
});

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = Users.findOne({ uid }).lean()
        if (!user) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        let { status = "", perPage = 10, pageNo = 1, name, phone, email } = cleanObjectValues(req.query);

        perPage = Number(perPage);
        pageNo = Number(pageNo);
        const skip = (pageNo - 1) * perPage;

        // Build match filter
        const match = { roles: { $in: ["guard"] } };
        if (status) match.status = status;
        if (user.companyId) match.companyId = user.companyId
        if (name) { match.fullName = { $regex: new RegExp(name.trim(), "i") }; }
        if (phone) { match.phone = { $regex: new RegExp(phone.trim(), "i") }; }
        if (email) { match.email = { $regex: new RegExp(email.trim(), "i") }; }


        const result = await Users.aggregate([
            { $match: match },
            {
                $facet: {
                    data: [
                        { $sort: { createdAt: -1 } },
                        { $skip: skip },
                        { $limit: perPage },
                        { $project: { password: 0 } },
                    ],
                    totalDoc: [{ $count: "total" }],
                },
            },
        ]);

        // Aggregation for counts
        const counts = await Users.aggregate([
            { $match: { roles: { $in: ["guard"], companyId: user.companyId } } },
            {
                $group: {
                    _id: null,
                    active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
                    inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
                },
            },
        ]);

        const guards = result[0].data;
        const countResult = counts[0] || { active: 0, inactive: 0 };
        const total = result[0]?.totalDoc?.[0]?.total || 0;

        res.status(200).json({ message: "Guards fetched successfully", isError: false, guards, total, count: countResult, });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the guards", isError: true, error: error, });
    }
});


router.patch("/update/:id", verifyToken, upload.single("image"), async (req, res) => {
    try {

        const { id } = req.params
        let formData = req.body

        const user = await Users.findOne({ uid: id });
        if (!user) { return res.status(404).json({ message: "Guard not found" }) }

        let { photoURL = "", photoPublicId = "" } = user
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'GuardHouse/users' }, // Optional: specify a folder in Cloudinary
                    (error, result) => {
                        if (error) { return reject(error); }
                        photoURL = result.secure_url; photoPublicId = result.public_id;
                        resolve();
                    }
                )
                uploadStream.end(req.file.buffer);
            });
        }

        const newData = { ...formData, photoURL, photoPublicId }

        const updatedUser = await Users.findOneAndUpdate({ uid: id }, newData, { new: true })
        if (!updatedUser) { return res.status(404).json({ message: "Guard didn't update" }) }


        res.status(200).json({ message: "A guard has been successfully updated", isError: false, guard: updatedUser })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while updating the new user", isError: true, error })
    }
})

router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        const guard = await Users.findOne({ uid: id })

        res.status(200).json({ guard })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.patch("/update-status/:userId", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status } = req.body

        const { userId } = req.params;

        await Users.findOneAndUpdate(
            { uid: userId },
            { $set: { status: status } },
            { new: true }
        );

        res.status(200).json({ message: `Guard ${status === "active" ? "restore" : "deleted"} successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while updating the Guard status", isError: true, error });
    }
});

router.delete("/single/:userId", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { userId } = req.params;

        const user = await Users.findOne({ uid: userId });
        const deletedGuard = await Users.findOneAndDelete({ uid: userId });
        if (user.photoPublicId) { await deleteFileFromCloudinary(user.photoPublicId) }

        if (!deletedGuard) { return res.status(404).json({ message: "guard not found", isError: true }); }

        res.status(200).json({ message: `Guard deleted successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while deleting the guard", isError: true, error });
    }
});

router.patch("/profile-update", verifyToken, upload.single("image"), async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid });
        if (!user) return res.status(404).json({ isError: true, message: "User not found" });

        let { photoURL = "", photosPublicId = "" } = user
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'GuardHouse/users' }, // Optional: specify a folder in Cloudinary
                    (error, result) => {
                        if (error) { return reject(error); }
                        photoURL = result.secure_url; photoPublicId = result.public_id;
                        resolve();
                    }
                )
                uploadStream.end(req.file.buffer);
            });
        }


        // ---- Prepare Updated Fields
        const updatedData = { ...req.body, photoURL, photoPublicId, updatedAt: new Date() };

        const updatedUser = await Users.findOneAndUpdate({ uid }, updatedData, { new: true });

        res.status(200).json({ message: "Profile updated successfully", isError: false, user: updatedUser });
    } catch (error) {
        console.error(error);
        res.status(500).json({ isError: true, message: "Profile update failed", error });
    }
});


module.exports = router