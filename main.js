import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
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
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
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
    renderTable();
    renderMethodSummary();
    renderChart();
    applyFilters();
    renderTaxSummary();
    renderLiveBalance();
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
    renderTable();
    renderRecentList(); renderRecentTable();
    renderMethodSummary();
    renderChart();
    applyFilters();
    renderTaxSummary();
    window.showScreen("add"); document.getElementById("bottomNav")?.classList.remove("hidden");
    renderLiveBalance(); renderTotalSummaryCards();
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
  renderChart();
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
    tr.innerHTML = `
      <td>${r.date || ""}</td>
      <td style="color:${r.category === "Пренос" ? "var(--blue)" : (r.type === "Приход" ? "#4caf50" : "#f44336")};">${r.type || ""}</td>
      <td class="money">${formatMoney(r.amount)}</td>
      <td>${r.method || ""}</td>
      <td class="store-cell" data-store="${effectiveStore(r)}" onclick="filterByStore(this.dataset.store)" title="Филтрирай по магазин">${storeLabel(effectiveStore(r))}</td>
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>
      <td style="white-space: nowrap;">
        ${
          r.imageUrl
            ? `<button class="btn-icon btn-photo" type="button" title="Снимка" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>`
            : `<span class="muted">—</span>`
        }
        ${
          isAdmin
            ? `<button class="btn-icon btn-edit" type="button" title="Редакция" onclick="editImage('${r.id}')">✏️</button>
               <button class="btn-icon btn-del" type="button" title="Изтриване" onclick="deleteRecord('${r.id}')">🗑️</button>`
            : ``
        }
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

  const isSalary   = (cat) => {
    const v = String(cat ?? "").trim().toLowerCase();
    return v === "заплата" || v === "заплати";
  };
  const isNoVat    = (cat) => String(cat ?? "").trim().toLowerCase() === "без ддс";
  const isCarryover = (cat) => String(cat ?? "").trim() === "Пренос";

  const sum = (arr) => arr.reduce((s, r) => s + Number(r.amount || 0), 0);

  // ── Приходи ────────────────────────────────────
  // С ДДС (всичко без "Без ДДС" и без "Пренос")
  const incGrossVat = sum(records.filter(r => r.type === "Приход" && !isNoVat(r.category) && !isCarryover(r.category)));
  // Без ДДС
  const incNoVat    = sum(records.filter(r => r.type === "Приход" && isNoVat(r.category)));

  // ── Разходи ────────────────────────────────────
  // С ДДС (без Заплати, без "Без ДДС", без "Пренос")
  const expGrossVat = sum(records.filter(r => r.type === "Разход" && !isSalary(r.category) && !isNoVat(r.category) && !isCarryover(r.category)));
  // Заплати — без ДДС, изключени и от печалбата
  const expSalary   = sum(records.filter(r => r.type === "Разход" && isSalary(r.category)));
  // Без ДДС — участват в печалбата, но не в ДДС
  const expNoVat    = sum(records.filter(r => r.type === "Разход" && isNoVat(r.category)));

  // ── 1) ДДС ────────────────────────────────────
  const outputVat = +(incGrossVat / 6).toFixed(2);
  const inputVat  = +(expGrossVat / 6).toFixed(2);
  const vatDue    = +Math.max(0, outputVat - inputVat).toFixed(2);

  // ── 2) Печалба (нето, без Заплати) ────────────
  // Приход нето = (с ДДС → нето) + (без ДДС → пълна сума)
  const incNet    = incGrossVat / 1.20 + incNoVat;
  // Разход нето  = (с ДДС → нето) + (без ДДС → пълна сума), Заплати изключени
  const expNet    = expGrossVat / 1.20 + expNoVat;
  const profitNet = incNet - expNet;

  const corpTax      = profitNet > 0 ? +(profitNet * 0.10).toFixed(2) : 0;
  const netProfit    = +(profitNet - corpTax).toFixed(2);

  // Обороти без ДДС (нето на "Без ДДС" транзакциите)
  const noVatNet  = incNoVat - expNoVat;
  const hasNoVat  = incNoVat > 0 || expNoVat > 0;

  tax.innerHTML = `
  <h3><i class="fa-solid fa-file-invoice-dollar"></i> Данъчна справка</h3>
  <table>
    <tr>
      <td><strong>ДДС (за внасяне):</strong></td>
      <td><strong>${vatDue.toFixed(2)} €</strong></td>
    </tr>
    ${hasNoVat ? `<tr>
      <td>Обороти без ДДС:</td>
      <td>${noVatNet.toFixed(2)} €</td>
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
    * Категории изключени от ДДС: Заплати, Без ДДС, Пренос
  </div>`;
}

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

