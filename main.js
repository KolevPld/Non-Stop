import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyD692ktQboNPavUgo9XiANtaqm-8tUOB6c",
  authDomain: "nonstopapp-c30b1.firebaseapp.com",
  projectId: "nonstopapp-c30b1",
  storageBucket: "nonstopapp-c30b1.appspot.com",
  messagingSenderId: "368870682423",
  appId: "1:368870682423:web:5f0ff3245c07c7796a74b2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const ADMIN_EMAIL = "kmet.zapaden@gmail.com";

// 🔐 Login/Register
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

// 🔄 При вход
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
    showScreen("add");
    loadRecords();
  } else {
    statusDiv.textContent = "🔐 Моля, влез с имейл и парола.";
    document.body.classList.remove("admin");
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }
});

// 🔥 Зареждане от Firestore
async function loadRecords() {
  records = [];
  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);
  snapshot.forEach(docSnap => records.push({ id: docSnap.id, ...docSnap.data() }));

  if (document.body.classList.contains("admin")) {
    renderTable();
    renderRecentTable();
    updateSummaries();
    renderMethodSummary();
    renderChart();
    applyFilters();
    renderTaxSummary();
    updateNoteOptions();
    showScreen("add");
  } else {
    renderRecentTable();
    showScreen("add");
    document.querySelector("#totalSummary").innerHTML = "";
  }
}

// 🔥 Добавяне на запис
async function addRecord() {
  const date = document.getElementById("date").value;
  const type = document.getElementById("type").value;
  const method = document.getElementById("method").value.split(" ")[0];
  const amount = parseFloat(document.getElementById("amount").value);
  const noteSelect = document.getElementById("noteSelect").value;
  const note = noteSelect === "custom" ? document.getElementById("customNote").value.trim() : noteSelect;
  const store = document.getElementById("store").value;
  let category = document.getElementById("category").value;
  if (category === "custom") category = document.getElementById("customCategory").value;
  if (!date || isNaN(amount)) return alert("Попълни дата и сума.");

  await addDoc(collection(db, "records"), {
    date, type, method, amount, note, category, store
  });

  loadRecords();
  clearForm();
}
window.addRecord = addRecord;
window.deleteRecord = deleteRecord;

// 🔥 Изтриване
async function deleteRecord(id) {
  if (!confirm("Сигурен ли си?")) return;
  await deleteDoc(doc(db, "records", id));
  loadRecords();
}

function clearForm() {
  document.getElementById("date").value = "";
  document.getElementById("amount").value = "";
  document.getElementById("customNote").value = "";
  document.getElementById("customCategory").value = "";
}

