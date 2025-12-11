let io;

function initIO(server, corsOrigins) {
    const { Server } = require("socket.io"); 
    io = new Server(server, {
        cors: {
            origin: corsOrigins,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            credentials: true
        }
    });

    io.on("connection", (socket) => {
        console.log("⚡ Dashboard Connected:", socket.id);
        
        socket.on("join_guard_room", (uid) => {
            if (uid) {
                socket.join(uid); 
                console.log(`Guard ${uid} joined room ${uid}`);
            }
        });

        socket.on("disconnect", () => console.log("❌ Disconnected:", socket.id));
    });

    return io;
}

function getIO() {
    if (!io) throw new Error("Socket.io not initialized!");
    return io;
}

module.exports = { initIO, getIO };