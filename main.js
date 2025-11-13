import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { 
  getAuth, onAuthStateChanged, 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
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

// --- LISTEN FOR LOGIN ---
onAuthStateChanged(auth, user => {
  if (user) {
    console.log("Влязъл потребител:", user.uid);
    document.getElementById("auth-container").style.display = "none";
    document.getElementById("app").classList.remove("hidden");

    statusDiv.textContent = "✅ Свързан с Firestore";

    loadRecords();
  } else {
    console.log("Няма логнат потребител.");
    document.getElementById("auth-container").style.display = "block";
    document.getElementById("app").classList.add("hidden");

    statusDiv.textContent = "❌ Неуспешно свързване!";
  }
});


// --- LOAD DATA ---
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

// ---------------------------------------------------------------------------
//  ALL UI FUNCTIONS (unchanged, your code)
// ---------------------------------------------------------------------------
// ……………………… (оставям ги без промяна, за да не пълни тук 2000 реда)
// ---------------------------------------------------------------------------


// --- AUTH FUNCTIONS ---
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
  alert("🚪 Излезе от профила.");
};


