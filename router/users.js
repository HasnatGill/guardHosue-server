const express = require("express")
const multer = require("multer");
const bcrypt = require("bcrypt")
const Users = require("../models/auth")
const Shifts = require("../models/shifts")
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

        const cleanedBody = cleanObjectValues(req.body);
        let { firstName, lastName, fullName, email, phone, gender, licenceExpiryDate, lincenceNumber, companyId, role } = cleanedBody;

        const existUser = await Users.findOne({ email })
        if (existUser) return res.status(401).json({ message: "This email is already in use", isError: true })
        console.log("req.body", req.body)
        let photoURL = "", photoPublicId = "";
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'securitymatrixai/users' },
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

        const newUser = new Users({ firstName, lastName, companyId, verifyToken: token, fullName, email, phone, gender, uid: newUserUID, password: null, photoURL, createdBy: uid, lincenceNumber, licenceExpiryDate, photoPublicId, role });

        await newUser.save();

        const verifyUrl = `${APP_URL}/auth/set-password?token=${token}&email=${email}`;
        const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Set Your Password</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f8; font-family:Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#BF0603; padding:20px; text-align:center;">
              <h2 style="margin:0; color:#ffffff; font-size:22px;">
                Security Matrix AI
              </h2>
              <p style="margin:5px 0 0; color:#ffffff; font-size:14px;">
                Guard Account Setup
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              <p style="font-size:16px; color:#333333; margin:0 0 10px;">
                Hello ${fullName},
              </p>

              <p style="font-size:15px; color:#555555; line-height:1.6; margin:0 0 20px;">
                Your guard account has been created for the Security Matrix AI application.
                Please set your password to activate and access your account.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${verifyUrl}"
                      style="
                        display:inline-block;
                        padding:12px 30px;
                        background-color:#BF0603;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:15px;
                        font-weight:bold;
                        border-radius:5px;
                      ">
                      Set Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size:14px; color:#777777; margin:25px 0 0; line-height:1.6;">
                For security reasons, this link is time-limited.
                If you did not expect this email, please ignore it.
              </p>

              <p style="font-size:14px; color:#555555; margin-top:25px;">
                Regards,<br />
                <strong>Security Matrix AI Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f1f3f5; padding:12px; text-align:center;">
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

        await sendMail(email, "Set your password - Security Matrix AI", bodyHtml);

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

        let { status = "", perPage = 10, pageNo = 1, name, phone, email, timeZone, role } = cleanObjectValues(req.query);

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
        if (role) { match.role = role; }


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
                    { folder: 'securitymatrixai/users' }, // Optional: specify a folder in Cloudinary
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


        const { status = "", timeZone = "UTC", role } = cleanObjectValues(req.query);

        let match = {};

        const now = dayjs().tz(timeZone).utc(true);

        await Users.updateMany(
            { companyId: user.companyId, roles: { $in: ["guard"] }, expireTo: { $lt: now }, },
            { $set: { status: "inactive" } }
        );

        if (status) { match.status = status; }
        if (user.companyId) { match.companyId = user.companyId }
        if (role) { match.role = role; }
        match.roles = { $in: ["guard"] }
        const guards = await Users.aggregate([
            { $match: match },
            { $project: { _id: 0, uid: 1, fullName: 1, role: 1, photoURL: 1 } }
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
        const { password, phone, lincenceNumber, licenceExpiryDate, ...otherData } = req.body;

        const user = await Users.findOne({ uid });
        if (!user) return res.status(404).json({ isError: true, message: "User not found" });

        let { photoURL = "", photoPublicId = "" } = user
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'securitymatrixai/users' },
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
        const updatedData = {
            ...otherData,
            photoURL,
            photoPublicId,
            updatedAt: new Date()
        };

        if (password) {
            updatedData.password = await bcrypt.hash(password, 10);
        }

        if (phone) updatedData.phone = phone;
        if (lincenceNumber) updatedData.lincenceNumber = lincenceNumber;
        if (licenceExpiryDate) updatedData.licenceExpiryDate = licenceExpiryDate;

        const updatedUser = await Users.findOneAndUpdate({ uid }, { $set: updatedData }, { new: true });

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
            .select('id totalHours date start end breakTime status actualEnd actualStart liveStatus locations checkpoints clockInLocation')
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

        const shifts = await Shifts.find({ guardId: guardId, date: { $gte: startDate, $lte: endDate } }).populate({ path: 'siteId', model: 'sites', localField: 'siteId', foreignField: 'id', select: 'id name address city' }).select('id guardId siteId actualEnd actualStart breakTime date start end status liveStatus totalHours locations checkpoints selfieURL clockInLocation').lean();

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