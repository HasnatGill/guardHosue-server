const express = require("express")
const Companies = require("../models/companies");
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId } = require("../config/global");
const sendMail = require("../utils/sendMail");
const Sites = require("../models/sites");

const router = express.Router()

const { APP_URL } = process.env

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const formData = req.body;

        const company = new Companies({ ...formData, id: getRandomId(), createdBy: uid });
        await company.save();

        const adminUid = getRandomId();
        const token = getRandomId();

        const newUser = new Users({ uid: adminUid, companyId: company.id, email: formData.email, firstName: "Client", lastName: "Admin", fullName: "Client Admin", createdBy: uid, roles: ["admin"], verifyToken: token });

        await newUser.save();

        const verifyUrl = `${APP_URL}/auth/set-password?token=${token}&email=${formData.email}`;
        const bodyHtml = `<p>Hello Admin,</p>
                 <p>Please click the link below to set your password:</p>
                 <a href="${verifyUrl}" style="color: blue; text-decoration: underline;">Set Password</a>`

        await sendMail(formData.email, "Set admin profile password for Guard House", bodyHtml);

        res.status(201).json({ message: "Company & Client Admin added successfully. Verification email sent.", isError: false, company });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while adding the company", isError: true, error });
    }
});


// router.get("/all", verifyToken, async (req, res) => {
//     try {

//         const { status = "" } = req.query
//         let query = {}
//         if (status) { query.status = status }

//         const companies = await Companies.find(query)

//         res.status(200).json({ message: "Companies fetched", isError: false, companies })

//     } catch (error) {
//         console.error(error)
//         res.status(500).json({ message: "Something went wrong while getting the Companies", isError: true, error })
//     }
// })

router.get("/all", verifyToken, async (req, res) => {
    try {
        let { status, name, registrationNo, email, country, province, city, perPage = 10, pageNo = 1, } = req.query;

        perPage = Number(perPage);
        pageNo = Number(pageNo);

        const query = {};

        // Simple text filters
        if (status) query.status = status;
        if (name) query.name = { $regex: name, $options: "i" };
        if (registrationNo) query.registrationNo = { $regex: registrationNo, $options: "i" };
        if (email) query.email = { $regex: email, $options: "i" };

        // JSON-string exact filters
        if (country && country !== "null") query.country = country;
        if (province && province !== "null") query.province = province;
        if (city && country !== "null") query.city = city;

        const total = await Companies.countDocuments(query);
        const skip = (pageNo - 1) * perPage;

        console.log('query', query)

        const companies = await Companies.find(query).sort({ createdAt: -1 }).skip(skip).limit(perPage).lean();

        return res.status(200).json({ message: "Companies fetched successfully", isError: false, companies, totals: total });

    } catch (error) {
        console.error("Get companies error:", error);
        return res.status(500).json({ message: "Something went wrong while getting companies", isError: true, error: error.message, });
    }
});



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

router.get("/cards-data", verifyToken, async (req, res) => {
    try {
        const { status } = req.query;

        // COMMON FILTERS
        const companyFilter = status ? { status } : {};
        const siteFilter = status ? { status } : {};

        const guardFilter = { roles: { $in: ["guard"] } };
        if (status) guardFilter.status = status;

        // === Total Count ===
        const [companyCount, siteCount, guardCount] = await Promise.all([
            Companies.countDocuments(companyFilter),
            Sites.countDocuments(siteFilter),
            Users.countDocuments(guardFilter),
        ]);

        // === Increasing Count (Last 30 days) ===
        const lastMonth = new Date();
        lastMonth.setDate(lastMonth.getDate() - 30);

        const [companyIncrease, siteIncrease, guardIncrease,] = await Promise.all([
            Companies.countDocuments({ createdAt: { $gte: lastMonth } }),
            Sites.countDocuments({ createdAt: { $gte: lastMonth } }),
            Users.countDocuments({ createdAt: { $gte: lastMonth }, roles: { $in: ["guard"] }, }),
        ]);

        return res.status(200).json({
            company: { total: companyCount, increasing: companyIncrease },
            sites: { total: siteCount, increasing: siteIncrease },
            guards: { total: guardCount, increasing: guardIncrease },
        });

    } catch (error) {
        console.error("Cards-data error:", error);
        res.status(500).json({ message: "Failed to fetch dashboard cards", error: error.message, });
    }
});


module.exports = router