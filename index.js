require("dotenv").config()
const mongoose = require("mongoose")
const express = require("express")
const cors = require("cors")
const morgan = require("morgan")
const http = require("http")
const bodyParser = require("body-parser")
const { connectDB } = require("./config/db")

const auth = require("./router/auth")
const companies = require("./router/companies")
const sites = require("./router/sites")
const users = require("./router/users")
const schedules = require("./router/schedule")

const { APP_URL, APP_URL_1, PORT = 8000 } = process.env

connectDB();

const app = express()

app.use(cors({
    origin: [APP_URL, APP_URL_1],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

app.use(morgan("dev"))
app.use(bodyParser.json())

const server = http.createServer(app)

// ✅ socket.js ka use karo
const { initIO } = require("./socket")
const io = initIO(server, [APP_URL, APP_URL_1])

app.use((req, res, next) => {
    req.io = io
    next()
})

app.get("/", (req, res) => res.send("Server is running"))

app.get("/db-test", (req, res) => {
    const state = mongoose.connection.readyState;

    let status = "DISCONNECTED";
    if (state === 1) status = "CONNECTED";
    else if (state === 2) status = "CONNECTING";
    else if (state === 3) status = "DISCONNECTING";

    res.json({ status, state });
});

app.use("/auth", auth)
app.use("/companies", companies)
app.use("/sites-registered", sites)
app.use("/users", users)
app.use("/schedules", schedules)

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server + Socket.IO running on PORT ${PORT}`)
})