// Филтри
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
  const { type, method, category, store, startDate, endDate } = Object.fromEntries(
    Object.entries(filters).map(([k, el]) => [k, el.value])
  );
  filteredRecords = records.filter(r => {
    return (!type || r.type === type) &&
           (!method || r.method === method) &&
           (!category || (r.category || '') === category) &&
           (!store || r.store === store) &&
           (!startDate || r.date >= startDate) &&
           (!endDate || r.date <= endDate);
  });
  renderTable(filteredRecords);
  updateFilterSummary(filteredRecords);
}
function clearFilters() {
  Object.values(filters).forEach(el => el.value = "");
  applyFilters();
}
function renderTable(data = records) {
  const tbody = document.querySelector("#recordsTable tbody");
  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td style="color: var(${r.type === 'Приход' ? '--accent-color' : '--danger-color'});">${r.type}</td>
      <td>${r.amount.toFixed(2)} лв</td>
      <td>${r.method}</td>
      <td>${r.category || ''}</td>
      <td>${r.note}</td>
      <td>
        <button class="admin-only" onclick="deleteRecord('${r.id}')" style="background: var(--danger-color); font-size:12px; padding:4px 6px;">
          🗑️
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateFilterSummary(data) {
  const summary = { Приход: 0, Разход: 0 };
  data.forEach(r => summary[r.type] += r.amount);
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
      <td style="color: var(${r.type === 'Приход' ? '--accent-color' : '--danger-color'});">${r.type}</td>
      <td>${r.amount.toFixed(2)} лв</td>
      <td>${r.method}</td>
      <td>${r.note}</td>
      <td>
        <button onclick="deleteRecord('${r.id}')" style="background: var(--danger-color); font-size:12px; padding:4px 6px;">🗑️</button>
      </td>
    </tr>
  `).join("");
}

function updateSummaries() {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  let tIn = 0, tOut = 0, mIn = 0, mOut = 0;

  records.forEach(({ date, type, amount }) => {
    if (date === today) type === "Приход" ? tIn += amount : tOut += amount;
    if (date.startsWith(month)) type === "Приход" ? mIn += amount : mOut += amount;
  });

  document.getElementById("dailySummary").innerHTML =
    `📅 <strong>Днес:</strong> Приходи: ${tIn.toFixed(2)} лв | Разходи: ${tOut.toFixed(2)} лв`;
  document.getElementById("monthlySummary").innerHTML =
    `📆 <strong>Месец:</strong> Приходи: ${mIn.toFixed(2)} лв | Разходи: ${mOut.toFixed(2)} лв | Салдо: ${(mIn - mOut).toFixed(2)} лв`;
}

function renderTaxSummary() {
  const income = records.filter(r => r.type === "Приход").reduce((sum, r) => sum + r.amount, 0);
  const expense = records.filter(r => r.type === "Разход").reduce((sum, r) => sum + r.amount, 0);
  const profit = income - expense;

  if (profit <= 0) {
    document.getElementById("taxSummary").innerHTML = `📊 Няма облагаема печалба.`;
    return;
  }

  const vat = +(profit * 0.2).toFixed(2);
  const taxable = +(profit - vat).toFixed(2);
  const tax = +(taxable * 0.1).toFixed(2);
  const net = +(taxable - tax).toFixed(2);

  document.getElementById("taxSummary").innerHTML = `
    📊 Данъчна справка:<br>
    Приходи: ${income.toFixed(2)} лв | Разходи: ${expense.toFixed(2)} лв | Печалба: ${profit.toFixed(2)} лв<br>
    ДДС (20%): ${vat.toFixed(2)} лв | Данък печалба (10%): ${tax.toFixed(2)} лв<br>
    👉 <strong>Нетна печалба:</strong> ${net.toFixed(2)} лв
  `;
}

function renderMethodSummary() {
  const totals = { Кеш: 0, Банка: 0, Карта: 0 };
  records.forEach(r => {
    const val = r.type === "Приход" ? r.amount : -r.amount;
    if (totals[r.method] !== undefined) totals[r.method] += val;
  });

  document.getElementById("methodSummary").innerHTML = `
    💰 Кеш: ${totals.Кеш.toFixed(2)} лв |
    🏦 Банка: ${totals.Банка.toFixed(2)} лв |
    💳 Карта: ${totals.Карта.toFixed(2)} лв |
    Общо: ${(totals.Кеш + totals.Банка + totals.Карта).toFixed(2)} лв
  `;

  document.getElementById("methodSummaryExtra").innerHTML = `
    💰 <strong>Общо кеш:</strong> ${totals.Кеш.toFixed(2)} лв |
    🏦 <strong>Общо банка:</strong> ${(totals.Банка + totals.Карта).toFixed(2)} лв
  `;
}

function renderChart() {
  const ctx = document.getElementById('chart').getContext('2d');
  const months = {};

  records.forEach(r => {
    const m = r.date?.slice(0, 7);
    if (!months[m]) months[m] = { income: 0, expense: 0 };
    if (r.type === "Приход") months[m].income += r.amount;
    else months[m].expense += r.amount;
  });

  const labels = Object.keys(months).sort();
  const incomeData = labels.map(m => months[m].income);
  const expenseData = labels.map(m => months[m].expense);

  if (chartRef) chartRef.destroy();
  chartRef = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Приходи', data: incomeData, backgroundColor: getComputedStyle(document.body).getPropertyValue('--accent-color').trim() },
        { label: 'Разходи', data: expenseData, backgroundColor: getComputedStyle(document.body).getPropertyValue('--danger-color').trim() }
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
  const select = document.getElementById("noteSelect");
  const input = document.getElementById("customNote");
  if (select.value === "custom") {
    input.classList.remove("hidden");
    input.focus();
  } else {
    input.classList.add("hidden");
    input.value = "";
  }
}
window.toggleCustomNote = toggleCustomNote;

function saveCustomNote(note) {
  let notes = JSON.parse(localStorage.getItem("customNotes")) || [];
  if (!note || notes.includes(note)) return;
  notes.unshift(note);
  if (notes.length > 5) notes = notes.slice(0, 5);
  localStorage.setItem("customNotes", JSON.stringify(notes));
  updateNoteOptions();
}

function updateNoteOptions() {
  const select = document.getElementById("noteSelect");
  const saved = JSON.parse(localStorage.getItem("customNotes")) || [];
  const current = select.value;

  select.innerHTML = `
    <option value="М1">М1</option>
    <option value="М2">М2</option>
    <option value="custom">Въведи ръчно...</option>
  `;

  saved.forEach(note => {
    const opt = document.createElement("option");
    opt.value = note;
    opt.textContent = note;
    select.insertBefore(opt, select.querySelector('option[value="custom"]'));
  });

  select.value = current;
}

window.showScreen = function(screen) {
  const isAdmin = document.body.classList.contains("admin");
  const add = document.getElementById("screen-add");
  const report = document.getElementById("screen-report");

  if (screen === "report") {
    if (!isAdmin) return alert("Нямаш достъп до този екран.");
    add.classList.add("hidden");
    report.classList.remove("hidden");
    renderTable(); updateSummaries(); renderMethodSummary();
    renderChart(); applyFilters(); renderTaxSummary();
  } else {
    add.classList.remove("hidden");
    report.classList.add("hidden");
    renderRecentTable();
  }
};

function toggleCustomCategory() {
  const select = document.getElementById("category");
  const input = document.getElementById("customCategory");
  if (select.value === "custom") {
    input.classList.remove("hidden");
    input.focus();
  } else {
    input.classList.add("hidden");
    input.value = "";
  }
}
window.toggleCustomCategory = toggleCustomCategory;



