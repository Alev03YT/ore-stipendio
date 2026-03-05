import jsPDF from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";

// Chart
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";

// Firebase
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

// ✅ Logo azienda (mettilo in: src/assets/logo-apostolo.png)
import logoUrl from "./assets/logo-apostolo.png";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

/** ✅ tua config Firebase */
const firebaseConfig = {
  apiKey: "AIzaSyBNmY-VtIBYjN3rCIrWWrGlLVgIN9F7d2U",
  authDomain: "ore-stipendio-app.firebaseapp.com",
  projectId: "ore-stipendio-app",
  storageBucket: "ore-stipendio-app.firebasestorage.app",
  messagingSenderId: "548034617256",
  appId: "1:548034617256:web:7b7316cc553c8a7b32c79d",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

/* ---------- Mini UI (zero librerie) ---------- */
function Button({ onClick, children, variant = "default", disabled, title }) {
  const base = {
    height: 42,
    borderRadius: 14,
    padding: "0 14px",
    fontWeight: 800,
    border: "1px solid rgba(0,0,0,0.10)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    whiteSpace: "nowrap",
  };
  const style =
    variant === "secondary"
      ? { ...base, background: "rgba(255,255,255,0.85)" }
      : variant === "ghost"
      ? { ...base, background: "transparent", border: "1px solid transparent" }
      : variant === "danger"
      ? { ...base, background: "#b00020", color: "white", border: "1px solid #b00020" }
      : { ...base, background: "#111", color: "white", border: "1px solid #111" };

  return (
    <button title={title} onClick={disabled ? undefined : onClick} style={style}>
      {children}
    </button>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        height: 42,
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.12)",
        padding: "0 12px",
        background: "rgba(255,255,255,0.92)",
        outline: "none",
      }}
    />
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        borderRadius: 18,
        background: "rgba(255,255,255,0.75)",
        border: "1px solid rgba(0,0,0,0.06)",
        padding: 14,
      }}
    >
      {children}
    </div>
  );
}

/* ---------- Helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const pad2 = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function formatDateIT(iso) {
  if (!iso) return "";
  const giorni = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  const [y, m, d] = iso.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  const giorno = giorni[dt.getDay()];
  return `${giorno} ${d}/${m}/${y}`;
}

const parseTimeToMinutes = (hhmm) => {
  const [h, m] = (hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};
const diffMinutes = (startHHMM, endHHMM) => {
  const s = parseTimeToMinutes(startHHMM);
  const e = parseTimeToMinutes(endHHMM);
  if (s == null || e == null) return 0;
  return e >= s ? e - s : 24 * 60 - s + e;
};
const minutesToHours = (min) => min / 60;
const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");
const monthKey = (iso) => iso.slice(0, 7);

const mondayOfWeek = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00`);
  const day = d.getDay(); // 0 dom .. 6 sab
  const diff = (day === 0 ? -6 : 1) - day; // lunedì
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const weekKey = (isoDate) => mondayOfWeek(isoDate);

/* Straordinari settimanali: oltre soglia * moltiplicatore */
function computeWeeklyPay(entries, jobsById, settings) {
  const { overtimeThresholdHours, overtimeMultiplier } = settings;

  const blocks = [];
  for (const e of entries) {
    for (let bi = 0; bi < (e.blocks || []).length; bi++) {
      const b = e.blocks[bi];
      if (!b?.start || !b?.end) continue;
      const minutes = diffMinutes(b.start, b.end);
      if (minutes <= 0) continue;

      const rate = Number(jobsById[e.jobId]?.rate || 0);

      blocks.push({
        entryId: e.id,
        blockIndex: bi,
        date: e.date,
        start: b.start,
        minutes,
        rate,
        wk: weekKey(e.date),
      });
    }
  }

  blocks.sort((a, b) => {
    if (a.wk !== b.wk) return a.wk.localeCompare(b.wk);
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (parseTimeToMinutes(a.start) ?? 0) - (parseTimeToMinutes(b.start) ?? 0);
  });

  const byWeek = new Map();
  for (const bl of blocks) {
    const arr = byWeek.get(bl.wk) || [];
    arr.push(bl);
    byWeek.set(bl.wk, arr);
  }

  const payByEntry = new Map();
  const hoursByEntry = new Map();

  for (const [, arr] of byWeek.entries()) {
    const totalMin = arr.reduce((s, x) => s + x.minutes, 0);
    const totalHours = minutesToHours(totalMin);

    const overtimeHours = Math.max(0, totalHours - overtimeThresholdHours);
    let overtimeMinLeft = Math.round(overtimeHours * 60);

    const otMinByBlock = new Map();
    for (let i = arr.length - 1; i >= 0 && overtimeMinLeft > 0; i--) {
      const bl = arr[i];
      const take = Math.min(bl.minutes, overtimeMinLeft);
      overtimeMinLeft -= take;
      otMinByBlock.set(`${bl.entryId}:${bl.blockIndex}`, take);
    }

    for (const bl of arr) {
      const key = `${bl.entryId}:${bl.blockIndex}`;
      const otMin = otMinByBlock.get(key) || 0;
      const regMin = bl.minutes - otMin;

      const regPay = minutesToHours(regMin) * bl.rate;
      const otPay = minutesToHours(otMin) * bl.rate * overtimeMultiplier;

      const pay = regPay + otPay;
      const hrs = minutesToHours(bl.minutes);

      payByEntry.set(bl.entryId, (payByEntry.get(bl.entryId) || 0) + pay);
      hoursByEntry.set(bl.entryId, (hoursByEntry.get(bl.entryId) || 0) + hrs);
    }
  }

  return { payByEntry, hoursByEntry };
}

