import { createWorker, PSM } from "tesseract.js";
import { parseStickerList, normalizeStickerListText } from "./stickerListParser.js";

/** @typedef {import('./stickerListParser.js').MatchedSticker} MatchedSticker */

let workerPromise = null;

export async function initOcrWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: onProgress
          ? (m) => {
              if (m.status === "recognizing text" && typeof m.progress === "number") {
                onProgress(m.progress);
              }
            }
          : () => {},
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
      });
      return worker;
    })();
  }
  return workerPromise;
}

function preprocessCanvas(sourceCanvas) {
  const maxW = 1200;
  let w = sourceCanvas.width;
  let h = sourceCanvas.height;
  if (w > maxW) {
    h = Math.round(h * (maxW / w));
    w = maxW;
  }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return sourceCanvas;
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
    const v = boosted > 145 ? 255 : boosted < 75 ? 0 : boosted;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function captureCropRegion(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error("Espera a que la cámara esté lista");

  const cropW = vw * 0.88;
  const cropH = vh * 0.24;
  const cropX = (vw - cropW) / 2;
  const cropY = vh * 0.36;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropW);
  canvas.height = Math.round(cropH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo capturar la imagen");
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return preprocessCanvas(canvas);
}

function cropImageCanvas(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const cropH = Math.round(h * 0.28);
  const cropY = Math.round(h * 0.34);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = w;
  cropCanvas.height = cropH;
  const ctx = cropCanvas.getContext("2d");
  if (!ctx) return sourceCanvas;
  ctx.drawImage(sourceCanvas, 0, cropY, w, cropH, 0, 0, w, cropH);
  return preprocessCanvas(cropCanvas);
}

export function captureFromImageElement(image) {
  const maxDim = 1600;
  let w = image.naturalWidth || image.width;
  let h = image.naturalHeight || image.height;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo leer la foto");
  ctx.drawImage(image, 0, 0, w, h);
  return cropImageCanvas(canvas);
}

function fixOcrDigits(s) {
  return s
    .replace(/[OQ]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/S/g, "5")
    .replace(/^0+(\d)/, "$1");
}

function buildSearchTexts(ocrText) {
  const upper = String(ocrText || "").toUpperCase();
  const texts = new Set();
  texts.add(normalizeStickerListText(upper.replace(/\bCC\b/g, "COC")));

  for (const m of upper.matchAll(/\b(FWC|CC|COC|[A-Z]{3})\s*[:\-]?\s*([0-9OQIILS]{1,2})\b/g)) {
    const team = m[1] === "CC" ? "COC" : m[1];
    const slot = parseInt(fixOcrDigits(m[2]), 10);
    if (slot >= 1 && slot <= 20) texts.add(`${team} ${slot}`);
  }
  for (const m of upper.matchAll(/(FWC|CC|COC|[A-Z]{3})([0-9OQIILS]{1,2})/g)) {
    const team = m[1] === "CC" ? "COC" : m[1];
    const slot = parseInt(fixOcrDigits(m[2]), 10);
    if (slot >= 1 && slot <= 20) texts.add(`${team} ${slot}`);
  }

  return [...texts].filter(Boolean);
}

/**
 * @param {string} ocrText
 * @param {ReturnType<typeof import('./stickerListParser.js').buildCatalogIndex>} catalog
 */
export function matchOcrText(ocrText, catalog) {
  const candidates = buildSearchTexts(ocrText);
  /** @type {Map<string, MatchedSticker>} */
  const seen = new Map();

  for (const text of candidates) {
    const result = parseStickerList(text, catalog, { mode: "owned" });
    for (const m of result.matched) {
      const key = `${m.teamCode}:${m.slot}`;
      if (!seen.has(key)) seen.set(key, m);
    }
  }

  const unique = [...seen.values()];
  if (unique.length === 1) {
    return { match: unique[0], alternatives: [], ocrText, candidates };
  }
  if (unique.length > 1) {
    return { match: unique[0], alternatives: unique.slice(1), ocrText, candidates };
  }
  return { match: null, alternatives: [], ocrText, candidates };
}

export async function recognizeFromCanvas(canvas, onProgress) {
  const worker = await initOcrWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text || "";
}

export async function recognizeFromVideo(video, catalog, onProgress) {
  const canvas = captureCropRegion(video);
  const text = await recognizeFromCanvas(canvas, onProgress);
  return { ...matchOcrText(text, catalog), previewCanvas: canvas };
}

export async function recognizeFromFile(file, catalog, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = captureFromImageElement(img);
    const text = await recognizeFromCanvas(canvas, onProgress);
    return { ...matchOcrText(text, catalog), previewCanvas: canvas };
  } finally {
    URL.revokeObjectURL(url);
  }
}
