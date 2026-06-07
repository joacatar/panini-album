import { shareTeamCode } from "./shareMissingCard.js";
import { copyTextToClipboard } from "./copyText.js";
import { stickerKindMark } from "./collectionCopies.js";

function formatSlotList(items, { sep = ", " } = {}) {
  return items
    .map((s) => {
      const mark = stickerKindMark(s);
      return mark ? `${s.team_slot}${mark}` : String(s.team_slot);
    })
    .join(sep);
}

function teamShareLine(g) {
  const flag = g.flag || "⚽";
  const code = shareTeamCode(g.team_code);
  const name = g.team_name && g.team_name !== g.team_code ? g.team_name : null;
  return name ? `${flag} *${name}* (${code})` : `${flag} *${code}*`;
}

/**
 * @param {Array<{ team_code: string, flag?: string, duplicates: Array<{ team_slot: number }> }>} groups
 */
export function formatDuplicatesShareText(groups, meta = {}) {
  const count = meta.total ?? groups.reduce((n, g) => n + g.duplicates.length, 0);
  const filter =
    meta.filterLabel && meta.filterLabel !== "Todos" ? `\n📂 ${meta.filterLabel}` : "";

  const lines = [
    `📦 *REPETIDAS · ${count}*`,
    `Mundial FIFA 2026 — Panini`,
    `Lista para intercambiar${filter}`,
    "",
    "────────────────",
    "",
  ];

  for (const g of groups) {
    const head = teamShareLine(g);
    const nums = formatSlotList(g.duplicates);
    if (g.duplicates.length >= 4) {
      lines.push(head);
      lines.push(`   ${formatSlotList(g.duplicates, { sep: " · " })}`);
    } else {
      lines.push(`${head}  ${nums}`);
    }
  }

  lines.push("", "🔄 Intercambio Panini WC 2026");
  return lines.join("\n");
}

export function formatDuplicatesSharePlain(groups, meta = {}) {
  const count = meta.total ?? groups.reduce((n, g) => n + g.duplicates.length, 0);
  const lines = [`Duplicates (${count})`, "Panini WC 2026"];
  for (const g of groups) {
    const name = g.team_name && g.team_name !== g.team_code ? `${g.team_name} ` : "";
    lines.push(`${name}${shareTeamCode(g.team_code)} ${formatSlotList(g.duplicates)}`);
  }
  return lines.join("\n");
}

export function renderDuplicatesSharePreviewHtml(groups, meta = {}) {
  const count = meta.total ?? groups.reduce((n, g) => n + g.duplicates.length, 0);
  const filterNote =
    meta.filterLabel && meta.filterLabel !== "Todos"
      ? `<span class="share-msg-filter">${meta.filterLabel}</span>`
      : "";

  const rows = groups
    .map((g) => {
      const code = shareTeamCode(g.team_code);
      const slots = g.duplicates
        .map((s) => {
          const mark = stickerKindMark(s);
          return `<span class="share-msg-num share-msg-num--dup">${s.team_slot}${mark}</span>`;
        })
        .join('<span class="share-msg-dot">·</span>');
      const name =
        g.team_name && g.team_name !== g.team_code
          ? `<span class="share-msg-name">${g.team_name}</span>`
          : "";
      return `
        <div class="share-msg-row">
          <span class="share-msg-flag">${g.flag || "⚽"}</span>
          <span class="share-msg-team">
            <span class="share-msg-code share-msg-code--dup">${code}</span>
            ${name}
          </span>
          <span class="share-msg-slots">${slots}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="share-message-card share-message-card--dup">
      <div class="share-message-bubble share-message-bubble--dup">
        <div class="share-message-header">
          <span class="share-msg-title">Repetidas · ${count}</span>
        </div>
        <p class="share-msg-sub">Para intercambiar · Panini WC 2026 ${filterNote}</p>
        <div class="share-message-rows">${rows}</div>
      </div>
      <p class="share-message-foot">Vista previa · copia o envía por WhatsApp</p>
    </div>`;
}

export async function copyDuplicatesShareText(groups, meta, { plain = false } = {}) {
  const text = plain ? formatDuplicatesSharePlain(groups, meta) : formatDuplicatesShareText(groups, meta);
  await copyTextToClipboard(text);
  return text;
}

export async function openDuplicatesWhatsApp(groups, meta) {
  const text = formatDuplicatesShareText(groups, meta);
  try {
    await copyTextToClipboard(text);
  } catch {
    /* WhatsApp sigue aunque no copie */
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
