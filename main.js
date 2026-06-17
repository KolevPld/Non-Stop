import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  addDoc,
  getDocs,
  getDocsFromServer,
  getDoc,
  getDocFromServer,
  setDoc,
  query,
  orderBy,
  where,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  limit
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging.js";
// --------------------------------------------------
// 🔥 Firebase Config
// --------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyD692ktQboNPavUgo9XiANtaqm-8tUOB6c",
  authDomain: "nonstopapp-c30b1.firebaseapp.com",
  projectId: "nonstopapp-c30b1",
  storageBucket: "nonstopapp-c30b1.firebasestorage.app",
  messagingSenderId: "368870682423",
  appId: "1:368870682423:web:5f0ff3245c07c7796a74b2"
};

const app  = initializeApp(firebaseConfig);

// ── FCM Push Notifications ────────────────────────────
const VAPID_KEY = "BHBy5Ar-JVm7KTaWOxUjMc2qO2yRMklkcSPZyEXNtkBplmGTn6hFDxW4bnzg686LDADtn_Oskvlh0-pF-bAdmBs";
let _messaging = null;
async function initFCM() {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.warn('[FCM] Не се поддържа.');
      return;
    }
    if (Notification.permission !== 'granted') {
      console.log('[FCM] Permission не е granted, пропускам.');
      return;
    }
    // Регистрираме firebase-messaging-sw.js (default scope /)
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('[FCM] SW registered:', reg.scope);

    // Чакаме SW-то реално да стане активен
    if (reg.installing || reg.waiting) {
      await new Promise(resolve => {
        const sw = reg.installing || reg.waiting;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'activated') resolve();
        });
        // safety timeout
        setTimeout(resolve, 5000);
      });
    }
    await navigator.serviceWorker.ready;
    console.log('[FCM] SW активен.');

    _messaging = getMessaging(app);
    const token = await getToken(_messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) {
      console.warn('[FCM] Няма token.');
      return;
    }
    console.log('[FCM] Token:', token.slice(0, 20) + '...');

    if (currentUserId) {
      const tokRef = doc(db, 'fcmTokens', token.slice(0, 60));
      await setDoc(tokRef, {
        token,
        userId: currentUserId,
        userEmail: currentUserEmail || '',
        role: currentUserRole || '',
        ua: navigator.userAgent.slice(0, 200),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // Изтрий остарели токени за същия потребител (различни от текущия).
      // Накопяват се при промяна на браузъра/ОС и причиняват дубликати.
      try {
        const oldSnap = await getDocs(query(collection(db, 'fcmTokens'), where('userId', '==', currentUserId)));
        const toDelete = oldSnap.docs.filter(d => d.data().token !== token);
        await Promise.all(toDelete.map(d => deleteDoc(d.ref)));
        if (toDelete.length) console.log('[FCM] Cleaned up', toDelete.length, 'stale token(s).');
      } catch (e) {
        console.warn('[FCM] Token cleanup failed:', e);
      }

      console.log('[FCM] Token saved to Firestore.');
    }

    onMessage(_messaging, (payload) => {
      console.log('[FCM] Foreground message:', payload);
      const title = payload.notification?.title || '🏪 Нон Стоп';
      // tag идва от Cloud Function data.tag — браузърът замества стара нотификация
      // вместо да показва дубликат
      const tag   = payload.data?.tag || payload.data?.taskId || 'ns-notif';
      const opts  = {
        body: payload.notification?.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        requireInteraction: true,
        tag,
        renotify: false
      };
      showAppNotification(title, opts);
    });
  } catch (err) {
    console.error('[FCM] init error:', err);
  }
}
window.initFCM = initFCM;

const db   = getFirestore(app);
const auth = getAuth(app);

// Offline persistence — важно за слаб интернет в магазина
enableIndexedDbPersistence(db).catch(err => {
  if (err.code !== "failed-precondition" && err.code !== "unimplemented") {
    console.warn("Firestore offline:", err.code);
  }
});
const ADMIN_EMAIL = "kmet.zapaden@gmail.com";

// --------------------------------------------------
// 👤 Email Login / Register
// --------------------------------------------------
window.registerEmail = async function () {
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value?.trim();

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Регистрация успешна!");
  } catch (err) {
    alert("Грешка при регистрация: " + err.message);
    if (document.getElementById("loginEmail")) document.getElementById("loginEmail").value = "";
    if (document.getElementById("loginPassword")) document.getElementById("loginPassword").value = "";
  }
};

window.loginEmail = async function () {
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value?.trim();

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert("Грешка при вход: " + err.message);
    if (document.getElementById("loginEmail")) document.getElementById("loginEmail").value = "";
    if (document.getElementById("loginPassword")) document.getElementById("loginPassword").value = "";
  }
};

window.logout = function () {
  signOut(auth);
};

// --------------------------------------------------
// 🔄 Глобални променливи
// --------------------------------------------------
let records = [];
let _reportsDetailsLoaded = false;
let filteredRecords = [];
let chartRef = null;
let editingId = null;
let uploadedImageUrl = "";
let imageRemoved = false;
window.addEventListener("imageUploaded", e => { uploadedImageUrl = e.detail.url; imageRemoved = false; });
window.addEventListener("imageRemoved",  () => { uploadedImageUrl = ""; imageRemoved = true; });

// --------------------------------------------------
// 🔒 LOCK на стари месеци
// --------------------------------------------------
const LOCK_PAST_MONTHS = true;       // ако искаш да го изключиш -> false
const UNLOCK_CODE = "1234";          // смени кода (пример)

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function isLockedDate(dateStr) {
  if (!LOCK_PAST_MONTHS) return false;
  if (!dateStr || typeof dateStr !== "string") return false;
  return dateStr.slice(0, 7) !== currentMonthKey();
}

function requireUnlockIfLocked(dateStr) {
  if (!isLockedDate(dateStr)) return true;

  const code = prompt("🔒 Записът е от друг месец. Въведи код за отключване:");
  if (code !== UNLOCK_CODE) {
    alert("❌ Грешен код. Операцията е отказана.");
    return false;
  }
  return true;
}

// --------------------------------------------------
// 💰 Форматиране на суми
// --------------------------------------------------
function formatMoney(val) {
  return Number(val || 0).toLocaleString("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " €";
}

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

const statusDiv = document.getElementById("status");

function showStatusMsg(msg, durationMs = 3000) {
  if (!statusDiv) return;
  const prev = statusDiv.textContent;
  statusDiv.textContent = msg;
  setTimeout(() => { statusDiv.textContent = prev; }, durationMs);
}

// --------------------------------------------------
// 👥 Роли — email → role映射 + Firestore override
// --------------------------------------------------
const ROLE_MAP = {
  "kmet.zapaden@gmail.com": "owner",
  "magazin1@nonstop.bg":    "store1",
  "magazin2@nonstop.bg":    "store2"
};

// ── Helper: конвертира Firestore Timestamp / ISO string към дата стринг ──
function tsToYMD(v, len) {
  const n = len || 10;
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, n);
  if (typeof v.toDate === 'function') {
    try { return v.toDate().toISOString().slice(0, n); } catch { return ''; }
  }
  if (v.seconds) {
    try { return new Date(v.seconds * 1000).toISOString().slice(0, n); } catch { return ''; }
  }
  if (v instanceof Date) {
    try { return v.toISOString().slice(0, n); } catch { return ''; }
  }
  return '';
}
window.tsToYMD = tsToYMD;

let currentUserId    = null;
let currentUserEmail = null;
let currentUserRole  = null;

async function getUserRole(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const role = snap.data().role;
      // Firestore винаги има приоритет — включително disabled
      return role || null;
    }
  } catch (e) { /* offline */ }
  // Fallback само ако Firestore документ липсва изцяло
  return ROLE_MAP[user.email] || null;
}

async function ensureUserDoc(user, role) {
  try {
    const ref  = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { email: user.email, role, createdAt: new Date().toISOString() });
    }
  } catch (e) { console.warn("ensureUserDoc:", e); }
}

onAuthStateChanged(auth, async user => {
  const isLoggedIn = !!(user && !user.isAnonymous);

  if (isLoggedIn) {
    currentUserId    = user.uid;
    currentUserEmail = user.email;

    const role      = await getUserRole(user);
    currentUserRole = role;
    initFCM();

    // Блокиран акаунт
    if (role === "disabled") {
      await signOut(auth);
      if (statusDiv) statusDiv.textContent = "⛔ Акаунтът е деактивиран.";
      document.getElementById("loginScreen")?.classList.remove("hidden");
      alert("⛔ Акаунтът е деактивиран. Свържете се с администратора.");
      return;
    }

    await ensureUserDoc(user, role);

    const isAdmin = role === "owner" || user.email === ADMIN_EMAIL;

    if (statusDiv) statusDiv.textContent = `🔓 Влязъл: ${user.email}`;
    document.getElementById("loginScreen")?.classList.add("hidden");

    if (role === "store1" || role === "store2") {
      // ── Управителски изглед ──────────────────────
      document.body.classList.remove("admin");
      document.getElementById("app")?.classList.add("hidden");
      document.getElementById("storeApp")?.classList.remove("hidden");
      document.getElementById("bottomNav")?.classList.add("hidden");
      document.getElementById("logoutArea")?.classList.remove("hidden");
      initDailyReport(role);
      initWorkHours(role);
    } else {
      // ── Собственик/Owner изглед ──────────────────
      document.body.classList.toggle("admin", isAdmin);
      document.getElementById("app")?.classList.remove("hidden");
      document.getElementById("storeApp")?.classList.add("hidden");
      document.getElementById("bottomNav")?.classList.remove("hidden");
      window.showScreen?.("add");
      loadRecords();
    }
  } else {
    currentUserId = currentUserEmail = currentUserRole = null;
    if (statusDiv) statusDiv.textContent = "🔐 Моля, влез с имейл и парола.";
    document.body.classList.remove("admin");

    document.getElementById("loginScreen")?.classList.remove("hidden");
    document.getElementById("app")?.classList.add("hidden");
    document.getElementById("storeApp")?.classList.add("hidden");
    document.getElementById("bottomNav")?.classList.add("hidden");
  }
});

// --------------------------------------------------
// 🔄 Локално обновяване на UI (без Firestore заявка)
// --------------------------------------------------
function refreshUI() {
  const isAdmin = document.body.classList.contains("admin");
  renderRecentList();
  renderRecentTable();
  renderTotalSummaryCards();
  if (isAdmin) {
    _reportsDetailsLoaded = false;
    if (!document.getElementById("reportsDetailsSection")?.classList.contains("hidden")) {
      _renderReportsDetails();
    }
  }
}

// --------------------------------------------------
// 🔥 FIRESTORE: Зареждане
// --------------------------------------------------
async function loadRecords() {
  // Нулираме евентуална редакция при презареждане
  if (editingId) {
    editingId = null;
    imageRemoved = false;
    clearForm();
    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
      submitBtn.onclick = addRecord;
    }
    document.getElementById("cancelEditBtn")?.classList.add("hidden");
  }

  records = [];

  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    records.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (document.body.classList.contains("admin")) {
    renderRecentList(); renderRecentTable();
    _reportsDetailsLoaded = false;
    if (!document.getElementById("reportsDetailsSection")?.classList.contains("hidden")) {
      _renderReportsDetails();
    }
    window.showScreen("add"); document.getElementById("bottomNav")?.classList.remove("hidden");
    renderTotalSummaryCards();
  } else {
    renderRecentList(); renderRecentTable();
    window.showScreen("add"); document.getElementById("bottomNav")?.classList.remove("hidden");
    renderTotalSummaryCards();
  }

  await checkAndCreateMonthlyCarryover();
}

// --------------------------------------------------
// 🔄 Автоматичен пренос на салдо в началото на месеца
// --------------------------------------------------
let _carryoverRunning = false;

async function checkAndCreateMonthlyCarryover() {
  if (_carryoverRunning) return;
  _carryoverRunning = true;

  // Само admin може да създава преносни записи
  if (!document.body.classList.contains("admin")) { _carryoverRunning = false; return; }

  const now = new Date();
  const currentYM   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const firstOfMonth = `${currentYM}-01`;

  try {
    // Ако вече има пренос за текущия месец → нищо
    const alreadyHas = records.some(r =>
      r.category === "Пренос" && (r.date || "").startsWith(currentYM)
    );
    if (alreadyHas) return;

    // Вземи всички записи ПРЕДИ текущия месец
    const prevRecords = records.filter(r => (r.date || "") < firstOfMonth);
    if (!prevRecords.length) return;

    // Изчисли салдата по метод (Кеш / Банка+Карта)
    let kasaKesh = 0, kasaBanka = 0;
    prevRecords.forEach(r => {
      const amount = Number(r.amount || 0);
      if (!Number.isFinite(amount) || amount === 0) return;
      const signed = r.type === "Приход" ? amount : -amount;
      if (normMethod(r.method) === "Кеш") {
        kasaKesh += signed;
      } else {
        kasaBanka += signed;
      }
    });

    kasaKesh  = Math.round(kasaKesh  * 100) / 100;
    kasaBanka = Math.round(kasaBanka * 100) / 100;

    if (kasaKesh === 0 && kasaBanka === 0) return;

    const newRecords = [];

    if (kasaKesh !== 0) {
      const type   = kasaKesh > 0 ? "Приход" : "Разход";
      const amount = Math.abs(kasaKesh);
      const data   = {
        date: firstOfMonth, type, method: "Кеш", amount,
        store: "КасаКеш", category: "Пренос",
        note: "Пренос от предходен месец", imageUrl: ""
      };
      const ref = await addDoc(collection(db, "records"), data);
      newRecords.push({ id: ref.id, ...data });
    }

    if (kasaBanka !== 0) {
      const type   = kasaBanka > 0 ? "Приход" : "Разход";
      const amount = Math.abs(kasaBanka);
      const data   = {
        date: firstOfMonth, type, method: "Банка", amount,
        store: "КасаБанка", category: "Пренос",
        note: "Пренос от предходен месец", imageUrl: ""
      };
      const ref = await addDoc(collection(db, "records"), data);
      newRecords.push({ id: ref.id, ...data });
    }

    if (newRecords.length) {
      newRecords.forEach(r => records.unshift(r));
      records.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      refreshUI();
      showStatusMsg(
        `🔄 Пренос: Кеш ${kasaKesh.toFixed(2)} €  |  Банка ${kasaBanka.toFixed(2)} €`,
        8000
      );
    }
  } catch (err) {
    console.error("Грешка при автоматичен пренос:", err);
  } finally {
    _carryoverRunning = false;
  }
}

// --------------------------------------------------
// 🔥 Добавяне на запис
// --------------------------------------------------
async function addRecord() {
  const date = document.getElementById("date")?.value;
  const type = document.getElementById("type")?.value;
  const method = (document.getElementById("method")?.value || "").split(" ")[0];
  const amount = parseFloat(document.getElementById("amount")?.value);
  const store = document.getElementById("store")?.value;
  const note = (document.getElementById("customNote")?.value || "").trim();

  let category = document.getElementById("category")?.value || "";
  if (category === "custom") {
    category = document.getElementById("customCategory")?.value?.trim() || "";
  }

  if (!date || !type || !method || isNaN(amount) || amount <= 0) {
    return alert("Попълни дата и валидна сума.");
  }
  if (!category) {
    return alert("Въведи категория.");
  }

  const imageUrl = uploadedImageUrl || "";
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const docRef = await addDoc(collection(db, "records"), { date, type, method, amount, note, category, store, imageUrl });
    records.unshift({ id: docRef.id, date, type, method, amount, note, category, store, imageUrl });

    if (OWNER_CATEGORIES.includes(category)) {
      try {
        await syncOwnerRecord(docRef.id, { name: category, amount, note, date, type });
      } catch (ownerErr) {
        console.error("Грешка при запис в Собственици:", ownerErr);
        alert("Записът е запазен, но грешка в Собственици: " + ownerErr.message);
      }
    }

    clearForm();
    refreshUI();
    showStatusMsg("✅ Записано!");
  } catch (err) {
    alert("Грешка при запис: " + err.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

window.addRecord = addRecord;

// --------------------------------------------------
// ✏️ Редактиране (ВАЖНО: отваря формата от Отчети)
// --------------------------------------------------
window.editImage = async function (id) {
  const record = records.find(r => r.id === id);
  if (!record) return;
  if (!requireUnlockIfLocked(record.date)) return;

  editingId = id;
  imageRemoved = false;

  // ✅ Отваряме формата (ако сме в отчети)
  window.showScreen("add");

  // ✅ Скрол след като формата стане видима
  requestAnimationFrame(() => {
    document.getElementById("addForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // Попълване на полетата
  document.getElementById("date") && (document.getElementById("date").value = record.date || "");
  document.getElementById("type") && (document.getElementById("type").value = record.type || "");
  document.getElementById("amount") && (document.getElementById("amount").value = record.amount ?? "");
  document.getElementById("store") && (document.getElementById("store").value = record.store || "");

  // Метод
  const methodSelect = document.getElementById("method");
  if (methodSelect) {
    const exact = [...methodSelect.options].find(o => o.value === record.method);
    if (exact) methodSelect.value = exact.value;
    else {
      const partial = [...methodSelect.options].find(o => (o.value || "").startsWith(record.method || ""));
      if (partial) methodSelect.value = partial.value;
    }
  }

  // Категория
  const catSelect = document.getElementById("category");
  const customCatInput = document.getElementById("customCategory");
  if (catSelect && customCatInput) {
    if ([...catSelect.options].some(o => o.value === record.category)) {
      catSelect.value = record.category;
      customCatInput.classList.add("hidden");
      customCatInput.value = "";
    } else {
      catSelect.value = "custom";
      customCatInput.classList.remove("hidden");
      customCatInput.value = record.category || "";
    }
  }

  // Бележка
  const customNoteInput = document.getElementById("customNote");
  if (customNoteInput) customNoteInput.value = record.note || "";

  // Снимка (ако още я ползваш)
  const imagePreview = document.getElementById("imagePreview");
  if (record.imageUrl) {
    uploadedImageUrl = record.imageUrl;
    if (imagePreview) {
      imagePreview.src = uploadedImageUrl;
      imagePreview.classList.remove("hidden");
    }
  } else {
    uploadedImageUrl = "";
    if (imagePreview) {
      imagePreview.src = "";
      imagePreview.classList.add("hidden");
    }
  }

  // Смени бутона "Добави" -> "Запази"
  const submitBtn = document.getElementById("submitBtn");
  if (!submitBtn) {
    alert("Липсва бутонът за запис (id='submitBtn'). Провери HTML.");
    return;
  }

  submitBtn.innerHTML = "💾 Запази промените";
  submitBtn.onclick = saveEditedRecord;
  document.getElementById("cancelEditBtn")?.classList.remove("hidden");
  document.getElementById("addForm")?.classList.add("editing-mode");
};

// --------------------------------------------------
// 💾 Запазване на редакция
// --------------------------------------------------
async function saveEditedRecord() {
  if (!editingId) return;

  const date = document.getElementById("date")?.value;
  const type = document.getElementById("type")?.value;
  const method = (document.getElementById("method")?.value || "").split(" ")[0];
  const amount = parseFloat(document.getElementById("amount")?.value);
  const store = document.getElementById("store")?.value;
  const note = (document.getElementById("customNote")?.value || "").trim();

  let category = document.getElementById("category")?.value || "";
  if (category === "custom") {
    category = document.getElementById("customCategory")?.value?.trim() || "";
  }

  if (!date || !type || !method || isNaN(amount) || amount <= 0) {
    return alert("Попълни дата и валидна сума.");
  }
  if (!category) {
    return alert("Въведи категория.");
  }

  const old = records.find(r => r.id === editingId);
  if (old && !requireUnlockIfLocked(old.date)) return;

  const finalImageUrl = imageRemoved
    ? ""
    : (uploadedImageUrl || (old?.imageUrl || ""));

  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) submitBtn.disabled = true;

  const savedId = editingId;
  const oldCategory = old?.category || "";

  try {
    await updateDoc(doc(db, "records", savedId), { date, type, method, amount, note, category, store, imageUrl: finalImageUrl });

    const idx = records.findIndex(r => r.id === savedId);
    if (idx !== -1) records[idx] = { ...records[idx], date, type, method, amount, note, category, store, imageUrl: finalImageUrl };

    // Синхронизирай собственици
    if (OWNER_CATEGORIES.includes(category)) {
      await syncOwnerRecord(savedId, { name: category, amount, note, date, type });
    } else if (OWNER_CATEGORIES.includes(oldCategory)) {
      // Категорията е сменена от Митко/Велко → изтрий собственик запис
      await deleteOwnerByLinkedId(savedId);
    }

    editingId = null;
    imageRemoved = false;
    document.getElementById("addForm")?.classList.remove("editing-mode");
    document.getElementById("cancelEditBtn")?.classList.add("hidden");
    clearForm();

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
      submitBtn.onclick = addRecord;
    }

    refreshUI();
    showStatusMsg("✅ Промените са запазени!");
    window.showScreen("add");
  } catch (err) {
    alert("Грешка при запис: " + err.message);
    if (submitBtn) submitBtn.disabled = false;
  }
}

window.saveEditedRecord = saveEditedRecord;

// --------------------------------------------------
// 🗑️ Изтриване
// --------------------------------------------------
async function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec && !requireUnlockIfLocked(rec.date)) return;

  if (!confirm("Сигурен ли си?")) return;

  try {
    await deleteDoc(doc(db, "records", id));
    records = records.filter(r => r.id !== id);
    // Изтрий свързания запис в собственици (ако има)
    await deleteOwnerByLinkedId(id);
    refreshUI();
  } catch (err) {
    alert("Грешка при изтриване: " + err.message);
  }
}
window.deleteRecord = deleteRecord;

// --------------------------------------------------
// 🔗 Синхронизация owners ↔ records
// --------------------------------------------------
const OWNER_CATEGORIES = ["Митко", "Велко"];

async function syncOwnerRecord(recordId, { name, amount, note, date, type }) {
  const month = date.slice(0, 7);
  const data  = { name, amount, note, date, month, type, linkedRecordId: recordId };
  console.log("syncOwnerRecord →", name, amount, date, type);

  // Търси дали вече има запис с този linkedRecordId
  const q = query(collection(db, "owners"), where("linkedRecordId", "==", recordId));
  const snap = await getDocs(q);

  if (snap.empty) {
    const ref = await addDoc(collection(db, "owners"), { ...data, createdAt: new Date().toISOString() });
    console.log("owners: създаден запис", ref.id);
  } else {
    await updateDoc(doc(db, "owners", snap.docs[0].id), data);
    console.log("owners: обновен запис", snap.docs[0].id);
  }
}

async function deleteOwnerByLinkedId(recordId) {
  const q = query(collection(db, "owners"), where("linkedRecordId", "==", recordId));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    await deleteDoc(doc(db, "owners", d.id));
  }
}

// --------------------------------------------------
// 🧹 Изчистване на формата
// --------------------------------------------------
function clearForm() {
  document.getElementById("date") && (document.getElementById("date").value = "");
  document.getElementById("amount") && (document.getElementById("amount").value = "");

  const noteInput = document.getElementById("customNote"); if (noteInput) noteInput.value = "";

  const categoryInput = document.getElementById("customCategory");
  if (categoryInput) { categoryInput.value = ""; categoryInput.classList.add("hidden"); }

  document.getElementById("category") && (document.getElementById("category").value = "Оборот");
  const cn = document.getElementById("customNote"); if (cn) cn.value = "";

  uploadedImageUrl = "";
  imageRemoved = false;
  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview) { imagePreview.src = ""; imagePreview.classList.add("hidden"); }
  document.getElementById("removeImgBtn")?.classList.add("hidden");

  document.getElementById("addForm")?.classList.remove("editing-mode");
}

window.cancelEdit = function () {
  editingId = null;

  clearForm();
  imageRemoved = false;

  document.getElementById("addForm")?.classList.remove("editing-mode");

  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
    submitBtn.onclick = addRecord;
  }

  document.getElementById("cancelEditBtn")?.classList.add("hidden");

  window.showScreen?.("add");
};
// --------------------------------------------------
// 🔄 Филтри
// --------------------------------------------------
// ── Сортиране ─────────────────────────────────────────────────
// Приоритет: Дата DESC → Магазин ASC (М1=1, М2=2, К.Кеш=3, К.Банка=4) → Тип ASC (Приход=1, Разход=2)
function sortRecords(arr) {
  const storeOrder = { "1": 1, "2": 2, "КасаКеш": 3, "КасаБанка": 4 };
  const typeOrder  = { "Приход": 1, "Разход": 2 };
  return arr.slice().sort((a, b) => {
    const dateCmp = (b.date || "").localeCompare(a.date || "");
    if (dateCmp !== 0) return dateCmp;
    const aStore = effectiveStore(a), bStore = effectiveStore(b);
    const storeCmp = (storeOrder[aStore] ?? 9) - (storeOrder[bStore] ?? 9);
    if (storeCmp !== 0) return storeCmp;
    return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
  });
}

// ── Нормализация ─────────────────────────────────────────────
// Единна нормализация на магазин — ползва се навсякъде
function normStore(s) {
  const raw = String(s ?? "").trim();
  const v   = raw.toLowerCase();
  if (v === "1" || v === "м1" || v === "m1" || v.includes("магазин 1")) return "1";
  if (v === "2" || v === "м2" || v === "m2" || v.includes("магазин 2")) return "2";
  if (raw === "КасаКеш"  || v === "касакеш"  || v === "каса кеш")  return "КасаКеш";
  if (raw === "КасаБанка" || v === "касабанка" || v === "каса банка") return "КасаБанка";
  if (v === "каса" || v === "kasa" || v === "cash") return "Каса"; // стари записи
  if (v === "" || v === "null" || v === "undefined") return "";
  return raw;
}

// Ефективен магазин на запис — стара "Каса" се разпределя по метод
function effectiveStore(r) {
  const s = normStore(r.store);
  if (s === "1" || s === "2" || s === "КасаКеш" || s === "КасаБанка") return s;
  // Стара "Каса" или празно → по метод
  return normMethod(r.method) === "Кеш" ? "КасаКеш" : "КасаБанка";
}
function normMethod(m) {
  const v = String(m ?? "").trim().split(/\s+/)[0];
  // Карта и Банка се третират еднакво
  if (v === "Карта") return "Банка";
  return v; // Кеш / Банка
}

// ── Филтри ────────────────────────────────────────────────────
// ВАЖНО: filters обектът е празен — четем DOM при всяко извикване
// защото при зареждане screen-report е hidden и getElementById връща null
const filters = {};

function applyFilters() {
  const type      = document.getElementById("filterType")?.value     ?? "";
  const method    = document.getElementById("filterMethod")?.value   ?? "";
  const category  = document.getElementById("filterCategory")?.value ?? "";
  const startDate = document.getElementById("startDate")?.value      ?? "";
  const endDate   = document.getElementById("endDate")?.value        ?? "";
  const store     = document.getElementById("filterStore")?.value    ?? "";

  filteredRecords = sortRecords(records.filter(r => {
    if (!r) return false;
    const matchType     = !type     || r.type === type;
    const matchMethod   = !method   || normMethod(r.method) === method;
    const matchCategory = !category || (r.category ?? "").trim() === category;
    const matchStart    = !startDate || (r.date ?? "") >= startDate;
    const matchEnd      = !endDate   || (r.date ?? "") <= endDate;
    const matchStore    = !store     || effectiveStore(r) === store;
    return matchType && matchMethod && matchCategory && matchStart && matchEnd && matchStore;
  }));

  renderTable(filteredRecords);
  updateFilterSummary(filteredRecords);
  /* renderChart(); — премахнато */
}

function clearFilters() {
  ["filterType","filterMethod","filterCategory","startDate","endDate","filterStore"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  applyFilters();
}

window.setCurrentMonth = function() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  const sd   = document.getElementById("startDate");
  const ed   = document.getElementById("endDate");
  if (sd) sd.value = `${y}-${m}-01`;
  if (ed) ed.value = `${y}-${m}-${String(last).padStart(2,"0")}`;
  applyFilters();
};

window.applyFilters = applyFilters;
window.clearFilters = clearFilters;

// --------------------------------------------------
// 🏪 Хелпъри за магазин
// --------------------------------------------------
function storeLabel(storeKey) {
  if (storeKey === "1")          return "🏪 М1";
  if (storeKey === "2")          return "🏪 М2";
  if (storeKey === "КасаКеш")    return "💰 К.Кеш";
  if (storeKey === "КасаБанка")  return "🏦 К.Банка";
  return "—";
}

window.filterByStore = function(store) {
  const el = document.getElementById("filterStore");
  if (!el) return;
  el.value = store;
  applyFilters();
};

// --------------------------------------------------
// 📊 Таблици
// --------------------------------------------------
function renderTable(data = sortRecords(records)) {
  const tbody = document.querySelector("#recordsTable tbody");
  if (!tbody) return;

  const isAdmin = document.body.classList.contains("admin");

  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    if (r.category === "Пренос") tr.classList.add("carryover-row");
    if (r.fromDailyReport)       tr.classList.add("record-from-dr");
    tr.innerHTML = `
      <td>${r.date || ""}</td>
      <td style="color:${r.category === "Пренос" ? "var(--blue)" : (r.type === "Приход" ? "#4caf50" : "#f44336")};">${r.type || ""}</td>
      <td class="money">${formatMoney(r.amount)}</td>
      <td>${r.method || ""}</td>
      <td class="store-cell" data-store="${effectiveStore(r)}" onclick="filterByStore(this.dataset.store)" title="Филтрирай по магазин">${storeLabel(effectiveStore(r))}</td>
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>
      <td style="white-space: nowrap;">
        ${r.fromDailyReport && r.dailyReportId
          ? `<button class="btn-icon btn-dr-link" type="button" title="От дневен отчет" onclick="openDrDetailModal('${r.dailyReportId}')">📋</button>`
          : ''}
        ${r.imageUrl
          ? `<button class="btn-icon btn-photo" type="button" title="Снимка" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>`
          : `<span class="muted">—</span>`}
        ${isAdmin
          ? `<button class="btn-icon btn-edit" type="button" title="Редакция" onclick="editImage('${r.id}')">✏️</button>
             <button class="btn-icon btn-del" type="button" title="Изтриване" onclick="deleteRecord('${r.id}')">🗑️</button>`
          : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRecentTable() {
  const tbody = document.querySelector("#recentTable tbody");
  if (!tbody) return;

  const isAdmin = document.body.classList.contains("admin");

  tbody.innerHTML = records.slice(0, 5).map(r => `
    <tr>
      <td>${r.date || ""}</td>
      <td style="color:${r.type === "Приход" ? "#4caf50" : "#f44336"};">${r.type || ""}</td>
      <td class="money">${formatMoney(r.amount)}</td>
      <td>${r.method || ""}</td>
      <td>${storeLabel(effectiveStore(r))}</td>
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>

      <td class="actions">
        <div class="actions-wrap">
          ${
            r.imageUrl
              ? `<button class="btn-icon btn-photo" type="button" title="Снимка" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>`
              : `<span class="muted">—</span>`
          }

          ${
            isAdmin
              ? `<button class="btn-icon btn-edit" type="button" title="Редакция" onclick="editImage('${r.id}')">✏️</button>`
              : ``
          }

          ${
            isAdmin
              ? `<button class="btn-icon btn-del" type="button" title="Изтриване" onclick="deleteRecord('${r.id}')">🗑️</button>`
              : ``
          }
        </div>
      </td>
    </tr>
  `).join("");
}

function updateFilterSummary(data) {
  const el = document.getElementById("filterSummary");
  if (!el) return;
  if (!data.length) { el.style.display = "none"; el.innerHTML = ""; return; }

  let totalInc = 0, totalExp = 0;
  data.forEach(r => {
    const a = Number(r.amount || 0);
    if (r.type === "Приход") totalInc += a; else totalExp += a;
  });

  const net = totalInc - totalExp;
  const f   = n => n.toFixed(2) + " €";
  const cls = n => n >= 0 ? "color:var(--green)" : "color:var(--red)";

  el.style.display = "block";
  el.innerHTML = `<div class="filter-summary-box">
    <div class="fs-header">📊 Резултат — <strong>${data.length}</strong> записа</div>
    <div class="fs-totals">
      <div class="fs-total-item"><span class="fs-label">Приходи</span><span class="fs-value" style="color:var(--green)">${f(totalInc)}</span></div>
      <div class="fs-total-item"><span class="fs-label">Разходи</span><span class="fs-value" style="color:var(--red)">${f(totalExp)}</span></div>
      <div class="fs-total-item"><span class="fs-label">Салдо</span><span class="fs-value" style="${cls(net)};font-size:1.1rem">${f(net)}</span></div>
    </div>
  </div>`;
}

// --------------------------------------------------
// 📈 Обобщения
// --------------------------------------------------

function renderTaxSummary() {
  const tax = document.getElementById("taxSummary");
  if (!tax) return;

  // В ДДС участват САМО:
  //   - Приходи с категория "Оборот"
  //   - Разходи с категория "Стока"
  // В Данък печалба участват И:
  //   - Разходи с категория "Заплати" САМО когато са по БАНКА
  const norm         = (s) => String(s ?? "").trim();
  const normLow      = (s) => norm(s).toLowerCase();
  const isOborot     = (cat) => norm(cat) === "Оборот";
  const isStoka      = (cat) => norm(cat) === "Стока";
  const isZaplata    = (cat) => { const v = normLow(cat); return v === "заплата" || v === "заплати"; };
  const isBankMethod = (m)   => normLow(m).startsWith("банка");

  const sum = (arr) => arr.reduce((s, r) => s + Number(r.amount || 0), 0);

  // Бруто суми за ДДС
  const incGrossVat   = sum(records.filter(r => r.type === "Приход" && isOborot(r.category)));
  const expGrossVat   = sum(records.filter(r => r.type === "Разход" && isStoka(r.category)));

  // Заплати по банка (без ДДС — приспадат се от печалбата директно)
  const expSalaryBank = sum(records.filter(r =>
    r.type === "Разход" && isZaplata(r.category) && isBankMethod(r.method)
  ));

  // ── 1) ДДС (20% → /6 от бруто) ────────────────
  const outputVat = +(incGrossVat / 6).toFixed(2);
  const inputVat  = +(expGrossVat / 6).toFixed(2);
  const vatDue    = +Math.max(0, outputVat - inputVat).toFixed(2);

  // ── 2) Печалба (нето) ─────────────────────────
  // Оборот и Стока → нето = бруто / 1.20
  // Заплати по банка → пълната сума (без ДДС)
  const incNet    = incGrossVat / 1.20;
  const expNet    = expGrossVat / 1.20 + expSalaryBank;
  const profitNet = incNet - expNet;

  const corpTax   = profitNet > 0 ? +(profitNet * 0.10).toFixed(2) : 0;
  const netProfit = +(profitNet - corpTax).toFixed(2);

  const hasSalBank = expSalaryBank > 0;

  tax.innerHTML = `
  <h3><i class="fa-solid fa-file-invoice-dollar"></i> Данъчна справка</h3>
  <table>
    <tr>
      <td>Оборот (бруто):</td>
      <td class="mono">${incGrossVat.toFixed(2)} €</td>
    </tr>
    <tr>
      <td>Стока (бруто):</td>
      <td class="mono">${expGrossVat.toFixed(2)} €</td>
    </tr>
    <tr>
      <td><strong>ДДС (за внасяне):</strong></td>
      <td><strong>${vatDue.toFixed(2)} €</strong></td>
    </tr>
    ${hasSalBank ? `<tr>
      <td>Заплати по банка:</td>
      <td class="mono">${expSalaryBank.toFixed(2)} €</td>
    </tr>` : ""}
    <tr>
      <td><strong>Печалба (без ДДС):</strong></td>
      <td><strong>${profitNet.toFixed(2)} €</strong></td>
    </tr>
    <tr>
      <td><strong>Данък печалба (10%):</strong></td>
      <td><strong>${corpTax.toFixed(2)} €</strong></td>
    </tr>
    <tr>
      <td><strong>👉 Нетна печалба:</strong></td>
      <td><strong style="color:#ffca28;">${netProfit.toFixed(2)} €</strong></td>
    </tr>
  </table>
  <div style="font-size:0.72rem;color:var(--text3);margin-top:10px;">
    * ДДС: само Оборот (приход) и Стока (разход).<br>
    * Данък печалба: Оборот, Стока + Заплати ПО БАНКА (без кеш).<br>
    * Заплати в кеш, Друг приход, Друго, Без ДДС, Пренос — НЕ участват.
  </div>`;
}

// ── Седмична справка ──────────────────────────────────────────────────────
function _ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _wrFormatDate(ymd) {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

function _wrMondayOf(ymd) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const day = dt.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return _ymdLocal(dt);
}

function _wrBuildWeekOptions() {
  const weeks = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let mon = new Date(today);
  const day = mon.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  mon.setDate(mon.getDate() + diff);
  for (let i = 0; i < 12; i++) {
    const monStr = _ymdLocal(mon);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    const sunStr = _ymdLocal(sun);
    weeks.push({ value: monStr, label: `${_wrFormatDate(monStr)} – ${_wrFormatDate(sunStr)}` });
    mon.setDate(mon.getDate() - 7);
  }
  return weeks;
}

function _wrPopulateWeekSelect() {
  const sel = document.getElementById("wrWeekSel");
  if (!sel) return;
  const opts = _wrBuildWeekOptions();
  sel.innerHTML = opts.map((o, i) =>
    `<option value="${o.value}"${i === 0 ? " selected" : ""}>${o.label}</option>`
  ).join("");
}

window.renderWeeklyReport = async function() {
  const shopId = document.getElementById("wrShopSel")?.value;
  const monStr = document.getElementById("wrWeekSel")?.value;
  const wrap = document.getElementById("wrTableWrap");
  if (!wrap) return;
  if (!shopId || !monStr) { wrap.innerHTML = '<div class="tasks-empty">Изберете магазин и седмица.</div>'; return; }

  wrap.innerHTML = '<div class="tasks-empty">Зарежда...</div>';

  const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monStr + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + i);
    days.push(dt.toISOString().slice(0, 10));
  }

  try {
    const snap = await getDocs(
      query(
        collection(db, "daily_reports"),
        where("shopId", "==", shopId),
        where("date", "in", days),
        where("status", "==", "closed")
      )
    );
    const byDate = {};
    snap.forEach(d => { byDate[d.data().date] = d.data(); });

    const fmt = (v) => Number(v || 0) === 0 ? '<span style="color:var(--text3)">—</span>' : `${Number(v || 0).toFixed(2)}`;

    // Изчисляваме "Оставени за зареждане" по дни
    let totalLeftForStock = 0;
    const leftByDay = {};
    days.forEach(ymd => {
      const r = byDate[ymd];
      if (!r) return;
      let left = 0;
      (r.expensesOther || []).forEach(o => {
        if (String(o.description || "").trim() === "Оставени за зареждане") {
          left += Number(o.amount || 0);
        }
      });
      leftByDay[ymd] = left;
      totalLeftForStock += left;
    });

    let totCash = 0, totPos = 0, totGoods = 0, totOther = 0, totSide = 0, totAdv = 0, totShiftPlus = 0, totShiftMinus = 0;

    const rows = days.map((ymd, i) => {
      const r = byDate[ymd];
      if (!r) {
        return `<tr>
          <td class="wr-day-name">${DAY_NAMES[i]}<br><small>${_wrFormatDate(ymd)}</small></td>
          <td colspan="7" style="color:var(--text3);text-align:center;">(няма отчет)</td>
        </tr>`;
      }
      const cash  = Number(r.totalCashIncome  || 0);
      const pos   = Number(r.totalPosIncome   || 0);
      const goods = Number(r.totalGoodsExpense || 0);
      const left  = leftByDay[ymd] || 0;
      const other = Math.max(0, Number(r.totalOtherExpense || 0) - left);
      const side  = Number(r.totalSideIncomes  || 0);
      const adv   = Number(r.totalAdvances     || 0);
      const shiftPlus  = (r.shifts || []).reduce((s, sh) => s + Number(sh.plus  || 0), 0);
      const shiftMinus = (r.shifts || []).reduce((s, sh) => s + Number(sh.minus || 0), 0);
      totCash  += cash;  totPos   += pos;
      totGoods += goods; totOther += other;
      totSide  += side;  totAdv   += adv;
      totShiftPlus += shiftPlus; totShiftMinus += shiftMinus;
      const statusBadge = r.status === "closed"
        ? '<span class="badge-closed" style="font-size:0.65rem;background:var(--green);color:#111;padding:1px 5px;border-radius:4px;">✔</span>'
        : '<span class="badge-draft" style="font-size:0.65rem;background:var(--amber);color:#111;padding:1px 5px;border-radius:4px;">чернова</span>';
      const leftNote = left > 0
        ? ` <span title="Оставени за зареждане: ${left.toFixed(2)} €" style="font-size:0.7rem;color:var(--green);">📦${left.toFixed(2)}</span>`
        : "";
      return `<tr>
        <td class="wr-day-name">${DAY_NAMES[i]}<br><small>${_wrFormatDate(ymd)}</small> ${statusBadge}</td>
        <td>${fmt(cash + pos)}</td>
        <td>${fmt(cash)}</td>
        <td>${fmt(pos)}</td>
        <td>${fmt(goods)}</td>
        <td>${fmt(other)}${leftNote}</td>
        <td>${fmt(side)}</td>
        <td>${fmt(adv)}</td>
      </tr>`;
    }).join("");

    const totalInc = totCash + totPos;
    const totalExp = totGoods + totOther + totAdv;
    const net = totalInc + totSide + totShiftPlus - totShiftMinus - totalExp;

    const totTurnover = totCash + totPos;
    const cashPct = totTurnover > 0 ? (totCash / totTurnover) * 100 : 0;
    const posPct  = totTurnover > 0 ? (totPos  / totTurnover) * 100 : 0;
    const pctBanner = totTurnover > 0
      ? `<div style="padding:8px 12px;color:var(--text3);font-size:.9em;margin-top:6px;">
          💰 Кеш: <strong>${cashPct.toFixed(1)}%</strong> &nbsp;|&nbsp;
          💳 Карта: <strong>${posPct.toFixed(1)}%</strong>
          <span style="margin-left:8px;opacity:.7;">(от общ оборот ${totTurnover.toFixed(2)} €)</span>
        </div>`
      : "";

    const leftBanner = totalLeftForStock > 0
      ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(76,175,80,0.12);border:1px solid rgba(76,175,80,0.4);border-radius:8px;font-size:0.9rem;">
          📦 <strong>Оставени за стока:</strong> ${totalLeftForStock.toFixed(2)} €
          <span style="color:var(--text3);font-size:0.78rem;margin-left:6px;">(не участва в Нетния резултат — остава в касата за следваща седмица)</span>
        </div>`
      : "";

    wrap.innerHTML = `
    <table id="wrTable">
      <thead>
        <tr>
          <th>Ден</th>
          <th>Оборот</th>
          <th>Кеш</th>
          <th>POS</th>
          <th>Стока</th>
          <th>Друг разход</th>
          <th>Стр. приход</th>
          <th>Аванси</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td><strong>Общо</strong></td>
          <td><strong>${totalInc.toFixed(2)}</strong></td>
          <td><strong>${totCash.toFixed(2)}</strong></td>
          <td><strong>${totPos.toFixed(2)}</strong></td>
          <td><strong>${totGoods.toFixed(2)}</strong></td>
          <td><strong>${totOther.toFixed(2)}</strong></td>
          <td><strong>${totSide.toFixed(2)}</strong></td>
          <td><strong>${totAdv.toFixed(2)}</strong></td>
        </tr>
        <tr style="background:rgba(255,202,40,0.08)">
          <td colspan="3"><strong>Нетен резултат за седмицата:</strong></td>
          <td colspan="5"><strong style="color:${net >= 0 ? "var(--green)" : "var(--red)"};">${net.toFixed(2)} €</strong></td>
        </tr>
      </tfoot>
    </table>${leftBanner}${pctBanner}`;
    _wrRenderComparison(shopId, monStr);
  } catch (err) {
    wrap.innerHTML = `<div class="tasks-empty" style="color:var(--red);">Грешка: ${err.message}</div>`;
    console.error("renderWeeklyReport:", err);
  }
};

