/** Copiar texto con fallbacks para Safari / HTTP sin contexto seguro. */

export async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) throw new Error("No hay texto para copiar.");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* execCommand fallback */
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);

  if (ok) return true;
  throw new Error("No se pudo copiar. Usa el cuadro de texto que aparecerá.");
}
