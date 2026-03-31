// backend/src/utils/pushNotifications.js
const db = require("../db/knex");

/**
 * إرسال push notification عبر Expo Push Service
 */
async function sendPushNotification(pushToken, title, body, data = {}) {
  // Validate token
  if (!pushToken || (!pushToken.startsWith('ExponentPushToken[') && 
                      !pushToken.startsWith('ExpoPushToken['))) {
    console.log('⚠️ Invalid push token format:', pushToken);
    return null;
  }

  const message = {
    to: pushToken,
    sound: 'default',
    title,
    body,
    data,
    badge: 1,
    priority: 'high',
    channelId: 'default',
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    
    if (result.data && result.data[0]) {
      const status = result.data[0].status;
      
      if (status === 'error') {
        console.error('❌ Push notification error:', result.data[0].message);
        
        // إذا كان الـ token غير صالح، احذفه من الـ database
        if (result.data[0].details?.error === 'DeviceNotRegistered') {
          await removePushToken(pushToken);
        }
        
        return null;
      }
      
      console.log('✅ Push notification sent successfully:', status);
      return result;
    }

    return result;
  } catch (error) {
    console.error('❌ Error sending push notification:', error.message);
    return null;
  }
}

/**
 * إرسال push notifications متعددة (Batch)
 */
async function sendPushNotifications(messages) {
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log('✅ Batch push notifications sent:', result.data?.length || 0);
    return result;
  } catch (error) {
    console.error('❌ Error sending batch push notifications:', error);
    return null;
  }
}

/**
 * إرسال إشعار لمستخدم معين
 */
async function notifyUser(userId, title, body, data = {}) {
  try {
    // الحصول على push token من الـ database
    const user = await db('users')
      .where({ id: userId })
      .select('push_token')
      .first();

    if (!user?.push_token) {
      console.log(`⚠️ No push token for user ${userId}`);
      return null;
    }

    return await sendPushNotification(user.push_token, title, body, data);
  } catch (error) {
    console.error('❌ Error notifying user:', error);
    return null;
  }
}

/**
 * إرسال إشعار لعدة مستخدمين
 */
async function notifyMultipleUsers(userIds, title, body, data = {}) {
  try {
    // الحصول على push tokens
    const users = await db('users')
      .whereIn('id', userIds)
      .whereNotNull('push_token')
      .select('push_token');

    if (users.length === 0) {
      console.log('⚠️ No users with push tokens found');
      return null;
    }

    // إنشاء messages للـ batch
    const messages = users.map(user => ({
      to: user.push_token,
      sound: 'default',
      title,
      body,
      data,
      badge: 1,
      priority: 'high',
      channelId: 'default',
    }));

    return await sendPushNotifications(messages);
  } catch (error) {
    console.error('❌ Error notifying multiple users:', error);
    return null;
  }
}

/**
 * حذف push token من الـ database
 */
async function removePushToken(pushToken) {
  try {
    await db('users')
      .where({ push_token: pushToken })
      .update({ 
        push_token: null,
        push_token_updated_at: db.fn.now(),
      });
    
    console.log('✅ Invalid push token removed from database');
  } catch (error) {
    console.error('❌ Error removing push token:', error);
  }
}

module.exports = {
  sendPushNotification,
  sendPushNotifications,
  notifyUser,
  notifyMultipleUsers,
};