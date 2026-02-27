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
    renderRecentTable();
    updateSummaries();
    renderMethodSummary();
    renderChart();
    applyFilters();
    renderTaxSummary();
    updateNoteOptions();
    window.showScreen("add");
  } else {
    renderRecentTable();
    window.showScreen("add");
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

  const income = records.filter(r => r.type === "Приход").reduce((s, r) => s + Number(r.amount || 0), 0);
  const expense = records.filter(r => r.type === "Разход").reduce((s, r) => s + Number(r.amount || 0), 0);
  const profit = income - expense;

  if (profit <= 0) {
    tax.innerHTML = `<strong>📊 Данъчна справка:</strong><br>Няма облагаема печалба.`;
    return;
  }

  const vat = +(profit * 0.2).toFixed(2);
  const taxableProfit = +(profit - vat).toFixed(2);
  const corporateTax = +(taxableProfit * 0.1).toFixed(2);
  const netProfit = +(taxableProfit - corporateTax).toFixed(2);

  tax.innerHTML = `
    <h3><i class="fa-solid fa-file-invoice-dollar"></i> Данъчна справка</h3>
    <table>
      <tr><td>Приходи:</td><td>${income.toFixed(2)} €</td></tr>
      <tr><td>Разходи:</td><td>${expense.toFixed(2)} €</td></tr>
      <tr><td>Печалба:</td><td>${profit.toFixed(2)} €</td></tr>
      <tr><td>ДДС (20%):</td><td>${vat.toFixed(2)} €</td></tr>
      <tr><td>Данък печалба (10%):</td><td>${corporateTax.toFixed(2)} €</td></tr>
      <tr><td><strong>👉 Нетна печалба:</strong></td><td><strong style="color:#ffca28;">${netProfit.toFixed(2)} €</strong></td></tr>
    </table>
  `;
}

function renderMethodSummary() {
  const totals = { Кеш: 0, Банка: 0, Карта: 0 };

  records.forEach(r => {
    const amount = r.type === "Приход" ? Number(r.amount || 0) : -Number(r.amount || 0);
    if (totals.hasOwnProperty(r.method)) totals[r.method] += amount;
  });

  const totalSum = totals.Кеш + totals.Банка + totals.Карта;
  const totalBank = totals.Банка + totals.Карта;

  const ms = document.getElementById("methodSummary");
  const msx = document.getElementById("methodSummaryExtra");

  if (ms) {
    ms.innerHTML = `
      <h3><i class="fa-solid fa-wallet"></i> Разпределение по метод</h3>
      <table>
        <tr><td>💰 Кеш:</td><td>${totals.Кеш.toFixed(2)} €</td></tr>
        <tr><td>🏦 Банка:</td><td>${totals.Банка.toFixed(2)} €</td></tr>
        <tr><td>💳 Карта:</td><td>${totals.Карта.toFixed(2)} €</td></tr>
        <tr><td><strong>Общо:</strong></td><td><strong>${totalSum.toFixed(2)} €</strong></td></tr>
      </table>
    `;
  }

  if (msx) {
    msx.innerHTML = `
      <h3><i class="fa-solid fa-circle-dollar-to-slot"></i> Общи наличности</h3>
      <table>
        <tr><td>💵 Общо кеш:</td><td>${totals.Кеш.toFixed(2)} €</td></tr>
        <tr><td>🏦 Общо банка:</td><td>${totalBank.toFixed(2)} €</td></tr>
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
    renderRecentTable();
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
