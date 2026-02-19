// ===== IMPORT =====
import jsPDF from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";

import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";

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

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// ===== FIREBASE =====
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

// ===== UI BASE =====
const Button = ({ onClick, children, variant = "default" }) => {
  const style =
    variant === "secondary"
      ? { background: "#eee" }
      : { background: "#111", color: "white" };

  return (
    <button
      onClick={onClick}
      style={{
        height: 42,
        borderRadius: 14,
        padding: "0 14px",
        border: "none",
        fontWeight: 700,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
};

const Input = (props) => (
  <input
    {...props}
    style={{
      width: "100%",
      height: 42,
      borderRadius: 14,
      border: "1px solid #ccc",
      padding: "0 12px",
    }}
  />
);

const Card = ({ children }) => (
  <div
    style={{
      borderRadius: 18,
      background: "white",
      border: "1px solid #eee",
      padding: 14,
    }}
  >
    {children}
  </div>
);

// ===== HELPERS =====
const uid = () => Math.random().toString(36).slice(2, 10);
const pad2 = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const diffMinutes = (s, e) => {
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
};

const fmt2 = (n) => Number(n || 0).toFixed(2);
const monthKey = (iso) => iso.slice(0, 7);

// ===== APP =====
export default function App() {
  const [tab, setTab] = useState("today");

  const [jobs, setJobs] = useState([{ id: "default", name: "Lavoro", rate: 10 }]);
  const [entries, setEntries] = useState([]);

  const [settings, setSettings] = useState({
    overtimeThresholdHours: 40,
    overtimeMultiplier: 1.25,
    defaultRate: 10,
    breakMinutes: 0,
    roundingMinutes: 0,
  });

  const [draft, setDraft] = useState({
    date: todayISO(),
    jobId: "default",
    blocks: [{ start: "", end: "" }],
  });

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);

  // ===== CALCOLO =====
  const entriesWithComputed = useMemo(() => {
    return entries.map((e) => {
      let minutes = e.blocks.reduce((s, b) => s + diffMinutes(b.start, b.end), 0);

      if (settings.roundingMinutes > 0) {
        minutes = Math.round(minutes / settings.roundingMinutes) * settings.roundingMinutes;
      }

      minutes -= settings.breakMinutes;
      if (minutes < 0) minutes = 0;

      const hours = minutes / 60;
      const pay = hours * (jobsById[e.jobId]?.rate || 0);

      return { ...e, hours, pay };
    });
  }, [entries, jobsById, settings]);

  const currentMonth = todayISO().slice(0, 7);

  const monthTotals = useMemo(() => {
    const list = entriesWithComputed.filter((e) => monthKey(e.date) === currentMonth);
    return {
      hours: list.reduce((s, e) => s + e.hours, 0),
      pay: list.reduce((s, e) => s + e.pay, 0),
    };
  }, [entriesWithComputed, currentMonth]);

  // ===== PDF =====
  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text(`Riepilogo ${currentMonth}`, 14, 20);

    let y = 30;
    entriesWithComputed
      .filter((e) => monthKey(e.date) === currentMonth)
      .forEach((e) => {
        doc.text(`${e.date}  ${fmt2(e.hours)}h  €${fmt2(e.pay)}`, 14, y);
        y += 6;
      });

    doc.save(`ore-${currentMonth}.pdf`);
  };

  // ===== ADD DAY =====
  const saveDay = () => {
    setEntries((p) => [...p, { id: uid(), ...draft }]);
    setDraft({ date: todayISO(), jobId: draft.jobId, blocks: [{ start: "", end: "" }] });
  };

  // ===== UI =====
  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <h2>Ore & Stipendio</h2>
        <Button variant="secondary" onClick={exportPDF}>
          PDF
        </Button>
      </div>

      {/* TOTALI */}
      <Card>
        Ore mese: <b>{fmt2(monthTotals.hours)}</b> | €
        <b>{fmt2(monthTotals.pay)}</b>
      </Card>

      {/* TODAY */}
      {tab === "today" && (
        <Card>
          <Input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
          />

          <select
            value={draft.jobId}
            onChange={(e) => setDraft((d) => ({ ...d, jobId: e.target.value }))}
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} €{j.rate}/h
              </option>
            ))}
          </select>

          {draft.blocks.map((b, i) => (
            <div key={i}>
              <Input
                type="time"
                value={b.start}
                onChange={(e) =>
                  setDraft((d) => {
                    const blocks = [...d.blocks];
                    blocks[i].start = e.target.value;
                    return { ...d, blocks };
                  })
                }
              />
              <Input
                type="time"
                value={b.end}
                onChange={(e) =>
                  setDraft((d) => {
                    const blocks = [...d.blocks];
                    blocks[i].end = e.target.value;
                    return { ...d, blocks };
                  })
                }
              />
            </div>
          ))}

          <Button onClick={saveDay}>Salva</Button>
        </Card>
      )}

      {/* JOBS */}
      {tab === "jobs" && (
        <Card>
          {jobs.map((j) => (
            <div key={j.id}>
              {j.name} – €{j.rate}
            </div>
          ))}
        </Card>
      )}

      {/* SETTINGS */}
      {tab === "settings" && (
        <Card>
          <div>Pausa minuti</div>
          <Input
            type="number"
            value={settings.breakMinutes}
            onChange={(e) =>
              setSettings((s) => ({ ...s, breakMinutes: Number(e.target.value) }))
            }
          />

          <div>Arrotondamento</div>
          <select
            value={settings.roundingMinutes}
            onChange={(e) =>
              setSettings((s) => ({ ...s, roundingMinutes: Number(e.target.value) }))
            }
          >
            <option value={0}>0</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={15}>15</option>
          </select>
        </Card>
      )}

      {/* NAV */}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <Button onClick={() => setTab("today")}>Oggi</Button>
        <Button onClick={() => setTab("jobs")}>Lavori</Button>
        <Button onClick={() => setTab("settings")}>Impostazioni</Button>
      </div>
    </div>
  );
}