/* ---------- i18n ---------- */
const I18N = {
  it: {
    appName: "Ore & Stipendio",
    today: "Oggi",
    log: "Registro",
    jobs: "Lavori",
    settings: "Impostazioni",
    signIn: "Accedi con Google",
    signOut: "Esci",
    cloud: "Cloud",
    synced: "Sincronizzato",
    local: "Solo locale",
    date: "Data",
    job: "Lavoro",
    times: "Orari",
    from: "Da",
    to: "A",
    addBlock: "Aggiungi blocco",
    saveDay: "Salva giornata",
    notes: "Note",
    delete: "Elimina",
    monthHours: "Ore mese",
    monthPay: "Paga mese",
    projection: "Proiezione",
    overtime: "Straordinari",
    threshold: "Soglia settimanale (ore)",
    multiplier: "Maggiorazione (x)",
    newJob: "Nuovo lavoro",
    name: "Nome",
    rate: "€ / h",
    add: "Aggiungi",
    invalid: "Controlla orari e campi.",
    empty: "Nessun dato ancora.",
    tip: "Suggerimento: aggiungi alla Home per usarla come app.",
    noDataMonth: "Nessun dato per questo mese.",
    eurosPerDay: "€ per giorno",
    edit: "Modifica",

    reportMonth: "Mese",
    pdfHours: "PDF Ore",
  },
  en: {
    appName: "Hours & Pay",
    today: "Today",
    log: "Log",
    jobs: "Jobs",
    settings: "Settings",
    signIn: "Sign in with Google",
    signOut: "Sign out",
    cloud: "Cloud",
    synced: "Synced",
    local: "Local only",
    date: "Date",
    job: "Job",
    times: "Times",
    from: "From",
    to: "To",
    addBlock: "Add block",
    saveDay: "Save day",
    notes: "Notes",
    delete: "Delete",
    monthHours: "Month hours",
    monthPay: "Month pay",
    projection: "Projection",
    overtime: "Overtime",
    threshold: "Weekly threshold (hours)",
    multiplier: "Multiplier (x)",
    newJob: "New job",
    name: "Name",
    rate: "€ / h",
    add: "Add",
    invalid: "Check times and fields.",
    empty: "No data yet.",
    tip: "Tip: add to Home Screen to use it like an app.",
    noDataMonth: "No data for this month.",
    eurosPerDay: "€ per day",
    edit: "Edit",

    reportMonth: "Month",
    pdfHours: "Hours PDF",
  },
};

/* ✅ azienda */
const COMPANY_NAME = "Apicoltura Apostolo";

