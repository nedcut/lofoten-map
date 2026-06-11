"use client";

// Last-resort boundary: replaces the root layout itself, so it must render
// its own <html>/<body> and cannot rely on globals.css or Tailwind having
// loaded. Inline styles only.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error(error);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#e7efe8", fontFamily: "system-ui, sans-serif", color: "#1c1917" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#57534e", marginBottom: "1.5rem" }}>The logbook hit an unexpected error. Reloading usually clears it up.</p>
          <button
            onClick={reset}
            style={{ padding: "0.75rem 1.5rem", borderRadius: "0.75rem", border: "none", background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
