import { useState, useMemo, useCallback } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer
} from "recharts";

/* ═══════════════════════════════════════════════════════
   PDF TEXT EXTRACTION via PDF.js CDN
   ═══════════════════════════════════════════════════════ */
const loadPdfJs = (() => {
  let p = null;
  return () => {
    if (p) return p;
    p = new Promise((res, rej) => {
      if (window.pdfjsLib) return res(window.pdfjsLib);
      const s = document.createElement("script");
      s.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        res(window.pdfjsLib);
      };
      s.onerror = rej;
      document.head.appendChild(s);
    });
    return p;
  };
})();

async function extractText(file) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  let full = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const tc = await pg.getTextContent();

    // Group text items by their Y-coordinate to reconstruct actual lines.
    // PDF.js returns items in document order but all on one "line" if joined
    // naively — grouping by Y restores the real row structure.
    const lineMap = new Map();
    for (const item of tc.items) {
      if (!item.str) continue;
      // Round to nearest 3 units to tolerate minor baseline differences
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y).push({ x: item.transform[4], str: item.str });
    }

    // PDF Y-axis is bottom-up, so sort descending to read top-to-bottom
    const sortedY = [...lineMap.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const items = lineMap.get(y).sort((a, b) => a.x - b.x);
      const lineText = items
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (lineText) full += lineText + "\n";
    }
    full += "\n";
  }
  return full;
}

/* ═══════════════════════════════════════════════════════
   BILL PARSER — handles standard NH / Narayana Health
   provisional bill format
   ═══════════════════════════════════════════════════════ */
const CATEGORY_MAP = {
  administrative: "Administrative",
  "bed charges": "Bed Charges",
  "blood components": "Blood Components",
  consultation: "Consultation",
  "diagnostics non-lab": "Diagnostics (Non-Lab)",
  "diagnostic non-lab": "Diagnostics (Non-Lab)",
  "diagnostics (non-lab)": "Diagnostics (Non-Lab)",
  "laboratory services": "Laboratory Services",
  "lab services": "Laboratory Services",
  laboratory: "Laboratory Services",
  physiotheraphy: "Physiotherapy",
  physiotherapy: "Physiotherapy",
  procedures: "Procedures",
  radiology: "Radiology",
  "support services": "Support Services",
  surgery: "Surgery",
  consumables: "Consumables",
  "implant and devices": "Implants & Devices",
  "implants and devices": "Implants & Devices",
  "implants & devices": "Implants & Devices",
  medicines: "Medicines",
  "regulated pricing drugs": "Regulated Drugs",
  "regulated drugs": "Regulated Drugs",
  "surgical consumables": "Surgical Consumables",
  "pharmacy items": "Medicines",
  pharmacy: "Medicines",
  "nursing charges": "Support Services",
  "nursing services": "Support Services",
  "ot charges": "Surgery",
  "operation theatre": "Surgery",
};

const CAT_ICONS = {
  Administrative: "📋",
  "Bed Charges": "🛏️",
  "Blood Components": "🩸",
  Consultation: "👨‍⚕️",
  "Diagnostics (Non-Lab)": "📊",
  "Laboratory Services": "🧪",
  Physiotherapy: "🏋️",
  Procedures: "⚕️",
  Radiology: "📡",
  "Support Services": "🫁",
  Surgery: "🔪",
  Consumables: "🧫",
  "Implants & Devices": "🔩",
  Medicines: "💉",
  "Regulated Drugs": "💊",
  "Surgical Consumables": "🩹",
};

const CAT_COLORS = {
  Surgery: "#E63946",
  "Laboratory Services": "#457B9D",
  "Bed Charges": "#6A4C93",
  "Surgical Consumables": "#2A9D8F",
  Radiology: "#E9C46A",
  "Support Services": "#1982C4",
  Consultation: "#B5838D",
  "Regulated Drugs": "#F4A261",
  Medicines: "#8AC926",
  "Diagnostics (Non-Lab)": "#264653",
  "Implants & Devices": "#FF595E",
  "Blood Components": "#C1121F",
  Procedures: "#6D6875",
  Administrative: "#A8DADC",
  Physiotherapy: "#90BE6D",
  Consumables: "#CDB4DB",
};

