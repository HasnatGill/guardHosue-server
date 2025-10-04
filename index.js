require("dotenv").config()
const express = require("express")
const cors = require("cors")
const morgan = require("morgan")
const http = require("http");
const { Server } = require('socket.io')
const bodyParser = require("body-parser")
const { connectDB } = require("./config/db")

// routes
const auth = require("./router/auth")
const companies = require("./router/companies")
const sites = require("./router/sites")
const users = require("./router/users")
const schedules = require("./router/schedule")

const { APP_URL, APP_URL_1, APP_URL_2, APP_URL_3, PORT = 8000 } = process.env

connectDB();

const app = express()
app.use(cors({
    origin: [APP_URL, APP_URL_1, APP_URL_2, APP_URL_3],
    allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(morgan("dev"))
app.use(bodyParser.json())

// --- HTTP + Socket.IO ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [APP_URL, APP_URL_1, APP_URL_2, APP_URL_3],
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// // Middleware to format query values
const formatQueryValues = (obj) => {
    Object.keys(obj).forEach((key) => {
        if (obj[key] === "null") obj[key] = null;
        else if (obj[key] === "undefined") obj[key] = null;
    });
    return obj;
};

app.use((req, res, next) => {
    req.query = formatQueryValues(req.query);
    req.io = io;
    next();
});


app.get("/", (req, res) => {
    res.send("Server is running")
})

app.use("/auth", auth)
app.use("/companies", companies)
app.use("/sites-registered", sites)
app.use("/users", users)
app.use("/schedules",schedules)

// --- Socket.IO Events ---
io.on("connection", (socket) => {
    console.log("⚡ Dashboard Connected:", socket.id);
    socket.on("disconnect", () => console.log("❌ Disconnected:", socket.id));
});


server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server + Socket.IO running on PORT ${PORT}`)
})