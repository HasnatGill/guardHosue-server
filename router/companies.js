const express = require("express")
const Companies = require("../models/companies");
const Transactions = require("../models/Transactions");
const Users = require("../models/auth");
const Customers = require("../models/customers")
const { verifyToken } = require("../middlewares/auth");
const { getRandomId, getRandomRef, cleanObjectValues } = require("../config/global");
const sendMail = require("../utils/sendMail");
const dayjs = require("dayjs");

const router = express.Router()

const { APP_URL } = process.env

router.post("/add", verifyToken, async (req, res) => {
  try {

    const { uid } = req;
    const { timeZone = "UTC" } = cleanObjectValues(req.query)
    const formData = req.body;
    if (!uid) return res.status(401).json({ message: "Unauthorized request. Please log in again.", isError: true });

    const existCompany = await Companies.findOne({ email: formData.email })
    const adminExist = await Users.findOne({ email: formData.email })
    if (adminExist) { return res.status(409).json({ message: "An account with this email already exists.", isError: true }); }
    if (existCompany) { return res.status(409).json({ message: "This email is already associated with another company.", isError: true }); }

    // Billing Logic
    let { freeTrial } = formData;
    let trialEndsAt = null;
    if (freeTrial) {
      trialEndsAt = dayjs().tz(timeZone).utc(true).add(1, 'month').toDate();
    }

    const company = new Companies({ ...formData, freeTrial, trialEndsAt, id: getRandomId(), createdBy: uid });
    await company.save();

    const adminUid = getRandomId();
    const token = getRandomId();

    const newUser = new Users({ uid: adminUid, companyId: company.id, email: formData.email, firstName: "Client", lastName: "Admin", fullName: "Client Admin", createdBy: uid, roles: ["admin"], verifyToken: token });

    await newUser.save();

    const verifyUrl = `${APP_URL}/auth/set-password?token=${token}&email=${formData.email}`;
    const bodyHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Set Your Password</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f8; font-family:Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background-color:#BF0603; padding:20px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:22px;">
                Account Setup
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              <p style="font-size:16px; color:#333333; margin:0 0 15px;">
                Hello Admin,
              </p>

              <p style="font-size:15px; color:#555555; line-height:1.6; margin:0 0 25px;">
                Your account has been created successfully.  
                Please click the button below to set your password and activate your account.
              </p>

              <!-- Button -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${verifyUrl}"
                      style="
                        display:inline-block;
                        padding:12px 28px;
                        background-color:##BF0603;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:15px;
                        font-weight:bold;
                        border-radius:5px;
                      ">
                      Set Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size:14px; color:#777777; margin:25px 0 0; line-height:1.6;">
                If you did not request this, please ignore this email.  
                This link will expire for security reasons.
              </p>

              <p style="font-size:14px; color:#555555; margin:25px 0 0;">
                Regards,<br />
                <strong>Security Matrix AI Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f1f3f5; padding:15px; text-align:center;">
              <p style="font-size:12px; color:#999999; margin:0;">
                © ${dayjs().toDate().getFullYear()} Security Matrix AI. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

    await sendMail(formData.email, "Set admin profile password for Security Matrix AI", bodyHtml);

    res.status(201).json({ message: "Company & Client Admin added successfully. Verification email sent.", isError: false, company });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Something went wrong while adding the company", isError: true, error });
  }
});


