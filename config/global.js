const Users = require("../models/auth")

const getRandomId = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
const getRandomRef = () => Math.random().toString().slice(2, 11)
const getRandomOrderNo = () => Math.floor(100000 + Math.random() * 900000)

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const cleanObjectValues = (obj) => {
    const invalid = ["", "undefined", "null"];

    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
            key,
            value == null || invalid.includes(String(value).trim())
                ? null
                : value
        ])
    );
};


const hasRole = (user, requiredRoles) => { return user.roles.some(role => requiredRoles.includes(role)); }

const getUser = async (query, res, projection = "-password") => {
    const user = await Users.findOne(query).select(projection).exec()
    if (!user) { return res.status(404).json({ message: "Unauthorized or User not found" }) }
    return user
}

module.exports = { getRandomId, hasRole, getUser, getRandomRef, getRandomOrderNo, generateOTP, cleanObjectValues }