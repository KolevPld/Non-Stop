const functions             = require("firebase-functions/v2/https");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin                 = require("firebase-admin");
const { Storage }           = require("@google-cloud/storage");

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


// ── Авто-прехвърляне на начална каса при затваряне на ден ─────
exports.autoCarryStartCash = onDocumentUpdated(
  { document: 'daily_reports/{docId}', region: 'us-central1' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!before || !after) return;

    if (before.status === 'closed' || after.status !== 'closed') {
      logger.info('autoCarryStartCash: не е draft→closed преход, skip', { docId: event.params.docId });
      return;
    }

    const shopId  = after.shopId;
    const date    = after.date;
    const endCash = Number(after.endCash || 0);

    if (!shopId || !date) {
      logger.warn('autoCarryStartCash: липсва shopId/date', { docId: event.params.docId });
      return;
    }

    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    const nextDate = d.toISOString().slice(0, 10);
    const nextDocId = `${shopId}_${nextDate}`;

    const db   = admin.firestore();
    const ref  = db.collection('daily_reports').doc(nextDocId);
    const snap = await ref.get();

    if (snap.exists) {
      const existing = snap.data();
      if (existing.status === 'closed') {
        logger.info('autoCarryStartCash: следващият ден е затворен, skip', { nextDocId });
        return;
      }
      await ref.update({
        startCash: endCash,
        carryFromDate: date,
        carryUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.info('autoCarryStartCash: обновен съществуващ draft', { nextDocId, startCash: endCash });
    } else {
      await ref.set({
        shopId,
        date: nextDate,
        status: 'draft',
        startCash: endCash,
        shifts: [],
        expensesGoods: [],
        expensesOther: [],
        sideIncomes: [],
        advances: [],
        totalCashIncome: 0,
        totalPosIncome: 0,
        totalGoodsExpense: 0,
        totalOtherExpense: 0,
        totalSideIncomes: 0,
        totalAdvances: 0,
        endCash: endCash,
        carryFromDate: date,
        autoCreated: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        carryUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.info('autoCarryStartCash: създаден нов draft', { nextDocId, startCash: endCash });
    }
  }
);

exports.protectStartCash = onDocumentUpdated(
  { document: 'daily_reports/{docId}', region: 'us-central1' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!before || !after) return;

    if (before.status !== 'closed' || after.status !== 'closed') return;

    const startChanged = Number(before.startCash || 0) !== Number(after.startCash || 0);
    const endChanged   = Number(before.endCash || 0)   !== Number(after.endCash || 0);

    if (startChanged || endChanged) {
      logger.warn('protectStartCash: опит за промяна на startCash/endCash на затворен отчет — възстановявам', {
        docId: event.params.docId,
        beforeStart: before.startCash, afterStart: after.startCash,
        beforeEnd: before.endCash, afterEnd: after.endCash
      });
      await event.data.after.ref.update({
        startCash: before.startCash,
        endCash:   before.endCash,
        startCashTamperedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
);


// ── При затваряне на неделя — push към Owner за седмична справка ─
exports.notifyOwnerWeekClosed = onDocumentUpdated(
  { document: 'daily_reports/{docId}', region: 'us-central1' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!before || !after) return;
    if (before.status === 'closed' || after.status !== 'closed') return;

    // Проверяваме дали датата е неделя (UTC)
    const d = new Date(after.date + 'T00:00:00Z');
    if (d.getUTCDay() !== 0) return;

    const db = admin.firestore();
    const usersSnap = await db.collection('users').where('role', '==', 'owner').get();
    const ownerIds = usersSnap.docs.map(u => u.id);
    if (!ownerIds.length) return;

    const tokensSnap = await db.collection('fcmTokens')
      .where('userId', 'in', ownerIds.slice(0, 10)).get();
    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;

    const shopName = after.shopId === 'store1' ? 'Магазин 1' : 'Магазин 2';

    await admin.messaging().sendEachForMulticast({
      notification: {
        title: '📅 Седмична справка',
        body:  `${shopName}: седмицата завърши (${after.date}) — справката е готова.`
      },
      webpush: {
        fcmOptions: { link: '/' },
        notification: { icon: '/icon-192.png', badge: '/icon-192.png' }
      },
      tokens
    });
    logger.info('Week-end notification sent', { shopId: after.shopId, date: after.date });
  }
);


// ── Firestore Backup — ежедневен export към Cloud Storage ─────────────────
const BACKUP_BUCKET    = 'nonstopapp-c30b1-backups';
const BACKUP_KEEP_DAYS = 30;
const PROJECT_ID       = 'nonstopapp-c30b1';

async function firestoreExport(outputUriPrefix) {
  const tokenResp   = await admin.app().options.credential.getAccessToken();
  const accessToken = tokenResp.access_token;

  const url  = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ outputUriPrefix, collectionIds: [] })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Firestore export HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function cleanupOldBackups() {
  try {
    const storage  = new Storage();
    const bucket   = storage.bucket(BACKUP_BUCKET);
    const cutoff   = new Date();
    cutoff.setDate(cutoff.getDate() - BACKUP_KEEP_DAYS);
    const cutoffYmd = cutoff.toISOString().slice(0, 10);

    const [files] = await bucket.getFiles({ prefix: 'firestore-backups/' });
    let deleted = 0;
    for (const file of files) {
      const m = file.name.match(/^firestore-backups\/(\d{4}-\d{2}-\d{2})\//);
      if (!m) continue;
      if (m[1] < cutoffYmd) { await file.delete(); deleted++; }
    }
    logger.info('cleanupOldBackups', { deleted, cutoffYmd });
  } catch (e) {
    logger.warn('cleanupOldBackups failed', e);
  }
}

exports.firestoreBackup = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Europe/Sofia', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const now    = new Date();
    const sofia  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sofia' }));
    const ymd    = sofia.toISOString().slice(0, 10);
    const outUri = `gs://${BACKUP_BUCKET}/firestore-backups/${ymd}`;
    const db     = admin.firestore();

    logger.info('firestoreBackup: starting', { outUri });
    try {
      const op = await firestoreExport(outUri);
      await db.collection('_backups').doc(ymd).set({
        date: ymd, outputUri: outUri, opName: op.name,
        status: 'started',
        startedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await cleanupOldBackups();
      logger.info('firestoreBackup: export started', { ymd, op: op.name });
    } catch (err) {
      logger.error('firestoreBackup: FAILED', err);
      await db.collection('_backups').doc(ymd).set({
        date: ymd, status: 'failed',
        error: String(err.message || err),
        startedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Push до owner-ите при грешка
      try {
        const usersSnap  = await db.collection('users').where('role', '==', 'owner').get();
        const ownerIds   = usersSnap.docs.map(d => d.id);
        if (ownerIds.length) {
          const tokSnap = await db.collection('fcmTokens')
            .where('userId', 'in', ownerIds.slice(0, 10)).get();
          const tokens = tokSnap.docs.map(d => d.data().token).filter(Boolean);
          if (tokens.length) {
            await admin.messaging().sendEachForMulticast({
              notification: {
                title: '🚨 Грешка в backup-а',
                body:  `Firestore backup за ${ymd}: ${String(err.message || err).slice(0, 100)}`
              },
              webpush: {
                fcmOptions: { link: '/' },
                notification: { icon: '/icon-192.png', badge: '/icon-192.png', requireInteraction: true }
              },
              tokens
            });
          }
        }
      } catch (ne) { logger.error('firestoreBackup: notify failed', ne); }

      throw err;
    }
  }
);

exports.triggerBackupNow = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const db      = admin.firestore();
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only owner can trigger backup');
    }

    const now   = new Date();
    const sofia = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sofia' }));
    const ymd   = sofia.toISOString().slice(0, 10);
    const hms   = sofia.toTimeString().slice(0, 8).replace(/:/g, '-');
    const docId  = `manual-${ymd}_${hms}`;
    const outUri = `gs://${BACKUP_BUCKET}/firestore-backups/${docId}`;

    const op = await firestoreExport(outUri);
    await db.collection('_backups').doc(docId).set({
      date: ymd, outputUri: outUri, opName: op.name,
      status: 'started', manual: true,
      triggeredBy: request.auth.uid,
      startedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, outputUri: outUri, opName: op.name };
  }
);
