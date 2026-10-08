import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy,
  getDocs, onSnapshot, writeBatch, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- إعدادات ---------- */
const LECTURE_MINUTES = 180; // أقصى مدة لصلاحية QR المحاضرة (ينتهي أيضًا عند الضغط على "إنهاء")
const SCAN_LIB = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- أدوات صغيرة ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = x => String(x ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const toDate = t => (t?.toDate ? t.toDate() : t ? new Date(t) : null);
const fmt = t => { const d = toDate(t); return d ? d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "…"; };
const fmtTime = t => { const d = toDate(t); return d ? d.toLocaleTimeString("ar-EG", { timeStyle: "short" }) : "…"; };
const num = n => Number(n).toLocaleString("ar-EG");
const setMain = html => { $("#main").innerHTML = html; };

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

function errText(e) {
  const map = {
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة",
    "auth/email-already-in-use": "هذا البريد مستخدم بالفعل",
    "auth/weak-password": "كلمة المرور ضعيفة، استخدم 6 أحرف على الأقل",
    "auth/network-request-failed": "لا يوجد اتصال بالإنترنت",
    "auth/too-many-requests": "محاولات كثيرة، حاول مرة أخرى بعد قليل",
    "permission-denied": "لا توجد صلاحية لهذه العملية. تأكد من نشر ملف firestore.rules الجديد"
  };
  return map[e?.code] || e?.message || "حدث خطأ غير متوقع";
}

function openModal(html) {
  const m = $("#modal");
  m.innerHTML = html;
  m.classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modal").onclick = closeModal;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ---------- الحالة ---------- */
let user = null;
let profile = null;
let isDoctor = false;
let doctorExists = null; // هل تم إعداد حساب الدكتور؟
let tab = "";
let registering = false;
let unsub = null;       // مستمع الحضور المباشر
let scanner = null;     // ماسح الكاميرا
let authNotice = "";

const clearLive = () => { if (unsub) { unsub(); unsub = null; } };
async function stopScanner() {
  if (!scanner) return;
  const s = scanner;
  scanner = null;
  $("#reader")?.classList.remove("on");
  try { await s.stop(); } catch { /* غير مشغّل */ }
  try { s.clear(); } catch { /* ignore */ }
}

/* ---------- شاشة الدخول والتسجيل ---------- */
function showAuth() {
  $("#loading").classList.add("hidden");
  $("#appView").classList.add("hidden");
  $("#authView").classList.remove("hidden");
}
function showApp() {
  $("#loading").classList.add("hidden");
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function authScreen(mode = "login") {
  const titles = { login: "تسجيل الدخول", register: "حساب طالب جديد", doctor: "إعداد حساب الدكتور" };
  const hints = {
    login: "",
    register: "",
    doctor: "هذه الخطوة تتم مرة واحدة فقط. الحساب الذي ينشأ هنا هو الدكتور الوحيد في النظام."
  };
  const nameField = mode !== "login" ? `<label>الاسم الكامل<input id="fName" autocomplete="name" required></label>` : "";
  const numField = mode === "register" ? `<label>الرقم الجامعي<input id="fNum" inputmode="numeric" required></label>` : "";
  const submitText = mode === "login" ? "دخول" : "إنشاء الحساب";

  let links = "";
  if (mode === "login") {
    links = `<button type="button" class="link" id="forgotBtn">نسيت كلمة المرور؟</button>
             <button type="button" class="secondary full" id="goRegister">حساب طالب جديد</button>
             ${doctorExists === false ? `<button type="button" class="link" id="goDoctor">أنا الدكتور وهذه أول مرة</button>` : ""}`;
  } else {
    links = `<button type="button" class="link" id="goLogin">لدي حساب بالفعل</button>`;
  }

  $("#authCard").innerHTML = `
    <h1>${titles[mode]}</h1>
    ${hints[mode] ? `<p class="muted">${hints[mode]}</p>` : ""}
    <form id="authForm">
      ${nameField}${numField}
      <label>البريد الإلكتروني<input id="fEmail" type="email" autocomplete="email" required></label>
      <label>كلمة المرور<input id="fPass" type="password" minlength="6" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required></label>
      <button class="primary full" id="authSubmit">${submitText}</button>
    </form>
    <div id="authMsg" class="msg" role="alert">${esc(authNotice)}</div>
    ${links}`;
  authNotice = "";

  $("#authForm").onsubmit = e => { e.preventDefault(); submitAuth(mode); };
  if ($("#goRegister")) $("#goRegister").onclick = () => authScreen("register");
  if ($("#goDoctor")) $("#goDoctor").onclick = () => authScreen("doctor");
  if ($("#goLogin")) $("#goLogin").onclick = () => authScreen("login");
  if ($("#forgotBtn")) $("#forgotBtn").onclick = async () => {
    const email = $("#fEmail").value.trim();
    if (!email) { $("#authMsg").textContent = "اكتب بريدك الإلكتروني أولًا"; return; }
    try { await sendPasswordResetEmail(auth, email); $("#authMsg").textContent = "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك"; }
    catch (e) { $("#authMsg").textContent = errText(e); }
  };
}

async function submitAuth(mode) {
  const msg = $("#authMsg"), btn = $("#authSubmit");
  const email = $("#fEmail").value.trim(), pass = $("#fPass").value;
  msg.textContent = "";
  btn.disabled = true;
  try {
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, pass); // onAuthStateChanged يكمل الباقي
      return;
    }
    const name = $("#fName").value.trim();
    if (!name) throw new Error("اكتب الاسم الكامل");

    registering = true; // يمنع المراقب من تسجيل الخروج قبل إنشاء ملف المستخدم
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;
    try {
      if (mode === "doctor") {
        await setDoc(doc(db, "settings", "doctor"), { uid, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", uid), { uid, name, email, role: "doctor", createdAt: serverTimestamp() });
        doctorExists = true;
      } else {
        await setDoc(doc(db, "users", uid), {
          uid, name, email, role: "student",
          studentNumber: $("#fNum").value.trim(),
          createdAt: serverTimestamp()
        });
      }
    } catch (e) {
      await cred.user.delete().catch(() => {});
      if (mode === "doctor" && e.code === "permission-denied") throw new Error("تم إعداد حساب الدكتور بالفعل، سجّل الدخول من الصفحة الرئيسية");
      throw e;
    }
    registering = false;
    await enter(cred.user);
  } catch (e) {
    registering = false;
    msg.textContent = errText(e);
    btn.disabled = false;
  }
}

/* ---------- الدخول للتطبيق ---------- */
onAuthStateChanged(auth, async u => {
  if (registering) return;
  clearLive();
  await stopScanner();
  if (!u) {
    user = null; profile = null; isDoctor = false;
    try {
      doctorExists = (await getDoc(doc(db, "settings", "doctor"))).exists();
    } catch { doctorExists = null; }
    authScreen("login");
    showAuth();
    return;
  }
  try {
    await enter(u);
  } catch (e) {
    console.error(e);
    authNotice = errText(e);
    await signOut(auth);
  }
});

async function enter(u) {
  user = u;
  const [p, d] = await Promise.all([getDoc(doc(db, "users", u.uid)), getDoc(doc(db, "settings", "doctor"))]);
  if (!p.exists()) {
    authNotice = "هذا الحساب غير مكتمل. أنشئ حسابًا جديدًا أو تواصل مع الدكتور.";
    await signOut(auth);
    return;
  }
  profile = p.data();
  doctorExists = d.exists();
  isDoctor = d.exists() && d.data().uid === u.uid;
  $("#userName").textContent = profile.name;
  $("#userRole").textContent = isDoctor ? "دكتور" : "طالب";
  tab = isDoctor ? "live" : "scan";
  showApp();
  buildTabs();
  render();
}

$("#logoutBtn").onclick = () => signOut(auth);

/* ---------- التنقل ---------- */
function buildTabs() {
  const items = isDoctor
    ? [["live", "المحاضرة"], ["lectures", "المحاضرات"], ["students", "الطلاب"]]
    : [["scan", "تسجيل حضور"], ["mine", "حضوري"]];
  $("#tabs").innerHTML = items.map(([k, l]) => `<button data-tab="${k}" ${k === tab ? 'class="active" aria-current="page"' : ""}>${l}</button>`).join("");
  $$("#tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
}

async function go(t) {
  await stopScanner();
  clearLive();
  tab = t;
  buildTabs();
  render();
}

async function render() {
  setMain(`<div class="card muted">جارٍ التحميل...</div>`);
  const views = { live: liveTab, lectures: lecturesTab, students: studentsTab, scan: scanTab, mine: mineTab };
  try {
    await views[tab]();
  } catch (e) {
    console.error(e);
    setMain(`<div class="card"><h2>تعذر تحميل البيانات</h2><p class="muted">${esc(errText(e))}</p><button class="primary" id="retry">إعادة المحاولة</button></div>`);
    $("#retry").onclick = render;
  }
}

/* ---------- QR ---------- */
function qrSvg(text) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), m = 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  const size = n + m * 2;
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="رمز QR للمحاضرة"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* =====================================================
   الدكتور
   ===================================================== */

/* تبويب "المحاضرة": إما محاضرة جارية أو نموذج بدء محاضرة جديدة */
async function liveTab() {
  const snap = await getDocs(query(collection(db, "lectures"), where("status", "==", "active")));
  let active = null;
  for (const d of snap.docs) {
    const expired = toDate(d.data().endAt)?.getTime() <= Date.now();
    if (!expired && !active) active = d;
    else await closeLecture(d.id); // محاضرة منتهية الصلاحية أو مكررة
  }
  if (active) return lectureView(active.id);

  setMain(`
    <form class="card" id="startForm">
      <h1>محاضرة جديدة</h1>
      <p class="muted">عند بدء المحاضرة يُنشأ QR جديد خاص بها، ويتوقف أي QR سابق عن العمل.</p>
      <label>اسم المحاضرة<input id="lecTitle" maxlength="60" placeholder="مثال: المحاضرة 3 - قواعد البيانات"></label>
      <button class="primary big full" id="startBtn">ابدأ المحاضرة وأنشئ QR</button>
    </form>`);
  $("#startForm").onsubmit = async e => {
    e.preventDefault();
    $("#startBtn").disabled = true;
    try { await startLecture($("#lecTitle").value.trim()); }
    catch (err) { toast(errText(err)); $("#startBtn").disabled = false; }
  };
}

async function startLecture(title) {
  const id = doc(collection(db, "lectures")).id;
  const end = Timestamp.fromDate(new Date(Date.now() + LECTURE_MINUTES * 60000));
  const batch = writeBatch(db);
  const old = await getDocs(query(collection(db, "lectures"), where("status", "==", "active")));
  old.forEach(d => {
    batch.update(d.ref, { status: "closed", closedAt: serverTimestamp() });
    batch.set(doc(db, "attendanceSessions", d.id), { active: false }, { merge: true });
  });
  batch.set(doc(db, "lectures", id), {
    title: title || `محاضرة ${new Date().toLocaleDateString("ar-EG")}`,
    doctorId: user.uid,
    startAt: serverTimestamp(),
    endAt: end,
    status: "active",
    createdAt: serverTimestamp()
  });
  batch.set(doc(db, "attendanceSessions", id), {
    lectureId: id,
    doctorId: user.uid,
    token: crypto.randomUUID(),
    active: true,
    expiresAt: end
  });
  await batch.commit();
  lectureView(id);
}

async function closeLecture(id) {
  const batch = writeBatch(db);
  batch.update(doc(db, "lectures", id), { status: "closed", closedAt: serverTimestamp() });
  batch.set(doc(db, "attendanceSessions", id), { active: false }, { merge: true });
  await batch.commit();
}

/* شاشة المحاضرة: QR (إن كانت جارية) + قائمة الحضور المباشرة */
async function lectureView(id) {
  clearLive();
  const [l, s] = await Promise.all([getDoc(doc(db, "lectures", id)), getDoc(doc(db, "attendanceSessions", id))]);
  if (!l.exists()) { toast("المحاضرة غير موجودة"); return go(tab); }
  const lec = l.data(), ses = s.exists() ? s.data() : null;
  const open = lec.status === "active" && ses?.active === true && toDate(ses.expiresAt).getTime() > Date.now();
  const payload = open ? JSON.stringify({ l: id, t: ses.token, n: String(lec.title).slice(0, 60) }) : "";
  const svg = open ? qrSvg(payload) : "";

  setMain(`
    ${tab === "lectures" ? `<button class="link back" id="backBtn">رجوع إلى المحاضرات</button>` : ""}
    <section class="card">
      <div class="lec-head">
        <div><h1>${esc(lec.title)}</h1><p class="muted">${fmt(lec.startAt)}</p></div>
        <span class="badge ${open ? "ok" : ""}">${open ? "جارية" : "منتهية"}</span>
      </div>
      ${open ? `
        <div class="qr-tile" id="qrTile">${svg}</div>
        <p class="muted center">اعرض الـ QR على الشاشة ليمسحه الطلاب من تبويب "تسجيل حضور".</p>
        <div class="row">
          <button class="secondary" id="zoomBtn">تكبير الـ QR</button>
          <button class="danger" id="endBtn">إنهاء المحاضرة</button>
        </div>` : (tab === "live" ? `<div class="row"><button class="primary" id="newBtn">محاضرة جديدة</button></div>` : "")}
    </section>
    <section class="card">
      <div class="count-row"><strong id="cnt">٠</strong><span>طالب سجّلوا حضورهم</span></div>
      <ul id="attList" class="att"></ul>
      <button class="secondary full" id="csvBtn">تنزيل الحضور (Excel / CSV)</button>
    </section>`);

  if ($("#backBtn")) $("#backBtn").onclick = () => go("lectures");
  if ($("#newBtn")) $("#newBtn").onclick = () => go("live");
  if ($("#zoomBtn")) $("#zoomBtn").onclick = () => openModal(`<div class="zoom">${svg}<p>${esc(lec.title)}</p></div>`);
  if ($("#endBtn")) $("#endBtn").onclick = async () => {
    if (!confirm("إنهاء المحاضرة؟ لن يستطيع أحد تسجيل الحضور بعد ذلك.")) return;
    try { await closeLecture(id); lectureView(id); } catch (e) { toast(errText(e)); }
  };

  let rows = [];
  unsub = onSnapshot(query(collection(db, "attendance"), where("lectureId", "==", id)), snap => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (toDate(b.createdAt) || new Date()).getTime() - (toDate(a.createdAt) || new Date()).getTime());
    $("#cnt").textContent = num(rows.length);
    $("#attList").innerHTML = rows.map(r => `
      <li>
        <div><b>${esc(r.studentName)}</b><small>${esc(r.studentNumber)}</small></div>
        <time>${fmtTime(r.createdAt)}</time>
        <button class="icon-btn" data-del="${esc(r.id)}" aria-label="حذف هذا التسجيل">×</button>
      </li>`).join("") || `<li class="empty">لم يسجّل أحد حتى الآن</li>`;
    $$("[data-del]").forEach(b => b.onclick = async () => {
      if (confirm("حذف تسجيل الحضور هذا؟")) { try { await deleteDoc(doc(db, "attendance", b.dataset.del)); } catch (e) { toast(errText(e)); } }
    });
  }, e => toast(errText(e)));

  $("#csvBtn").onclick = () => downloadCsv(lec, rows);
}

function downloadCsv(lec, rows) {
  if (!rows.length) { toast("لا يوجد حضور لتنزيله"); return; }
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["الاسم", "الرقم الجامعي", "وقت الحضور"].map(q).join(",")]
    .concat(rows.map(r => [r.studentName, r.studentNumber, fmt(r.createdAt)].map(q).join(",")));
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `حضور - ${String(lec.title).replace(/[\\/:*?"<>|]/g, " ")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* تبويب "المحاضرات": سجل المحاضرات السابقة */
async function lecturesTab() {
  const [ls, as] = await Promise.all([
    getDocs(query(collection(db, "lectures"), orderBy("createdAt", "desc"))),
    getDocs(collection(db, "attendance"))
  ]);
  const counts = {};
  as.forEach(d => { const k = d.data().lectureId; counts[k] = (counts[k] || 0) + 1; });

  setMain(`
    <h1>المحاضرات</h1>
    <div class="list">
      ${ls.docs.map(d => {
        const z = d.data();
        const open = z.status === "active" && toDate(z.endAt)?.getTime() > Date.now();
        return `<button class="item" data-id="${d.id}">
          <div><b>${esc(z.title)}</b><small>${fmt(z.startAt)}</small></div>
          <div class="item-end"><span>${num(counts[d.id] || 0)} حاضر</span><span class="badge ${open ? "ok" : ""}">${open ? "جارية" : "منتهية"}</span></div>
        </button>`;
      }).join("") || `<div class="card muted">لا توجد محاضرات بعد. ابدأ أول محاضرة من تبويب "المحاضرة".</div>`}
    </div>`);
  $$(".item").forEach(b => b.onclick = () => lectureView(b.dataset.id));
}

/* تبويب "الطلاب": الطلاب المسجلون ونسبة حضورهم */
async function studentsTab() {
  const [us, as, ls] = await Promise.all([
    getDocs(query(collection(db, "users"), where("role", "==", "student"))),
    getDocs(collection(db, "attendance")),
    getDocs(collection(db, "lectures"))
  ]);
  const total = ls.size, counts = {};
  as.forEach(d => { const k = d.data().studentId; counts[k] = (counts[k] || 0) + 1; });
  const students = us.docs.map(d => d.data()).sort((a, b) => a.name.localeCompare(b.name, "ar"));

  setMain(`
    <h1>الطلاب <small class="muted">(${num(students.length)})</small></h1>
    <input id="search" class="search" type="search" placeholder="ابحث بالاسم أو الرقم الجامعي">
    <div class="card table-wrap"><table class="table">
      <thead><tr><th>الاسم</th><th>الرقم الجامعي</th><th>الحضور</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`);
  const draw = () => {
    const k = $("#search").value.trim().toLowerCase();
    const list = students.filter(s => `${s.name} ${s.studentNumber || ""}`.toLowerCase().includes(k));
    $("#rows").innerHTML = list.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.studentNumber)}</td><td>${num(counts[s.uid] || 0)} من ${num(total)}</td></tr>`).join("")
      || `<tr><td colspan="3" class="empty">لا يوجد طلاب</td></tr>`;
  };
  $("#search").oninput = draw;
  draw();
}