window.printWeeklyReport = function() {
  const shopSel = document.getElementById('wrShopSel');
  const weekSel = document.getElementById('wrWeekSel');
  const shopTxt = shopSel ? shopSel.options[shopSel.selectedIndex].text.replace(/🏪/g, '').trim() : '';
  const weekTxt = weekSel ? weekSel.options[weekSel.selectedIndex].text.trim() : '';

  const card = document.getElementById('weeklyReportCard');
  let hdr = document.getElementById('wrPrintHeader');
  if (!hdr && card) {
    hdr = document.createElement('div');
    hdr.id = 'wrPrintHeader';
    card.insertBefore(hdr, card.firstChild);
  }
  if (hdr) {
    const now = new Date();
    const gen = now.toLocaleDateString('bg-BG') + ' г., ' + now.toLocaleTimeString('bg-BG');
    hdr.innerHTML =
      '<div class="wr-print-title">Нон Стоп — Седмичен отчет</div>' +
      '<div class="wr-print-meta">' +
        '<span>Магазин: <strong>' + shopTxt + '</strong> &nbsp;&nbsp; Седмица: <strong>' + weekTxt + '</strong></span>' +
        '<span>Генериран: ' + gen + '</span>' +
      '</div>';
  }

  document.body.classList.add('print-weekly');
  const done = function() {
    document.body.classList.remove('print-weekly');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
};

// ── Helper: зарежда обобщени данни за дадена седмица ─────────────────────
async function _wrLoadWeekData(shopId, monStr) {
  const mon  = new Date(monStr + 'T00:00:00Z');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const sunStr = days[6];

  const snap = await getDocs(query(
    collection(db, 'daily_reports'),
    where('shopId', '==', shopId),
    where('date', 'in', days),
    where('status', '==', 'closed')
  ));
  const byDate = {};
  snap.forEach(d => { byDate[d.data().date] = d.data(); });

  const norm = (s) => String(s ?? '').trim();

  let cash = 0, pos = 0, stoka = 0, otherExp = 0, sideInc = 0, avans = 0, leftForStock = 0;
  let totShiftPlus = 0, totShiftMinus = 0;
  Object.values(byDate).forEach(dr => {
    (dr.shifts        || []).forEach(sh => {
      cash += Number(sh.cash || 0); pos += Number(sh.pos || 0);
      totShiftPlus  += Number(sh.plus  || 0);
      totShiftMinus += Number(sh.minus || 0);
    });
    (dr.expensesGoods || []).forEach(g  => stoka   += Number(g.amount || 0));
    (dr.expensesOther || []).forEach(o  => {
      const amt = Number(o.amount || 0);
      if (norm(o.description) === 'Оставени за зареждане') leftForStock += amt;
      else otherExp += amt;
    });
    (dr.sideIncomes   || []).forEach(s  => sideInc += Number(s.amount || 0));
    (dr.advances      || []).forEach(a  => avans   += Number(a.amount || 0));
  });

  const turnover  = r2(cash + pos);
  const netProfit = r2(turnover + sideInc + totShiftPlus - totShiftMinus - stoka - otherExp - avans);
  return {
    turnover, stoka: r2(stoka), netProfit,
    cash: r2(cash), pos: r2(pos), sideInc: r2(sideInc),
    otherExp: r2(otherExp), avans: r2(avans),
    leftForStock: r2(leftForStock), hasData: snap.size > 0
  };
}

// ── Сравнение спрямо миналата седмица ────────────────────────────────────
async function _wrRenderComparison(shopId, monStr) {
  const wrap = document.getElementById('wrCompareWrap');
  if (!wrap) return;
  try {
    const prevMon = new Date(monStr + 'T00:00:00Z');
    prevMon.setUTCDate(prevMon.getUTCDate() - 7);
    const prevMonStr = prevMon.toISOString().slice(0, 10);

    const [cur, prev] = await Promise.all([
      _wrLoadWeekData(shopId, monStr),
      _wrLoadWeekData(shopId, prevMonStr)
    ]);
    if (!cur.hasData && !prev.hasData) { wrap.innerHTML = ''; return; }

    const fmt = (n) => (Number(n) || 0).toFixed(2);
    const fmtDiff = (curVal, prevVal, lowerIsBetter) => {
      const diff = curVal - prevVal;
      const pct  = prevVal !== 0 ? (diff / prevVal) * 100 : (curVal !== 0 ? 100 : 0);
      const good = lowerIsBetter ? diff < 0 : diff > 0;
      const neutral = Math.abs(diff) < 0.01;
      const color = neutral ? 'var(--text3)' : (good ? '#4caf50' : '#f44336');
      const arrow = neutral ? '—' : (diff > 0 ? '▲' : '▼');
      const sign  = diff > 0 ? '+' : '';
      const pctStr = prevVal !== 0 ? `${sign}${pct.toFixed(1)}%` : (curVal !== 0 ? 'нова' : '—');
      return `<span style="color:${color};font-weight:600;">${arrow} ${sign}${fmt(diff)} € (${pctStr})</span>`;
    };

    const prevLabel = `${prevMonStr.slice(8,10)}.${prevMonStr.slice(5,7)}`;
    const card = (label, curVal, prevVal, low) => `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
        <div style="font-size:0.78rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="font-size:1.4rem;font-weight:700;margin:6px 0 4px;">${fmt(curVal)} €</div>
        <div style="font-size:0.82rem;">${fmtDiff(curVal, prevVal, low)}</div>
      </div>`;

    wrap.innerHTML = `
      <div style="margin-top:12px;">
        <div style="font-size:0.85rem;color:var(--text3);margin-bottom:8px;">
          📊 <strong>Сравнение спрямо седмица ${prevLabel}</strong>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
          ${card('Оборот (КЕШ+КАРТА)', cur.turnover,  prev.turnover,  false)}
          ${card('Стока (разход)',      cur.stoka,     prev.stoka,     true)}
          ${card('Нетна печалба',       cur.netProfit, prev.netProfit, false)}
        </div>
      </div>`;
  } catch (err) {
    console.error('_wrRenderComparison:', err);
    wrap.innerHTML = '';
  }
}
window._wrRenderComparison = _wrRenderComparison;

// ── Експорт на седмичната справка в PDF ──────────────────────────────────
let _robotoRegular = null;
let _robotoBold    = null;

async function _loadRobotoFont() {
  if (_robotoRegular && _robotoBold) return;
  const fetchB64 = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Font fetch failed: ' + url);
    const buf   = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  };
  // DejaVu Sans — Unicode TTF с кирилица, работи с jsPDF
  _robotoRegular = await fetchB64('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf');
  _robotoBold    = await fetchB64('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf');
}

window.exportWeeklyPDF = async function() {
  const shopSel = document.getElementById('wrShopSel');
  const weekSel = document.getElementById('wrWeekSel');
  if (!shopSel || !weekSel) { alert('Седмичната справка не е заредена.'); return; }
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) { alert('jsPDF не е заредена.'); return; }
  const { jsPDF } = window.jspdf;

  const shopId   = shopSel.value;
  const monStr   = weekSel.value;
  const shopName = shopId === 'store1' ? 'Магазин 1' : 'Магазин 2';
  if (!monStr) { alert('Изберете седмица.'); return; }

  const mon  = new Date(monStr + 'T00:00:00Z');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const sunStr = days[6];

  try {
    const snap = await getDocs(query(
      collection(db, 'daily_reports'),
      where('shopId', '==', shopId),
      where('date', 'in', days),
      where('status', '==', 'closed')
    ));
    const byDate = {};
    snap.forEach(d => { byDate[d.data().date] = d.data(); });

    const norm     = (s) => String(s ?? '').trim();
    const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const fmt      = (n) => (Number(n) || 0).toFixed(2);

    let leftForStock = 0;
    const rows = days.map(date => {
      const dr = byDate[date];
      let cash = 0, pos = 0, stoka = 0, otherExp = 0, sideInc = 0, avans = 0, leftToday = 0;
      let shiftPlus = 0, shiftMinus = 0;
      if (dr) {
        (dr.shifts || []).forEach(sh => {
          cash += Number(sh.cash || 0); pos += Number(sh.pos || 0);
          shiftPlus  += Number(sh.plus  || 0);
          shiftMinus += Number(sh.minus || 0);
        });
        (dr.expensesGoods || []).forEach(g => stoka += Number(g.amount || 0));
        (dr.expensesOther || []).forEach(o => {
          const amt = Number(o.amount || 0);
          if (norm(o.description) === 'Оставени за зареждане') { leftToday += amt; leftForStock += amt; }
          else otherExp += amt;
        });
        (dr.sideIncomes || []).forEach(s => sideInc += Number(s.amount || 0));
        (dr.advances   || []).forEach(a => avans    += Number(a.amount || 0));
      }
      const total = cash + pos + sideInc + shiftPlus - shiftMinus - stoka - otherExp - avans;
      const d     = new Date(date + 'T00:00:00Z');
      return { date, dayName: dayNames[d.getUTCDay()], cash, pos, stoka, otherExp, sideInc, avans, leftToday, total, hasReport: !!dr };
    });

    const totals = rows.reduce((acc, r) => ({
      cash:     acc.cash + r.cash,     pos:      acc.pos + r.pos,
      stoka:    acc.stoka + r.stoka,   otherExp: acc.otherExp + r.otherExp,
      sideInc:  acc.sideInc + r.sideInc, avans: acc.avans + r.avans,
      total:    acc.total + r.total
    }), { cash:0, pos:0, stoka:0, otherExp:0, sideInc:0, avans:0, total:0 });

    await _loadRobotoFont();

    const pdf  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    pdf.addFileToVFS('DejaVuSans.ttf',      _robotoRegular);
    pdf.addFileToVFS('DejaVuSans-Bold.ttf', _robotoBold);
    pdf.addFont('DejaVuSans.ttf',      'DejaVuSans', 'normal');
    pdf.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
    pdf.setFont('DejaVuSans', 'normal');

    const pageW  = pdf.internal.pageSize.getWidth();
    const pageH  = pdf.internal.pageSize.getHeight();
    const margin = 12;

    // Header
    pdf.setFontSize(16); pdf.setFont('DejaVuSans', 'bold');
    pdf.text('Нон Стоп — Седмичен отчет', margin, 16);
    pdf.setFontSize(11); pdf.setFont('DejaVuSans', 'normal');
    const dispWeek = `${monStr.slice(8,10)}.${monStr.slice(5,7)}.${monStr.slice(0,4)} – ${sunStr.slice(8,10)}.${sunStr.slice(5,7)}.${sunStr.slice(0,4)}`;
    pdf.text(`Магазин: ${shopName}    Седмица: ${dispWeek}`, margin, 23);
    pdf.setFontSize(9);
    pdf.text(`Генериран: ${new Date().toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}`, pageW - margin, 23, { align: 'right' });
    pdf.setDrawColor(180); pdf.line(margin, 27, pageW - margin, 27);

    // Таблица
    const tableBody = rows.map(r => [
      `${r.date.slice(8,10)}.${r.date.slice(5,7)} (${r.dayName})${r.hasReport ? '' : ' *'}`,
      fmt(r.cash + r.pos), fmt(r.cash), fmt(r.pos), fmt(r.stoka), fmt(r.otherExp),
      fmt(r.sideInc), fmt(r.avans), fmt(r.total)
    ]);

    if (typeof pdf.autoTable !== 'function') {
      throw new Error('jspdf-autotable plugin не е зареден');
    }

    pdf.autoTable({
      head: [['Ден', 'Оборот', 'КЕШ', 'КАРТА', 'Стока', 'Други р.', 'Стр. прих.', 'Аванси', 'Общо']],
      body: tableBody,
      foot: [['ОБЩО', fmt(totals.cash + totals.pos), fmt(totals.cash), fmt(totals.pos), fmt(totals.stoka),
              fmt(totals.otherExp), fmt(totals.sideInc), fmt(totals.avans), fmt(totals.total)]],
      startY: 32,
      margin: { left: margin, right: margin },
      styles:      { font: 'DejaVuSans', fontSize: 9, cellPadding: 2.5, halign: 'right' },
      headStyles:  { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles:  { fillColor: [220, 220, 220], textColor: 30, fontStyle: 'bold' },
      columnStyles:{ 0: { halign: 'left' } },
      didParseCell: (data) => {
        if (data.section === 'body' && String(data.row.raw[0] || '').includes('*')) {
          data.cell.styles.textColor = [150, 150, 150];
        }
      }
    });

    let curY = (pdf.lastAutoTable?.finalY ?? 100) + 8;

    // Оставени за стока банер
    if (leftForStock > 0) {
      pdf.setFillColor(232, 245, 233); pdf.setDrawColor(76, 175, 80);
      pdf.rect(margin, curY, pageW - 2 * margin, 10, 'FD');
      pdf.setFontSize(10); pdf.setFont('DejaVuSans', 'bold'); pdf.setTextColor(40);
      pdf.text(`Оставени за стока: ${fmt(leftForStock)} €`, margin + 3, curY + 6.5);
      pdf.setFont('DejaVuSans', 'normal'); pdf.setFontSize(8);
      pdf.text('(не участва в Общото — остава в касата за следваща седмица)', margin + 65, curY + 6.5);
      curY += 14;
    }

    // Бележка за дни без отчет
    if (rows.some(r => !r.hasReport)) {
      pdf.setFontSize(8); pdf.setTextColor(120);
      pdf.text('* дни без затворен отчет', margin, curY);
      curY += 5;
    }

    // Разпределение кеш/карта
    const pdfTotTurnover = totals.cash + totals.pos;
    if (pdfTotTurnover > 0) {
      const pdfCashPct = (totals.cash / pdfTotTurnover) * 100;
      const pdfPosPct  = (totals.pos  / pdfTotTurnover) * 100;
      pdf.setFontSize(9); pdf.setFont('DejaVuSans', 'normal'); pdf.setTextColor(80);
      pdf.text(
        `Разпределение на оборота: Кеш ${pdfCashPct.toFixed(1)}% | Карта ${pdfPosPct.toFixed(1)}%  (общ оборот ${fmt(pdfTotTurnover)} €)`,
        margin, curY
      );
    }

    // Подписи
    const signY = pageH - 25;
    pdf.setDrawColor(100); pdf.setTextColor(80); pdf.setFontSize(9);
    pdf.line(margin, signY, margin + 70, signY);
    pdf.line(pageW - margin - 70, signY, pageW - margin, signY);
    pdf.text('Изготвил (управител)', margin, signY + 5);
    pdf.text('Приел (собственик)', pageW - margin - 70, signY + 5);

    pdf.save(`седмичен_отчет_${shopId}_${monStr}.pdf`);
  } catch (err) {
    console.error('exportWeeklyPDF:', err);
    alert('Грешка при генериране на PDF: ' + (err.message || err));
  }
};

function _wrAutoCheckSunday() {
  const banner = document.getElementById("wrAutoBanner");
  if (!banner) return;
  const todayDay = new Date().getDay();
  if (todayDay === 0) {
    banner.innerHTML = '<div class="wr-auto-banner">📅 Днес е неделя — показана е текущата седмица.</div>';
    renderWeeklyReport();
  } else {
    banner.innerHTML = "";
  }
}

// ── Край на седмична справка ──────────────────────────────────────────────

function renderMethodSummary() {
  const localNormMethod = (m) => String(m ?? "").trim().split(" ")[0];
  const totals = { Кеш: 0, Карта: 0, Банка: 0 };
  let minTime = null, maxTime = null;

  records.forEach((r) => {
    const raw = Number(r.amount || 0);
    if (!Number.isFinite(raw)) return;
    const signed = r.type === "Приход" ? raw : -raw;
    const method = localNormMethod(r.method);
    const dateStr = String(r.date ?? "").trim();
    const dp = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dp) {
      const t = new Date(+dp[1], +dp[2]-1, +dp[3]).getTime();
      if (minTime === null || t < minTime) minTime = t;
      if (maxTime === null || t > maxTime) maxTime = t;
    }
    if (totals.hasOwnProperty(method)) totals[method] += signed;
  });

  const msx = document.getElementById("methodSummaryExtra");
  if (!msx) return;

  const fmt = n => Number(n || 0).toFixed(2) + " €";
  const fmtDate = t => t === null ? "—" : new Date(t).toLocaleDateString("bg-BG");
  const row = (l, v) => `<tr><td>${l}</td><td>${v}</td></tr>`;

  msx.innerHTML = `
    <h3><i class="fa-solid fa-circle-dollar-to-slot"></i> Общи наличности</h3>
    <div class="muted" style="margin:6px 0 10px;">Период: ${fmtDate(minTime)} → ${fmtDate(maxTime)}</div>
    <table>
      ${row("💰 Каса Кеш (салдо):", fmt(totals.Кеш))}
      ${row("🏦 Каса Банка (салдо):", fmt(totals.Банка + totals.Карта))}
    </table>`;
}

// --------------------------------------------------
// 📊 Chart.js
// --------------------------------------------------
function renderChart() {
  const canvas = document.getElementById("chart");
  if (!canvas || typeof Chart === "undefined") return;

  // Ползваме filteredRecords ако има активни филтри, иначе всички records
  const src = filteredRecords.length > 0 ? filteredRecords : records;

  let totalInc = 0, totalExp = 0;
  src.forEach(r => {
    const a = Number(r.amount || 0);
    if (r.type === "Приход") totalInc += a;
    else if (r.type === "Разход") totalExp += a;
  });

  const saldo = totalInc - totalExp;
  const fmt   = n => Number(n).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const total = totalInc + totalExp;
  const incPct = total > 0 ? ((totalInc / total) * 100).toFixed(1) : "0.0";
  const expPct = total > 0 ? ((totalExp / total) * 100).toFixed(1) : "0.0";

  if (chartRef) chartRef.destroy();

  // Plugin за централен текст (салдо)
  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart) {
      const { ctx: c, chartArea: { top, bottom, left, right } } = chart;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#e2e8f0";
      c.font = "bold 11px sans-serif";
      c.fillText("Салдо", cx, cy - 12);
      c.font = "bold 15px sans-serif";
      c.fillStyle = saldo >= 0 ? "#4ade80" : "#f87171";
      c.fillText(fmt(saldo), cx, cy + 6);
      c.restore();
    }
  };

  const ctx = canvas.getContext("2d");
  chartRef = new Chart(ctx, {
    type: "doughnut",
    plugins: [centerTextPlugin],
    data: {
      labels: [`Приходи (${incPct}%)`, `Разходи (${expPct}%)`],
      datasets: [{
        data: [totalInc || 0.001, totalExp || 0.001],
        backgroundColor: ["#4caf50", "#f44336"],
        borderColor: ["#388e3c", "#c62828"],
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        title: {
          display: true,
          text: "Приходи vs Разходи",
          color: "#ffffff",
          font: { size: 14, weight: "bold" },
          padding: { bottom: 10 }
        },
        legend: {
          position: "bottom",
          labels: {
            color: "#ffffff",
            padding: 16,
            font: { size: 13 },
            generateLabels(chart) {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => ({
                text: `${label}  ${fmt(ds.data[i] < 0.01 ? 0 : ds.data[i])}`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.borderColor[i],
                fontColor: "#ffffff",
                color: "#ffffff",
                lineWidth: 1,
                index: i
              }));
            }
          }
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.raw < 0.01 ? 0 : ctx.raw;
              return ` ${fmt(val)}`;
            }
          }
        }
      }
    }
  });
}

// --------------------------------------------------
// 🗒️ Бележки и категории
// --------------------------------------------------
function toggleCustomNote() { /* бележката е просто текстово поле */ }
window.toggleCustomNote = toggleCustomNote;

function saveCustomNote(note) {}
function updateNoteOptions() {}

function toggleCustomCategory() {
  const select = document.getElementById("category");
  const input = document.getElementById("customCategory");
  if (!select || !input) return;

  if (select.value === "custom") {
    input.classList.remove("hidden");
    input.focus();
  } else {
    input.classList.add("hidden");
    input.value = "";
  }
}
window.toggleCustomCategory = toggleCustomCategory;


// ════════════════════════════════════════════════
// 🆕 НОВИ ФУНКЦИИ — редизайн 2026-03
// ════════════════════════════════════════════════

// ── Reports details — lazy render + toggle ────────────────────
function _renderReportsDetails() {
  renderStoreComparison();
  renderMethodSummary();
  renderTaxSummary();
  applyFilters();
  _reportsDetailsLoaded = true;
}

window.toggleReportsDetails = function() {
  const section = document.getElementById("reportsDetailsSection");
  const btn     = document.getElementById("reportsDetailsBtn");
  if (!section || !btn) return;
  const opening = section.classList.contains("hidden");
  if (opening) {
    section.classList.remove("hidden");
    if (!_reportsDetailsLoaded) _renderReportsDetails();
    btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Скрий детайли';
  } else {
    section.classList.add("hidden");
    btn.innerHTML = '<i class="fa-solid fa-chevron-down"></i> Покажи детайли';
  }
};

// ── showScreen — единна функция (add / report / notes) ────────
window.showScreen = function(screen) {
  if (_recentReportsUnsub) { _recentReportsUnsub(); _recentReportsUnsub = null; }
  if (_ownerReportsUnsub)  { _ownerReportsUnsub();  _ownerReportsUnsub  = null; }

  const addScreen      = document.getElementById("screen-add");
  const reportScreen   = document.getElementById("screen-report");
  const notesScreen    = document.getElementById("screen-notes");
  const ownersScreen   = document.getElementById("screen-owners");
  const accountsScreen = document.getElementById("screen-accounts");
  const drScreen       = document.getElementById("screen-dailyreports");
  const whScreen       = document.getElementById("screen-workhours");
  const isAdmin        = document.body.classList.contains("admin");

  addScreen?.classList.add("hidden");
  reportScreen?.classList.add("hidden");
  notesScreen?.classList.add("hidden");
  ownersScreen?.classList.add("hidden");
  accountsScreen?.classList.add("hidden");
  drScreen?.classList.add("hidden");
  whScreen?.classList.add("hidden");
  document.getElementById("screen-salaries")?.classList.add("hidden");

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  if (screen === "report") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    reportScreen?.classList.remove("hidden");
    document.getElementById('navReports')?.classList.add('active');
    _wrPopulateWeekSelect(); renderWeeklyReport(); _wrAutoCheckSunday();
    _mrPopulateMonthSelect(); loadMonthlyReport();
    if (!document.getElementById("reportsDetailsSection")?.classList.contains("hidden")) {
      _renderReportsDetails();
    }

  } else if (screen === "notes") {
    notesScreen?.classList.remove("hidden");
    document.getElementById('navNotes')?.classList.add('active');
    loadTasksRealtime();
    renderTasks();
    checkNotifStatus();

  } else if (screen === "owners") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    ownersScreen?.classList.remove("hidden");
    document.getElementById('navOwners')?.classList.add('active');
    loadOwnersForMonth();

  } else if (screen === "accounts") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    accountsScreen?.classList.remove("hidden");
    document.getElementById('navAccounts')?.classList.add('active');
    renderAccountsList();
    loadLastBackupStatus();

  } else if (screen === "dailyreports") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    drScreen?.classList.remove("hidden");
    document.getElementById('navDailyReports')?.classList.add('active');
    loadDailyReportsScreen();

  } else if (screen === "workhours") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    whScreen?.classList.remove("hidden");
    document.getElementById('navWorkHours')?.classList.add('active');
    loadWageScreen();

  } else if (screen === "salaries") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    const salScreen = document.getElementById("screen-salaries");
    salScreen?.classList.remove("hidden");
    document.getElementById('navSalaries')?.classList.add('active');
    loadSalaryHistoryScreen();

  } else {
    addScreen?.classList.remove("hidden");
    document.getElementById('navAdd')?.classList.add('active');
    renderRecentList(); renderRecentTable();
  }
};

// ── renderRecentList — card-based списък ─────────────────────
function renderRecentList() {
  const container = document.getElementById("recentList");
  if (!container) return;
  const isAdmin = document.body.classList.contains("admin");

  if (!records.length) {
    container.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:0.875rem;">Няма записи</div>`;
    return;
  }

  container.innerHTML = sortRecords(records).slice(0, 10).map(r => {
    const isIncome = r.type === "Приход";
    const sign = isIncome ? "+" : "−";
    const cls  = isIncome ? "income" : "expense";
    const drBtn = r.fromDailyReport && r.dailyReportId
      ? `<button class="btn-icon btn-dr-link" onclick="openDrDetailModal('${r.dailyReportId}')" title="От дневен отчет">📋</button>`
      : '';
    const adminBtns = isAdmin
      ? `<div class="record-actions">
          ${drBtn}
          ${r.imageUrl ? `<button class="btn-icon btn-photo" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>` : ''}
          <button class="btn-icon btn-edit" onclick="editImage('${r.id}')">✏️</button>
          <button class="btn-icon btn-del"  onclick="deleteRecord('${r.id}')">🗑️</button>
         </div>`
      : `${drBtn}${r.imageUrl ? `<button class="btn-icon btn-photo" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>` : ''}`;

    return `
      <div class="record-row${r.fromDailyReport ? ' record-from-dr' : ''}">
        <span class="record-type-dot ${cls}"></span>
        <div class="record-meta">
          <span class="record-date">${r.date || ''} · ${r.method || ''}</span>
          <span class="record-name">${r.category || ''}${r.note ? ' · ' + r.note : ''}</span>
          <span class="record-sub">${storeLabel(effectiveStore(r))}</span>
        </div>
        <div class="record-right">
          <span class="record-amount ${cls}">${sign}${formatMoney(r.amount)}</span>
          ${adminBtns}
        </div>
      </div>`;
  }).join('');
}

// ── renderTotalSummaryCards — 4 stat карти ────────────────────
function renderTotalSummaryCards() {
  const el = document.getElementById("totalSummary");
  if (!el) return;

  const today        = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  let todayInc = 0, todayExp = 0, monthInc = 0, monthExp = 0;

  records.forEach(({ date, type, amount }) => {
    const a = Number(amount || 0);
    const isInc = type === "Приход";
    if (date === today)                        { if (isInc) todayInc += a; else todayExp += a; }
    if ((date || "").startsWith(currentMonth)) { if (isInc) monthInc += a; else monthExp += a; }
  });

  const todaySaldo = todayInc - todayExp;
  const monthSaldo = monthInc - monthExp;
  const f = n => n.toFixed(2) + " €";

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Днес приход</div>
        <div class="stat-value green">${f(todayInc)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Днес салдо</div>
        <div class="stat-value ${todaySaldo >= 0 ? 'green' : 'red'}">${f(todaySaldo)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Месец приход</div>
        <div class="stat-value">${f(monthInc)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Месец салдо</div>
        <div class="stat-value ${monthSaldo >= 0 ? 'green' : 'red'}">${f(monthSaldo)}</div>
      </div>
    </div>`;
}

// ── renderLiveBalance → renderStoreComparison ─────────────────
function renderLiveBalance() { renderStoreComparison(); }

function renderStoreComparison() {
  const el = document.getElementById("liveBalance");
  if (!el) return;

  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const toDate = (iso) => {
    const p = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return p ? new Date(+p[1], +p[2]-1, +p[3]) : null;
  };

  // По магазин (само М1 и М2)
  const m = { "1": { inc:0, exp:0 }, "2": { inc:0, exp:0 } };
  // Каса Кеш = ВСИЧКИ Кеш транзакции (М1 + М2 + стара Каса)
  // Каса Банка = ВСИЧКИ Карта/Банка транзакции
  let kkInc=0, kkExp=0, kbInc=0, kbExp=0;
  // Истинско общо (без двойно броене)
  let tI=0, tE=0;

  records.forEach(r => {
    const amount = Number(r.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = toDate(r.date);
    if (!d || d < monthStart || d >= nextMonth) return;
    const store  = normStore(r.store);
    const isInc  = r.type === "Приход";
    const isKesh = normMethod(r.method) === "Кеш";

    // Общо (всеки запис се брои веднъж)
    if (isInc) tI += amount; else tE += amount;

    // По магазин (само М1, М2)
    if (store === "1" || store === "2") {
      if (isInc) m[store].inc += amount; else m[store].exp += amount;
    }

    // Каса Кеш / Каса Банка = по метод, от ВСИЧКИ магазини
    if (isKesh) {
      if (isInc) kkInc += amount; else kkExp += amount;
    } else {
      if (isInc) kbInc += amount; else kbExp += amount;
    }
  });

  const s1  = m["1"].inc - m["1"].exp;
  const s2  = m["2"].inc - m["2"].exp;
  const kkS = kkInc - kkExp;
  const kbS = kbInc - kbExp;
  const tS  = tI - tE;

  const f   = n => n.toFixed(2) + " €";
  const cls = n => n >= 0 ? "pos" : "neg";
  const th  = s => `<th class="sc-th">${s}</th>`;
  const td2 = (v, c) => `<td class="sc-val"><span class="sc-num ${c}">${f(v)}</span></td>`;
  const tdB = (v, c) => `<td class="sc-val"><span class="sc-num-lg ${c}">${f(v)}</span></td>`;

  const mkCard = (title, inc, exp, sal) => `
    <div class="sc-card">
      <div class="sc-card-title">${title}</div>
      <div class="sc-card-row"><span class="sc-card-label">Приходи</span><span class="sc-num pos">${f(inc)}</span></div>
      <div class="sc-card-row"><span class="sc-card-label">Разходи</span><span class="sc-num neg">${f(exp)}</span></div>
      <div class="sc-card-row sc-card-saldo"><span class="sc-card-label"><strong>Салдо</strong></span><span class="sc-num-xl ${cls(sal)}">${f(sal)}</span></div>
    </div>`;

  el.innerHTML = `
    <h3><i class="fa-solid fa-scale-balanced"></i> Сравнение — текущ месец</h3>

    <!-- Таблица (десктоп/таблет) -->
    <table class="sc-table">
      <thead>
        <tr>
          <th class="sc-label-th"></th>
          ${th("🏪 М1")}${th("🏪 М2")}${th("💰 Каса Кеш")}${th("🏦 Каса Банка")}${th("📊 Общо")}
        </tr>
      </thead>
      <tbody>
        <tr class="sc-row">
          <td class="sc-label">Приходи</td>
          ${td2(m["1"].inc,"pos")}${td2(m["2"].inc,"pos")}${td2(kkInc,"pos")}${td2(kbInc,"pos")}
          <td class="sc-val"><span class="sc-num-lg pos">${f(tI)}</span></td>
        </tr>
        <tr class="sc-row">
          <td class="sc-label">Разходи</td>
          ${td2(m["1"].exp,"neg")}${td2(m["2"].exp,"neg")}${td2(kkExp,"neg")}${td2(kbExp,"neg")}
          <td class="sc-val"><span class="sc-num-lg neg">${f(tE)}</span></td>
        </tr>
        <tr class="sc-row sc-saldo">
          <td class="sc-label"><strong>Салдо</strong></td>
          ${tdB(s1,cls(s1))}${tdB(s2,cls(s2))}${tdB(kkS,cls(kkS))}${tdB(kbS,cls(kbS))}
          <td class="sc-val"><span class="sc-num-xl ${cls(tS)}">${f(tS)}</span></td>
        </tr>
      </tbody>
    </table>

    <!-- Карти (мобилен изглед) -->
    <div class="sc-cards">
      ${mkCard("🏪 М1",         m["1"].inc, m["1"].exp, s1)}
      ${mkCard("🏪 М2",         m["2"].inc, m["2"].exp, s2)}
      ${mkCard("💰 Каса Кеш",   kkInc,      kkExp,      kkS)}
      ${mkCard("🏦 Каса Банка", kbInc,      kbExp,      kbS)}
      ${mkCard("📊 Общо",       tI,         tE,         tS)}
    </div>`;
}

// ── Accordion: Наличности & Данъчна справка ───────────────────
window.toggleFinancePanel = function() {
  const panel = document.getElementById("financePanel");
  const arrow = document.getElementById("financeArrow");
  if (!panel) return;
  const hidden = panel.classList.toggle("hidden");
  if (arrow) arrow.textContent = hidden ? "▾" : "▴";
};

// ── syncPills ─────────────────────────────────────────────────
window.syncPills = function() {
  ['method','store'].forEach(id => {
    const val = document.getElementById(id)?.value;
    if (!val) return;
    document.querySelectorAll(`#${id}Pills .pill-btn`).forEach(b => {
      b.classList.toggle('active', b.dataset.val === val);
    });
  });
};

