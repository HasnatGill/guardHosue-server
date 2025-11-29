const express = require("express");
const Customers = require("../models/customers"); // your customer model
const { verifyToken } = require("../middlewares/auth");
const { getRandomId } = require("../config/global");

const router = express.Router();

/* ============================
      ADD NEW CUSTOMER
=============================== */
router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        let formData = req.body;

        const customer = new Customers({ ...formData, id: getRandomId(), createdBy: uid });

        await customer.save();

        res.status(201).json({ message: "Customer has been successfully added", isError: false, customer });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while adding the customer", isError: true, error });
    }
});

/* ============================
        GET ALL CUSTOMERS
=============================== */
router.get("/all", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status = "" } = req.query;

        let query = {};
        if (status) query.status = status;

        const customers = await Customers.find(query).lean();

        const active = await Customers.countDocuments({ status: "active" })
        const inactive = await Customers.countDocuments({ status: "inactive" })

        res.status(200).json({ message: "Customers fetched successfully", isError: false, customers, count: { active, inactive, } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the customers", isError: true, error });
    }
});

/* ============================
   GET ALL CUSTOMERS (ID + NAME ONLY)
=============================== */
router.get("/all-customers", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status = "" } = req.query;

        let query = {};
        if (status) query.status = status;

        const customers = await Customers.find(query).select("id name").lean();
        res.status(200).json({ message: "Customers fetched successfully", isError: false, customers });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting customers", isError: true, error });
    }
});

/* ============================
        UPDATE CUSTOMER
=============================== */
router.patch("/update/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params;
        let formData = req.body;

        const customer = await Customers.findOne({ id });
        if (!customer) { return res.status(404).json({ message: "Customer not found" }); }

        const updatedCustomer = await Customers.findOneAndUpdate(
            { id },
            { ...formData },
            { new: true }
        );

        if (!updatedCustomer) { return res.status(404).json({ message: "Customer didn't update" }); }

        res.status(200).json({ message: "Customer updated successfully", isError: false, customer: updatedCustomer });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while updating the customer", isError: true, error });
    }
});

/* ============================
      GET SINGLE CUSTOMER
=============================== */
router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params;

        const customer = await Customers.findOne({ id });

        res.status(200).json({ customer });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error });
    }
});

/* ============================
    DELETE CUSTOMER (SOFT DELETE)
=============================== */
router.delete("/single/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params;

        await Customers.findOneAndUpdate(
            { id },
            { $set: { status: "inactive" } },
            { new: true }
        );

        res.status(200).json({ message: "Customer deleted successfully", isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while deleting the customer", isError: true, error });
    }
});

module.exports = router;
