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


// ── Авто-засичане на пропуснати дни (всеки ден 11:00) ─────────────────────
exports.checkMissingDays = onSchedule(
  { schedule: '0 11 * * *', timeZone: 'Europe/Sofia', region: 'us-central1' },
  async () => {
    const db    = admin.firestore();
    const now   = new Date();
    const sofia = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sofia' }));

    const checkDates = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(sofia);
      d.setDate(sofia.getDate() - i);
      checkDates.push(d.toISOString().slice(0, 10));
    }
    logger.info('checkMissingDays: проверявам дати', { checkDates });

    const shops = ['store1', 'store2'];
    const reportsSnap = await db.collection('daily_reports')
      .where('date', 'in', checkDates)
      .get();

    const closedMap = { store1: new Set(), store2: new Set() };
    reportsSnap.forEach(d => {
      const r = d.data();
      if (r.status === 'closed' && closedMap[r.shopId]) closedMap[r.shopId].add(r.date);
    });

    const alerts = [];
    for (const shopId of shops) {
      const missing = checkDates.filter(d => !closedMap[shopId].has(d));
      if (missing.length) alerts.push({ shopId, missing });
    }

    if (!alerts.length) {
      logger.info('checkMissingDays: всичко е чисто.');
      return;
    }

    // Anti-spam — само веднъж на ден
    const todayYmd  = sofia.toISOString().slice(0, 10);
    const alertKey  = `alert-${todayYmd}`;
    const existing  = await db.collection('missing_days_alerts').doc(alertKey).get();
    if (existing.exists) {
      logger.info('checkMissingDays: вече е пратено за днес, skip.');
      return;
    }

    const ownersSnap = await db.collection('users').where('role', '==', 'owner').get();
    const ownerIds   = ownersSnap.docs.map(d => d.id);

    const managerByShop = {};
    for (const shopId of shops) {
      const mSnap = await db.collection('users').where('role', '==', shopId).get();
      managerByShop[shopId] = mSnap.docs.map(d => d.id);
    }

    for (const alert of alerts) {
      const shopName  = alert.shopId === 'store1' ? 'Магазин 1' : 'Магазин 2';
      const missingFmt = alert.missing
        .map(d => `${d.slice(8, 10)}.${d.slice(5, 7)}`).join(', ');

      const recipientIds = [...new Set([...ownerIds, ...(managerByShop[alert.shopId] || [])])];
      if (!recipientIds.length) continue;

      const allTokens = [];
      for (let i = 0; i < recipientIds.length; i += 10) {
        const chunk = recipientIds.slice(i, i + 10);
        const tSnap = await db.collection('fcmTokens').where('userId', 'in', chunk).get();
        tSnap.forEach(d => { const t = d.data().token; if (t) allTokens.push(t); });
      }
      if (!allTokens.length) {
        logger.warn('checkMissingDays: няма FCM tokens', { shopId: alert.shopId });
        continue;
      }

      const title = `⚠️ Пропуснати дни — ${shopName}`;
      const body  = alert.missing.length === 1
        ? `Не е затворен отчет за ${missingFmt}`
        : `Не са затворени отчети за: ${missingFmt}`;

      try {
        const resp = await admin.messaging().sendEachForMulticast({
          notification: { title, body },
          webpush: {
            fcmOptions: { link: '/' },
            notification: {
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              requireInteraction: true,
              tag: `missing-${alert.shopId}-${todayYmd}`
            }
          },
          tokens: allTokens
        });
        logger.info('checkMissingDays: push изпратен', {
          shopId: alert.shopId,
          success: resp.successCount,
          failure: resp.failureCount,
          missing: alert.missing
        });
      } catch (err) {
        logger.error('checkMissingDays: push грешка', { shopId: alert.shopId, err: String(err) });
      }
    }

    await db.collection('missing_days_alerts').doc(alertKey).set({
      date: todayYmd,
      alerts,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('checkMissingDays: готово', { alertsCount: alerts.length });
  }
);


// ── Месечна справка ───────────────────────────────────────────────────────
async function _calcMonthlyData(year, month) {
  const db      = admin.firestore();
  const mm      = String(month).padStart(2, '0');
  const yy      = String(year);
  const firstDay = `${yy}-${mm}-01`;
  const lastDate = new Date(year, month, 0);
  const lastDay  = `${yy}-${mm}-${String(lastDate.getDate()).padStart(2, '0')}`;

  const [drSnap, recSnap] = await Promise.all([
    db.collection('daily_reports').where('date', '>=', firstDay).where('date', '<=', lastDay).get(),
    db.collection('records').where('date', '>=', firstDay).where('date', '<=', lastDay).get()
  ]);

  const norm     = (s) => String(s ?? '').trim();
  const normLow  = (s) => norm(s).toLowerCase();
  const isSalary = (c) => { const v = normLow(c); return v === 'заплата' || v === 'заплати'; };

  const summary = {
    period: { firstDay, lastDay, year, month },
    totalTurnover: 0, totalCash: 0, totalPos: 0,
    totalStoka: 0, totalSalary: 0, totalOtherExp: 0,
    totalSideInc: 0, totalAdvances: 0, totalLeftForStock: 0,
    netProfit: 0, vatDue: 0, corpTax: 0,
    closedDaysCount: 0, closedDaysByShop: { store1: 0, store2: 0 },
    bestDay: null, worstDay: null,
    perShop: {
      store1: { turnover: 0, stoka: 0, netProfit: 0, closedDays: 0 },
      store2: { turnover: 0, stoka: 0, netProfit: 0, closedDays: 0 }
    }
  };
  const dayTotals = {};

  drSnap.forEach(d => {
    const dr = d.data();
    if (dr.status !== 'closed') return;
    summary.closedDaysCount++;
    if (summary.closedDaysByShop[dr.shopId] !== undefined) summary.closedDaysByShop[dr.shopId]++;

    let cash = 0, pos = 0, stoka = 0, otherExp = 0, sideInc = 0, avans = 0, leftToday = 0;
    (dr.shifts        || []).forEach(sh => { cash += Number(sh.cash || 0); pos += Number(sh.pos || 0); });
    (dr.expensesGoods || []).forEach(g  => stoka   += Number(g.amount || 0));
    (dr.expensesOther || []).forEach(o  => {
      const amt = Number(o.amount || 0);
      if (norm(o.description) === 'Оставени за зареждане') leftToday += amt;
      else otherExp += amt;
    });
    (dr.sideIncomes   || []).forEach(s  => sideInc += Number(s.amount || 0));
    (dr.advances      || []).forEach(a  => avans   += Number(a.amount || 0));

    const turnover = cash + pos;
    summary.totalCash += cash; summary.totalPos += pos; summary.totalTurnover += turnover;
    summary.totalStoka += stoka; summary.totalOtherExp += otherExp;
    summary.totalSideInc += sideInc; summary.totalAdvances += avans;
    summary.totalLeftForStock += leftToday;
    if (summary.perShop[dr.shopId]) {
      summary.perShop[dr.shopId].turnover += turnover;
      summary.perShop[dr.shopId].stoka    += stoka;
      summary.perShop[dr.shopId].closedDays++;
    }
    dayTotals[dr.date] = (dayTotals[dr.date] || 0) + turnover;
  });

  recSnap.forEach(d => {
    const r = d.data();
    if (r.type === 'Разход' && isSalary(r.category)) summary.totalSalary += Number(r.amount || 0);
  });

  summary.netProfit  = summary.totalTurnover + summary.totalSideInc - summary.totalStoka -
                       summary.totalSalary - summary.totalOtherExp - summary.totalAdvances;
  summary.vatDue     = Math.max(0, summary.totalTurnover / 6 - summary.totalStoka / 6);
  const taxNet       = (summary.totalTurnover - summary.totalStoka) / 1.20;
  summary.corpTax    = taxNet > 0 ? taxNet * 0.10 : 0;

  for (const sid of ['store1', 'store2']) {
    const ps = summary.perShop[sid];
    ps.netProfit = ps.turnover - ps.stoka;
  }

  const dayEntries = Object.entries(dayTotals).sort((a, b) => b[1] - a[1]);
  if (dayEntries.length) {
    summary.bestDay  = { date: dayEntries[0][0],                           turnover: dayEntries[0][1] };
    summary.worstDay = { date: dayEntries[dayEntries.length - 1][0], turnover: dayEntries[dayEntries.length - 1][1] };
  }
  return summary;
}

async function _comparePrevMonth(curSummary) {
  const { year, month } = curSummary.period;
  let prevYear = year, prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }
  try {
    const prev = await _calcMonthlyData(prevYear, prevMonth);
    const diff = (cur, p) => ({ abs: cur - p, pct: p !== 0 ? ((cur - p) / p) * 100 : null });
    return {
      prevYear, prevMonth,
      turnover:   diff(curSummary.totalTurnover,    prev.totalTurnover),
      stoka:      diff(curSummary.totalStoka,       prev.totalStoka),
      netProfit:  diff(curSummary.netProfit,        prev.netProfit),
      closedDays: diff(curSummary.closedDaysCount,  prev.closedDaysCount),
      prevTotals: { turnover: prev.totalTurnover, stoka: prev.totalStoka, netProfit: prev.netProfit, closedDays: prev.closedDaysCount }
    };
  } catch (e) { logger.warn('_comparePrevMonth error', e); return null; }
}

