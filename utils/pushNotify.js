const admin = require("firebase-admin");

const path = require("path");

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        let serviceAccount;
        const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

        if (saEnv) {
            if (saEnv.trim().startsWith("{")) {
                serviceAccount = JSON.parse(saEnv);
            } else {
                // Resolve path relative to project root (parent of utility folder)
                const saPath = path.resolve(__dirname, "..", saEnv);
                serviceAccount = require(saPath);
            }
        } else {
            serviceAccount = require("../firebase-service-account.json");
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin initialized successfully.");
    } catch (error) {
        console.error("Firebase Admin initialization failed. Push notifications will be disabled.", error.message);
    }
}

/**
 * Sends a push notification to a specific device.
 * @param {string} deviceToken - FCM Device Token.
 * @param {string} title - Notification Title.
 * @param {string} body - Notification Body.
 * @param {object} data - Extra data for deep-linking.
 */
const sendPushNotification = async (deviceToken, title, body, data = {}) => {
    if (!deviceToken) {
        console.warn("Push Notification skipped: No device token provided for guard.");
        return;
    }

    console.log(`[PushNotify] Attempting to send notification to token: ${deviceToken.substring(0, 10)}...`);

    const message = {
        notification: { title, body },
        data: { ...data, click_action: "FLUTTER_NOTIFICATION_CLICK", },
        token: deviceToken,
    };

    try {
        const response = await admin.messaging().send(message);
        console.log("[PushNotify] Successfully delivered:", response);
        return response;
    } catch (error) {
        console.error("[PushNotify] CRITICAL DELIVERY FAILURE:");
        console.error(" - Error Code:", error.code);
        console.error(" - Error Message:", error.message);

        if (error.code === 'messaging/registration-token-not-registered') {
            console.error(" - Status: The token is no longer valid or app was uninstalled.");
        } else if (error.code === 'messaging/invalid-argument') {
            console.error(" - Status: Check the payload structure or token format.");
        }

        throw error;
    }
};

module.exports = {
    sendPushNotification
};
