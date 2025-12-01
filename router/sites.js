const express = require("express")
const Sites = require("../models/sites");
const Customers = require("../models/customers")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId } = require("../config/global");

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        let formData = req.body

        const site = new Sites({ ...formData, id: getRandomId(), createdBy: uid })
        await site.save()

        res.status(201).json({ message: "Your site added has been successfully", isError: false, site })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while adding the site", isError: true, error })
    }
})

// router.get("/all", verifyToken, async (req, res) => {
//     try {

//         const { status = "", customerId } = req.query;

//         const match = {};

//         if (status) match.status = status;

//         // if (customerId) match.customerId = customerId;

//         const sites = await Sites.aggregate([
//             { $match: match },
//             {
//                 $lookup: {
//                     from: "customers",
//                     localField: "customerId",
//                     foreignField: "id",
//                     as: "customer"
//                 }
//             },
//             { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
//             { $addFields: { customer: { $ifNull: ["$customer.name", "Unknown Customer"] } } },
//         ]);
//         res.status(200).json({ message: "Companies fetched", isError: false, sites });

//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Something went wrong while getting the sites", isError: true, error });
//     }
// });

router.get("/all", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status, customerId, name, longitude, latitude, perPage = 10, pageNo = 1 } = req.query

        const match = {}
        if (status) match.status = status
        if (customerId) match.customerId = customerId
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

        const total = await Sites.countDocuments(match)

        res.status(200).json({ message: "Sites fetched", isError: false, sites, total })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the sites", isError: true, error })
    }
})


router.get("/all-sites", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });


        const { status = "" } = req.query;
        let match = {};

        if (status) { match.status = status; }

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