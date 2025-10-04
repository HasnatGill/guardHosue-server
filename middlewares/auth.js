const jwt = require("jsonwebtoken")
const Users = require("../models/auth")

const { JWT_SECRET_KEY } = process.env

const verifyToken = (req, res, next) => {

    const authHeader = req.headers.authorization
    const token = authHeader?.split(" ")[1]
    if (!token) return res.status(401).json({ message: "Access token missing" });

    jwt.verify(token, JWT_SECRET_KEY, async (error, result) => {
        if (!error) {
            req.uid = result.uid
            next()
        } else {
            console.error(error)
            return res.status(401).json({ message: "Unauthorized" })
        }
    })
}

const verifySuperAdmin = (req, res, next) => {

    const token = req.headers.authorization?.split(" ")[1]
    if (!token) return res.status(401).json({ message: "Access token missing" });

    jwt.verify(token, JWT_SECRET_KEY, async (error, result) => {
        if (!error) {
            req.uid = result.uid
            try {
                const user = await Users.findOne({ uid: result.uid, roles: "superAdmin" })
                if (!user) { return res.status(401).json({ message: "Unauthorized or user doesn't have access", isError: true }) }
                req.superAdmin = user
                next()
            } catch (error) {
                console.error(error)
                res.status(500).json({ message: "Error at verifySuperAdmin", isError: true })
            }
        } else {
            console.error(error)
            return res.status(401).json({ message: "Unauthorized" })
        }
    })
}

module.exports = { verifyToken, verifySuperAdmin }