const express = require("express");
const Incidents = require("../models/incidents");
const Shifts = require("../models/shifts"); // To link back if needed
const Users = require("../models/auth");
const Sites = require("../models/sites");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { verifyToken } = require("../middlewares/auth");
const { getRandomId, cleanObjectValues } = require("../config/global");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper to upload to Cloudinary
const uploadToCloudinary = (file) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "incidents", resource_type: "image" },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    name: file.originalname,
                    url: result.secure_url,
                    publicId: result.public_id
                });
            }
        );
        uploadStream.end(file.buffer);
    });
};

router.post("/report", verifyToken, upload.array("images"), async (req, res) => {
    try {
        const { uid } = req;
        const { shiftId, description, severity = "Medium" } = req.body;

        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        // Retrieve Shift Details
        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return res.status(404).json({ message: "Shift not found relating to this incident.", isError: true });

        // Upload Images
        let uploadedImages = [];
        if (req.files && req.files.length > 0) {
            uploadedImages = await Promise.all(req.files.map(uploadToCloudinary));
        }

        const incidentData = {
            id: getRandomId(),
            guardId: uid,
            siteId: shift.siteId,
            shiftId: shiftId,
            companyId: user.companyId, // Ensure incident is scoped to company
            description,
            severity,
            images: uploadedImages,
            createdBy: uid,
            status: "Open"
        };

        const newIncident = new Incidents(incidentData);
        await newIncident.save();

        // Populate for Socket Payload
        const guardUser = await Users.findOne({ uid: incidentData.guardId }, 'fullName uid');
        const siteData = await Sites.findOne({ id: incidentData.siteId }, 'name address');

        const incidentPayload = {
            ...newIncident.toObject(),
            guardName: guardUser ? guardUser.fullName : "Unknown Guard",
            siteName: siteData ? siteData.name : "Unknown Site",
            siteAddress: siteData ? siteData.address : ""
        };

        // Real-time Event Emission
        if (req.io) {
            req.io.emit('NEW_INCIDENT', {
                incident: incidentPayload,
                message: `New ${severity} Severity Incident Reported by ${incidentPayload.guardName}`
            });
        }

        res.status(201).json({
            message: "Incident reported successfully.",
            isError: false,
            incident: incidentPayload
        });

    } catch (error) {
        console.error("Incident Reporting Error:", error);
        res.status(500).json({ message: "Something went wrong while reporting incident.", isError: true, error: error.message });
    }
});

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized.", isError: true });

        const { limit = 20, page = 1 } = req.query;
        const skip = (page - 1) * limit;

        const incidents = await Incidents.aggregate([
            { $match: { companyId: user.companyId } },
            { $sort: { createdAt: -1 } },
            { $skip: parseInt(skip) },
            { $limit: parseInt(limit) },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guard" } },
            { $unwind: { path: "$guard", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "site" } },
            { $unwind: { path: "$site", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: 1, description: 1, severity: 1, status: 1, images: 1, createdAt: 1,
                    guardName: "$guard.fullName",
                    siteName: "$site.name"
                }
            }
        ]);

        res.status(200).json({ incidents, isError: false });

    } catch (error) {
        console.error("Fetch Incidents Error:", error);
        res.status(500).json({ message: "Failed to fetch incidents.", isError: true });
    }
});

module.exports = router;
