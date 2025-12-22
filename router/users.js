const express = require("express")
const multer = require("multer");
const Users = require("../models/auth")
const Shifts = require("../models/shifts")
const Sites = require("../models/sites")
const { verifyToken } = require("../middlewares/auth")
const { cloudinary, deleteFileFromCloudinary } = require("../config/cloudinary")
const { getRandomId, cleanObjectValues, } = require("../config/global")

const sendMail = require("../utils/sendMail");
const dayjs = require("dayjs");

const storage = multer.memoryStorage()
const upload = multer({ storage })

const router = express.Router()

const { APP_URL_1 } = process.env

router.post("/add", verifyToken, upload.single("image"), async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Permission denied" });

        let { firstName, lastName, fullName, email, phone, gender, perHour, expireFrom, expireTo, companyId } = req.body;

        const existUser = await Users.findOne({ email })
        if (existUser) return res.status(401).json({ message: "This email is already in use", isError: true })

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

        const verifyUrl = `${APP_URL_1}/auth/set-password?token=${token}&email=${email}`;
        const bodyHtml = `<p>Hello ${fullName},</p>
                         <p>Please click the link below to set your password:</p>
                         <a href="${verifyUrl}" style="color: blue; text-decoration: underline;">Set Password</a>`

        await sendMail(email, "Set admin profile password for Security Matrixai", bodyHtml);

        res.status(201).json({ message: "Guard added successfully, Verification email sent.", guard: newUser });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", error });
    }
});

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid }).lean()
        if (!user) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        let { status = "", perPage = 10, pageNo = 1, name, phone, email, timeZone } = cleanObjectValues(req.query);

        perPage = Number(perPage);
        pageNo = Number(pageNo);
        const skip = (pageNo - 1) * perPage;

        const now = dayjs().tz(timeZone).utc(true);

        await Users.updateMany(
            { companyId: user.companyId, roles: { $in: ["guard"] }, expireTo: { $lt: now }, },
            { $set: { status: "inactive" } }
        );

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
            {
                $match: {
                    roles: { $in: ["guard"] },
                    companyId: user.companyId
                }
            },
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

router.get("/all-guards", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });


        const { status = "", timeZone = "UTC" } = cleanObjectValues(req.query);

        let match = {};

        const now = dayjs().tz(timeZone).utc(true);

        await Users.updateMany(
            { companyId: user.companyId, roles: { $in: ["guard"] }, expireTo: { $lt: now }, },
            { $set: { status: "inactive" } }
        );

        if (status) { match.status = status; }
        if (user.companyId) { match.companyId = user.companyId }
        match.roles = { $in: ["guard"] }
        const guards = await Users.aggregate([
            { $match: match },
            { $project: { _id: 0, uid: 1, fullName: 1, } }
        ]);

        res.status(200).json({ message: "Guards fetched", isError: false, guards });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the Sites", isError: true, error });
    }
});

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
        const { userId } = req.params;
        const { timeZone } = cleanObjectValues(req.query);
        const { status } = req.body

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const user = await Users.findOne({ uid: userId }).lean()

        if (status === "active") {
            const today = dayjs().tz(timeZone).utc(true).startOf("day");
            const expiryDate = dayjs(user.expireTo).utc(true).startOf("day");
            if (today.isAfter(expiryDate)) { return res.status(400).json({ message: "License expired. Guard cannot be restored.", isError: true }); }
        }


        const userUpdated = await Users.findOneAndUpdate(
            { uid: userId },
            { $set: { status: status } },
            { new: true }
        );

        res.status(200).json({ message: `Guard ${status === "active" ? "restore" : "deleted"} successfully`, guard: userUpdated, isError: false });

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
                        photoURL = result.secure_url; photosPublicId = result.public_id;
                        resolve();
                    }
                )
                uploadStream.end(req.file.buffer);
            });
        }


        // ---- Prepare Updated Fields
        const updatedData = { ...req.body, photoURL, photosPublicId, updatedAt: new Date() };

        const updatedUser = await Users.findOneAndUpdate({ uid }, updatedData, { new: true });

        res.status(200).json({ message: "Profile updated successfully", isError: false, user: updatedUser });
    } catch (error) {
        console.error(error);
        res.status(500).json({ isError: true, message: "Profile update failed", error });
    }
});

router.get('/monthly-shifts/:guardId', verifyToken, async (req, res) => {
    try {
        const { guardId } = req.params;
        const { month, year } = req.query;

        const targetDate = dayjs.utc().year(year).month(month);

        const startDate = targetDate.startOf('month').toDate();
        const endDate = targetDate.endOf('month').toDate();
        const shifts = await Shifts.find({ guardId: guardId, date: { $gte: startDate, $lte: endDate } })
            .populate({
                path: 'siteId',
                model: "sites",
                localField: 'siteId',
                foreignField: 'id',
                populate: {
                    path: 'customerId',
                    model: 'customers',
                    localField: 'customerId',
                    foreignField: 'id',
                    select: 'name id'
                },
                select: 'id name address city customerId'
            })
            .select('id totalHours date start end breakTime status checkIn checkOut liveStatus locations')
            .lean();

        res.status(200).json({ success: true, shifts });

    } catch (error) {
        console.error("Error fetching calendar shifts:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
});

router.get('/current-week-shifts/:guardId', verifyToken, async (req, res) => {
    try {
        const { guardId } = req.params;

        const { weekStart, weekEnd } = cleanObjectValues(req.query);

        const startDate = dayjs(weekStart)
        const endDate = dayjs(weekEnd)

        const shifts = await Shifts.find({ guardId: guardId, date: { $gte: startDate, $lte: endDate } }).populate({ path: 'siteId', model: 'sites', localField: 'siteId', foreignField: 'id', select: 'id name address city' }).select('id guardId siteId breakTime date start end status liveStatus totalHours').lean();

        res.status(200).json({ success: true, shifts });

    } catch (error) {
        console.error("Error fetching weekly shifts:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
});

router.get('/:guardId', verifyToken, async (req, res) => {
    try {
        const { guardId } = req.params;

        const guard = await Users.findOne({ uid: guardId }).select('-password -verifyToken -otp -otpExpires -roles -createdBy');

        if (!guard) {
            return res.status(404).json({ success: false, message: "Guard not found" });
        }

        res.status(200).json({ success: true, guard });

    } catch (error) {
        console.error("Error fetching guard profile:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router