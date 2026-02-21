const express = require("express")
const QRCodes = require("../models/qrcodes");
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const formData = req.body

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const qrcode = new QRCodes({
            ...formData,
            id: getRandomId(),
            createdBy: uid,
            companyId: user.companyId
        })
        await qrcode.save()

        res.status(201).json({ message: "QR Code added successfully", isError: false, qrcode })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while adding the QR code", isError: true, error })
    }
})

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status, checkPointNumber, perPage = 10, pageNo = 1 } = cleanObjectValues(req.query);

        let match = { companyId: user.companyId }
        if (status) match.status = status
        if (checkPointNumber) match.checkPointNumber = { $regex: checkPointNumber, $options: "i" }

        const qrcodes = await QRCodes.find(match)
            .sort({ createdAt: -1 })
            .skip((pageNo - 1) * perPage)
            .limit(Number(perPage))

        const total = await QRCodes.countDocuments(match)

        res.status(200).json({ message: "QR Codes fetched", isError: false, qrcodes, total })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the QR codes", isError: true, error })
    }
})

router.patch("/update/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { id } = req.params
        const formData = req.body

        const updatedQRCode = await QRCodes.findOneAndUpdate({ id }, formData, { new: true })
        if (!updatedQRCode) { return res.status(404).json({ message: "QR Code not found" }) }

        res.status(200).json({ message: "QR Code updated successfully", isError: false, qrcode: updatedQRCode })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while updating the QR code", isError: true, error })
    }
})

router.delete("/single/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await QRCodes.findOneAndDelete({ id });
        if (!deleted) { return res.status(404).json({ message: "QR Code not found", isError: true }); }
        res.status(200).json({ message: `QR Code deleted successfully`, isError: false });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while deleting the QR code", isError: true, error });
    }
});

module.exports = router
