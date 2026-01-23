const express = require("express");
const router = express.Router();
const Taxes = require("../models/taxes");
const { verifyToken } = require("../middlewares/auth");
const { getRandomId, cleanObjectValues } = require("../config/global");

// Create a new tax
router.post("/create", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { name, rate, description } = req.body;

        if (!uid) return res.status(401).json({ message: "Unauthorized", isError: true });
        if (!name) return res.status(400).json({ message: "Tax Name is required", isError: true });
        if (rate === undefined || rate === null) return res.status(400).json({ message: "Tax Rate is required", isError: true });

        const newTax = new Taxes({
            id: getRandomId(),
            name,
            rate: Number(rate),
            description,
            createdBy: uid,
            status: 'active'
        });

        await newTax.save();

        res.status(201).json({ message: "Tax created successfully", isError: false, tax: newTax });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error creating tax", isError: true, error: error.message });
    }
});

// Get all taxes
router.get("/all", verifyToken, async (req, res) => {
    try {
        const query = cleanObjectValues(req.query);
        const taxes = await Taxes.find(query).sort({ createdAt: -1 });
        res.status(200).json({ message: "Taxes fetched successfully", isError: false, taxes });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching taxes", isError: true, error: error.message });
    }
});

// Update a tax
router.patch("/update/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const tax = await Taxes.findOneAndUpdate({ id }, updates, { new: true });

        if (!tax) return res.status(404).json({ message: "Tax not found", isError: true });

        res.status(200).json({ message: "Tax updated successfully", isError: false, tax });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error updating tax", isError: true, error: error.message });
    }
});

// Delete a tax
router.delete("/remove/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Taxes.findOneAndDelete({ id });

        if (!deleted) return res.status(404).json({ message: "Tax not found", isError: true });

        res.status(200).json({ message: "Tax deleted successfully", isError: false });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error deleting tax", isError: true, error: error.message });
    }
});

module.exports = router;