// ── showScreen — единна функция (add / report / notes) ────────
window.showScreen = function(screen) {
  const addScreen      = document.getElementById("screen-add");
  const reportScreen   = document.getElementById("screen-report");
  const notesScreen    = document.getElementById("screen-notes");
  const ownersScreen   = document.getElementById("screen-owners");
  const accountsScreen = document.getElementById("screen-accounts");
  const isAdmin        = document.body.classList.contains("admin");

  addScreen?.classList.add("hidden");
  reportScreen?.classList.add("hidden");
  notesScreen?.classList.add("hidden");
  ownersScreen?.classList.add("hidden");
  accountsScreen?.classList.add("hidden");

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  if (screen === "report") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    reportScreen?.classList.remove("hidden");
    document.getElementById('navReports')?.classList.add('active');
    renderTable(); renderMethodSummary();
    renderChart(); applyFilters(); renderTaxSummary();

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
    const adminBtns = isAdmin
      ? `<div class="record-actions">
          ${r.imageUrl ? `<button class="btn-icon btn-photo" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>` : ''}
          <button class="btn-icon btn-edit" onclick="editImage('${r.id}')">✏️</button>
          <button class="btn-icon btn-del"  onclick="deleteRecord('${r.id}')">🗑️</button>
         </div>`
      : (r.imageUrl ? `<button class="btn-icon btn-photo" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>` : '');

    return `
      <div class="record-row">
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

// ── Напомняния за бележки — polling на всяка минута ──────────
// Следим кои вече са изпратени (в рамките на тази сесия + localStorage)
const _firedReminders = new Set(
  JSON.parse(localStorage.getItem('ns_fired_reminders') || '[]')
);

function _reminderKey(t) {
  return `${t.firestoreId}|${t.reminderDate}|${t.reminderTime}`;
}

function checkTaskReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now   = new Date();
  const nowYM = now.toISOString().slice(0, 10);        // "YYYY-MM-DD"
  const nowHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  _tasks.forEach(t => {
    if (t.done || !t.reminderDate || !t.reminderTime) return;
    const key = _reminderKey(t);
    if (_firedReminders.has(key)) return;

    if (t.reminderDate === nowYM && t.reminderTime === nowHM) {
      new Notification('📝 Нон Стоп — Бележка', {
        body: t.text,
        icon: 'icon-192.png',
        tag:  key   // предотвратява дублиране на OS ниво
      });
      _firedReminders.add(key);
      // Запази само последните 200 ключа за да не расте без край
      const arr = [..._firedReminders].slice(-200);
      localStorage.setItem('ns_fired_reminders', JSON.stringify(arr));
      console.log('📝 Reminder fired:', t.text);
    }
  });
}

// Стартирай polling веднага при зареждане + на всяка минута
// (синхронизиран с началото на следващата минута за точност)
function startReminderPolling() {
  checkTaskReminders();
  const now   = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    checkTaskReminders();
    setInterval(checkTaskReminders, 60_000);
  }, msToNextMinute);
}
startReminderPolling();

// scheduleTaskReminders остава като no-op за съвместимост
function scheduleTaskReminders() { checkTaskReminders(); }

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
  new Notification('📝 Нон Стоп — Бележка (Тест)', {
    body: `${t.text} | ${t.reminderDate} ${t.reminderTime}`,
    icon: 'icon-192.png'
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
  } else {
    localStorage.setItem('ns_notif','0');
    status.textContent = 'Изключено';
  }
};

window.sendTestNotif = function() {
  if (!('Notification' in window) || Notification.permission !== 'granted') { alert('Разреши известията първо.'); return; }
  new Notification('🏪 Нон Стоп — Тест', { body: 'Известията работят!', icon: 'icon-192.png' });
};

function scheduleReminder() {
  const now = new Date(), target = new Date(now);
  target.setHours(18, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  setTimeout(() => {
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = records.some(r => (r.date||'').startsWith(today));
    if (!hasToday && localStorage.getItem('ns_notif') === '1' && Notification.permission === 'granted') {
      new Notification('🏪 Нон Стоп — Напомняне', { body: `Няма запис за днес (${today})!`, icon: 'icon-192.png' });
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
// 🏪 ДНЕВЕН ОТЧЕТ (Управители)
// ════════════════════════════════════════════════

const DR_OPERATORS = 6;
const DR_GOODS     = 15;
const DR_OTHER     = 5;

let _drStore  = null;   // "1" | "2"
let _drStatus = "draft";
let _drData   = null;

function drReportId(store, date) {
  return `store${store}_${date}`;
}

// ── Инициализация ────────────────────────────────────
function initDailyReport(storeRole) {
  _drStore = storeRole === "store1" ? "1" : "2";
  const titleEl = document.getElementById("storeTitle");
  if (titleEl) titleEl.textContent = `Магазин ${_drStore}`;

  renderDrOperatorsTable();
  renderDrGoodsTable();
  renderDrOtherTable();

  const today = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById("drDate");
  if (dateEl) { dateEl.value = today; dateEl.max = today; }

  loadOrCreateReport();
}

// ── Рендиране на таблиците ───────────────────────────
function renderDrOperatorsTable() {
  const tbody = document.getElementById("drOperatorsBody");
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: DR_OPERATORS }, (_, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td><input type="text"   class="dr-input"      placeholder="08:00-16:00" data-op="${i}" data-field="time"></td>
      <td><input type="text"   class="dr-input"      placeholder="Оператор"   data-op="${i}" data-field="name"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-op="${i}" data-field="revenue" oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-op="${i}" data-field="cash"    oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-op="${i}" data-field="pos"     oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-op="${i}" data-field="plus"    oninput="drCalc()"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-op="${i}" data-field="minus"   oninput="drCalc()"></td>
    </tr>`).join("");
}