// router.get("/all", verifyToken, async (req, res) => {
router.get("/all", verifyToken, async (req, res) => {
  try {
    const { uid } = req;
    if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

    let { status, name, registrationNo, email, country, province, city, perPage = 10, pageNo = 1, } = cleanObjectValues(req.query);

    perPage = Number(perPage);
    pageNo = Number(pageNo);
    const skip = (pageNo - 1) * perPage;

    const now = new Date();
    await Companies.updateMany(
      { paymentStatus: "paid", expirePackage: { $lte: now } },
      { $set: { paymentStatus: "unpaid", expirePackage: null } }
    );

    // Base Match Filter
    const match = {};

    if (status) match.status = status;
    if (name) match.name = { $regex: name, $options: "i" };
    if (registrationNo) match.registrationNo = { $regex: registrationNo, $options: "i" };
    if (email) match.email = { $regex: email, $options: "i" };

    if (country && country !== "null") match.country = country;
    if (province && province !== "null") match.province = province;
    if (city && city !== "null") match.city = city;

    const result = await Companies.aggregate([
      { $match: match },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: perPage }
          ],
          total: [{ $count: "count" }],
        }
      }
    ]);

    const counts = await Companies.aggregate([
      {
        $group: {
          _id: null,
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
        }
      }
    ]);

    const companies = result[0].data;
    const totals = result[0].total[0]?.count || 0;
    const countResult = counts[0] || { active: 0, pending: 0, inactive: 0 };

    return res.status(200).json({ message: "Companies fetched successfully", isError: false, companies, totals, count: { active: countResult.active, pending: countResult.pending, inactive: countResult.inactive } });

  } catch (error) {
    console.error("Get companies error:", error);
    return res.status(500).json({ message: "Something went wrong while getting companies", isError: true, error: error.message });
  }
});


router.patch("/payment-status/:id", verifyToken, async (req, res) => {
  try {

    const { uid } = req;
    if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

    const companyId = req.params.id;
    const { paymentStatus, amount = 0, method = "manual", notes = "" } = req.body;

    if (!["paid"].includes(paymentStatus)) { return res.status(400).json({ message: "Invalid update. Payment status can only be changed from 'unpaid' to 'paid'." }); }

    const company = await Companies.findOne({ id: companyId });
    if (!company) return res.status(404).json({ message: "Company not found" });

    if (paymentStatus === "paid") {
      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + 30);

      company.paymentStatus = "paid";
      company.expirePackage = expireDate;
      await company.save();

      // Create transaction
      const txn = new Transactions({ companyId, ref: getRandomRef(), amount, method, status: "paid", notes, transactionDate: new Date(), createdBy: uid, expireDate: expireDate });
      await txn.save();

      return res.status(200).json({ message: "Payment marked paid", company, transaction: txn });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to update payment status" });
  }
})

router.get("/all-companies", verifyToken, async (req, res) => {
  try {
    const { uid } = req;
    if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

    const { status = "" } = req.query;

    const match = {};
    if (status) match.status = status;

    const companies = await Companies.aggregate([
      { $match: match },
      { $project: { _id: 0, id: 1, name: 1 } },
      { $sort: { name: 1 } }
    ]);

    res.status(200).json({ message: "Companies fetched", isError: false, companies });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Something went wrong while getting the Companies", isError: true, error: error.message });
  }
});


router.patch("/update/:id", verifyToken, async (req, res) => {
  try {

    const { uid } = req;
    if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

    const { id } = req.params
    let formData = req.body

    const company = await Companies.findOne({ id });
    if (!company) { return res.status(404).json({ message: "Company not found" }) }

    if (company.email !== formData.email) {
      const existCompany = await Companies.findOne({ email: formData.email })
      const adminExist = await Users.findOne({ email: formData.email })
      if (adminExist) { return res.status(409).json({ message: "An account with this email already exists.", isError: true }); }
      if (existCompany) { return res.status(409).json({ message: "This email is already associated with another company.", isError: true }); }
    }

    const newData = { ...formData }

    // Recalculate trial end if weeks changed
    if (newData.trialPeriodWeeks && newData.trialPeriodWeeks != company.trialPeriodWeeks) {
      newData.trialEndsAt = dayjs().add(newData.trialPeriodWeeks, 'week').toDate();
    }

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

    const { uid } = req;
    if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

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

    const { uid } = req;
    const { id } = req.params
    if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

    const company = await Companies.findOne({ id }).lean()

    const user = await Users.findOne({ email: company.email }).lean()

    const userUpdated = await Users.findOneAndUpdate(
      { uid: user.uid },
      { $set: { status: "inactive" } },
      { new: true }
    )

    const companyUpdated = await Companies.findOneAndUpdate(
      { id },
      { $set: { status: "inactive" } },
      { new: true }
    )

    req.io.emit('account_block', { info: { uid: userUpdated.uid, companyId: companyUpdated.id }, type: 'block', message: `Your account has been deactivated by the Super Admin.` });

    res.status(200).json({ message: "The company has been successfully deleted", isError: false })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Something went wrong while deleting the company", isError: true, error })
  }
})

