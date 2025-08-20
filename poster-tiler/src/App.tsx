import React, { useEffect, useMemo, useRef, useState } from "react";
import DoorTags from "./DoorTags";
import { jsPDF } from "jspdf";

/* ---------- shared constants ---------- */
const PAPER = {
  A4: { w: 210, h: 297 },
  Letter: { w: 216, h: 279 },
} as const;
type PaperKey = keyof typeof PAPER;

const LIMITS = {
  colsRows: { min: 1, max: 20, fallback: 3 },
  dpi: { min: 96, max: 600, fallback: 300 },
  mm: { min: 0, max: 20 },
};

const BRAND = "PosterSplitter";

/* ---------- guardrails ---------- */
const SIZE_LIMIT_MB = 60;
const MAX_TILES = 8 * 8;
const MP_HIGH = 50;
const MP_MED = 25;

/* ---------- utils ---------- */
function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }
function toIntInRange(raw: string, min: number, max: number, fallback: number) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return clamp(n, min, max);
}
const mmToIn = (mm: number) => mm / 25.4;
const mmToPx = (mm: number, dpi: number) => Math.round(mmToIn(mm) * clamp(dpi, LIMITS.dpi.min, LIMITS.dpi.max));
function cx(...xs: Array<string | false | null | undefined>) { return xs.filter(Boolean).join(" "); }
function computeSafeDpi(img: HTMLImageElement | null, requested: number) {
  if (!img) return { dpi: requested, reason: "" };
  const mega = (img.width * img.height) / 1e6;
  let dpi = requested; let reason = "";
  if (mega > MP_HIGH) { if (requested > 200) { dpi = 200; reason = `Large image (${mega.toFixed(1)} MP): DPI capped to 200.`; } }
  else if (mega > MP_MED) { if (requested > 240) { dpi = 240; reason = `Big image (${mega.toFixed(1)} MP): DPI capped to 240.`; } }
  dpi = clamp(dpi, LIMITS.dpi.min, LIMITS.dpi.max);
  return { dpi, reason };
}

