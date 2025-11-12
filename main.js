import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

/* --- Firebase конфигурация --- */
const firebaseConfig = {
  apiKey: "AIzaSyD692ktQboNPavUgo9XiANtaqm-8tUOB6c",
  authDomain: "nonstopapp-c30b1.firebaseapp.com",
  projectId: "nonstopapp-c30b1",
  storageBucket: "nonstopapp-c30b1.firebasestorage.app",
  messagingSenderId: "368870682423",
  appId: "1:368870682423:web:5f0ff3245c07c7796a74b2"
};

/* --- Инициализация --- */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let records = [];
let chartRef = null;

/* ===============================
   🧩 АВТЕНТИКАЦИЯ
   =============================== */

async function register() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("✅ Регистрацията е успешна!");
  } catch (err) {
    alert("Грешка: " + err.message);
  }
}

async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("✅ Успешен вход!");
  } catch (err) {
    alert("Грешка: " + err.message);
  }
}

async function logout() {
  await signOut(auth);
  alert("🚪 Излезе от акаунта.");
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("auth-container").style.display = "none";
    document.getElementById("main-container").style.display = "block";
    loadRecords();
    loadRecentTransactions();
  } else {
    document.getElementById("auth-container").style.display = "block";
    document.getElementById("main-container").style.display = "none";
  }
});

/* ===============================
   📊 ДАННИ
   =============================== */

async function addRecord() {
  const user = auth.currentUser;
  if (!user) return alert("Моля, влез в акаунта си.");

  const date = document.getElementById("date").value;
  const type = document.getElementById("type").value;
  const method = document.getElementById("method").value;
  const store = document.getElementById("store").value;
  const category = document.getElementById("category").value;
  const amount = parseFloat(document.getElementById("amount").value);
  const noteSelect = document.getElementById("noteSelect").value;
  const customNote = document.getElementById("customNote").value;
  const note = (noteSelect === "custom") ? customNote : noteSelect;

  if (!date || isNaN(amount)) return alert("❗ Въведи валидна дата и сума.");

  await addDoc(collection(db, "users", user.uid, "transactions"), {
    date,
    type,
    method,
    store,
    category,
    amount,
    note,
    createdAt: new Date().toISOString()
  });

  alert("✅ Записът е добавен успешно!");
  document.getElementById("addForm").reset();
  loadRecords();
  loadRecentTransactions();
}

async function deleteTransaction(id) {
  const user = auth.currentUser;
  if (!user) return;
  if (!confirm("Сигурен ли си, че искаш да изтриеш този запис?")) return;
  await deleteDoc(doc(db, "users", user.uid, "transactions", id));
  loadRecords();
  loadRecentTransactions();
}

async function loadRecords() {
  const user = auth.currentUser;
  if (!user) return;

  records = [];
  const q = query(collection(db, "users", user.uid, "transactions"), orderBy("date", "desc"));
  const snap = await getDocs(q);
  snap.forEach(docSnap => records.push({ id: docSnap.id, ...docSnap.data() }));
  renderTable();
  renderSummaries();
}

function renderTable(data = records) {
  const tbody = document.querySelector("#recordsTable tbody");
  tbody.innerHTML = "";
  if (!data.length) {
    tbody.innerHTML = "<tr><td colspan='7'>Няма записи.</td></tr>";
    return;
  }
  data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td style="color:${r.type === 'Приход' ? '#4caf50' : '#f44336'};">${r.type}</td>
      <td>${r.amount.toFixed(2)}</td>
      <td>${r.method}</td>
      <td>${r.category || ''}</td>
      <td>${r.note || ''}</td>
      <td><button onclick="deleteTransaction('${r.id}')">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadRecentTransactions() {
  const user = auth.currentUser;
  if (!user) return;

  const tableBody = document.querySelector("#recentTable tbody");
  tableBody.innerHTML = "Зареждане...";

  const q = query(collection(db, "users", user.uid, "transactions"), orderBy("date", "desc"));
  const snap = await getDocs(q);

  const docs = [];
  snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
  const last5 = docs.slice(0, 5);

  tableBody.innerHTML = "";
  last5.forEach(data => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${data.date}</td>
      <td>${data.type}</td>
      <td>${data.amount.toFixed(2)}</td>
      <td>${data.method}</td>
      <td>${data.note || ""}</td>
      <td><button onclick="deleteTransaction('${data.id}')">❌</button></td>
    `;
    tableBody.appendChild(row);
  });
}

function renderSummaries() {
  const income = records.filter(r => r.type === "Приход").reduce((s, r) => s + r.amount, 0);
  const expense = records.filter(r => r.type === "Разход").reduce((s, r) => s + r.amount, 0);
  const net = income - expense;

  document.getElementById("monthlySummary").innerHTML =
    `📊 Общо: Приходи: ${income.toFixed(2)} лв | Разходи: ${expense.toFixed(2)} лв | Нетно: ${net.toFixed(2)} лв`;
}

/* ===============================
   🌍 Експортираме към HTML
   =============================== */
window.register = register;
window.login = login;
window.logout = logout;
window.addRecord = addRecord;
window.deleteTransaction = deleteTransaction;