// router.get("/cards-data", verifyToken, async (req, res) => {
//     try {

//         const { uid } = req;
//         if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

//         const { status } = req.query;

//         // COMMON FILTERS
//         // const companyFilter = status ? { status } : {};

//         const guardFilter = { roles: { $in: ["guard"] } };
//         if (status) guardFilter.status = status;

//         // === Total Count ===
//         const [companyCount, transactionCount, guardCount, customerCount] = await Promise.all([
//             Companies.countDocuments(),
//             Transactions.countDocuments(),
//             Users.countDocuments(guardFilter),
//             Customers.countDocuments()
//         ]);

//         // === Increasing Count (Last 30 days) ===
//         const lastMonth = new Date();
//         lastMonth.setDate(lastMonth.getDate() - 30);

//         const [companyIncrease, transactionIncrease, guardIncrease, customerIncrease] = await Promise.all([
//             Companies.countDocuments({ createdAt: { $gte: lastMonth } }),
//             Transactions.countDocuments({ createdAt: { $gte: lastMonth } }),
//             Users.countDocuments({ createdAt: { $gte: lastMonth }, roles: { $in: ["guard"] }, }),
//             Customers.countDocuments({ createdAt: { $gte: lastMonth } }),
//         ]);

//         return res.status(200).json({
//             company: { total: companyCount, increasing: companyIncrease },
//             transactions: { total: transactionCount, increasing: transactionIncrease },
//             guards: { total: guardCount, increasing: guardIncrease },
//             customers: { total: customerCount, increasing: customerIncrease },
//         });

//     } catch (error) {
//         console.error("Cards-data error:", error);
//         res.status(500).json({ message: "Failed to fetch dashboard cards", error: error.message, });
//     }
// });

router.get("/cards-data", verifyToken, async (req, res) => {
  try {
    const { uid } = req;
    if (!uid) {
      return res.status(401).json({ message: "Unauthorized access.", isError: true });
    }

    const { status } = req.query;

    // Guard filter 🔍
    const guardFilter = { roles: { $in: ["guard"] } };
    if (status) guardFilter.status = status;

    // Date ranges
    const now = new Date();

    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // === Helper ===
    const getStats = (Model, match = {}) =>
      Model.aggregate([
        { $match: match },
        {
          $facet: {
            total: [{ $count: "count" }],
            thisMonth: [{ $match: { createdAt: { $gte: startOfThisMonth } } }, { $count: "count" },],
            lastMonth: [{ $match: { createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth, }, }, }, { $count: "count" },],
          },
        },
        {
          $project: {
            total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },
            thisMonth: { $ifNull: [{ $arrayElemAt: ["$thisMonth.count", 0] }, 0] },
            lastMonth: { $ifNull: [{ $arrayElemAt: ["$lastMonth.count", 0] }, 0] },
          },
        },
        {
          $addFields: {
            growth: {
              $cond: [
                { $eq: ["$lastMonth", 0] }, 100,
                { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$thisMonth", "$lastMonth"] }, "$lastMonth"] }, 100] }, 2] }]
            }
          }
        }
      ]);

    // Run all together
    const [company, transactions, guards, customers] = await Promise.all([getStats(Companies), getStats(Transactions), getStats(Users, guardFilter), getStats(Customers),]);

    return res.status(200).json({ company: company[0], transactions: transactions[0], guards: guards[0], customers: customers[0], });

  } catch (error) {
    console.error("Cards-data error:", error);
    res.status(500).json({ message: "Failed to fetch dashboard cards", error: error.message, });
  }
});

module.exports = router