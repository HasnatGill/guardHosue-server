const express = require("express")
const Sites = require("../models/sites");
const Users = require("../models/auth")
// const Customers = require("../models/customers")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {

        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        let formData = req.body

        const site = new Sites({ ...formData, id: getRandomId(), createdBy: uid, companyId: user.companyId })
        await site.save()

        res.status(201).json({ message: "Your site added has been successfully", isError: false, site })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while adding the site", isError: true, error })
    }
})


router.get("/all", verifyToken, async (req, res) => {
    try {

        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status, customerId, name, longitude, latitude, perPage = 10, pageNo = 1 } = cleanObjectValues(req.query);

        let match = {}
        let companyMatch = {}
        if (status) match.status = status
        if (customerId) match.customerId = customerId
        if (user.companyId) match.companyId = user.companyId
        if (user.companyId) companyMatch.companyId = user.companyId
        if (name) match.name = { $regex: name, $options: "i" }
        if (longitude) match.longitude = { $regex: longitude, $options: "i" }
        if (latitude) match.latitude = { $regex: latitude, $options: "i" }

        const sites = await Sites.aggregate([
            { $match: match },
            { $lookup: { from: "customers", localField: "customerId", foreignField: "id", as: "customer" } },
            { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
            { $addFields: { customer: { $ifNull: ["$customer.name", "Unknown Customer"] } } },
            { $sort: { createdAt: -1 } },
            { $skip: (pageNo - 1) * perPage },
            { $limit: Number(perPage) }
        ])

        const counts = await Sites.aggregate([
            { $match: companyMatch },
            {
                $group: {
                    _id: null,
                    active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
                    inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
                }
            }
        ]);

        const total = await Sites.countDocuments(match)
        const countResult = counts[0] || { active: 0, inactive: 0 };

        res.status(200).json({ message: "Sites fetched", isError: false, sites, total, count: { active: countResult.active, inactive: countResult.inactive } })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the sites", isError: true, error })
    }
})


router.get("/all-sites", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });


        const { status = "" } = req.query;
        let match = {};

        if (status) { match.status = status; }
        if (user.companyId) { match.companyId = user.companyId }

        const sites = await Sites.aggregate([
            { $match: match },
            { $project: { _id: 0, id: 1, name: 1 } }
        ]);

        res.status(200).json({ message: "Sites fetched", isError: false, sites });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the Sites", isError: true, error });
    }
});


router.patch("/update/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params
        let formData = req.body

        const site = await Sites.findOne({ id });
        if (!site) { return res.status(404).json({ message: "Site not found" }) }

        const newData = { ...formData }

        const updatedSite = await Sites.findOneAndUpdate({ id }, newData, { new: true })
        if (!updatedSite) { return res.status(404).json({ message: "Site didn't update" }) }


        res.status(200).json({ message: "A site has been successfully updated", isError: false, site: updatedSite })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while updating the company", isError: true, error })
    }
})

router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        const site = await Sites.findOne({ id })

        res.status(200).json({ site })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.patch("/update-status/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status } = req.body

        const { id } = req.params;

        await Sites.findOneAndUpdate(
            { id },
            { $set: { status: status } },
            { new: true }
        );

        res.status(200).json({ message: `Site ${status === "active" ? "restore" : "deleted"} successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while updating the site status", isError: true, error });
    }
});

router.delete("/single/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params;

        const deletedSite = await Sites.findOneAndDelete({ id });

        if (!deletedSite) { return res.status(404).json({ message: "Site not found", isError: true }); }

        res.status(200).json({ message: `Site deleted successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while deleting the site", isError: true, error });
    }
});

module.exports = router