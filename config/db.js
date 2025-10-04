const mongoose = require("mongoose")

const { MONGODB_USERNAME, MONGODB_PASSWORD, MONGODB_NAME } = process.env

const connectDB = () => {
    mongoose.connect(`mongodb+srv://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@cluster0.mlzgbyw.mongodb.net/`, { dbName: MONGODB_NAME })
        .then(() => {
            console.log("MongoDB connected")
        })
        .catch(error => {
            console.error("MongoDB error", error)
        })
}

module.exports = { connectDB }