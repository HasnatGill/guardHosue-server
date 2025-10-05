// require("dotenv").config()
// const express = require("express")
// const cors = require("cors")
// const morgan = require("morgan")
// const http = require("http");
// const { Server } = require('socket.io')
// const bodyParser = require("body-parser")
// const { connectDB } = require("./config/db")
// // const { init } = require("./socket");
// // const server = http.createServer(app);
// // const io = init(server); 

// // routes
// const auth = require("./router/auth")
// const companies = require("./router/companies")
// const sites = require("./router/sites")
// const users = require("./router/users")
// const schedules = require("./router/schedule")

// const { APP_URL, APP_URL_1, PORT = 8000 } = process.env

// connectDB();

// const app = express()
// app.use(cors({
//     origin: [APP_URL, APP_URL_1],
//     allowedHeaders: ['Content-Type', 'Authorization']
// }))

// app.use(morgan("dev"))
// app.use(bodyParser.json())

// // // --- HTTP + Socket.IO ---
// const server = http.createServer(app);
// const io = new Server(server, {
//     cors: {
//         origin: [APP_URL, APP_URL_1],
//         methods: ["GET", "POST"],
//         credentials: true
//     }
// });

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // // Middleware to format query values
// const formatQueryValues = (obj) => {
//     Object.keys(obj).forEach((key) => {
//         if (obj[key] === "null") obj[key] = null;
//         else if (obj[key] === "undefined") obj[key] = null;
//     });
//     return obj;
// };

// app.use((req, res, next) => {
//     req.query = formatQueryValues(req.query);
//     req.io = io;
//     next();
// });


// app.get("/", (req, res) => {
//     res.send("Server is running")
// })

// app.use("/auth", auth)
// app.use("/companies", companies)
// app.use("/sites-registered", sites)
// app.use("/users", users)
// app.use("/schedules", schedules)

// // --- Socket.IO Events ---
// io.on("connection", (socket) => {
//     console.log("⚡ Dashboard Connected:", socket.id);
//     socket.on("disconnect", () => console.log("❌ Disconnected:", socket.id));
// });


// server.listen(PORT, "0.0.0.0", () => {
//     console.log(`🚀 Server + Socket.IO running on PORT ${PORT}`)
// })

// module.exports.io = io;
require("dotenv").config()
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
    allowedHeaders: ['Content-Type', 'Authorization']
}))

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

app.use("/auth", auth)
app.use("/companies", companies)
app.use("/sites-registered", sites)
app.use("/users", users)
app.use("/schedules", schedules)

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server + Socket.IO running on PORT ${PORT}`)
})