async function _saveMonthlyReport(summary, comparison) {
  const { year, month } = summary.period;
  const docId = `${year}-${String(month).padStart(2, '0')}`;
  await admin.firestore().collection('monthly_reports').doc(docId).set({
    ...summary, comparison,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    generated: true
  });
  logger.info('Monthly report saved', { docId, turnover: summary.totalTurnover });
  return docId;
}

exports.generateMonthlyReport = onSchedule(
  { schedule: '0 4 1 * *', timeZone: 'Europe/Sofia', region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const now   = new Date();
    const sofia = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sofia' }));
    let year = sofia.getFullYear(), month = sofia.getMonth();
    if (month === 0) { month = 12; year--; }

    logger.info('generateMonthlyReport: starting', { year, month });
    try {
      const summary    = await _calcMonthlyData(year, month);
      const comparison = await _comparePrevMonth(summary);
      const docId      = await _saveMonthlyReport(summary, comparison);

      const db = admin.firestore();
      const usersSnap  = await db.collection('users').where('role', '==', 'owner').get();
      const ownerIds   = usersSnap.docs.map(d => d.id);
      if (ownerIds.length) {
        const tokSnap = await db.collection('fcmTokens').where('userId', 'in', ownerIds.slice(0, 10)).get();
        const tokens  = tokSnap.docs.map(d => d.data().token).filter(Boolean);
        if (tokens.length) {
          const MONTHS = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
          await admin.messaging().sendEachForMulticast({
            notification: {
              title: `📊 Месечна справка — ${MONTHS[month - 1]} ${year}`,
              body:  `Оборот: ${summary.totalTurnover.toFixed(2)} € | Нетна печалба: ${summary.netProfit.toFixed(2)} €`
            },
            webpush: { fcmOptions: { link: '/' }, notification: { icon: '/icon-192.png', badge: '/icon-192.png' } },
            tokens
          });
        }
      }
      logger.info('generateMonthlyReport: success', { docId });
    } catch (err) {
      logger.error('generateMonthlyReport: FAILED', err);
      throw err;
    }
  }
);

exports.generateMonthlyReportManual = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const db      = admin.firestore();
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only owner can trigger.');
    }
    const inputData = request.data || {};
    let { year, month } = inputData;
    // Клиентът праща { month: "2025-12" } — parse-ваме ако е string
    if (typeof month === 'string' && month.includes('-') && !year) {
      const parts = month.split('-');
      year  = Number(parts[0]);
      month = Number(parts[1]);
    } else {
      year  = Number(year);
      month = Number(month);
    }
    logger.info('generateMonthlyReportManual input:', { year, month, rawData: inputData });
    if (!year || !month || month < 1 || month > 12) {
      throw new HttpsError('invalid-argument', `year and month (1-12) required. Got: year=${year}, month=${month}`);
    }
    try {
      const summary    = await _calcMonthlyData(year, month);
      const comparison = await _comparePrevMonth(summary);
      const docId      = await _saveMonthlyReport(summary, comparison);
      return { success: true, docId, summary };
    } catch (err) {
      logger.error('generateMonthlyReportManual error', err);
      throw new HttpsError('internal', err.message || String(err));
    }
  }
);
