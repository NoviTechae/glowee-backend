// backend/src/utils/pushNotifications.js
const db = require("../db/knex");

function isExpoPushToken(pushToken) {
  return (
    !!pushToken &&
    (pushToken.startsWith("ExponentPushToken[") || pushToken.startsWith("ExpoPushToken["))
  );
}

async function removePushToken(pushToken) {
  try {
    await db("users").where({ push_token: pushToken }).update({
      push_token: null,
      push_token_updated_at: db.fn.now(),
    });

    console.log("✅ Invalid push token removed from database");
  } catch (error) {
    console.error("❌ Error removing push token:", error);
  }
}

async function sendPushNotification(pushToken, title, body, data = {}) {
  if (!isExpoPushToken(pushToken)) {
    console.log("⚠️ Invalid push token format:", pushToken);
    return null;
  }

  const message = {
    to: pushToken,
    sound: "default",
    title,
    body,
    data,
    badge: 1,
    priority: "high",
    channelId: "default",
  };

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const result = await response.json().catch(() => ({}));

    const ticket = Array.isArray(result?.data) ? result.data[0] : result?.data || result;

    if (ticket?.status === "error") {
      console.error("❌ Push notification error:", ticket?.message || "Unknown Expo push error");

      if (ticket?.details?.error === "DeviceNotRegistered") {
        await removePushToken(pushToken);
      }

      return null;
    }

    console.log("✅ Push notification sent successfully");
    return result;
  } catch (error) {
    console.error("❌ Error sending push notification:", error?.message || error);
    return null;
  }
}

async function sendPushNotifications(messages) {
  try {
    const validMessages = (messages || []).filter((msg) => isExpoPushToken(msg?.to));

    if (!validMessages.length) {
      console.log("⚠️ No valid Expo push tokens found in batch");
      return null;
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validMessages),
    });

    const result = await response.json().catch(() => ({}));

    if (Array.isArray(result?.data)) {
      for (let i = 0; i < result.data.length; i++) {
        const item = result.data[i];
        const originalMessage = validMessages[i];

        if (item?.status === "error") {
          console.error("❌ Batch push error:", item?.message || "Unknown Expo push error");

          if (item?.details?.error === "DeviceNotRegistered" && originalMessage?.to) {
            await removePushToken(originalMessage.to);
          }
        }
      }
    }

    console.log("✅ Batch push notifications sent:", validMessages.length);
    return result;
  } catch (error) {
    console.error("❌ Error sending batch push notifications:", error?.message || error);
    return null;
  }
}

async function notifyUser(userId, title, body, data = {}) {
  try {
    const user = await db("users").where({ id: userId }).select("push_token").first();

    if (!user?.push_token) {
      console.log(`⚠️ No push token for user ${userId}`);
      return null;
    }

    return await sendPushNotification(user.push_token, title, body, data);
  } catch (error) {
    console.error("❌ Error notifying user:", error);
    return null;
  }
}

async function notifyMultipleUsers(userIds, title, body, data = {}) {
  try {
    const users = await db("users")
      .whereIn("id", userIds)
      .whereNotNull("push_token")
      .select("push_token");

    if (!users.length) {
      console.log("⚠️ No users with push tokens found");
      return null;
    }

    const messages = users
      .filter((user) => isExpoPushToken(user.push_token))
      .map((user) => ({
        to: user.push_token,
        sound: "default",
        title,
        body,
        data,
        badge: 1,
        priority: "high",
        channelId: "default",
      }));

    return await sendPushNotifications(messages);
  } catch (error) {
    console.error("❌ Error notifying multiple users:", error);
    return null;
  }
}

module.exports = {
  sendPushNotification,
  sendPushNotifications,
  notifyUser,
  notifyMultipleUsers,
  removePushToken,
};