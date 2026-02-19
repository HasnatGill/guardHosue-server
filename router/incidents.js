const express = require("express");
const Incident = require("../models/Incident");
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
        const resourceType = file.mimetype.startsWith("video/") ? "video" : "image";

        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "securitymatrixai/incidents", resource_type: resourceType },  // Set resource type dynamically
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    name: file.originalname,
                    url: result.secure_url,
                    type: file.mimetype,
                    publicId: result.public_id
                });
            }
        );
        uploadStream.end(file.buffer);
    });
};

// Refined Unified Incident Reporting Route
router.post("/report", verifyToken, upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'video', maxCount: 1 }
]), async (req, res) => {
    try {
        const { uid } = req;
        const { shiftId, siteId, guardId, incidentType, incidentDescription, details, actionTaken, people, signature, latitude, longitude } = req.body;

        // 1. Validation
        if (!shiftId || !incidentType) {
            return res.status(400).json({ message: "Missing required fields (shiftId or incidentType)", isError: true });
        }

        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        // 2. Handle File Uploads
        let imageUrls = [];
        let videoUrl = null;

        if (req.files) {
            if (req.files.images) {
                const results = await Promise.all(req.files.images.map(uploadToCloudinary));
                imageUrls = results.map(r => r.url);
            }
            if (req.files.video) {
                const result = await uploadToCloudinary(req.files.video[0]);
                videoUrl = result.url;
            }
        }

        // 3. Parse and Map People
        let parsedPeople = [];
        if (people) {
            try {
                parsedPeople = typeof people === 'string' ? JSON.parse(people) : people;
            } catch (e) {
                console.error("Error parsing people field:", e);
            }
        }

        // 4. Create Record using new Incident model
        const customId = `INC-${Date.now()}-${getRandomId(4)}`;

        const newIncident = new Incident({
            id: customId,
            shiftId,
            siteId,
            guardId: guardId || user.uid,
            companyId: user.companyId,
            incidentType,
            incidentDescription,
            description: details,
            actionTaken,
            people: parsedPeople,
            attachments: imageUrls,
            video: videoUrl,
            signature,
            status: 'pending'
        });

        await newIncident.save();

        // 5. Link to Shift
        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            { $push: { incidents: customId } },
            { new: true }
        ).populate('site').populate('guard');

        // 6. Socket Notification
        if (req.io) {
            const site = await Sites.findOne({ id: siteId }, 'name address city province location');
            const guardUser = await Users.findOne({ uid: guardId || uid }, 'fullName uid phone email photoURL');

            req.io.emit('NEW_INCIDENT', {
                incident: {
                    ...newIncident.toObject(),
                    guard: guardUser,
                    site: site,
                    shift: updatedShift
                },
                message: `New Incident reported at ${site?.name || 'Site'}`
            });
        }

        res.status(201).json({
            message: "Incident reported successfully",
            isError: false,
            incident: newIncident
        });

    } catch (error) {
        console.error("Incident Route Error:", error);
        res.status(500).json({ message: "Something went wrong while saving incident", isError: true, error: error.message });
    }
});

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized.", isError: true });

        const { limit = 20, page = 1 } = req.query;
        const skip = (page - 1) * limit;

        const incidents = await Incident.find()
            .sort({ createdAt: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit))
            .populate('guard', 'fullName email phone roles photoURL')
            .populate('site', 'name address city province location')
            .populate('shift');

        console.log(incidents)
        res.status(200).json({ incidents, isError: false });

    } catch (error) {
        console.error("Fetch Incidents Error:", error);
        res.status(500).json({ message: "Failed to fetch incidents.", isError: true });
    }
});

module.exports = router;