// ── Бележки — Firebase realtime sync ─────────────────────────
const tasksCol = collection(db, "tasks");
let _tasks      = [];
let _tasksUnsub = null;
let _expandedTasks  = new Set();  // ID-та на разгънати бележки
let _newChecklist   = [];         // [{id, text}] за формата

// ── loadTasksRealtime ─────────────────────────────────────────
function loadTasksRealtime() {
  if (_tasksUnsub) return;
  const q = query(tasksCol, orderBy("createdAt", "desc"));
  _tasksUnsub = onSnapshot(q, snap => {
    _tasks = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    renderTasks();
    scheduleTaskReminders();
  }, err => console.error("tasks snapshot:", err));
}

// ── Checklist builder (форма) ─────────────────────────────────
window.addChecklistField = function() {
  _newChecklist.push({ id: Date.now(), text: '' });
  renderChecklistBuilder();
};
window.removeChecklistField = function(id) {
  _newChecklist = _newChecklist.filter(i => i.id !== id);
  renderChecklistBuilder();
};
window.updateChecklistField = function(id, text) {
  const item = _newChecklist.find(i => i.id === id);
  if (item) item.text = text;
};
function renderChecklistBuilder() {
  const el = document.getElementById('taskChecklistBuilder');
  if (!el) return;
  el.innerHTML = _newChecklist.map(item => `
    <div class="checklist-field-row">
      <input type="text" class="checklist-input" placeholder="Подзадача..."
             oninput="updateChecklistField(${item.id},this.value)">
      <button type="button" class="btn-icon btn-del" onclick="removeChecklistField(${item.id})">✕</button>
    </div>`).join('');
}

// ── addTask ───────────────────────────────────────────────────
window.addTask = async function() {
  const inp  = document.getElementById('taskInput');
  const prio = document.getElementById('taskPriority');
  const due  = document.getElementById('taskDueDate');
  const remD = document.getElementById('taskReminderDate');
  const remT = document.getElementById('taskReminderTime');
  const text = (inp?.value || '').trim();
  if (!text) { inp?.focus(); return; }

  // Прочитаме стойностите ПРЕДИ да изчистваме формата
  const dueDateVal      = due?.value   || null;
  const reminderDateVal = remD?.value  || null;
  const reminderTimeVal = remT?.value  || null;
  const priorityVal     = prio?.value  || 'normal';

  const checklist = _newChecklist
    .filter(i => i.text.trim())
    .map(i => ({ id: String(Date.now() + Math.random()), text: i.text.trim(), done: false }));

  // Директно от DOM ПРЕДИ reset — трябва да видим правилните стойности
  console.log("📋 addTask стойности ПРЕДИ reset:");
  console.log("  dueDate el value:      ", document.getElementById('taskDueDate')?.value);
  console.log("  reminderDate el value: ", document.getElementById('taskReminderDate')?.value);
  console.log("  reminderTime el value: ", document.getElementById('taskReminderTime')?.value);
  console.log("📦 Записани константи:", { dueDateVal, reminderDateVal, reminderTimeVal });

  // Reset form
  inp.value = '';
  if (due)  due.value  = '';
  if (remD) remD.value = '';
  if (remT) remT.value = '';
  _newChecklist = [];
  renderChecklistBuilder();
  inp.focus();

  try {
    await addDoc(tasksCol, {
      text,
      priority:     priorityVal,
      dueDate:      dueDateVal,
      reminderDate: reminderDateVal,
      reminderTime: reminderTimeVal,
      checklist,
      done: false,
      createdAt: Date.now(),
      created: new Date().toLocaleDateString('bg-BG', { day:'2-digit', month:'2-digit', year:'numeric' })
    });
  } catch(e) { console.error("addTask:", e); }
};

// ── toggleTask / deleteTask ───────────────────────────────────
window.toggleTask = async function(firestoreId) {
  const task = _tasks.find(t => t.firestoreId === firestoreId);
  if (!task) return;
  try { await updateDoc(doc(db, "tasks", firestoreId), { done: !task.done }); }
  catch(e) { console.error("toggleTask:", e); }
};

window.deleteTask = async function(firestoreId) {
  try { await deleteDoc(doc(db, "tasks", firestoreId)); }
  catch(e) { console.error("deleteTask:", e); }
};

// ── toggleChecklistItem ───────────────────────────────────────
window.toggleChecklistItem = async function(taskId, itemId) {
  const task = _tasks.find(t => t.firestoreId === taskId);
  if (!task) return;
  const checklist = (task.checklist || []).map(c =>
    c.id === itemId ? { ...c, done: !c.done } : c
  );
  try { await updateDoc(doc(db, "tasks", taskId), { checklist }); }
  catch(e) { console.error("toggleChecklistItem:", e); }
};

// ── toggleTaskExpand ──────────────────────────────────────────
window.toggleTaskExpand = function(id) {
  if (_expandedTasks.has(id)) _expandedTasks.delete(id);
  else _expandedTasks.add(id);
  renderTasks();
};

// ── renderTasks ───────────────────────────────────────────────
function renderTasks() {
  const el    = document.getElementById('taskList');
  const badge = document.getElementById('taskCount');
  if (!el) return;

  const pending = _tasks.filter(t => !t.done).length;
  if (badge) { badge.textContent = pending; badge.className = 'task-badge' + (pending ? '' : ' zero'); }

  if (!_tasks.length) {
    el.innerHTML = '<div class="tasks-empty">Няма бележки — добави първата 👆</div>';
    return;
  }

  // Приоритет: Важно(1) > Нормално(2) > Ниско(3); завършени накрая
  const prioOrder = { high:1, urgent:1, normal:2, low:3, info:3 };
  const dotCls    = { high:'high', urgent:'high', normal:'normal', low:'low', info:'low' };
  const esc       = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const today     = new Date().toISOString().slice(0, 10);

  const sorted = [..._tasks].sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    return (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);
  });

  el.innerHTML = sorted.map(t => {
    const expanded  = _expandedTasks.has(t.firestoreId);
    const checklist = t.checklist || [];
    const clDone    = checklist.filter(c => c.done).length;
    const isOverdue = t.dueDate && t.dueDate < today && !t.done;
    const hasRemind = t.reminderDate && t.reminderTime;

    const clHtml = checklist.length ? `
      <div class="task-checklist${expanded ? '' : ' hidden'}" id="cl-${t.firestoreId}">
        ${checklist.map(c => `
          <div class="task-cl-item${c.done ? ' done' : ''}">
            <div class="task-check small" onclick="toggleChecklistItem('${t.firestoreId}','${c.id}')">${c.done ? '✓' : ''}</div>
            <span class="task-cl-text">${esc(c.text)}</span>
          </div>`).join('')}
      </div>
      <button class="task-expand-btn" onclick="toggleTaskExpand('${t.firestoreId}')">
        ${expanded ? '▲ Скрий' : `▼ ${checklist.length} подзадачи (${clDone}/${checklist.length})`}
      </button>` : '';

    return `
      <div class="task-item${t.done ? ' done' : ''}">
        <div class="task-row-main">
          <div class="task-check" onclick="toggleTask('${t.firestoreId}')">${t.done ? '✓' : ''}</div>
          <span class="task-priority-dot ${dotCls[t.priority] || 'normal'}"></span>
          <div class="task-body">
            <div class="task-text">${esc(t.text)}</div>
            <div class="task-meta">
              ${t.dueDate  ? `<span class="task-due${isOverdue ? ' overdue' : ''}">📅 до ${t.dueDate}</span>` : ''}
              ${hasRemind  ? `<span class="task-reminder">🔔 ${t.reminderDate} ${t.reminderTime}</span>` : ''}
              ${t.created  ? `<span class="task-created">добавено: ${t.created}</span>` : ''}
            </div>
          </div>
          <button class="task-del btn-icon" onclick="deleteTask('${t.firestoreId}')">🗑️</button>
        </div>
        ${clHtml}
      </div>`;
  }).join('');
}

// ── Helper: изпраща нотификация през Service Worker (за мобилни) ──
async function showAppNotification(title, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch (e) {
    console.warn('SW showNotification failed, fallback:', e);
  }
  try { new Notification(title, options); return true; }
  catch (e) { console.error('Notification failed:', e); return false; }
}

// ── Напомняния: само FCM (Cloud Function sendTaskReminders) ───
// Client-side polling премахнат — дублираше нотификациите.
// scheduleTaskReminders остава no-op за обратна съвместимост.
function scheduleTaskReminders() {}

// ── Тест: изпрати известие за първата бележка с напомняне ────
window.testTaskReminder = function() {
  if (!('Notification' in window)) { alert('Браузърът не поддържа известия.'); return; }
  if (Notification.permission !== 'granted') {
    alert('Известията не са разрешени. Включи ги от превключвателя по-горе.'); return;
  }
  const t = _tasks.find(x => !x.done && x.reminderDate && x.reminderTime);
  const statusEl = document.getElementById('testTaskReminderStatus');
  if (!t) {
    if (statusEl) statusEl.textContent = '⚠️ Няма бележки с напомняне';
    alert('Няма бележки с напомняне за тест.'); return;
  }
  showAppNotification('📝 Нон Стоп — Бележка (Тест)', {
    body: `${t.text} | ${t.reminderDate} ${t.reminderTime}`,
    icon: 'icon-192.png',
    badge: 'icon-192.png'
  });
  if (statusEl) statusEl.textContent = `✅ Изпратено: „${t.text}"`;
  console.log('testTaskReminder → fired for:', t.text);
};

// ── Push нотификации ──────────────────────────────────────────
function checkNotifStatus() {
  const toggle = document.getElementById('notifToggle');
  const status = document.getElementById('notifStatus');
  if (!toggle || !status) return;
  const on = localStorage.getItem('ns_notif') === '1';
  toggle.checked = on;
  if (!('Notification' in window))          { status.textContent = 'Не се поддържа'; toggle.disabled = true; return; }
  if (Notification.permission === 'denied') { status.textContent = '⛔ Блокирани'; toggle.checked = false; toggle.disabled = true; return; }
  status.textContent = on ? '✅ Включено — 18:00' : 'Изключено';
}

window.toggleNotifications = async function(on) {
  const status = document.getElementById('notifStatus');
  if (on) {
    if (!('Notification' in window)) { document.getElementById('notifToggle').checked = false; return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      status.textContent = '⛔ Отказано';
      document.getElementById('notifToggle').checked = false;
      localStorage.setItem('ns_notif','0'); return;
    }
    localStorage.setItem('ns_notif','1');
    status.textContent = '✅ Включено — 18:00';
    scheduleReminder();
    initFCM();
  } else {
    localStorage.setItem('ns_notif','0');
    status.textContent = 'Изключено';
  }
};

window.sendTestNotif = function() {
  if (!('Notification' in window) || Notification.permission !== 'granted') { alert('Разреши известията първо.'); return; }
  showAppNotification('🏪 Нон Стоп — Тест', { body: 'Известията работят!', icon: 'icon-192.png', badge: 'icon-192.png' });
};

function scheduleReminder() {
  const now = new Date(), target = new Date(now);
  target.setHours(18, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  setTimeout(() => {
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = records.some(r => (r.date||'').startsWith(today));
    if (!hasToday && localStorage.getItem('ns_notif') === '1' && Notification.permission === 'granted') {
      showAppNotification('🏪 Нон Стоп — Напомняне', { body: `Няма запис за днес (${today})!`, icon: 'icon-192.png', badge: 'icon-192.png' });
    }
    scheduleReminder();
  }, target - now);
}

if (localStorage.getItem('ns_notif') === '1' && 'Notification' in window && Notification.permission === 'granted') {
  scheduleReminder();
}

// --------------------------------------------------
// 🖨️ Принтиране на филтрираните записи
// --------------------------------------------------
window.printFilteredTable = function() {
  window.print();
};

// --------------------------------------------------
// 📊 Експорт в Excel (SheetJS)
// --------------------------------------------------
window.exportFilteredToExcel = function() {
  if (typeof XLSX === "undefined") {
    alert("Excel библиотеката не е заредена. Провери интернет връзката.");
    return;
  }

  const data = filteredRecords.length ? filteredRecords : records;
  if (!data.length) { alert("Няма записи за експорт."); return; }

  const rows = data.map(r => ({
    "Дата":      r.date     || "",
    "Тип":       r.type     || "",
    "Сума (€)":  parseFloat(r.amount) || 0,
    "Метод":     r.method   || "",
    "Магазин":   storeLabel(effectiveStore(r)),
    "Категория": r.category || "",
    "Бележка":   r.note     || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Ширини на колоните
  ws["!cols"] = [
    { wch: 12 }, // Дата
    { wch: 10 }, // Тип
    { wch: 10 }, // Сума
    { wch: 10 }, // Метод
    { wch: 12 }, // Магазин
    { wch: 16 }, // Категория
    { wch: 30 }, // Бележка
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Отчет");

  // Име на файла с текущия месец от филтъра или текущата дата
  const month = (filteredRecords[0]?.date || new Date().toISOString()).slice(0, 7);
  XLSX.writeFile(wb, `NonStop_Отчет_${month}.xlsx`);
};

// --------------------------------------------------
// 🛡️ Глобален handler за необработени Promise грешки
// --------------------------------------------------
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
});

// ════════════════════════════════════════════════
// 👥 СОБСТВЕНИЦИ
// ════════════════════════════════════════════════

let _ownersMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
let _ownersUnsub = null;

function ownersMonthLabel(ym) {
  const [y, m] = ym.split("-");
  const names = ["Януари","Февруари","Март","Април","Май","Юни",
                  "Юли","Август","Септември","Октомври","Ноември","Декември"];
  return `${names[parseInt(m,10)-1]} ${y}`;
}

function ownersChangeMonth(delta) {
  const [y, m] = _ownersMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  _ownersMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  document.getElementById("ownersMonthLabel").textContent = ownersMonthLabel(_ownersMonth);
  loadOwnersForMonth();
}
window.ownersChangeMonth = ownersChangeMonth;

function loadOwnersForMonth() {
  if (_ownersUnsub) { _ownersUnsub(); _ownersUnsub = null; }

  // Само where без orderBy — избягва изискване за composite index
  const q = query(
    collection(db, "owners"),
    where("month", "==", _ownersMonth)
  );

  document.getElementById("ownersMonthLabel").textContent = ownersMonthLabel(_ownersMonth);

  // Set default date to today (or first day of selected month if navigating past)
  const today = new Date().toISOString().slice(0, 10);
  const todayMonth = today.slice(0, 7);
  const ownerDateEl = document.getElementById("ownerDate");
  if (ownerDateEl && !ownerDateEl.value) {
    ownerDateEl.value = _ownersMonth === todayMonth ? today : _ownersMonth + "-01";
  }

  _ownersUnsub = onSnapshot(q, snap => {
    // Сортираме по дата в JS
    const entries = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    renderOwners(entries);
  }, err => {
    console.error("Owners snapshot error:", err);
  });
}

function renderOwners(entries) {
  const mitko = entries.filter(e => e.name === "Митко");
  const velko  = entries.filter(e => e.name === "Велко");

  const fmt = v => v.toFixed(2) + " €";

  // Пресмята приходи/разходи за собственик
  function calcSums(arr) {
    let inc = 0, exp = 0;
    for (const e of arr) {
      const a = parseFloat(e.amount) || 0;
      if ((e.type || "").toLowerCase().includes("приход")) inc += a;
      else exp += a;
    }
    return { inc, exp, net: inc - exp };
  }

  const typeBadge = t => {
    const isInc = (t || "").toLowerCase().includes("приход");
    return `<span class="owners-type-badge ${isInc ? 'owners-income' : 'owners-expense'}">${t || "—"}</span>`;
  };

  const rowsHtml = (arr) => {
    const total = arr.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const dataRows = arr.map(e => `
      <tr>
        <td>${e.date || "—"}</td>
        <td class="mono">${fmt(parseFloat(e.amount)||0)}</td>
        <td>${typeBadge(e.type)}</td>
        <td>${escHtml(e.note || "")}</td>
        <td>${e.linkedRecordId ? '<span title="Свързан с Отчети" style="color:var(--text3);font-size:.75rem">🔗</span>' : `<button class="btn-danger btn-sm" onclick="deleteOwnerEntry('${e.id}')">🗑️</button>`}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="owners-empty">Няма записи</td></tr>`;
    const totalRow = `
      <tr class="owners-total-row">
        <td class="owners-total-label">Общо за месеца:</td>
        <td class="mono owners-total-amount">${fmt(total)}</td>
        <td colspan="3"></td>
      </tr>`;
    return dataRows + totalRow;
  };

  document.getElementById("ownersMitkoBody").innerHTML = rowsHtml(mitko);
  document.getElementById("ownersVelkoBody").innerHTML  = rowsHtml(velko);

  const sm = calcSums(mitko);
  const sv = calcSums(velko);
  const totalM = mitko.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const totalV = velko.reduce((s, e)  => s + (parseFloat(e.amount) || 0), 0);

  document.getElementById("ownersSummaryBody").innerHTML = `
    <tr>
      <td class="owners-summary-label">Приходи</td>
      <td class="mono income">${fmt(sm.inc)}</td>
      <td class="mono income">${fmt(sv.inc)}</td>
    </tr>
    <tr>
      <td class="owners-summary-label">Разходи</td>
      <td class="mono expense">${fmt(sm.exp)}</td>
      <td class="mono expense">${fmt(sv.exp)}</td>
    </tr>
    <tr class="owners-diff-row">
      <td class="owners-summary-label">Нето</td>
      <td class="mono ${sm.net >= 0 ? 'income' : 'expense'}">${sm.net >= 0 ? "+" : ""}${fmt(sm.net)}</td>
      <td class="mono ${sv.net >= 0 ? 'income' : 'expense'}">${sv.net >= 0 ? "+" : ""}${fmt(sv.net)}</td>
    </tr>
    <tr class="owners-grand-total-row">
      <td class="owners-summary-label">Общо</td>
      <td class="mono owners-grand-total-amount">${fmt(totalM)}</td>
      <td class="mono owners-grand-total-amount">${fmt(totalV)}</td>
    </tr>`;
}

window.addOwnerEntry = async function() {
  const amount = parseFloat(document.getElementById("ownerAmount").value);
  const name   = document.getElementById("ownerName").value;
  const type   = document.getElementById("ownerType")?.value || "Разход";
  const note   = document.getElementById("ownerNote").value.trim();
  const date   = document.getElementById("ownerDate").value;

  if (!amount || amount <= 0) { alert("Въведи сума!"); return; }
  if (!date)                  { alert("Избери дата!");  return; }

  try {
    await addDoc(collection(db, "owners"), {
      name,
      amount,
      type,
      note,
      date,
      month: date.slice(0, 7),
      createdAt: new Date().toISOString()
    });
    document.getElementById("ownerAmount").value = "";
    document.getElementById("ownerNote").value   = "";
  } catch(err) {
    alert("Грешка при запис: " + err.message);
  }
};

window.deleteOwnerEntry = async function(id) {
  if (!confirm("Изтрий този запис?")) return;
  try {
    await deleteDoc(doc(db, "owners", id));
  } catch(err) {
    alert("Грешка при изтриване: " + err.message);
  }
};

// ════════════════════════════════════════════════
// 🏪 ДНЕВЕН ОТЧЕТ v2 (Управители)
// Колекция: daily_reports  ·  shopId: "store1"|"store2"
// ════════════════════════════════════════════════

const DR_SHIFTS_DEF = [
  { name: "Сутрешна",   from: "07:00", to: "14:00" },
  { name: "Следобедна", from: "14:00", to: "21:00" },
  { name: "Нощна",      from: "20:00", to: "08:00" }
];
const DR_GOODS        = 20;
const DR_OTHER        = 5;
const DR_SIDE_INCOMES = 3;
const DR_ADVANCES     = 3;

let _drShopId    = null;   // "store1" | "store2"
let _drStatus    = "draft";
let _drDocId     = null;   // Firestore document ID
let _drData      = null;
let _drEmployees = [];
let _drEmployeesLoaded = false;
let _suppliers = [];
let _recentReportsUnsub = null;
let _ownerReportsUnsub  = null;

// ── Инициализация ────────────────────────────────────
function initDailyReport(storeRole) {
  _drShopId = storeRole;
  _drEmployeesLoaded = false;
  const num = storeRole === "store1" ? "1" : "2";
  const titleEl = document.getElementById("storeTitle");
  if (titleEl) titleEl.textContent = `Магазин ${num}`;

  renderDrShiftsTable();
  renderDrGoodsTable();
  renderDrOtherTable();
  renderDrSideIncomeTable();
  loadDrEmployees(); // async — renders advance rows after employees are fetched

  const today  = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById("drDate");
  if (dateEl) { dateEl.value = today; dateEl.max = ""; }
  _updateDrDateWeekday();

  loadSuppliers();
  loadOrCreateReport();
  loadRecentReports();
  checkManagerNotifications();
}

// ── Известия към управителя (разрешена редакция) ──────────
async function checkManagerNotifications() {
  if (!_drShopId) return;
  try {
    const snap = await getDocs(query(
      collection(db, "notifications"),
      where("forShopId", "==", _drShopId)
    ));
    const unread = snap.docs.filter(d => {
      const n = d.data();
      return n.type === "edit_allowed" && n.read === false;
    });
    if (!unread.length) return;

    const banner = document.getElementById("drStatusBanner");
    unread.forEach(d => {
      const n = d.data();
      if (banner) {
        banner.textContent = `📝 ${n.message}`;
        banner.className = "dr-status-banner dr-banner-info";
        banner.classList.remove("hidden");
        setTimeout(() => banner.classList.add("hidden"), 8000);
      }
      updateDoc(doc(db, "notifications", d.id), { read: true }).catch(() => {});
    });

    if (_drDocId) loadOrCreateReport();
  } catch (e) { console.warn("checkManagerNotifications:", e); }
}

// ── Доставчици ────────────────────────────────────────
async function loadSuppliers() {
  try {
    const snap = await getDocs(query(collection(db, "suppliers"), where("shopId", "==", _drShopId)));
    _suppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn("loadSuppliers:", e); }
}

// ── Supplier picker ───────────────────────────────────
let _supplActiveIdx  = -1;
let _supplHighIdx    = -1;
let _supplCloseTimer = null;

// ── Supplier picker helpers ───────────────────────────
function supplOpts(arr) {
  return arr.map(s =>
    `<div class="suppl-opt" data-name="${escHtml(s.name)}">${escHtml(s.name)}</div>`
  ).join("");
}

// Единичен scroll контейнер — recent + all вътре
function supplPopulate(filter) {
  const scroll = document.getElementById("supplDropScroll");
  if (!scroll) return;
  const q = (filter || "").toLowerCase().trim();
  let html = "";

  if (q) {
    const filtered = [..._suppliers]
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"))
      .filter(s => (s.name || "").toLowerCase().includes(q));
    html += `<div class="suppl-group-title">Резултати (${filtered.length})</div>`;
    html += filtered.length
      ? supplOpts(filtered)
      : `<div class="suppl-no-results">Няма намерени доставчици</div>`;
  } else {
    const recent = [..._suppliers]
      .sort((a, b) => (b.lastUsed || "").localeCompare(a.lastUsed || ""))
      .slice(0, 5);
    const all = [..._suppliers]
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));

    html += `<div class="suppl-group-title">Честo използвани</div>`;
    html += recent.length
      ? supplOpts(recent)
      : `<div class="suppl-no-results">Все още няма данни</div>`;
    html += `<div class="suppl-divider"></div>`;
    html += `<div class="suppl-group-title">Всички (${all.length})</div>`;
    html += all.length
      ? supplOpts(all)
      : `<div class="suppl-no-results">Списъкът е празен</div>`;
  }

  scroll.innerHTML = html;
  scroll.scrollTop = 0;
}

function supplPosition(inputEl) {
  const rect  = inputEl.getBoundingClientRect();
  const panel = document.getElementById("supplDropPanel");
  if (!panel) return;
  panel.style.left     = rect.left + "px";
  panel.style.top      = rect.bottom + "px";
  panel.style.minWidth = Math.max(rect.width, 300) + "px";
}

window.supplOpen = function (idx, inputEl) {
  clearTimeout(_supplCloseTimer);
  _supplActiveIdx = idx;
  _supplHighIdx   = -1;
  const panel = document.getElementById("supplDropPanel");
  if (!panel) return;
  supplPosition(inputEl);
  supplPopulate(inputEl.value);
  panel.style.display = "flex";
};

window.supplFilter = function (idx, inputEl) {
  clearTimeout(_supplCloseTimer);
  _supplActiveIdx = idx;
  _supplHighIdx   = -1;
  const panel = document.getElementById("supplDropPanel");
  if (!panel) return;
  supplPosition(inputEl);
  supplPopulate(inputEl.value);
  panel.style.display = "flex";
};

window.supplKeyDown = function (idx, e) {
  const panel = document.getElementById("supplDropPanel");

  if (e.key === "Escape") {
    supplClose();
    _supplHighIdx = -1;
    return;
  }
  if (!panel || panel.style.display === "none") {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      supplOpen(idx, e.target);
    }
    return;
  }

  const opts = Array.from(panel.querySelectorAll(".suppl-opt"));
  if (!opts.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    _supplHighIdx = Math.min(_supplHighIdx + 1, opts.length - 1);
    supplHighlight(opts);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    _supplHighIdx = Math.max(_supplHighIdx - 1, 0);
    supplHighlight(opts);
  } else if (e.key === "Enter" && _supplHighIdx >= 0) {
    e.preventDefault();
    supplPick(opts[_supplHighIdx].dataset.name);
    _supplHighIdx = -1;
  }
};

function supplHighlight(opts) {
  opts.forEach((opt, i) => {
    const on = i === _supplHighIdx;
    opt.classList.toggle("suppl-opt-active", on);
    if (on) opt.scrollIntoView({ block: "nearest" });
  });
}

window.supplBlur = function () {
  _supplCloseTimer = setTimeout(supplClose, 200);
};

function supplClose() {
  const panel = document.getElementById("supplDropPanel");
  if (panel) panel.style.display = "none";
}

async function supplPick(name) {
  const idx = _supplActiveIdx;
  supplClose();
  if (idx < 0) return;
  setDrField("goods", idx, "supplier", name);

  const now      = new Date().toISOString();
  const existing = _suppliers.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.lastUsed = now;
    updateDoc(doc(db, "suppliers", existing.id), { lastUsed: now }).catch(() => {});
  }
}

window.supplAddNew = function () {
  supplClose();
  const modal = document.getElementById("supplAddModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  const inp = document.getElementById("supplNewName");
  if (inp) { inp.value = ""; setTimeout(() => inp.focus(), 50); }
};

window.supplAddCancel = function () {
  document.getElementById("supplAddModal")?.classList.add("hidden");
};

window.supplAddConfirm = async function () {
  const nameEl = document.getElementById("supplNewName");
  const name   = nameEl?.value.trim();
  if (!name) return;
  const now      = new Date().toISOString();
  const existing = _suppliers.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    try {
      const ref = await addDoc(collection(db, "suppliers"), { shopId: _drShopId, name, lastUsed: now });
      _suppliers.push({ id: ref.id, shopId: _drShopId, name, lastUsed: now });
    } catch (e) { console.error("supplAddConfirm:", e); return; }
  }
  if (_supplActiveIdx >= 0) setDrField("goods", _supplActiveIdx, "supplier", name);
  document.getElementById("supplAddModal")?.classList.add("hidden");
  showDrBanner(`✅ Добавен: ${name}`, "info");
};

// Затваряне при клик ИЗВЪН dropdown-а
document.addEventListener("mousedown", function (e) {
  if (!e.target.closest("#supplDropPanel") && !e.target.closest(".suppl-input")) {
    clearTimeout(_supplCloseTimer);
    supplClose();
  }
}, true);

// Затваряне при СТРАНИЧЕН scroll — НЕ при вътрешен scroll на dropdown-а
window.addEventListener("scroll", function (e) {
  const panel = document.getElementById("supplDropPanel");
  if (!panel || panel.contains(e.target)) return; // вътрешен scroll → игнорирай
  supplClose();
}, true);

// Event delegation — mousedown на опциите
(function () {
  const panel = document.getElementById("supplDropPanel");
  if (!panel) return;
  panel.addEventListener("mousedown", function (e) {
    clearTimeout(_supplCloseTimer);
    const opt    = e.target.closest(".suppl-opt");
    const addBtn = e.target.closest(".suppl-add-btn");
    if (opt) {
      e.preventDefault();
      supplPick(opt.dataset.name);
    } else if (addBtn) {
      e.preventDefault();
      supplAddNew();
    }
  });
}());

// ── Рендиране на таблиците ───────────────────────────
function _buildOperatorSelect(i) {
  if (!_drEmployeesLoaded) {
    return `<select class="dr-input dr-operator-select" data-shift="${i}" data-field="operator">
      <option value="">⏳ Зареждане...</option>
    </select>`;
  }
  if (_drEmployees.length === 0) {
    return `<select class="dr-input dr-operator-select" data-shift="${i}" data-field="operator">
      <option value="">— Изберете служител —</option>
      <option value="" disabled>Няма активни служители</option>
    </select>`;
  }
  const opts = _drEmployees.map(e => `<option value="${escHtml(e.name)}">${escHtml(e.name)}</option>`).join("");
  return `<select class="dr-input dr-operator-select" data-shift="${i}" data-field="operator">
    <option value="">— Изберете служител —</option>
    ${opts}
  </select>`;
}

function renderDrShiftsTable() {
  const tbody = document.getElementById("drShiftsBody");
  if (!tbody) return;
  tbody.innerHTML = DR_SHIFTS_DEF.map((sh, i) => `
    <tr>
      <td class="dr-shift-name">${sh.name}</td>
      <td class="dr-shift-time">${sh.from}–${sh.to}</td>
      <td>${_buildOperatorSelect(i)}</td>
      <td class="mono dr-auto-cell" id="drShiftRev${i}">0.00</td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-shift="${i}" data-field="cash"  oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-shift="${i}" data-field="pos"   oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-shift="${i}" data-field="plus"  oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-shift="${i}" data-field="minus" oninput="drCalc()"></td>
    </tr>`).join("");
}

function renderDrGoodsTable() {
  const tbody      = document.getElementById("drGoodsBody");
  const tbodyRight = document.getElementById("drGoodsBodyRight");
  if (!tbody) return;
  const split = Math.ceil(DR_GOODS / 2); // 8 ред вляво, 7 вдясно
  const row = i => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td class="suppl-cell">
        <div class="suppl-wrap">
          <input type="text" class="dr-input suppl-input"
                 data-goods="${i}" data-field="supplier"
                 placeholder="Доставчик" autocomplete="off"
                 onfocus="supplOpen(${i}, this)"
                 oninput="supplFilter(${i}, this)"
                 onblur="supplBlur()"
                 onkeydown="supplKeyDown(${i}, event)">
        </div>
      </td>
      <td><select class="dr-input dr-method-sel" data-goods="${i}" data-field="method" oninput="drCalc()">
        <option value="Кеш" selected>💵 Кеш</option>
        <option value="Карта">💳 Карта</option>
        <option value="Банков превод">🏦 Банков</option>
      </select></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-goods="${i}" data-field="amount" oninput="drCalc()"></td>
    </tr>`;
  tbody.innerHTML = Array.from({ length: split }, (_, i) => row(i)).join("");
  if (tbodyRight) {
    tbodyRight.innerHTML = Array.from({ length: DR_GOODS - split }, (_, i) => row(split + i)).join("");
  }
}

function updateDrOtherDescOptions() {
  const dl = document.getElementById("drOtherDescList");
  if (!dl) return;
  const dateVal = document.getElementById("drDate")?.value || "";
  let isSunday = false;
  if (dateVal && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    isSunday = new Date(dateVal + "T00:00:00Z").getUTCDay() === 0;
  }
  const baseOpts = ["Ремонт", "Консумативи", "Транспорт", "Комунални", "Друго"];
  const opts = isSunday ? [...baseOpts, "Оставени за зареждане"] : baseOpts;
  dl.innerHTML = opts.map(o => `<option value="${o}"></option>`).join("");
}

function renderDrOtherTable() {
  const tbody = document.getElementById("drOtherBody");
  if (!tbody) return;

  updateDrOtherDescOptions();

  tbody.innerHTML = Array.from({ length: DR_OTHER }, (_, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td><input type="text" class="dr-input" placeholder="Описание" list="drOtherDescList" data-other="${i}" data-field="desc"></td>
      <td><select class="dr-input dr-method-sel" data-other="${i}" data-field="method" oninput="drCalc()">
        <option value="Кеш" selected>💵 Кеш</option>
        <option value="Карта">💳 Карта</option>
        <option value="Банков превод">🏦 Банков</option>
      </select></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-other="${i}" data-field="amount" oninput="drCalc()"></td>
    </tr>`).join("");
}

function renderDrSideIncomeTable() {
  const tbody = document.getElementById("drSideIncomeBody");
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: DR_SIDE_INCOMES }, (_, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td><input type="text" class="dr-input" placeholder="Описание" data-side="${i}" data-field="desc"></td>
      <td><select class="dr-input dr-method-sel" data-side="${i}" data-field="method" oninput="drCalc()">
        <option value="Кеш" selected>💵 Кеш</option>
        <option value="Карта">💳 Карта</option>
        <option value="Банков превод">🏦 Банков</option>
      </select></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-side="${i}" data-field="amount" oninput="drCalc()"></td>
    </tr>`).join("");
}

async function loadDrEmployees() {
  if (!_drShopId) return;
  try {
    const snap = await getDocs(query(
      collection(db, "employees"),
      where("shopId", "==", _drShopId)
    ));
    _drEmployees = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.active !== false)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    _drEmployeesLoaded = true;
    renderDrAdvancesTable();
    renderDrShiftsTable();
    if (_drData) {
      (_drData.shifts || []).forEach((sh, i) => {
        if (i >= DR_SHIFTS_DEF.length) return;
        _setOperatorValue(i, sh.operator || "");
      });
    }
  } catch (e) { console.error("loadDrEmployees:", e); }
}

function renderDrAdvancesTable() {
  const tbody = document.getElementById("drAdvancesBody");
  if (!tbody) return;
  const empOpts = _drEmployees
    .map(e => `<option value="${escHtml(e.id)}">${escHtml(e.name)}</option>`)
    .join("");
  tbody.innerHTML = Array.from({ length: DR_ADVANCES }, (_, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td>
        <select class="dr-input" data-adv="${i}" data-field="empId">
          <option value="">— Служител —</option>
          ${empOpts}
        </select>
      </td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-adv="${i}" data-field="amount" oninput="drCalc()"></td>
      <td><input type="text"   class="dr-input"      placeholder="Бележка" data-adv="${i}" data-field="note"></td>
    </tr>`).join("");
}