function renderDrGoodsTable() {
  const tbody = document.getElementById("drGoodsBody");
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: DR_GOODS }, (_, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td><input type="text"   class="dr-input"      placeholder="Доставчик" data-goods="${i}" data-field="supplier"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-goods="${i}" data-field="amount" oninput="drCalc()"></td>
    </tr>`).join("");
}

function renderDrOtherTable() {
  const tbody = document.getElementById("drOtherBody");
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: DR_OTHER }, (_, i) => `
    <tr>
      <td class="dr-num">${i + 1}</td>
      <td><input type="text"   class="dr-input"      placeholder="Описание" data-other="${i}" data-field="desc"></td>
      <td><input type="number" class="dr-input mono" step="0.01" placeholder="0.00" data-other="${i}" data-field="amount" oninput="drCalc()"></td>
    </tr>`).join("");
}

// ── Събиране на данни от формата ─────────────────────
function collectDrData() {
  const date         = document.getElementById("drDate")?.value || "";
  const startingCash = parseFloat(document.getElementById("drStartingCash")?.value) || 0;

  const operators = Array.from({ length: DR_OPERATORS }, (_, i) => ({
    time:    drField("op",    i, "time")    || "",
    name:    drField("op",    i, "name")    || "",
    revenue: parseFloat(drField("op", i, "revenue")) || 0,
    cash:    parseFloat(drField("op", i, "cash"))    || 0,
    pos:     parseFloat(drField("op", i, "pos"))     || 0,
    plus:    parseFloat(drField("op", i, "plus"))    || 0,
    minus:   parseFloat(drField("op", i, "minus"))   || 0
  }));

  const goodsExpenses = Array.from({ length: DR_GOODS }, (_, i) => ({
    supplier: drField("goods", i, "supplier") || "",
    amount:   parseFloat(drField("goods", i, "amount")) || 0
  }));

  const otherExpenses = Array.from({ length: DR_OTHER }, (_, i) => ({
    desc:   drField("other", i, "desc")   || "",
    amount: parseFloat(drField("other", i, "amount")) || 0
  }));

  const totalCash     = r2(operators.reduce((s, o) => s + o.cash, 0));
  const totalPos      = r2(operators.reduce((s, o) => s + o.pos, 0));
  const totalRevenue  = r2(operators.reduce((s, o) => s + o.revenue, 0));
  const totalPlus     = r2(operators.reduce((s, o) => s + o.plus, 0));
  const totalMinus    = r2(operators.reduce((s, o) => s + o.minus, 0));
  const totalGoods    = r2(goodsExpenses.reduce((s, g) => s + g.amount, 0));
  const totalOther    = r2(otherExpenses.reduce((s, o) => s + o.amount, 0));
  const totalExpenses = r2(totalGoods + totalOther);
  const endingCash    = r2(startingCash + totalCash - totalExpenses);

  return {
    store: _drStore, date, startingCash,
    operators, goodsExpenses, otherExpenses,
    totalCash, totalPos, totalRevenue, totalPlus, totalMinus,
    totalGoods, totalOther, totalExpenses, endingCash
  };
}

function drField(type, idx, field) {
  return document.querySelector(`[data-${type}="${idx}"][data-field="${field}"]`)?.value ?? "";
}

function setDrField(type, idx, field, val) {
  const el = document.querySelector(`[data-${type}="${idx}"][data-field="${field}"]`);
  if (el) el.value = val ?? "";
}

function r2(n) { return Math.round(n * 100) / 100; }

// ── Изчисляване и обновяване на резюмето ─────────────
window.drCalc = function() {
  const d = collectDrData();

  setText("drTotalRevenue", d.totalRevenue.toFixed(2));
  setText("drTotalCash",    d.totalCash.toFixed(2));
  setText("drTotalPos",     d.totalPos.toFixed(2));
  setText("drTotalPlus",    d.totalPlus.toFixed(2));
  setText("drTotalMinus",   d.totalMinus.toFixed(2));
  setText("drTotalGoods",   d.totalGoods.toFixed(2));
  setText("drTotalOther",   d.totalOther.toFixed(2));

  setText("drSumStarting",  d.startingCash.toFixed(2) + " €");
  setText("drSumCash",      d.totalCash.toFixed(2) + " €");
  setText("drSumExpenses",  d.totalExpenses.toFixed(2) + " €");

  const endEl = document.getElementById("drSumEnding");
  if (endEl) {
    endEl.textContent = d.endingCash.toFixed(2) + " €";
    endEl.className   = "dr-ending-value " + (d.endingCash >= 0 ? "pos" : "neg");
  }
};

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Зареждане / Нов отчет ────────────────────────────
window.loadOrCreateReport = async function() {
  const date = document.getElementById("drDate")?.value;
  if (!date || !_drStore) return;

  drSetLoading(true);
  try {
    const snap = await getDoc(doc(db, "dailyReports", drReportId(_drStore, date)));

    if (snap.exists()) {
      _drData   = snap.data();
      _drStatus = _drData.status || "draft";
      populateDrForm(_drData);
    } else {
      _drData   = null;
      _drStatus = "draft";
      clearDrForm();
      const prev = await getPrevEndingCash(_drStore, date);
      if (prev !== null) {
        const el = document.getElementById("drStartingCash");
        if (el) el.value = prev.toFixed(2);
        const hint = document.getElementById("drStartingCashHint");
        if (hint) hint.textContent = `↑ автоматично от ${prevDate(date)}`;
      }
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

async function getPrevEndingCash(store, date) {
  try {
    const q    = query(collection(db, "dailyReports"), where("store", "==", store));
    const snap = await getDocs(q);
    const prev = snap.docs
      .map(d => d.data())
      .filter(r => r.date < date && r.status === "closed")
      .sort((a, b) => b.date.localeCompare(a.date));
    return prev.length ? (prev[0].endingCash ?? 0) : null;
  } catch (e) { return null; }
}

function prevDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Попълване / Изчистване на формата ───────────────
function populateDrForm(data) {
  const el = document.getElementById("drDate");
  if (el) el.value = data.date || "";
  const sc = document.getElementById("drStartingCash");
  if (sc) sc.value = data.startingCash != null ? data.startingCash.toFixed(2) : "";

  (data.operators || []).forEach((o, i) => {
    if (i >= DR_OPERATORS) return;
    setDrField("op", i, "time",    o.time    || "");
    setDrField("op", i, "name",    o.name    || "");
    setDrField("op", i, "revenue", o.revenue || "");
    setDrField("op", i, "cash",    o.cash    || "");
    setDrField("op", i, "pos",     o.pos     || "");
    setDrField("op", i, "plus",    o.plus    || "");
    setDrField("op", i, "minus",   o.minus   || "");
  });

  (data.goodsExpenses || []).forEach((g, i) => {
    if (i >= DR_GOODS) return;
    setDrField("goods", i, "supplier", g.supplier || "");
    setDrField("goods", i, "amount",   g.amount   || "");
  });

  (data.otherExpenses || []).forEach((o, i) => {
    if (i >= DR_OTHER) return;
    setDrField("other", i, "desc",   o.desc   || "");
    setDrField("other", i, "amount", o.amount || "");
  });

  drCalc();
}

function clearDrForm() {
  document.getElementById("drStartingCash") && (document.getElementById("drStartingCash").value = "");
  document.getElementById("drStartingCashHint") && (document.getElementById("drStartingCashHint").textContent = "");
  document.querySelectorAll(".dr-input").forEach(el => { el.value = ""; });
  drCalc();
}

// ── Запази (draft) ───────────────────────────────────
window.saveDailyReport = async function() {
  await persistReport("draft");
};

// ── Затвори деня ─────────────────────────────────────
window.confirmCloseDay = async function() {
  if (_drStatus === "closed") return;
  if (!confirm("Затвори деня? Данните ще се изпратят към собственика и не може да се отменят.")) return;

  const saveBtn  = document.getElementById("drSaveBtn");
  const closeBtn = document.getElementById("drCloseBtn");
  if (saveBtn)  saveBtn.disabled  = true;
  if (closeBtn) closeBtn.disabled = true;

  try {
    const report = await persistReport("closed");
    await createMainRecordsFromDr(report);
    updateDrStatusUI();
    showDrBanner("✅ Денят е затворен! Данните са изпратени.", "success");
    await loadDrHistory();
  } catch (err) {
    console.error("confirmCloseDay:", err);
    alert("Грешка: " + err.message);
    if (saveBtn)  saveBtn.disabled  = false;
    if (closeBtn) closeBtn.disabled = false;
  }
};

async function persistReport(status) {
  const data    = collectDrData();
  const now     = new Date().toISOString();
  const isNew   = !_drData;
  const reportId = drReportId(_drStore, data.date);

  const payload = {
    ...data, status,
    lastModifiedBy:    currentUserId,
    lastModifiedEmail: currentUserEmail,
    lastModifiedAt:    now,
    createdBy:    isNew ? currentUserId    : (_drData?.createdBy    || currentUserId),
    createdEmail: isNew ? currentUserEmail : (_drData?.createdEmail || currentUserEmail),
    createdAt:    isNew ? now              : (_drData?.createdAt    || now),
    linkedRecordIds: _drData?.linkedRecordIds || []
  };

  if (status === "closed") {
    payload.closedBy    = currentUserId;
    payload.closedEmail = currentUserEmail;
    payload.closedAt    = now;
  }

  await setDoc(doc(db, "dailyReports", reportId), payload);

  await addDoc(collection(db, "reportChangeLogs"), {
    reportId,
    userId:    currentUserId,
    userEmail: currentUserEmail,
    action:    isNew ? "create" : (status === "closed" ? "close" : "save"),
    timestamp: now,
    endingCash: data.endingCash,
    summary: `М${data.store} | ${data.date} | Крайна каса: ${data.endingCash.toFixed(2)} €`
  });

  _drData   = payload;
  _drStatus = status;

  if (status === "draft") showDrBanner("💾 Запазено!", "info");
  return payload;
}

// ── Прехвърляне към главната система ────────────────
async function createMainRecordsFromDr(report) {
  const { store, date, totalCash, totalPos, totalGoods, otherExpenses } = report;
  const ids  = [];
  const note = `Дневен отчет М${store}`;

  if (totalCash > 0) {
    const ref = await addDoc(collection(db, "records"), {
      date, type: "Приход", method: "Кеш", amount: totalCash,
      store, category: "Оборот", note, imageUrl: ""
    });
    ids.push(ref.id);
  }

  if (totalPos > 0) {
    const ref = await addDoc(collection(db, "records"), {
      date, type: "Приход", method: "Карта", amount: totalPos,
      store, category: "Оборот", note, imageUrl: ""
    });
    ids.push(ref.id);
  }

  if (totalGoods > 0) {
    const suppliers = (report.goodsExpenses || [])
      .filter(g => g.amount > 0 && g.supplier)
      .map(g => g.supplier).join(", ") || note;
    const ref = await addDoc(collection(db, "records"), {
      date, type: "Разход", method: "Кеш", amount: totalGoods,
      store, category: "Стока", note: suppliers, imageUrl: ""
    });
    ids.push(ref.id);
  }

  for (const o of (otherExpenses || [])) {
    if (!o.amount || o.amount <= 0) continue;
    const ref = await addDoc(collection(db, "records"), {
      date, type: "Разход", method: "Кеш", amount: o.amount,
      store, category: "Друго", note: o.desc || note, imageUrl: ""
    });
    ids.push(ref.id);
  }

  await updateDoc(doc(db, "dailyReports", drReportId(store, date)), { linkedRecordIds: ids });
  if (_drData) _drData.linkedRecordIds = ids;
}

// ── Статус UI ────────────────────────────────────────
function updateDrStatusUI() {
  const closed  = _drStatus === "closed";
  const inputs  = document.querySelectorAll("#storeScreenReport .dr-input, #drStartingCash");
  inputs.forEach(el => { el.disabled = closed; });

  const dateEl  = document.getElementById("drDate");
  if (dateEl) dateEl.disabled = closed;

  const saveBtn = document.getElementById("drSaveBtn");
  const closeBtn = document.getElementById("drCloseBtn");
  if (saveBtn)  saveBtn.disabled  = closed;
  if (closeBtn) closeBtn.disabled = closed;

  if (closed) {
    const t = _drData?.closedAt?.slice(0, 16)?.replace("T", " ") || "—";
    showDrBanner(`🔒 Денят е затворен (${t}) — само за четене`, "closed");
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

// ── Табове ───────────────────────────────────────────
window.showStoreTab = function(tab) {
  document.getElementById("storeScreenReport")?.classList.toggle("hidden", tab !== "report");
  document.getElementById("storeScreenHistory")?.classList.toggle("hidden", tab !== "history");
  document.getElementById("storeTabReport")?.classList.toggle("active", tab === "report");
  document.getElementById("storeTabHistory")?.classList.toggle("active", tab === "history");
  if (tab === "history") loadDrHistory();
};

// ── История ──────────────────────────────────────────
async function loadDrHistory() {
  const el = document.getElementById("drHistoryList");
  if (!el) return;

  el.innerHTML = '<div class="tasks-empty">Зареждане...</div>';

  const now   = new Date();
  const ym    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const start = `${ym}-01`;
  const end   = `${ym}-31`;

  try {
    const snap = await getDocs(query(collection(db, "dailyReports"), where("store", "==", _drStore)));
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.date >= start && r.date <= end)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (!list.length) {
      el.innerHTML = '<div class="tasks-empty">Няма отчети за месеца</div>';
      return;
    }

    const fmt = n => (n || 0).toFixed(2) + " €";
    el.innerHTML = list.map(r => {
      const closed = r.status === "closed";
      return `
        <div class="dr-hist-item" onclick="openDrHistoryReport('${r.id}')">
          <div class="dr-hist-top">
            <strong>${r.date}</strong>
            <span class="dr-hist-badge ${closed ? "badge-closed" : "badge-draft"}">
              ${closed ? "✅ Затворен" : "📝 Чернова"}
            </span>
          </div>
          <div class="dr-hist-amounts">
            <span>💰 Кеш: ${fmt(r.totalCash)}</span>
            <span>💳 POS: ${fmt(r.totalPos)}</span>
            <span class="${(r.endingCash || 0) >= 0 ? "pos" : "neg"}">
              🏁 Крайна: ${fmt(r.endingCash)}
            </span>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    console.error("loadDrHistory:", err);
    el.innerHTML = '<div class="tasks-empty">Грешка при зареждане</div>';
  }
}

