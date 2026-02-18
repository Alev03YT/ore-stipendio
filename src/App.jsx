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
function Button({ onClick, children, variant = "default", disabled }) {
  const base = {
    height: 42,
    borderRadius: 14,
    padding: "0 14px",
    fontWeight: 800,
    border: "1px solid rgba(0,0,0,0.10)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
  const style =
    variant === "secondary"
      ? { ...base, background: "rgba(255,255,255,0.85)" }
      : variant === "ghost"
      ? { ...base, background: "transparent", border: "1px solid transparent" }
      : { ...base, background: "#111", color: "white", border: "1px solid #111" };

  return (
    <button onClick={disabled ? undefined : onClick} style={style}>
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

/* Straordinari settimanali: oltre soglia (40h) * moltiplicatore (1.25x) */
function computeWeeklyPay(entries, jobsById, settings) {
  const { overtimeThresholdHours, overtimeMultiplier } = settings;

  const blocks = [];
  for (const e of entries) {
    for (let bi = 0; bi < e.blocks.length; bi++) {
      const b = e.blocks[bi];
      if (!b.start || !b.end) continue;
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
  },
};

export default function App() {
  const [tab, setTab] = useState("today");
  const [lang, setLang] = useState("it");
  const t = I18N[lang];

  const [user, setUser] = useState(null);
  const [cloudStatus, setCloudStatus] = useState("local"); // local | syncing | synced

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

  // Local backup
  const LOCAL_KEY = "ore_stipendio_repo_v1";
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

  // Cloud ref
  const cloudDocRef = useMemo(() => {
    if (!user?.uid) return null;
    return doc(db, "users", user.uid, "appdata", "main");
  }, [user]);

  // Auth + load
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

  // Debounced save
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

  // Timer tick
  useEffect(() => {
    if (!active) return;
    timerRef.current = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [active]);

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);

  const computed = useMemo(() => computeWeeklyPay(entries, jobsById, settings), [entries, jobsById, settings]);

  const entriesWithComputed = useMemo(() => {
    return entries
      .map((e) => ({
        ...e,
        hours: computed.hoursByEntry.get(e.id) || 0,
        pay: computed.payByEntry.get(e.id) || 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, computed]);

  const currentMonth = todayISO().slice(0, 7);

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
      datasets: [
        {
          label: t.eurosPerDay,
          data: values,
        },
      ],
    };
  }, [entriesWithComputed, currentMonth, t.eurosPerDay]);

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

  const [newJob, setNewJob] = useState({ name: "", rate: "" });
  const addJob = () => {
    const name = (newJob.name || "").trim();
    const rate = Number(newJob.rate);
    if (!name || !Number.isFinite(rate) || rate <= 0) return;
    const id = uid();
    setJobs((prev) => [...prev, { id, name, rate }]);
    setNewJob({ name: "", rate: "" });
    setDraft((d) => ({ ...d, jobId: id }));
  };

  const statusLabel = cloudStatus === "synced" ? t.synced : t.local;

  const live = (() => {
    if (!active) return null;
    const s = Math.floor((Date.now() - active.startedAt.getTime()) / 1000);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#f3f3f3", paddingBottom: 92 }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{t.tip}</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{t.appName}</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
              {t.cloud}: <b>{statusLabel}</b> {user?.email ? ` · ${user.email}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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

        {/* Grafico */}
        <div style={{ marginTop: 14 }}>
          <Card>
            {dailyData.labels.length ? (
              <Bar data={dailyData} />
            ) : (
              <div style={{ opacity: 0.75 }}>{t.noDataMonth}</div>
            )}
          </Card>
        </div>

        <div style={{ marginTop: 14 }}>
          {tab === "today" && (
            <Card>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.date}</div>
                  <Input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                  />
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
                  <Input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button onClick={saveDay}>{t.saveDay}</Button>
                </div>
              </div>
            </Card>
          )}

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

          {tab === "jobs" && (
            <Card>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>{t.newJob}</div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr auto" }}>
                <Input value={newJob.name} onChange={(e) => setNewJob((v) => ({ ...v, name: e.target.value }))} placeholder={t.name} />
                <Input
                  type="number"
                  value={newJob.rate}
                  onChange={(e) => setNewJob((v) => ({ ...v, rate: e.target.value }))}
                  placeholder={t.rate}
                />
                <Button onClick={addJob}>{t.add}</Button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {jobs.map((j) => (
                  <div
                    key={j.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.06)",
                      background: "rgba(255,255,255,0.65)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900 }}>{j.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>€ {Number(j.rate).toFixed(2)}/h</div>
                    </div>
                    <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, jobId: j.id }))}>
                      {t.today}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === "settings" && (
            <Card>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.threshold}</div>
                  <Input
                    type="number"
                    value={settings.overtimeThresholdHours}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, overtimeThresholdHours: Number(e.target.value || 0) }))
                    }
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
