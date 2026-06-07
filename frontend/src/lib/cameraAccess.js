/** @typedef {{ reason: string, title: string, detail: string, action: string, httpsHint?: string }} CameraBlockInfo */

export function canUseLiveCamera() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** @returns {CameraBlockInfo | null} */
export function getLiveCameraBlockInfo() {
  if (typeof window === "undefined") return null;

  if (!window.isSecureContext) {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return null;
    return {
      reason: "insecure",
      title: "Modo foto (normal en iPhone)",
      detail: `Estás en ${location.protocol}//${location.host}. La cámara en vivo dentro de la página no funciona en HTTP — es una regla de Safari, no un error tuyo.`,
      action: "Toca «Tomar foto»: abre la cámara del iPhone, tomas la foto del reverso y listo. No necesitas HTTPS.",
    };
  }

  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return {
      reason: "unsupported",
      title: "Cámara en vivo no disponible",
      detail: "Este navegador no expone la API de cámara en la página.",
      action: "Usa «Tomar foto» o escribe el código con el teclado.",
    };
  }

  return null;
}

/** @param {unknown} err */
export function formatCameraError(err) {
  const block = getLiveCameraBlockInfo();
  if (block) return block;

  const name = /** @type {{ name?: string, message?: string }} */ (err)?.name || "";
  if (name === "NotAllowedError") {
    return {
      reason: "denied",
      title: "Permiso de cámara denegado",
      detail: "Safari no dejó usar la cámara.",
      action: "Ajustes → Safari → Cámara → Permitir. O usa «Tomar foto».",
    };
  }
  if (name === "NotFoundError") {
    return {
      reason: "notfound",
      title: "Sin cámara",
      detail: "No se encontró cámara en este dispositivo.",
      action: "Usa «Tomar foto» o el teclado.",
    };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return {
      reason: "busy",
      title: "Cámara ocupada",
      detail: "Otra app puede estar usando la cámara.",
      action: "Ciérrala e intenta de nuevo, o usa «Tomar foto».",
    };
  }

  return {
    reason: "error",
    title: "No se pudo abrir la cámara",
    detail: /** @type {{ message?: string }} */ (err)?.message || "Error desconocido",
    action: "Usa «Tomar foto» o el teclado.",
  };
}

/**
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(videoEl) {
  const block = getLiveCameraBlockInfo();
  if (block) {
    const error = new Error(block.detail);
    error.name = "InsecureContextError";
    throw error;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.setAttribute("playsinline", "");
    videoEl.muted = true;
    await videoEl.play();
    return stream;
  } catch (err) {
    const info = formatCameraError(err);
    const error = new Error(info.detail);
    error.name = /** @type {string} */ (/** @type {{ name?: string }} */ (err)?.name || "CameraError");
    throw error;
  }
}

/** @param {MediaStream | null | undefined} stream */
export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}