window.openDrHistoryReport = async function(reportId) {
  try {
    const snap = await getDoc(doc(db, "dailyReports", reportId));
    if (!snap.exists()) return;
    _drData   = snap.data();
    _drStatus = _drData.status || "draft";

    const dateEl = document.getElementById("drDate");
    if (dateEl) dateEl.value = _drData.date || "";

    populateDrForm(_drData);
    updateDrStatusUI();
    showStoreTab("report");

    // Покажи лог ако има
    await renderDrChangeLogs(reportId);
  } catch (err) {
    alert("Грешка: " + err.message);
  }
};

async function renderDrChangeLogs(reportId) {
  const el = document.getElementById("drChangeLogs");
  if (!el) return;

  try {
    const snap = await getDocs(
      query(collection(db, "reportChangeLogs"), where("reportId", "==", reportId))
    );
    const logs = snap.docs
      .map(d => d.data())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (!logs.length) { el.classList.add("hidden"); return; }

    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="dr-section-title" style="margin-top:0">📋 Лог на промени</div>
      ${logs.map(l => `
        <div class="dr-log-row">
          <span class="dr-log-action">${l.action}</span>
          <span class="dr-log-user">${l.userEmail || "—"}</span>
          <span class="dr-log-time">${(l.timestamp || "").slice(0, 16).replace("T", " ")}</span>
        </div>`).join("")}`;
  } catch (e) { console.warn("renderDrChangeLogs:", e); }
}

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
            ${u.createdAt ? `<span class="acc-date">от ${u.createdAt.slice(0,10)}</span>` : ""}
          </div>
          <div class="acc-actions">
            ${canDelete && !isDisabled ? `
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
