import { FONT, C } from "../utils/constants";

export default function Screen({ title, subtitle, children }) {
  return (
    <main
      tabIndex={-1}
      id="main"
      style={{ flex: 1, overflowY: "auto", padding: "28px 20px 120px" }}
    >
      <header style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: FONT, fontSize: 12, color: C.focus,
          letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 6,
        }}>
          RIZZVISION
        </div>
        <h1 style={{
          fontFamily: FONT, fontSize: 30, fontWeight: 900,
          color: C.white, lineHeight: 1.15, marginBottom: subtitle ? 10 : 0,
        }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontFamily: FONT, fontSize: 17, color: C.muted, lineHeight: 1.7 }}>
            {subtitle}
          </p>
        )}
      </header>
      {children}
    </main>
  );
}
