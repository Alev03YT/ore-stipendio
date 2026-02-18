import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // utile per debug, ma su mobile non serve
    console.error("ErrorBoundary:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: "system-ui", whiteSpace: "pre-wrap" }}>
          <h2 style={{ marginTop: 0 }}>Errore app</h2>
          <p>Copia e incolla questo messaggio qui in chat:</p>
          <pre
            style={{
              background: "#111",
              color: "#fff",
              padding: 12,
              borderRadius: 12,
              overflowX: "auto",
            }}
          >
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