// ── Събиране на данни от формата ─────────────────────
function collectDrData() {
  const date      = document.getElementById("drDate")?.value || "";
  const startCash = parseFloat(document.getElementById("drStartCash")?.value) || 0;

  const shifts = DR_SHIFTS_DEF.map((def, i) => {
    const cash  = parseFloat(drField("shift", i, "cash"))  || 0;
    const pos   = parseFloat(drField("shift", i, "pos"))   || 0;
    const plus  = parseFloat(drField("shift", i, "plus"))  || 0;
    const minus = parseFloat(drField("shift", i, "minus")) || 0;
    return {
      name: def.name, from: def.from, to: def.to,
      operator: drField("shift", i, "operator") || "",
      cash, pos, plus, minus
    };
  });

  const expensesGoods = Array.from({ length: DR_GOODS }, (_, i) => ({
    supplier: drField("goods", i, "supplier") || "",
    method:   drField("goods", i, "method")   || "Кеш",
    amount:   parseFloat(drField("goods", i, "amount")) || 0
  })).filter(g => g.supplier || g.amount > 0);

  const expensesOther = Array.from({ length: DR_OTHER }, (_, i) => ({
    description: drField("other", i, "desc")   || "",
    method:      drField("other", i, "method") || "Кеш",
    amount:      parseFloat(drField("other", i, "amount")) || 0
  })).filter(o => o.description || o.amount > 0);

  const sideIncomes = Array.from({ length: DR_SIDE_INCOMES }, (_, i) => ({
    description: drField("side", i, "desc")   || "",
    method:      drField("side", i, "method") || "Кеш",
    amount:      parseFloat(drField("side", i, "amount")) || 0
  })).filter(s => s.description || s.amount > 0);

  const advances = Array.from({ length: DR_ADVANCES }, (_, i) => {
    const empId = drField("adv", i, "empId") || "";
    const emp   = _drEmployees.find(e => e.id === empId);
    return {
      employeeId:   empId,
      employeeName: emp?.name || "",
      amount:       parseFloat(drField("adv", i, "amount")) || 0,
      note:         drField("adv", i, "note") || ""
    };
  }).filter(a => a.employeeId || a.amount > 0);

  const totalCashIncome      = r2(shifts.reduce((s, sh) => s + sh.cash, 0));
  const totalPosIncome       = r2(shifts.reduce((s, sh) => s + sh.pos, 0));
  const totalGoodsExpense    = r2(expensesGoods.reduce((s, g) => s + g.amount, 0));
  const totalOtherExpense    = r2(expensesOther.reduce((s, o) => s + o.amount, 0));
  const cashGoodsExpense     = expensesGoods.filter(g => (g.method || "Кеш") !== "Карта" && (g.method || "Кеш") !== "Банков превод").reduce((s, g) => s + g.amount, 0);
  const cashOtherExpense     = expensesOther.filter(o => (o.method || "Кеш") !== "Карта" && (o.method || "Кеш") !== "Банков превод").reduce((s, o) => s + o.amount, 0);
  const cardGoodsExpense     = r2(expensesGoods.filter(g => g.method === "Карта").reduce((s, g) => s + g.amount, 0));
  const cardOtherExpense     = r2(expensesOther.filter(o => o.method === "Карта").reduce((s, o) => s + o.amount, 0));
  const bankGoodsExpense     = r2(expensesGoods.filter(g => g.method === "Банков превод").reduce((s, g) => s + g.amount, 0));
  const bankOtherExpense     = r2(expensesOther.filter(o => o.method === "Банков превод").reduce((s, o) => s + o.amount, 0));
  const cashExpenseTotal     = cashGoodsExpense + cashOtherExpense;
  const cardExpenseTotal     = r2(cardGoodsExpense + cardOtherExpense);
  const bankExpenseTotal     = r2(bankGoodsExpense + bankOtherExpense);
  const totalSideIncomes     = r2(sideIncomes.reduce((s, si) => s + si.amount, 0));
  const cashSideIncomes      = r2(sideIncomes.filter(si => (si.method || "Кеш") !== "Карта" && (si.method || "Кеш") !== "Банков превод").reduce((s, si) => s + si.amount, 0));
  const cardSideIncomes      = r2(sideIncomes.filter(si => si.method === "Карта").reduce((s, si) => s + si.amount, 0));
  const bankSideIncomes      = r2(sideIncomes.filter(si => si.method === "Банков превод").reduce((s, si) => s + si.amount, 0));
  const totalSideIncomesCash = cashSideIncomes;
  // ПРЕДПОЛОЖЕНИЕ: Всички аванси са в кеш (потвърдено от собственика, 2026-06-04).
  // Ако авансите започнат да се плащат и по банка — добави поле "method" в advance обекта
  // и филтрирай: advances.filter(a => !a.method || a.method === "Кеш").
  const totalAdvances        = r2(advances.reduce((s, a) => s + a.amount, 0));
  const totalShiftPlus  = r2(shifts.reduce((s, sh) => s + (sh.plus  || 0), 0));
  const totalShiftMinus = r2(shifts.reduce((s, sh) => s + (sh.minus || 0), 0));
  const endCash = r2(startCash + totalCashIncome + cashSideIncomes + totalShiftPlus - totalShiftMinus - cashExpenseTotal - totalAdvances);

  return {
    shopId: _drShopId, date, startCash, shifts,
    expensesGoods, expensesOther, sideIncomes, advances,
    totalCashIncome, totalPosIncome,
    totalGoodsExpense, totalOtherExpense,
    cashGoodsExpense, cashOtherExpense, cashExpenseTotal,
    cardGoodsExpense, cardOtherExpense, cardExpenseTotal,
    bankGoodsExpense, bankOtherExpense, bankExpenseTotal,
    totalSideIncomes, totalSideIncomesCash,
    cashSideIncomes, cardSideIncomes, bankSideIncomes,
    totalAdvances, totalShiftPlus, totalShiftMinus, endCash
  };
}

function drField(type, idx, field) {
  return document.querySelector(`[data-${type}="${idx}"][data-field="${field}"]`)?.value ?? "";
}

function setDrField(type, idx, field, val) {
  const el = document.querySelector(`[data-${type}="${idx}"][data-field="${field}"]`);
  if (el) el.value = val ?? "";
}

function _setOperatorValue(i, operatorName) {
  const sel = document.querySelector(`[data-shift="${i}"][data-field="operator"]`);
  if (!sel || sel.tagName !== "SELECT") return;
  if (operatorName) {
    const exists = Array.from(sel.options).some(o => o.value === operatorName);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = operatorName;
      opt.textContent = `(стар) ${operatorName}`;
      sel.add(opt, 1);
    }
  }
  sel.value = operatorName || "";
}

function r2(n) { return Math.round(n * 100) / 100; }

// Връща съкратеното българско име на деня от седмицата за дадена ISO дата (YYYY-MM-DD).
function _ymdToWeekday(ymd) {
  if (!ymd || typeof ymd !== "string") return "";
  const days = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const d = new Date(ymd + "T12:00:00");
  if (isNaN(d.getTime())) return "";
  return days[d.getDay()];
}

function _updateDrDateWeekday() {
  const wd = document.getElementById("drDateWeekday");
  if (!wd) return;
  const day = _ymdToWeekday(document.getElementById("drDate")?.value || "");
  wd.textContent = day ? `(${day})` : "";
}

// Преизчислява endCash от суровите данни на отчета (shifts, expenses, sideIncomes, advances).
// Ползва се за показване — стари отчети, затворени преди добавянето на plus/minus в endCash,
// имат сторирана грешна стойност. Тази функция ги "самоизлекува" без миграция.
function _recalcEndCash(r) {
  if (!r) return 0;
  const startCash     = Number(r.startCash || 0);
  const shifts        = r.shifts          || [];
  const expensesGoods = r.expensesGoods   || [];
  const expensesOther = r.expensesOther   || [];
  const sideIncomes   = r.sideIncomes     || [];
  const advances      = r.advances        || [];

  const totalCashIncome = shifts.reduce((s, sh) => s + Number(sh.cash  || 0), 0);
  const totalShiftPlus  = shifts.reduce((s, sh) => s + Number(sh.plus  || 0), 0);
  const totalShiftMinus = shifts.reduce((s, sh) => s + Number(sh.minus || 0), 0);

  const isCash = (x) => (x.method || "Кеш") !== "Карта" && (x.method || "Кеш") !== "Банков превод";
  const cashGoodsExpense = expensesGoods.filter(isCash).reduce((s, g)  => s + Number(g.amount  || 0), 0);
  const cashOtherExpense = expensesOther.filter(isCash).reduce((s, o)  => s + Number(o.amount  || 0), 0);
  const cashSideIncomes  = sideIncomes  .filter(isCash).reduce((s, si) => s + Number(si.amount || 0), 0);
  const totalAdvances    = advances.reduce((s, a) => s + Number(a.amount || 0), 0);

  return r2(
    startCash + totalCashIncome + cashSideIncomes
    + totalShiftPlus - totalShiftMinus
    - (cashGoodsExpense + cashOtherExpense)
    - totalAdvances
  );
}

// Преизчислява ВСИЧКИ обобщителни стойности на отчет от суровите данни.
// Ползва се навсякъде където отчетът се ПОКАЗВА — гарантира consistency между стари и нови отчети.
function _recalcReportTotals(r) {
  if (!r) return {};
  const shifts        = r.shifts        || [];
  const expensesGoods = r.expensesGoods || [];
  const expensesOther = r.expensesOther || [];
  const sideIncomes   = r.sideIncomes   || [];
  const advances      = r.advances      || [];

  const isCash = (x) => (x.method || "Кеш") !== "Карта" && (x.method || "Кеш") !== "Банков превод";

  return {
    totalCashIncome:   r2(shifts.reduce((s, sh) => s + Number(sh.cash  || 0), 0)),
    totalPosIncome:    r2(shifts.reduce((s, sh) => s + Number(sh.pos   || 0), 0)),
    totalShiftPlus:    r2(shifts.reduce((s, sh) => s + Number(sh.plus  || 0), 0)),
    totalShiftMinus:   r2(shifts.reduce((s, sh) => s + Number(sh.minus || 0), 0)),
    totalGoodsExpense: r2(expensesGoods.reduce((s, g) => s + Number(g.amount || 0), 0)),
    totalOtherExpense: r2(expensesOther.reduce((s, o) => s + Number(o.amount || 0), 0)),
    totalSideIncomes:  r2(sideIncomes.reduce((s, si) => s + Number(si.amount || 0), 0)),
    totalAdvances:     r2(advances.reduce((s, a) => s + Number(a.amount || 0), 0)),
    cashSideIncomes:   r2(sideIncomes.filter(isCash).reduce((s, si) => s + Number(si.amount || 0), 0)),
    endCash:           _recalcEndCash(r)
  };
}

// ── Изчисляване и обновяване на резюмето ─────────────
window.drCalc = function() {
  const d = collectDrData();

  DR_SHIFTS_DEF.forEach((_, i) => {
    const sh  = d.shifts[i];
    const rev = r2((sh.cash || 0) + (sh.pos || 0));
    const el  = document.getElementById(`drShiftRev${i}`);
    if (el) el.textContent = rev.toFixed(2);
  });

  const totalRev   = r2(d.shifts.reduce((s, sh) => s + sh.cash + sh.pos + sh.plus - sh.minus, 0));
  const totalPlus  = r2(d.shifts.reduce((s, sh) => s + sh.plus, 0));
  const totalMinus = r2(d.shifts.reduce((s, sh) => s + sh.minus, 0));

  setText("drTotalRevenue", totalRev.toFixed(2));
  setText("drTotalCash",    d.totalCashIncome.toFixed(2));
  setText("drTotalPos",     d.totalPosIncome.toFixed(2));
  setText("drTotalPlus",    totalPlus.toFixed(2));
  setText("drTotalMinus",   totalMinus.toFixed(2));
  setText("drTotalGoods",       d.totalGoodsExpense.toFixed(2));
  setText("drTotalOther",       d.totalOtherExpense.toFixed(2));
  setText("drTotalSideIncome",  (d.totalSideIncomes || 0).toFixed(2));
  setText("drTotalAdvances",    (d.totalAdvances    || 0).toFixed(2));

  setText("drSumStarting",   d.startCash.toFixed(2) + " €");
  setText("drSumCash",       d.totalCashIncome.toFixed(2) + " €");
  setText("drSumPos",        d.totalPosIncome.toFixed(2) + " €");
  setText("drSumSideIncome", (d.totalSideIncomes || 0).toFixed(2) + " €");
  setText("drSumExpenses",   r2(d.totalGoodsExpense + d.totalOtherExpense).toFixed(2) + " €");
  setText("drSumAdvances",   (d.totalAdvances    || 0).toFixed(2) + " €");

  const hasNonCashSide = (d.cardSideIncomes || 0) > 0 || (d.bankSideIncomes || 0) > 0;
  const sideBrkDiv = document.getElementById("drSumSideBreakdown");
  if (sideBrkDiv) {
    if (hasNonCashSide) {
      setText("drSumSideCash", (d.cashSideIncomes || 0).toFixed(2) + " €");
      setText("drSumSideCard", (d.cardSideIncomes || 0).toFixed(2) + " €");
      setText("drSumSideBank", (d.bankSideIncomes || 0).toFixed(2) + " €");
      sideBrkDiv.classList.remove("hidden");
    } else {
      sideBrkDiv.classList.add("hidden");
    }
  }

  const hasNonCash = (d.cardExpenseTotal || 0) > 0 || (d.bankExpenseTotal || 0) > 0;
  const brkDiv = document.getElementById("drSumExpensesBreakdown");
  if (brkDiv) {
    if (hasNonCash) {
      setText("drSumExpensesCash", (d.cashExpenseTotal || 0).toFixed(2) + " €");
      setText("drSumExpensesCard", (d.cardExpenseTotal || 0).toFixed(2) + " €");
      setText("drSumExpensesBank", (d.bankExpenseTotal || 0).toFixed(2) + " €");
      brkDiv.classList.remove("hidden");
    } else {
      brkDiv.classList.add("hidden");
    }
  }

  const endEl = document.getElementById("drSumEnding");
  if (endEl) {
    endEl.textContent = d.endCash.toFixed(2) + " €";
    endEl.className   = "dr-ending-value " + (d.endCash >= 0 ? "pos" : "neg");
  }
};

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Зареждане / Нов отчет ────────────────────────────
window.loadOrCreateReport = async function() {
  _updateDrDateWeekday();
  renderDrOtherTable();
  const date = document.getElementById("drDate")?.value;
  if (!date || !_drShopId) return;

  drSetLoading(true);
  try {
    const q    = query(
      collection(db, "daily_reports"),
      where("shopId", "==", _drShopId),
      where("date",   "==", date),
      limit(1)
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      const docSnap = snap.docs[0];
      _drDocId  = docSnap.id;
      _drData   = docSnap.data();
      _drStatus = _drData.status || "draft";
      populateDrForm(_drData);
    } else {
      _drDocId  = null;
      _drData   = null;
      _drStatus = "draft";
      clearDrForm();
      await loadPrevEndCash(date);
      drCalc();
    }
    updateDrStatusUI();
  } catch (err) {
    console.error("loadOrCreateReport:", err);
    alert("Грешка при зареждане: " + err.message);
  } finally {
    drSetLoading(false);
  }
};

async function loadPrevEndCash(date) {
  try {
    const q    = query(
      collection(db, "daily_reports"),
      where("shopId", "==", _drShopId),
      where("status", "==", "closed")
    );
    const snap = await getDocs(q);
    const prev = snap.docs
      .map(d => d.data())
      .filter(r => r.date < date)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (prev.length) {
      const el = document.getElementById("drStartCash");
      if (el) el.value = _recalcEndCash(prev[0]).toFixed(2);
      const hint = document.getElementById("drCarryoverHint");
      if (hint) hint.textContent = `↑ прехвърлено от ${prev[0].date}`;
    }
  } catch (e) { console.warn("loadPrevEndCash:", e); }
}

// ── Попълване / Изчистване на формата ───────────────
function populateDrForm(data) {
  const dateEl = document.getElementById("drDate");
  if (dateEl) dateEl.value = data.date || "";
  _updateDrDateWeekday();
  updateDrOtherDescOptions();
  const scEl = document.getElementById("drStartCash");
  if (scEl) scEl.value = data.startCash != null ? data.startCash.toFixed(2) : "";
  const hintEl = document.getElementById("drCarryoverHint");
  if (hintEl) hintEl.textContent = "";

  // Async проверка за несъответствие startCash ≠ вчерашен recalc endCash
  if (data.date && _drShopId) {
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, "daily_reports"),
          where("shopId", "==", _drShopId),
          where("status", "==", "closed")
        ));
        const prev = snap.docs.map(d => d.data())
          .filter(r => r.date < data.date)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!prev) return;
        const correctStart = _recalcEndCash(prev);
        const currentStart = Number(data.startCash || 0);
        if (Math.abs(correctStart - currentStart) > 0.01) {
          const hint = document.getElementById("drCarryoverHint");
          if (hint) {
            hint.innerHTML = `⚠️ <span style="color:#e74c3c">Не съвпада с крайна каса на ${prev.date}: ${correctStart.toFixed(2)} €</span>` +
              ` <button type="button" id="drSyncStartBtn" class="btn-small" style="margin-left:8px">Синхронизирай</button>`;
            const btn = document.getElementById("drSyncStartBtn");
            if (btn) btn.onclick = () => {
              const el = document.getElementById("drStartCash");
              if (el) {
                el.value = correctStart.toFixed(2);
                if (typeof drCalc === "function") drCalc();
                hint.textContent = `✓ Синхронизирано с ${prev.date}. Не забравяй да запазиш и затвориш отново.`;
              }
            };
          }
        }
      } catch (e) { console.warn("startCash mismatch check:", e); }
    })();
  }

  (data.shifts || []).forEach((sh, i) => {
    if (i >= DR_SHIFTS_DEF.length) return;
    _setOperatorValue(i, sh.operator || "");
    setDrField("shift", i, "cash",     sh.cash     || "");
    setDrField("shift", i, "pos",      sh.pos      || "");
    setDrField("shift", i, "plus",     sh.plus     || "");
    setDrField("shift", i, "minus",    sh.minus    || "");
  });

  const goods = data.expensesGoods || [];
  for (let i = 0; i < DR_GOODS; i++) {
    const g = goods[i] || {};
    setDrField("goods", i, "supplier", g.supplier || "");
    setDrField("goods", i, "method",   g.method   || "Кеш");
    setDrField("goods", i, "amount",   g.amount   || "");
  }

  const other = data.expensesOther || [];
  for (let i = 0; i < DR_OTHER; i++) {
    const o = other[i] || {};
    setDrField("other", i, "desc",   o.description || "");
    setDrField("other", i, "method", o.method      || "Кеш");
    setDrField("other", i, "amount", o.amount       || "");
  }

  const sides = data.sideIncomes || [];
  for (let i = 0; i < DR_SIDE_INCOMES; i++) {
    const s = sides[i] || {};
    setDrField("side", i, "desc",   s.description || "");
    setDrField("side", i, "method", s.method      || "Кеш");
    setDrField("side", i, "amount", s.amount > 0 ? s.amount : "");
  }

  const advs = data.advances || [];
  for (let i = 0; i < DR_ADVANCES; i++) {
    const a = advs[i] || {};
    setDrField("adv", i, "empId",  a.employeeId || "");
    setDrField("adv", i, "amount", a.amount > 0 ? a.amount : "");
    setDrField("adv", i, "note",   a.note       || "");
  }

  drCalc();
  renderDrChangeLog(data.changeLog);
}

function clearDrForm() {
  const sc = document.getElementById("drStartCash");
  if (sc) sc.value = "";
  const hint = document.getElementById("drCarryoverHint");
  if (hint) hint.textContent = "";
  document.querySelectorAll(".dr-input").forEach(el => { el.value = ""; });
  document.querySelectorAll(".dr-method-sel").forEach(sel => { sel.value = "Кеш"; });
  document.getElementById("drChangeLog")?.classList.add("hidden");
  drCalc();
}

// ── Помощна: следваща дата след последния затворен отчет ──
async function suggestNextDrDate() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await getDocs(query(
      collection(db, "daily_reports"),
      where("shopId", "==", _drShopId),
      where("status", "==", "closed")
    ));
    if (snap.empty) return today;
    const dates = snap.docs.map(d => d.data().date).sort();
    const lastClosed = dates[dates.length - 1];
    const next = new Date(lastClosed + "T12:00:00");
    next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().slice(0, 10);
    return nextStr <= today ? nextStr : today;
  } catch (e) { return today; }
}

// ── Отвори отчет за конкретна дата (от банер / диалог) ──
window.drNewReportForDate = async function(date) {
  if (!date) return;
  try {
    _drDocId  = null;
    _drData   = null;
    _drStatus = "draft";
    const dateEl = document.getElementById("drDate");
    if (dateEl) { dateEl.value = date; dateEl.disabled = false; }
    _updateDrDateWeekday();
    clearDrForm();
    updateDrStatusUI();
    hideDrBanner();
    await loadOrCreateReport();
    // Scroll to top using both window and container (handles all layout modes)
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("storeTabDrContent")?.scrollTo({ top: 0, behavior: "smooth" });
    // Brief visual highlight on the date input so user sees it changed
    if (dateEl) {
      dateEl.classList.add("dr-date-flash");
      setTimeout(() => dateEl.classList.remove("dr-date-flash"), 1000);
    }
  } catch (err) {
    console.error("drNewReportForDate:", err);
    alert("Грешка при зареждане на отчет за " + date + ": " + err.message);
  }
};

// ── Банер за незатворени дни ──────────────────────────
async function checkMissingDays() {
  const banner = document.getElementById("drMissingBanner");
  if (!banner || !_drShopId) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const snap  = await getDocs(query(
      collection(db, "daily_reports"),
      where("shopId", "==", _drShopId),
      where("status", "==", "closed")
    ));
    if (snap.empty) { banner.style.display = "none"; return; }

    const closedDates = snap.docs.map(d => d.data().date).sort();
    const lastClosed  = closedDates[closedDates.length - 1];
    if (lastClosed >= today) { banner.style.display = "none"; return; }

    const closedSet = new Set(closedDates);
    const missing   = [];
    const d = new Date(lastClosed + "T12:00:00");
    d.setDate(d.getDate() + 1);
    while (d.toISOString().slice(0, 10) < today) {
      const ds = d.toISOString().slice(0, 10);
      if (!closedSet.has(ds)) missing.push(ds);
      d.setDate(d.getDate() + 1);
    }
    if (!missing.length) { banner.style.display = "none"; return; }

    const fmt = s => s.slice(8, 10) + "." + s.slice(5, 7);
    const shown = missing.slice(0, 4).map(fmt).join(", ");
    const extra = missing.length > 4 ? ` и още ${missing.length - 4}` : "";
    banner.style.display = "";
    banner.innerHTML =
      `<span>⚠️ Незатворени дни: <strong>${missing.length}</strong> — ${shown}${extra}</span>` +
      `<button class="dr-missing-btn" onclick="drNewReportForDate('${missing[0]}')">` +
      `Попълни ${fmt(missing[0])}</button>`;
  } catch (e) { banner.style.display = "none"; }
}

// ── Нов отчет (предлага умна дата) ────────────────────
window.drNewReport = async function() {
  _drDocId  = null;
  _drData   = null;
  _drStatus = "draft";
  const dateEl = document.getElementById("drDate");
  if (dateEl) dateEl.disabled = false;
  clearDrForm();
  updateDrStatusUI();
  hideDrBanner();
  const suggested = await suggestNextDrDate();
  if (dateEl) dateEl.value = suggested;
  _updateDrDateWeekday();
  await loadOrCreateReport();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.drScrollToHistory = function() {
  document.getElementById("drRecentSection")?.scrollIntoView({ behavior: "smooth" });
};

// ── Запази (draft или редакция на затворен) ──────────
window.saveDailyReport = async function() {
  if (_drStatus === "closed" && _drData?.editAllowed) {
    try {
      await saveClosedReportEdits();
      await loadRecentReports();
    } catch (_) {}
    return;
  }
  try {
    await persistReport("draft");
    await loadRecentReports();
  } catch (_) { /* handled inside persistReport */ }
};

// ── Затвори деня ─────────────────────────────────────
window.confirmCloseDay = async function() {
  if (_drStatus === "closed") return;

  const d = collectDrData();

  // Preview на транзакциите
  const store = _drShopId === "store1" ? "М1" : "М2";
  let preview = `📋 ЗАТВОРИ ДЕН — ${d.date} (${store})\n\nЩе се създадат записи в системата:\n`;
  if (d.totalCashIncome   > 0) preview += `\n  ✅ Приход КЕШ:       ${d.totalCashIncome.toFixed(2)} €`;
  if (d.totalPosIncome    > 0) preview += `\n  ✅ Приход POS:       ${d.totalPosIncome.toFixed(2)} €`;
  if ((d.totalSideIncomes||0) > 0) preview += `\n  ✅ Странични приходи: ${d.totalSideIncomes.toFixed(2)} €`;
  if (d.totalGoodsExpense > 0) preview += `\n  🔴 Разход Стоки:     ${d.totalGoodsExpense.toFixed(2)} €`;
  if (d.totalOtherExpense > 0) preview += `\n  🔴 Разход Други:     ${d.totalOtherExpense.toFixed(2)} €`;
  if ((d.totalAdvances||0) > 0)   preview += `\n  💰 Аванси:           ${d.totalAdvances.toFixed(2)} €`;
  preview += `\n\n📊 Крайна каса: ${d.endCash.toFixed(2)} €`;
  if (d.endCash < 0) preview += `\n⚠️  Внимание: Крайната каса е отрицателна!`;
  preview += `\n\nСлед затваряне не може да се редактира без разрешение от Собственика.\nПродължи?`;

  if (!confirm(preview)) return;

  const saveBtn  = document.getElementById("drSaveBtn");
  const closeBtn = document.getElementById("drCloseBtn");
  if (saveBtn)  saveBtn.disabled = true;
  if (closeBtn) closeBtn.disabled = true;

  // ── Стъпка 1: запис на отчета ────────────────────────
  let report;
  try {
    report = await persistReport("closed");
  } catch (err) {
    console.error("[closeDay] persistReport:", err);
    if (err.message !== "Дублиран отчет" && err.message !== "Липсва дата") {
      showDrBanner(`❌ Грешка при запис на отчета (daily_reports): ${err.message}`, "error");
    }
    if (saveBtn)  saveBtn.disabled = false;
    if (closeBtn) closeBtn.disabled = false;
    return;
  }

  // ── Стъпка 2: update на доставчиците (некритична) ───
  try {
    await updateSuppliersLastUsed(report.expensesGoods);
  } catch (err) {
    console.warn("[closeDay] updateSuppliersLastUsed (некритична):", err);
    // Не спираме затварянето заради доставчици
  }

  // ── Стъпка 3: записи в records ───────────────────────
  try {
    await createMainRecordsFromDr(report);
  } catch (err) {
    console.error("[closeDay] createMainRecordsFromDr:", err);
    showDrBanner(`❌ Грешка при запис на транзакциите (records): ${err.message}`, "error");
    if (saveBtn)  saveBtn.disabled = false;
    if (closeBtn) closeBtn.disabled = false;
    return;
  }

  // ── Стъпка 4: аванси (некритична) ───────────────────
  try {
    await createAdvancesFromDr(report, _drDocId);
  } catch (err) {
    console.warn("[closeDay] createAdvancesFromDr (некритична):", err);
  }

  // ── Стъпка 5: известие към собственика (некритична) ─
  try {
    await sendOwnerNotification(report);
  } catch (err) {
    console.warn("[closeDay] sendOwnerNotification (некритична):", err);
  }

  updateDrStatusUI();
  showDrBanner("✅ Денят е затворен! Данните са изпратени към Собственика.", "success");
  await loadRecentReports();

  // ── Предложи следващия незатворен ден ───────────────
  const today = new Date().toISOString().slice(0, 10);
  const closedDate = report.date;
  const nextD = new Date(closedDate + "T12:00:00");
  nextD.setDate(nextD.getDate() + 1);
  const nextDate = nextD.toISOString().slice(0, 10);
  if (nextDate <= today) {
    const nextSnap = await getDocs(query(
      collection(db, "daily_reports"),
      where("shopId", "==", _drShopId),
      where("date",   "==", nextDate),
      where("status", "==", "closed"),
      limit(1)
    ));
    if (nextSnap.empty) {
      const fmt = s => s.slice(8, 10) + "." + s.slice(5, 7) + "." + s.slice(0, 4);
      if (confirm(`✅ Отчет за ${fmt(closedDate)} е затворен!\n\nИскаш ли да попълниш ${fmt(nextDate)}?`)) {
        await drNewReportForDate(nextDate);
      }
    }
  }
};

async function persistReport(status) {
  const data  = collectDrData();
  const now   = new Date().toISOString();
  const isNew = !_drDocId;

  if (!data.date) {
    alert("⚠️ Моля, въведи дата.");
    throw new Error("Липсва дата");
  }

  // Проверка за дублиран отчет само при нов документ
  if (isNew) {
    const dupQ    = query(
      collection(db, "daily_reports"),
      where("shopId", "==", _drShopId),
      where("date",   "==", data.date),
      limit(1)
    );
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      _drDocId  = dupSnap.docs[0].id;
      _drData   = dupSnap.docs[0].data();
      alert(`⚠️ Вече има отчет за ${data.date}! Заредено е съществуващото.`);
      populateDrForm(_drData);
      updateDrStatusUI();
      throw new Error("Дублиран отчет");
    }
  }

  const action    = isNew ? "create" : (status === "closed" ? "close" : "save");
  const changeLog = [...(_drData?.changeLog || []), {
    userId: currentUserId, email: currentUserEmail, timestamp: now, action
  }];

  const payload = {
    shopId:              _drShopId,
    date:                data.date,
    status,
    startCash:           data.startCash,
    shifts:              data.shifts,
    expensesGoods:       data.expensesGoods,
    expensesOther:       data.expensesOther,
    sideIncomes:         data.sideIncomes,
    advances:            data.advances,
    totalCashIncome:     data.totalCashIncome,
    totalPosIncome:      data.totalPosIncome,
    totalGoodsExpense:   data.totalGoodsExpense,
    totalOtherExpense:   data.totalOtherExpense,
    cashGoodsExpense:    data.cashGoodsExpense   || 0,
    cashOtherExpense:    data.cashOtherExpense   || 0,
    cashExpenseTotal:    data.cashExpenseTotal   || 0,
    cardGoodsExpense:    data.cardGoodsExpense   || 0,
    cardOtherExpense:    data.cardOtherExpense   || 0,
    cardExpenseTotal:    data.cardExpenseTotal   || 0,
    bankGoodsExpense:    data.bankGoodsExpense   || 0,
    bankOtherExpense:    data.bankOtherExpense   || 0,
    bankExpenseTotal:    data.bankExpenseTotal   || 0,
    totalSideIncomes:    data.totalSideIncomes,
    cashSideIncomes:     data.cashSideIncomes  || 0,
    cardSideIncomes:     data.cardSideIncomes  || 0,
    bankSideIncomes:     data.bankSideIncomes  || 0,
    totalAdvances:       data.totalAdvances,
    endCash:             data.endCash,
    createdBy:    isNew ? currentUserId    : (_drData?.createdBy    || currentUserId),
    createdAt:    isNew ? now              : (_drData?.createdAt    || now),
    lastModifiedBy:    currentUserId,
    lastModifiedAt:    now,
    changeLog,
    transferredToOwner:   status === "closed",
    linkedTransactionIds: _drData?.linkedTransactionIds || []
  };

  if (status === "closed") {
    payload.closedBy = currentUserId;
    payload.closedAt = now;
  }

  if (_drDocId) {
    await updateDoc(doc(db, "daily_reports", _drDocId), payload);
  } else {
    const docId = `${_drShopId}_${data.date}`;
    await setDoc(doc(db, "daily_reports", docId), payload, { merge: true });
    _drDocId = docId;
  }

  _refreshOwnerReportInCache(payload, _drDocId);
  _drData   = payload;
  _drStatus = status;

  if (status === "draft") showDrBanner("💾 Запазено!", "info");
  renderDrChangeLog(changeLog);
  return payload;
}

// ── Обновяване на доставчиците ───────────────────────
async function updateSuppliersLastUsed(expensesGoods) {
  const now   = new Date().toISOString();
  const names = [...new Set(
    (expensesGoods || [])
      .filter(g => g.supplier?.trim() && g.amount > 0)
      .map(g => g.supplier.trim())
  )];

  for (const name of names) {
    const existing = _suppliers.find(s => s.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      await updateDoc(doc(db, "suppliers", existing.id), { lastUsed: now });
    } else {
      await addDoc(collection(db, "suppliers"), { shopId: _drShopId, name, lastUsed: now });
    }
  }
  await loadSuppliers();
}

// ── Прехвърляне към главната система (records) ────────
async function createMainRecordsFromDr(report) {
  const store       = report.shopId === "store1" ? "1" : "2";
  const note        = `Дневен отчет М${store}`;
  const ids         = [];
  const drDocId     = _drDocId;
  const drMeta      = { fromDailyReport: true, dailyReportId: drDocId };

  if (report.totalCashIncome > 0) {
    const ref = await addDoc(collection(db, "records"), {
      date: report.date, type: "Приход", method: "Кеш",
      amount: report.totalCashIncome, store, category: "Оборот", note, imageUrl: "", ...drMeta
    });
    ids.push(ref.id);
  }

  if (report.totalPosIncome > 0) {
    const ref = await addDoc(collection(db, "records"), {
      date: report.date, type: "Приход", method: "Карта",
      amount: report.totalPosIncome, store, category: "Оборот", note, imageUrl: "", ...drMeta
    });
    ids.push(ref.id);
  }

  const goodsByMethod = {};
  for (const g of (report.expensesGoods || [])) {
    if (!g.amount) continue;
    const m = g.method || "Кеш";
    if (!goodsByMethod[m]) goodsByMethod[m] = { total: 0, names: [] };
    goodsByMethod[m].total += g.amount;
    if (g.supplier) goodsByMethod[m].names.push(g.supplier);
  }
  for (const [method, data] of Object.entries(goodsByMethod)) {
    const suppNames = data.names.join(", ") || note;
    const ref = await addDoc(collection(db, "records"), {
      date: report.date, type: "Разход", method,
      amount: r2(data.total), store, category: "Стока", note: suppNames, imageUrl: "", ...drMeta
    });
    ids.push(ref.id);
  }

  const otherByMethod = {};
  for (const o of (report.expensesOther || [])) {
    if (!o.amount) continue;
    const m = o.method || "Кеш";
    if (!otherByMethod[m]) otherByMethod[m] = { total: 0, descs: [] };
    otherByMethod[m].total += o.amount;
    if (o.description) otherByMethod[m].descs.push(o.description);
  }
  for (const [method, data] of Object.entries(otherByMethod)) {
    const otherNote = data.descs.join(", ") || note;
    const ref = await addDoc(collection(db, "records"), {
      date: report.date, type: "Разход", method,
      amount: r2(data.total), store, category: "Друго", note: otherNote, imageUrl: "", ...drMeta
    });
    ids.push(ref.id);
  }

  for (const si of (report.sideIncomes || [])) {
    if (!si.amount) continue;
    const siMethod = si.method === "Карта" ? "Карта" : si.method === "Банков превод" ? "Банков превод" : "Кеш";
    const ref = await addDoc(collection(db, "records"), {
      date: report.date, type: "Приход", method: siMethod,
      amount: si.amount, store, category: "Друг приход",
      note: si.description || `Страничен приход М${store}`, imageUrl: "", ...drMeta
    });
    ids.push(ref.id);
  }

  if (drDocId && ids.length) {
    await updateDoc(doc(db, "daily_reports", drDocId), { linkedTransactionIds: ids });
    if (_drData) _drData.linkedTransactionIds = ids;
  }
  return ids;
}

// ── Записване на аванси в колекция "advances" ──────────
async function createAdvancesFromDr(report, reportId) {
  const month = (report.date || "").slice(0, 7);
  for (const adv of (report.advances || [])) {
    if (!adv.amount) continue;
    await addDoc(collection(db, "advances"), {
      shopId:             report.shopId,
      employeeId:         adv.employeeId   || "",
      employeeName:       adv.employeeName || "",
      amount:             adv.amount,
      date:               report.date,
      month,
      note:               adv.note || "",
      linkedReportId:     reportId || "",
      status:             "pending",
      deductedInSalaryId: ""
    });
  }
}

// ── Обновяване на свързаните транзакции (при редакция) ─
async function updateLinkedTransactions(report) {
  const oldIds = _drData?.linkedTransactionIds || [];
  for (const id of oldIds) {
    try { await deleteDoc(doc(db, "records", id)); } catch (_) {}
  }
  await createMainRecordsFromDr(report);
}

// ── Изпращане на известие към Собственика ──────────────
async function sendOwnerNotification(report) {
  try {
    const store = report.shopId === "store1" ? "1" : "2";
    await addDoc(collection(db, "notifications"), {
      type:          "daily_report_closed",
      shopId:        report.shopId,
      date:          report.date,
      endCash:       report.endCash,
      message:       `Магазин ${store} затвори деня ${report.date} — Крайна каса: ${report.endCash.toFixed(2)} €`,
      forOwner:      true,
      read:          false,
      timestamp:     new Date().toISOString(),
      dailyReportId: _drDocId
    });
  } catch (e) { console.warn("sendOwnerNotification:", e); }
}

// Обновява _drOwnerReports след запис, за да не вижда собственикът стари стойности.
// Без това: owner панелът показва кеширани числа до пълно зареждане (F5).
function _refreshOwnerReportInCache(payload, docId) {
  if (!Array.isArray(_drOwnerReports)) return;
  const idx = _drOwnerReports.findIndex(r => r.id === docId);
  const entry = { ...payload, id: docId };
  if (idx >= 0) {
    _drOwnerReports[idx] = entry;
  } else {
    _drOwnerReports.unshift(entry);
  }
  if (typeof window.applyDrFilters === "function") window.applyDrFilters();
}

// ── Запази редакция на затворен отчет ──────────────────
async function saveClosedReportEdits() {
  const data = collectDrData();
  const now  = new Date().toISOString();

  const changeLog = [...(_drData?.changeLog || []), {
    userId: currentUserId, email: currentUserEmail, timestamp: now, action: "edit"
  }];

  const payload = {
    shopId: _drShopId, date: data.date, status: "closed",
    startCash: data.startCash, shifts: data.shifts,
    expensesGoods: data.expensesGoods, expensesOther: data.expensesOther,
    sideIncomes: data.sideIncomes, advances: data.advances,
    totalCashIncome: data.totalCashIncome, totalPosIncome: data.totalPosIncome,
    totalGoodsExpense: data.totalGoodsExpense, totalOtherExpense: data.totalOtherExpense,
    cashGoodsExpense: data.cashGoodsExpense || 0, cashOtherExpense: data.cashOtherExpense || 0, cashExpenseTotal: data.cashExpenseTotal || 0,
    cardGoodsExpense: data.cardGoodsExpense || 0, cardOtherExpense: data.cardOtherExpense || 0, cardExpenseTotal: data.cardExpenseTotal || 0,
    bankGoodsExpense: data.bankGoodsExpense || 0, bankOtherExpense: data.bankOtherExpense || 0, bankExpenseTotal: data.bankExpenseTotal || 0,
    totalSideIncomes: data.totalSideIncomes,
    cashSideIncomes: data.cashSideIncomes || 0, cardSideIncomes: data.cardSideIncomes || 0, bankSideIncomes: data.bankSideIncomes || 0,
    totalAdvances: data.totalAdvances,
    endCash: data.endCash,
    createdBy: _drData.createdBy, createdAt: _drData.createdAt,
    lastModifiedBy: currentUserId, lastModifiedAt: now,
    changeLog,
    editAllowed:          false,
    transferredToOwner:   true,
    linkedTransactionIds: _drData.linkedTransactionIds || []
  };

  await updateDoc(doc(db, "daily_reports", _drDocId), payload);
  _refreshOwnerReportInCache(payload, _drDocId);
  _drData   = payload;
  _drStatus = "closed";

  await updateLinkedTransactions(payload);
  renderDrChangeLog(changeLog);
  updateDrStatusUI();
  showDrBanner("✅ Промените са запазени и изпратени към Собственика.", "success");
}

