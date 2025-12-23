const express = require("express");
const Customers = require("../models/customers"); // your customer model
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth");
const { getRandomId } = require("../config/global");

const router = express.Router();

/* ============================
      ADD NEW CUSTOMER
=============================== */
router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        let formData = req.body;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const existCompany = await Customers.findOne({ email: formData.email })
        const adminExist = await Users.findOne({ email: formData.email })
        if (adminExist) { return res.status(409).json({ message: "An account with this email already exists.", isError: true }); }
        if (existCompany) { return res.status(409).json({ message: "This email is already associated with another customer.", isError: true }); }

        const customer = new Customers({ ...formData, id: getRandomId(), createdBy: uid, companyId: user.companyId });

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

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        let { status = "", perPage = 10, pageNo = 1, } = req.query;

        perPage = Number(perPage);
        pageNo = Number(pageNo);
        const skip = (pageNo - 1) * perPage;

        let match = {};
        let companyMatch = {}
        if (status) match.status = status;
        if (user.companyId) match.companyId = user.companyId
        if (user.companyId) companyMatch.companyId = user.companyId

        const result = await Customers.aggregate([
            { $match: match },
            {
                $facet: {
                    data: [
                        { $sort: { createdAt: -1 } },
                        { $skip: skip },
                        { $limit: perPage },
                    ],
                    totalDoc: [{ $count: "total" }],
                }

            }
        ]);

        const counts = await Customers.aggregate([
            { $match: companyMatch },
            {
                $group: {
                    _id: null,
                    active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
                    inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
                }
            }
        ]);

        const customers = result[0].data;
        const countResult = counts[0] || { active: 0, inactive: 0 };
        const total = result[0]?.totalDoc?.[0]?.total || 0;

        res.status(200).json({ message: "Customers fetched successfully", isError: false, customers, total, count: { active: countResult.active, inactive: countResult.inactive } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the customers", isError: true, error: error.message });
    }
});

/* ============================
   GET ALL CUSTOMERS (ID + NAME ONLY)
=============================== */
router.get("/all-customers", verifyToken, async (req, res) => {
    try {

        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        const { status = "" } = req.query;

        const match = {};
        if (status) match.status = status;
        if (user.companyId) match.companyId = user.companyId

        const customers = await Customers.aggregate([
            { $match: match },
            { $project: { _id: 0, id: 1, name: 1, country: 1, city: 1, province: 1, zipCode: 1 } },
            { $sort: { name: 1 } }
        ]);

        res.status(200).json({ message: "customers fetched", isError: false, customers });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the customers", isError: true, error: error.message });
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

        if (customer.email !== formData.email) {
            const existCompany = await Customers.findOne({ email: formData.email })
            const adminExist = await Users.findOne({ email: formData.email })
            if (adminExist) { return res.status(409).json({ message: "An account with this email already exists.", isError: true }); }
            if (existCompany) { return res.status(409).json({ message: "This email is already associated with another customer.", isError: true }); }
        }

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
    UPDATE STATUS CUSTOMER (SOFT DELETE)
=============================== */
router.patch("/update-status/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { status } = req.body

        const { id } = req.params;

        await Customers.findOneAndUpdate(
            { id },
            { $set: { status: status } },
            { new: true }
        );

        res.status(200).json({ message: `Customer ${status === "active" ? "restore" : "deleted"} successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while updating the customer status", isError: true, error });
    }
});

/* ============================
    DELETED CUSTOMER (SOFT DELETE)
=============================== */
router.delete("/single/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params;

        const deletedCustomer = await Customers.findOneAndDelete({ id });

        if (!deletedCustomer) { return res.status(404).json({ message: "Customer not found", isError: true }); }

        res.status(200).json({ message: `Customer deleted successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while deleting the customer", isError: true, error });
    }
});

module.exports = router;
