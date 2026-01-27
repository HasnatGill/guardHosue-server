// const axios = require('axios');
// const admin = require("firebase-admin");

// Stubbed Push Notification Service
// This file is temporarily stubbed to prevent crashes while dependencies are missing.

const sendPushNotification = async (playerId, title, message, data = {}) => {
    console.log("---------------------------------------------------");
    console.log("🚧 [STUB] Push Notification (Simulated)");
    console.log(`To Player ID: ${playerId}`);
    console.log(`Title: "${title}"`);
    console.log(`Message: "${message}"`);
    console.log(`Data:`, JSON.stringify(data, null, 2));
    console.log("---------------------------------------------------");

    return { success: true, message: "Stubbed notification sent to console." };
};

module.exports = { sendPushNotification };
