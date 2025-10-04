const express = require("express")
const bcrypt = require("bcrypt")
const multer = require("multer")
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, } = require("../config/global")
const { cloudinary } = require("../config/cloudinary")

const storage = multer.memoryStorage()
const upload = multer({ storage })
const router = express.Router()

router.post("/add", verifyToken, upload.single("image"), async (req, res) => {
    try {

        const { uid } = req
        let formData = req.body
        let { firstName, lastName, fullName, email, phone, gender } = formData

        if (!uid) { return res.status(401).json({ message: "Permission denied.", isError: true }) }

        const user = await Users.findOne({ $or: [{ email }, { phone }] });
        if (user) { return res.status(401).json({ message: user.phone === phone ? "Phone is already in use" : "Email is already in use", isError: true }) }

        const hashedPassword = await bcrypt.hash("guardHouse123", 10)

        let photoURL = "", photoPublicId = "", newUserUID = getRandomId()
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'guardHouse/guards' }, // Optional: specify a folder in Cloudinary
                    (error, result) => {
                        if (error) { return reject(error); }
                        photoURL = result.secure_url; photoPublicId = result.public_id;
                        resolve();
                    }
                )
                uploadStream.end(req.file.buffer);
            });
        }

        const newUserData = { fullName, firstName, lastName, email, phone, gender, uid: newUserUID, createdBy: uid, password: hashedPassword, photoURL, photoPublicId }

        const newUser = new Users(newUserData)
        await newUser.save()

        res.status(201).json({ message: "A new user has been successfully added", isError: false, guard: newUser })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while adding the new user", isError: true, error })
    }
})

router.get("/all", verifyToken, async (req, res) => {
    try {

        const { uid } = req
        const { status = "" } = req.query

        let query = {};
        if (status) { query.status = status }
        query.roles = { $in: ['guard'] }

        if (!uid) { return res.status(401).json({ message: "Permission denied.", isError: true }) }
        const allUsers = await Users.find(query).select("-password").exec()

        res.status(200).json({ guards: allUsers })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.patch("/update/:id", verifyToken, upload.single("image"), async (req, res) => {
    try {

        const { id } = req.params
        let formData = req.body

        const user = await Users.findOne({ uid: id });
        if (!user) { return res.status(404).json({ message: "Guard not found" }) }

        let { photoURL = "", photoPublicId = "" } = user
        if (req.file) {
            await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'guardHouse/guards' },
                    (error, result) => {
                        if (error) { return reject(error); }
                        photoURL = result.secure_url; photoPublicId = result.public_id;
                        resolve();
                    }
                )
                uploadStream.end(req.file.buffer);
            });
        }

        const newData = { ...formData, photoURL, photoPublicId }

        const updatedUser = await Users.findOneAndUpdate({ uid: id }, newData, { new: true })
        if (!updatedUser) { return res.status(404).json({ message: "Guard didn't update" }) }


        res.status(200).json({ message: "A guard has been successfully updated", isError: false, guard: updatedUser })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while updating the new user", isError: true, error })
    }
})

router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        const guard = await Users.findOne({ uid: id })

        res.status(200).json({ guard })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.delete("/single/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        const deletedGuard = await Users.findOneAndDelete({ id })

        await deleteFileFromCloudinary(deletedGuard.photoPublicId)

        res.status(200).json({ message: "A guard has been successfully deleted", isError: false })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while deleting the guard", isError: true, error })
    }
})

// router.patch("/update-with", verifyToken, upload.single("image"), async (req, res) => {
//     try {

//         // const { uid } = req
//         const { type, value } = req.query
//         let formData = req.body
//         let { country = "{}", province = "{}", city = "{}", emergencyContact = "{}" } = formData

//         const user = await Users.findOne({ [type]: value });
//         if (!user) { return res.status(404).json({ message: "User not found" }) }

//         let { photoURL = "", photoPublicId = "" } = user
//         if (req.file) {
//             await new Promise((resolve, reject) => {
//                 const uploadStream = cloudinary.uploader.upload_stream(
//                     { folder: 'seeraht/users' }, // Optional: specify a folder in Cloudinary
//                     (error, result) => {
//                         if (error) { return reject(error); }
//                         photoURL = result.secure_url; photoPublicId = result.public_id;
//                         resolve();
//                     }
//                 )
//                 uploadStream.end(req.file.buffer);
//             });
//         }

//         country = JSON.parse(country)
//         province = JSON.parse(province)
//         city = JSON.parse(city)
//         emergencyContact = JSON.parse(emergencyContact)

//         const newUserData = { ...formData, country, province, city, emergencyContact, photoURL, photoPublicId }

//         const updatedUser = await Users.findOneAndUpdate({ [type]: value }, newUserData, { new: true })
//         if (!updatedUser) { return res.status(404).json({ message: "Unauthorized or user not found" }) }

//         // const userWithCampus = { ...updatedUser.toObject() }

//         // if (userWithCampus.campusId) {
//         //     const campus = await Campuses.findOne({ id: campusId })
//         //     userWithCampus.campus = campus.toObject()
//         // }

//         res.status(200).json({ message: "A user has been successfully updated", isError: false, user: updatedUser })

//     } catch (error) {
//         console.error(error)
//         res.status(500).json({ message: "Something went wrong while updating the new user", isError: true, error })
//     }
// })

// router.patch("/update-profile-photo", verifyToken, upload.single("image"), async (req, res) => {
//     try {

//         const { uid } = req

//         const user = await Users.findOne({ uid });
//         if (!user) { return res.status(404).json({ message: "User not found" }) }

//         let { photoURL = "", photoPublicId = "" } = user
//         if (req.file) {
//             await new Promise((resolve, reject) => {
//                 const uploadStream = cloudinary.uploader.upload_stream(
//                     { folder: 'seeraht/users' }, // Optional: specify a folder in Cloudinary
//                     (error, result) => {
//                         if (error) { return reject(error); }
//                         photoURL = result.secure_url; photoPublicId = result.public_id;
//                         resolve();
//                     }
//                 )
//                 uploadStream.end(req.file.buffer);
//             });
//         }

//         // Delete old photo from cloudinary
//         if (user.photoPublicId) { await deleteFileFromCloudinary(user.photoPublicId) }


//         const newUserData = { photoURL, photoPublicId }

//         const updatedUser = await Users.findOneAndUpdate({ uid }, newUserData, { new: true })
//         if (!updatedUser) { return res.status(404).json({ message: "Unauthorized or user not found" }) }

//         res.status(200).json({ message: "A user has been successfully updated", isError: false, user: updatedUser })

//     } catch (error) {
//         console.error(error)
//         res.status(500).json({ message: "Something went wrong while updating the new user", isError: true, error })
//     }
// })

module.exports = router