/* =====================================================
   الطالب
   ===================================================== */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("تعذر تحميل مكتبة الكاميرا، تحقق من الاتصال"));
    document.head.appendChild(s);
  });
}

async function scanTab() {
  setMain(`
    <section class="card center">
      <h1>تسجيل الحضور</h1>
      <p class="muted">افتح الكاميرا وامسح الـ QR المعروض على شاشة الدكتور.</p>
      <div id="reader"></div>
      <div id="scanResult"></div>
      <button class="primary big full" id="openCam">فتح الكاميرا</button>
    </section>`);
  $("#openCam").onclick = startScan;
}

let scanBusy = false;
async function startScan() {
  const btn = $("#openCam"), box = $("#scanResult");
  btn.classList.add("hidden");
  box.innerHTML = "";
  try {
    await loadScript(SCAN_LIB);
    $("#reader").classList.add("on");
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    scanner = new Html5Qrcode("reader");
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, onDecoded, () => {});
  } catch (e) {
    await stopScanner();
    box.innerHTML = `<div class="result bad">${esc(e.message?.includes("مكتبة") ? e.message : "تعذر تشغيل الكاميرا. اسمح للموقع باستخدام الكاميرا وتأكد أنه يعمل عبر HTTPS.")}</div>`;
    btn.textContent = "إعادة المحاولة";
    btn.classList.remove("hidden");
  }
}

