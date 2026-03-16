import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot
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

onAuthStateChanged(auth, user => {
  const isLoggedIn = !!(user && !user.isAnonymous);
  const isAdmin = isLoggedIn && user.email === ADMIN_EMAIL;

  if (isLoggedIn) {
    if (statusDiv) statusDiv.textContent = `🔓 Влязъл: ${user.email}${isAdmin ? " (админ)" : ""}`;
    document.body.classList.toggle("admin", isAdmin);

    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("app")?.classList.remove("hidden");
    document.getElementById("bottomNav")?.classList.remove("hidden");

    window.showScreen?.("add");
    loadRecords();
  } else {
    if (statusDiv) statusDiv.textContent = "🔐 Моля, влез с имейл и парола.";
    document.body.classList.remove("admin");

    document.getElementById("loginScreen")?.classList.remove("hidden");
    document.getElementById("app")?.classList.add("hidden");
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

  try {
    await updateDoc(doc(db, "records", editingId), { date, type, method, amount, note, category, store, imageUrl: finalImageUrl });

    const idx = records.findIndex(r => r.id === editingId);
    if (idx !== -1) records[idx] = { ...records[idx], date, type, method, amount, note, category, store, imageUrl: finalImageUrl };

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
    refreshUI();
  } catch (err) {
    alert("Грешка при изтриване: " + err.message);
  }
}
window.deleteRecord = deleteRecord;

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
// ── Нормализация ─────────────────────────────────────────────
// Единна нормализация на магазин — ползва се навсякъде
function normStore(s) {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "1" || v === "м1" || v === "m1" || v.includes("магазин 1") || v.includes("magazin 1") || v.includes("store 1")) return "1";
  if (v === "2" || v === "м2" || v === "m2" || v.includes("магазин 2") || v.includes("magazin 2") || v.includes("store 2")) return "2";
  if (v === "каса" || v === "kasa" || v === "cash") return "Каса";
  // Празно/null — показва се само при "Всички магазини"
  if (v === "" || v === "null" || v === "undefined") return "";
  return v;
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

  filteredRecords = records.filter(r => {
    if (!r) return false;
    const matchType     = !type     || r.type === type;
    const matchMethod   = !method   || normMethod(r.method) === method;
    const matchCategory = !category || (r.category ?? "").trim() === category;
    const matchStart    = !startDate || (r.date ?? "") >= startDate;
    const matchEnd      = !endDate   || (r.date ?? "") <= endDate;
    const matchStore    = !store     || normStore(r.store) === store;
    return matchType && matchMethod && matchCategory && matchStart && matchEnd && matchStore;
  });

  renderTable(filteredRecords);
  updateFilterSummary(filteredRecords);
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
function storeLabel(store) {
  const s = normStore(store);
  if (s === "1") return "🏪 М1";
  if (s === "2") return "🏪 М2";
  if (s === "Каса") return "🏧 Каса";
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
function renderTable(data = records) {
  const tbody = document.querySelector("#recordsTable tbody");
  if (!tbody) return;

  const isAdmin = document.body.classList.contains("admin");

  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date || ""}</td>
      <td style="color:${r.type === "Приход" ? "#4caf50" : "#f44336"};">${r.type || ""}</td>
      <td class="money">${formatMoney(r.amount)}</td>
      <td>${r.method || ""}</td>
      <td class="store-cell" data-store="${normStore(r.store)}" onclick="filterByStore(this.dataset.store)" title="Филтрирай по магазин">${storeLabel(r.store)}</td>
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
      <td>${storeLabel(r.store)}</td>
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

  const byStore = {};
  let totalInc = 0, totalExp = 0;
  data.forEach(r => {
    const sk = normStore(r.store);
    const label = sk === "1" ? "М1" : sk === "2" ? "М2" : (sk || "—");
    if (!byStore[label]) byStore[label] = { inc:0, exp:0 };
    const a = Number(r.amount || 0);
    if (r.type === "Приход") { byStore[label].inc += a; totalInc += a; }
    else                     { byStore[label].exp += a; totalExp += a; }
  });

  const net = totalInc - totalExp;
  const f   = n => n.toFixed(2) + " €";
  const cls = n => n >= 0 ? "color:var(--green)" : "color:var(--red)";
  const multiStore = Object.keys(byStore).length > 1;

  const storeRows = Object.entries(byStore).map(([name, v]) => {
    const sal = v.inc - v.exp;
    return `<div class="fs-store-row">
      <span class="fs-store-name">🏪 ${name}</span>
      ${v.inc ? `<span class="fs-chip inc">▲ ${f(v.inc)}</span>` : ""}
      ${v.exp ? `<span class="fs-chip exp">▼ ${f(v.exp)}</span>` : ""}
      <span class="fs-chip sal" style="${cls(sal)}">= ${f(sal)}</span>
    </div>`;
  }).join("");

  el.style.display = "block";
  el.innerHTML = `<div class="filter-summary-box">
    <div class="fs-header">📊 Резултат — <strong>${data.length}</strong> записа</div>
    <div class="fs-totals">
      <div class="fs-total-item"><span class="fs-label">Приходи</span><span class="fs-value" style="color:var(--green)">${f(totalInc)}</span></div>
      <div class="fs-total-item"><span class="fs-label">Разходи</span><span class="fs-value" style="color:var(--red)">${f(totalExp)}</span></div>
      <div class="fs-total-item"><span class="fs-label">Салдо</span><span class="fs-value" style="${cls(net)};font-size:1.1rem">${f(net)}</span></div>
    </div>
    ${multiStore ? `<div class="fs-stores">${storeRows}</div>` : ""}
  </div>`;
}

// --------------------------------------------------
// 📈 Обобщения
// --------------------------------------------------

function renderTaxSummary() {
  const tax = document.getElementById("taxSummary");
  if (!tax) return;

  const isSalaryCategory = (cat) => {
    const v = String(cat ?? "").trim().toLowerCase();
    return v === "заплата" || v === "заплати";
  };

  const sumAmounts = (arr) =>
    arr.reduce((s, r) => s + Number(r.amount || 0), 0);

  // Брутни (с ДДС) приходи/разходи от записите
  const incomeGross = sumAmounts(records.filter(r => r.type === "Приход"));
  const expenseGrossAll = sumAmounts(records.filter(r => r.type === "Разход"));

  // Разходи "Заплати" (без ДДС) – остават като нето
  const salariesGross = sumAmounts(
    records.filter(r => r.type === "Разход" && isSalaryCategory(r.category))
  );

  // Разходи с ДДС (всичко без заплати)
  const expenseGrossVatEligible = sumAmounts(
    records.filter(r => r.type === "Разход" && !isSalaryCategory(r.category))
  );

  // =========================
  // 1) ДДС (20%) при брутни суми
  // =========================
  const outputVat = +(incomeGross / 6).toFixed(2);
  const inputVat = +(expenseGrossVatEligible / 6).toFixed(2);

  // ако предпочиташ да показваме и "за възстановяване", ще го сменим
  const vatDue = +Math.max(0, outputVat - inputVat).toFixed(2);

  // =========================
  // 2) Данък печалба върху НЕТO (без ДДС)
  // =========================
  const incomeNet = incomeGross / 1.20;

  // разходи с ДДС -> нето
  const expenseNetVatEligible = expenseGrossVatEligible / 1.20;

  // заплати -> без ДДС, остават като нето
  const expenseNetAll = expenseNetVatEligible + salariesGross;

  const profitNet = incomeNet - expenseNetAll;

  const corporateTax = profitNet > 0 ? +(profitNet * 0.10).toFixed(2) : 0;
  const netProfitAfterCorpTax = +(profitNet - corporateTax).toFixed(2);

  const row = (label, value, strong = false) =>
    `<tr><td>${strong ? `<strong>${label}</strong>` : label}</td><td>${strong ? `<strong>${value}</strong>` : value}</td></tr>`;

  tax.innerHTML = `
  <h3><i class="fa-solid fa-file-invoice-dollar"></i> Данъчна справка</h3>
  <table>
    <tr>
      <td><strong>ДДС (за внасяне):</strong></td>
      <td><strong>${vatDue.toFixed(2)} €</strong></td>
    </tr>

    <tr>
      <td><strong>Печалба (без ДДС):</strong></td>
      <td><strong>${profitNet.toFixed(2)} €</strong></td>
    </tr>

    <tr>
      <td><strong>Данък печалба (10%):</strong></td>
      <td><strong>${corporateTax.toFixed(2)} €</strong></td>
    </tr>

    <tr>
      <td><strong>👉 Нетна печалба:</strong></td>
      <td>
        <strong style="color:#ffca28;">
          ${netProfitAfterCorpTax.toFixed(2)} €
        </strong>
      </td>
    </tr>
  </table>
`;
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
      ${row("💵 Общо кеш:", fmt(totals.Кеш))}
      ${row("🏦 Общо банка:", fmt(totals.Банка + totals.Карта))}
    </table>`;
}

// --------------------------------------------------
// 📊 Chart.js
// --------------------------------------------------
function renderChart() {
  const canvas = document.getElementById("chart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const monthData = {};

  records.forEach(r => {
    const m = (r.date || "").slice(0, 7);
    if (!m) return;
    if (!monthData[m]) monthData[m] = { income: 0, expense: 0 };
    if (r.type === "Приход") monthData[m].income += Number(r.amount || 0);
    if (r.type === "Разход") monthData[m].expense += Number(r.amount || 0);
  });

  const labels = Object.keys(monthData).sort();
  const incomeData = labels.map(m => monthData[m].income);
  const expenseData = labels.map(m => monthData[m].expense);

  if (chartRef) chartRef.destroy();

  chartRef = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Приходи", data: incomeData, backgroundColor: "#4caf50", borderRadius: 6, barThickness: 30 },
        { label: "Разходи", data: expenseData, backgroundColor: "#f44336", borderRadius: 6, barThickness: 30 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
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
  const addScreen    = document.getElementById("screen-add");
  const reportScreen = document.getElementById("screen-report");
  const notesScreen  = document.getElementById("screen-notes");
  const isAdmin      = document.body.classList.contains("admin");

  addScreen?.classList.add("hidden");
  reportScreen?.classList.add("hidden");
  notesScreen?.classList.add("hidden");

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

  container.innerHTML = records.slice(0, 10).map(r => {
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
          <span class="record-sub">${storeLabel(r.store) !== "—" ? storeLabel(r.store) : ""}</span>
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

  const td = (iso) => {
    const p = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return p ? new Date(+p[1], +p[2]-1, +p[3]) : null;
  };

  const m = { "1": { inc:0, exp:0, kesh:0, karta:0 }, "2": { inc:0, exp:0, kesh:0, karta:0 } };
  let kasaInc=0, kasaExp=0, kasaKesh=0, kasaKarta=0;

  records.forEach(r => {
    const amount = Number(r.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = td(r.date);
    if (!d || d < monthStart || d >= nextMonth) return;
    const store = normStore(r.store);
    const isInc = r.type === "Приход";
    const signed = isInc ? amount : -amount;
    const isKesh = normMethod(r.method) === "Кеш";
    if (store !== "1" && store !== "2") {
      if (isInc) kasaInc += amount; else kasaExp += amount;
      if (isKesh) kasaKesh += signed; else kasaKarta += signed;
      return;
    }
    if (isInc) m[store].inc += amount; else m[store].exp += amount;
    if (isKesh) m[store].kesh += signed; else m[store].karta += signed;
  });

  const s1=m["1"].inc-m["1"].exp, s2=m["2"].inc-m["2"].exp, ks=kasaInc-kasaExp;
  const tI=m["1"].inc+m["2"].inc+kasaInc, tE=m["1"].exp+m["2"].exp+kasaExp, tS=s1+s2+ks;
  const tKesh=m["1"].kesh+m["2"].kesh+kasaKesh, tKarta=m["1"].karta+m["2"].karta+kasaKarta;

  const f=n=>n.toFixed(2)+" €", cls=n=>n>=0?"pos":"neg";
  const pct=(a,t)=>t>0?Math.round(a/t*100):0;
  const bar=(val,tot,col)=>{
    const w=tot>0?Math.min(100,Math.round(val/tot*100)):0;
    return `<div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px"><div style="width:${w}%;height:100%;background:${col};border-radius:2px"></div></div>`;
  };
  const hk=kasaInc||kasaExp;
  const th=s=>`<th class="sc-th">${s}</th>`;
  const td2=(v,c)=>`<td class="sc-val" class="${c}"><span class="sc-num ${c}">${f(v)}</span></td>`;
  const tdB=(v,c)=>`<td class="sc-val"><span class="sc-num-lg ${c}">${f(v)}</span></td>`;
  const tdS=(v)=>`<td class="sc-val"><span class="sc-num-sm">${f(v)}</span></td>`;

  const mkCard = (title, inc, exp, sal, ksh, krt, pctVal) => `
    <div class="sc-card">
      <div class="sc-card-title">${title}</div>
      <div class="sc-card-row"><span class="sc-card-label">Приходи</span><span class="sc-num pos">${f(inc)}</span></div>
      <div class="sc-card-row"><span class="sc-card-label">Разходи</span><span class="sc-num neg">${f(exp)}</span></div>
      <div class="sc-card-row sc-card-saldo"><span class="sc-card-label"><strong>Салдо</strong></span><span class="sc-num-xl ${cls(sal)}">${f(sal)}</span></div>
      <div class="sc-card-row"><span class="sc-card-label">💰 Кеш</span><span class="sc-num-sm">${f(ksh)}</span></div>
      <div class="sc-card-row"><span class="sc-card-label">💳 Карта/Банка</span><span class="sc-num-sm">${f(krt)}</span></div>
      <div class="sc-card-row"><span class="sc-card-label">Дял приход</span><span class="sc-pct-val">${pctVal}%</span></div>
    </div>`;

  el.innerHTML = `
    <h3><i class="fa-solid fa-scale-balanced"></i> Сравнение М1 vs М2 — текущ месец</h3>

    <!-- Таблица (десктоп) -->
    <table class="sc-table">
      <thead>
        <tr>
          <th class="sc-label-th"></th>
          ${th("🏪 М1")}${th("🏪 М2")}${hk?th("🏧 Каса"):""}${th("📊 Общо")}
        </tr>
      </thead>
      <tbody>
        <tr class="sc-row">
          <td class="sc-label">Приходи</td>
          ${td2(m["1"].inc,"pos")}${td2(m["2"].inc,"pos")}${hk?td2(kasaInc,"pos"):""}
          <td class="sc-val"><span class="sc-num-lg pos">${f(tI)}</span></td>
        </tr>
        <tr class="sc-row">
          <td class="sc-label">Разходи</td>
          ${td2(m["1"].exp,"neg")}${td2(m["2"].exp,"neg")}${hk?td2(kasaExp,"neg"):""}
          <td class="sc-val"><span class="sc-num-lg neg">${f(tE)}</span></td>
        </tr>
        <tr class="sc-row sc-saldo">
          <td class="sc-label"><strong>Салдо</strong></td>
          ${tdB(s1,cls(s1))}${tdB(s2,cls(s2))}${hk?tdB(ks,cls(ks)):""}
          <td class="sc-val"><span class="sc-num-xl ${cls(tS)}">${f(tS)}</span></td>
        </tr>
        <tr class="sc-row sc-sub">
          <td class="sc-label-sm">💰 Кеш</td>
          ${tdS(m["1"].kesh)}${tdS(m["2"].kesh)}${hk?tdS(kasaKesh):""}
          <td class="sc-val"><span class="sc-num-sm">${f(tKesh)}</span></td>
        </tr>
        <tr class="sc-row sc-sub">
          <td class="sc-label-sm">💳 Карта/Банка</td>
          ${tdS(m["1"].karta)}${tdS(m["2"].karta)}${hk?tdS(kasaKarta):""}
          <td class="sc-val"><span class="sc-num-sm">${f(tKarta)}</span></td>
        </tr>
        <tr class="sc-row sc-pct">
          <td class="sc-label-sm">Дял приход</td>
          <td class="sc-val"><span class="sc-pct-val">${pct(m["1"].inc,tI)}%</span>${bar(m["1"].inc,tI,"var(--green)")}</td>
          <td class="sc-val"><span class="sc-pct-val">${pct(m["2"].inc,tI)}%</span>${bar(m["2"].inc,tI,"var(--green)")}</td>
          ${hk?`<td class="sc-val"><span class="sc-pct-val">${pct(kasaInc,tI)}%</span>${bar(kasaInc,tI,"var(--green)")}</td>`:""}
          <td></td>
        </tr>
      </tbody>
    </table>

    <!-- Карти (мобилен изглед) -->
    <div class="sc-cards">
      ${mkCard("🏪 М1",    m["1"].inc, m["1"].exp, s1, m["1"].kesh, m["1"].karta, pct(m["1"].inc,tI))}
      ${mkCard("🏪 М2",    m["2"].inc, m["2"].exp, s2, m["2"].kesh, m["2"].karta, pct(m["2"].inc,tI))}
      ${hk ? mkCard("🏧 Каса", kasaInc, kasaExp, ks, kasaKesh, kasaKarta, pct(kasaInc,tI)) : ""}
      ${mkCard("📊 Общо",  tI,         tE,         tS, tKesh,       tKarta,       100)}
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
let _tasks = [];
let _tasksUnsub = null;

function loadTasksRealtime() {
  if (_tasksUnsub) return;
  const q = query(tasksCol, orderBy("createdAt", "desc"));
  _tasksUnsub = onSnapshot(q, snap => {
    _tasks = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    renderTasks();
  }, err => console.error("tasks snapshot:", err));
}

window.addTask = async function() {
  const inp  = document.getElementById('taskInput');
  const prio = document.getElementById('taskPriority');
  const text = (inp?.value || '').trim();
  if (!text) { inp?.focus(); return; }
  inp.value = ''; inp.focus();
  try {
    await addDoc(tasksCol, {
      text,
      priority: prio?.value || 'normal',
      done: false,
      createdAt: Date.now(),
      created: new Date().toLocaleDateString('bg-BG', {day:'2-digit',month:'2-digit',year:'numeric'})
    });
  } catch(e) { console.error("addTask:", e); }
};

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

function renderTasks() {
  const el    = document.getElementById('taskList');
  const badge = document.getElementById('taskCount');
  if (!el) return;
  const pending = _tasks.filter(t => !t.done).length;
  if (badge) { badge.textContent = pending; badge.className = 'task-badge' + (pending ? '' : ' zero'); }
  if (!_tasks.length) { el.innerHTML = '<div class="tasks-empty">Няма бележки — добави първата 👆</div>'; return; }
  const pLbl = { urgent:'🔴 Спешна', normal:'📋 Обичайна', info:'💡 Инфо' };
  const pCls = { urgent:'priority-urgent', normal:'priority-normal', info:'priority-info' };
  const esc  = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  el.innerHTML = [..._tasks].sort((a,b) => Number(a.done)-Number(b.done)).map(t => `
    <div class="task-item ${t.done?'done':''}">
      <div class="task-check" onclick="toggleTask('${t.firestoreId}')">${t.done?'✓':''}</div>
      <div class="task-body">
        <div class="task-text">${esc(t.text)}</div>
        <div class="task-meta">
          <span class="task-priority ${pCls[t.priority]||'priority-normal'}">${pLbl[t.priority]||'📋 Обичайна'}</span>
          <span>${t.created||''}</span>
        </div>
      </div>
      <button class="task-del btn-icon" onclick="deleteTask('${t.firestoreId}')">🗑️</button>
    </div>`).join('');
}

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
// 🛡️ Глобален handler за необработени Promise грешки
// --------------------------------------------------
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
});
