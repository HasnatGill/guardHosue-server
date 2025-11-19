const express = require("express")
const Companies = require("../models/companies");
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId } = require("../config/global");
const sendVerificationMail = require("../utils/sendMail")

const router = express.Router()

// router.post("/add", verifyToken, async (req, res) => {
//     try {
//         const { uid } = req;
//         let formData = req.body

//         const company = new Companies({ ...formData, id: getRandomId(), createdBy: uid })
//         await company.save()

//         if (company.toObject().id) {
//             const newUser = { firstName: "Client", lastName: "Admin", fullName: "Client Admin", email: formData.email,uid: getRandomId(), companyId: company.toObject().id }
//         }

//         res.status(201).json({ message: "Your company & Client Admin added has been successfully", isError: false, company })

//     } catch (error) {
//         console.error(error)
//         res.status(500).json({ message: "Something went wrong while adding the company", isError: true, error })
//     }
// })

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const formData = req.body;

        // 1. Create Company
        const company = new Companies({ ...formData, id: getRandomId(), createdBy: uid });
        await company.save();

        // 2. Create Admin User (without password)
        const adminUid = getRandomId();
        const token = getRandomId(); // verification token

        const newUser = new Users({ uid: adminUid, companyId: company.id, email: formData.email, firstName: "Client", lastName: "Admin", fullName: "Client Admin", createdBy: uid, roles: ["admin"], verifyToken: token });

        await newUser.save();

        // 3. Send Email to Admin
        const verifyUrl = `http://localhost:5173/auth/set-password?token=${token}&email=${formData.email}`;

        await sendVerificationMail(formData.email, verifyUrl);

        res.status(201).json({ message: "Company & Client Admin added successfully. Verification email sent.", isError: false, company });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while adding the company", isError: true, error });
    }
});


router.get("/all", verifyToken, async (req, res) => {
    try {

        const { status = "" } = req.query
        let query = {}
        if (status) { query.status = status }

        const companies = await Companies.find(query)

        res.status(200).json({ message: "Companies fetched", isError: false, companies })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the Companies", isError: true, error })
    }
})

router.get("/all-companies", verifyToken, async (req, res) => {
    try {

        const { status = "" } = req.query
        let query = {}
        if (status) { query.status = status }

        const companies = await Companies.find(query).select("id name")

        res.status(200).json({ message: "Companies fetched", isError: false, companies })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the Companies", isError: true, error })
    }
})

router.patch("/update/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params
        let formData = req.body

        const company = await Companies.findOne({ id });
        if (!company) { return res.status(404).json({ message: "Company not found" }) }

        const newData = { ...formData }

        const updatedCompany = await Companies.findOneAndUpdate({ id }, newData, { new: true })
        if (!updatedCompany) { return res.status(404).json({ message: "Company didn't update" }) }


        res.status(200).json({ message: "A company has been successfully updated", isError: false, company: updatedCompany })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while updating the company", isError: true, error })
    }
})

router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        const company = await Companies.findOne({ id })

        res.status(200).json({ company })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.delete("/single/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        await Companies.findOneAndUpdate(
            { id },
            { $set: { status: "inactive" } },
            { new: true }
        )

        res.status(200).json({ message: "The company has been successfully deleted", isError: false })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while deleting the company", isError: true, error })
    }
})

module.exports = router