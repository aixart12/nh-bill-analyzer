# 🏥 NH Hospital Bill Analyzer

A privacy-first, browser-based tool to analyze hospital bills from **Narayana Health (NH)** network hospitals — including Rabindranath Tagore IICS Kolkata, Narayana Hrudayalaya Bangalore, Mazumdar Shaw Medical Center, and all NH affiliates.

**Upload your bill PDF → Get instant visual breakdowns. No data leaves your device.**

![License](https://img.shields.io/badge/license-MIT-green)
![Framework](https://img.shields.io/badge/React-18-blue)
![Backend](https://img.shields.io/badge/Backend-None-orange)

---

## ✨ Features

- **📊 Category-wise Breakdown** — Surgery, Lab, Radiology, Medicines, Bed Charges, etc. with interactive pie & bar charts
- **📅 Date-wise Timeline** — See how much was spent each day, with per-category drill-down
- **🔍 Line Item Details** — Click any category to see individual charges
- **🔒 100% Private** — PDF parsing happens entirely in the browser using PDF.js. No server, no uploads, no tracking.
- **📱 Responsive** — Works on desktop and mobile

## 🚀 Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/nh-bill-analyzer.git
cd nh-bill-analyzer

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` and drop your hospital bill PDF.

## 🏗️ Build for Production

```bash
npm run build
```

Output goes to `dist/` — deploy anywhere (Vercel, Netlify, GitHub Pages, etc.)

## 🏥 Supported Hospitals

Works with provisional/final bills from any hospital in the Narayana Health network:

- Rabindranath Tagore International Institute of Cardiac Sciences (Kolkata)
- Narayana Hrudayalaya (Bangalore)
- Mazumdar Shaw Medical Center (Bangalore)
- SRCC Children's Hospital (Mumbai)
- Narayana Multispeciality Hospital (various cities)
- And other NH network hospitals using the same billing format

## 📋 Bill Categories Parsed

| Category | Icon |
|----------|------|
| Surgery | 🔪 |
| Laboratory Services | 🧪 |
| Bed Charges | 🛏️ |
| Surgical Consumables | 🩹 |
| Radiology | 📡 |
| Support Services | 🫁 |
| Consultation | 👨‍⚕️ |
| Regulated Drugs | 💊 |
| Medicines | 💉 |
| Diagnostics (Non-Lab) | 📊 |
| Implants & Devices | 🔩 |
| Blood Components | 🩸 |
| Procedures | ⚕️ |
| Physiotherapy | 🏋️ |
| Administrative | 📋 |
| Consumables | 🧫 |

## 🛠️ Tech Stack

- **React 18** — UI framework
- **Recharts** — Charts and data visualization
- **PDF.js** — Client-side PDF text extraction (loaded from CDN)
- **Vite** — Build tool

## 🤝 Contributing

Contributions are welcome! Some ideas:

- Support for more hospital billing formats
- Export analysis as PDF/Excel
- Bill comparison (upload 2 bills to see growth)
- Multi-language support (Hindi, Bengali, etc.)

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

## ⚠️ Disclaimer

This tool is for **informational purposes only**. It helps patients understand their hospital bills better. It is not a substitute for professional financial or medical advice. Always verify charges directly with the hospital billing department.

---

Built with ❤️ for patients and families navigating hospital bills.