// ── Статус UI ────────────────────────────────────────
function updateDrStatusUI() {
  const closed      = _drStatus === "closed";
  const editAllowed = closed && !!_drData?.editAllowed;

  document.querySelectorAll("#storeApp .dr-input").forEach(el => {
    el.disabled = closed && !editAllowed;
  });
  // Началната каса НИКОГА не се редактира — винаги се прехвърля автоматично
  const scEl = document.getElementById("drStartCash");
  if (scEl) { scEl.readOnly = true; scEl.tabIndex = -1; }
  const dateEl = document.getElementById("drDate");
  if (dateEl) dateEl.disabled = closed && !editAllowed;

  const saveBtn  = document.getElementById("drSaveBtn");
  const closeBtn = document.getElementById("drCloseBtn");

  if (saveBtn) {
    saveBtn.disabled = closed && !editAllowed;
    saveBtn.innerHTML = editAllowed
      ? '<i class="fa-solid fa-floppy-disk"></i> Запази промените'
      : '<i class="fa-solid fa-floppy-disk"></i> Запази черновата';
  }
  if (closeBtn) closeBtn.disabled = closed;

  const badge = document.getElementById("drStatusBadge");
  if (badge) {
    badge.textContent = closed ? "Затворен" : "Чернова";
    badge.className   = "dr-status-badge " + (closed ? "dr-badge-closed" : "dr-badge-draft");
  }

  if (editAllowed) {
    showDrBanner("✏️ Редакцията е разрешена от Собственика — запази промените след корекцията.", "info");
  } else if (closed) {
    const t = (_drData?.closedAt || "").slice(0, 16).replace("T", " ") || "—";
    showDrBanner(`🔒 Затворен (${t}) — само за четене`, "closed");
  } else {
    hideDrBanner();
  }
}

function drSetLoading(on) {
  const btn = document.getElementById("drSaveBtn");
  if (btn) btn.disabled = on;
}

function showDrBanner(msg, type) {
  const el = document.getElementById("drStatusBanner");
  if (!el) return;
  el.textContent = msg;
  el.className   = `dr-status-banner dr-banner-${type}`;
  el.classList.remove("hidden");
}

function hideDrBanner() {
  document.getElementById("drStatusBanner")?.classList.add("hidden");
}

// ── Последни 10 отчета (real-time) ───────────────────
function loadRecentReports() {
  const el = document.getElementById("drRecentList");
  if (!el || !_drShopId) return;

  if (_recentReportsUnsub) { _recentReportsUnsub(); _recentReportsUnsub = null; }

  el.innerHTML = '<div class="tasks-empty">Зареждане...</div>';

  const q = query(
    collection(db, "daily_reports"),
    where("shopId", "==", _drShopId)
  );

  _recentReportsUnsub = onSnapshot(q, (snap) => {
    const sorted = snap.docs
      .filter(d => d.data() && typeof d.data().date === "string")
      .sort((a, b) => b.data().date.localeCompare(a.data().date))
      .slice(0, 10);

    if (!sorted.length) {
      el.innerHTML = '<div class="tasks-empty">Все още няма отчети</div>';
      return;
    }

    const tsToYMD = (v) => {
      if (!v) return "";
      if (typeof v === "string") return v.slice(0, 10);
      if (typeof v.toDate === "function") {
        try { return v.toDate().toISOString().slice(0, 10); } catch { return ""; }
      }
      if (v.seconds) {
        try { return new Date(v.seconds * 1000).toISOString().slice(0, 10); } catch { return ""; }
      }
      return "";
    };

    const fmt = n => (Number(n) || 0).toFixed(2) + " €";
    el.innerHTML = sorted.map(d => {
      const r       = { id: d.id, ...d.data() };
      const closed  = r.status === "closed";
      const active  = r.id === _drDocId ? "dr-hist-active" : "";
      const created = tsToYMD(r.createdAt);
      const delayed = created && created > r.date
        ? `<span class="dr-hist-delayed" title="Въведен на ${created}">⏰</span>` : "";
      return `
        <div class="dr-hist-item ${active}" onclick="openDrReport('${r.id}')">
          <div class="dr-hist-top">
            <strong>${r.date}</strong> <span style="color:var(--text3);font-size:.85em;">${_ymdToWeekday(r.date)}</span>${delayed}
            <span class="dr-hist-badge ${closed ? "badge-closed" : "badge-draft"}">
              ${closed ? "✅ Затворен" : "📝 Чернова"}
            </span>
          </div>
          <div class="dr-hist-amounts">
            <span>💰 КЕШ: ${fmt(r.totalCashIncome)}</span>
            <span>💳 POS: ${fmt(r.totalPosIncome)}</span>
            <span class="${_recalcEndCash(r) >= 0 ? "pos" : "neg"}">🏁 Крайна: ${fmt(_recalcEndCash(r))}</span>
          </div>
        </div>`;
    }).join("");
  }, (err) => {
    console.error("loadRecentReports onSnapshot:", err);
    el.innerHTML = '<div class="tasks-empty">Грешка при зареждане</div>';
  });

  checkMissingDays();
}

window.openDrReport = async function(docId) {
  try {
    const snap = await getDoc(doc(db, "daily_reports", docId));
    if (!snap.exists()) return;
    _drDocId  = docId;
    _drData   = snap.data();
    _drStatus = _drData.status || "draft";
    const dateEl = document.getElementById("drDate");
    if (dateEl) dateEl.value = _drData.date || "";
    _updateDrDateWeekday();
    updateDrOtherDescOptions();
    populateDrForm(_drData);
    updateDrStatusUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
    await loadRecentReports();
  } catch (err) {
    alert("Грешка: " + err.message);
  }
};

