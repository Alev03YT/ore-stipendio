import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

function ErrorScreen({ error }) {
  return (
    <div style={{ padding: 16, fontFamily: "system-ui", whiteSpace: "pre-wrap" }}>
      <h2 style={{ marginTop: 0 }}>Errore app</h2>
      <p>Incolla questo messaggio qui in chat:</p>
      <pre style={{ background: "#111", color: "#fff", padding: 12, borderRadius: 12, overflowX: "auto" }}>
        {String(error)}
      </pre>
    </div>
  );
}

function Root() {
  const [error, setError] = useState(null);

  useEffect(() => {
    const onError = (e) => setError(e?.error?.stack || e?.message || String(e));
    const onRejection = (e) => setError(e?.reason?.stack || e?.reason?.message || String(e?.reason || e));

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (error) return <ErrorScreen error={error} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