/* ---------- Poster Splitter ---------- */
function PosterSplitter() {
  // theme
  const [theme, setTheme] = useState<"light" | "dark">(
    (localStorage.getItem("ps-theme") as "light" | "dark") || "light"
  );
  useEffect(() => {
    localStorage.setItem("ps-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // image
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!file) return setImg(null);
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { setImg(i); URL.revokeObjectURL(url); };
    i.src = url;
  }, [file]);

  // inputs
  const [colsRaw, setColsRaw] = useState("3");
  const [rowsRaw, setRowsRaw] = useState("3");
  const [marginRaw, setMarginRaw] = useState("0");
  const [overlapRaw, setOverlapRaw] = useState("5");
  const [dpiRaw, setDpiRaw] = useState("300");
  const [paper, setPaper] = useState<PaperKey>("A4");
  const [fitMode, setFitMode] = useState<"cover" | "contain">("cover");
  const [trim, setTrim] = useState(true);
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");

  const cols = toIntInRange(colsRaw, LIMITS.colsRows.min, LIMITS.colsRows.max, LIMITS.colsRows.fallback);
  const rows = toIntInRange(rowsRaw, LIMITS.colsRows.min, LIMITS.colsRows.max, LIMITS.colsRows.fallback);
  const margin = toIntInRange(marginRaw, LIMITS.mm.min, LIMITS.mm.max, 0);
  const overlap = toIntInRange(overlapRaw, LIMITS.mm.min, LIMITS.mm.max, 5);
  const requestedDpi = toIntInRange(dpiRaw, LIMITS.dpi.min, LIMITS.dpi.max, LIMITS.dpi.fallback);

  const base = PAPER[paper];
  const imgIsLandscape = img ? img.width >= img.height : true;
  const effOrientation = orientation === "auto" ? (imgIsLandscape ? "landscape" : "portrait") : orientation;
  const P = effOrientation === "portrait" ? base : { w: base.h, h: base.w };

  const { dpi: effectiveDpi, reason: dpiReason } = useMemo(
    () => computeSafeDpi(img, requestedDpi), [img, requestedDpi]
  );

  const bigFileWarning =
    file && file.size > SIZE_LIMIT_MB * 1024 * 1024
      ? `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. If PDF generation is slow or black, try lower DPI or fewer tiles.`
      : "";

  // preview
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;

    const contentWpx = mmToPx(P.w - 2 * margin, effectiveDpi);
    const contentHpx = mmToPx(P.h - 2 * margin, effectiveDpi);
    const overlapPx = mmToPx(overlap, effectiveDpi);

    const tgtW = cols * contentWpx - (cols - 1) * overlapPx;
    const tgtH = rows * contentHpx - (rows - 1) * overlapPx;

    const sW = img.width, sH = img.height;
    const scaleCover = Math.max(tgtW / sW, tgtH / sH);
    const scaleContain = Math.min(tgtW / sW, tgtH / sH);
    const scale = fitMode === "cover" ? scaleCover : scaleContain;
    const drawW = sW * scale;
    const drawH = sH * scale;
    const dx = (tgtW - drawW) / 2;
    const dy = (tgtH - drawH) / 2;

    const maxSide = 900;
    const k = Math.min(maxSide / tgtW, maxSide / tgtH) || 1;
    c.width = Math.max(1, Math.round(tgtW * k));
    c.height = Math.max(1, Math.round(tgtH * k));

    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = theme === "dark" ? "#0f172a" : "#f8fafc";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, sW, sH, Math.round(dx * k), Math.round(dy * k), Math.round(drawW * k), Math.round(drawH * k));

    // grid
    ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    const stepX = (contentWpx - overlapPx) * k;
    const stepY = (contentHpx - overlapPx) * k;
    for (let i = 1; i < cols; i++) { const x = Math.round(i * stepX); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); }
    for (let j = 1; j < rows; j++) { const y = Math.round(j * stepY); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); }
  }, [img, P.w, P.h, margin, overlap, effectiveDpi, cols, rows, fitMode, theme]);

  async function generatePDF() {
    if (!img) return alert("Please upload an image first.");
    if (rows * cols > MAX_TILES) { alert(`That’s a lot of pages (${rows}×${cols}). Keep tiles ≤ ${Math.sqrt(MAX_TILES)}×${Math.sqrt(MAX_TILES)}.`); return; }

    const contentWpx = mmToPx(P.w - 2 * margin, effectiveDpi);
    const contentHpx = mmToPx(P.h - 2 * margin, effectiveDpi);
    const overlapPx = mmToPx(overlap, effectiveDpi);

    const tgtW = cols * contentWpx - (cols - 1) * overlapPx;
    const tgtH = rows * contentHpx - (rows - 1) * overlapPx;
    if (tgtW * tgtH > 12000 * 12000) { alert("Output canvas would be extremely large. Lower DPI/tiles."); return; }

    const master = document.createElement("canvas");
    master.width = tgtW; master.height = tgtH;
    const mctx = master.getContext("2d")!;
    const sW = img.width, sH = img.height;
    const scaleCover = Math.max(tgtW / sW, tgtH / sH);
    const scaleContain = Math.min(tgtW / sW, tgtH / sH);
    const scale = fitMode === "cover" ? scaleCover : scaleContain;
    const drawW = Math.round(sW * scale);
    const drawH = Math.round(sH * scale);
    const dx = Math.round((tgtW - drawW) / 2);
    const dy = Math.round((tgtH - drawH) / 2);

    mctx.fillStyle = "#ffffff"; mctx.fillRect(0, 0, master.width, master.height);
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(img, dx, dy, drawW, drawH);

    const jsOrientation = ((orientation === "auto" ? (imgIsLandscape ? "landscape" : "portrait") : orientation) === "landscape" ? "landscape" : "portrait") as "portrait" | "landscape";

    const doc = new jsPDF({ unit: "mm", format: [P.w, P.h], orientation: jsOrientation, compress: true });
    const contentWmm = P.w - 2 * margin; const contentHmm = P.h - 2 * margin;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!(r === 0 && c === 0)) doc.addPage([P.w, P.h], jsOrientation);
        const sx = c * (contentWpx - overlapPx);
        const sy = r * (contentHpx - overlapPx);

        const tile = document.createElement("canvas");
        tile.width = contentWpx; tile.height = contentHpx;
        const tctx = tile.getContext("2d")!;
        tctx.imageSmoothingQuality = "high";
        tctx.drawImage(master, sx, sy, contentWpx, contentHpx, 0, 0, contentWpx, contentHpx);

        if (trim) {
          tctx.strokeStyle = "rgba(0,0,0,0.5)"; tctx.lineWidth = 1;
          const m = Math.round(Math.min(contentWpx, contentHpx) * 0.02);
          tctx.beginPath();
          tctx.moveTo(0, 0); tctx.lineTo(m, 0); tctx.moveTo(0, 0); tctx.lineTo(0, m);
          tctx.moveTo(contentWpx, 0); tctx.lineTo(contentWpx - m, 0); tctx.moveTo(contentWpx, 0); tctx.lineTo(contentWpx, m);
          tctx.moveTo(0, contentHpx); tctx.lineTo(m, contentHpx); tctx.moveTo(0, contentHpx); tctx.lineTo(0, contentHpx - m);
          tctx.moveTo(contentWpx, contentHpx); tctx.lineTo(contentWpx - m, contentHpx); tctx.moveTo(contentWpx, contentHpx); tctx.lineTo(contentWpx, contentHpx - m);
          tctx.stroke();
        }

        const dataURL = tile.toDataURL("image/jpeg", 0.95);
        doc.addImage(dataURL, "JPEG", margin, margin, contentWmm, contentHmm, undefined, "FAST");
      }
    }
    doc.save(`${BRAND}.pdf`);
  }

  return (
    <>
      <section className="lg:col-span-1">
        <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Poster Splitter</h2>
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              className="rounded-full border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              {theme === "light" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Upload image</label>
            <input id="file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
            <label htmlFor="file" className={cx("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm cursor-pointer","border border-gray-300 dark:border-slate-700","bg-white/60 dark:bg-slate-800/60","hover:bg-white/80 hover:shadow-sm dark:hover:bg-slate-700/70")}>⬆️ Choose file</label>
            {file && (<p className="mt-2 text-xs text-gray-500 dark:text-slate-400 break-all">{file.name} ({Math.round((file.size/1024/1024)*100)/100} MB)</p>)}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm mb-1">Columns</label>
              <input type="number" min={LIMITS.colsRows.min} max={LIMITS.colsRows.max} value={colsRaw} onChange={(e)=>setColsRaw(e.target.value)} onBlur={()=>setColsRaw(String(cols))} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/></div>
            <div><label className="block text-sm mb-1">Rows</label>
              <input type="number" min={LIMITS.colsRows.min} max={LIMITS.colsRows.max} value={rowsRaw} onChange={(e)=>setRowsRaw(e.target.value)} onBlur={()=>setRowsRaw(String(rows))} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm mb-1">Margin (mm)</label>
              <input type="number" min={LIMITS.mm.min} max={LIMITS.mm.max} value={marginRaw} onChange={(e)=>setMarginRaw(e.target.value)} onBlur={()=>setMarginRaw(String(margin))} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/></div>
            <div><label className="block text-sm mb-1">Overlap (mm)</label>
              <input type="number" min={LIMITS.mm.min} max={LIMITS.mm.max} value={overlapRaw} onChange={(e)=>setOverlapRaw(e.target.value)} onBlur={()=>setOverlapRaw(String(overlap))} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm mb-1">Paper</label>
              <select value={paper} onChange={(e)=>setPaper(e.target.value as PaperKey)} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="Letter">Letter (8.5 × 11 in)</option>
              </select></div>
            <div><label className="block text-sm mb-1">DPI</label>
              <input type="number" min={LIMITS.dpi.min} max={LIMITS.dpi.max} value={dpiRaw} onChange={(e)=>setDpiRaw(e.target.value)} onBlur={()=>setDpiRaw(String(clamp(parseInt(dpiRaw||"0",10)||LIMITS.dpi.fallback, LIMITS.dpi.min, LIMITS.dpi.max)))} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm mb-1">Orientation</label>
              <select value={orientation} onChange={(e)=>setOrientation(e.target.value as any)} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="auto">Auto (match image)</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select></div>
            <div><label className="block text-sm mb-1">Fit</label>
              <select value={fitMode} onChange={(e)=>setFitMode(e.target.value as "cover" | "contain")} className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="cover">Fill (crop)</option>
                <option value="contain">Fit (letterbox)</option>
              </select></div>
          </div>

          {(dpiReason || bigFileWarning) && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{dpiReason || bigFileWarning}</p>
          )}

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={trim} onChange={(e)=>setTrim(e.target.checked)} />
            <span className="text-sm">Trim marks</span>
          </label>

          <button onClick={generatePDF} disabled={!img} className={cx("w-full rounded-full px-4 py-2.5 text-sm font-semibold","bg-indigo-600 text-white hover:bg-indigo-500","disabled:opacity-50 disabled:cursor-not-allowed")}>
            Generate PDF
          </button>
        </div>
      </section>

      <section className="lg:col-span-2">
        <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Preview</h2>
            <span className="text-xs text-gray-500 dark:text-slate-400">Grid reflects tile boundaries & overlap.</span>
          </div>

          {/* FIX: keep a tall placeholder when no image */}
          <div className="overflow-auto rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 p-2">
            {!img ? (
              <div className="grid h-72 place-items-center text-sm text-gray-500 dark:text-slate-400">
                Upload an image to see the preview.
              </div>
            ) : (
              <canvas ref={canvasRef} className="block max-w-full" />
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- App with tabs ---------- */
export default function App() {
  const [tab, setTab] = useState<"splitter" | "door">("splitter");
  return (
    <div className={cx("min-h-screen","bg-gray-50 text-gray-900","dark:bg-slate-950 dark:text-slate-100")}>
      <header className="border-b border-gray-200 bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-indigo-600/90 dark:bg-indigo-500 grid place-items-center text-white font-bold">PS</div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">PosterSplitter</h1>
          </div>

          <nav className="flex items-center gap-2">
            <button
              className={cx("px-3 py-1.5 rounded-full text-sm border", tab==="splitter" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700")}
              onClick={() => setTab("splitter")}
            >Poster Splitter</button>
            <button
              className={cx("px-3 py-1.5 rounded-full text-sm border", tab==="door" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700")}
              onClick={() => setTab("door")}
            >Door Tags</button>
          </nav>
        </div>
      </header>

      {/* FIX: Door Tags wants full width; Poster Splitter uses 3 columns */}
      <main className={cx("mx-auto max-w-6xl px-6 py-6 grid gap-6", tab === "splitter" ? "lg:grid-cols-3" : "lg:grid-cols-1")}>
        {tab === "splitter" ? <PosterSplitter /> : <DoorTags />}
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-xs text-gray-500 dark:text-slate-400">
        Built locally — your images never leave the browser.
      </footer>
    </div>
  );
}
