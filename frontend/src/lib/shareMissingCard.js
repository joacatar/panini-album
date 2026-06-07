/** Texto formateado para compartir faltantes (WhatsApp, etc.). */

export function shareTeamCode(code) {
  if (code === "COC") return "CC";
  return code;
}

function slotList(missing, { sep = ", " } = {}) {
  return missing.map((s) => s.team_slot).join(sep);
}

/**
 * Texto bonito para WhatsApp (*negritas* nativas).
 */
export function formatMissingShareText(groups, meta = {}) {
  const count = meta.total ?? groups.reduce((n, g) => n + g.missing.length, 0);
  const pct = meta.pct ?? 0;
  const filter =
    meta.filterLabel && meta.filterLabel !== "Todos" ? `\n📂 ${meta.filterLabel}` : "";

  const lines = [
    `📋 *ME FALTAN · ${count}*`,
    `Mundial FIFA 2026 — Panini`,
    `✅ *${pct}%* del álbum completo${filter}`,
    "",
    "────────────────",
    "",
  ];

  for (const g of groups) {
    const flag = g.flag || "⚽";
    const code = shareTeamCode(g.team_code);
    const nums = slotList(g.missing);
    if (g.missing.length >= 4) {
      lines.push(`${flag} *${code}*`);
      lines.push(`   ${slotList(g.missing, { sep: " · " })}`);
    } else {
      lines.push(`${flag} *${code}*  ${nums}`);
    }
  }

  lines.push("", "🔄 Intercambio Panini WC 2026");
  return lines.join("\n");
}

/** Formato plano para otras apps Panini. */
export function formatMissingSharePlain(groups, meta = {}) {
  const count = meta.total ?? groups.reduce((n, g) => n + g.missing.length, 0);
  const pct = meta.pct != null ? ` · ${meta.pct}% completo` : "";
  const lines = [`Missing stickers (${count})${pct}`, "Panini WC 2026"];
  for (const g of groups) {
    lines.push(`${shareTeamCode(g.team_code)} ${slotList(g.missing)}`);
  }
  return lines.join("\n");
}

/** Vista previa HTML estilo mensaje de chat. */
export function renderMissingSharePreviewHtml(groups, meta = {}) {
  const count = meta.total ?? groups.reduce((n, g) => n + g.missing.length, 0);
  const pct = meta.pct ?? 0;
  const filterNote =
    meta.filterLabel && meta.filterLabel !== "Todos"
      ? `<span class="share-msg-filter">${meta.filterLabel}</span>`
      : "";

  const rows = groups
    .map((g) => {
      const code = shareTeamCode(g.team_code);
      const slots = g.missing
        .map((s) => `<span class="share-msg-num">${s.team_slot}</span>`)
        .join('<span class="share-msg-dot">·</span>');
      return `
        <div class="share-msg-row">
          <span class="share-msg-flag">${g.flag || "⚽"}</span>
          <span class="share-msg-code">${code}</span>
          <span class="share-msg-slots">${slots}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="share-message-card">
      <div class="share-message-bubble">
        <div class="share-message-header">
          <span class="share-msg-title">Me faltan · ${count}</span>
          <span class="share-msg-pct">${pct}% ✅</span>
        </div>
        <p class="share-msg-sub">Mundial FIFA 2026 — Panini ${filterNote}</p>
        <div class="share-message-rows">${rows}</div>
      </div>
      <p class="share-message-foot">Vista previa del mensaje</p>
    </div>`;
}

import { copyTextToClipboard } from "./copyText.js";

export async function copyMissingShareText(groups, meta, { plain = false } = {}) {
  const text = plain ? formatMissingSharePlain(groups, meta) : formatMissingShareText(groups, meta);
  await copyTextToClipboard(text);
  return text;
}

/** Abre WhatsApp con el mensaje listo (funciona en HTTP / IP local). */
export async function openWhatsAppShare(groups, meta) {
  const text = formatMissingShareText(groups, meta);
  try {
    await copyTextToClipboard(text);
  } catch {
    /* opcional */
  }

  if (navigator.share && window.isSecureContext) {
    try {
      await navigator.share({ text });
      return { method: "native-share" };
    } catch (err) {
      if (err?.name === "AbortError") return { method: "cancelled" };
    }
  }

  window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  return { method: "whatsapp" };
}

export function invalidateShareCache() {}
