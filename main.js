import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

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
const auth = getAuth();

let records = [];
let filteredRecords = [];
let chartRef = null;

const statusDiv = document.getElementById("status");
statusDiv.textContent = "⏳ Свързване с Firestore...";
  
const filters = {
  type: document.getElementById("filterType"),
  method: document.getElementById("filterMethod"),
  category: document.getElementById("filterCategory"),
  store: document.getElementById("filterStore"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
};
  
signInAnonymously(auth)
  .then(() => console.log("Signed in anonymously"))
  .catch(console.error);

onAuthStateChanged(auth, user => { 
  if (user) { 
    statusDiv.textContent = "✅ Свързан с Firestore";
    loadRecords();
  } else {
    statusDiv.textContent = "❌ Неуспешно свързване!";
  }
});

async function loadRecords() {
  records = [];
  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);
  snapshot.forEach(docSnap => records.push({ id: docSnap.id, ...docSnap.data() }));
  renderTable();
  renderRecentTable();
  updateSummaries();
  renderMethodSummary();
  renderChart();
  applyFilters();
  renderTaxSummary();
  updateNoteOptions();
}
function toggleCustomNote() {
  const noteSelect = document.getElementById("noteSelect");
  const customNoteInput = document.getElementById("customNote");

  if (noteSelect.value === "custom") {
    customNoteInput.classList.remove("hidden");
    customNoteInput.focus();
  } else {
    customNoteInput.classList.add("hidden");
    customNoteInput.value = ""; // изчистване на полето
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
  const categorySelect = document.getElementById("category");
  const store = document.getElementById("store").value;
let category = categorySelect.value;
if (category === "custom") {
  category = document.getElementById("customCategory").value;
}

  if (!date || isNaN(amount)) return alert("Попълни дата и сума.");
  await addDoc(collection(db, "records"), {date, type, method, amount, note, category, store
});
 loadRecords(); clearForm();
}
function loadRecentTransactions() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  const tableBody = document.querySelector("#recentTable tbody");
  tableBody.innerHTML = "Зареждане...";

  db.collection("users")
    .doc(user.uid)
    .collection("transactions")
    .orderBy("date", "desc")
    .limit(5)
    .get()
    .then((querySnapshot) => {
      tableBody.innerHTML = ""; // Изчистваме
      if (querySnapshot.empty) {
        tableBody.innerHTML = "<tr><td colspan='6'>Няма записи.</td></tr>";
        return;
      }

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${data.date.toDate().toLocaleDateString()}</td>
          <td>${data.type}</td>
          <td>${data.amount.toFixed(2)}</td>
          <td>${data.method}</td>
          <td>${data.note || ""}</td>
          <td><button onclick="deleteTransaction('${doc.id}')">❌</button></td>
        `;
        tableBody.appendChild(row);
      });
    })
    .catch((error) => {
      console.error("Грешка при зареждане на записи:", error);
      tableBody.innerHTML = "<tr><td colspan='6'>Грешка при зареждане.</td></tr>";
    });
}

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
      <td><button onclick="deleteRecord('${r.id}')" style="background:#f44336;font-size:12px;padding:4px 6px;">🗑️</button></td>
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

  function clearFilters() {
  filters.type.value = "";
  filters.method.value = "";
  filters.category.value = "";
  filters.startDate.value = "";
  filters.endDate.value = "";
  filters.store.value = "";
  applyFilters();
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
  records.forEach(r=>{
    const m = r.date?.slice(0,7);
    if(!m) return;
    if(!monthData[m]) monthData[m]={income:0,expense:0};
    if(r.type==="Приход") monthData[m].income+=r.amount;
    if(r.type==="Разход") monthData[m].expense+=r.amount;
  });
  const labels = Object.keys(monthData).sort();
  const incomeData = labels.map(m=>monthData[m].income);
  const expenseData = labels.map(m=>monthData[m].expense);

  if(chartRef) chartRef.destroy();
  chartRef = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Приходи', data: incomeData, backgroundColor:'#4caf50' },
        { label: 'Разходи', data: expenseData, backgroundColor:'#f44336' }
      ]
    },
    options: { responsive:true, plugins:{ legend:{position:'top'}, title:{display:true,text:'Приходи и разходи по месеци'}}}
  });
}
function setCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById("startDate").value = `${year}-${month}-01`;
  document.getElementById("endDate").value = `${year}-${month}-${new Date(year, now.getMonth() + 1, 0).getDate()}`;
  applyFilters();
}

window.addRecord = addRecord;
window.deleteRecord = deleteRecord;
window.showScreen = function(name) {
  document.getElementById("screen-add").classList.add("hidden");
  document.getElementById("screen-report").classList.add("hidden");
  document.getElementById("screen-" + name).classList.remove("hidden");
};
window.exportToExcel = () => {
  const wb = XLSX.utils.book_new();
  const rows = [["Дата", "Тип", "Сума", "Метод", "Бележка"]];
  records.forEach(r=>rows.push([r.date, r.type, r.amount.toFixed(2), r.method, r.note]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Отчет");
  XLSX.writeFile(wb, "nonstop_otchet.xlsx");
};

window.applyFilters = applyFilters;
window.clearFilters = clearFilters;

window.exportToCSV = () => {
  let csv = "Дата,Тип,Сума,Метод,Бележка\n";
  records.forEach(r => {
    csv += `${r.date},${r.type},${r.amount.toFixed(2)},${r.method},${r.note}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `nonstop_backup_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
window.exportToJSON = () => {
  const json = JSON.stringify(records, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `nonstop_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
window.checkPassword = () => {
  const pass = document.getElementById("password").value;
  if (pass === "7801") {
    document.getElementById("login").style.display = "none";
    document.getElementById("app").classList.remove("hidden");
  } else {
    alert("Грешна парола!");
  }
};
  window.printFilteredTable = () => {
  const printWindow = window.open('', '_blank');

  const income = filteredRecords.filter(r => r.type === "Приход").reduce((sum, r) => sum + r.amount, 0);
  const expense = filteredRecords.filter(r => r.type === "Разход").reduce((sum, r) => sum + r.amount, 0);
  const total = income - expense;

  const summaryHtml = `
    <div style="margin-top:20px; font-weight:bold; font-size:16px;">
      Сума от филтъра: 
      Приходи: ${income.toFixed(2)} лв | 
      Разходи: ${expense.toFixed(2)} лв | 
      Нетно: ${total.toFixed(2)} лв
    </div>
  `;

  const rows = filteredRecords.map(r =>
    `<tr>
      <td>${r.date}</td>
      <td>${r.type}</td>
      <td>${r.amount.toFixed(2)} лв</td>
      <td>${r.method}</td>
      <td>${r.category || ''}</td>
      <td>${r.note}</td>
    </tr>`
  ).join("");

  const html = `
    <html>
    <head>
      <title>Принтиране на записи</title>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #999; padding: 8px; text-align: left; }
        th { background: #eee; }
      </style>
    </head>
    <body>
      <h2>Филтрирани записи</h2>
      <table>
        <thead>
          <tr><th>Дата</th><th>Тип</th><th>Сума</th><th>Метод</th><th>Категория</th><th>Бележка</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${summaryHtml}
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

window.exportFilteredToExcel = () => {
  const wb = XLSX.utils.book_new();
  const rows = [["Дата", "Тип", "Сума", "Метод", "Категория", "Бележка"]];

  let income = 0, expense = 0;

  filteredRecords.forEach(r => {
    const amount = parseFloat(r.amount);
    rows.push([r.date, r.type, amount.toFixed(2), r.method, r.category || '', r.note]);

    if (r.type === "Приход") income += amount;
    if (r.type === "Разход") expense += amount;
  });

  const total = income - expense;

  rows.push([]);
  rows.push(["", "Сума от филтъра:", `Приходи: ${income.toFixed(2)} лв`, `Разходи: ${expense.toFixed(2)} лв`, `Нетно: ${total.toFixed(2)} лв`]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Филтрирани");
  XLSX.writeFile(wb, "filtrirani_danni.xlsx");
};
// Регистрация
function register() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  firebase.auth().createUserWithEmailAndPassword(email, password)
    .then((userCredential) => {
      alert("Успешна регистрация!");
      console.log("User registered:", userCredential.user);
    })
    .catch((error) => {
      alert("Грешка: " + error.message);
    });
}

// Вход
function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  firebase.auth().signInWithEmailAndPassword(email, password)
    .then((userCredential) => {
      alert("Успешен вход!");
      console.log("User logged in:", userCredential.user);
    })
    .catch((error) => {
      alert("Грешка: " + error.message);
    });
}

// Изход
function logout() {
  firebase.auth().signOut()
    .then(() => {
      alert("Излезе от акаунта.");
    });
}
firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    console.log("Влязъл потребител:", user.uid);
    document.getElementById("auth-container").style.display = "none";
    // Покажи UI-то за транзакции тук
  } else {
    console.log("Няма логнат потребител.");
    document.getElementById("auth-container").style.display = "block";
    // Скрий UI-то за транзакции тук
  }
});

