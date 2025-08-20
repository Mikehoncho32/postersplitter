// src/DoorTags.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";

const PAPER = {
  A4: { w: 210, h: 297 },
  Letter: { w: 216, h: 279 },
} as const;
type PaperKey = keyof typeof PAPER;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function DoorTags() {
  // Inputs
  const [paper, setPaper] = useState<PaperKey>("A4");
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(3);
  const [margin, setMargin] = useState(10);   // mm page margin
  const [gutter, setGutter] = useState(4);    // mm between tags
  const [includePhoto, setIncludePhoto] = useState(true);
  const [fontSize, setFontSize] = useState(18); // pt for names
  const [dpi, setDpi] = useState(300);

  // Names
  const [namesRaw, setNamesRaw] = useState<string>("");
  const [names, setNames] = useState<string[]>([]);
  const [nameEdits, setNameEdits] = useState<string[]>([]);

  // Images (multiple)
  const [files, setFiles] = useState<File[]>([]);
  const [imageURLs, setImageURLs] = useState<string[]>([]);

  // Image assignment per name (index into imageURLs, or -1 for none)
  const [imgIndexByName, setImgIndexByName] = useState<number[]>([]);

  // Parse names whenever namesRaw changes
  useEffect(() => {
    const list = namesRaw
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    setNames(list);
    setNameEdits(list);
    setImgIndexByName((prev) => {
      const arr = [...prev];
      arr.length = list.length;
      for (let i = 0; i < list.length; i++) {
        if (typeof arr[i] !== "number") arr[i] = imageURLs.length ? (i % imageURLs.length) : -1;
      }
      return arr;
    });
  }, [namesRaw, imageURLs.length]);

  // Build image object URLs and clean up
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setImageURLs(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const P = PAPER[paper];

  const tagSize = useMemo(() => {
    const contentW = P.w - 2 * margin;
    const contentH = P.h - 2 * margin;
    const w = (contentW - gutter * (cols - 1)) / cols;
    const h = (contentH - gutter * (rows - 1)) / rows;
    return { w, h };
  }, [P.w, P.h, margin, gutter, cols, rows]);

  function handleCSVUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result || "");
      const lines = txt.split(/\r?\n/).filter(Boolean);
      let extracted: string[] = [];
      const header = lines[0]?.split(",").map((s) => s.trim().toLowerCase());
      const nameCol = header?.findIndex((h) => ["name", "full name"].includes(h)) ?? -1;
      if (nameCol >= 0) {
        extracted = lines.slice(1).map((ln) => (ln.split(",")[nameCol] || "").trim()).filter(Boolean);
      } else {
        extracted = lines.map((ln) => ln.split(",")[0]?.trim()).filter(Boolean);
      }
      setNamesRaw(extracted.join("\n"));
    };
    reader.readAsText(file);
  }

  async function generatePDF() {
    if (!names.length) {
      alert("Please add at least one name.");
      return;
    }

    const doc = new jsPDF({
      unit: "mm",
      format: [P.w, P.h],
      orientation: P.w >= P.h ? "landscape" : "portrait",
      compress: true,
    });

    const contentLeft = margin;
    const contentTop = margin;

    const pageCount = Math.ceil(names.length / (rows * cols));
    let nameIdx = 0;

    for (let p = 0; p < pageCount; p++) {
      if (p > 0) doc.addPage([P.w, P.h], P.w >= P.h ? "landscape" : "portrait");

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (nameIdx >= names.length) break;

          const x = contentLeft + c * (tagSize.w + gutter);
          const y = contentTop + r * (tagSize.h + gutter);

          // Draw tag background/frame
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(x, y, tagSize.w, tagSize.h, 2, 2, "F");

          // Optional photo
          const imgIdx = imgIndexByName[nameIdx];
          if (includePhoto && imgIdx >= 0 && imageURLs[imgIdx]) {
            const dataURL = await fetch(imageURLs[imgIdx]).then((res) => res.blob()).then(blobToDataURL);
            const pad = 2; // mm inner padding
            const imgW = tagSize.w - pad * 2;
            const imgH = tagSize.h * 0.6 - pad * 2;
            doc.addImage(dataURL, "JPEG", x + pad, y + pad, imgW, imgH, undefined, "FAST");
          }

          // Name text (centered)
          doc.setFont("helvetica", "bold");
          doc.setFontSize(fontSize);
          const label = nameEdits[nameIdx] || names[nameIdx];
          const textY = y + tagSize.h * 0.78;
          doc.text(label, x + tagSize.w / 2, textY, { align: "center", baseline: "middle" });

          // Optional thin border for cutting guides
          doc.setDrawColor(220, 220, 220);
          doc.roundedRect(x, y, tagSize.w, tagSize.h, 2, 2, "S");

          nameIdx++;
        }
      }
    }

    doc.save("door-tags.pdf");
  }

  function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
  }

  /* ---------- simple on-page preview (not pixel-perfect, just layout) ---------- */
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;

    // target preview size
    const maxW = 900, maxH = 600;
    // keep page aspect
    const k = Math.min(maxW / P.w, maxH / P.h);
    c.width = Math.max(1, Math.round(P.w * k));
    c.height = Math.max(1, Math.round(P.h * k));

    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);

    // page bg
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);

    // content rect
    const m = margin * k;
    const contentW = c.width - 2 * m;
    const contentH = c.height - 2 * m;

    // tiles
    const gw = gutter * k;
    const tileW = (contentW - gw * (cols - 1)) / cols;
    const tileH = (contentH - gw * (rows - 1)) / rows;

    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;

    for (let r = 0; r < rows; r++) {
      for (let c2 = 0; c2 < cols; c2++) {
        const x = m + c2 * (tileW + gw);
        const y = m + r * (tileH + gw);
        ctx.strokeRect(Math.round(x), Math.round(y), Math.round(tileW), Math.round(tileH));

        // photo area hint
        if (includePhoto) {
          ctx.fillStyle = "rgba(0,0,0,0.06)";
          ctx.fillRect(
            Math.round(x + 4),
            Math.round(y + 4),
            Math.round(tileW - 8),
            Math.round(tileH * 0.6 - 8)
          );
        }
      }
    }
  }, [P.w, P.h, margin, gutter, rows, cols, includePhoto]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5 space-y-5">
        <h2 className="text-lg font-semibold">Door Tags</h2>

        {/* Names input */}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1">Names (paste or type)</label>
            <textarea
              rows={8}
              placeholder={"One name per line\nJuan\nDevlin\nChuck"}
              value={namesRaw}
              onChange={(e) => setNamesRaw(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">…or upload CSV (with a “name” column or 1st column as names)</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleCSVUpload(e.target.files?.[0] || undefined)}
              className="block w-full text-sm"
            />

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">Photos (optional, multiple)</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="block w-full text-sm"
              />
              {imageURLs.length > 0 && (
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  Uploaded {imageURLs.length} image{imageURLs.length > 1 ? "s" : ""}.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Layout */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-sm mb-1">Paper</label>
            <select value={paper} onChange={(e) => setPaper(e.target.value as PaperKey)}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm">
              <option value="A4">A4 (210×297 mm)</option>
              <option value="Letter">Letter (8.5×11 in)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Rows</label>
            <input type="number" min={1} max={12} value={rows} onChange={(e) => setRows(clamp(parseInt(e.target.value || "1"), 1, 12))}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/>
          </div>
          <div>
            <label className="block text-sm mb-1">Cols</label>
            <input type="number" min={1} max={12} value={cols} onChange={(e) => setCols(clamp(parseInt(e.target.value || "1"), 1, 12))}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/>
          </div>
          <div>
            <label className="block text-sm mb-1">Margin (mm)</label>
            <input type="number" min={0} max={30} value={margin} onChange={(e) => setMargin(clamp(parseInt(e.target.value || "0"), 0, 30))}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/>
          </div>
          <div>
            <label className="block text-sm mb-1">Gutter (mm)</label>
            <input type="number" min={0} max={20} value={gutter} onChange={(e) => setGutter(clamp(parseInt(e.target.value || "0"), 0, 20))}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/>
          </div>
          <div>
            <label className="block text-sm mb-1">Name size (pt)</label>
            <input type="number" min={10} max={48} value={fontSize} onChange={(e) => setFontSize(clamp(parseInt(e.target.value || "18"), 10, 48))}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"/>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includePhoto} onChange={(e) => setIncludePhoto(e.target.checked)} />
            <span className="text-sm">Include photo on tag</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm">DPI</span>
            <input type="number" min={96} max={600} value={dpi} onChange={(e) => setDpi(clamp(parseInt(e.target.value || "300"), 96, 600))}
              className="w-24 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"/>
          </label>
        </div>
      </div>

      {/* Live layout preview */}
      <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Preview</h3>
          <span className="text-xs text-gray-500 dark:text-slate-400">Shows tile layout (not final pixels).</span>
        </div>
        <div className="overflow-auto rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 p-2">
          <canvas ref={previewRef} className="block max-w-full" />
        </div>
      </div>

      {/* Assignment table */}
      {!!names.length && (
        <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold">Assign photos & edit names</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-3">
                <input
                  value={nameEdits[i] ?? n}
                  onChange={(e) => {
                    const arr = [...nameEdits]; arr[i] = e.target.value; setNameEdits(arr);
                  }}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                />
                <select
                  value={imgIndexByName[i] ?? -1}
                  onChange={(e) => {
                    const arr = [...imgIndexByName]; arr[i] = parseInt(e.target.value, 10); setImgIndexByName(arr);
                  }}
                  className="w-40 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-sm"
                >
                  <option value={-1}>No photo</option>
                  {imageURLs.map((_, idx) => (
                    <option key={idx} value={idx}>Photo {idx + 1}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            onClick={generatePDF}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
          >
            Generate Door Tags PDF
          </button>
        </div>
      )}
    </div>
  );
}
