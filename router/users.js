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

const { APP_URL } = process.env

router.post("/add", verifyToken, upload.single("image"), async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Permission denied" });

        let { firstName, lastName, fullName, email, phone, gender, perHour, expireFrom, expireTo, companyId } = req.body;

        const existUser = await Users.findOne({ email })
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

        const user = await Users.findOne({ uid }).lean()
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


        const { status = "" } = req.query;

        let match = {};

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

router.get('/:guardId/shifts/month', async (req, res) => {
    try {
        const { guardId } = req.params;
        const { month, year } = req.query; // month is 0-indexed from frontend (0=Jan, 11=Dec)

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "Month and year are required query parameters." });
        }

        // Month ko +1 karke dayjs mein use karein (1=Jan, 12=Dec)
        const targetMonth = parseInt(month) + 1;

        // Start aur End date UTC mein calculate karein
        const startDate = dayjs.utc(`${year}-${targetMonth}-01`).startOf('month');
        const endDate = dayjs.utc(`${year}-${targetMonth}-01`).endOf('month');

        // Database query aur populate (Aggregation se simple aur readable hai)
        const shifts = await Shifts.find({
            guardId: guardId,
            date: {
                $gte: startDate.toDate(),
                $lte: endDate.toDate()
            }
        })
            .populate({
                path: 'siteId',
                model: Sites,
                select: 'name city'
            });

        // Data format karein - Frontend ko UTC dates bhejein, formatting frontend par hogi
        const formattedShifts = shifts.map(shift => {
            const shiftObject = shift.toObject();
            return {
                id: shiftObject.id,
                date: dayjs.utc(shiftObject.date).toISOString(), // UTC date
                start: dayjs.utc(shiftObject.start).toISOString(), // UTC start time
                end: dayjs.utc(shiftObject.end).toISOString(),   // UTC end time
                totalHours: shiftObject.totalHours,
                siteName: shiftObject.siteId?.name || 'N/A',
                siteCity: shiftObject.siteId?.city?.label || shiftObject.siteId?.city || 'N/A',
            };
        });

        res.status(200).json({ success: true, shifts: formattedShifts });

    } catch (error) {
        console.error("Error fetching calendar shifts:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.get('/current-week-shifts/:guardId', verifyToken, async (req, res) => {
    try {
        const { guardId } = req.params;

        const { weekStart, weekEnd } = cleanObjectValues(req.query);

        const startDate = dayjs(weekStart)
        const endDate = dayjs(weekEnd)

        const shifts = await Shifts.find({ guardId: guardId, date: { $gte: startDate, $lte: endDate } }).populate({ path: 'siteId', model: 'sites', select: 'name address' })
            .select('id guardId siteId breakTime date start end status liveStatus totalHours')
            .lean();

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