// ── Лог на промени ───────────────────────────────────
function renderDrChangeLog(log) {
  const el = document.getElementById("drChangeLog");
  if (!el) return;
  if (!log?.length) { el.classList.add("hidden"); return; }

  const labels = {
    create: "📋 Създаден", save: "💾 Запазен",
    close:  "🔒 Затворен", edit: "✏️ Редактиран"
  };
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="dr-section-title" style="margin-top:0;">📋 Лог на промени</div>
    ${log.slice().reverse().map(l => `
      <div class="dr-log-row">
        <span class="dr-log-action">${labels[l.action] || l.action}</span>
        <span class="dr-log-user">${escHtml(l.email || "—")}</span>
        <span class="dr-log-time">${(l.timestamp || "").slice(0, 16).replace("T", " ")}</span>
      </div>`).join("")}`;
}

// ════════════════════════════════════════════════
// 📋 ДНЕВНИ ОТЧЕТИ — изглед за Собственика
// ════════════════════════════════════════════════

let _drOwnerReports       = [];
let _currentModalReportId = null;

// ── Зареждане на екрана (real-time) ─────────────────
function loadDailyReportsScreen() {
  const tbody = document.getElementById("drOwnerTableBody");
  if (!tbody) return;

  if (_ownerReportsUnsub) { _ownerReportsUnsub(); _ownerReportsUnsub = null; }

  tbody.innerHTML = '<tr><td colspan="8" class="tasks-empty">Зареждане...</td></tr>';

  loadOwnerNotifications();

  const q = query(collection(db, "daily_reports"), orderBy("date", "desc"));

  _ownerReportsUnsub = onSnapshot(q, (snap) => {
    window._drOwnerReports = _drOwnerReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const monthEl = document.getElementById("drFilterMonth");
    if (monthEl && !monthEl.value) {
      monthEl.value = new Date().toISOString().slice(0, 7);
    }
    applyDrFilters();
  }, (err) => {
    console.error("loadDailyReportsScreen onSnapshot:", err);
    tbody.innerHTML = `<tr><td colspan="8" class="tasks-empty">Грешка: ${err.message}</td></tr>`;
  });
}

window.applyDrFilters = function() {
  const store  = document.getElementById("drFilterStore")?.value  || "";
  const month  = document.getElementById("drFilterMonth")?.value  || "";
  const status = document.getElementById("drFilterStatus")?.value || "";

  let list = _drOwnerReports;
  if (store)  list = list.filter(r => r.shopId === store);
  if (month)  list = list.filter(r => (r.date || "").startsWith(month));
  if (status) list = list.filter(r => r.status === status);

  renderDrOwnerTable(list);
};

function renderDrOwnerTable(reports) {
  const tbody = document.getElementById("drOwnerTableBody");
  if (!tbody) return;

  window._ownerReportsCache = reports;

  if (!reports.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="tasks-empty">Няма отчети за избраните критерии</td></tr>';
    return;
  }

  const fmt = n => (n || 0).toFixed(2) + " €";
  const tot = reports.reduce((acc, r) => ({
    inc: acc.inc + (r.totalCashIncome || 0) + (r.totalPosIncome || 0),
    exp: acc.exp + (r.totalGoodsExpense || 0) + (r.totalOtherExpense || 0),
    end: acc.end + _recalcEndCash(r)
  }), { inc: 0, exp: 0, end: 0 });

  // Строим map за бърз lookup на предишния затворен отчет по магазин
  const closedByShop = {};
  [...reports].sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
    if (r.status === "closed") closedByShop[`${r.shopId}_${r.date}`] = r;
  });
  const getPrev = (r) => {
    const sorted = Object.values(closedByShop)
      .filter(x => x.shopId === r.shopId && x.date < r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0] || null;
  };

  tbody.innerHTML = reports.map(r => {
    const closed  = r.status === "closed";
    const store   = r.shopId === "store1" ? "М1" : "М2";
    const income  = r2((r.totalCashIncome || 0) + (r.totalPosIncome || 0));
    const expense = r2((r.totalGoodsExpense || 0) + (r.totalOtherExpense || 0));
    const endRecalc = _recalcEndCash(r);
    const endOk   = endRecalc >= 0;
    const prev    = getPrev(r);
    const prevEnd = prev ? _recalcEndCash(prev) : null;
    const isMismatch = prev && Math.abs(prevEnd - Number(r.startCash || 0)) > 0.01;
    const warnIcon = isMismatch
      ? ` <span title="Не съвпада с крайна каса на ${prev.date} (${prevEnd.toFixed(2)} €)" style="color:#e74c3c;cursor:help">⚠️</span>`
      : '';
    return `
      <tr class="${closed ? "" : "dr-owner-draft-row"}">
        <td>${r.date || "—"}${r.date ? ` <span style="color:var(--text3);font-size:.85em;">(${_ymdToWeekday(r.date)})</span>` : ""}</td>
        <td>${store}</td>
        <td><span class="dr-hist-badge ${closed ? "badge-closed" : "badge-draft"}">${closed ? "✅ Затворен" : "📝 Чернова"}</span></td>
        <td class="mono">${fmt(r.startCash)}${warnIcon}</td>
        <td class="mono pos">${fmt(income)}</td>
        <td class="mono neg">${fmt(expense)}</td>
        <td class="mono ${endOk ? "pos" : "neg"}">${fmt(endRecalc)}</td>
        <td><button class="btn-icon btn-dr-link" onclick="openDrDetailModal('${r.id}')" title="Детайли">📋</button></td>
      </tr>`;
  }).join("") + `
    <tr class="dr-owner-totals-row">
      <td colspan="4"><strong>Общо (${reports.length})</strong></td>
      <td class="mono pos"><strong>${fmt(r2(tot.inc))}</strong></td>
      <td class="mono neg"><strong>${fmt(r2(tot.exp))}</strong></td>
      <td class="mono ${tot.end >= 0 ? "pos" : "neg"}"><strong>${fmt(r2(tot.end))}</strong></td>
      <td></td>
    </tr>`;
}

// ── Известия за Собственика ──────────────────────────
async function loadOwnerNotifications() {
  const el = document.getElementById("drOwnerNotifArea");
  if (!el) return;

  try {
    const snap = await getDocs(query(
      collection(db, "notifications"),
      where("forOwner", "==", true)
    ));
    const docs = snap.docs
      .filter(d => !d.data().read)
      .sort((a, b) => (b.data().timestamp || "").localeCompare(a.data().timestamp || ""))
      .slice(0, 10);

    if (!docs.length) { el.innerHTML = ""; return; }

    el.innerHTML = docs.map(d => {
      const n = { id: d.id, ...d.data() };
      return `
        <div class="dr-notif-item">
          <span class="dr-notif-icon">🔔</span>
          <span class="dr-notif-msg">${escHtml(n.message)}</span>
          <button class="dr-notif-dismiss" onclick="markNotificationRead('${n.id}', this.parentElement)"
                  title="Маркирай като прочетено">✓</button>
        </div>`;
    }).join("");
  } catch (e) { console.warn("loadOwnerNotifications:", e); }
}

window.markNotificationRead = async function(id, el) {
  try {
    await updateDoc(doc(db, "notifications", id), { read: true });
    el?.remove();
  } catch (e) { console.warn("markNotificationRead:", e); }
};

// ── Детайлен модал ───────────────────────────────────
window.openDrDetailModal = async function(docId) {
  _currentModalReportId = docId;
  const modal = document.getElementById("drDetailModal");
  const body  = document.getElementById("drDetailBody");
  if (!modal || !body) return;

  body.innerHTML = '<div class="tasks-empty">Зареждане...</div>';
  modal.classList.remove("hidden");

  try {
    const snap = await getDoc(doc(db, "daily_reports", docId));
    if (!snap.exists()) { body.innerHTML = '<div class="tasks-empty">Не е намерен.</div>'; return; }

    const r      = snap.data();
    window._currentModalReport = r;
    const closed = r.status === "closed";
    const store  = r.shopId === "store1" ? "Магазин 1" : "Магазин 2";

    document.getElementById("drDetailTitle").textContent = `${store} — ${r.date || ""}`;

    const allowBtn = document.getElementById("drDetailAllowEdit");
    if (allowBtn) {
      allowBtn.disabled  = !closed || r.editAllowed;
      allowBtn.innerHTML = r.editAllowed
        ? '<i class="fa-solid fa-unlock-keyhole"></i> Разрешена'
        : '<i class="fa-solid fa-unlock"></i> Разреши редакция';
    }

    body.innerHTML = buildDrDetailHtml(r);
  } catch (err) {
    body.innerHTML = `<div class="tasks-empty">Грешка: ${err.message}</div>`;
  }
};

window.closeDrDetailModal = function() {
  document.getElementById("drDetailModal")?.classList.add("hidden");
  _currentModalReportId = null;
  window._currentModalReport = null;
};

function buildDrDetailHtml(r) {
  const fmt = n => (n || 0).toFixed(2) + " €";

  const statusMap = { closed: ["🔒 Затворен", "var(--green)"], draft: ["📝 Чернова", "var(--amber)"], open: ["🔓 Отворен", "var(--blue)"] };
  const [statusLabel, statusColor] = statusMap[r.status] || ["—", "var(--text3)"];

  const shiftTotals = (r.shifts || []).reduce((acc, sh) => ({
    oborot: acc.oborot + (sh.cash || 0) + (sh.pos || 0),
    cash:   acc.cash  + (sh.cash  || 0),
    pos:    acc.pos   + (sh.pos   || 0),
    plus:   acc.plus  + (sh.plus  || 0),
    minus:  acc.minus + (sh.minus || 0),
  }), { oborot: 0, cash: 0, pos: 0, plus: 0, minus: 0 });

  const shiftsHtml = (r.shifts || []).map(sh => {
    const oborot = (sh.cash || 0) + (sh.pos || 0);
    return `<tr>
      <td>${escHtml(sh.name || "—")}</td><td>${sh.from}–${sh.to}</td>
      <td>${escHtml(sh.operator || "—")}</td>
      <td class="mono">${oborot.toFixed(2)}</td>
      <td class="mono">${(sh.cash  || 0).toFixed(2)}</td>
      <td class="mono">${(sh.pos   || 0).toFixed(2)}</td>
      <td class="mono">${(sh.plus  || 0).toFixed(2)}</td>
      <td class="mono">${(sh.minus || 0).toFixed(2)}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="8" class="tasks-empty">—</td></tr>';

  const shiftsTfoot = `<tfoot><tr class="dr-total-row">
    <td colspan="3"><strong>Общо</strong></td>
    <td class="mono"><strong>${shiftTotals.oborot.toFixed(2)}</strong></td>
    <td class="mono"><strong>${shiftTotals.cash.toFixed(2)}</strong></td>
    <td class="mono"><strong>${shiftTotals.pos.toFixed(2)}</strong></td>
    <td class="mono"><strong>${shiftTotals.plus.toFixed(2)}</strong></td>
    <td class="mono"><strong>${shiftTotals.minus.toFixed(2)}</strong></td>
  </tr></tfoot>`;

  const sideHtml = (r.sideIncomes || []).map((s, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td>${escHtml(s.description || "—")}</td>
      <td>${escHtml(s.method || "—")}</td>
      <td class="mono pos">${fmt(s.amount)}</td>
    </tr>`).join("") || '<tr><td colspan="4" class="tasks-empty">—</td></tr>';

  const goodsHtml = (r.expensesGoods || []).map((g, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td>${escHtml(g.supplier || "—")}</td>
      <td class="mono neg">${fmt(g.amount)}</td>
    </tr>`).join("") || '<tr><td colspan="3" class="tasks-empty">—</td></tr>';

  const otherHtml = (r.expensesOther || []).map((o, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td>${escHtml(o.description || "—")}</td>
      <td class="mono neg">${fmt(o.amount)}</td>
    </tr>`).join("") || '<tr><td colspan="3" class="tasks-empty">—</td></tr>';

  const advHtml = (r.advances || []).map((a, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td>${escHtml(a.employeeName || "—")}</td>
      <td>${escHtml(a.note || "")}</td>
      <td class="mono neg">${fmt(a.amount)}</td>
    </tr>`).join("") || '<tr><td colspan="4" class="tasks-empty">—</td></tr>';

  const logLabels = { create: "📋 Създаден", save: "💾 Запазен", close: "🔒 Затворен", edit: "✏️ Редактиран" };
  const logHtml = (r.changeLog || []).slice().reverse().map(l => `
    <div class="dr-log-row">
      <span class="dr-log-action">${logLabels[l.action] || l.action}</span>
      <span class="dr-log-user">${escHtml(l.email || "—")}</span>
      <span class="dr-log-time">${(l.timestamp || "").slice(0, 16).replace("T", " ")}</span>
    </div>`).join("") || '<div class="tasks-empty" style="padding:8px 0;">—</div>';

  const t = _recalcReportTotals(r);
  const endCashDisplay = t.endCash;
  const endOk = endCashDisplay >= 0;
  const store  = r.shopId === "store1" ? "Магазин 1" : "Магазин 2";

  let startWarn = '';
  try {
    const cache = window._ownerReportsCache || [];
    const prev = cache
      .filter(x => x.shopId === r.shopId && x.status === "closed" && x.date < r.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (prev) {
      const prevEnd = _recalcEndCash(prev);
      if (Math.abs(prevEnd - Number(r.startCash || 0)) > 0.01) {
        startWarn = ` <span title="Не съвпада с крайна каса на ${prev.date} (${prevEnd.toFixed(2)} €)" style="color:#e74c3c;cursor:help">⚠️</span>`;
      }
    }
  } catch (_) {}

  return `
    <div class="dr-detail-meta" style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
      <span>🏪 <strong>${escHtml(store)}</strong></span>
      <span>📅 <strong>${escHtml(r.date || "—")}</strong>${r.date ? ` <span style="color:var(--text3);font-size:.85em;">(${_ymdToWeekday(r.date)})</span>` : ""}</span>
      <span style="color:${statusColor};font-weight:700;">${statusLabel}</span>
      ${r.editAllowed ? '<span style="color:var(--amber);font-size:.8rem;">✏️ Редакцията е разрешена</span>' : ''}
    </div>

    <div class="dr-detail-summary">
      <div class="dr-detail-sum-row"><span>Начална каса</span><span class="mono">${fmt(r.startCash)}${startWarn}</span></div>
      <div class="dr-detail-sum-row"><span>+ Приходи КЕШ</span><span class="mono pos">${fmt(t.totalCashIncome)}</span></div>
      <div class="dr-detail-sum-row"><span>+ Приходи POS</span><span class="mono pos">${fmt(t.totalPosIncome)}</span></div>
      ${t.totalSideIncomes > 0 ? `<div class="dr-detail-sum-row"><span>+ Странични приходи</span><span class="mono pos">${fmt(t.totalSideIncomes)}</span></div>` : ""}
      ${t.totalShiftPlus > 0 ? `<div class="dr-detail-sum-row"><span>+ Корекции (смени)</span><span class="mono pos">${fmt(t.totalShiftPlus)}</span></div>` : ""}
      <div class="dr-detail-sum-row"><span>− Разход Стоки</span><span class="mono neg">${fmt(t.totalGoodsExpense)}</span></div>
      <div class="dr-detail-sum-row"><span>− Разход Други</span><span class="mono neg">${fmt(t.totalOtherExpense)}</span></div>
      ${t.totalShiftMinus > 0 ? `<div class="dr-detail-sum-row"><span>− Липси (смени)</span><span class="mono neg">${fmt(t.totalShiftMinus)}</span></div>` : ""}
      ${t.totalAdvances > 0 ? `<div class="dr-detail-sum-row"><span>− Аванси (кеш)</span><span class="mono neg">${fmt(t.totalAdvances)}</span></div>` : ""}
      <div class="dr-sum-divider"></div>
      <div class="dr-detail-sum-row dr-detail-sum-final">
        <span><strong>Крайна каса</strong></span>
        <span class="mono ${endOk ? "pos" : "neg"}"><strong>${fmt(endCashDisplay)}</strong></span>
      </div>
    </div>

    <div class="dr-section-title" style="margin-top:16px;">👥 Смени</div>
    <div class="table-responsive">
      <table class="dr-detail-shift-table">
        <thead><tr><th>Смяна</th><th>Час</th><th>Оператор</th><th>Оборот</th><th>КЕШ</th><th>POS</th><th>+</th><th>−</th></tr></thead>
        <tbody>${shiftsHtml}</tbody>
        ${shiftsTfoot}
      </table>
    </div>

    <div class="dr-section-title" style="margin-top:16px;">💰 Странични приходи</div>
    <div class="table-responsive">
      <table class="dr-detail-shift-table">
        <thead><tr><th>#</th><th>Описание</th><th>Метод</th><th>Сума</th></tr></thead>
        <tbody>${sideHtml}</tbody>
      </table>
    </div>

    <div class="dr-section-title" style="margin-top:16px;">📦 Разход Стоки</div>
    <div class="table-responsive">
      <table class="dr-detail-shift-table">
        <thead><tr><th>#</th><th>Доставчик</th><th>Сума</th></tr></thead>
        <tbody>${goodsHtml}</tbody>
      </table>
    </div>

    <div class="dr-section-title" style="margin-top:16px;">💸 Разход Други</div>
    <div class="table-responsive">
      <table class="dr-detail-shift-table">
        <thead><tr><th>#</th><th>Описание</th><th>Сума</th></tr></thead>
        <tbody>${otherHtml}</tbody>
      </table>
    </div>

    <div class="dr-section-title" style="margin-top:16px;">👤 Аванси</div>
    <div class="table-responsive">
      <table class="dr-detail-shift-table">
        <thead><tr><th>#</th><th>Служител</th><th>Бележка</th><th>Сума</th></tr></thead>
        <tbody>${advHtml}</tbody>
      </table>
    </div>

    <div class="dr-section-title" style="margin-top:16px;">📋 Лог на промени</div>
    ${logHtml}

    <div class="dr-detail-meta" style="margin-top:14px;font-size:.75rem;">
      Създаден: ${tsToYMD(r.createdAt, 16).replace("T", " ")} |
      Последна промяна: ${(r.lastModifiedAt || "").slice(0, 16).replace("T", " ")}
    </div>`;
}

// ── Разреши редакция ─────────────────────────────────
window.allowReportEdit = async function() {
  if (!_currentModalReportId) return;
  if (!confirm("Разреши редакция?\n\nУправителят ще може да промени затворения отчет и транзакциите ще се обновят автоматично.")) return;

  try {
    const editAllowedAt = new Date().toISOString();
    await updateDoc(doc(db, "daily_reports", _currentModalReportId), {
      editAllowed:    true,
      editAllowedAt,
      editAllowedBy:  currentUserId
    });

    const idx = _drOwnerReports.findIndex(r => r.id === _currentModalReportId);
    if (idx >= 0) {
      _drOwnerReports[idx] = { ..._drOwnerReports[idx], editAllowed: true, editAllowedAt, editAllowedBy: currentUserId };
      if (typeof window.applyDrFilters === "function") window.applyDrFilters();
    }

    const snap = await getDoc(doc(db, "daily_reports", _currentModalReportId));
    if (snap.exists()) {
      const r = snap.data();
      await addDoc(collection(db, "notifications"), {
        type:          "edit_allowed",
        shopId:        r.shopId,
        date:          r.date,
        message:       `Собственикът разреши редакция на отчет ${r.date}`,
        forShopId:     r.shopId,
        dailyReportId: _currentModalReportId,
        read:          false,
        timestamp:     new Date().toISOString()
      });
    }

    const btn = document.getElementById("drDetailAllowEdit");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> Разрешена'; }
    showStatusMsg("✅ Редакцията е разрешена. Управителят ще получи известие.");
  } catch (err) {
    alert("Грешка: " + err.message);
  }
};

// ── Изтриване на отчет ───────────────────────────────
window.deleteCurrentReport = async function() {
  if (!_currentModalReportId) return;
  if (!confirm("⚠️ Изтрий отчета и всички свързани транзакции?\n\nОперацията е необратима!")) return;

  try {
    const snap = await getDoc(doc(db, "daily_reports", _currentModalReportId));
    if (snap.exists()) {
      for (const id of (snap.data().linkedTransactionIds || [])) {
        try { await deleteDoc(doc(db, "records", id)); } catch (_) {}
      }
    }
    await deleteDoc(doc(db, "daily_reports", _currentModalReportId));

    _drOwnerReports = _drOwnerReports.filter(r => r.id !== _currentModalReportId);
    closeDrDetailModal();
    applyDrFilters();
    showStatusMsg("🗑️ Отчетът е изтрит.");
  } catch (err) {
    alert("Грешка при изтриване: " + err.message);
  }
};

// ── Принтиране / PDF ─────────────────────────────────
window.exportReportPdf = function() {
  const title   = document.getElementById("drDetailTitle")?.textContent || "Дневен отчет";
  const content = document.getElementById("drDetailBody")?.innerHTML    || "";
  const win     = window.open("", "_blank", "width=820,height=700");
  if (!win) { alert("Моля, разреши pop-up прозорците за тази страница."); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:20px}
      h1{font-size:16px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
      th{background:#f0f0f0;font-weight:bold}
      .mono{font-family:monospace;text-align:right}
      .pos{color:green}.neg{color:red}
      .dr-detail-summary,.dr-detail-sum-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #eee}
      .dr-detail-sum-final{font-weight:bold;margin-top:4px}
      .dr-section-title{font-weight:bold;margin:12px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
      .dr-log-row{display:flex;gap:8px;padding:2px 0;font-size:11px}
      .dr-log-action{font-weight:bold;min-width:80px}.dr-log-time{color:#666}
      .dr-num{color:#888;width:24px}.tasks-empty{color:#888;font-style:italic}
      .dr-sum-divider{border-top:2px solid #ccc;margin:4px 0}
      .dr-detail-meta{margin-top:12px;font-size:10px;color:#666}
    </style></head><body>
    <h1>${title}</h1>${content}
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
};

window.exportDailyPDF = async function() {
  const r = window._currentModalReport;
  if (!r) { alert('Отчетът не е зареден.'); return; }
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) { alert('jsPDF не е заредена.'); return; }
  const { jsPDF } = window.jspdf;

  const shopName = r.shopId === 'store1' ? 'Магазин 1' : r.shopId === 'store2' ? 'Магазин 2' : (r.shopId || '—');
  const date     = r.date || '';
  const statusLabel = r.status === 'closed' ? 'Затворен' : r.status === 'draft' ? 'Чернова' : (r.status || '—');
  const fmt = (n) => (Number(n) || 0).toFixed(2);

  try {
    await _loadRobotoFont();

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.addFileToVFS('DejaVuSans.ttf',      _robotoRegular);
    pdf.addFileToVFS('DejaVuSans-Bold.ttf', _robotoBold);
    pdf.addFont('DejaVuSans.ttf',      'DejaVuSans', 'normal');
    pdf.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
    pdf.setFont('DejaVuSans', 'normal');

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;

    // Header
    pdf.setFontSize(14); pdf.setFont('DejaVuSans', 'bold');
    pdf.text('Нон Стоп — Дневен отчет', margin, 14);
    pdf.setFontSize(10); pdf.setFont('DejaVuSans', 'normal');
    pdf.text(`Магазин: ${shopName}    Дата: ${date}    Статус: ${statusLabel}`, margin, 20);
    pdf.setFontSize(9);
    pdf.text(`Генериран: ${new Date().toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}`, pageW - margin, 20, { align: 'right' });
    pdf.setDrawColor(180); pdf.line(margin, 23, pageW - margin, 23);

    // Обобщение
    let y = 28;
    pdf.setFontSize(10); pdf.setFont('DejaVuSans', 'bold');
    pdf.text('Обобщение', margin, y); y += 4;
    pdf.setFontSize(9); pdf.setFont('DejaVuSans', 'normal');

    const t = _recalcReportTotals(r);

    // Провери за несъответствие на начална каса с предишния ден
    let startCashLabel = 'Начална каса';
    try {
      const prevSnap = await getDocs(query(
        collection(db, 'daily_reports'),
        where('shopId', '==', r.shopId),
        where('status', '==', 'closed')
      ));
      const prev = prevSnap.docs.map(d => d.data())
        .filter(x => x.date < r.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (prev) {
        const prevEnd = _recalcEndCash(prev);
        if (Math.abs(prevEnd - Number(r.startCash || 0)) > 0.01) {
          startCashLabel = `Начална каса (⚠ не съвпада с ${prev.date}: ${prevEnd.toFixed(2)} €)`;
        }
      }
    } catch (_) {}

    const sumRows = [
      [startCashLabel,          fmt(r.startCash)],
      ['+ Приходи КЕШ',         fmt(t.totalCashIncome)],
      ['+ Приходи POS',         fmt(t.totalPosIncome)],
      ['+ Странични приходи',   fmt(t.totalSideIncomes)],
      ...(t.totalShiftPlus  > 0 ? [['+ Корекции (смени)', fmt(t.totalShiftPlus)]]  : []),
      ['− Разход Стоки',        fmt(t.totalGoodsExpense)],
      ['− Разход Други',        fmt(t.totalOtherExpense)],
      ...(t.totalShiftMinus > 0 ? [['− Липси (смени)',    fmt(t.totalShiftMinus)]] : []),
      ['− Аванси (кеш)',         fmt(t.totalAdvances)]
    ];
    sumRows.forEach(([label, val]) => {
      pdf.text(label, margin + 2, y);
      pdf.text(`${val} €`, pageW - margin - 2, y, { align: 'right' });
      y += 4;
    });
    pdf.setDrawColor(150); pdf.line(margin, y, pageW - margin, y); y += 4;
    pdf.setFont('DejaVuSans', 'bold');
    pdf.text('Крайна каса', margin + 2, y);
    pdf.text(`${fmt(t.endCash)} €`, pageW - margin - 2, y, { align: 'right' });
    y += 5;

    // Смени
    const shiftTotals = (r.shifts || []).reduce((acc, sh) => ({
      ob: acc.ob + (sh.cash||0) + (sh.pos||0),
      cash: acc.cash + (sh.cash||0), pos: acc.pos + (sh.pos||0),
      plus: acc.plus + (sh.plus||0), minus: acc.minus + (sh.minus||0)
    }), { ob:0, cash:0, pos:0, plus:0, minus:0 });

    pdf.autoTable({
      head: [['Смяна','Час','Оператор','Оборот','КЕШ','POS','+','−']],
      body: (r.shifts || []).map(sh => [
        sh.name || '—', `${sh.from||''}–${sh.to||''}`, sh.operator || '—',
        fmt((sh.cash||0)+(sh.pos||0)), fmt(sh.cash), fmt(sh.pos), fmt(sh.plus), fmt(sh.minus)
      ]),
      foot: [['Общо','','', fmt(shiftTotals.ob), fmt(shiftTotals.cash), fmt(shiftTotals.pos), fmt(shiftTotals.plus), fmt(shiftTotals.minus)]],
      startY: y,
      margin: { left: margin, right: margin },
      styles:      { font: 'DejaVuSans', fontSize: 9, cellPadding: 1.5, halign: 'right' },
      headStyles:  { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles:  { fillColor: [220, 220, 220], textColor: 30, fontStyle: 'bold' },
      columnStyles:{ 0: { halign: 'left' }, 1: { halign: 'left' }, 2: { halign: 'left' } }
    });
    y = (pdf.lastAutoTable?.finalY ?? y) + 4;

    const addSubTable = (title, head, body) => {
      if (!body.length) return;
      if (y > pageH - 50) { pdf.addPage(); y = margin; }
      pdf.setFontSize(10); pdf.setFont('DejaVuSans', 'bold');
      pdf.text(title, margin, y); y += 2;
      pdf.autoTable({
        head: [head], body, startY: y + 2,
        margin: { left: margin, right: margin },
        styles:      { font: 'DejaVuSans', fontSize: 8.5, cellPadding: 1.5 },
        headStyles:  { fillColor: [70, 90, 110], textColor: 255, fontStyle: 'bold' }
      });
      y = (pdf.lastAutoTable?.finalY ?? y) + 4;
    };

    addSubTable('Странични приходи',
      ['#','Описание','Метод','Сума'],
      (r.sideIncomes || []).map((s,i) => [i+1, s.description||'—', s.method||'—', fmt(s.amount)+' €']));

    addSubTable('Разход Стоки',
      ['#','Доставчик','Сума'],
      (r.expensesGoods || []).map((g,i) => [i+1, g.supplier||'—', fmt(g.amount)+' €']));

    addSubTable('Разход Други',
      ['#','Описание','Сума'],
      (r.expensesOther || []).map((o,i) => [i+1, o.description||'—', fmt(o.amount)+' €']));

    addSubTable('Аванси',
      ['#','Служител','Бележка','Сума'],
      (r.advances || []).map((a,i) => [i+1, a.employeeName||'—', a.note||'', fmt(a.amount)+' €']));

    // Подписи
    const signY = pageH - 18;
    pdf.setDrawColor(100); pdf.setTextColor(80); pdf.setFontSize(9); pdf.setFont('DejaVuSans','normal');
    pdf.line(margin, signY, margin + 70, signY);
    pdf.line(pageW - margin - 70, signY, pageW - margin, signY);
    pdf.text('Изготвил (управител)', margin, signY + 5);
    pdf.text('Приел (собственик)', pageW - margin - 70, signY + 5);

    pdf.save(`дневен_отчет_${r.shopId}_${date}.pdf`);
  } catch (err) {
    console.error('exportDailyPDF:', err);
    alert('Грешка при генериране на PDF: ' + (err.message || err));
  }
};

// ════════════════════════════════════════════════
// ⚙️ УПРАВЛЕНИЕ НА АКАУНТИ (само за owner)
// ════════════════════════════════════════════════

const ROLE_LABELS = {
  owner:    "👑 Собственик",
  store1:   "🏪 Магазин 1",
  store2:   "🏪 Магазин 2",
  disabled: "⛔ Деактивиран"
};

// ── Списък на акаунтите ──────────────────────────
async function renderAccountsList() {
  const el = document.getElementById("accountsList");
  if (!el) return;
  el.innerHTML = '<div class="acc-loading">Зареждане...</div>';

  try {
    const snap  = await getDocs(collection(db, "users"));
    const users = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => {
        const order = { owner: 0, store1: 1, store2: 2, disabled: 9 };
        return (order[a.role] ?? 5) - (order[b.role] ?? 5);
      });

    if (!users.length) {
      el.innerHTML = '<div class="acc-empty">Няма акаунти в базата.</div>';
      return;
    }

    el.innerHTML = users.map(u => {
      const isOwner   = u.role === "owner";
      const isMe      = u.uid  === currentUserId;
      const isDisabled = u.role === "disabled";
      const canDelete = !isOwner && !isMe;

      return `
        <div class="acc-row ${isDisabled ? "acc-disabled" : ""}">
          <div class="acc-info">
            <span class="acc-email">${escHtml(u.email || "—")}</span>
            <span class="acc-badge acc-badge-${u.role || "unknown"}">${ROLE_LABELS[u.role] || u.role}</span>
            ${u.createdAt ? `<span class="acc-date">от ${tsToYMD(u.createdAt, 10)}</span>` : ""}
          </div>
          <div class="acc-actions">
            ${canDelete && !isDisabled ? `
              <button class="acc-edit-btn" onclick="editAccountEmail('${u.uid}', '${escHtml(u.email || "")}')"
                      title="Редактирай имейл">
                ✏️ Редактирай
              </button>
              <button class="acc-reset-btn" onclick="openResetPwdModal('${u.uid}', '${escHtml(u.email || "")}')"
                      title="Задай нова парола директно">
                🔑 Reset парола
              </button>
              <button class="btn-danger acc-del-btn" onclick="deactivateAccount('${u.uid}', '${escHtml(u.email || "")}')"
                      title="Деактивирай акаунта">
                <i class="fa-solid fa-ban"></i> Изтрий
              </button>` : ""}
            ${canDelete && isDisabled ? `
              <button class="btn-secondary acc-act-btn" onclick="reactivateAccount('${u.uid}', '${escHtml(u.email || "")}')"
                      title="Реактивирай акаунта">
                <i class="fa-solid fa-rotate-right"></i> Реактивирай
              </button>` : ""}
            ${isMe   ? '<span class="acc-you">← Ти</span>' : ""}
            ${isOwner ? '<span class="acc-owner-badge">Собственик</span>' : ""}
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    console.error("renderAccountsList:", err);
    el.innerHTML = `<div class="acc-empty">Грешка: ${err.message}</div>`;
  }
}

// ── Reset парола — модал с директна смяна (Cloud Function) ──
let _resetPwdUid   = null;
let _resetPwdEmail = null;

window.openResetPwdModal = function(uid, email) {
  _resetPwdUid   = uid;
  _resetPwdEmail = email;
  document.getElementById("resetPwdEmailLbl").textContent = `Акаунт: ${email}`;
  document.getElementById("resetPwdNew").value     = "";
  document.getElementById("resetPwdConfirm").value = "";
  document.getElementById("resetPwdErr").textContent = "";
  const btn = document.getElementById("resetPwdSaveBtn");
  if (btn) { btn.disabled = false; btn.textContent = "Запази"; }
  document.getElementById("resetPwdModal").classList.remove("hidden");
  setTimeout(() => document.getElementById("resetPwdNew").focus(), 60);
};

window.closeResetPwdModal = function() {
  document.getElementById("resetPwdModal").classList.add("hidden");
  _resetPwdUid = null; _resetPwdEmail = null;
};

window.confirmResetPwd = async function() {
  const newPwd  = document.getElementById("resetPwdNew").value;
  const confPwd = document.getElementById("resetPwdConfirm").value;
  const errEl   = document.getElementById("resetPwdErr");
  const btn     = document.getElementById("resetPwdSaveBtn");

  errEl.textContent = "";
  if (newPwd.length < 6) { errEl.textContent = "Паролата трябва да е поне 6 символа."; return; }
  if (newPwd !== confPwd) { errEl.textContent = "Паролите не съвпадат."; return; }

  btn.disabled = true; btn.textContent = "Запазване...";
  try {
    const { getFunctions, httpsCallable } =
      await import("https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js");
    const fns     = getFunctions(app, "us-central1");
    const resetFn = httpsCallable(fns, "resetUserPassword");
    await resetFn({ uid: _resetPwdUid, newPassword: newPwd });
    closeResetPwdModal();
    alert(`✅ Паролата е сменена успешно!\nУведоми управителя за новата парола.`);
  } catch (err) {
    errEl.textContent = `❌ ${err.message}`;
    btn.disabled = false; btn.textContent = "Запази";
  }
};

// ── Редактирай email (само Firestore — auth email непроменен) ──
window.editAccountEmail = async function(uid, currentEmail) {
  const raw = prompt("Нов имейл за показване:", currentEmail);
  if (!raw) return;
  const newEmail = raw.trim().toLowerCase();
  if (newEmail === currentEmail.toLowerCase()) return;
  if (!newEmail.includes("@")) { alert("Невалиден имейл."); return; }
  try {
    await updateDoc(doc(db, "users", uid), { email: newEmail });
    alert(`✅ Имейлът е обновен на: ${newEmail}\n\n⚠️ Бележка: входът в системата остава с оригиналния имейл.`);
    renderAccountsList();
  } catch (err) {
    alert(`❌ Грешка: ${err.message}`);
  }
};

// ── Задаване на роля в UI формата ───────────────
window.setNewAccRole = function(role, btn) {
  document.getElementById("newAccRole").value = role;
  document.querySelectorAll(".acc-role-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
};

// ── Създаване на нов акаунт (вторичен Firebase App) ──
window.createManagedAccount = async function() {
  const email    = (document.getElementById("newAccEmail")?.value    || "").trim();
  const password = (document.getElementById("newAccPassword")?.value || "").trim();
  const role     = document.getElementById("newAccRole")?.value || "store1";

  if (!email || !password) { alert("Попълни имейл и парола."); return; }
  if (password.length < 6) { alert("Паролата трябва да е поне 6 символа."); return; }

  const btn = document.getElementById("createAccBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Създаване..."; }

  // Вторичен app — не изписва текущата сесия на собственика
  const secondaryApp  = initializeApp(firebaseConfig, "acc_reg_" + Date.now());
  const { getAuth: getSecondaryAuth, createUserWithEmailAndPassword: createSecondary } =
    await import("https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js");
  const secondaryAuth = getSecondaryAuth(secondaryApp);

  try {
    const cred = await createSecondary(secondaryAuth, email, password);
    const uid  = cred.user.uid;

    await setDoc(doc(db, "users", uid), {
      email, role,
      createdAt:    new Date().toISOString(),
      createdByUid: currentUserId
    });

    await signOut(secondaryAuth);

    // Изчисти формата
    document.getElementById("newAccEmail").value    = "";
    document.getElementById("newAccPassword").value = "";

    renderAccountsList();
    showAccStatus(`✅ Акаунтът "${email}" е създаден успешно (роля: ${ROLE_LABELS[role] || role}).`, "success");
  } catch (err) {
    console.error("createManagedAccount:", err);
    const msg = err.code === "auth/email-already-in-use"
      ? "Имейлът вече е регистриран."
      : err.message;
    showAccStatus("❌ Грешка: " + msg, "error");
  } finally {
    await deleteApp(secondaryApp);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Създай акаунт'; }
  }
};

// ── Деактивиране (soft-delete) ───────────────────
window.deactivateAccount = async function(uid, email) {
  if (!confirm(`Деактивирай акаунта "${email}"?\n\nПотребителят ще загуби достъп веднага. Можеш да го реактивираш по-късно.`)) return;
  try {
    await updateDoc(doc(db, "users", uid), {
      role:         "disabled",
      disabledAt:   new Date().toISOString(),
      disabledByUid: currentUserId
    });
    renderAccountsList();
    showAccStatus(`✅ Акаунтът "${email}" е деактивиран.`, "success");
  } catch (err) {
    showAccStatus("❌ Грешка: " + err.message, "error");
  }
};

// ── Реактивиране ─────────────────────────────────
window.reactivateAccount = async function(uid, email) {
  const role = prompt(`Роля за реактивиране на "${email}":\n\nВъведи: store1 или store2`);
  if (!role || !["store1", "store2"].includes(role)) { alert("Невалидна роля."); return; }
  try {
    await updateDoc(doc(db, "users", uid), {
      role,
      reactivatedAt:   new Date().toISOString(),
      reactivatedByUid: currentUserId
    });
    renderAccountsList();
    showAccStatus(`✅ Акаунтът "${email}" е реактивиран като ${ROLE_LABELS[role]}.`, "success");
  } catch (err) {
    showAccStatus("❌ Грешка: " + err.message, "error");
  }
};

function showAccStatus(msg, type) {
  const el = document.getElementById("accStatus");
  if (!el) return;
  el.textContent = msg;
  el.className   = `acc-status acc-status-${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 6000);
}

// ── Зареждане на доставчици (owner инструмент) ────────
window.seedSuppliers = async function () {
  const SUPPLIERS = [
    "Грация СК ЕООД", "Ники Плодове", "Табако Трейд Пловдив ООД",
    "Абсолют плюс ООД", "Айс Вайп Дистрибушън ООД", "Амперел ООД",
    "Ареон България ЕООД", "Ацтекс ЕООД", "БалевБИО ЕООД",
    "БББ - Дистрибуция и логистика ЕООД", "Бг лайн 2014 ЕООД",
    "Бон-бон суит ООД", "ВВ кофи груп ООД", "ВЕ и ВЕ ООД",
    "Ведена ООД", "Виктория Нутс ЕООД", "Виста АВТ АД", "Дани",
    "Деливъри ООД", "Диемз ЕООД", "Дима ООД", "Дрип Юръп ООД",
    "Еко клас груп ЕООД", "Експрес логистика и дистрибуция ООД",
    "Елит - П - ЕООД", "Емпорио чипс ЕООД", "ЕП комерс ООД",
    "Здравец Дистрибюшън АД", "Импириъл Табако Дистрибушън ЕООД",
    "Инкофудс ООД", "Интервино",
    "Кока-кола хеленик ботълинг къмпани България АД",
    "Корона С ЕООД", "Макско 2019 ЕООД", "Мистрал България ЕООД",
    "Нико ООД", "Нова Трейд ЕООД", "Обединена млечна компания ЕАД",
    "Орбико България ЕООД", "Орно АД", "Пауърмарк ООД", "Пик Бг ООД",
    "Платинум Трейдинг 2019 ООД", "Рожен - 1 - ООД",
    "Рошен Пловдив - ЕООД", "Сагакс ЕАД", "Сигнал - 2 - ООД",
    "Симид Агро - ЕООД", "Талес 07 ЕООД", "ТЕТА - ЕООД",
    "Ти Ди Ел ЕООД", "Трейд Уинър ЕООД", "Фонте Фреско ЕООД",
    "Фортуна - КОМ", "Фреш Фууд Трейд - ООД", "Фронери България ЕООД",
    "Фрут Корект - ООД", "Хайков ЕООД", "Чембо - 2015 - ЕООД",
    "ПинаДе ЕООД", "Фортланд - АД", "Рожен - 3 - ЕООД",
    "Пластик София - ООД", "Каймест ООД", "Севист Хаус ООД",
    "Краун - 95 - ЕООД", "АХГ - ЕООД", "Анда Дистрибушън - ООД",
    "СТТ - ИМПЕКС - ЕООД", "ИФЕКТ - ЕООД", "Хрис Трейд 2021 - ЕООД",
    "Атмус Трейд - ООД", "Балкан груп", "Регул Нутс - ЕООД",
    "Куков - ЕООД"
  ];

  const btn    = document.getElementById("seedSuppliersBtn");
  const status = document.getElementById("seedSuppliersStatus");
  if (btn) btn.disabled = true;
  const setStatus = t => { if (status) status.textContent = t; };
  setStatus("Зареждане...");

  let count = 0;
  const now = new Date().toISOString();
  console.log("seedSuppliers: старт, " + SUPPLIERS.length + " доставчика × 2 магазина = " + SUPPLIERS.length * 2 + " записа");

  try {
    for (const name of SUPPLIERS) {
      for (const shopId of ["store1", "store2"]) {
        await addDoc(collection(db, "suppliers"), { shopId, name, lastUsed: now });
        count++;
        setStatus(`Зареждане… ${count}/${SUPPLIERS.length * 2}`);
      }
      console.log(`[${count}/${SUPPLIERS.length * 2}] ${name}`);
    }
    console.log(`seedSuppliers: готово, добавени ${count} записа`);
    setStatus(`✅ Готово! Добавени ${count} записа.`);
  } catch (e) {
    console.error("seedSuppliers:", e);
    setStatus(`❌ Грешка: ${e.message}`);
    if (btn) btn.disabled = false;
  }
};

// ════════════════════════════════════════════════════════════
// 🕐 МОДУЛ 4 — РАБОТНИ ЧАСОВЕ
// ════════════════════════════════════════════════════════════

// ── Стейт ─────────────────────────────────────────────────
let _whShopId    = null;
let _whMonth     = "";
let _whEmployees = [];
let _whData      = {};      // {empId: {"YYYY-MM-DD": {hours,shift,note,docId}}}
let _whEmpOpen   = true;
let _whEditEmpId = null;
let _whCellEmpId = null;
let _whCellDate  = null;
let _whMobileDay = "";

// Owner state
let _wageMonth        = "";
let _wageTab          = "month";
let _wageEmployeesAll = [];
let _wageHoursMap     = {};  // {empId: totalHours} for current month

// ── Helpers ────────────────────────────────────────────────
function formatMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const names  = ["Януари","Февруари","Март","Април","Май","Юни",
                  "Юли","Август","Септември","Октомври","Ноември","Декември"];
  return `${names[m - 1]} ${y}`;
}

function whCellClass(h) {
  if (!h || h <= 0)  return "";
  if (h <= 9)  return "wh-cell-normal";
  if (h <= 12) return "wh-cell-long";
  if (h <= 15) return "wh-cell-extra";
  return "wh-cell-double";
}

// ── Init (called at login for store managers) ──────────────
function initWorkHours(shopId) {
  _whShopId = shopId;
  const _now = new Date();
  _whMonth  = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
  _whMobileDay = new Date().toISOString().slice(0, 10);
  const mobDay = document.getElementById("whMobileDay");
  if (mobDay) mobDay.value = _whMobileDay;
  loadEmployees();
}

// ── Tab switching ──────────────────────────────────────────
window.storeShowTab = function(tab) {
  document.getElementById("storeTabDrContent")?.classList.toggle("hidden", tab !== "dailyreport");
  document.getElementById("storeWhScreen")?.classList.toggle("hidden",     tab !== "workhours");
  document.getElementById("storeTabDr")?.classList.toggle("active", tab === "dailyreport");
  document.getElementById("storeTabWh")?.classList.toggle("active", tab === "workhours");
  if (tab === "workhours" && _whShopId) loadWhData();
};

// ── Employee management ────────────────────────────────────
async function loadEmployees() {
  if (!_whShopId) return;
  try {
    const snap = await getDocs(query(
      collection(db, "employees"),
      where("shopId", "==", _whShopId)
    ));
    _whEmployees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _whEmployees.sort((a, b) => {
      if (!!b.active !== !!a.active) return b.active ? 1 : -1;
      return (a.name || "").localeCompare(b.name || "", "bg");
    });
    renderEmployeeList();
    await loadWhData();
  } catch (e) { console.error("loadEmployees:", e); }
}

function empInitials(name) {
  const parts = (name || "?").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0][0].toUpperCase();
}

function renderEmployeeList() {
  const el = document.getElementById("whEmpList");
  if (!el) return;
  if (!_whEmployees.length) {
    el.innerHTML = `<div class="tasks-empty">Добави служители с бутона по-долу</div>`;
    return;
  }
  el.innerHTML = _whEmployees.map(emp => `
    <div class="wh-emp-row ${emp.active ? "" : "wh-emp-inactive"}">
      <div class="wh-emp-avatar">${empInitials(emp.name)}</div>
      <div class="wh-emp-info">
        <div class="wh-emp-name">${escHtml(emp.name)}</div>
        <div class="wh-emp-pos">${escHtml(emp.position || "—")}</div>
      </div>
      <div class="wh-emp-actions">
        <button class="btn-icon" onclick="editEmployee('${emp.id}')" title="Редакция">✏️</button>
        <button class="btn-icon" onclick="toggleEmployeeActive('${emp.id}',${!emp.active})"
                title="${emp.active ? "Деактивирай" : "Активирай"}">
          ${emp.active ? "🚫" : "✅"}
        </button>
      </div>
    </div>`).join("");
}

window.showAddEmpForm = function() {
  _whEditEmpId = null;
  document.getElementById("whEmpFormTitle").textContent = "Нов служител";
  document.getElementById("whEmpName").value     = "";
  document.getElementById("whEmpPosition").value = "Касиер";
  const rateEl = document.getElementById("whEmpRate");
  if (rateEl) rateEl.value = "";
  document.getElementById("whEmpActive").checked = true;
  document.getElementById("whEmpForm").classList.remove("hidden");
  document.getElementById("whEmpName").focus();
};

window.editEmployee = function(id) {
  const emp = _whEmployees.find(e => e.id === id);
  if (!emp) return;
  _whEditEmpId = id;
  document.getElementById("whEmpFormTitle").textContent = "Редакция";
  document.getElementById("whEmpName").value     = emp.name || "";
  document.getElementById("whEmpPosition").value = emp.position || "Касиер";
  const rateEl = document.getElementById("whEmpRate");
  if (rateEl) rateEl.value = emp.hourlyRate > 0 ? emp.hourlyRate : "";
  document.getElementById("whEmpActive").checked = !!emp.active;
  document.getElementById("whEmpForm").classList.remove("hidden");
  document.getElementById("whEmpName").focus();
};

window.cancelEmpForm = function() {
  document.getElementById("whEmpForm").classList.add("hidden");
  _whEditEmpId = null;
};

window.saveEmployee = async function() {
  const name     = document.getElementById("whEmpName").value.trim();
  const position = document.getElementById("whEmpPosition").value;
  const active   = document.getElementById("whEmpActive").checked;
  const rateRaw  = document.getElementById("whEmpRate")?.value;
  const rate     = rateRaw !== "" && rateRaw != null ? (parseFloat(rateRaw) || 0) : null;
  if (!name) { alert("Въведи три имена."); return; }

  const data = { shopId: _whShopId, name, position, active };
  if (rate !== null) data.hourlyRate = rate;
  try {
    if (_whEditEmpId) {
      await updateDoc(doc(db, "employees", _whEditEmpId), data);
    } else {
      data.createdAt         = new Date().toISOString();
      data.hourlyRate        = rate ?? 0;
      data.hourlyRateHistory = [];
      await addDoc(collection(db, "employees"), data);
    }
    document.getElementById("whEmpForm").classList.add("hidden");
    _whEditEmpId = null;
    await loadEmployees();
  } catch (e) { alert("Грешка: " + e.message); }
};

window.toggleEmployeeActive = async function(id, newState) {
  try {
    await updateDoc(doc(db, "employees", id), { active: newState });
    const idx = _whEmployees.findIndex(e => e.id === id);
    if (idx >= 0) _whEmployees[idx].active = newState;
    renderEmployeeList();
    renderWhTable();
  } catch (e) { alert("Грешка: " + e.message); }
};

window.whToggleEmpSection = function() {
  _whEmpOpen = !_whEmpOpen;
  document.getElementById("whEmpBody")?.classList.toggle("hidden", !_whEmpOpen);
  const arrow = document.getElementById("whEmpArrow");
  if (arrow) arrow.textContent = _whEmpOpen ? "▴" : "▾";
};

// ── Month navigation ───────────────────────────────────────
window.whChangeMonth = function(delta) {
  let [y, m] = _whMonth.split("-").map(Number);
  m += delta;
  if (m > 12) { m = 1;  y++; }
  if (m < 1)  { m = 12; y--; }
  _whMonth = `${y}-${String(m).padStart(2, "0")}`;
  const lbl = document.getElementById("whMonthLabel");
  if (lbl) lbl.textContent = formatMonth(_whMonth);
  loadWhData();
};

// ── Load monthly hours data ────────────────────────────────
async function loadWhData() {
  if (!_whShopId || !_whMonth) return;
  const lbl = document.getElementById("whMonthLabel");
  if (lbl) lbl.textContent = formatMonth(_whMonth);
  try {
    const snap = await getDocs(query(
      collection(db, "work_hours"),
      where("shopId", "==", _whShopId)
    ));
    _whData = {};
    snap.docs.filter(d => d.data().date?.startsWith(_whMonth)).forEach(d => {
      const r = d.data();
      if (!_whData[r.employeeId]) _whData[r.employeeId] = {};
      _whData[r.employeeId][r.date] = {
        hours: r.hours, shift: r.shift || "", note: r.note || "", docId: d.id
      };
    });
    renderWhTable();
    renderWhMobile();
  } catch (e) { console.error("loadWhData:", e); }
}

// ── Desktop monthly table ──────────────────────────────────
function renderWhTable() {
  const wrap = document.getElementById("whTableWrap");
  if (!wrap) return;

  const [y, m]    = _whMonth.split("-").map(Number);
  const daysInMon = new Date(y, m, 0).getDate();
  const days      = Array.from({ length: daysInMon }, (_, i) => i + 1);

  const active   = _whEmployees.filter(e => e.active);
  const inactive = _whEmployees.filter(e => !e.active);
  const all      = [...active, ...inactive];

  if (!all.length) {
    wrap.innerHTML = `<div class="tasks-empty">Добави служители за да видиш таблицата</div>`;
    return;
  }

  const DOW_BG   = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDay = todayStr.startsWith(_whMonth) ? parseInt(todayStr.slice(8)) : -1;

  // Ред с дните на седмицата (Пн/Вт/Ср...)
  const dowHeaders = days.map(d => {
    const dow   = new Date(y, m - 1, d).getDay();
    const isWkd = (dow === 0 || dow === 6);
    const isTod = (d === todayDay);
    const cls   = ["wh-day-th wh-dow-th",
                   isWkd ? "wh-day-weekend" : "",
                   isTod ? "wh-day-today"   : ""].filter(Boolean).join(" ");
    return `<th class="${cls}" data-col="${d}">${DOW_BG[dow]}</th>`;
  }).join("");

  // Ред с числата (1/2/3...)
  const dayHeaders = days.map(d => {
    const dow   = new Date(y, m - 1, d).getDay();
    const isWkd = (dow === 0 || dow === 6);
    const isTod = (d === todayDay);
    const cls   = ["wh-day-th",
                   isWkd ? "wh-day-weekend" : "",
                   isTod ? "wh-day-today"   : ""].filter(Boolean).join(" ");
    return `<th class="${cls}" data-col="${d}">${d}</th>`;
  }).join("");

  const rows = all.map(emp => {
    let total = 0;
    const cells = days.map(d => {
      const dateStr = `${_whMonth}-${String(d).padStart(2, "0")}`;
      const cell    = _whData[emp.id]?.[dateStr];
      const h       = cell?.hours;
      if (h) total += h;
      const dow   = new Date(y, m - 1, d).getDay();
      const hCls  = h ? whCellClass(h) : "";
      const wkd   = (dow === 0 || dow === 6) ? "wh-cell-weekend" : "";
      const todCl = (d === todayDay) ? "wh-cell-today-col" : "";
      const inact = emp.active ? "" : "wh-cell-inactive";
      return `<td class="wh-cell ${hCls} ${wkd} ${todCl} ${inact}" data-col="${d}"
                  onclick="openWhCell('${emp.id}','${dateStr}')">${h || ""}</td>`;
    }).join("");
    return `<tr class="${emp.active ? "" : "wh-row-inactive"}">
      <td class="wh-emp-cell">${escHtml(emp.name)}</td>
      ${cells}
      <td class="wh-total-cell">${total || ""}</td>
    </tr>`;
  }).join("");

  const totals = days.map(d => {
    const dateStr  = `${_whMonth}-${String(d).padStart(2, "0")}`;
    const dayTotal = all.reduce((s, e) => s + ((_whData[e.id]?.[dateStr]?.hours) || 0), 0);
    const dow   = new Date(y, m - 1, d).getDay();
    const wkd   = (dow === 0 || dow === 6) ? "wh-cell-weekend" : "";
    const todCl = (d === todayDay) ? "wh-cell-today-col" : "";
    return `<td class="wh-total-cell ${wkd} ${todCl}" data-col="${d}">${dayTotal || ""}</td>`;
  }).join("");

  const grand = all.reduce((s, e) =>
    s + days.reduce((ss, d) =>
      ss + ((_whData[e.id]?.[`${_whMonth}-${String(d).padStart(2,"0")}`]?.hours) || 0), 0), 0);

  wrap.innerHTML = `
    <div class="wh-table-scroll">
      <table class="wh-table">
        <thead>
          <tr class="wh-dow-row">
            <th class="wh-emp-th" rowspan="2">Служител</th>
            ${dowHeaders}
            <th class="wh-total-th" rowspan="2">Общо</th>
          </tr>
          <tr class="wh-num-row">${dayHeaders}</tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="wh-totals-row">
            <td class="wh-emp-cell"><strong>Общо</strong></td>
            ${totals}
            <td class="wh-total-cell"><strong>${grand || ""}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  // Hover по колона (ден) — подсветва всички редове за дадения ден
  const tbl = wrap.querySelector(".wh-table");
  if (tbl) {
    tbl.addEventListener("mouseenter", e => {
      const col = e.target.dataset?.col;
      if (col) tbl.querySelectorAll(`[data-col="${col}"]`)
                   .forEach(el => el.classList.add("wh-col-hover"));
    }, true);
    tbl.addEventListener("mouseleave", e => {
      const col = e.target.dataset?.col;
      if (col) tbl.querySelectorAll(`[data-col="${col}"]`)
                   .forEach(el => el.classList.remove("wh-col-hover"));
    }, true);
  }
}

// ── Mobile day view ────────────────────────────────────────
function renderWhMobile() {
  const wrap = document.getElementById("whMobileView");
  if (!wrap) return;
  const date   = _whMobileDay || new Date().toISOString().slice(0, 10);
  const active = _whEmployees.filter(e => e.active);
  if (!active.length) {
    wrap.innerHTML = `<div class="tasks-empty">Добави служители</div>`;
    return;
  }
  const dayTotal = active.reduce((s, e) => s + ((_whData[e.id]?.[date]?.hours) || 0), 0);
  const rows = active.map(emp => {
    const cell = _whData[emp.id]?.[date];
    const h    = cell?.hours ?? "";
    const cls  = h !== "" ? whCellClass(Number(h)) : "";
    return `
      <div class="wh-mob-row">
        <div class="wh-mob-name">${escHtml(emp.name)}</div>
        <div class="wh-mob-input-wrap">
          <input type="number" class="wh-mob-input ${cls}" value="${h}"
                 min="0" max="24" step="0.5" placeholder="—"
                 onchange="whMobileUpdate('${emp.id}','${date}',this.value)">
          <span class="wh-mob-unit">ч</span>
        </div>
      </div>`;
  }).join("");
  wrap.innerHTML = `
    <div class="wh-mob-total">Общо за деня: <strong>${dayTotal} ч</strong></div>
    ${rows}`;
}

window.whMobileDayChange = function(val) {
  _whMobileDay = val;
  renderWhMobile();
};

window.whMobileUpdate = async function(empId, date, val) {
  const h = parseFloat(val);
  if (isNaN(h) || h < 0) return;
  await whSaveHours(empId, date, h, null, null);
};

// ── Cell edit popup ────────────────────────────────────────
window.openWhCell = function(empId, date) {
  _whCellEmpId = empId;
  _whCellDate  = date;
  const existing = _whData[empId]?.[date];
  const emp      = _whEmployees.find(e => e.id === empId);
  document.getElementById("whCellTitle").textContent =
    `${escHtml(emp?.name || "")}  —  ${date}`;
  document.getElementById("whCellHours").value = existing?.hours  ?? "";
  document.getElementById("whCellShift").value = existing?.shift  ?? "";
  document.getElementById("whCellNote").value  = existing?.note   ?? "";
  const del = document.getElementById("whCellDelete");
  if (del) del.style.display = existing ? "" : "none";
  document.getElementById("whCellModal").classList.remove("hidden");
  setTimeout(() => document.getElementById("whCellHours")?.focus(), 80);
};

window.saveWhCell = async function() {
  const hours = parseFloat(document.getElementById("whCellHours").value);
  if (isNaN(hours) || hours < 0 || hours > 24) {
    alert("Въведи валидни часове (0–24)."); return;
  }
  const shift = document.getElementById("whCellShift").value;
  const note  = document.getElementById("whCellNote").value.trim();
  await whSaveHours(_whCellEmpId, _whCellDate, hours, shift, note);
  closeWhCellModal();
};

window.deleteWhCell = async function() {
  const docId = _whData[_whCellEmpId]?.[_whCellDate]?.docId;
  if (!docId) { closeWhCellModal(); return; }
  try {
    await deleteDoc(doc(db, "work_hours", docId));
    if (_whData[_whCellEmpId]) delete _whData[_whCellEmpId][_whCellDate];
    renderWhTable();
    renderWhMobile();
    closeWhCellModal();
  } catch (e) { alert("Грешка: " + e.message); }
};

window.closeWhCellModal = function() {
  document.getElementById("whCellModal")?.classList.add("hidden");
  _whCellEmpId = null;
  _whCellDate  = null;
};

async function whSaveHours(empId, date, hours, shift, note) {
  if (!_whShopId || !empId || !date) return;
  const existing = _whData[empId]?.[date];
  const data = {
    shopId:     _whShopId,
    employeeId: empId,
    date,
    hours,
    shift:     shift  || "",
    note:      note   || "",
    updatedAt: new Date().toISOString()
  };
  try {
    if (existing?.docId) {
      await updateDoc(doc(db, "work_hours", existing.docId), data);
      _whData[empId][date] = { ...data, docId: existing.docId };
    } else {
      data.createdAt = new Date().toISOString();
      const ref = await addDoc(collection(db, "work_hours"), data);
      if (!_whData[empId]) _whData[empId] = {};
      _whData[empId][date] = { hours, shift: shift||"", note: note||"", docId: ref.id };
    }
    renderWhTable();
    renderWhMobile();
  } catch (e) { alert("Грешка: " + e.message); }
}

// ── Quick fill ─────────────────────────────────────────────
window.whQuickFillModal = function() {
  const sel = document.getElementById("whQuickEmp");
  if (!sel) return;
  const active = _whEmployees.filter(e => e.active);
  sel.innerHTML = active.length
    ? active.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join("")
    : `<option value="">Няма активни служители</option>`;
  document.getElementById("whQuickFillPanel")?.classList.remove("hidden");
};

window.closeWhQuickFill = function() {
  document.getElementById("whQuickFillPanel")?.classList.add("hidden");
};

window.whDoQuickFill = async function() {
  const empId = document.getElementById("whQuickEmp").value;
  const hours = parseFloat(document.getElementById("whQuickHours").value) || 8;
  if (!empId) { alert("Избери служител."); return; }

  const [y, m]    = _whMonth.split("-").map(Number);
  const daysInMon = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMon; d++) {
    const dow     = new Date(y, m - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    const dateStr = `${_whMonth}-${String(d).padStart(2, "0")}`;
    if (_whData[empId]?.[dateStr]?.hours) continue;
    await whSaveHours(empId, dateStr, hours, "", "");
    count++;
  }
  document.getElementById("whQuickFillPanel")?.classList.add("hidden");
  showStatusMsg(`✅ Попълнени ${count} работни дни × ${hours} ч`);
};

// ── Excel export ───────────────────────────────────────────
window.exportWhExcel = function() {
  if (!window.XLSX) { alert("XLSX библиотеката не е заредена."); return; }
  const [y, m]    = _whMonth.split("-").map(Number);
  const daysInMon = new Date(y, m, 0).getDate();
  const days      = Array.from({ length: daysInMon }, (_, i) => i + 1);
  const shopName  = _whShopId === "store1" ? "Магазин 1" : "Магазин 2";

  const header = ["Служител", ...days.map(String), "Общо"];
  const rows   = _whEmployees.map(emp => {
    let total = 0;
    const cells = days.map(d => {
      const dateStr = `${_whMonth}-${String(d).padStart(2, "0")}`;
      const h = _whData[emp.id]?.[dateStr]?.hours || 0;
      total += h;
      return h || "";
    });
    return [emp.name, ...cells, total || ""];
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Часове");
  XLSX.writeFile(wb, `часове-${shopName}-${_whMonth}.xlsx`);
};

// ════════════════════════════════════════════════════════════
// 🕐 МОДУЛ 4 — ЧАСОВЕ И ЗАПЛАТИ (Собственик)
// ════════════════════════════════════════════════════════════

window.loadWageScreen = async function() {
  const monthInput = document.getElementById("wageMonth");
  if (!monthInput) return;
  if (!_wageMonth) {
    const _wn = new Date();
    _wageMonth = `${_wn.getFullYear()}-${String(_wn.getMonth() + 1).padStart(2, "0")}`;
    monthInput.value = _wageMonth;
  }
  const lbl = document.getElementById("wageMonthLabel");
  if (lbl) lbl.textContent = formatMonth(_wageMonth);
  await loadWageData();
};

window.wageChangeMonth = function(delta) {
  let [y, m] = _wageMonth.split("-").map(Number);
  m += delta;
  if (m > 12) { m = 1;  y++; }
  if (m < 1)  { m = 12; y--; }
  _wageMonth = `${y}-${String(m).padStart(2, "0")}`;
  const lbl = document.getElementById("wageMonthLabel");
  if (lbl) lbl.textContent = formatMonth(_wageMonth);
  const inp = document.getElementById("wageMonth");
  if (inp) inp.value = _wageMonth;
  loadWageData();
};

window.wageMonthInput = function() {
  const val = document.getElementById("wageMonth")?.value;
  if (val) { _wageMonth = val; loadWageData(); }
};

async function loadWageData() {
  const tbody = document.getElementById("wageTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="tasks-empty">Зареждане...</td></tr>`;

  try {
    // Employees from both stores
    const [snap1, snap2] = await Promise.all([
      getDocs(query(collection(db,"employees"), where("shopId","==","store1"))),
      getDocs(query(collection(db,"employees"), where("shopId","==","store2")))
    ]);
    _wageEmployeesAll = [
      ...snap1.docs.map(d => ({ id: d.id, ...d.data() })),
      ...snap2.docs.map(d => ({ id: d.id, ...d.data() }))
    ];
    _wageEmployeesAll.sort((a, b) => {
      if (!!b.active !== !!a.active) return b.active ? 1 : -1;
      return (a.name || "").localeCompare(b.name || "", "bg");
    });

    // Hours for month
    const [wh1, wh2] = await Promise.all([
      getDocs(query(collection(db,"work_hours"), where("shopId","==","store1"))),
      getDocs(query(collection(db,"work_hours"), where("shopId","==","store2")))
    ]);
    _wageHoursMap = {};
    [...wh1.docs, ...wh2.docs].filter(d => d.data().date?.startsWith(_wageMonth)).forEach(d => {
      const r = d.data();
      _wageHoursMap[r.employeeId] = (_wageHoursMap[r.employeeId] || 0) + (r.hours || 0);
    });

    renderWageTable();
    renderWageSummaryCards();
    if (_wageTab === "summary") renderWageSummaryDetail();
    if (_wageTab === "history") loadWageHistory();
  } catch (e) { console.error("loadWageData:", e); }
}

function renderWageTable() {
  const tbody = document.getElementById("wageTableBody");
  if (!tbody) return;
  if (!_wageEmployeesAll.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="tasks-empty">Няма служители</td></tr>`;
    return;
  }

  let totalH = 0, totalCost = 0;
  const rows = _wageEmployeesAll.map(emp => {
    const hours   = _wageHoursMap[emp.id] || 0;
    const rate    = emp.hourlyRate || 0;
    const salary  = hours * rate;
    const store   = emp.shopId === "store1" ? "М1" : "М2";
    const scls    = emp.shopId === "store1" ? "store1" : "store2";
    totalH    += hours;
    totalCost += salary;
    return `
      <tr class="${emp.active ? "" : "wh-row-inactive"}">
        <td>${escHtml(emp.name)}</td>
        <td><span class="dr-owner-store-badge ${scls}">${store}</span></td>
        <td class="mono">${hours || "0"}</td>
        <td>
          <div class="wage-rate-cell">
            <input type="number" class="wage-rate-input" value="${rate.toFixed(2)}"
                   min="0" step="0.01" placeholder="0.00"
                   onchange="saveHourlyRate('${emp.id}', this.value)">
            <span class="wage-rate-unit">€/ч</span>
          </div>
        </td>
        <td class="mono ${salary > 0 ? "pos" : ""}">${salary > 0 ? salary.toFixed(2)+" €" : "—"}</td>
        <td></td>
      </tr>`;
  }).join("");

  tbody.innerHTML = rows + `
    <tr class="dr-owner-totals-row">
      <td colspan="2"><strong>Общо</strong></td>
      <td class="mono"><strong>${totalH}</strong></td>
      <td></td>
      <td class="mono pos"><strong>${totalCost > 0 ? totalCost.toFixed(2)+" €" : "—"}</strong></td>
      <td></td>
    </tr>`;
}

function renderWageSummaryCards() {
  const el = document.getElementById("wageSummaryCards");
  if (!el) return;
  const s1emps = _wageEmployeesAll.filter(e => e.shopId === "store1");
  const s2emps = _wageEmployeesAll.filter(e => e.shopId === "store2");
  const h1   = s1emps.reduce((s, e) => s + (_wageHoursMap[e.id] || 0), 0);
  const h2   = s2emps.reduce((s, e) => s + (_wageHoursMap[e.id] || 0), 0);
  const cost = _wageEmployeesAll.reduce((s, e) =>
    s + (_wageHoursMap[e.id] || 0) * (e.hourlyRate || 0), 0);

  el.innerHTML = `
    <div class="wh-sum-card">
      <div class="wh-sum-label">М1 — Часове</div>
      <div class="wh-sum-value">${h1} ч</div>
    </div>
    <div class="wh-sum-card">
      <div class="wh-sum-label">М2 — Часове</div>
      <div class="wh-sum-value">${h2} ч</div>
    </div>
    <div class="wh-sum-card wh-sum-card-total">
      <div class="wh-sum-label">Разход заплати</div>
      <div class="wh-sum-value">${cost > 0 ? cost.toFixed(2)+" €" : "—"}</div>
    </div>`;
}

function renderWageSummaryDetail() {
  const el = document.getElementById("wageSummaryDetail");
  if (!el) return;
  const stores = ["store1","store2"];
  el.innerHTML = stores.map(sid => {
    const emps  = _wageEmployeesAll.filter(e => e.shopId === sid && e.active);
    const total = emps.reduce((s, e) => s + (_wageHoursMap[e.id]||0)*(e.hourlyRate||0), 0);
    const hours = emps.reduce((s, e) => s + (_wageHoursMap[e.id]||0), 0);
    const name  = sid === "store1" ? "Магазин 1" : "Магазин 2";
    return `
      <div class="wh-sum-detail-card">
        <div class="wh-sum-detail-title">${name}</div>
        <div class="dr-detail-sum-row">
          <span>Служители</span><span>${emps.length}</span>
        </div>
        <div class="dr-detail-sum-row">
          <span>Часове</span><span class="mono">${hours} ч</span>
        </div>
        <div class="dr-detail-sum-final">
          <span>Заплати</span>
          <span>${total > 0 ? total.toFixed(2)+" €" : "—"}</span>
        </div>
      </div>`;
  }).join("");
}

window.wageSetTab = function(tab) {
  _wageTab = tab;
  ["month","summary","history"].forEach(t => {
    const id = "wageTab" + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(id)?.classList.toggle("hidden", t !== tab);
    document.querySelector(`.wage-tab[data-tab="${t}"]`)
      ?.classList.toggle("active", t === tab);
  });
  if (tab === "summary") renderWageSummaryDetail();
  if (tab === "history") loadWageHistory();
};

async function loadWageHistory() {
  const el = document.getElementById("wageHistoryContent");
  if (!el) return;
  el.innerHTML = `<div class="tasks-empty">Зареждане...</div>`;
  try {
    const base      = _wageMonth || new Date().toISOString().slice(0, 7);
    const [by, bm]  = base.split("-").map(Number);
    const months    = Array.from({ length: 6 }, (_, i) => {
      let mi = bm - i, yi = by;
      if (mi < 1)  { mi += 12; yi--; }
      if (mi > 12) { mi -= 12; yi++; }
      return `${yi}-${String(mi).padStart(2, "0")}`;
    });

    // Fetch all work_hours once (no range index needed)
    const [wh1, wh2] = await Promise.all([
      getDocs(query(collection(db,"work_hours"), where("shopId","==","store1"))),
      getDocs(query(collection(db,"work_hours"), where("shopId","==","store2")))
    ]);
    const allWh = [...wh1.docs, ...wh2.docs];

    const rows = months.map(mo => {
      const moDocs = allWh.filter(d => d.data().date?.startsWith(mo));
      const totalH = moDocs.reduce((s, d) => s + (d.data().hours || 0), 0);
      const totalC = moDocs.reduce((s, d) => {
        const emp  = _wageEmployeesAll.find(e => e.id === d.data().employeeId);
        const rate = getHistoricalRate(emp, mo);
        return s + (d.data().hours || 0) * rate;
      }, 0);
      return { mo, totalH, totalC };
    });

    el.innerHTML = `
      <table class="wh-hist-table">
        <thead>
          <tr><th>Месец</th><th>Часове</th><th>Разход заплати</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${formatMonth(r.mo)}</td>
              <td class="mono">${r.totalH} ч</td>
              <td class="mono ${r.totalC > 0 ? "pos" : ""}">${r.totalC > 0 ? r.totalC.toFixed(2)+" €" : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (e) { el.innerHTML = `<div class="tasks-empty">Грешка при зареждане</div>`; }
}

function getHistoricalRate(emp, month) {
  if (!emp) return 0;
  const hist  = emp.hourlyRateHistory || [];
  const entry = hist.find(h => h.month === month);
  return entry ? entry.rate : (emp.hourlyRate || 0);
}

window.saveHourlyRate = async function(empId, rateStr) {
  const rate = parseFloat(rateStr);
  if (isNaN(rate) || rate < 0) return;
  const emp = _wageEmployeesAll.find(e => e.id === empId);
  if (!emp) return;

  const hist = emp.hourlyRateHistory ? [...emp.hourlyRateHistory] : [];
  const idx  = hist.findIndex(h => h.month === _wageMonth);
  if (idx >= 0) hist[idx].rate = rate;
  else          hist.push({ month: _wageMonth, rate });

  try {
    await updateDoc(doc(db, "employees", empId), { hourlyRate: rate, hourlyRateHistory: hist });
    emp.hourlyRate        = rate;
    emp.hourlyRateHistory = hist;
    renderWageTable();
    renderWageSummaryCards();
  } catch (e) { console.error("saveHourlyRate:", e); }
};

window.exportWagePdf = function() {
  const month = formatMonth(_wageMonth);
  let tableRows = "";
  let grand = 0;
  _wageEmployeesAll.forEach(emp => {
    const hours  = _wageHoursMap[emp.id] || 0;
    const rate   = emp.hourlyRate || 0;
    const salary = hours * rate;
    grand += salary;
    tableRows += `<tr>
      <td>${emp.name}</td>
      <td>${emp.shopId === "store1" ? "М1" : "М2"}</td>
      <td style="text-align:right">${hours}</td>
      <td style="text-align:right">${rate.toFixed(2)}</td>
      <td style="text-align:right">${salary > 0 ? salary.toFixed(2) : "—"}</td>
      <td></td>
    </tr>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; padding: 24px; color:#000; }
    h1 { font-size: 17px; margin-bottom: 4px; }
    h2 { font-size: 13px; color: #555; margin-bottom: 16px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; }
    th,td { border: 1px solid #ccc; padding: 6px 10px; }
    th { background: #f0f0f0; text-align: left; }
    .total { font-weight: bold; background: #f5f5f5; }
    .sig { margin-top: 40px; display: flex; gap: 60px; }
    .sig-line { border-top: 1px solid #000; width: 160px; padding-top: 4px; font-size: 11px; }
    .note { margin-top: 20px; font-size: 11px; color: #888; font-style: italic; }
    @media print { body { padding: 0; } }
  </style></head><body>
  <h1>Нон Стоп — Ведомост за заплати</h1>
  <h2>Период: ${month}</h2>
  <table>
    <thead>
      <tr>
        <th>Служител</th><th>Маг.</th><th>Часове</th>
        <th>Ставка (€/ч)</th><th>Сума (€)</th><th>Подпис</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr class="total">
        <td colspan="4"><strong>Общо</strong></td>
        <td><strong>${grand > 0 ? grand.toFixed(2) : "—"}</strong></td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  <p class="note">Заплатите са изчислени само от часовете × ставка.
  Допълнителни компоненти (бонуси, удръжки, осигуровки) ще се добавят в следващ модул.</p>
  <div class="sig">
    <div><div class="sig-line">Изготвил: ___________</div></div>
    <div><div class="sig-line">Собственик: ___________</div></div>
  </div>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Разреши изскачащи прозорци за да принтираш."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
};

// ════════════════════════════════════════════════════════════
// 💰 МОДУЛ 5 — ЗАПЛАТИ
// ════════════════════════════════════════════════════════════

// ── Стейт ─────────────────────────────────────────────────
let _salHistTab    = "month";
let _salHistEmpId  = null;
let _finSalEmpId   = null;
let _finSalMonth   = null;
let _finSalEmpData = null;
let _salHistChart  = null;

function salStatusLabel(st) {
  if (st === "draft") return "📝 Чернова";
  if (st === "paid")  return "✅ Платена";
  return "— Не е генерирана";
}

// ════════════════════════════════════════════════════════════
// 💰 ЗАПЛАТИ — ИСТОРИЯ (screen-salaries)
// ════════════════════════════════════════════════════════════

async function loadSalaryHistoryScreen() {
  _salHistTab = "month";
  ["month","employee","analysis"].forEach(t => {
    document.getElementById(`salHist${t.charAt(0).toUpperCase()+t.slice(1)}Content`)
      ?.classList.toggle("hidden", t !== "month");
    document.querySelector(`.sal-hist-tab[data-tab="${t}"]`)
      ?.classList.toggle("active", t === "month");
  });
  await loadSalHistByMonth();

  // Populate employee selector once
  const sel = document.getElementById("salHistEmpSel");
  if (sel && sel.options.length <= 1) {
    const [e1, e2] = await Promise.all([
      getDocs(query(collection(db,"employees"), where("shopId","==","store1"))),
      getDocs(query(collection(db,"employees"), where("shopId","==","store2")))
    ]);
    const all = [...e1.docs.map(d=>({id:d.id,...d.data()})), ...e2.docs.map(d=>({id:d.id,...d.data()}))];
    all.sort((a, b) => (a.name||"").localeCompare(b.name||"","bg"));
    sel.innerHTML = `<option value="">— Избери служител —</option>` +
      all.map(e=>`<option value="${e.id}">${escHtml(e.name)} (${e.shopId==="store1"?"М1":"М2"})</option>`).join("");
  }
}

window.salSetHistTab = function(tab) {
  _salHistTab = tab;
  ["month","employee","analysis"].forEach(t => {
    document.getElementById(`salHist${t.charAt(0).toUpperCase()+t.slice(1)}Content`)
      ?.classList.toggle("hidden", t !== tab);
    document.querySelector(`.sal-hist-tab[data-tab="${t}"]`)
      ?.classList.toggle("active", t === tab);
  });
  if (tab === "month")    loadSalHistByMonth();
  if (tab === "employee" && _salHistEmpId) loadSalHistByEmployee(_salHistEmpId);
  if (tab === "analysis") loadSalHistAnalysis();
};

// ── Payroll worksheet state ────────────────────────────────
let _salHistMonth = "";
let _salHistStore = "all";
let _payrollRows  = []; // [{emp, docId, hours, sAmount, holiday, sickLeave, shopBonus, persBon, advances, bank, notes}]

async function loadSalHistByMonth() {
  const el = document.getElementById("salHistMonthContent");
  if (!el) return;
  if (!_salHistMonth) _salHistMonth = new Date().toISOString().slice(0, 7);
  el.innerHTML = `<div class="tasks-empty">Зареждане...</div>`;
  try {
    const [e1, e2, s1, s2, wh1, wh2, advSnap] = await Promise.all([
      getDocs(query(collection(db,"employees"), where("shopId","==","store1"), where("active","==",true))),
      getDocs(query(collection(db,"employees"), where("shopId","==","store2"), where("active","==",true))),
      getDocs(query(collection(db,"salaries"),  where("shopId","==","store1"), where("month","==",_salHistMonth))),
      getDocs(query(collection(db,"salaries"),  where("shopId","==","store2"), where("month","==",_salHistMonth))),
      getDocs(query(collection(db,"work_hours"), where("shopId","==","store1"))),
      getDocs(query(collection(db,"work_hours"), where("shopId","==","store2"))),
      getDocs(query(collection(db,"advances"),  where("month","==",_salHistMonth)))
    ]);

    // Build lookup maps
    const salByEmp = {};
    [...s1.docs, ...s2.docs].forEach(d => { salByEmp[d.data().employeeId] = { id: d.id, ...d.data() }; });

    const hoursByEmp = {};
    [...wh1.docs, ...wh2.docs]
      .filter(d => (d.data().date || "").startsWith(_salHistMonth))
      .forEach(d => {
        const r = d.data();
        hoursByEmp[r.employeeId] = (hoursByEmp[r.employeeId] || 0) + (r.hours || 0);
      });

    const advByEmp = {};
    advSnap.docs.forEach(d => {
      const r = d.data();
      if (r.employeeId) advByEmp[r.employeeId] = (advByEmp[r.employeeId] || 0) + (r.amount || 0);
    });

    const allEmps = [
      ...e1.docs.map(d => ({ id: d.id, ...d.data() })),
      ...e2.docs.map(d => ({ id: d.id, ...d.data() }))
    ].sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));

    _payrollRows = allEmps.map(emp => {
      const sal  = salByEmp[emp.id] || null;
      const h    = sal?.baseHours ?? (hoursByEmp[emp.id] || 0);
      const rate = sal?.baseRate  ?? (emp.hourlyRate || 0);
      return {
        emp,
        docId:     sal?.id || null,
        hours:     h,
        sAmount:   sal?.baseAmount          ?? (h * rate),
        holiday:   sal?.holidayAmount       || 0,
        sickLeave: sal?.sickLeaveAmount     || 0,
        shopBonus: sal?.shopBonusAmount     || 0,
        persBon:   sal?.personalBonusAmount || 0,
        advances:  sal?.advances            ?? (advByEmp[emp.id] || 0),
        bank:      sal?.bankAmount          || 0,
        notes:     sal?.notes              || "",
      };
    });

    renderPayrollHistTable(el);
  } catch (e) {
    console.error("loadSalHistByMonth:", e);
    el.innerHTML = `<div class="tasks-empty">Грешка при зареждане</div>`;
  }
}

function renderPayrollHistTable(el) {
  // Generate month picker options (last 18 months)
  const now = new Date();
  const monthOpts = Array.from({ length: 18 }, (_, i) => {
    let mi = now.getMonth() + 1 - i, yi = now.getFullYear();
    while (mi < 1) { mi += 12; yi--; }
    const val = `${yi}-${String(mi).padStart(2, "0")}`;
    return `<option value="${val}" ${val === _salHistMonth ? "selected" : ""}>${formatMonth(val)}</option>`;
  }).join("");

  // Filter rows by store
  const visRows = _salHistStore === "all"
    ? _payrollRows
    : _payrollRows.filter(r => r.emp.shopId === _salHistStore);

  let no = 1;
  const rowsHtml = visRows.map((r, vi) => {
    const idx = _payrollRows.indexOf(r);
    const { emp, docId, hours, sAmount, holiday, sickLeave, shopBonus, persBon, advances, bank } = r;
    const gross  = sAmount + holiday + sickLeave + shopBonus + persBon;
    const cash   = gross - advances - bank;
    const kb     = gross - advances;
    const store  = emp.shopId === "store1" ? "М1" : "М2";
    const hasVal = hours > 0 || sAmount > 0;
    const stHtml = !hasVal ? `<span style="color:var(--text3)">—</span>`
      : docId ? `<span class="pw-saved-dot" title="Запазено">✓</span>`
               : `<span class="pw-pending-dot" title="Не е запазено">⏳</span>`;
    const fv = v => v > 0 ? v.toFixed(2) : "";
    const otClass = hours >= 200 ? "row-ot-critical" : hours >= 180 ? "row-ot-warning" : "";
    const otIcon  = hours >= 200 ? " 🔴" : hours >= 180 ? " 🟠" : "";
    const trClass = [!hasVal ? "pw-empty-row" : "", otClass].filter(Boolean).join(" ");
    return `<tr data-idx="${idx}" data-store="${emp.shopId}" class="${trClass}">
      <td class="pw-no">${no++}</td>
      <td class="pw-name">${escHtml(emp.name)}${otIcon}</td>
      <td class="pw-store">${store}</td>
      <td><input id="pw_h_${idx}"   class="pw-input" type="number" min="0" step="0.5"   value="${hours||""}"           oninput="onPayrollInput(${idx},'h')"></td>
      <td><input id="pw_s_${idx}"   class="pw-input" type="number" min="0" step="0.01"  value="${sAmount>0?sAmount.toFixed(2):""}"  oninput="onPayrollInput(${idx},'')"></td>
      <td><input id="pw_hd_${idx}"  class="pw-input" type="number" min="0" step="0.01"  value="${fv(holiday)}"         oninput="onPayrollInput(${idx},'')"></td>
      <td><input id="pw_sl_${idx}"  class="pw-input" type="number" min="0" step="0.01"  value="${fv(sickLeave)}"       oninput="onPayrollInput(${idx},'')"></td>
      <td><input id="pw_sb_${idx}"  class="pw-input" type="number" min="0" step="0.01"  value="${fv(shopBonus)}"       oninput="onPayrollInput(${idx},'')"></td>
      <td><input id="pw_pb_${idx}"  class="pw-input" type="number" min="0" step="0.01"  value="${fv(persBon)}"         oninput="onPayrollInput(${idx},'')"></td>
      <td class="pw-calc" id="pw_gross_${idx}">${gross>0?gross.toFixed(2):"—"}</td>
      <td><input id="pw_adv_${idx}" class="pw-input" type="number" min="0" step="0.01"  value="${fv(advances)}"        oninput="onPayrollInput(${idx},'')"></td>
      <td><input id="pw_bk_${idx}"  class="pw-input" type="number" min="0" step="0.01"  value="${fv(bank)}"            oninput="onPayrollInput(${idx},'')"></td>
      <td class="pw-calc ${cash<0?"neg":""}" id="pw_cash_${idx}">${gross>0?cash.toFixed(2):"—"}</td>
      <td class="pw-calc" id="pw_kb_${idx}">${gross>0?kb.toFixed(2):"—"}</td>
      <td class="pw-status" id="pw_st_${idx}">${stHtml}</td>
      <td class="pw-actions">
        <button class="pw-btn" onclick="savePayrollRow(${idx})" title="Запази">💾</button>
        <button class="pw-btn" onclick="genPayrollSlip(${idx})" title="Фиш" ${!docId?"disabled":""}>📄</button>
      </td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div class="pw-toolbar">
      <select class="pw-month-sel" onchange="salHistMonthChange(this.value)">${monthOpts}</select>
      <select class="pw-month-sel" onchange="salHistStoreChange(this.value)">
        <option value="all"    ${_salHistStore==="all"   ?"selected":""}>Всички</option>
        <option value="store1" ${_salHistStore==="store1"?"selected":""}>М1</option>
        <option value="store2" ${_salHistStore==="store2"?"selected":""}>М2</option>
      </select>
      <button class="btn-secondary pw-all-btn" onclick="exportAllHistSlips()">
        <i class="fa-solid fa-file-pdf"></i> Всички фишове
      </button>
    </div>
    <div class="pw-sheet-title">💼 ВЕДОМОСТ ЗА ЗАПЛАТИ — ${formatMonth(_salHistMonth).toUpperCase()}</div>
    <div class="pw-table-wrap">
    <table class="pw-table">
      <thead><tr>
        <th>№</th><th>ИМЕ</th><th>МАГ</th>
        <th>ЧАСОВЕ</th><th>СУМА</th>
        <th>ПРАЗН.</th><th>ДОПЛАЩ.</th><th>БОНУС</th><th>ЛИЧЕН</th>
        <th>БРУТНО</th>
        <th>АВАНСИ</th><th>БАНКА</th><th>КЕШ</th><th>К+Б</th>
        <th>✓</th><th>—</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot id="pw-tfoot"></tfoot>
    </table></div>
    <div class="pw-ot-legend">🟠 &ge; 180ч &nbsp;&nbsp; 🔴 &ge; 200ч</div>`;

  updatePayrollTotals();
}

window.salHistMonthChange = function(val) {
  _salHistMonth = val;
  loadSalHistByMonth();
};

window.salHistStoreChange = function(val) {
  _salHistStore = val;
  const el = document.getElementById("salHistMonthContent");
  if (el && _payrollRows.length) renderPayrollHistTable(el);
};

window.onPayrollInput = function(idx, field) {
  const row = _payrollRows[idx];
  if (!row) return;
  const get = id => parseFloat(document.getElementById(id)?.value) || 0;

  // Auto-update СУМА when ЧАСОВЕ changes
  if (field === 'h') {
    const h    = get(`pw_h_${idx}`);
    const rate = row.emp.hourlyRate || 0;
    const auto = +(h * rate).toFixed(2);
    const sEl  = document.getElementById(`pw_s_${idx}`);
    if (sEl) sEl.value = auto > 0 ? auto : "";
    row.hours   = h;
    row.sAmount = auto;
  }

  // Sync stored values from inputs
  row.hours     = get(`pw_h_${idx}`);
  row.sAmount   = get(`pw_s_${idx}`);
  row.holiday   = get(`pw_hd_${idx}`);
  row.sickLeave = get(`pw_sl_${idx}`);
  row.shopBonus = get(`pw_sb_${idx}`);
  row.persBon   = get(`pw_pb_${idx}`);
  row.advances  = get(`pw_adv_${idx}`);
  row.bank      = get(`pw_bk_${idx}`);

  const gross = row.sAmount + row.holiday + row.sickLeave + row.shopBonus + row.persBon;
  const cash  = gross - row.advances - row.bank;
  const kb    = gross - row.advances;
  const hasVal = row.hours > 0 || row.sAmount > 0;

  const setCell = (id, val, extra) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = hasVal ? val.toFixed(2) : "—";
    if (extra !== undefined) el.className = `pw-calc${extra ? " " + extra : ""}`;
  };
  setCell(`pw_gross_${idx}`, gross);
  setCell(`pw_cash_${idx}`,  cash, cash < 0 ? "neg" : "");
  setCell(`pw_kb_${idx}`,    kb);

  const stEl = document.getElementById(`pw_st_${idx}`);
  if (stEl) stEl.innerHTML = !hasVal ? `<span style="color:var(--text3)">—</span>`
    : row.docId ? `<span class="pw-saved-dot">✓</span>`
                : `<span class="pw-pending-dot">⏳</span>`;

  updatePayrollTotals();
};

function updatePayrollTotals() {
  const tfoot = document.getElementById("pw-tfoot");
  if (!tfoot) return;
  const sum = arr => arr.reduce((acc, r) => {
    const g = r.sAmount + r.holiday + r.sickLeave + r.shopBonus + r.persBon;
    return {
      h:    acc.h    + r.hours,
      s:    acc.s    + r.sAmount,
      hd:   acc.hd   + r.holiday,
      sl:   acc.sl   + r.sickLeave,
      sb:   acc.sb   + r.shopBonus,
      pb:   acc.pb   + r.persBon,
      g:    acc.g    + g,
      adv:  acc.adv  + r.advances,
      bk:   acc.bk   + r.bank,
      cash: acc.cash + (g - r.advances - r.bank),
      kb:   acc.kb   + (g - r.advances)
    };
  }, { h:0, s:0, hd:0, sl:0, sb:0, pb:0, g:0, adv:0, bk:0, cash:0, kb:0 });

  const f   = n => n !== 0 ? n.toFixed(2) : "—";
  const row = (lbl, cls, t) => `<tr class="${cls}">
    <td colspan="3" class="pw-total-lbl">${lbl}</td>
    <td class="pw-calc">${t.h||"—"}</td><td class="pw-calc">${f(t.s)}</td>
    <td class="pw-calc">${f(t.hd)}</td><td class="pw-calc">${f(t.sl)}</td>
    <td class="pw-calc">${f(t.sb)}</td><td class="pw-calc">${f(t.pb)}</td>
    <td class="pw-calc"><strong>${f(t.g)}</strong></td>
    <td class="pw-calc">${f(t.adv)}</td><td class="pw-calc">${f(t.bk)}</td>
    <td class="pw-calc ${t.cash<0?"neg":""}">${f(t.cash)}</td>
    <td class="pw-calc">${f(t.kb)}</td>
    <td colspan="2"></td></tr>`;

  const all = sum(_payrollRows);
  const m1  = sum(_payrollRows.filter(r => r.emp.shopId === "store1"));
  const m2  = sum(_payrollRows.filter(r => r.emp.shopId === "store2"));
  tfoot.innerHTML = row("ОБЩО", "pw-total-row", all)
    + row("▶ Магазин 1", "pw-sub-row", m1)
    + row("▶ Магазин 2", "pw-sub-row", m2);
}

window.savePayrollRow = async function(idx) {
  const row = _payrollRows[idx];
  if (!row) return;
  const gross = row.sAmount + row.holiday + row.sickLeave + row.shopBonus + row.persBon;
  const cash  = gross - row.advances - row.bank;
  const bonuses = [
    row.holiday   && { type: "Празнични часове",          amount: row.holiday,   note: "" },
    row.sickLeave && { type: "Доплащане отпуска/болнични", amount: row.sickLeave, note: "" },
    row.shopBonus && { type: "Бонус от оборота",           amount: row.shopBonus, note: "" },
    row.persBon   && { type: "Личен бонус",                amount: row.persBon,   note: "" },
  ].filter(Boolean);
  const deductions = row.advances > 0 ? [{ type: "Аванс", amount: row.advances, note: "" }] : [];
  const now = new Date().toISOString();
  const data = {
    shopId:              row.emp.shopId,
    employeeId:          row.emp.id,
    employeeName:        row.emp.name,
    month:               _salHistMonth,
    baseHours:           row.hours,
    baseRate:            row.emp.hourlyRate || 0,
    baseAmount:          row.sAmount,
    holidayAmount:       row.holiday,
    sickLeaveAmount:     row.sickLeave,
    shopBonusAmount:     row.shopBonus,
    personalBonusAmount: row.persBon,
    bonuses, deductions,
    totalGross:          gross,
    advances:            row.advances,
    bankAmount:          row.bank,
    cashAmount:          cash,
    notes:               row.notes || "",
    status:              "approved",
    updatedAt:           now,
  };
  const saveBtn = document.querySelector(`tr[data-idx="${idx}"] .pw-btn`);
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "⏳"; }
    if (row.docId) {
      const snap = await getDoc(doc(db,"salaries",row.docId));
      const log  = snap.data()?.changeLog || [];
      await updateDoc(doc(db,"salaries",row.docId),
        { ...data, changeLog: [...log, { by: currentUserId, at: now, action: `Обновена: бруто ${gross.toFixed(2)} €` }] });
    } else {
      data.changeLog = [{ by: currentUserId, at: now, action: `Запазена: бруто ${gross.toFixed(2)} €` }];
      data.createdAt = now;
      const ref  = await addDoc(collection(db,"salaries"), data);
      row.docId  = ref.id;
    }
    // Enable slip button and update status
    const stEl   = document.getElementById(`pw_st_${idx}`);
    if (stEl) stEl.innerHTML = `<span class="pw-saved-dot" title="Запазено">✓</span>`;
    const slipBtn = document.querySelectorAll(`tr[data-idx="${idx}"] .pw-btn`)[1];
    if (slipBtn) slipBtn.disabled = false;
    showStatusMsg(`✅ ${row.emp.name} — запазено`);
  } catch (e) { alert("Грешка: " + e.message); }
  finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾"; }
  }
};

window.genPayrollSlip = async function(idx) {
  const row = _payrollRows[idx];
  if (!row?.docId) { alert("Запази реда първо (💾)."); return; }
  try {
    const snap = await getDoc(doc(db,"salaries",row.docId));
    if (!snap.exists()) { alert("Документът не е намерен."); return; }
    const sal = { id: snap.id, ...snap.data() };
    const shopLabel = sal.shopId === "store1" ? "Магазин М1" : "Магазин М2";
    const pdf = await generateSalarySlipPDF(sal, sal.employeeName || row.emp.name, shopLabel);
    pdf.save(`фиш_${(sal.employeeName || row.emp.name).replace(/\s+/g,"_")}_${_salHistMonth}.pdf`);
  } catch (e) { alert("Грешка: " + e.message); }
};

window.exportAllHistSlips = async function() {
  const saved = _payrollRows.filter(r => r.docId);
  if (!saved.length) { alert("Няма запазени редове за " + formatMonth(_salHistMonth) + "."); return; }
  if (!confirm(`Изтегли ${saved.length} фиша за ${formatMonth(_salHistMonth)}?`)) return;
  let count = 0;
  try {
    for (const r of saved) {
      const snap = await getDoc(doc(db,"salaries",r.docId));
      if (!snap.exists()) continue;
      const sal = { id: snap.id, ...snap.data() };
      const shopLabel = sal.shopId === "store1" ? "Магазин М1" : "Магазин М2";
      const pdf = await generateSalarySlipPDF(sal, sal.employeeName || r.emp.name, shopLabel);
      pdf.save(`фиш_${(sal.employeeName || r.emp.name).replace(/\s+/g,"_")}_${_salHistMonth}.pdf`);
      count++;
    }
    showStatusMsg(`✅ Изтеглени ${count} фиша за ${formatMonth(_salHistMonth)}`);
  } catch (e) { alert("Грешка: " + e.message); }
};

window.salHistEmpChange = async function(empId) {
  _salHistEmpId = empId;
  if (empId) await loadSalHistByEmployee(empId);
};

async function loadSalHistByEmployee(empId) {
  const el = document.getElementById("salHistEmployeeData");
  if (!el) return;
  el.innerHTML = `<div class="tasks-empty">Зареждане...</div>`;
  try {
    const [salSnap, whSnap, advSnap, empDoc] = await Promise.all([
      getDocs(query(collection(db,"salaries"),   where("employeeId","==",empId))),
      getDocs(query(collection(db,"work_hours"), where("employeeId","==",empId))),
      getDocs(query(collection(db,"advances"),   where("employeeId","==",empId))),
      getDoc(doc(db,"employees",empId))
    ]);
    const emp = empDoc.exists() ? { id: empDoc.id, ...empDoc.data() } : null;

    // Финализирани заплати по месец
    const finalByMonth = {};
    salSnap.docs.forEach(d => { const r = d.data(); finalByMonth[r.month] = { id: d.id, ...r }; });

    // Часове по месец (от work_hours)
    const hoursByMonth = {};
    whSnap.docs.forEach(d => {
      const r  = d.data();
      const mo = (r.date || "").slice(0, 7);
      if (mo) hoursByMonth[mo] = (hoursByMonth[mo] || 0) + (r.hours || 0);
    });

    // Аванси по месец
    const advByMonth = {};
    advSnap.docs.forEach(d => {
      const r  = d.data();
      const mo = r.month || (r.date || "").slice(0, 7);
      if (mo) advByMonth[mo] = (advByMonth[mo] || 0) + (r.amount || 0);
    });

    // Обединяваме всички месеци
    const allMonths = [...new Set([
      ...Object.keys(finalByMonth),
      ...Object.keys(hoursByMonth)
    ])].sort().reverse();

    if (!allMonths.length) {
      el.innerHTML = `<div class="tasks-empty">Няма записани часове или заплати за този служител.</div>`;
      return;
    }

    const rows = allMonths.map(mo => {
      const sal = finalByMonth[mo];
      if (sal) {
        // ── Финализиран ред ──
        const advStored = sal.advances ?? (sal.deductions || []).reduce((s,d) => s+(d.amount||0), 0);
        const cash = sal.cashAmount ?? Math.max(0, (sal.totalGross||0) - (sal.bankAmount||0) - advStored);
        const cashCls = cash < 0 ? "neg" : "pos";
        return `<tr>
          <td><strong>${formatMonth(mo)}</strong></td>
          <td class="mono">${sal.baseHours || 0}</td>
          <td class="mono">${(sal.baseRate || 0).toFixed(2)}</td>
          <td class="mono pos"><strong>${(sal.totalGross||0).toFixed(2)} €</strong></td>
          <td class="mono">${advStored > 0 ? advStored.toFixed(2) + " €" : "—"}</td>
          <td class="mono ${cashCls}">${cash.toFixed(2)} €</td>
          <td><span class="sal-status-badge sal-${sal.status}">${salStatusLabel(sal.status)}</span></td>
          <td class="sal-actions-cell">
            <button class="sal-edit-btn" onclick="openFinalizeSalaryModal('${empId}','${mo}')">✏️ Ред.</button>
            <button class="sal-edit-btn sal-slip-btn" onclick="exportSalarySlip('${sal.id}')">📄 Фиш</button>
          </td>
        </tr>`;
      } else {
        // ── Preview ред (само изчислен) ──
        const hours = hoursByMonth[mo] || 0;
        const rate  = getHistoricalRate(emp, mo);
        const base  = hours * rate;
        const advs  = advByMonth[mo] || 0;
        const cash  = base - advs;
        const cashCls = cash < 0 ? "neg" : "";
        return `<tr style="opacity:0.75">
          <td><strong>${formatMonth(mo)}</strong></td>
          <td class="mono">${hours}</td>
          <td class="mono">${rate.toFixed(2)}</td>
          <td class="mono">${base.toFixed(2)} €</td>
          <td class="mono">${advs > 0 ? advs.toFixed(2) + " €" : "—"}</td>
          <td class="mono ${cashCls}">${cash.toFixed(2)} €</td>
          <td><span class="sal-status-badge" style="background:var(--bg3);color:var(--text2);font-size:0.75rem">📊 Предварителен</span></td>
          <td class="sal-actions-cell">
            <button class="sal-edit-btn" onclick="openFinalizeSalaryModal('${empId}','${mo}')">Финализирай</button>
            <button class="sal-edit-btn" disabled title="Финализирай първо">📄 Фиш</button>
          </td>
        </tr>`;
      }
    }).join("");

    el.innerHTML = `
      <div class="table-responsive" style="margin-top:12px">
      <table class="wh-wage-table">
        <thead><tr>
          <th>Месец</th><th>Часове</th><th>Ставка</th><th>Брутно</th>
          <th>Аванси</th><th>За кеш</th><th>Статус</th><th>—</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (e) {
    console.error("loadSalHistByEmployee:", e);
    el.innerHTML = `<div class="tasks-empty">Грешка при зареждане</div>`;
  }
}

// ── Finalize salary modal ──────────────────────────────────
window.openFinalizeSalaryModal = async function(empId, month) {
  _finSalEmpId = empId;
  _finSalMonth = month;
  try {
    const [whSnap, advSnap, empDoc] = await Promise.all([
      getDocs(query(collection(db,"work_hours"), where("employeeId","==",empId))),
      getDocs(query(collection(db,"advances"),   where("employeeId","==",empId))),
      getDoc(doc(db,"employees",empId))
    ]);
    _finSalEmpData = empDoc.exists() ? { id: empDoc.id, ...empDoc.data() } : null;
    if (!_finSalEmpData) { alert("Служителят не е намерен."); return; }

    let hours = 0;
    whSnap.docs.forEach(d => {
      const r = d.data();
      if ((r.date || "").slice(0,7) === month) hours += (r.hours || 0);
    });

    let totalAdv = 0;
    advSnap.docs.forEach(d => {
      const r  = d.data();
      const mo = r.month || (r.date || "").slice(0, 7);
      if (mo === month && r.amount) totalAdv += r.amount;
    });

    // Check if salary doc already exists — pre-fill with its values
    const existSnap = await getDocs(query(
      collection(db,"salaries"),
      where("employeeId","==",empId),
      where("month","==",month)
    ));
    const existing = existSnap.empty ? null : { id: existSnap.docs[0].id, ...existSnap.docs[0].data() };

    const rate = existing?.baseRate ?? getHistoricalRate(_finSalEmpData, month);
    const shopLabel = _finSalEmpData.shopId === "store1" ? "М1" : "М2";

    document.getElementById("finSalTitle").textContent =
      `Финализирай — ${_finSalEmpData.name} (${shopLabel}) — ${formatMonth(month)}`;

    document.getElementById("finSalHours").textContent       = hours;
    document.getElementById("finSalRate").value              = rate;
    document.getElementById("finSalHoliday").value           = existing?.holidayAmount    || "";
    document.getElementById("finSalSickLeave").value         = existing?.sickLeaveAmount  || "";
    document.getElementById("finSalShopBonus").value         = existing?.shopBonusAmount  || "";
    document.getElementById("finSalPersonalBonus").value     = existing?.personalBonusAmount || "";
    document.getElementById("finSalAdvances").value          = existing ? (existing.advances ?? totalAdv) || "" : (totalAdv || "");
    document.getElementById("finSalBank").value              = existing?.bankAmount        || "";
    document.getElementById("finSalNotes").value             = existing?.notes             || "";

    // Store existing docId for update
    document.getElementById("finalizeSalModal").dataset.existingId = existing?.id || "";

    calcFinalizeTotal();
    document.getElementById("finalizeSalModal").classList.remove("hidden");
  } catch (e) { alert("Грешка при зареждане: " + e.message); }
};

window.closeFinalizeSalModal = function() {
  document.getElementById("finalizeSalModal")?.classList.add("hidden");
  _finSalEmpId = null; _finSalMonth = null; _finSalEmpData = null;
};

window.calcFinalizeTotal = function() {
  const hours     = parseFloat(document.getElementById("finSalHours")?.textContent || 0) || 0;
  const rate      = parseFloat(document.getElementById("finSalRate")?.value      || 0) || 0;
  const holiday   = parseFloat(document.getElementById("finSalHoliday")?.value   || 0) || 0;
  const sickLeave = parseFloat(document.getElementById("finSalSickLeave")?.value || 0) || 0;
  const shopBonus = parseFloat(document.getElementById("finSalShopBonus")?.value || 0) || 0;
  const persBon   = parseFloat(document.getElementById("finSalPersonalBonus")?.value || 0) || 0;
  const advances  = parseFloat(document.getElementById("finSalAdvances")?.value  || 0) || 0;
  const bank      = parseFloat(document.getElementById("finSalBank")?.value      || 0) || 0;

  const base  = hours * rate;
  const gross = base + holiday + sickLeave + shopBonus + persBon;
  const cash  = gross - advances - bank;

  const setText = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  setText("finSalBase",  base.toFixed(2)  + " €");
  setText("finSalGross", gross.toFixed(2) + " €");

  const cashEl = document.getElementById("finSalCash");
  if (cashEl) {
    cashEl.textContent = cash.toFixed(2) + " €";
    cashEl.style.color = cash < 0 ? "var(--red)" : "var(--green)";
  }
  document.getElementById("finSalOverpaidWarn")?.classList.toggle("hidden", cash >= 0);
};

window.saveFinalizeSalary = async function() {
  if (!_finSalEmpId || !_finSalMonth || !_finSalEmpData) return;

  const hours     = parseFloat(document.getElementById("finSalHours")?.textContent || 0) || 0;
  const rate      = parseFloat(document.getElementById("finSalRate")?.value      || 0) || 0;
  const holiday   = parseFloat(document.getElementById("finSalHoliday")?.value   || 0) || 0;
  const sickLeave = parseFloat(document.getElementById("finSalSickLeave")?.value || 0) || 0;
  const shopBonus = parseFloat(document.getElementById("finSalShopBonus")?.value || 0) || 0;
  const persBon   = parseFloat(document.getElementById("finSalPersonalBonus")?.value || 0) || 0;
  const advances  = parseFloat(document.getElementById("finSalAdvances")?.value  || 0) || 0;
  const bankAmount = parseFloat(document.getElementById("finSalBank")?.value     || 0) || 0;
  const notes     = document.getElementById("finSalNotes")?.value?.trim() || "";
  const existingId = document.getElementById("finalizeSalModal")?.dataset?.existingId || "";

  const base       = hours * rate;
  const totalGross = base + holiday + sickLeave + shopBonus + persBon;
  const cashAmount = totalGross - advances - bankAmount;

  const bonuses = [];
  if (holiday)   bonuses.push({ type: "Празнични часове",          amount: holiday,   note: "" });
  if (sickLeave) bonuses.push({ type: "Доплащане отпуска/болнични", amount: sickLeave, note: "" });
  if (shopBonus) bonuses.push({ type: "Бонус от оборота",           amount: shopBonus, note: "" });
  if (persBon)   bonuses.push({ type: "Личен бонус",                amount: persBon,   note: "" });

  const deductions = advances > 0 ? [{ type: "Аванс", amount: advances, note: "" }] : [];

  if (!confirm(`Финализирай заплата за ${_finSalEmpData.name}?\n\nБрутно: ${totalGross.toFixed(2)} €\nАванси: ${advances.toFixed(2)} €\nЗа кеш: ${cashAmount.toFixed(2)} €`)) return;

  const now = new Date().toISOString();
  const salData = {
    shopId:              _finSalEmpData.shopId,
    employeeId:          _finSalEmpId,
    employeeName:        _finSalEmpData.name,
    month:               _finSalMonth,
    baseHours:           hours,
    baseRate:            rate,
    baseAmount:          base,
    holidayAmount:       holiday,
    sickLeaveAmount:     sickLeave,
    shopBonusAmount:     shopBonus,
    personalBonusAmount: persBon,
    bonuses,
    deductions,
    totalGross,
    advances,
    bankAmount,
    cashAmount,
    notes,
    status:    "approved",
    updatedAt: now,
    changeLog: [{ by: currentUserId, at: now,
      action: `Финализирана — ${hours}ч × ${rate} = ${base.toFixed(2)} + добавки ${(totalGross-base).toFixed(2)} − аванси ${advances.toFixed(2)} = бруто ${totalGross.toFixed(2)} €` }]
  };

  try {
    if (existingId) {
      const snap = await getDoc(doc(db,"salaries",existingId));
      const prevLog = snap.data()?.changeLog || [];
      await updateDoc(doc(db,"salaries",existingId), { ...salData, changeLog: [...prevLog, salData.changeLog[0]] });
    } else {
      salData.createdAt = now;
      await addDoc(collection(db,"salaries"), salData);
    }

    // Update employee rate if changed
    const origRate = getHistoricalRate(_finSalEmpData, _finSalMonth);
    if (rate !== origRate) {
      const hist = _finSalEmpData.hourlyRateHistory ? [..._finSalEmpData.hourlyRateHistory] : [];
      const idx  = hist.findIndex(h => h.month === _finSalMonth);
      if (idx >= 0) hist[idx].rate = rate; else hist.push({ month: _finSalMonth, rate });
      await updateDoc(doc(db,"employees",_finSalEmpId), { hourlyRate: rate, hourlyRateHistory: hist });
    }

    showStatusMsg("✅ Ведомостта е финализирана");
    const empId = _finSalEmpId;
    closeFinalizeSalModal();
    await loadSalHistByEmployee(empId);
  } catch (e) { alert("Грешка: " + e.message); }
};

window.openSalarySlipByEmp = async function(empId, month) {
  try {
    const snap = await getDocs(query(
      collection(db,"salaries"),
      where("employeeId","==",empId),
      where("month","==",month)
    ));
    if (snap.empty) { alert("Първо финализирай ведомостта за " + formatMonth(month) + "."); return; }
    const sal = { id: snap.docs[0].id, ...snap.docs[0].data() };
    let empName = sal.employeeName || "";
    if (!empName) {
      const empSnap = await getDoc(doc(db,"employees",empId));
      empName = empSnap.exists() ? empSnap.data().name : "Неизвестен";
    }
    const shopLabel = sal.shopId === "store1" ? "Магазин М1" : "Магазин М2";
    const pdf = await generateSalarySlipPDF(sal, empName, shopLabel);
    pdf.save(`фиш_${empName.replace(/\s+/g,"_")}_${month}.pdf`);
  } catch (e) { alert("Грешка при генериране: " + e.message); }
};

// ── Salary slip PDF ────────────────────────────────────────
async function generateSalarySlipPDF(sal, empName, shopLabel) {
  await _loadRobotoFont();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  pdf.addFileToVFS("DejaVuSans.ttf", _robotoRegular);
  pdf.addFileToVFS("DejaVuSans-Bold.ttf", _robotoBold);
  pdf.addFont("DejaVuSans.ttf", "DejaVu", "normal");
  pdf.addFont("DejaVuSans-Bold.ttf", "DejaVu", "bold");

  const ml = 15, mr = 195, cw = mr - ml;
  let y = 15;

  // Header
  pdf.setFillColor(44, 62, 80);
  pdf.rect(ml, y, cw, 22, "F");
  pdf.setFont("DejaVu", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(255, 255, 255);
  pdf.text("НОН СТОП ООД — " + shopLabel, ml + cw / 2, y + 8, { align: "center" });
  pdf.setFontSize(11);
  pdf.text("ФИШ ЗА ЗАПЛАТА — " + (formatMonth(sal.month) || sal.month).toUpperCase(), ml + cw / 2, y + 16, { align: "center" });
  y += 28;

  // Employee info
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("DejaVu", "normal");
  pdf.setFontSize(10);
  pdf.text("Служител:", ml, y);
  pdf.setFont("DejaVu", "bold");
  pdf.text(empName, ml + 25, y);
  pdf.setFont("DejaVu", "normal");
  const [ym, mm] = (sal.month || "2026-01").split("-").map(Number);
  const lastDay = new Date(ym, mm, 0).getDate();
  const mmStr = String(mm).padStart(2, "0");
  pdf.text(`Период: 01.${mmStr}.${ym} — ${lastDay}.${mmStr}.${ym}`, mr, y, { align: "right" });
  y += 10;

  const divider = () => {
    pdf.setDrawColor(180, 180, 180);
    pdf.setLineWidth(0.3);
    pdf.line(ml, y, mr, y);
    y += 5;
  };

  // НАЧИСЛЕНИЯ block
  pdf.setFillColor(236, 240, 245);
  pdf.rect(ml, y, cw, 7, "F");
  pdf.setFont("DejaVu", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(44, 62, 80);
  pdf.text("НАЧИСЛЕНИЯ", ml + 3, y + 5);
  y += 10;

  pdf.setFont("DejaVu", "normal");
  pdf.setTextColor(0, 0, 0);
  const baseLabel = `Основна заплата (${sal.baseHours || 0} ч × ${(sal.baseRate || 0).toFixed(2)} €)`;
  pdf.text(baseLabel, ml + 3, y);
  pdf.text(`${(sal.baseAmount || 0).toFixed(2)} €`, mr - 3, y, { align: "right" });
  y += 7;

  (sal.bonuses || []).forEach(b => {
    if (!b.amount) return;
    const label = b.note ? `${b.type} (${b.note})` : b.type;
    pdf.text("  " + label, ml + 3, y);
    pdf.text(`+${(b.amount).toFixed(2)} €`, mr - 3, y, { align: "right" });
    y += 7;
  });

  divider();

  // УДРЪЖКИ block — show advances + bank
  const advAmt  = sal.advances ?? (sal.deductions || []).reduce((s,d) => s+(d.amount||0), 0);
  const bankAmt = sal.bankAmount || 0;
  if (advAmt > 0 || bankAmt > 0 || (sal.deductions || []).some(d => d.amount > 0)) {
    pdf.setFillColor(236, 240, 245);
    pdf.rect(ml, y, cw, 7, "F");
    pdf.setFont("DejaVu", "bold");
    pdf.setTextColor(44, 62, 80);
    pdf.text("УДРЪЖКИ", ml + 3, y + 5);
    y += 10;
    pdf.setFont("DejaVu", "normal");
    pdf.setTextColor(0, 0, 0);
    if (advAmt > 0) {
      pdf.text("  Аванси", ml + 3, y);
      pdf.text(`−${advAmt.toFixed(2)} €`, mr - 3, y, { align: "right" });
      y += 7;
    }
    if (bankAmt > 0) {
      pdf.text("  По банков път", ml + 3, y);
      pdf.text(`−${bankAmt.toFixed(2)} €`, mr - 3, y, { align: "right" });
      y += 7;
    }
    // additional deductions not covered by advances
    if (!sal.advances) {
      (sal.deductions || []).forEach(d => {
        if (!d.amount || d.type === "Аванс") return;
        const label = d.note ? `${d.type} (${d.note})` : d.type;
        pdf.text("  " + label, ml + 3, y);
        pdf.text(`−${(d.amount).toFixed(2)} €`, mr - 3, y, { align: "right" });
        y += 7;
      });
    }
    divider();
  }

  // ОБЩО БРУТНО
  y += 2;
  pdf.setFillColor(44, 62, 80);
  pdf.rect(ml, y, cw, 9, "F");
  pdf.setFont("DejaVu", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(255, 255, 255);
  pdf.text("ОБЩО БРУТНО:", ml + 4, y + 6.5);
  pdf.text(`${(sal.totalGross || 0).toFixed(2)} €`, mr - 4, y + 6.5, { align: "right" });
  y += 15;

  // НАЧИН НА ИЗПЛАЩАНЕ
  pdf.setFillColor(236, 240, 245);
  pdf.rect(ml, y, cw, 7, "F");
  pdf.setFont("DejaVu", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(44, 62, 80);
  pdf.text("НАЧИН НА ИЗПЛАЩАНЕ", ml + 3, y + 5);
  y += 10;

  const cashAmt = sal.cashAmount !== undefined
    ? sal.cashAmount
    : Math.max(0, (sal.totalGross || 0) - advAmt - bankAmt);
  const boxW = (cw - 8) / 2;
  pdf.setDrawColor(44, 62, 80);
  pdf.setLineWidth(0.4);
  pdf.roundedRect(ml, y, boxW, 16, 2, 2);
  pdf.setFont("DejaVu", "bold");
  pdf.setTextColor(44, 62, 80);
  pdf.setFontSize(9);
  pdf.text("В БРОЙ:", ml + 4, y + 6);
  pdf.setFont("DejaVu", "normal");
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(11);
  pdf.text(`${cashAmt.toFixed(2)} €`, ml + 4, y + 13);

  const bx = ml + boxW + 8;
  pdf.roundedRect(bx, y, boxW, 16, 2, 2);
  pdf.setFont("DejaVu", "bold");
  pdf.setTextColor(44, 62, 80);
  pdf.setFontSize(9);
  pdf.text("ПО БАНКОВ ПЪТ:", bx + 4, y + 6);
  pdf.setFont("DejaVu", "normal");
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(11);
  pdf.text(bankAmt > 0 ? `${bankAmt.toFixed(2)} €` : "—", bx + 4, y + 13);
  y += 22;

  // Notes
  if (sal.notes) {
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("Бележки: " + sal.notes, ml, y);
    y += 8;
  }

  // Signature
  y = Math.max(y + 10, 235);
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("DejaVu", "normal");
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.3);
  pdf.line(ml, y + 8, ml + 70, y + 8);
  pdf.text("Подпис на служителя", ml, y + 13);
  pdf.text("Дата: ______________________", mr - 3, y + 13, { align: "right" });

  // Footer
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text(`Генериран: ${new Date().toLocaleDateString("bg-BG")} | Нон Стоп ООД`, 105, 288, { align: "center" });

  return pdf;
}

window.exportSalarySlip = async function(salId) {
  try {
    const snap = await getDoc(doc(db, "salaries", salId));
    if (!snap.exists()) { alert("Записът не е намерен."); return; }
    const sal = { id: snap.id, ...snap.data() };

    let empName = sal.employeeName || "";
    if (!empName && sal.employeeId) {
      const empSnap = await getDoc(doc(db, "employees", sal.employeeId));
      empName = empSnap.exists() ? empSnap.data().name : "Неизвестен";
    }

    const shopLabel = sal.shopId === "store1" ? "Магазин М1" : "Магазин М2";
    const pdf = await generateSalarySlipPDF(sal, empName, shopLabel);
    const safeName = empName.replace(/\s+/g, "_");
    pdf.save(`фиш_${safeName}_${sal.month}.pdf`);
  } catch (e) { alert("Грешка при генериране на фиш: " + e.message); }
};

async function loadSalHistAnalysis() {
  const el = document.getElementById("salHistAnalysisContent");
  if (!el) return;
  el.innerHTML = `<div class="tasks-empty">Зареждане...</div>`;
  try {
    const [s1, s2] = await Promise.all([
      getDocs(query(collection(db,"salaries"), where("shopId","==","store1"))),
      getDocs(query(collection(db,"salaries"), where("shopId","==","store2")))
    ]);
    const byMonth = {};
    const push = (docs, key) => docs.forEach(d => {
      const r = d.data();
      if (!byMonth[r.month]) byMonth[r.month] = { s1:0, s2:0 };
      byMonth[r.month][key] += (r.totalGross||0);
    });
    push(s1.docs,"s1"); push(s2.docs,"s2");

    const months = Object.keys(byMonth).sort().slice(-12);
    if (!months.length) { el.innerHTML = `<div class="tasks-empty">Няма данни</div>`; return; }

    const s1Data  = months.map(m => +(byMonth[m]?.s1||0).toFixed(2));
    const s2Data  = months.map(m => +(byMonth[m]?.s2||0).toFixed(2));
    const labels  = months.map(m => { const [y,mo]=m.split("-"); return ["Яну","Фев","Мар","Апр","Май","Юни","Юли","Авг","Сеп","Окт","Ное","Дек"][Number(mo)-1]+" "+y; });
    const totS1   = s1Data.reduce((a,b)=>a+b,0);
    const totS2   = s2Data.reduce((a,b)=>a+b,0);
    const avgMon  = months.length ? ((totS1+totS2)/months.length).toFixed(2) : 0;

    el.innerHTML = `
      <div class="wh-sum-cards" style="margin-bottom:16px">
        <div class="wh-sum-card">
          <div class="wh-sum-label">М1 — Общо заплати</div>
          <div class="wh-sum-value">${totS1.toFixed(0)} €</div>
        </div>
        <div class="wh-sum-card">
          <div class="wh-sum-label">М2 — Общо заплати</div>
          <div class="wh-sum-value">${totS2.toFixed(0)} €</div>
        </div>
        <div class="wh-sum-card wh-sum-card-total">
          <div class="wh-sum-label">Средно/месец</div>
          <div class="wh-sum-value">${avgMon} €</div>
        </div>
      </div>
      <div class="sal-chart-wrap card dr-card">
        <canvas id="salAnalysisChart"></canvas>
      </div>`;

    if (_salHistChart) { _salHistChart.destroy(); _salHistChart = null; }
    const ctx = document.getElementById("salAnalysisChart")?.getContext("2d");
    if (ctx && window.Chart) {
      _salHistChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Магазин 1", data: s1Data, backgroundColor: "rgba(63,185,80,.55)", borderColor: "#3fb950", borderWidth: 1 },
            { label: "Магазин 2", data: s2Data, backgroundColor: "rgba(88,166,255,.55)", borderColor: "#58a6ff", borderWidth: 1 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: "#8b949e" } } },
          scales: {
            x: { ticks: { color:"#8b949e" }, grid: { color:"rgba(255,255,255,.05)" } },
            y: { ticks: { color:"#8b949e" }, grid: { color:"rgba(255,255,255,.05)" } }
          }
        }
      });
    }
  } catch (e) { el.innerHTML = `<div class="tasks-empty">Грешка</div>`; }
}

// ════════════════════════════════════════════════════════════
// ⌨️  DESKTOP KEYBOARD NAVIGATION (1024px+)
// ════════════════════════════════════════════════════════════

document.addEventListener("keydown", e => {
  // Esc — затваря всички модали (работи на всички устройства)
  if (e.key === "Escape") {
    const cellModal = document.getElementById("whCellModal");
    if (cellModal && !cellModal.classList.contains("hidden")) {
      cellModal.classList.add("hidden");
      return;
    }
    const drModal = document.getElementById("drDetailModal");
    if (drModal && !drModal.classList.contains("hidden")) {
      drModal.classList.add("hidden");
      return;
    }
    return;
  }

  // Само desktop (≥1024px) за останалите shortcuts
  if (window.innerWidth < 1024) return;

  // Enter в DR input → следващ ред, същата колона
  if (e.key === "Enter" && e.target.classList.contains("dr-input")) {
    e.preventDefault();
    const td    = e.target.closest("td");
    const tr    = e.target.closest("tr");
    const tbody = e.target.closest("tbody");
    if (!td || !tr || !tbody) return;
    const colIdx  = Array.from(tr.children).indexOf(td);
    const rows    = Array.from(tbody.rows);
    const nextRow = rows[rows.indexOf(tr) + 1];
    if (nextRow) {
      const next = nextRow.children[colIdx]?.querySelector("input,select,textarea");
      if (next) { next.focus(); if (next.select) next.select(); }
    }
  }
});


// ── Backup управление ────────────────────────────────────────────────────
window.triggerBackupNow = async function() {
  const btn  = document.getElementById('backupNowBtn');
  const stat = document.getElementById('backupStatus');
  if (!btn || !stat) return;
  if (!confirm('Стартиране на ръчен backup на цялата база? Това отнема няколко минути.')) return;

  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Стартиране...';
  stat.style.color = 'var(--text2)';
  stat.textContent = '⏳ Изпращане на заявка...';

  try {
    const { getFunctions, httpsCallable } =
      await import("https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js");
    const fns = getFunctions(app, 'us-central1');
    const fn  = httpsCallable(fns, 'triggerBackupNow');
    const res = await fn({});
    console.log('Backup triggered:', res.data);
    stat.style.color = '#4caf50';
    stat.textContent = '✅ Backup стартиран! Проверете след няколко минути в Cloud Storage.';
  } catch (err) {
    console.error('triggerBackupNow:', err);
    stat.style.color = '#f44336';
    stat.textContent = '❌ Грешка: ' + (err.message || err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    setTimeout(() => loadLastBackupStatus(), 4000);
  }
};

async function loadLastBackupStatus() {
  const stat = document.getElementById('backupStatus');
  if (!stat) return;
  try {
    const snap = await getDocs(collection(db, '_backups'));
    if (snap.empty) { stat.textContent = 'ℹ️ Все още няма backup.'; return; }
    const docs = snap.docs
      .map(d => d.data())
      .filter(d => d.startedAt)
      .sort((a, b) => {
        const ta = a.startedAt?.toMillis ? a.startedAt.toMillis() : 0;
        const tb = b.startedAt?.toMillis ? b.startedAt.toMillis() : 0;
        return tb - ta;
      });
    if (!docs.length) { stat.textContent = 'ℹ️ Все още няма backup.'; return; }
    const last  = docs[0];
    const dt    = last.startedAt?.toDate ? last.startedAt.toDate() : new Date();
    const dtStr = dt.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' });
    const icon  = last.status === 'failed' ? '❌' : last.status === 'started' ? '⏳' : '✅';
    const tag   = last.manual ? ' (ръчен)' : '';
    const errTxt = last.error ? ` — ${last.error.slice(0, 80)}` : '';
    stat.style.color = last.status === 'failed' ? '#f44336' : 'var(--text2)';
    stat.textContent = `${icon} Последен backup: ${dtStr}${tag}${errTxt}`;
  } catch (e) {
    console.warn('loadLastBackupStatus:', e);
    stat.textContent = 'ℹ️ Не може да зареди статуса.';
  }
}
window.loadLastBackupStatus = loadLastBackupStatus;

// ══════════════════════════════════════════════════════════════
// МЕСЕЧНА СПРАВКА
// ══════════════════════════════════════════════════════════════

const _mrMonthNames = [
  'Януари','Февруари','Март','Април','Май','Юни',
  'Юли','Август','Септември','Октомври','Ноември','Декември'
];

function _mrPopulateMonthSelect() {
  const sel = document.getElementById('mrMonthSel');
  if (!sel) return;
  const now = new Date();
  sel.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = _mrMonthNames[d.getMonth()] + ' ' + d.getFullYear();
    sel.appendChild(opt);
  }
}

function _mrFmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return Number(n).toFixed(2);
}

function _mrDiffSpan(diff, lowerIsBetter) {
  if (diff === undefined || diff === null || isNaN(diff)) return '<span style="color:var(--text2)">—</span>';
  const up = lowerIsBetter ? diff < 0 : diff > 0;
  const col = up ? '#4caf50' : '#f44336';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '●';
  const sign = diff > 0 ? '+' : '';
  return `<span style="color:${col}">${arrow} ${sign}${_mrFmt(diff)} €</span>`;
}

function _mrRender(d) {
  const el = document.getElementById('mrContent');
  if (!el) return;

  const shopLabel = d.shopId === 'store1' ? 'Магазин 1' : d.shopId === 'store2' ? 'Магазин 2' : d.shopId || '—';
  const period = d.monthLabel || (d.month || '');

  el.innerHTML = `
<div style="margin-bottom:10px;color:var(--text2);font-size:0.85rem;">
  ${shopLabel} &mdash; ${period}
  ${d.generatedAt ? ' &mdash; генерирана ' + new Date(d.generatedAt.seconds * 1000).toLocaleString('bg-BG', {timeZone:'Europe/Sofia'}) : ''}
</div>

<div class="wr-compare-row" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;display:grid;">

  <div class="wr-compare-card">
    <div class="wr-compare-label">Оборот (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.totalRevenue)}</div>
    ${d.prevMonth ? `<div class="wr-compare-diff">${_mrDiffSpan((d.totalRevenue||0)-(d.prevMonth.totalRevenue||0), false)}</div>` : ''}
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Стока (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.totalGoods)}</div>
    ${d.prevMonth ? `<div class="wr-compare-diff">${_mrDiffSpan((d.totalGoods||0)-(d.prevMonth.totalGoods||0), true)}</div>` : ''}
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Нетна (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.netRevenue)}</div>
    ${d.prevMonth ? `<div class="wr-compare-diff">${_mrDiffSpan((d.netRevenue||0)-(d.prevMonth.netRevenue||0), false)}</div>` : ''}
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Каса Кеш (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.cashBalance)}</div>
    ${d.prevMonth ? `<div class="wr-compare-diff">${_mrDiffSpan((d.cashBalance||0)-(d.prevMonth.cashBalance||0), false)}</div>` : ''}
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Каса Банка (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.bankBalance)}</div>
    ${d.prevMonth ? `<div class="wr-compare-diff">${_mrDiffSpan((d.bankBalance||0)-(d.prevMonth.bankBalance||0), false)}</div>` : ''}
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Работни дни</div>
    <div class="wr-compare-val">${d.workingDays ?? '—'}</div>
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Служители</div>
    <div class="wr-compare-val">${d.employeeCount ?? '—'}</div>
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Работни часа</div>
    <div class="wr-compare-val">${_mrFmt(d.totalHours)}</div>
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Заплати (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.totalSalaries)}</div>
  </div>

  <div class="wr-compare-card">
    <div class="wr-compare-label">Аванси (€)</div>
    <div class="wr-compare-val">${_mrFmt(d.totalAdvances)}</div>
  </div>

</div>

${d.topSuppliers && d.topSuppliers.length ? `
<h4 style="margin:14px 0 6px;color:var(--text1)">Топ доставчици</h4>
<table class="wr-table" style="width:100%;border-collapse:collapse;">
  <thead><tr>
    <th style="text-align:left;padding:4px 8px;background:var(--bg2)">Доставчик</th>
    <th style="text-align:right;padding:4px 8px;background:var(--bg2)">Сума (€)</th>
  </tr></thead>
  <tbody>
    ${d.topSuppliers.map(s => `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid var(--border)">${s.name || s.supplierId || '—'}</td>
      <td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${_mrFmt(s.total)}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}
`;
}

async function loadMonthlyReport() {
  const sel    = document.getElementById('mrMonthSel');
  const status = document.getElementById('mrStatus');
  const el     = document.getElementById('mrContent');
  if (!sel || !el) return;

  const monthVal = sel.value; // "2026-05"
  if (!monthVal) { el.innerHTML = '<div class="tasks-empty">Изберете месец.</div>'; return; }

  if (status) status.textContent = '';
  el.innerHTML = '<div class="tasks-empty">⏳ Зареждане...</div>';

  try {
    // DocId е директно "YYYY-MM" — четем по ключ, не по query
    const ref = doc(db, 'monthly_reports', monthVal);
    let snap;
    try { snap = await getDocFromServer(ref); }
    catch (e) { snap = await getDoc(ref); }
    console.log('[monthly] exists:', snap.exists(), 'for', monthVal);

    if (!snap.exists()) {
      el.innerHTML = `<div class="tasks-empty">Няма месечна справка за ${monthVal}.<br>Може да я генерирате ръчно.</div>`;
      return;
    }

    el.innerHTML = '';
    _mrRenderInto(el, snap.data(), monthVal);
  } catch (e) {
    console.error('loadMonthlyReport:', e);
    el.innerHTML = '<div class="tasks-empty" style="color:#f44336">Грешка при зареждане: ' + e.message + '</div>';
  }
}

function _mrRenderInto(el, d, monthVal) {
  const p = d.period || {};
  const monthLabel = (p.month && p.year)
    ? _mrMonthNames[p.month - 1] + ' ' + p.year
    : (monthVal || '');
  const cmp = d.comparison || null;

  // Comparison helpers — skip if prev month had no data
  const hasPrevData = cmp && cmp.prevTotals && ((cmp.prevTotals.turnover || 0) > 0 || (cmp.prevTotals.netProfit || 0) > 0);
  const prevLabel   = (hasPrevData && cmp.prevMonth)
    ? _mrMonthNames[(cmp.prevMonth || 1) - 1] + (cmp.prevYear ? ' ' + cmp.prevYear : '')
    : null;

  const kpiDiff = (abs, pct, lowerIsBetter) => {
    if (!hasPrevData || abs === undefined || abs === null || isNaN(abs)) return '';
    const up  = lowerIsBetter ? abs < 0 : abs > 0;
    const col = abs === 0 ? 'var(--text2)' : up ? '#4caf50' : '#f44336';
    const arr = abs > 0 ? '▲' : abs < 0 ? '▼' : '●';
    const pctStr = (pct !== undefined && pct !== null && isFinite(pct))
      ? ' (' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%)'
      : '';
    return '<span class="mr-kpi-diff-val" style="color:' + col + '">'
      + arr + ' ' + (abs > 0 ? '+' : '') + _mrFmt(abs) + ' €' + pctStr
      + '</span>';
  };

  // ── СЕКЦИЯ 1: KPI карти ───────────────────────────────────
  const kpiCards = [
    {
      label: 'Оборот',
      val:   _mrFmt(d.totalTurnover) + ' €',
      diff:  kpiDiff(cmp?.turnover?.abs,   cmp?.turnover?.pct,   false),
      accent: false
    },
    {
      label: 'Стока',
      val:   _mrFmt(d.totalStoka) + ' €',
      diff:  kpiDiff(cmp?.stoka?.abs,      cmp?.stoka?.pct,      true),
      accent: false
    },
    {
      label: 'Нетна печалба',
      val:   _mrFmt(d.netProfit) + ' €',
      diff:  kpiDiff(cmp?.netProfit?.abs,  cmp?.netProfit?.pct,  false),
      accent: true
    },
    {
      label: 'Затворени дни',
      val:   String(d.closedDaysCount ?? '—'),
      diff:  hasPrevData && (cmp?.closedDays?.abs !== undefined)
               ? kpiDiff(cmp.closedDays.abs, null, false)
               : '',
      accent: false
    }
  ].map(c =>
    '<div class="mr-kpi-card' + (c.accent ? ' mr-kpi-card--accent' : '') + '">'
    + '<div class="mr-kpi-label">' + c.label + '</div>'
    + '<div class="mr-kpi-value">' + c.val + '</div>'
    + (c.diff
        ? '<div class="mr-kpi-diff">' + c.diff + '</div>'
        : (hasPrevData ? '' : '<div class="mr-kpi-diff mr-kpi-no-cmp">—</div>'))
    + '</div>'
  ).join('');

  // ── СЕКЦИЯ 2: Финансови детайли ───────────────────────────
  const finRows = [
    { label: 'Заплати',                val: _mrFmt(d.totalSalary)      + ' €', bold: false },
    { label: 'Аванси',                 val: _mrFmt(d.totalAdvances)    + ' €', bold: false },
    { label: 'Оставени за зареждане',  val: _mrFmt(d.totalLeftForStock)+ ' €', bold: false },
    { label: 'ДДС за внасяне',         val: _mrFmt(d.vatDue)           + ' €', bold: true  },
    { label: 'Корп. данък (10%)',       val: _mrFmt(d.corpTax)          + ' €', bold: true  },
  ].map((r, i) =>
    '<tr class="' + (i % 2 === 0 ? 'mr-tr-even' : '') + (r.bold ? ' mr-tr-bold' : '') + '">'
    + '<td class="mr-td-label">' + r.label + '</td>'
    + '<td class="mr-td-val">'   + r.val   + '</td>'
    + '</tr>'
  ).join('');

  // ── СЕКЦИЯ 3: Най-добър / Най-лош ден ────────────────────
  const dayBadges = (d.bestDay || d.worstDay) ? (
    (d.bestDay ? '<div class="mr-day-badge mr-day-badge--best">'
      + '<span class="mr-day-icon">🏆</span>'
      + '<span class="mr-day-info"><span class="mr-day-title">Най-добър ден</span>'
      + '<span class="mr-day-detail">' + d.bestDay.date + ' &mdash; ' + _mrFmt(d.bestDay.turnover) + ' €</span></span>'
      + '</div>' : '')
    + (d.worstDay ? '<div class="mr-day-badge mr-day-badge--worst">'
      + '<span class="mr-day-icon">📉</span>'
      + '<span class="mr-day-info"><span class="mr-day-title">Най-слаб ден</span>'
      + '<span class="mr-day-detail">' + d.worstDay.date + ' &mdash; ' + _mrFmt(d.worstDay.turnover) + ' €</span></span>'
      + '</div>' : '')
  ) : '';

  // ── СЕКЦИЯ 4: По магазин ──────────────────────────────────
  let shopTableHtml = '';
  if (d.perShop) {
    const shops = ['store1', 'store2'].filter(sid => d.perShop[sid]);
    if (shops.length) {
      const totalTurnover = shops.reduce((s, sid) => s + (d.perShop[sid].turnover  || 0), 0);
      const totalStoka    = shops.reduce((s, sid) => s + (d.perShop[sid].stoka     || 0), 0);
      const totalNet      = shops.reduce((s, sid) => s + (d.perShop[sid].netProfit || 0), 0);
      const totalDays     = shops.reduce((s, sid) => s + (d.perShop[sid].closedDays|| 0), 0);

      const shopRows = shops.map(sid => {
        const ps  = d.perShop[sid];
        const lbl = sid === 'store1' ? 'Магазин 1' : 'Магазин 2';
        return '<tr>'
          + '<td class="mr-td-label">' + lbl + '</td>'
          + '<td class="mr-td-val">' + _mrFmt(ps.turnover)  + ' €</td>'
          + '<td class="mr-td-val">' + _mrFmt(ps.stoka)     + ' €</td>'
          + '<td class="mr-td-val">' + _mrFmt(ps.netProfit) + ' €</td>'
          + '<td class="mr-td-val">' + (ps.closedDays ?? '—') + '</td>'
          + '</tr>';
      }).join('');

      shopTableHtml =
        '<tr class="mr-tr-total">'
        + '<td class="mr-td-label">ОБЩО</td>'
        + '<td class="mr-td-val">' + _mrFmt(totalTurnover) + ' €</td>'
        + '<td class="mr-td-val">' + _mrFmt(totalStoka)    + ' €</td>'
        + '<td class="mr-td-val">' + _mrFmt(totalNet)      + ' €</td>'
        + '<td class="mr-td-val">' + totalDays + '</td>'
        + '</tr>';

      shopTableHtml = '<div class="mr-table-wrap"><table class="mr-table">'
        + '<thead><tr>'
        + '<th class="mr-th-label">Магазин</th>'
        + '<th class="mr-th-val">Оборот</th>'
        + '<th class="mr-th-val">Стока</th>'
        + '<th class="mr-th-val">Нетна печалба</th>'
        + '<th class="mr-th-val">Дни</th>'
        + '</tr></thead>'
        + '<tbody>' + shopRows + '</tbody>'
        + '<tfoot>' + shopTableHtml + '</tfoot>'
        + '</table></div>';
    }
  }

  // ── Сглобяване ────────────────────────────────────────────
  const genLine = d.generatedAt
    ? '<div class="mr-gen-line">генерирана '
      + new Date(d.generatedAt.seconds * 1000).toLocaleString('bg-BG', {timeZone: 'Europe/Sofia'})
      + (prevLabel ? ' &nbsp;·&nbsp; сравнение с ' + prevLabel : '')
      + '</div>'
    : '';

  el.innerHTML =
    genLine

    // Секция 1
    + '<div class="mr-kpi-grid">' + kpiCards + '</div>'

    // Секция 2
    + '<div class="mr-section">'
    + '<div class="mr-section-title">Финансови детайли</div>'
    + '<div class="mr-table-wrap"><table class="mr-table mr-table--narrow">'
    + '<tbody>' + finRows + '</tbody>'
    + '</table></div>'
    + '</div>'

    // Секция 3
    + (dayBadges ? '<div class="mr-section"><div class="mr-section-title">Дни</div>'
      + '<div class="mr-day-badges">' + dayBadges + '</div></div>' : '')

    // Секция 4
    + (shopTableHtml ? '<div class="mr-section"><div class="mr-section-title">По магазини</div>'
      + shopTableHtml + '</div>' : '');
}

window.loadMonthlyReport = loadMonthlyReport;

window.triggerMonthlyManual = async function() {
  const sel    = document.getElementById('mrMonthSel');
  const status = document.getElementById('mrStatus');
  if (!sel || !status) return;
  const monthVal = sel.value;
  if (!monthVal) { alert('Изберете месец.'); return; }
  if (!confirm(`Генериране на месечна справка за ${monthVal}? Може да отнеме около минута.`)) return;

  status.style.color = 'var(--text2)';
  status.textContent = '⏳ Генериране...';

  try {
    const { getFunctions, httpsCallable } =
      await import("https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js");
    const fns = getFunctions(app, 'us-central1');
    const fn  = httpsCallable(fns, 'generateMonthlyReportManual');
    const res = await fn({ month: monthVal });
    status.style.color = '#4caf50';
    status.textContent = '✅ ' + (res.data?.message || 'Готово!');
    setTimeout(() => loadMonthlyReport(), 1500);
  } catch (err) {
    console.error('triggerMonthlyManual:', err);
    status.style.color = '#f44336';
    status.textContent = '❌ Грешка: ' + (err.message || err);
  }
};

window.exportMonthlyPDF = async function() {
  const sel = document.getElementById('mrMonthSel');
  if (!sel?.value) { alert('Изберете месец.'); return; }
  const monthVal = sel.value;

  // DocId е "YYYY-MM" — четем директно по ключ
  const ref = doc(db, 'monthly_reports', monthVal);
  let snap;
  try { snap = await getDocFromServer(ref); }
  catch (e) { snap = await getDoc(ref); }
  if (!snap.exists()) { alert('Няма генерирана справка за ' + monthVal + '. Натиснете "Генерирай" първо.'); return; }

  const d = snap.data();
  // Извличаме месец/година от docId ("2026-05"), не от d.period
  const [yearStr, monthStr] = monthVal.split('-');
  const monthLabel = _mrMonthNames[Number(monthStr) - 1] + ' ' + yearStr;

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await _loadRobotoFont();
  pdf.addFileToVFS('DejaVuSans.ttf',      _robotoRegular);
  pdf.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', _robotoBold);
  pdf.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  pdf.setFont('DejaVuSans');

  let yPos = 15;
  pdf.setFont('DejaVuSans', 'bold');
  pdf.setFontSize(14);
  pdf.text('Месечна справка', 14, yPos);
  yPos += 7;
  pdf.setFont('DejaVuSans', 'normal');
  pdf.setFontSize(10);
  pdf.text(monthLabel, 14, yPos);
  yPos += 8;

  const rows = [
    ['Оборот (€)',                _mrFmt(d.totalTurnover)],
    ['  в т.ч. Кеш (€)',         _mrFmt(d.totalCash)],
    ['  в т.ч. ПОС (€)',         _mrFmt(d.totalPos)],
    ['Стока (€)',                 _mrFmt(d.totalStoka)],
    ['Нетна печалба (€)',        _mrFmt(d.netProfit)],
    ['Заплати (€)',               _mrFmt(d.totalSalary)],
    ['Аванси (€)',                _mrFmt(d.totalAdvances)],
    ['Оставени за зареждане (€)', _mrFmt(d.totalLeftForStock)],
    ['Странични приходи (€)',     _mrFmt(d.totalSideInc)],
    ['ДДС дължим (€)',            _mrFmt(d.vatDue)],
    ['Корп. данък (€)',           _mrFmt(d.corpTax)],
    ['Затворени дни',               String(d.closedDaysCount ?? '—')],
    ['  Магазин 1',                 String(d.closedDaysByShop && d.closedDaysByShop.store1 != null ? d.closedDaysByShop.store1 : '—')],
    ['  Магазин 2',                 String(d.closedDaysByShop && d.closedDaysByShop.store2 != null ? d.closedDaysByShop.store2 : '—')],
  ];

  pdf.autoTable({
    startY: yPos,
    head: [['Показател', 'Стойност']],
    body: rows,
    styles: { font: 'DejaVuSans', fontSize: 10 },
    headStyles: { fillColor: [255, 202, 40], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  yPos = pdf.lastAutoTable.finalY + 8;

  // По магазин
  if (d.perShop) {
    pdf.setFont('DejaVuSans', 'bold');
    pdf.setFontSize(11);
    pdf.text('По магазин', 14, yPos);
    yPos += 2;
    const psRows = ['store1', 'store2'].map(sid => {
      const ps = d.perShop[sid] || {};
      const lbl = sid === 'store1' ? 'Магазин 1' : 'Магазин 2';
      return [lbl, _mrFmt(ps.turnover), _mrFmt(ps.stoka), _mrFmt(ps.netProfit), String(ps.closedDays ?? '—')];
    });
    pdf.autoTable({
      startY: yPos,
      head: [['Магазин', 'Оборот', 'Стока', 'Нетна', 'Дни']],
      body: psRows,
      styles: { font: 'DejaVuSans', fontSize: 10 },
      headStyles: { fillColor: [66, 66, 66], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    yPos = pdf.lastAutoTable.finalY + 8;
  }

  // Най-добър/слаб ден
  if (d.bestDay || d.worstDay) {
    const dayRows = [];
    if (d.bestDay)  dayRows.push(['Най-добър ден',  d.bestDay.date,  _mrFmt(d.bestDay.turnover)  + ' €']);
    if (d.worstDay) dayRows.push(['Най-слаб ден',   d.worstDay.date, _mrFmt(d.worstDay.turnover) + ' €']);
    pdf.autoTable({
      startY: yPos,
      body: dayRows,
      styles: { font: 'DejaVuSans', fontSize: 10 },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
  }

  pdf.save('месечна-справка-' + monthVal + '.pdf');
};
