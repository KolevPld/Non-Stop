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

const statusDiv = document.getElementById("status");

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
// 🔥 FIRESTORE: Зареждане
// --------------------------------------------------
async function loadRecords() {
  records = [];

  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    records.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (document.body.classList.contains("admin")) {
    renderTable();
    renderRecentList(); renderRecentTable();
    updateSummaries();
    renderMethodSummary();
    renderChart();
    applyFilters();
    renderTaxSummary();
    updateNoteOptions();
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

  // Бележка
  let note = "";
  const noteSelectVal = document.getElementById("noteSelect")?.value || "";
  if (noteSelectVal === "custom") {
    note = document.getElementById("customNote")?.value?.trim() || "";
    if (note) saveCustomNote(note);
  } else {
    note = noteSelectVal;
  }

  // Категория
  let category = document.getElementById("category")?.value || "";
  if (category === "custom") {
    category = document.getElementById("customCategory")?.value?.trim() || "";
  }

  if (!date || !type || !method || isNaN(amount) || amount <= 0) {
    return alert("Попълни дата и валидна сума.");
  }

  const imageUrl = uploadedImageUrl || "";

  await addDoc(collection(db, "records"), {
    date,
    type,
    method,
    amount,
    note,
    category,
    store,
    imageUrl
  });

  await loadRecords();
  clearForm();
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
    document.getElementById("addForm")?.scrollIntoView({ behavior: "smooth" });
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

  const old = records.find(r => r.id === editingId);
  if (old && !requireUnlockIfLocked(old.date)) return;

  const finalImageUrl = imageRemoved
  ? ""                             // 👈 ако е премахната -> празно в базата
  : (uploadedImageUrl || (old?.imageUrl || ""));

await updateDoc(doc(db, "records", editingId), {
  date,
  type,
  method,
  amount,
  note,
  category,
  store,
  imageUrl: finalImageUrl
});

  editingId = null;
  clearForm();
  imageRemoved = false;
  document.getElementById("addForm")?.classList.remove("editing-mode");
  document.getElementById("cancelEditBtn")?.classList.add("hidden");


  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
    submitBtn.onclick = addRecord;
  }

  await loadRecords();
  window.showScreen("add");
}

window.saveEditedRecord = saveEditedRecord;

// --------------------------------------------------
// 🗑️ Изтриване
// --------------------------------------------------
async function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec && !requireUnlockIfLocked(rec.date)) return;

  if (!confirm("Сигурен ли си?")) return;
  await deleteDoc(doc(db, "records", id));
  await loadRecords();
}
window.deleteRecord = deleteRecord;

