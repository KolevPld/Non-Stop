import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  updateDoc,   // 👈 ДОБАВЕНО
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
let editingId = null;          // 👈 НОВО
let uploadedImageUrl = "";     // 👈 НОВО

const statusDiv = document.getElementById("status");

onAuthStateChanged(auth, user => {
  const isLoggedIn = user && !user.isAnonymous;
  const isAdmin = isLoggedIn && user.email === ADMIN_EMAIL;

  if (isLoggedIn) {
    statusDiv.textContent = `🔓 Влязъл: ${user.email}${isAdmin ? " (админ)" : ""}`;
    document.body.classList.toggle("admin", isAdmin);
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    showScreen("add"); // Принудително показва само екран 1
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

  // Винаги показваме само екран 1 при вход
  showScreen("add");
} else {
  renderRecentTable();       
  showScreen("add");         
  document.querySelector("#totalSummary").innerHTML = "";
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

  const imageUrl = uploadedImageUrl || ""; // 👈 Cloudinary URL

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

  loadRecords();
  clearForm();
}

async function saveEditedRecord() {
  if (!editingId) return;

  const date = document.getElementById("date").value;
  const type = document.getElementById("type").value;
  const method = document.getElementById("method").value.split(" ")[0];
  const amount = parseFloat(document.getElementById("amount").value);
  const store = document.getElementById("store").value;

  let note = document.getElementById("noteSelect").value;
  if (note === "custom") {
    note = document.getElementById("customNote").value.trim();
    if (note) saveCustomNote(note);
  }

  let category = document.getElementById("category").value;
  if (category === "custom") {
    category = document.getElementById("customCategory").value.trim();
  }

  if (!date || isNaN(amount)) return alert("Попълни дата и сума.");

  const originalId = document.getElementById("addForm").getAttribute("data-editing");
const record = records.find(r => r.id === originalId);
  await updateDoc(doc(db, "records", editingId), {
    date,
    type,
    method,
    amount,
    note,
    category,
    store,
    imageUrl: uploadedImageUrl || record.imageUrl || ""
  });

  editingId = null;
  clearForm();

  const form = document.getElementById("addForm");
  form.removeAttribute("data-editing");
  form.classList.remove("editing-mode");

  const addBtn = document.querySelector("button[onclick='saveEditedRecord()']");
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
  addBtn.setAttribute("onclick", "addRecord()");

  loadRecords();
}

window.addRecord = addRecord;
window.deleteRecord = deleteRecord;

let editingId = null;

window.editImage = async function (id) {
  const record = records.find(r => r.id === id);
  if (!record) return;

  editingId = id;

  document.getElementById("date").value = record.date;
  document.getElementById("type").value = record.type;
  document.getElementById("method").value = record.method;
  document.getElementById("amount").value = record.amount;
  document.getElementById("store").value = record.store;

  const catSelect = document.getElementById("category");
  const customCatInput = document.getElementById("customCategory");

  if ([...catSelect.options].some(o => o.value === record.category)) {
    catSelect.value = record.category;
    customCatInput.classList.add("hidden");
    customCatInput.value = "";
  } else {
    catSelect.value = "custom";
    customCatInput.classList.remove("hidden");
    customCatInput.value = record.category;
  }

  const noteSelect = document.getElementById("noteSelect");
  const customNoteInput = document.getElementById("customNote");

  if ([...noteSelect.options].some(o => o.value === record.note)) {
    noteSelect.value = record.note;
    customNoteInput.classList.add("hidden");
    customNoteInput.value = "";
  } else {
    noteSelect.value = "custom";
    customNoteInput.classList.remove("hidden");
    customNoteInput.value = record.note;
  }

  if (record.imageUrl) {
    uploadedImageUrl = record.imageUrl;
    document.getElementById("imagePreview").src = uploadedImageUrl;
    document.getElementById("imagePreview").classList.remove("hidden");
  } else {
    removeImage();
  }

  const addBtn = document.querySelector("button[onclick='addRecord()']");
  addBtn.innerHTML = "💾 Запази промените";
  addBtn.onclick = saveEditedRecord;
};



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
  const noteInput = document.getElementById("customNote");
  if (noteInput) noteInput.value = "";
  
  const categoryInput = document.getElementById("customCategory");
  if (categoryInput) categoryInput.value = "";
  
  uploadedImageUrl = "";
document.getElementById("imagePreview").src = "";
document.getElementById("imagePreview").classList.add("hidden");

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
      <td>${r.amount.toFixed(2)} €</td>
      <td>${r.method}</td>
      <td>${r.category || ''}</td>
      <td>${r.note}</td>
      <td style="white-space: nowrap;">
        ${
          r.imageUrl
            ? `<img src="${r.imageUrl}"
                   style="height:30px;border-radius:4px;cursor:pointer;margin-right:6px;"
                   onclick="openImageModal('${r.imageUrl}')">`
            : '📷'
        }
        <button class="admin-only btn-icon" onclick="editImage('${r.id}')">✏️</button>
        <button class="admin-only btn-icon" onclick="deleteRecord('${r.id}')">🗑️</button>
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
    Приходи: ${summary["Приход"].toFixed(2)}  € | 
    Разходи: ${summary["Разход"].toFixed(2)}  € | 
    Нетно: ${net.toFixed(2)}  €
  `;
}

function renderRecentTable() {
  const tbody = document.querySelector("#recentTable tbody");
  tbody.innerHTML = records.slice(0, 5).map(r => `
    <tr>
      <td>${r.date}</td>
      <td style="color:${r.type === 'Приход' ? '#4caf50' : '#f44336'};">${r.type}</td>
      <td>${r.amount.toFixed(2)}  €</td>
      <td>${r.method}</td>
      <td>${r.category || ''}</td>
      <td>${r.note}</td>
      <td>
      <button class="btn-icon" onclick="deleteRecord('${r.id}')">🗑️</button>
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

  document.getElementById("dailySummary").innerHTML = `
  <h3><i class="fa-solid fa-calendar-day"></i> Днес</h3>
  <table>
    <tr><td>Приходи:</td><td>${todayIncome.toFixed(2)} €</td></tr>
    <tr><td>Разходи:</td><td>${todayExpense.toFixed(2)} €</td></tr>
  </table>
`;

document.getElementById("monthlySummary").innerHTML = `
  <h3><i class="fa-solid fa-calendar-alt"></i> Месец</h3>
  <table>
    <tr><td>Приходи:</td><td>${monthIncome.toFixed(2)} €</td></tr>
    <tr><td>Разходи:</td><td>${monthExpense.toFixed(2)} €</td></tr>
    <tr><td><strong>Салдо:</strong></td><td><strong>${saldo} €</strong></td></tr>
  </table>
`;
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
    <h3><i class="fa-solid fa-file-invoice-dollar"></i> Данъчна справка</h3>
    <table>
      <tr><td>Приходи:</td><td>${income.toFixed(2)} €</td></tr>
      <tr><td>Разходи:</td><td>${expense.toFixed(2)} €</td></tr>
      <tr><td>Печалба:</td><td>${profit.toFixed(2)} €</td></tr>
      <tr><td>ДДС (20%):</td><td>${vat.toFixed(2)} €</td></tr>
      <tr><td>Данък печалба (10%):</td><td>${corporateTax.toFixed(2)} €</td></tr>
      <tr>
        <td><strong>👉 Нетна печалба:</strong></td>
        <td><strong style="color:#ffca28;">${netProfit.toFixed(2)} €</strong></td>
      </tr>
    </table>
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
  <h3><i class="fa-solid fa-wallet"></i> Разпределение по метод</h3>
  <table>
    <tr><td>💰 Кеш:</td><td>${totals.Кеш.toFixed(2)} €</td></tr>
    <tr><td>🏦 Банка:</td><td>${totals.Банка.toFixed(2)} €</td></tr>
    <tr><td>💳 Карта:</td><td>${totals.Карта.toFixed(2)} €</td></tr>
    <tr><td><strong>Общо:</strong></td><td><strong>${totalSum.toFixed(2)} €</strong></td></tr>
  </table>
`;

document.getElementById("methodSummaryExtra").innerHTML = `
  <h3><i class="fa-solid fa-circle-dollar-to-slot"></i> Общи наличности</h3>
  <table>
    <tr><td><i class="fa-solid fa-money-bill-wave" style="color:#4caf50;"></i> Общо кеш:</td><td>${totals.Кеш.toFixed(2)} €</td></tr>
    <tr><td><i class="fa-solid fa-building-columns" style="color:#2196f3;"></i> Общо банка:</td><td>${totalBank.toFixed(2)} €</td></tr>
  </table>
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
        {
          label: 'Приходи',
          data: incomeData,
          backgroundColor: '#4caf50',
          borderRadius: 6,
          barThickness: 30
        },
        {
          label: 'Разходи',
          data: expenseData,
          backgroundColor: '#f44336',
          borderRadius: 6,
          barThickness: 30
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#ccc',
            font: { size: 14 }
          }
        },
        title: {
          display: true,
          text: '📊 Приходи и разходи по месеци',
          color: '#ccc',
          font: { size: 16 }
        }
      },
      scales: {
        x: {
          ticks: { color: '#ccc' },
          grid: { display: false }
        },
        y: {
          ticks: { color: '#ccc' },
          grid: { color: '#444' }
        }
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
  const isAdmin = document.body.classList.contains("admin");

  if (screen === "report") {
    if (!isAdmin) {
      alert("Нямаш достъп до този екран.");
      return;
    }
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

// 🖨️ Принтиране на филтрираната таблица
window.printFilteredTable = function () {
  const table = document.querySelector('#recordsTable');
  if (!table) return alert('Таблицата не е намерена.');

  const newWindow = window.open('', '', 'width=900,height=600');
  newWindow.document.write('<html><head><title>Принтиране</title>');
  newWindow.document.write('<style>table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 8px; }</style>');
  newWindow.document.write('</head><body>');
  newWindow.document.write(table.outerHTML);
  newWindow.document.write('</body></html>');
  newWindow.document.close();
  newWindow.print();
};
// 📁 Експорт към Excel с SheetJS
window.exportFilteredToExcel = function () {
  const table = document.querySelector('#recordsTable');
  if (!table) return alert('Таблицата не е намерена.');

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, 'Отчет');
  XLSX.writeFile(wb, 'nonstop-отчет.xlsx');
};

function openImageModal(url) {
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("modalImage");

  modalImg.src = url;
  modal.classList.remove("hidden");
}

function closeImageModal() {
  document.getElementById("imageModal").classList.add("hidden");
  document.getElementById("modalImage").src = "";
}

window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.editImage = editImage;
window.saveEditedRecord = saveEditedRecord;
;








