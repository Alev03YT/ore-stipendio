import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

/* -------- Error Boundary elegante -------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("App error:", error, info);
  }

  handleReload = () => {
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
              maxWidth: 420,
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
              Prova a ricaricare la pagina. Se il problema continua, riprova più tardi.
            </p>

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

/* -------- Render app -------- */
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

/* -------- DISATTIVA SW + PULISCI QUELLI VECCHI (NO BUG) -------- */
(async () => {
  if (!("serviceWorker" in navigator)) return;

  try {
    // Unregister di tutti i service worker
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length) {
      await Promise.all(regs.map((r) => r.unregister()));
    }

    // Cancella cache
    if ("caches" in window) {
      const keys = await caches.keys();
      if (keys.length) {
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    }

    // Ricarica UNA sola volta (evita loop)
    const url = new URL(window.location.href);
    if (!url.searchParams.has("sw-clean")) {
      url.searchParams.set("sw-clean", "1");
      window.location.replace(url.toString());
    }
  } catch (e) {
    console.warn("SW cleanup failed:", e);
  }
})();