async function onDecoded(text) {
  if (scanBusy) return;
  scanBusy = true;
  await stopScanner();
  let html;
  try {
    const title = await markAttendance(text);
    html = `<div class="result ok"><b>تم تسجيل حضورك</b>${title ? `<span>${esc(title)}</span>` : ""}</div>`;
  } catch (e) {
    html = `<div class="result bad">${esc(e.message)}</div>`;
  }
  scanBusy = false;
  const box = $("#scanResult"), btn = $("#openCam");
  if (!box) return; // غادر الطالب الصفحة
  box.innerHTML = html;
  btn.textContent = "مسح QR آخر";
  btn.classList.remove("hidden");
}

async function markAttendance(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("هذا ليس QR خاصًا بمحاضرة"); }
  if (!data?.l || !data?.t) throw new Error("هذا ليس QR خاصًا بمحاضرة");

  const ref = doc(db, "attendance", `${data.l}_${user.uid}`);
  if ((await getDoc(ref)).exists()) throw new Error("تم تسجيل حضورك في هذه المحاضرة من قبل");
  try {
    await setDoc(ref, {
      lectureId: data.l,
      token: data.t,
      studentId: user.uid,
      studentName: profile.name,
      studentNumber: profile.studentNumber || "",
      lectureTitle: String(data.n || "").slice(0, 60),
      status: "present",
      createdAt: serverTimestamp()
    });
  } catch (e) {
    if (e.code === "permission-denied") throw new Error("هذا الـ QR غير صالح أو انتهت المحاضرة. اطلب من الدكتور QR الحالي.");
    throw e;
  }
  return data.n;
}

async function mineTab() {
  const snap = await getDocs(query(collection(db, "attendance"), where("studentId", "==", user.uid)));
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  setMain(`
    <section class="card count-card"><strong>${num(rows.length)}</strong><span>محاضرة حضرتها</span></section>
    <div class="list">
      ${rows.map(r => `<div class="item static"><div><b>${esc(r.lectureTitle || "محاضرة")}</b><small>${fmt(r.createdAt)}</small></div><span class="badge ok">حاضر</span></div>`).join("")
        || `<div class="card muted">لا توجد سجلات بعد. امسح QR المحاضرة من تبويب "تسجيل حضور".</div>`}
    </div>`);
}