/* Converte un'immagine (importata da Vite/React) in dataURL per jsPDF */
function loadImageToDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function App() {
  const [tab, setTab] = useState("today");
  const [lang, setLang] = useState("it");
  const t = I18N[lang];

  const [user, setUser] = useState(null);
  const [cloudStatus, setCloudStatus] = useState("local"); // local | syncing | synced

  // ✅ default “sensato”
  const [jobs, setJobs] = useState([{ id: "default", name: "Lavoro", rate: 10 }]);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState({ overtimeThresholdHours: 40, overtimeMultiplier: 1.25 });

  const [draft, setDraft] = useState({
    date: todayISO(),
    jobId: "default",
    blocks: [{ start: "", end: "" }],
    notes: "",
  });

  const [active, setActive] = useState(null); // {blockIndex, startedAt}
  const timerRef = useRef(null);
  const [, forceTick] = useState(0);

  /* ---------- Local backup ---------- */
  const LOCAL_KEY = "ore_stipendio_repo_v2";
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (data.lang) setLang(data.lang);
      if (Array.isArray(data.jobs) && data.jobs.length) setJobs(data.jobs);
      if (Array.isArray(data.entries)) setEntries(data.entries);
      if (data.settings) setSettings(data.settings);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ lang, jobs, entries, settings }));
    } catch {}
  }, [lang, jobs, entries, settings]);

  /* ---------- Cloud ref ---------- */
  const cloudDocRef = useMemo(() => {
    if (!user?.uid) return null;
    return doc(db, "users", user.uid, "appdata", "main");
  }, [user]);

  /* ---------- Auth + load ---------- */
  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      if (!u) {
        setCloudStatus("local");
        return;
      }
      try {
        setCloudStatus("syncing");
        const ref = doc(db, "users", u.uid, "appdata", "main");
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          if (data.lang) setLang(data.lang);
          if (Array.isArray(data.jobs) && data.jobs.length) setJobs(data.jobs);
          if (Array.isArray(data.entries)) setEntries(data.entries);
          if (data.settings) setSettings(data.settings);
        } else {
          await setDoc(ref, { lang, jobs, entries, settings, updatedAt: serverTimestamp() }, { merge: true });
        }
        setCloudStatus("synced");
      } catch {
        setCloudStatus("local");
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Debounced save ---------- */
  const saveDebounce = useRef(null);
  useEffect(() => {
    if (!cloudDocRef) return;
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(async () => {
      try {
        setCloudStatus("syncing");
        await setDoc(cloudDocRef, { lang, jobs, entries, settings, updatedAt: serverTimestamp() }, { merge: true });
        setCloudStatus("synced");
      } catch {
        setCloudStatus("local");
      }
    }, 600);
    return () => saveDebounce.current && clearTimeout(saveDebounce.current);
  }, [cloudDocRef, lang, jobs, entries, settings]);

  /* ---------- Timer tick ---------- */
  useEffect(() => {
    if (!active) return;
    timerRef.current = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [active]);

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);

  const computed = useMemo(() => computeWeeklyPay(entries, jobsById, settings), [entries, jobsById, settings]);

  const entriesWithComputed = useMemo(() => {
    return (entries || [])
      .map((e) => ({
        ...e,
        hours: computed.hoursByEntry.get(e.id) || 0,
        pay: computed.payByEntry.get(e.id) || 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, computed]);

  const currentMonth = todayISO().slice(0, 7);

  // ✅ mesi disponibili
  const monthsAvailable = useMemo(() => {
    const set = new Set((entries || []).map((e) => (e.date || "").slice(0, 7)).filter(Boolean));
    set.add(currentMonth);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [entries, currentMonth]);

  // ✅ mese selezionato per PDF
  const [reportMonth, setReportMonth] = useState(currentMonth);

  // Totali mese corrente (app)
  const monthTotals = useMemo(() => {
    const list = entriesWithComputed.filter((e) => monthKey(e.date) === currentMonth);
    const hours = list.reduce((s, e) => s + e.hours, 0);
    const pay = list.reduce((s, e) => s + e.pay, 0);

    const workedDays = new Set(list.map((e) => e.date)).size;
    const avgPerDay = workedDays ? pay / workedDays : 0;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const last = new Date(year, month + 1, 0).getDate();

    let remainingWeekdays = 0;
    for (let d = now.getDate() + 1; d <= last; d++) {
      const dd = new Date(year, month, d);
      const wd = dd.getDay();
      if (wd !== 0 && wd !== 6) remainingWeekdays++;
    }

    const projection = pay + avgPerDay * remainingWeekdays;
    return { hours, pay, projection };
  }, [entriesWithComputed, currentMonth]);

  // Totale ore per PDF (mese selezionato)
  const reportTotals = useMemo(() => {
    const list = entriesWithComputed.filter((e) => monthKey(e.date) === reportMonth);
    const hours = list.reduce((s, e) => s + e.hours, 0);
    return { hours };
  }, [entriesWithComputed, reportMonth]);

  const dailyData = useMemo(() => {
    const days = {};
    entriesWithComputed.forEach((e) => {
      if (monthKey(e.date) === currentMonth) {
        days[e.date] = (days[e.date] || 0) + e.pay;
      }
    });
    const labels = Object.keys(days).sort();
    const values = labels.map((d) => days[d]);
    return {
      labels,
      datasets: [{ label: t.eurosPerDay, data: values }],
    };
  }, [entriesWithComputed, currentMonth, t.eurosPerDay]);

  /* ---------- PDF ORE (PRO, logo, niente €, senza colonna lavoro) ---------- */
  const exportPDFHours = async () => {
    const docPdf = new jsPDF({ unit: "mm", format: "a4" });

    const pageW = docPdf.internal.pageSize.getWidth(); // 210
    const pageH = docPdf.internal.pageSize.getHeight(); // 297
    const margin = 12;
    const left = margin;
    const right = pageW - margin;
    const top = margin;
    const bottom = pageH - margin;

    const headerH = 30;
    const footerH = 14;
    // ✅ più spazio: niente sovrapposizioni con titolo / meta
    const contentTop = top + headerH + 18;
    const contentBottom = bottom - footerH;

    const title = lang === "it" ? "RIEPILOGO ORE MENSILE" : "MONTHLY HOURS REPORT";
    const employeeLabel = lang === "it" ? "Dipendente" : "Employee";
    const monthLabel = lang === "it" ? "Mese" : "Month";
    const totalLabel = lang === "it" ? "Totale ore" : "Total hours";
    const printedLabel = lang === "it" ? "Stampato il" : "Printed on";
    const signEmp = lang === "it" ? "Firma dipendente" : "Employee signature";
    const signBoss = lang === "it" ? "Firma responsabile" : "Manager signature";
    const bottomTotalLabel = lang === "it" ? "Totale ore lavorate nel mese" : "Total hours worked in month";
    const oreLabel = lang === "it" ? "Ore" : "Hours";

    const monthRows = entriesWithComputed
      .filter((e) => monthKey(e.date) === reportMonth)
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalHours = reportTotals?.hours ?? monthRows.reduce((s, e) => s + (e.hours || 0), 0);

    const now = new Date();
    const printedAtStr = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;

    const employeeName = user?.email ? user.email : (lang === "it" ? "Non loggato" : "Not logged in");

    const line = (x1, y1, x2, y2) => docPdf.line(x1, y1, x2, y2);

    const trunc = (txt, maxW) => {
      const s = String(txt ?? "");
      if (docPdf.getTextWidth(s) <= maxW) return s;
      let out = s;
      while (out.length && docPdf.getTextWidth(out + "…") > maxW) out = out.slice(0, -1);
      return out ? out + "…" : "";
    };

    const wrap = (txt, maxW) => docPdf.splitTextToSize(String(txt ?? ""), maxW);

    const formatTimes = (e) => {
      const blocks = (e.blocks || []).filter((b) => b?.start && b?.end);
      if (!blocks.length) return "—";
      return blocks.map((b) => `${b.start} - ${b.end}`).join("\n");
    };

    // Table layout (PDF) -> Data | Orari | Ore
    const gap = 2;
    const colDateW = 46; // più largo perché "Lun 16/02/2026"
    const colHoursW = 22;
    const colTimesW = (right - left) - colDateW - colHoursW - gap * 2;

    const xDate = left;
    const xTimes = xDate + colDateW + gap;
    const xHours = xTimes + colTimesW + gap;

    // Anti-sballo: passo righe
    const LINE_STEP = 5;

    // Pagination pre-pass
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(9);

    const rowHeights = monthRows.map((e) => {
      const timesLines = wrap(formatTimes(e), colTimesW);
      const linesCount = Math.max(timesLines.length, 1);
      return 6 + (linesCount - 1) * LINE_STEP;
    });

    const tableHeaderH = 12;
    const usableH = (contentBottom - contentTop) - tableHeaderH;

    let totalPages = 1;
    let used = 0;
    for (const h of rowHeights) {
      if (used + h > usableH) {
        totalPages += 1;
        used = 0;
      }
      used += h;
    }

    // Logo
    let logoDataUrl = null;
    try {
      logoDataUrl = await loadImageToDataUrl(logoUrl);
    } catch {
      logoDataUrl = null;
    }

    const drawHeader = (pageNo) => {
      docPdf.setFillColor(245, 246, 248);
      docPdf.rect(0, 0, pageW, headerH + top, "F");

      const logoSize = 16;
      if (logoDataUrl) docPdf.addImage(logoDataUrl, "PNG", left, top + 6, logoSize, logoSize);

      const textX = left + (logoDataUrl ? logoSize + 6 : 0);

      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(13);
      docPdf.setTextColor(25);
      docPdf.text(COMPANY_NAME, textX, top + 11);

      docPdf.setFontSize(15);
      docPdf.text(title, textX, top + 19);

      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(10);
      docPdf.setTextColor(60);
      docPdf.text(`${monthLabel}: ${reportMonth}`, left, top + 27);
      docPdf.text(`${employeeLabel}: ${employeeName}`, left, top + 32);

      const boxW = 58;
      const boxH = 16;
      const boxX = right - boxW;
      const boxY = top + 15;

      docPdf.setFillColor(255, 255, 255);
      docPdf.setDrawColor(140);
      docPdf.roundedRect(boxX, boxY, boxW, boxH, 2, 2, "FD");

      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(9);
      docPdf.setTextColor(70);
      docPdf.text(totalLabel, boxX + 4, boxY + 5);

      docPdf.setFontSize(14);
      docPdf.setTextColor(20);
      docPdf.text(`${fmt2(totalHours)} h`, boxX + 4, boxY + 12);

      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(9);
      docPdf.setTextColor(90);
      const pageStr = `${pageNo}/${totalPages}`;
      docPdf.text(pageStr, right - docPdf.getTextWidth(pageStr), top + 9);

      docPdf.setDrawColor(210);
      line(left, contentTop - 3, right, contentTop - 3);
    };

    const drawFooter = (pageNo) => {
      const y = pageH - margin;
      docPdf.setDrawColor(210);
      line(left, y - 8, right, y - 8);

      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(9);
      docPdf.setTextColor(90);

      docPdf.text(`${printedLabel}: ${printedAtStr}`, left, y - 3);

      const pageStr = `${pageNo}/${totalPages}`;
      docPdf.text(pageStr, right - docPdf.getTextWidth(pageStr), y - 3);
    };

    const drawTableHeader = (y) => {
      docPdf.setFillColor(235, 235, 235);
      docPdf.rect(left, y - 6, right - left, 9, "F");

      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(10);
      docPdf.setTextColor(20);

      docPdf.text(lang === "it" ? "Data" : "Date", xDate + 1, y);
      docPdf.text(lang === "it" ? "Orari" : "Times", xTimes + 1, y);

      docPdf.text(oreLabel, xHours + colHoursW - docPdf.getTextWidth(oreLabel) - 1, y);

      docPdf.setDrawColor(200);
      line(left, y + 2.5, right, y + 2.5);

      return y + 8;
    };

    // Render
    let pageNo = 1;
    let y = contentTop;

    drawHeader(pageNo);
    y = drawTableHeader(y);

    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(9);
    docPdf.setTextColor(25);

    let rowIndex = 0;

    for (let i = 0; i < monthRows.length; i++) {
      const e = monthRows[i];

      const dateTxt = formatDateIT(e.date) || "—";
      const timesTxt = formatTimes(e);
      const hoursTxt = fmt2(e.hours);

      const timesLines = wrap(timesTxt, colTimesW);
      const linesCount = Math.max(timesLines.length, 1);
      const rowH = 6 + (linesCount - 1) * LINE_STEP;

      if (y + rowH > contentBottom) {
        drawFooter(pageNo);
        docPdf.addPage();
        pageNo += 1;

        y = contentTop;
        drawHeader(pageNo);
        y = drawTableHeader(y);

        docPdf.setFont("helvetica", "normal");
        docPdf.setFontSize(9);
        docPdf.setTextColor(25);
      }

      if (rowIndex % 2 === 0) {
        docPdf.setFillColor(252, 252, 252);
        docPdf.rect(left, y - 5, right - left, rowH, "F");
      }

      docPdf.text(trunc(dateTxt, colDateW), xDate + 1, y);

      for (let li = 0; li < timesLines.length; li++) {
        docPdf.text(trunc(timesLines[li], colTimesW), xTimes + 1, y + li * LINE_STEP);
      }

      docPdf.text(hoursTxt, xHours + colHoursW - docPdf.getTextWidth(hoursTxt) - 1, y);

      docPdf.setDrawColor(235);
      line(left, y + rowH - 1.5, right, y + rowH - 1.5);

      y += rowH;
      rowIndex += 1;
    }

    // ✅ Totale ore in fondo + firme
    const totalAndSignH = 42;
    if (y + totalAndSignH > contentBottom) {
      drawFooter(pageNo);
      docPdf.addPage();
      pageNo += 1;
      totalPages = Math.max(totalPages, pageNo);

      y = contentTop;
      drawHeader(pageNo);
      y = drawTableHeader(y);
    }

    y += 6;

    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(11);
    docPdf.setTextColor(20);
    docPdf.text(`${bottomTotalLabel}: ${fmt2(totalHours)} h`, left, y);

    y += 6;
    docPdf.setDrawColor(180);
    line(left, y, right, y);

    y += 8;

    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(10);
    docPdf.setTextColor(30);

    const boxW = (right - left - 8) / 2;
    const boxH = 18;

    docPdf.text(signEmp + ":", left, y);
    docPdf.text(signBoss + ":", left + boxW + 8, y);

    docPdf.setDrawColor(140);
    docPdf.setFillColor(255, 255, 255);
    docPdf.roundedRect(left, y + 2, boxW, boxH, 2, 2, "D");
    docPdf.roundedRect(left + boxW + 8, y + 2, boxW, boxH, 2, 2, "D");

    drawFooter(pageNo);

    docPdf.save(`ore_${reportMonth}.pdf`);
  };

  /* ---------- Auth buttons ---------- */
  const loginGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch {
      await signInWithRedirect(auth, provider);
    }
  };
  const logout = async () => {
    try {
      await signOut(auth);
    } catch {}
  };

  /* ---------- Draft helpers ---------- */
  const addBlock = () => setDraft((d) => ({ ...d, blocks: [...d.blocks, { start: "", end: "" }] }));
  const updateBlock = (i, key, val) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b, idx) => (idx === i ? { ...b, [key]: val } : b)) }));

  const startTimer = () => {
    if (active) return;
    const now = new Date();
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    setDraft((d) => {
      const blocks = [...d.blocks];
      let bi = blocks.findIndex((b) => !b.start || (b.start && b.end));
      if (bi === -1) {
        blocks.push({ start: "", end: "" });
        bi = blocks.length - 1;
      }
      blocks[bi] = { start: hhmm, end: "" };
      setActive({ blockIndex: bi, startedAt: now });
      return { ...d, blocks };
    });
  };
  const stopTimer = () => {
    if (!active) return;
    const now = new Date();
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    setDraft((d) => {
      const blocks = [...d.blocks];
      const bi = active.blockIndex;
      if (blocks[bi]) blocks[bi] = { ...blocks[bi], end: hhmm };
      return { ...d, blocks };
    });
    setActive(null);
  };

  const saveDay = () => {
    const blocks = draft.blocks
      .map((b) => ({ start: (b.start || "").trim(), end: (b.end || "").trim() }))
      .filter((b) => b.start || b.end);

    if (!draft.date || !draft.jobId || blocks.length === 0) return alert(t.invalid);
    for (const b of blocks) {
      if (!b.start || !b.end || diffMinutes(b.start, b.end) <= 0) return alert(t.invalid);
    }

    const entry = { id: uid(), date: draft.date, jobId: draft.jobId, blocks, notes: draft.notes || "" };
    setEntries((prev) => [entry, ...prev]);
    setDraft({ date: todayISO(), jobId: draft.jobId, blocks: [{ start: "", end: "" }], notes: "" });
  };

  const deleteEntry = (id) => setEntries((prev) => prev.filter((e) => e.id !== id));

  /* ---------- Jobs CRUD ---------- */
  const [newJob, setNewJob] = useState({ name: "", rate: "" });

  const addJob = () => {
    const name = (newJob.name || "").trim();
    const rate = Number(newJob.rate);
    if (!name || !Number.isFinite(rate) || rate <= 0) return;
    const id = uid();
    setJobs((prev) => [...prev, { id, name, rate }]);
    setNewJob({ name: "", rate: "" });
    setDraft((d) => ({ ...d, jobId: id }));
    setTab("today");
  };

  const updateJob = (id, patch) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  };

  const deleteJob = (id) => {
    if (id === "default") return;
    const used = entries.some((e) => e.jobId === id);
    if (used) {
      const ok = window.confirm(
        lang === "it"
          ? "Questo lavoro è usato in alcune giornate. Vuoi eliminarlo lo stesso?"
          : "This job is used in some entries. Delete anyway?"
      );
      if (!ok) return;
    }
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setDraft((d) => ({ ...d, jobId: d.jobId === id ? "default" : d.jobId }));
  };

  /* ---------- UI helpers ---------- */
  const statusLabel = cloudStatus === "synced" ? t.synced : t.local;
  const live = (() => {
    if (!active) return null;
    const s = Math.floor((Date.now() - active.startedAt.getTime()) / 1000);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  })();

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    }),
    []
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f3f3f3", paddingBottom: 92 }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{t.tip}</div>
            <div style={{ fontSize: 26, fontWeight: 900 }}>{t.appName}</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
              {t.cloud}: <b>{statusLabel}</b> {user?.email ? ` · ${user.email}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* ✅ Selezione mese + PDF Ore */}
            <select
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              style={{ height: 42, borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)", padding: "0 10px" }}
              title={t.reportMonth}
            >
              {monthsAvailable.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <Button variant="secondary" onClick={() => exportPDFHours()} title={t.pdfHours}>
              {t.pdfHours}
            </Button>

            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              style={{ height: 42, borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)", padding: "0 10px" }}
            >
              <option value="it">IT</option>
              <option value="en">EN</option>
            </select>

            {user ? (
              <Button variant="secondary" onClick={logout}>
                {t.signOut}
              </Button>
            ) : (
              <Button onClick={loginGoogle}>{t.signIn}</Button>
            )}
          </div>
        </div>

        {/* Top cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
          <Card>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{t.monthHours}</div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{fmt2(monthTotals.hours)}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{currentMonth}</div>
          </Card>
          <Card>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{t.monthPay}</div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>€ {fmt2(monthTotals.pay)}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {t.projection}: € {fmt2(monthTotals.projection)}
            </div>
          </Card>
          <Card>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{t.overtime}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {t.threshold}: <b>{settings.overtimeThresholdHours}</b>h
              <br />
              {t.multiplier}: <b>{settings.overtimeMultiplier}</b>x
            </div>
          </Card>
        </div>

        {/* Chart */}
        <div style={{ marginTop: 14 }}>
          <Card>
            {dailyData.labels.length ? (
              <div style={{ height: 240 }}>
                <Bar data={dailyData} options={chartOptions} />
              </div>
            ) : (
              <div style={{ opacity: 0.75 }}>{t.noDataMonth}</div>
            )}
          </Card>
        </div>

        {/* Tabs content */}
        <div style={{ marginTop: 14 }}>
          {/* TODAY */}
          {tab === "today" && (
            <Card>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.date}</div>
                  <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.job}</div>
                  <select
                    value={draft.jobId}
                    onChange={(e) => setDraft((d) => ({ ...d, jobId: e.target.value }))}
                    style={{
                      width: "100%",
                      height: 42,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.12)",
                      padding: "0 10px",
                      background: "rgba(255,255,255,0.92)",
                    }}
                  >
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name} — €{Number(j.rate).toFixed(2)}/h
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {draft.blocks.map((b, i) => (
                  <div key={i} style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{t.from}</div>
                      <Input type="time" value={b.start} onChange={(e) => updateBlock(i, "start", e.target.value)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{t.to}</div>
                      <Input type="time" value={b.end} onChange={(e) => updateBlock(i, "end", e.target.value)} />
                    </div>
                  </div>
                ))}

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Button variant="secondary" onClick={addBlock}>
                    {t.addBlock}
                  </Button>
                  <Button onClick={active ? stopTimer : startTimer}>{active ? "Stop" : "Start"}</Button>
                  {active ? <div style={{ fontSize: 14, opacity: 0.85 }}>⏱ {live}</div> : null}
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.notes}</div>
                  <Input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder={t.notes} />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button onClick={saveDay}>{t.saveDay}</Button>
                </div>
              </div>
            </Card>
          )}

          {/* LOG */}
          {tab === "log" && (
            <Card>
              {entriesWithComputed.length === 0 ? (
                <div style={{ opacity: 0.85 }}>{t.empty}</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.75 }}>
                        <th style={{ padding: "8px 0" }}>{t.date}</th>
                        <th style={{ padding: "8px 0" }}>{t.job}</th>
                        <th style={{ padding: "8px 0" }}>{t.times}</th>
                        <th style={{ padding: "8px 0" }}>h</th>
                        <th style={{ padding: "8px 0" }}>€</th>
                        <th style={{ padding: "8px 0" }} />
                      </tr>
                    </thead>

                    <tbody>
                      {entriesWithComputed.map((e) => (
                        <tr key={e.id} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <td style={{ padding: "10px 0", fontWeight: 900 }}>{e.date}</td>
                          <td style={{ padding: "10px 0" }}>{jobsById[e.jobId]?.name || "-"}</td>

                          {/* ✅ ORARI (uno per riga) */}
                          <td style={{ padding: "10px 0" }}>
                            {(e.blocks || []).filter((b) => b?.start && b?.end).length ? (
                              (e.blocks || [])
                                .filter((b) => b?.start && b?.end)
                                .map((b, i) => (
                                  <div key={i}>
                                    {b.start}-{b.end}
                                  </div>
                                ))
                            ) : (
                              <span style={{ opacity: 0.6 }}>—</span>
                            )}
                          </td>

                          <td style={{ padding: "10px 0" }}>{fmt2(e.hours)}</td>
                          <td style={{ padding: "10px 0" }}>€ {fmt2(e.pay)}</td>
                          <td style={{ padding: "10px 0", textAlign: "right" }}>
                            <Button variant="secondary" onClick={() => deleteEntry(e.id)}>
                              {t.delete}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* JOBS */}
          {tab === "jobs" && (
            <Card>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>{t.newJob}</div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr auto" }}>
                <Input value={newJob.name} onChange={(e) => setNewJob((v) => ({ ...v, name: e.target.value }))} placeholder={t.name} />
                <Input type="number" value={newJob.rate} onChange={(e) => setNewJob((v) => ({ ...v, rate: e.target.value }))} placeholder={t.rate} />
                <Button onClick={addJob}>{t.add}</Button>
              </div>

              <div style={{ marginTop: 14, fontWeight: 900 }}>{t.jobs}</div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {jobs.map((j) => (
                  <div
                    key={j.id}
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "1fr 140px auto auto",
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.06)",
                      background: "rgba(255,255,255,0.65)",
                    }}
                  >
                    <Input value={j.name} onChange={(e) => updateJob(j.id, { name: e.target.value })} placeholder={t.name} />
                    <Input type="number" value={String(j.rate)} onChange={(e) => updateJob(j.id, { rate: Number(e.target.value || 0) })} placeholder={t.rate} />
                    <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, jobId: j.id }))}>
                      {t.today}
                    </Button>
                    <Button
                      variant={j.id === "default" ? "ghost" : "danger"}
                      disabled={j.id === "default"}
                      title={j.id === "default" ? "Il lavoro di default non si elimina" : "Elimina lavoro"}
                      onClick={() => deleteJob(j.id)}
                    >
                      {t.delete}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* SETTINGS */}
          {tab === "settings" && (
            <Card>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.threshold}</div>
                  <Input
                    type="number"
                    value={settings.overtimeThresholdHours}
                    onChange={(e) => setSettings((s) => ({ ...s, overtimeThresholdHours: Number(e.target.value || 0) }))}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.multiplier}</div>
                  <Input
                    type="number"
                    step="0.01"
                    value={settings.overtimeMultiplier}
                    onChange={(e) => setSettings((s) => ({ ...s, overtimeMultiplier: Number(e.target.value || 1) }))}
                  />
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 14, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: "min(520px, calc(100% - 32px))",
            background: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 20,
            padding: 8,
            display: "flex",
            gap: 8,
          }}
        >
          <NavBtn active={tab === "today"} onClick={() => setTab("today")} label={t.today} />
          <NavBtn active={tab === "log"} onClick={() => setTab("log")} label={t.log} />
          <NavBtn active={tab === "jobs"} onClick={() => setTab("jobs")} label={t.jobs} />
          <NavBtn active={tab === "settings"} onClick={() => setTab("settings")} label={t.settings} />
        </div>
      </div>
    </div>
  );
}

function NavBtn({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 44,
        borderRadius: 14,
        border: "none",
        background: active ? "rgba(0,0,0,0.08)" : "transparent",
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
