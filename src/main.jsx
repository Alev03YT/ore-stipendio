import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

/* -------- Error Boundary elegante -------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: "" };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, err: String(err?.message || err) };
  }

  componentDidCatch(error, info) {
    console.error("App error:", error, info);
  }

  handleReload = () => {
    // hard reload
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f3f3f3",
            fontFamily: "system-ui, sans-serif",
            padding: 20,
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: "100%",
              background: "white",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
            <h2 style={{ margin: 0, fontSize: 22 }}>Qualcosa è andato storto</h2>
            <p style={{ opacity: 0.7, fontSize: 14, marginTop: 10 }}>
              Prova a ricaricare la pagina.
              <br />
              Se continua, è quasi sempre cache/Service Worker.
            </p>

            {this.state.err ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "#f7f7f7",
                  borderRadius: 14,
                  fontSize: 12,
                  textAlign: "left",
                  maxHeight: 140,
                  overflow: "auto",
                }}
              >
                {this.state.err}
              </div>
            ) : null}

            <button
              onClick={this.handleReload}
              style={{
                marginTop: 16,
                height: 44,
                padding: "0 18px",
                borderRadius: 14,
                border: "none",
                background: "#111",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Ricarica
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/* -------- FIX "APP BUGGATA": DISATTIVA SW + PULISCI CACHE (una volta) --------
   IMPORTANTISSIMO su GitHub Pages: se prima avevi sw.js, rimane attivo e ti serve roba vecchia.
*/
(async () => {
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const alreadyCleaned = url.searchParams.get("sw_clean") === "1";

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length) await Promise.all(regs.map((r) => r.unregister()));

    if ("caches" in window) {
      const keys = await caches.keys();
      if (keys.length) await Promise.all(keys.map((k) => caches.delete(k)));
    }

    if (!alreadyCleaned) {
      url.searchParams.set("sw_clean", "1");
      window.location.replace(url.toString());
    }
  } catch (e) {
    console.warn("SW cleanup failed:", e);
  }
})();

/* -------- Render app -------- */
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
