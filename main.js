import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { 
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

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

let records = [];
let filteredRecords = [];

// UI elements
const statusDiv = document.getElementById("status");
const filters = {
  type: document.getElementById("filterType"),
  method: document.getElementById("filterMethod"),
  category: document.getElementById("filterCategory"),
  store: document.getElementById("filterStore"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
};

statusDiv.textContent = "⏳ Свързване с Firestore...";

// Автентикация: следене на статус
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById("auth-container").style.display = "none";
    document.getElementById("app").classList.remove("hidden");
    statusDiv.textContent = "✅ Влязъл: " + user.email;
    loadRecords();
  } else {
    document.getElementById("auth-container").style.display = "block";
    document.getElementById("app").classList.add("hidden");
    statusDiv.textContent = "❌ Не е логнат потребител";
  }
});

// Добавяне на запис
async function addRecord() {
  const date = document.getElementById("date").value;
  const type = document.getElementById("type").value;
  const method = document.getElementById("method").value;
  const amount = parseFloat(document.getElementById("amount").value);
  const note = document.getElementById("note").value || "";

  if (!date || isNaN(amount)) {
    alert("Попълни дата и валидна сума");
    return;
  }

  await addDoc(collection(db, "records"), {
    date,
    type,
    method,
    amount,
    note,
    createdAt: new Date().toISOString()
  });

  loadRecords();
  clearForm();
}

// Зареждане на записи
async function loadRecords() {
  records = [];
  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);
  snapshot.forEach(docSnap => records.push({ id: docSnap.id, ...docSnap.data() }));
  renderTable();
}

// Изтриване на запис
async function deleteRecord(id) {
  if (!confirm("Сигурен ли си?")) return;
  await deleteDoc(doc(db, "records", id));
  loadRecords();
}

// Рендер на таблица
function renderTable(data = records) {
  const tbody = document.querySelector("#recordsTable tbody");
  tbody.innerHTML = "";
  if (data.length === 0) {
    tbody.innerHTML = "<tr><td colspan='7'>Няма записи</td></tr>";
    return;
  }
  data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.type}</td>
      <td>${r.amount.toFixed(2)}</td>
      <td>${r.method}</td>
      <td>${r.note}</td>
      <td><button onclick="deleteRecord('${r.id}')">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// Форматиране на формата
function clearForm() {
  document.getElementById("date").value = "";
  document.getElementById("amount").value = "";
  document.getElementById("note").value = "";
}

// Филтриране
function applyFilters() {
  const type = filters.type.value;
  const method = filters.method.value;
  filteredRecords = records.filter(r => {
    return (!type || r.type === type) && (!method || r.method === method);
  });
  renderTable(filteredRecords);
}

// Автентикация – глобални функции
window.register = async function() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("✅ Успешна регистрация!");
  } catch (error) {
    alert("⚠️ Грешка при регистрация: " + error.message);
  }
};

window.login = async function() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("✅ Успешен вход!");
  } catch (error) {
    alert("⚠️ Грешка при вход: " + error.message);
  }
};

window.logout = async function() {
  await signOut(auth);
  alert("🚪 Изход извършен.");
};

window.addRecord = addRecord;
window.deleteRecord = deleteRecord;
window.applyFilters = applyFilters;
window.clearFilters = applyFilters;  // Сега clearFilters просто извиква applyFilters


