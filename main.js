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
  doc
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
    window.showScreen?.("add"); document.getElementById('bottomNav')?.classList.remove('hidden');
    renderLiveBalance(); renderTotalSummaryCards();
  } else {
    renderRecentList(); renderRecentTable();
    window.showScreen?.("add"); document.getElementById('bottomNav')?.classList.remove('hidden');
    const totalSummary = document.querySelector("#totalSummary");
    if (totalSummary) totalSummary.innerHTML = "";
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
  window.showScreen?.("add"); document.getElementById('bottomNav')?.classList.remove('hidden');

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
  const noteSelect = document.getElementById("noteSelect");
  const customNoteInput = document.getElementById("customNote");
  if (noteSelect && customNoteInput) {
    if ([...noteSelect.options].some(o => o.value === record.note)) {
      noteSelect.value = record.note;
      customNoteInput.classList.add("hidden");
      customNoteInput.value = "";
    } else {
      noteSelect.value = "custom";
      customNoteInput.classList.remove("hidden");
      customNoteInput.value = record.note || "";
    }
  }

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

  let note = document.getElementById("noteSelect")?.value || "";
  if (note === "custom") {
    note = document.getElementById("customNote")?.value?.trim() || "";
    if (note) saveCustomNote(note);
  }

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
  window.showScreen?.("add"); document.getElementById('bottomNav')?.classList.remove('hidden');
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
  document.getElementById("noteSelect") && (document.getElementById("noteSelect").value = "М1");

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
const filters = {
  type: document.getElementById("filterType"),
  method: document.getElementById("filterMethod"),
  category: document.getElementById("filterCategory"),
  store: document.getElementById("filterStore"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate")
};

function applyFilters() {
  const type = filters.type?.value || "";
  const method = filters.method?.value || "";
  const category = filters.category?.value || "";
  const startDate = filters.startDate?.value || "";
  const endDate = filters.endDate?.value || "";
  const store = filters.store?.value || "";

  filteredRecords = records.filter(r => {
    const matchType = !type || r.type === type;
    const matchMethod = !method || r.method === method;
    const matchCategory = !category || (r.category || "") === category;
    const matchStart = !startDate || r.date >= startDate;
    const matchEnd = !endDate || r.date <= endDate;
    const matchStore = !store || r.store === store;
    return matchType && matchMethod && matchCategory && matchStart && matchEnd && matchStore;
  });

  renderTable(filteredRecords);
  updateFilterSummary(filteredRecords);
}

function clearFilters() {
  if (filters.type) filters.type.value = "";
  if (filters.method) filters.method.value = "";
  if (filters.category) filters.category.value = "";
  if (filters.startDate) filters.startDate.value = "";
  if (filters.endDate) filters.endDate.value = "";
  if (filters.store) filters.store.value = "";
  applyFilters();
}

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
  const summary = { Приход: 0, Разход: 0 };

  data.forEach(r => {
    if (summary.hasOwnProperty(r.type)) summary[r.type] += Number(r.amount || 0);
  });

  const net = summary["Приход"] - summary["Разход"];
  const el = document.getElementById("filterSummary");
  if (!el) return;

  el.innerHTML = `
    <strong>Сума от филтъра:</strong>
    Приходи: ${summary["Приход"].toFixed(2)} € |
    Разходи: ${summary["Разход"].toFixed(2)} € |
    Нетно: ${net.toFixed(2)} €
  `;
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

  const normalizeStore = (s) => {
    const v = String(s ?? "").trim().toLowerCase();
    if (v === "1" || v === "м1" || v.includes("магазин 1")) return "1";
    if (v === "2" || v === "м2" || v.includes("магазин 2")) return "2";
    if (v === "каса" || v === "kasa")                        return "каса";
    return "1"; // fallback → М1
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
    const store = normalizeStore(r.store);  // "1", "2", "каса" или "1" (fallback)
    const d = toDate(r.date);

    // ---- период: първи..последен (по дата на записа)
    if (d) {
      const t = d.getTime();
      if (minTime === null || t < minTime) minTime = t;
      if (maxTime === null || t > maxTime) maxTime = t;
    }

    // ---- (A) Общи наличности: всички записи, всички магазини
    if (totalsAllPeriod.hasOwnProperty(method)) {
      totalsAllPeriod[method] += amount;
    }

    // ---- (B) Разпределение: само текущия месец, само М1 и М2
    // "Каса" записи → fallback вече е "1", така normalizeStore го връща директно
    if (d && d >= monthStart && d < nextMonthStart) {
      const storeKey = store === "каса" ? "1" : store; // Каса → М1 за справката
      if (storeKey === "1" || storeKey === "2") {
        if (totalsByStoreMonth[storeKey].hasOwnProperty(method)) {
          totalsByStoreMonth[storeKey][method] += amount;
        }
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

function renderLiveBalance() {
  // Преименувана → renderStoreComparison (виж по-долу)
  // Оставена празна за обратна съвместимост
  const el = document.getElementById("liveBalance");
  if (!el) return;
  renderStoreComparison();
}

// ── Сравнение М1 vs М2 (замества Живи наличности) ────────────
function renderStoreComparison() {
  const el = document.getElementById("liveBalance");
  if (!el) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const normalizeStore = (s) => {
    const v = String(s ?? "").trim().toLowerCase();
    if (v === "1" || v === "м1" || v.includes("магазин 1")) return "1";
    if (v === "2" || v === "м2" || v.includes("магазин 2")) return "2";
    return "1";
  };

  const toDate = (iso) => {
    const m = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
  };

  const m = { "1": { inc: 0, exp: 0 }, "2": { inc: 0, exp: 0 } };

  records.forEach(r => {
    const amount = Number(r.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = toDate(r.date);
    if (!d || d < monthStart || d >= nextMonth) return;
    const store = normalizeStore(r.store);
    if (r.type === "Приход") m[store].inc += amount;
    else                     m[store].exp += amount;
  });

  const saldo1 = m["1"].inc - m["1"].exp;
  const saldo2 = m["2"].inc - m["2"].exp;
  const totalInc = m["1"].inc + m["2"].inc;
  const totalExp = m["1"].exp + m["2"].exp;
  const totalSaldo = saldo1 + saldo2;

  const fmt = (n) => n.toFixed(2) + " €";
  const cls = (n) => n >= 0 ? "pos" : "neg";
  const pct = (a, total) => total > 0 ? Math.round(a / total * 100) : 0;

  // Mini progress bar
  const bar = (val, total, color) => {
    const w = total > 0 ? Math.min(100, Math.round(val / total * 100)) : 0;
    return `<div style="height:3px;background:var(--border);border-radius:2px;margin-top:4px;">
      <div style="width:${w}%;height:100%;background:${color};border-radius:2px;transition:width 0.4s ease;"></div>
    </div>`;
  };

  el.innerHTML = `
    <h3><i class="fa-solid fa-scale-balanced"></i> Сравнение М1 vs М2 — текущ месец</h3>
    <table>
      <thead>
        <tr>
          <th style="font-size:0.7rem;color:var(--text3);font-weight:600;padding:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;"></th>
          <th style="font-size:0.7rem;color:var(--text3);font-weight:600;padding:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;text-align:right;">🏪 М1</th>
          <th style="font-size:0.7rem;color:var(--text3);font-weight:600;padding:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;text-align:right;">🏪 М2</th>
          <th style="font-size:0.7rem;color:var(--text3);font-weight:600;padding:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;text-align:right;">📊 Общо</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="color:var(--text2)">Приходи</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">${fmt(m["1"].inc)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">${fmt(m["2"].inc)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">${fmt(totalInc)}</td>
        </tr>
        <tr>
          <td style="color:var(--text2)">Разходи</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:600;color:var(--red)">${fmt(m["1"].exp)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:600;color:var(--red)">${fmt(m["2"].exp)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--red)">${fmt(totalExp)}</td>
        </tr>
        <tr style="border-top:1px solid var(--border)">
          <td><strong>Салдо</strong></td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700;" class="${cls(saldo1)}">${fmt(saldo1)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700;" class="${cls(saldo2)}">${fmt(saldo2)}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:800;font-size:1rem;" class="${cls(totalSaldo)}">${fmt(totalSaldo)}</td>
        </tr>
        <tr>
          <td style="color:var(--text3);font-size:0.75rem;">Дял приход</td>
          <td style="text-align:right;color:var(--text2);font-size:0.75rem;">${pct(m["1"].inc, totalInc)}%
            ${bar(m["1"].inc, totalInc, "var(--green)")}
          </td>
          <td style="text-align:right;color:var(--text2);font-size:0.75rem;">${pct(m["2"].inc, totalInc)}%
            ${bar(m["2"].inc, totalInc, "var(--green)")}
          </td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;
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
function toggleCustomNote() {
  const noteSelect = document.getElementById("noteSelect");
  const customNoteInput = document.getElementById("customNote");
  if (!noteSelect || !customNoteInput) return;

  if (noteSelect.value === "custom") {
    customNoteInput.classList.remove("hidden");
    customNoteInput.focus();
  } else {
    customNoteInput.classList.add("hidden");
    customNoteInput.value = "";
  }
}
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

// --------------------------------------------------
// 📺 Навигация между екрани
// --------------------------------------------------
window.showScreen = function (screen) {
  const addScreen = document.getElementById("screen-add");
  const reportScreen = document.getElementById("screen-report");
  const isAdmin = document.body.classList.contains("admin");

  if (!addScreen || !reportScreen) return;

  if (screen === "report") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }

    addScreen.classList.add("hidden");
    reportScreen.classList.remove("hidden");

    renderTable();
    updateSummaries();
    renderMethodSummary();
    renderChart();
    applyFilters();
    renderTaxSummary();
  } else {
    addScreen.classList.remove("hidden");
    reportScreen.classList.add("hidden");
    renderRecentList(); renderRecentTable();
  }
};

// --------------------------------------------------
// 🖨️ Принтиране и Ексел
// --------------------------------------------------
window.printFilteredTable = function () {
  const table = document.querySelector("#recordsTable");
  if (!table) return alert("Таблицата не е намерена.");

  const newWindow = window.open("", "", "width=900,height=600");
  newWindow.document.write("<html><head><title>Принтиране</title>");
  newWindow.document.write("<style>table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:8px;}</style>");
  newWindow.document.write("</head><body>");
  newWindow.document.write(table.outerHTML);
  newWindow.document.write("</body></html>");
  newWindow.document.close();
  newWindow.print();
};

window.exportFilteredToExcel = function () {
  const table = document.querySelector("#recordsTable");
  if (!table) return alert("Таблицата не е намерена.");

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, "Отчет");
  XLSX.writeFile(wb, "nonstop-отчет.xlsx");
};

// --------------------------------------------------
// 🖼️ Модален преглед на снимка
// --------------------------------------------------
function openImageModal(url) {
  const modalImage = document.getElementById("modalImage");
  const imageModal = document.getElementById("imageModal");
  if (!modalImage || !imageModal) return;

  modalImage.src = url;
  imageModal.classList.remove("hidden");
}

function closeImageModal() {
  const modalImage = document.getElementById("modalImage");
  const imageModal = document.getElementById("imageModal");
  if (!modalImage || !imageModal) return;

  imageModal.classList.add("hidden");
  modalImage.src = "";
}

window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;

// Cloudinary events (ако още ги имаш в HTML)
window.addEventListener("imageUploaded", (e) => {
  uploadedImageUrl = e?.detail?.url || "";
});
window.addEventListener("imageRemoved", () => {
  uploadedImageUrl = "";
  imageRemoved = true; // 👈 казваме “този запис вече НЯМА снимка”
});
// ── PATCH: renderRecentList (card-based, replaces table) ──────
// Добави тази функция в main.js след renderRecentTable()

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
    const amountSign = isIncome ? "+" : "−";
    const amountClass = isIncome ? "income" : "expense";
    const dotClass = isIncome ? "income" : "expense";
    const adminBtns = isAdmin ? `
      <div class="record-actions">
        ${r.imageUrl ? `<button class="btn-icon btn-photo" onclick="openImageModal('${r.imageUrl}')">📷</button>` : ''}
        <button class="btn-icon btn-edit" onclick="editImage('${r.id}')">✏️</button>
        <button class="btn-icon btn-del"  onclick="deleteRecord('${r.id}')">🗑️</button>
      </div>` : (r.imageUrl ? `<button class="btn-icon btn-photo" onclick="openImageModal('${r.imageUrl}')">📷</button>` : '');
    return `
      <div class="record-row">
        <span class="record-type-dot ${dotClass}"></span>
        <div class="record-meta">
          <span class="record-date">${r.date || ''} · ${r.method || ''}</span>
          <span class="record-name">${r.category || ''} ${r.note ? '· ' + r.note : ''}</span>
          <span class="record-sub">${r.store ? 'М' + r.store : ''}</span>
        </div>
        <div class="record-right">
          <span class="record-amount ${amountClass}">${amountSign}${formatMoney(r.amount)}</span>
          ${adminBtns}
        </div>
      </div>`;
  }).join('');
}

// ── PATCH: renderTotalSummary (stat cards) ────────────────────
function renderTotalSummaryCards() {
  const el = document.getElementById("totalSummary");
  if (!el) return;

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  let todayIncome = 0, todayExpense = 0, monthIncome = 0, monthExpense = 0;

  records.forEach(({ date, type, amount }) => {
    const a = Number(amount || 0);
    if (date === today) {
      if (type === "Приход") todayIncome += a; else todayExpense += a;
    }
    if ((date || "").startsWith(currentMonth)) {
      if (type === "Приход") monthIncome += a; else monthExpense += a;
    }
  });

  const todaySaldo = todayIncome - todayExpense;
  const monthSaldo = monthIncome - monthExpense;

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card green">
        <div class="stat-label">Днес приход</div>
        <div class="stat-value green">${todayIncome.toFixed(2)} €</div>
      </div>
      <div class="stat-card ${todaySaldo >= 0 ? 'green' : 'red'}">
        <div class="stat-label">Днес салдо</div>
        <div class="stat-value ${todaySaldo >= 0 ? 'green' : 'red'}">${todaySaldo.toFixed(2)} €</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Месец приход</div>
        <div class="stat-value">${monthIncome.toFixed(2)} €</div>
      </div>
      <div class="stat-card ${monthSaldo >= 0 ? 'green' : 'red'}">
        <div class="stat-label">Месец салдо</div>
        <div class="stat-value ${monthSaldo >= 0 ? 'green' : 'red'}">${monthSaldo.toFixed(2)} €</div>
      </div>
    </div>`;
}

// ── PATCH: Nav active states ──────────────────────────────────
const _origShowScreen = window.showScreen;
window.showScreen = function(screen) {
  _origShowScreen(screen);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (screen === 'report') {
    document.getElementById('navReports')?.classList.add('active');
  } else {
    document.getElementById('navAdd')?.classList.add('active');
  }
};

// ── PATCH: syncPills on editImage ────────────────────────────
const _origEditImage = window.editImage;
window.editImage = async function(id) {
  await _origEditImage(id);
  window.syncPills?.();
  document.getElementById('formTitle').textContent = 'Редактирай запис';
  document.getElementById('removeImgBtn').classList.toggle('hidden', !document.getElementById('imagePreview').src || document.getElementById('imagePreview').classList.contains('hidden'));
};

// ── PATCH: reset formTitle on cancelEdit ────────────────────
const _origCancelEdit = window.cancelEdit;
window.cancelEdit = function() {
  _origCancelEdit();
  document.getElementById('formTitle').textContent = 'Нов запис';
  document.getElementById('removeImgBtn').classList.add('hidden');
  window.syncPills?.();
};

// ════════════════════════════════════════════════
// 📝 NOTES & PUSH NOTIFICATIONS
// ════════════════════════════════════════════════

// ── showScreen patch за notes ─────────────────
const _origShowScreen2 = window.showScreen;
window.showScreen = function(screen) {
  const notesScreen = document.getElementById('screen-notes');
  if (screen === 'notes') {
    document.getElementById('screen-add')?.classList.add('hidden');
    document.getElementById('screen-report')?.classList.add('hidden');
    notesScreen?.classList.remove('hidden');
    renderTasks();
    checkNotifStatus();
    // nav active
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('navNotes')?.classList.add('active');
  } else {
    notesScreen?.classList.add('hidden');
    _origShowScreen2(screen);
  }
};

// ── Tasks (localStorage) ──────────────────────
function getTasks() {
  try { return JSON.parse(localStorage.getItem('ns_tasks') || '[]'); }
  catch { return []; }
}

function saveTasks(tasks) {
  localStorage.setItem('ns_tasks', JSON.stringify(tasks));
}

window.addTask = function() {
  const input = document.getElementById('taskInput');
  const priorityEl = document.getElementById('taskPriority');
  const text = (input?.value || '').trim();
  if (!text) { input?.focus(); return; }

  const tasks = getTasks();
  tasks.unshift({
    id: Date.now(),
    text,
    priority: priorityEl?.value || 'normal',
    done: false,
    created: new Date().toLocaleDateString('bg-BG', { day:'2-digit', month:'2-digit', year:'numeric' })
  });
  saveTasks(tasks);
  input.value = '';
  input.focus();
  renderTasks();
};

window.toggleTask = function(id) {
  const tasks = getTasks().map(t => t.id === id ? { ...t, done: !t.done } : t);
  saveTasks(tasks);
  renderTasks();
};

window.deleteTask = function(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
  renderTasks();
};

function renderTasks() {
  const container = document.getElementById('taskList');
  const badge = document.getElementById('taskCount');
  if (!container) return;

  const tasks = getTasks();
  const pending = tasks.filter(t => !t.done).length;

  if (badge) {
    badge.textContent = pending;
    badge.className = 'task-badge' + (pending === 0 ? ' zero' : '');
  }

  if (!tasks.length) {
    container.innerHTML = '<div class="tasks-empty">Няма бележки — добави първата 👆</div>';
    return;
  }

  const priorityLabel = { urgent: '🔴 Спешна', normal: '📋 Обичайна', info: '💡 Инфо' };
  const priorityClass = { urgent: 'priority-urgent', normal: 'priority-normal', info: 'priority-info' };

  // Sort: pending first, then done
  const sorted = [...tasks].sort((a, b) => Number(a.done) - Number(b.done));

  container.innerHTML = sorted.map(t => `
    <div class="task-item ${t.done ? 'done' : ''}" id="task-${t.id}">
      <div class="task-check" onclick="toggleTask(${t.id})">
        ${t.done ? '✓' : ''}
      </div>
      <div class="task-body">
        <div class="task-text">${escapeHtml(t.text)}</div>
        <div class="task-meta">
          <span class="task-priority ${priorityClass[t.priority] || 'priority-normal'}">
            ${priorityLabel[t.priority] || '📋 Обичайна'}
          </span>
          <span>${t.created || ''}</span>
        </div>
      </div>
      <button class="task-del btn-icon" onclick="deleteTask(${t.id})" title="Изтрий">🗑️</button>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Push Notifications ────────────────────────
function checkNotifStatus() {
  const toggle = document.getElementById('notifToggle');
  const status = document.getElementById('notifStatus');
  if (!toggle || !status) return;

  const enabled = localStorage.getItem('ns_notif') === '1';
  toggle.checked = enabled;

  if (!('Notification' in window)) {
    status.textContent = 'Не се поддържа от браузъра';
    toggle.disabled = true;
    return;
  }

  if (Notification.permission === 'denied') {
    status.textContent = '⛔ Блокирани от браузъра';
    toggle.checked = false;
    toggle.disabled = true;
    return;
  }

  status.textContent = enabled
    ? '✅ Включено — напомняне в 18:00'
    : 'Изключено';
}

window.toggleNotifications = async function(enabled) {
  const status = document.getElementById('notifStatus');

  if (enabled) {
    if (!('Notification' in window)) {
      status.textContent = 'Не се поддържа от браузъра';
      document.getElementById('notifToggle').checked = false;
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      status.textContent = '⛔ Отказано — разреши в браузъра';
      document.getElementById('notifToggle').checked = false;
      localStorage.setItem('ns_notif', '0');
      return;
    }
    localStorage.setItem('ns_notif', '1');
    status.textContent = '✅ Включено — напомняне в 18:00';
    scheduleReminder();
  } else {
    localStorage.setItem('ns_notif', '0');
    status.textContent = 'Изключено';
  }
};

window.sendTestNotif = function() {
  if (!('Notification' in window)) {
    alert('Браузърът не поддържа известия.'); return;
  }
  if (Notification.permission !== 'granted') {
    alert('Разреши известията първо.'); return;
  }
  new Notification('🏪 Нон Стоп — Тест', {
    body: 'Известията работят! Ще получиш напомняне ако до 18:00 няма запис.',
    icon: 'icon-192.png'
  });
};

// ── Daily reminder scheduler ──────────────────
function scheduleReminder() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(18, 0, 0, 0);

  // Ако 18:00 вече е минало → утре
  if (now >= target) target.setDate(target.getDate() + 1);

  const msUntil = target - now;

  setTimeout(async () => {
    // Проверяваме дали има запис за днес
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = (typeof records !== 'undefined') &&
                     records.some(r => (r.date || '').startsWith(today));

    if (!hasToday && localStorage.getItem('ns_notif') === '1'
        && Notification.permission === 'granted') {
      new Notification('🏪 Нон Стоп — Напомняне', {
        body: `Все още няма въведен запис за днес (${today}). Не забравяй!`,
        icon: 'icon-192.png'
      });
    }
    // Планираме за утре
    scheduleReminder();
  }, msUntil);
}

// ── Auto-start scheduler on load ─────────────
(function initNotifications() {
  if (localStorage.getItem('ns_notif') === '1'
      && 'Notification' in window
      && Notification.permission === 'granted') {
    scheduleReminder();
  }
})();