const DATE_RE = /(\d{2}-\d{2}-\d{4})/;
const AMOUNT_RE = /[\d,]+\.\d{2}$/;

function parseBill(text) {
  const lines = text.split("\n");
  let patient = "",
    mrn = "",
    billNo = "",
    admDate = "",
    billDate = "",
    ward = "",
    hospital = "";
  let doctors = [];

  // Extract header info
  for (const l of lines) {
    if (/patient\s*name/i.test(l)) {
      const m = l.match(/:\s*(.+?)(?:\s*\(|$)/);
      if (m) patient = m[1].trim();
    }
    if (/patient\s*mrn/i.test(l)) {
      const m = l.match(/:\s*(\d+)/);
      if (m) mrn = m[1];
    }
    if (/bill\s*no/i.test(l)) {
      const m = l.match(/:\s*([\w-]+)/);
      if (m) billNo = m[1];
    }
    if (/admission\s*date/i.test(l)) {
      const m = l.match(/:\s*([\d-]+)/);
      if (m) admDate = m[1];
    }
    if (/billing\s*date/i.test(l)) {
      const m = l.match(/:\s*([\d-]+)/);
      if (m) billDate = m[1];
    }
    if (/ward\/bed/i.test(l)) {
      const m = l.match(/:\s*(.+)/);
      if (m) ward = m[1].trim();
    }
    if (/admitted\s*under/i.test(l)) {
      const m = l.match(/:\s*(.+)/);
      if (m) doctors = m[1].split(",").map((d) => d.trim());
    }
    if (/rabindranath|narayana|institute/i.test(l) && !hospital)
      hospital = l.trim().substring(0, 80);
  }

  // Parse line items into categories
  const categories = {};
  const dateWise = {};
  let currentCat = null;

  for (const raw of lines) {
    const l = raw.trim();

    // Check for category header
    const lLow = l
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    for (const [key, label] of Object.entries(CATEGORY_MAP)) {
      if (lLow === key || lLow.startsWith(key + " ") || lLow.startsWith(key + "(")) {
        if (l.length < key.length + 50 && !AMOUNT_RE.test(l)) {
          currentCat = label;
          if (!categories[currentCat])
            categories[currentCat] = { items: [], total: 0 };
          break;
        }
      }
    }

    // Capture section totals
    if (/^\s*Total\s+[\d,]+\.\d{2}\s*$/.test(l) && currentCat) {
      const m = l.match(/([\d,]+\.\d{2})/);
      if (m)
        categories[currentCat].total = parseFloat(m[1].replace(/,/g, ""));
      continue;
    }

    // Parse line items with dates and amounts
    if (currentCat && DATE_RE.test(l)) {
      const dateMatch = l.match(DATE_RE);
      const amountMatch = l.match(/([\d,]+\.\d{2})\s*$/);
      if (dateMatch && amountMatch) {
        const date = dateMatch[1];
        const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
        const name = l
          .substring(0, l.indexOf(date))
          .replace(/^\d+\.\s*/, "")
          .trim();

        categories[currentCat].items.push({ name, date, amount });

        if (!dateWise[date]) dateWise[date] = { total: 0, categories: {} };
        dateWise[date].total += amount;
        if (!dateWise[date].categories[currentCat])
          dateWise[date].categories[currentCat] = 0;
        dateWise[date].categories[currentCat] += amount;
      }
    }
  }

  // Fallback: sum items if Total line wasn't found
  for (const [, data] of Object.entries(categories)) {
    if (!data.total || data.total === 0) {
      data.total = data.items.reduce((s, i) => s + i.amount, 0);
    }
  }

  // Extract summary amounts
  let gross = 0,
    discount = 0,
    net = 0,
    deposit = 0,
    balance = 0;
  for (const l of lines) {
    if (/total\s*hospital\s*charges/i.test(l)) {
      const m = l.match(/([\d,]+\.\d{2})/);
      if (m) gross = parseFloat(m[1].replace(/,/g, ""));
    }
    if (/less\s*discount/i.test(l)) {
      const m = l.match(/([\d,]+\.\d{2})/);
      if (m) discount = parseFloat(m[1].replace(/,/g, ""));
    }
    if (/net\s*amount/i.test(l)) {
      const m = l.match(/([\d,]+\.\d{2})/);
      if (m) net = parseFloat(m[1].replace(/,/g, ""));
    }
    if (/deposit\s*balance/i.test(l)) {
      const m = l.match(/([\d,]+\.\d{2})/);
      if (m) deposit = parseFloat(m[1].replace(/,/g, ""));
    }
    if (/balance\s*to\s*pay/i.test(l)) {
      const m = l.match(/([\d,]+\.\d{2})/);
      if (m) balance = parseFloat(m[1].replace(/,/g, ""));
    }
  }

  if (!gross)
    gross = Object.values(categories).reduce((s, c) => s + c.total, 0);
  if (!net) net = gross - discount;

  return {
    patient: patient || "Unknown Patient",
    mrn,
    billNo,
    admDate,
    billDate,
    ward,
    hospital,
    doctors,
    categories,
    dateWise,
    gross,
    discount,
    net,
    deposit,
    balance,
  };
}

/* ═══════════════════════════════════════════════════════
   FORMATTING HELPERS
   ═══════════════════════════════════════════════════════ */
const fmt = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (d) => {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${parseInt(parts[0])} ${months[parseInt(parts[1]) - 1]}`;
};

const CHART_COLORS = [
  "#E63946", "#457B9D", "#6A4C93", "#2A9D8F", "#E9C46A", "#1982C4",
  "#B5838D", "#F4A261", "#8AC926", "#264653", "#FF595E", "#C1121F",
  "#6D6875", "#A8DADC", "#90BE6D", "#CDB4DB",
];

const TT = ({ active, payload }) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        padding: "10px 14px",
        color: "#e0e0e0",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 700, color: "#fff", marginBottom: 4 }}>
        {d.name || d.date}
      </div>
      <div style={{ color: "#8ac926" }}>
        {fmt(d.amount || d.value || d.total)}
      </div>
    </div>
  );
};

function PrivacyBanner({ compact = false }) {
  const points = compact
    ? ["No server upload", "Nothing saved", "Memory only"]
    : [
        "Your PDF is never uploaded to any server",
        "We do not save your bill, name, or amounts anywhere",
        "Analysis runs only in this browser tab — data clears when you leave",
      ];

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%)",
        border: "1px solid rgba(34,197,94,0.35)",
        borderRadius: compact ? 10 : 14,
        padding: compact ? "10px 14px" : "16px 18px",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: compact ? "center" : "flex-start",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: compact ? 18 : 22,
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-hidden
        >
          🔒
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: compact ? 12 : 14,
              fontWeight: 700,
              color: "#4ade80",
              marginBottom: compact ? 0 : 6,
              letterSpacing: compact ? 0 : 0.2,
            }}
          >
            {compact
              ? "We don't save any of your data"
              : "We don't save any of your data — ever"}
          </div>
          {!compact && (
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                color: "#86efac",
                lineHeight: 1.5,
              }}
            >
              No account. No database. No cloud storage. Your hospital bill
              stays on your device.
            </p>
          )}
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: compact ? "flex" : "block",
              flexWrap: "wrap",
              gap: compact ? "6px 14px" : 6,
            }}
          >
            {points.map((text, i) => (
              <li
                key={i}
                style={{
                  fontSize: compact ? 11 : 12,
                  color: compact ? "#94a3b8" : "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    color: "#22c55e",
                    fontWeight: 700,
                    fontSize: compact ? 10 : 12,
                  }}
                >
                  ✓
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP COMPONENT
   ═══════════════════════════════════════════════════════ */
export default function App() {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [debugText, setDebugText] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [view, setView] = useState("overview");
  const [dragging, setDragging] = useState(false);
  const [selectedCat, setSelectedCat] = useState(null);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file");
      return;
    }
    setLoading(true);
    setError(null);
    setDebugText(null);
    setShowDebug(false);
    try {
      const text = await extractText(file);
      const parsed = parseBill(text);
      if (Object.keys(parsed.categories).length === 0) {
        setDebugText(text);
        setError(
          "Could not find bill categories. The PDF may be image-based (scanned) or formatted differently than expected. Click 'Show extracted text' below to inspect what was read."
        );
        setLoading(false);
        return;
      }
      setBill(parsed);
      setView("overview");
      setSelectedCat(null);
    } catch (e) {
      setError("Error reading PDF: " + e.message);
    }
    setLoading(false);
  }, []);

  const catData = useMemo(() => {
    if (!bill) return [];
    return Object.entries(bill.categories)
      .map(([name, data], i) => ({
        name,
        amount: data.total,
        items: data.items,
        color: CAT_COLORS[name] || CHART_COLORS[i % CHART_COLORS.length],
        icon: CAT_ICONS[name] || "📦",
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [bill]);

  const dateData = useMemo(() => {
    if (!bill) return [];
    return Object.entries(bill.dateWise)
      .map(([date, data]) => ({ date, ...data, label: fmtDate(date) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [bill]);

  const days = useMemo(() => {
    if (!bill) return 0;
    return Object.keys(bill.dateWise).length;
  }, [bill]);

  /* ─────────── UPLOAD SCREEN ─────────── */
  if (!bill) {
    return (
      <div
        style={{
          fontFamily: "'DM Sans', sans-serif",
          background:
            "linear-gradient(160deg, #0a0a14 0%, #111827 40%, #0f172a 100%)",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          color: "#e0e0e0",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Playfair+Display:wght@700;800&display=swap"
          rel="stylesheet"
        />

        <div style={{ textAlign: "center", maxWidth: 520, width: "100%" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏥</div>
          <h1
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 36,
              fontWeight: 800,
              margin: "0 0 8px",
              letterSpacing: "-1px",
              background: "linear-gradient(135deg, #fff 0%, #94a3b8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Hospital Bill Analyzer
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "#64748b",
              margin: "0 0 20px",
              lineHeight: 1.6,
            }}
          >
            Upload your Narayana Health / NH hospital bill PDF for instant
            visual breakdowns.
          </p>

          <div style={{ marginBottom: 24 }}>
            <PrivacyBanner />
          </div>

          <p style={{ fontSize: 12, color: "#475569", margin: "0 0 32px" }}>
            Works with Rabindranath Tagore IICS, Narayana Hrudayalaya,
            Mazumdar Shaw, and all NH network hospitals
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files[0]);
            }}
            onClick={() => {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = ".pdf";
              inp.onchange = (e) => handleFile(e.target.files[0]);
              inp.click();
            }}
            style={{
              border: `2px dashed ${dragging ? "#3b82f6" : "#334155"}`,
              borderRadius: 20,
              padding: "60px 40px",
              cursor: "pointer",
              background: dragging
                ? "rgba(59,130,246,0.05)"
                : "rgba(255,255,255,0.02)",
              transition: "all 0.3s ease",
            }}
          >
            {loading ? (
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    border: "3px solid #334155",
                    borderTopColor: "#3b82f6",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    margin: "0 auto 16px",
                  }}
                />
                <p style={{ color: "#94a3b8", fontSize: 14 }}>
                  Reading your bill...
                </p>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
                <p
                  style={{
                    fontSize: 16,
                    color: "#cbd5e1",
                    margin: "0 0 8px",
                    fontWeight: 600,
                  }}
                >
                  {dragging
                    ? "Drop your PDF here"
                    : "Drag & drop your bill PDF"}
                </p>
                <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                  or click to browse • PDF only
                </p>
              </>
            )}
          </div>

          {error && (
            <div
              style={{
                marginTop: 20,
                padding: "12px 16px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10,
                fontSize: 13,
                color: "#f87171",
              }}
            >
              {error}
              {debugText && (
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => setShowDebug((v) => !v)}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "#94a3b8",
                      padding: "4px 10px",
                      fontSize: 11,
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    {showDebug ? "Hide" : "Show"} extracted text
                  </button>
                  {showDebug && (
                    <pre
                      style={{
                        marginTop: 10,
                        maxHeight: 260,
                        overflow: "auto",
                        background: "rgba(0,0,0,0.3)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: 10,
                        color: "#64748b",
                        textAlign: "left",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {debugText.slice(0, 4000)}
                      {debugText.length > 4000 ? "\n… (truncated)" : ""}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              marginTop: 40,
              padding: "20px 24px",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 14,
              textAlign: "left",
            }}
          >
            <h3
              style={{
                fontSize: 13,
                color: "#64748b",
                margin: "0 0 12px",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              What you'll get
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {[
                "Category-wise spend breakdown",
                "Date-wise expense timeline",
                "Interactive charts & graphs",
                "Top expense identification",
              ].map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "#94a3b8",
                  }}
                >
                  <span style={{ color: "#22c55e", fontSize: 14 }}>✓</span> {t}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    );
  }

  /* ─────────── DASHBOARD ─────────── */
  const top6 = catData.slice(0, 6);

  return (
    <div
      style={{
        fontFamily: "'DM Sans', sans-serif",
        background:
          "linear-gradient(160deg, #0a0a14 0%, #111827 40%, #0f172a 100%)",
        minHeight: "100vh",
        color: "#e0e0e0",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
        rel="stylesheet"
      />

      {/* Privacy — visible on every dashboard view */}
      <div
        style={{
          padding: "12px 28px 0",
          background: "rgba(34,197,94,0.04)",
          borderBottom: "1px solid rgba(34,197,94,0.15)",
        }}
      >
        <PrivacyBanner compact />
      </div>

      {/* Header */}
      <div
        style={{
          padding: "24px 28px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1
                style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}
              >
                🏥 Bill Analysis
              </h1>
              <button
                onClick={() => {
                  setBill(null);
                  setError(null);
                }}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  color: "#64748b",
                  padding: "5px 12px",
                  fontSize: 12,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                ↩ New Bill
              </button>
            </div>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "#64748b",
                fontFamily: "'Space Mono', monospace",
              }}
            >
              {bill.patient} • MRN: {bill.mrn}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12 }}>
            <div
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 11,
                color: "#475569",
              }}
            >
              #{bill.billNo}
            </div>
            <div style={{ color: "#64748b", marginTop: 2 }}>
              {bill.admDate} → {bill.billDate}
            </div>
            <div
              style={{
                color: "#E63946",
                fontWeight: 600,
                fontSize: 11,
                marginTop: 2,
              }}
            >
              {days} DAYS
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          {[
            ["Ward", bill.ward],
            ["Doctors", bill.doctors.join(", ")],
          ].map(
            ([l, v]) =>
              v && (
                <div key={l} style={{ fontSize: 11 }}>
                  <span
                    style={{
                      color: "#475569",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      fontSize: 9,
                    }}
                  >
                    {l}
                  </span>
                  <div
                    style={{ color: "#94a3b8", marginTop: 1, maxWidth: 300 }}
                  >
                    {v}
                  </div>
                </div>
              )
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 10,
          padding: "16px 28px",
        }}
      >
        {[
          { label: "Gross Total", value: fmt(bill.gross), accent: "#E63946" },
          {
            label: "Discount",
            value: bill.discount ? `- ${fmt(bill.discount)}` : "₹0",
            accent: "#22c55e",
          },
          { label: "Net Payable", value: fmt(bill.net), accent: "#3b82f6" },
          { label: "Deposited", value: fmt(bill.deposit), accent: "#2A9D8F" },
          { label: "Balance Due", value: fmt(bill.balance), accent: "#FF595E" },
        ].map((c, i) => (
          <div
            key={i}
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 12,
              padding: "12px 14px",
              borderLeft: `3px solid ${c.accent}`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "#fff",
                marginTop: 4,
                fontFamily: "'Space Mono', monospace",
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "0 28px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {["overview", "categories", "timeline"].map((t) => (
          <button
            key={t}
            onClick={() => {
              setView(t);
              setSelectedCat(null);
            }}
            style={{
              background:
                view === t ? "rgba(255,255,255,0.08)" : "transparent",
              border: "none",
              color: view === t ? "#fff" : "#64748b",
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              borderRadius: "8px 8px 0 0",
              textTransform: "capitalize",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: "20px 28px" }}>
        {/* ─── OVERVIEW ─── */}
        {view === "overview" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <h3
                style={{
                  margin: "0 0 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Top Expenses
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={top6}
                    dataKey="amount"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    innerRadius={50}
                    strokeWidth={2}
                    stroke="#0a0a14"
                    onClick={(_, i) =>
                      setSelectedCat(selectedCat === i ? null : i)
                    }
                  >
                    {top6.map((c, i) => (
                      <Cell
                        key={i}
                        fill={c.color}
                        opacity={
                          selectedCat === null || selectedCat === i ? 1 : 0.25
                        }
                        style={{
                          cursor: "pointer",
                          transition: "opacity 0.3s",
                        }}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<TT />} />
                </PieChart>
              </ResponsiveContainer>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "5px 12px",
                  marginTop: 8,
                }}
              >
                {top6.map((c, i) => (
                  <div
                    key={i}
                    onClick={() =>
                      setSelectedCat(selectedCat === i ? null : i)
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      cursor: "pointer",
                      opacity:
                        selectedCat === null || selectedCat === i ? 1 : 0.35,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: c.color,
                      }}
                    />
                    <span style={{ color: "#94a3b8" }}>{c.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <h3
                style={{
                  margin: "0 0 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Daily Spend
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dateData}>
                  <XAxis dataKey="label" stroke="#475569" fontSize={11} />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                    stroke="#334155"
                    fontSize={10}
                  />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="total" radius={[5, 5, 0, 0]}>
                    {dateData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {selectedCat !== null && top6[selectedCat] && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  background: `linear-gradient(135deg, ${top6[selectedCat].color}12, transparent)`,
                  borderRadius: 14,
                  padding: 20,
                  border: `1px solid ${top6[selectedCat].color}30`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: 26 }}>
                    {top6[selectedCat].icon}
                  </span>
                  <div>
                    <h3
                      style={{ margin: 0, color: "#fff", fontSize: 17 }}
                    >
                      {top6[selectedCat].name}
                    </h3>
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        color: top6[selectedCat].color,
                        fontSize: 15,
                      }}
                    >
                      {fmt(top6[selectedCat].amount)}
                    </span>
                    <span
                      style={{ color: "#64748b", fontSize: 12, marginLeft: 8 }}
                    >
                      (
                      {(
                        (top6[selectedCat].amount / bill.gross) *
                        100
                      ).toFixed(1)}
                      %)
                    </span>
                  </div>
                </div>
                <div style={{ maxHeight: 200, overflow: "auto" }}>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                  >
                    {top6[selectedCat].items.slice(0, 20).map((item, i) => (
                      <span
                        key={i}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 11,
                          color: "#cbd5e1",
                        }}
                      >
                        {item.name.substring(0, 40)}
                        {item.name.length > 40 ? "…" : ""} —{" "}
                        {fmt(item.amount)}
                      </span>
                    ))}
                    {top6[selectedCat].items.length > 20 && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#475569",
                          padding: "4px 8px",
                        }}
                      >
                        +{top6[selectedCat].items.length - 20} more items
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── CATEGORIES ─── */}
        {view === "categories" && (
          <div>
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: 14,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  margin: "0 0 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                All Categories ({catData.length})
              </h3>
              <ResponsiveContainer
                width="100%"
                height={Math.max(300, catData.length * 32)}
              >
                <BarChart
                  data={catData}
                  layout="vertical"
                  margin={{ left: 130, right: 30, top: 5, bottom: 5 }}
                >
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                    stroke="#334155"
                    fontSize={11}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#475569"
                    fontSize={11}
                    width={120}
                    tick={{ fill: "#94a3b8" }}
                  />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {catData.map((c, i) => (
                      <Cell key={i} fill={c.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {catData.map((cat, i) => (
                <div
                  key={i}
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 12,
                    padding: "14px 16px",
                    borderTop: `3px solid ${cat.color}`,
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setSelectedCat(selectedCat === i ? null : i)
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{cat.icon}</span>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: "#e2e8f0",
                        }}
                      >
                        {cat.name}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 13,
                        fontWeight: 700,
                        color: cat.color,
                      }}
                    >
                      {fmt(cat.amount)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: 4,
                        background: "rgba(255,255,255,0.06)",
                        borderRadius: 2,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 2,
                          background: cat.color,
                          width: `${(cat.amount / bill.gross) * 100}%`,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {((cat.amount / bill.gross) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#475569",
                      marginTop: 6,
                    }}
                  >
                    {cat.items.length} line items
                  </div>

                  {selectedCat === i && (
                    <div
                      style={{
                        marginTop: 10,
                        maxHeight: 180,
                        overflow: "auto",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        paddingTop: 10,
                      }}
                    >
                      {cat.items.slice(0, 15).map((item, j) => (
                        <div
                          key={j}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "3px 0",
                            fontSize: 11,
                          }}
                        >
                          <span
                            style={{
                              color: "#94a3b8",
                              maxWidth: "70%",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.name.substring(0, 50)}
                          </span>
                          <span
                            style={{
                              color: "#64748b",
                              fontFamily: "'Space Mono', monospace",
                            }}
                          >
                            {fmt(item.amount)}
                          </span>
                        </div>
                      ))}
                      {cat.items.length > 15 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#475569",
                            marginTop: 4,
                          }}
                        >
                          +{cat.items.length - 15} more...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── TIMELINE ─── */}
        {view === "timeline" && (
          <div>
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: 14,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  margin: "0 0 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Spend Over {days} Days
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dateData}>
                  <XAxis dataKey="label" stroke="#475569" fontSize={11} />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                    stroke="#334155"
                    fontSize={10}
                  />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="total" radius={[5, 5, 0, 0]}>
                    {dateData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ position: "relative", paddingLeft: 28 }}>
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "rgba(255,255,255,0.06)",
                }}
              />
              {dateData.map((day, di) => {
                const catBreakdown = Object.entries(day.categories).sort(
                  (a, b) => b[1] - a[1]
                );
                return (
                  <div
                    key={di}
                    style={{ marginBottom: 20, position: "relative" }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: -23,
                        top: 4,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: CHART_COLORS[di % CHART_COLORS.length],
                        border: "2px solid #0a0a14",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: 8,
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#fff",
                        }}
                      >
                        Day {di + 1} — {fmtDate(day.date)}
                      </h3>
                      <span
                        style={{
                          fontFamily: "'Space Mono', monospace",
                          fontSize: 14,
                          color: CHART_COLORS[di % CHART_COLORS.length],
                        }}
                      >
                        {fmt(day.total)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {catBreakdown.map(([cat, amt], ci) => (
                        <div
                          key={ci}
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: 8,
                            padding: "6px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 14 }}>
                            {CAT_ICONS[cat] || "📦"}
                          </span>
                          <div>
                            <div
                              style={{ fontSize: 11, color: "#94a3b8" }}
                            >
                              {cat}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                fontFamily: "'Space Mono', monospace",
                                color: "#fff",
                              }}
                            >
                              {fmt(amt)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "16px 28px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 4px" }}>
          <span style={{ color: "#4ade80", fontWeight: 600 }}>🔒 No data saved</span>
          {" "}— your bill is not stored on any server, database, or disk. Analysis
          exists only in this browser session.
        </p>
        <p style={{ fontSize: 11, color: "#334155", margin: 0 }}>
          Provisional Bill • 100% client-side •{" "}
          <a
            href="https://github.com"
            style={{ color: "#475569" }}
            target="_blank"
            rel="noreferrer"
          >
            Open Source (MIT)
          </a>
        </p>
      </div>
    </div>
  );
}
