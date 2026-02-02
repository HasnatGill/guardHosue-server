const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        let serviceAccount;
        const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

        if (saEnv) {
            if (saEnv.trim().startsWith("{")) {
                // If it looks like JSON, parse it
                serviceAccount = JSON.parse(saEnv);
            } else {
                // Otherwise, treat it as a file path relative to the root
                const saPath = path.resolve(__dirname, "..", saEnv);
                serviceAccount = require(saPath);
            }
        } else {
            // Default fallback
            serviceAccount = require("../firebase-service-account.json");
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin initialized successfully.");
    } catch (error) {
        console.error("Firebase Admin initialization failed:", error.message);
    }
}

/**
 * Sends a push notification to a specific device.
 * @param {string} deviceToken - FCM Device Token.
 * @param {string} title - Notification Title.
 * @param {string} body - Notification Body.
 * @param {object} data - Extra data.
 */
const sendPushNotification = async (deviceToken, title, body, data = {}) => {
    if (!deviceToken) {
        console.warn("No device token provided.");
        return;
    }

    const message = {
        notification: { title, body },
        data: {
            ...data,
            click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        token: deviceToken,
    };

    try {
        const response = await admin.messaging().send(message);
        console.log("Push notification sent:", response);
        return response;
    } catch (error) {
        console.error("Error sending push notification:", error);
        throw error;
    }
};

module.exports = {
    sendPushNotification
};
