import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
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
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Регистрация успешна!");
  } catch (err) {
    alert("Грешка при регистрация: " + err.message);
    document.getElementById("loginEmail").value = "";
    document.getElementById("loginPassword").value = "";
  }
};

window.loginEmail = async function () {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert("Грешка при вход: " + err.message);
    document.getElementById("loginEmail").value = "";
    document.getElementById("loginPassword").value = "";
  }
};

window.logout = function () {
  signOut(auth);
};


// --------------------------------------------------
// 🔄 При вход показваш app + зареждаш DB
// --------------------------------------------------

let records = [];
let filteredRecords = [];
let chartRef = null;

const statusDiv = document.getElementById("status");

onAuthStateChanged(auth, user => {
  const isLoggedIn = user && !user.isAnonymous;
  const isAdmin = isLoggedIn && user.email === ADMIN_EMAIL;

  if (isLoggedIn) {
    statusDiv.textContent = `🔓 Влязъл: ${user.email}${isAdmin ? " (админ)" : ""}`;
    document.body.classList.toggle("admin", isAdmin);
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    loadRecords();
  } else {
    statusDiv.textContent = "🔐 Моля, влез с имейл и парола.";
    document.body.classList.remove("admin");
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }
});

// --------------------------------------------------
// 🔥 FIRESTORE: Зареждане
// --------------------------------------------------

async function loadRecords() {
  records = [];
  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap =>
    records.push({ id: docSnap.id, ...docSnap.data() })
  );
if (document.body.classList.contains("admin")) {
  renderTable();
  renderRecentTable();
  updateSummaries();
  renderMethodSummary();
  renderChart();
  applyFilters();
  renderTaxSummary();
  updateNoteOptions();
  }
}


// --------------------------------------------------
// 🔥 Добавяне на запис
// --------------------------------------------------

async function addRecord() {
  const date = document.getElementById("date").value;
  const type = document.getElementById("type").value;
  const method = document.getElementById("method").value.split(" ")[0];
  const amount = parseFloat(document.getElementById("amount").value);

  let note;
  const noteSelectEl = document.getElementById("noteSelect");
  const noteSelect = noteSelectEl.value;

  if (noteSelect === "custom") {
    note = document.getElementById("customNote").value.trim();
    if (note) saveCustomNote(note);
  } else {
    note = noteSelect;
  }

  const store = document.getElementById("store").value;

  let category = document.getElementById("category").value;
  if (category === "custom") {
    category = document.getElementById("customCategory").value;
  }

  if (!date || isNaN(amount)) return alert("Попълни дата и сума.");

  await addDoc(collection(db, "records"), {
    date,
    type,
    method,
    amount,
    note,
    category,
    store
  });

  loadRecords();
  clearForm();
}

window.addRecord = addRecord;
window.deleteRecord = deleteRecord;


// --------------------------------------------------
// 🔥 Изтриване
// --------------------------------------------------

async function deleteRecord(id) {
  if (!confirm("Сигурен ли си?")) return;
  await deleteDoc(doc(db, "records", id));
  loadRecords();
}

function clearForm() {
  document.getElementById("date").value = "";
  document.getElementById("amount").value = "";
  document.getElementById("note").value = "";
}


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

window.applyFilters = applyFilters;
window.clearFilters = clearFilters;

function applyFilters() {
  const type = filters.type.value;
  const method = filters.method.value;
  const category = filters.category.value;
  const startDate = filters.startDate.value;
  const endDate = filters.endDate.value;
  const store = filters.store.value;

  filteredRecords = records.filter(r => {
    const matchType = !type || r.type === type;
    const matchMethod = !method || r.method === method;
    const matchCategory = !category || (r.category || '') === category;
    const matchStart = !startDate || r.date >= startDate;
    const matchEnd = !endDate || r.date <= endDate;
    const matchStore = !store || r.store === store;
    return matchType && matchMethod && matchCategory && matchStart && matchEnd && matchStore;
  });

  renderTable(filteredRecords);
  updateFilterSummary(filteredRecords);
}

