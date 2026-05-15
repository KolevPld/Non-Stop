const functions = require("firebase-functions/v2/https");
const admin     = require("firebase-admin");

admin.initializeApp();

/**
 * Сменя паролата на управителски акаунт.
 * Само Owner (role==="owner") може да я извика.
 * data: { uid: string, newPassword: string }
 */
exports.resetUserPassword = functions.onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "Трябва да сте влезли в системата."
      );
    }

    const callerDoc = await admin.firestore()
      .collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "owner") {
      throw new functions.HttpsError(
        "permission-denied",
        "Само Owner може да сменя пароли на управители."
      );
    }

    const { uid, newPassword } = request.data;
    if (!uid || typeof uid !== "string") {
      throw new functions.HttpsError("invalid-argument", "Липсва uid.");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new functions.HttpsError(
        "invalid-argument",
        "Паролата трябва да е поне 6 символа."
      );
    }

    const targetDoc = await admin.firestore()
      .collection("users").doc(uid).get();
    if (targetDoc.exists && targetDoc.data().role === "owner") {
      throw new functions.HttpsError(
        "permission-denied",
        "Не може да се сменя паролата на Owner акаунт."
      );
    }

    await admin.auth().updateUser(uid, { password: newPassword });
    return { success: true };
  }
);


// ── FCM trigger при ново напомняне ─────────────────────
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');

exports.sendTaskReminders = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Europe/Sofia', region: 'us-central1' },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const sofiaDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sofia' }));
    const ymd = sofiaDate.toISOString().slice(0, 10);
    const hh = String(sofiaDate.getHours()).padStart(2, '0');
    const mm = String(sofiaDate.getMinutes()).padStart(2, '0');
    const hm = `${hh}:${mm}`;

    logger.info('sendTaskReminders tick', { ymd, hm });

    const tasksSnap = await db.collection('tasks')
      .where('reminderDate', '==', ymd)
      .where('reminderTime', '==', hm)
      .get();

    if (tasksSnap.empty) return;

    const tokensSnap = await db.collection('fcmTokens').get();
    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) {
      logger.warn('No FCM tokens registered');
      return;
    }

    for (const taskDoc of tasksSnap.docs) {
      const task = taskDoc.data();
      if (task.done) continue;
      if (task.fcmSentAt) continue;

      const message = {
        notification: {
          title: '📝 Нон Стоп — Бележка',
          body:  task.text || '(без текст)'
        },
        webpush: {
          fcmOptions: { link: '/' },
          notification: {
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            requireInteraction: true
          }
        },
        tokens
      };

      try {
        const resp = await admin.messaging().sendEachForMulticast(message);
        logger.info('FCM sent', { taskId: taskDoc.id, success: resp.successCount, failure: resp.failureCount });

        const invalidTokens = [];
        resp.responses.forEach((r, idx) => {
          if (!r.success && r.error) {
            const errCode = r.error.code || '';
            if (errCode.includes('registration-token-not-registered') || errCode.includes('invalid-argument')) {
              invalidTokens.push(tokens[idx]);
            }
          }
        });
        for (const tok of invalidTokens) {
          const q = await db.collection('fcmTokens').where('token', '==', tok).get();
          q.forEach(d => d.ref.delete());
        }

        await taskDoc.ref.update({ fcmSentAt: admin.firestore.FieldValue.serverTimestamp() });
      } catch (err) {
        logger.error('FCM send error', err);
      }
    }
  }
);

exports.dailyCloseReminder = onSchedule(
  { schedule: '30 23 * * *', timeZone: 'Europe/Sofia', region: 'us-central1' },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const sofia = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sofia' }));
    const ymd = sofia.toISOString().slice(0, 10);

    const reportsSnap = await db.collection('daily_reports')
      .where('date', '==', ymd)
      .get();

    const closedShops = new Set();
    reportsSnap.forEach(d => { if (d.data().status === 'closed') closedShops.add(d.data().shopId); });

    const missing = ['store1', 'store2'].filter(s => !closedShops.has(s));
    if (!missing.length) {
      logger.info('Всички магазини са затворили деня.');
      return;
    }

    const tokensSnap = await db.collection('fcmTokens').get();
    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;

    const shopNames = missing.map(s => s === 'store1' ? 'Магазин 1' : 'Магазин 2').join(', ');
    await admin.messaging().sendEachForMulticast({
      notification: {
        title: '⏰ Нон Стоп — Незатворен ден',
        body:  `${shopNames} не са затворили деня (${ymd})`
      },
      webpush: {
        fcmOptions: { link: '/' },
        notification: { icon: '/icon-192.png', badge: '/icon-192.png' }
      },
      tokens
    });
    logger.info('Daily close reminder sent', { missing });
  }
);