// --------------------------------------------------
// 🧹 Изчистване на формата
// --------------------------------------------------
function clearForm() {
  document.getElementById("date") && (document.getElementById("date").value = "");
  document.getElementById("amount") && (document.getElementById("amount").value = "");

  const noteInput = document.getElementById("customNote");
  if (noteInput) { noteInput.value = ""; noteInput.classList.add("hidden"); }

  const categoryInput = document.getElementById("customCategory");
  if (categoryInput) { categoryInput.value = ""; categoryInput.classList.add("hidden"); }

  document.getElementById("category") && (document.getElementById("category").value = "Оборот");
  const cn = document.getElementById("customNote"); if (cn) cn.value = "";

  uploadedImageUrl = "";
  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview) { imagePreview.src = ""; imagePreview.classList.add("hidden"); }

  // ако сме били в edit, махаме индикатор
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
function normStore(s) {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "1" || v === "м1" || v.includes("магазин 1")) return "1";
  if (v === "2" || v === "м2" || v.includes("магазин 2")) return "2";
  if (v === "каса" || v === "kasa") return "Каса";
  return v;
}
function normMethod(m) {
  const v = String(m ?? "").trim().split(/\s+/)[0];
  return v; // Кеш / Банка / Карта — точно
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

  // DEBUG: покажи уникалните стойности в базата
  const uniqStores  = [...new Set(records.map(r => JSON.stringify(r.store)))].sort();
  const uniqMethods = [...new Set(records.map(r => JSON.stringify(r.method)))].sort();
  console.log("DB store values:", uniqStores);
  console.log("DB method values:", uniqMethods);
  console.log("FILTER store:", JSON.stringify(store), "method:", JSON.stringify(method), "type:", JSON.stringify(type));

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
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>
      <td style="white-space: nowrap;">
        ${
          r.imageUrl
            ? `<button class="btn-icon btn-photo" type="button" title="Снимка" onclick="openImageModal('${r.imageUrl}')">📷</button>`
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
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>

      <td class="actions">
        <div class="actions-wrap">
          ${
            r.imageUrl
              ? `<button class="btn-icon btn-photo" type="button" title="Снимка" onclick="openImageModal('${r.imageUrl}')">📷</button>`
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
function updateSummaries() {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  let todayIncome = 0, todayExpense = 0, monthIncome = 0, monthExpense = 0;

  records.forEach(({ date, type, amount }) => {
    const a = Number(amount || 0);
    if (date === today) {
      if (type === "Приход") todayIncome += a;
      else todayExpense += a;
    }
    if ((date || "").startsWith(currentMonth)) {
      if (type === "Приход") monthIncome += a;
      else monthExpense += a;
    }
  });

  const saldo = (monthIncome - monthExpense).toFixed(2);

  const daily = document.getElementById("dailySummary");
  const monthly = document.getElementById("monthlySummary");

  if (daily) {
    daily.innerHTML = `
      <h3><i class="fa-solid fa-calendar-day"></i> Днес</h3>
      <table>
        <tr><td>Приходи:</td><td>${todayIncome.toFixed(2)} €</td></tr>
        <tr><td>Разходи:</td><td>${todayExpense.toFixed(2)} €</td></tr>
      </table>
    `;
  }

  if (monthly) {
    monthly.innerHTML = `
      <h3><i class="fa-solid fa-calendar-alt"></i> Месец</h3>
      <table>
        <tr><td>Приходи:</td><td>${monthIncome.toFixed(2)} €</td></tr>
        <tr><td>Разходи:</td><td>${monthExpense.toFixed(2)} €</td></tr>
        <tr><td><strong>Салдо:</strong></td><td><strong>${saldo} €</strong></td></tr>
      </table>
    `;
  }
}

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
  const makeTotals = () => ({ Кеш: 0, Карта: 0, Банка: 0 });

  // ✅ Нормализация (за стари записи)
  const normalizeStore = (s) => {
    const v = String(s ?? "").trim().toLowerCase();
    if (v === "1" || v === "м1" || v.includes("магазин 1") || v.includes("magazin 1") || v.includes("store 1")) return "1";
    if (v === "2" || v === "м2" || v.includes("магазин 2") || v.includes("magazin 2") || v.includes("store 2")) return "2";
    return ""; // други (напр. "Каса")
  };

  const normalizeMethod = (m) => String(m ?? "").trim().split(" ")[0]; // "Кеш", "Карта", "Банка"
  const toDate = (iso) => {
    // очакваме "YYYY-MM-DD"
    const s = String(iso ?? "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    return new Date(y, mo, d);
  };

  // ✅ Текущ месец
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // 1) Разпределение по метод (само текущ месец)
  const totalsByStoreMonth = { "1": makeTotals(), "2": makeTotals() };

  // 2) Общи наличности (целият период: всички записи)
  const totalsAllPeriod = makeTotals();

  // За показване на периода (първи/последен запис)
  let minTime = null;
  let maxTime = null;

  records.forEach((r) => {
    const rawAmount = Number(r.amount || 0);
    if (!Number.isFinite(rawAmount)) return;

    const amount = r.type === "Приход" ? rawAmount : -rawAmount;

    const method = normalizeMethod(r.method);
    const store = normalizeStore(r.store);
    const d = toDate(r.date);

    // ---- период: първи..последен (по дата на записа)
    if (d) {
      const t = d.getTime();
      if (minTime === null || t < minTime) minTime = t;
      if (maxTime === null || t > maxTime) maxTime = t;
    }

    // ---- (A) Общи наличности: всички записи
    if (totalsAllPeriod.hasOwnProperty(method)) {
      totalsAllPeriod[method] += amount;
    }

    // ---- (B) Разпределение: само текущия месец + само магазини 1/2
    if (d && d >= monthStart && d < nextMonthStart) {
      if ((store === "1" || store === "2") && totalsByStoreMonth[store].hasOwnProperty(method)) {
        totalsByStoreMonth[store][method] += amount;
      }
    }
  });

  const ms = document.getElementById("methodSummary");
  const msx = document.getElementById("methodSummaryExtra");

  const row = (label, value, strong = false) =>
    `<tr><td>${strong ? `<strong>${label}</strong>` : label}</td><td>${strong ? `<strong>${value}</strong>` : value}</td></tr>`;

  const fmt2 = (n) => (Number(n || 0)).toFixed(2);
  const fmtPeriod = (t) => {
    if (t === null) return "—";
    const d = new Date(t);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  };

  // --- UI: Разпределение (текущ месец)
  if (ms) {
    const m1Cash = totalsByStoreMonth["1"].Кеш;
    const m1Card = totalsByStoreMonth["1"].Карта;
    const m2Cash = totalsByStoreMonth["2"].Кеш;
    const m2Card = totalsByStoreMonth["2"].Карта;

    const totalCashCard = m1Cash + m1Card + m2Cash + m2Card;

    ms.innerHTML = `
      <h3><i class="fa-solid fa-wallet"></i> Разпределение по метод (текущ месец)</h3>
      <table>
        ${row("💰 Кеш (М1):", `${fmt2(m1Cash)} €`)}
        ${row("💳 Карта (М1):", `${fmt2(m1Card)} €`)}
        ${row("💰 Кеш (М2):", `${fmt2(m2Cash)} €`)}
        ${row("💳 Карта (М2):", `${fmt2(m2Card)} €`)}
        ${row("Общо:", `${fmt2(totalCashCard)} €`, true)}
      </table>
    `;
  }

  // --- UI: Общи наличности (целият период)
  if (msx) {
    const totalCash = totalsAllPeriod.Кеш;
    const totalBank = totalsAllPeriod.Банка + totalsAllPeriod.Карта;

    const from = fmtPeriod(minTime);
    const to = fmtPeriod(maxTime);

    msx.innerHTML = `
      <h3><i class="fa-solid fa-circle-dollar-to-slot"></i> Общи наличности</h3>
      <div class="muted" style="margin: 6px 0 10px;">Период: ${from} → ${to}</div>
      <table>
        ${row("💵 Общо кеш:", `${fmt2(totalCash)} €`)}
        ${row("🏦 Общо банка:", `${fmt2(totalBank)} €`)}
      </table>
    `;
  }
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

function saveCustomNote(note) {
  let savedNotes = JSON.parse(localStorage.getItem("customNotes")) || [];
  if (!note || savedNotes.includes(note)) return;
  savedNotes.unshift(note);
  if (savedNotes.length > 5) savedNotes = savedNotes.slice(0, 5);
  localStorage.setItem("customNotes", JSON.stringify(savedNotes));
  updateNoteOptions();
}

function updateNoteOptions() {
  const noteSelect = document.getElementById("noteSelect");
  if (!noteSelect) return;

  const savedNotes = JSON.parse(localStorage.getItem("customNotes")) || [];
  const currentValue = noteSelect.value;

  noteSelect.innerHTML = `
    <option value="М1">М1</option>
    <option value="М2">М2</option>
    <option value="custom">Въведи ръчно...</option>
  `;

  savedNotes.forEach(note => {
    const opt = document.createElement("option");
    opt.value = note;
    opt.textContent = note;
    noteSelect.insertBefore(opt, noteSelect.querySelector('option[value="custom"]'));
  });

  noteSelect.value = currentValue;
}

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
    renderTable(); updateSummaries(); renderMethodSummary();
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
          ${r.imageUrl ? `<button class="btn-icon btn-photo" onclick="openImageModal('${r.imageUrl}')">📷</button>` : ''}
          <button class="btn-icon btn-edit" onclick="editImage('${r.id}')">✏️</button>
          <button class="btn-icon btn-del"  onclick="deleteRecord('${r.id}')">🗑️</button>
         </div>`
      : (r.imageUrl ? `<button class="btn-icon btn-photo" onclick="openImageModal('${r.imageUrl}')">📷</button>` : '');

    return `
      <div class="record-row">
        <span class="record-type-dot ${cls}"></span>
        <div class="record-meta">
          <span class="record-date">${r.date || ''} · ${r.method || ''}</span>
          <span class="record-name">${r.category || ''}${r.note ? ' · ' + r.note : ''}</span>
          <span class="record-sub">${r.store ? 'М' + r.store : ''}</span>
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

  const ns = (s) => {
    const v = String(s ?? "").trim().toLowerCase();
    if (v === "1" || v === "м1" || v.includes("магазин 1")) return "1";
    if (v === "2" || v === "м2" || v.includes("магазин 2")) return "2";
    return null;
  };
  const td = (iso) => {
    const p = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return p ? new Date(+p[1], +p[2]-1, +p[3]) : null;
  };

  const m = { "1": { inc:0, exp:0 }, "2": { inc:0, exp:0 } };
  let kasaInc = 0, kasaExp = 0;

  records.forEach(r => {
    const amount = Number(r.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = td(r.date);
    if (!d || d < monthStart || d >= nextMonth) return;
    const store = ns(r.store);
    if (!store) {
      if (r.type === "Приход") kasaInc += amount; else kasaExp += amount;
      return;
    }
    if (r.type === "Приход") m[store].inc += amount; else m[store].exp += amount;
  });

  const s1=m["1"].inc-m["1"].exp, s2=m["2"].inc-m["2"].exp, ks=kasaInc-kasaExp;
  const tI=m["1"].inc+m["2"].inc+kasaInc, tE=m["1"].exp+m["2"].exp+kasaExp, tS=s1+s2+ks;

  const f=n=>n.toFixed(2)+" €", cls=n=>n>=0?"pos":"neg";
  const pct=(a,t)=>t>0?Math.round(a/t*100):0;
  const bar=(val,tot,col)=>{
    const w=tot>0?Math.min(100,Math.round(val/tot*100)):0;
    return `<div style="height:3px;background:var(--border);border-radius:2px;margin-top:3px"><div style="width:${w}%;height:100%;background:${col};border-radius:2px"></div></div>`;
  };
  const hk=kasaInc||kasaExp;
  const th=s=>`<th style="font-size:.7rem;color:var(--text3);font-weight:600;padding:0 0 10px;text-transform:uppercase;text-align:right">${s}</th>`;
  const td2=(v,c)=>`<td style="text-align:right;font-family:var(--mono);font-weight:600" class="${c}">${f(v)}</td>`;

  el.innerHTML = `
    <h3><i class="fa-solid fa-scale-balanced"></i> Сравнение М1 vs М2 — текущ месец</h3>
    <table>
      <thead><tr><th></th>${th("🏪 М1")}${th("🏪 М2")}${hk?th("🏧 Каса"):""}${th("📊 Общо")}</tr></thead>
      <tbody>
        <tr><td style="color:var(--text2)">Приходи</td>${td2(m["1"].inc,"pos")}${td2(m["2"].inc,"pos")}${hk?td2(kasaInc,"pos"):""}<td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">${f(tI)}</td></tr>
        <tr><td style="color:var(--text2)">Разходи</td>${td2(m["1"].exp,"neg")}${td2(m["2"].exp,"neg")}${hk?td2(kasaExp,"neg"):""}<td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--red)">${f(tE)}</td></tr>
        <tr style="border-top:1px solid var(--border)">
          <td><strong>Салдо</strong></td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700" class="${cls(s1)}">${f(s1)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700" class="${cls(s2)}">${f(s2)}</td>
          ${hk?`<td style="text-align:right;font-family:var(--mono);font-weight:700" class="${cls(ks)}">${f(ks)}</td>`:""}
          <td style="text-align:right;font-family:var(--mono);font-weight:800;font-size:1rem" class="${cls(tS)}">${f(tS)}</td>
        </tr>
        <tr>
          <td style="color:var(--text3);font-size:.75rem">Дял приход</td>
          <td style="text-align:right;color:var(--text2);font-size:.75rem">${pct(m["1"].inc,tI)}%${bar(m["1"].inc,tI,"var(--green)")}</td>
          <td style="text-align:right;color:var(--text2);font-size:.75rem">${pct(m["2"].inc,tI)}%${bar(m["2"].inc,tI,"var(--green)")}</td>
          ${hk?`<td style="text-align:right;color:var(--text2);font-size:.75rem">${pct(kasaInc,tI)}%${bar(kasaInc,tI,"var(--green)")}</td>`:""}
          <td></td>
        </tr>
      </tbody>
    </table>`;
}

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