function clearFilters() {
  filters.type.value = "";
  filters.method.value = "";
  filters.category.value = "";
  filters.startDate.value = "";
  filters.endDate.value = "";
  filters.store.value = "";
  applyFilters();
}
function renderTable(data = records) {
  const tbody = document.querySelector("#recordsTable tbody");
  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td style="color:${r.type === 'Приход' ? '#4caf50' : '#f44336'};">${r.type}</td>
      <td>${r.amount.toFixed(2)} лв</td>
      <td>${r.method}</td>
      <td>${r.category || ''}</td>
      <td>${r.note}</td>
      <td>
  <button class="admin-only" onclick="deleteRecord('${r.id}')" style="background:#f44336;font-size:12px;padding:4px 6px;">
    🗑️
  </button>
</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateFilterSummary(data) {
  const summary = { Приход: 0, Разход: 0 };

  data.forEach(r => {
    if (summary.hasOwnProperty(r.type)) {
      summary[r.type] += r.amount;
    }
  });

  const net = summary["Приход"] - summary["Разход"];

  document.getElementById("filterSummary").innerHTML = `
    <strong>Сума от филтъра:</strong> 
    Приходи: ${summary["Приход"].toFixed(2)} лв | 
    Разходи: ${summary["Разход"].toFixed(2)} лв | 
    Нетно: ${net.toFixed(2)} лв
  `;
}

function renderRecentTable() {
  const tbody = document.querySelector("#recentTable tbody");
  tbody.innerHTML = records.slice(0, 5).map(r => `
    <tr>
      <td>${r.date}</td>
      <td style="color:${r.type === 'Приход' ? '#4caf50' : '#f44336'};">${r.type}</td>
      <td>${r.amount.toFixed(2)} лв</td>
      <td>${r.method}</td>
      <td>${r.note}</td>
      <td>
        <button onclick="deleteRecord('${r.id}')" style="background:#f44336;font-size:12px;padding:4px 6px;">🗑️</button>
      </td>
    </tr>
  `).join("");
}

function updateSummaries() {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  let todayIncome = 0, todayExpense = 0;
  let monthIncome = 0, monthExpense = 0;

  records.forEach(({ date, type, amount }) => {
    if (date === today) {
      if (type === "Приход") todayIncome += amount;
      else todayExpense += amount;
    }
    if (date.startsWith(currentMonth)) {
      if (type === "Приход") monthIncome += amount;
      else monthExpense += amount;
    }
  });

  const saldo = (monthIncome - monthExpense).toFixed(2);

  document.getElementById("dailySummary").innerHTML = 
    `📅 <strong>Днес:</strong> Приходи: ${todayIncome.toFixed(2)} лв | Разходи: ${todayExpense.toFixed(2)} лв`;

  document.getElementById("monthlySummary").innerHTML = 
    `📆 <strong>Месец:</strong> Приходи: ${monthIncome.toFixed(2)} лв | Разходи: ${monthExpense.toFixed(2)} лв | Салдо: ${saldo} лв`;
}

function renderTaxSummary() {
  const income = records.filter(r => r.type === "Приход").reduce((sum, r) => sum + r.amount, 0);
  const expense = records.filter(r => r.type === "Разход").reduce((sum, r) => sum + r.amount, 0);
  const profit = income - expense;

  if (profit <= 0) {
    document.getElementById("taxSummary").innerHTML = `
      <strong>📊 Данъчна справка:</strong><br>
      Няма облагаема печалба.
    `;
    return;
  }

  const vat = +(profit * 0.2).toFixed(2);
  const taxableProfit = +(profit - vat).toFixed(2);
  const corporateTax = +(taxableProfit * 0.1).toFixed(2);
  const netProfit = +(taxableProfit - corporateTax).toFixed(2);

  document.getElementById("taxSummary").innerHTML = `
    <strong>📊 Данъчна справка:</strong><br>
    Приходи: ${income.toFixed(2)} лв | Разходи: ${expense.toFixed(2)} лв | Печалба: ${profit.toFixed(2)} лв<br>
    ДДС (20%): ${vat.toFixed(2)} лв | Данък печалба (10%): ${corporateTax.toFixed(2)} лв<br>
    👉 <strong>Нетна печалба:</strong> ${netProfit.toFixed(2)} лв
  `;
}

function renderMethodSummary() {
  const totals = { Кеш: 0, Банка: 0, Карта: 0 };

  records.forEach(r => {
    const amount = r.type === "Приход" ? r.amount : -r.amount;
    if (totals.hasOwnProperty(r.method)) {
      totals[r.method] += amount;
    }
  });

  const totalSum = totals.Кеш + totals.Банка + totals.Карта;
  const totalBank = totals.Банка + totals.Карта;

  document.getElementById("methodSummary").innerHTML = `
    💰 Кеш: ${totals.Кеш.toFixed(2)} лв |
    🏦 Банка: ${totals.Банка.toFixed(2)} лв |
    💳 Карта: ${totals.Карта.toFixed(2)} лв |
    Общо: ${totalSum.toFixed(2)} лв
  `;

  document.getElementById("methodSummaryExtra").innerHTML = `
    <i class="fa-solid fa-money-bill-wave" style="color:#4caf50;"></i> <strong>Общо кеш:</strong> ${totals.Кеш.toFixed(2)} лв |
    <i class="fa-solid fa-building-columns" style="color:#2196f3;"></i> <strong>Общо банка:</strong> ${totalBank.toFixed(2)} лв
  `;
}

function renderChart() {
  const ctx = document.getElementById('chart').getContext('2d');
  const monthData = {};
  records.forEach(r => {
    const m = r.date?.slice(0, 7);
    if (!m) return;
    if (!monthData[m]) monthData[m] = { income: 0, expense: 0 };
    if (r.type === "Приход") monthData[m].income += r.amount;
    if (r.type === "Разход") monthData[m].expense += r.amount;
  });

  const labels = Object.keys(monthData).sort();
  const incomeData = labels.map(m => monthData[m].income);
  const expenseData = labels.map(m => monthData[m].expense);

  if (chartRef) chartRef.destroy();
  chartRef = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Приходи', data: incomeData, backgroundColor: '#4caf50' },
        { label: 'Разходи', data: expenseData, backgroundColor: '#f44336' }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Приходи и разходи по месеци' }
      }
    }
  });
}

function toggleCustomNote() {
  const noteSelect = document.getElementById("noteSelect");
  const customNoteInput = document.getElementById("customNote");

  if (noteSelect.value === "custom") {
    customNoteInput.classList.remove("hidden");
    customNoteInput.focus();
  } else {
    customNoteInput.classList.add("hidden");
    customNoteInput.value = "";
  }
}

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

window.showScreen = function(screen) {
  const addScreen = document.getElementById("screen-add");
  const reportScreen = document.getElementById("screen-report");

  if (screen === "report") {
    addScreen.classList.add("hidden");
    reportScreen.classList.remove("hidden");
  } else {
    addScreen.classList.remove("hidden");
    reportScreen.classList.add("hidden");
  }
};
  noteSelect.value = currentValue;
}



