import { TEAM_FLAGS } from "./teamFlags.js";
import { albumOrderIndex } from "./teamSections.js";
import { parseStickerList } from "./stickerListParser.js";
import { shareTeamCode } from "./shareMissingCard.js";
import { copyTextToClipboard } from "./copyText.js";
import {
  isSpecialSticker,
  stickerKindMark,
  stickerKindTitle,
  totalCopiesFromRecord,
} from "./collectionCopies.js";

/** @typedef {{ sticker: object, teamCode: string, slot: number, key: string, myQty?: number, spareQty?: number, requestTier?: number | null, teFalta?: boolean, especial?: boolean, onlyOne?: boolean, esRepetida?: boolean, isPick?: boolean, manual?: boolean }} TradeItem */

export function stickerRefKey(teamCode, slot) {
  return `${teamCode}:${slot}`;
}

/** @param {Record<number, { owned?: boolean, duplicates?: number }>} collection @param {number} stickerId */
export function myQtyForSticker(collection, stickerId) {
  return totalCopiesFromRecord(collection[stickerId]);
}

/**
 * Prioridad para pedir (menor = mejor). null = no pedir (tengo ×3+).
 * 1 Especiales con 0–2 copias
 * 2 No tengo (0)
 * 3 Pocas repetidas (1–2)
 */
export function requestTier(myQty, sticker) {
  if (myQty >= 3) return null;
  if (isSpecialSticker(sticker) && myQty <= 2) return 1;
  if (myQty === 0) return 2;
  if (myQty >= 1 && myQty <= 2) return 3;
  return null;
}

export function requestTierLabel(tier) {
  if (tier === 0) return "Pick";
  if (tier === 1) return "Especial";
  if (tier === 2) return "Falta";
  if (tier === 3) return "Pocas";
  return "";
}

function applyPickBoost(item, pickSet) {
  if (pickSet?.has(item.key)) {
    item.isPick = true;
    item.requestTier = 0;
  }
  return item;
}

function itemFromMatch(m, collection, extra = {}) {
  const stickerId = m.sticker.id;
  const myQty = myQtyForSticker(collection, stickerId);
  const spareQty = myQty > 1 ? myQty - 1 : 0;
  const tier = requestTier(myQty, m.sticker);
  return {
    sticker: m.sticker,
    teamCode: m.teamCode,
    slot: m.slot,
    key: stickerRefKey(m.teamCode, m.slot),
    myQty,
    spareQty,
    requestTier: tier,
    teFalta: myQty === 0,
    especial: isSpecialSticker(m.sticker),
    onlyOne: myQty === 1,
    esRepetida: spareQty > 0,
    ...extra,
  };
}

function sortByAlbum(items) {
  return [...items].sort(
    (a, b) => albumOrderIndex(a.teamCode) - albumOrderIndex(b.teamCode) || a.slot - b.slot
  );
}

function sortOfferList(items) {
  return [...items].sort((a, b) => {
    const qa = a.myQty || 0;
    const qb = b.myQty || 0;
    if (qb !== qa) return qb - qa;
    return albumOrderIndex(a.teamCode) - albumOrderIndex(b.teamCode) || a.slot - b.slot;
  });
}

function sortRequestList(items) {
  return [...items].sort((a, b) => {
    const ta = a.isPick ? 0 : (a.requestTier ?? 99);
    const tb = b.isPick ? 0 : (b.requestTier ?? 99);
    if (ta !== tb) return ta - tb;
    return albumOrderIndex(a.teamCode) - albumOrderIndex(b.teamCode) || a.slot - b.slot;
  });
}

/**
 * 1. Tarjetas que YO puedo ofrecer (solo las que el amigo necesita y yo tengo ≥1).
 */
export function computeOfferList(partnerNeedsText, catalog, collection) {
  const partnerNeeds = parseStickerList(partnerNeedsText, catalog, { mode: "missing" });
  const seen = new Set();
  /** @type {TradeItem[]} */
  const list = [];
  for (const m of partnerNeeds.matched) {
    const key = stickerRefKey(m.teamCode, m.slot);
    if (seen.has(key)) continue;
    const myQty = myQtyForSticker(collection, m.sticker.id);
    if (myQty < 2) continue;
    seen.add(key);
    list.push(itemFromMatch(m, collection));
  }
  return sortOfferList(list);
}

/**
 * 2. Tarjetas que YO debería pedir (repetidas del amigo, sin incluir mis ×3+).
 */
export function computeRequestList(partnerDupsText, catalog, collection, priorityPickKeys = []) {
  const pickSet = new Set(priorityPickKeys || []);
  const partnerDups = parseStickerList(partnerDupsText, catalog, { mode: "duplicates" });
  const seen = new Set();
  /** @type {TradeItem[]} */
  const list = [];
  for (const m of partnerDups.matched) {
    const key = stickerRefKey(m.teamCode, m.slot);
    if (seen.has(key)) continue;
    const item = itemFromMatch(m, collection);
    if (item.requestTier == null && !pickSet.has(key)) continue;
    applyPickBoost(item, pickSet);
    if (item.requestTier == null) continue;
    seen.add(key);
    list.push(item);
  }
  return sortRequestList(list);
}

/** Cruce detallado para mostrar en UI (sin mensaje WhatsApp). */
export function computeTradeBreakdown(
  partnerDupsParsed,
  partnerNeedsParsed,
  canOffer,
  shouldRequest,
  collection,
  priorityPickKeys = []
) {
  const pickSet = new Set(priorityPickKeys || []);
  const needsMatched = partnerNeedsParsed.matched || [];
  const dupsMatched = partnerDupsParsed.matched || [];

  let friendNeedsYouDontHave = 0;
  for (const m of needsMatched) {
    if (!collection[m.sticker.id]?.owned) friendNeedsYouDontHave++;
  }

  const missingFromHisDups = shouldRequest.filter((i) => i.teFalta);
  const picksInHisList = shouldRequest.filter((i) => i.isPick);
  const picksInListKeys = new Set(picksInHisList.map((i) => i.key));
  let picksNotInHisList = 0;
  for (const key of pickSet) {
    if (!picksInListKeys.has(key)) picksNotInHisList++;
  }

  const specials = shouldRequest.filter((i) => i.especial && !i.isPick);
  const fewCopies = shouldRequest.filter((i) => i.requestTier === 3);

  return {
    friendNeedsTotal: needsMatched.length,
    friendNeedsYouCanFill: canOffer.length,
    friendNeedsYouDontHave,
    friendDupsTotal: dupsMatched.length,
    friendDupsYouCanAsk: shouldRequest.length,
    friendDupsYouMissing: missingFromHisDups.length,
    friendDupsSpecials: specials.length,
    friendDupsFewCopies: fewCopies.length,
    picksSaved: pickSet.size,
    picksInHisList: picksInHisList.length,
    picksNotInHisList,
  };
}

/**
 * Recorta listas al mismo tamaño (parejo). receiveList debe venir ya ordenada por prioridad.
 */
export function balanceTradeLists(giveList, receiveList, requestCandidates) {
  const n = Math.min(giveList.length, receiveList.length);
  if (n === 0) return { give: [], receive: [] };

  let receive = receiveList.slice(0, n);
  let give = giveList.slice(0, n);

  if (receive.length < n && requestCandidates?.length) {
    const used = new Set(receive.map((i) => i.key));
    for (const c of requestCandidates) {
      if (receive.length >= n) break;
      if (used.has(c.key)) continue;
      receive.push(c);
      used.add(c.key);
    }
    give = giveList.slice(0, receive.length);
  }

  return { give: sortOfferList(give), receive: sortRequestList(receive) };
}

export function balanceReceiveList(baseRequest, offerList, requestCandidates) {
  return balanceTradeLists(offerList, baseRequest, requestCandidates).receive;
}

/**
 * Trato sugerido parejo: prioriza dar repetidas; pide las mejores N según prioridad.
 */
export function buildSuggestedTrade(canOffer, shouldRequest) {
  const givePool = canOffer.filter((i) => (i.spareQty || 0) >= 1);

  if (!givePool.length || !shouldRequest.length) {
    return { give: [], receive: [], targetCount: 0 };
  }

  const targetCount = Math.min(givePool.length, shouldRequest.length);
  return {
    give: givePool.slice(0, targetCount),
    receive: shouldRequest.slice(0, targetCount),
    targetCount,
  };
}

/**
 * 4. Intercambio 1×1: cada mega mía (×3+) por una lámina pedible del amigo.
 */
export function computeMegaDuplicateSwap(
  stickers,
  partnerDupsText,
  catalog,
  collection,
  priorityPickKeys = []
) {
  const requestCandidates = computeRequestList(partnerDupsText, catalog, collection, priorityPickKeys);
  /** @type {TradeItem[]} */
  const myMegas = [];
  for (const s of stickers) {
    const myQty = myQtyForSticker(collection, s.id);
    if (myQty < 3) continue;
    myMegas.push({
      sticker: s,
      teamCode: s.team_code,
      slot: s.team_slot,
      key: stickerRefKey(s.team_code, s.team_slot),
      myQty,
      spareQty: myQty - 1,
      esRepetida: true,
    });
  }
  myMegas.sort((a, b) => (b.myQty || 0) - (a.myQty || 0));

  /** @type {TradeItem[]} */
  const give = [];
  /** @type {TradeItem[]} */
  const receive = [];
  const usedReceive = new Set();

  for (const mega of myMegas) {
    give.push(mega);
    const pick = requestCandidates.find((c) => !usedReceive.has(c.key));
    if (pick) {
      receive.push(pick);
      usedReceive.add(pick.key);
    }
  }

  return { give: sortOfferList(give), receive: sortRequestList(receive), pairs: give.length };
}

export function computeFlashTrade(
  partnerDupsText,
  partnerNeedsText,
  catalog,
  stickers,
  collection,
  priorityPickKeys = []
) {
  const partnerDups = parseStickerList(partnerDupsText, catalog, { mode: "duplicates" });
  const partnerNeeds = parseStickerList(partnerNeedsText, catalog, { mode: "missing" });

  const canOffer = computeOfferList(partnerNeedsText, catalog, collection);
  const shouldRequest = computeRequestList(partnerDupsText, catalog, collection, priorityPickKeys);
  const suggested = buildSuggestedTrade(canOffer, shouldRequest);
  const poolReceive = shouldRequest;
  const poolGive = canOffer;

  const breakdown = computeTradeBreakdown(
    partnerDups,
    partnerNeeds,
    canOffer,
    shouldRequest,
    collection,
    priorityPickKeys
  );

  return {
    canOffer,
    shouldRequest,
    iGive: suggested.give,
    iReceive: suggested.receive,
    suggestedCount: suggested.targetCount,
    poolReceive,
    poolGive,
    requestCandidates: shouldRequest,
    partnerDups,
    partnerNeeds,
    breakdown,
    stats: {
      ...breakdown,
      youGiveSelected: suggested.give.length,
      youReceiveSelected: suggested.receive.length,
    },
  };
}

export function renderTradeBreakdownHtml(bd, selectedGive, selectedReceive) {
  const selMissing = selectedReceive.filter((i) => i.teFalta).length;
  const selPicks = selectedReceive.filter((i) => i.isPick).length;
  const selSpecial = selectedReceive.filter((i) => i.especial && !i.isPick).length;
  const balance = selectedGive.length - selectedReceive.length;
  const balanceLabel = balance === 0
    ? "parejo"
    : balance > 0
      ? `das ${Math.abs(balance)} de más`
      : `pides ${Math.abs(balance)} de más`;
  const balanceCls = balance === 0 ? "flash-deal-badge--ok" : "flash-deal-badge--warn";

  return `
    <div class="flash-deal-status">
      <span class="flash-deal-badge ${balanceCls}">📤 ${selectedGive.length} ⇄ 📥 ${selectedReceive.length} · ${balanceLabel}</span>
      <span class="flash-deal-sub">${selMissing} te faltan${selPicks ? ` · ${selPicks} picks` : ""}${selSpecial ? ` · ${selSpecial} especiales` : ""}</span>
    </div>
    <details class="flash-breakdown card">
      <summary class="flash-breakdown-toggle">🔍 Ver desglose detallado</summary>
      <div class="flash-breakdown-body">
        <div class="flash-breakdown-section">
          <h4 class="flash-breakdown-heading">De lo que <strong>él necesita</strong></h4>
          <ul class="flash-breakdown-list">
            <li><span>${bd.friendNeedsTotal}</span> láminas en su lista de faltantes</li>
            <li><span class="flash-breakdown-good">${bd.friendNeedsYouCanFill}</span> tú tienes y puedes darle</li>
            <li><span class="flash-breakdown-warn">${bd.friendNeedsYouDontHave}</span> te faltan — no puedes darlas aún</li>
          </ul>
        </div>
        <div class="flash-breakdown-section">
          <h4 class="flash-breakdown-heading">De lo que <strong>él repite</strong></h4>
          <ul class="flash-breakdown-list">
            <li><span>${bd.friendDupsTotal}</span> láminas en su lista de repetidas</li>
            <li><span class="flash-breakdown-good">${bd.friendDupsYouCanAsk}</span> te conviene pedir (tú tienes menos de ×3)</li>
            <li><span class="flash-breakdown-need">${bd.friendDupsYouMissing}</span> de esas <strong>te faltan</strong> (×0 en tu álbum)</li>
            <li><span>${bd.friendDupsSpecials}</span> especiales · <span>${bd.friendDupsFewCopies}</span> con pocas (×1–2)</li>
          </ul>
        </div>
        ${
          bd.picksSaved
            ? `<div class="flash-breakdown-section flash-breakdown-section--pick">
          <h4 class="flash-breakdown-heading">⭐ Mis picks</h4>
          <ul class="flash-breakdown-list">
            <li><span>${bd.picksSaved}</span> guardadas como prioridad</li>
            <li><span class="flash-breakdown-good">${bd.picksInHisList}</span> aparecen en sus repetidas</li>
            ${
              bd.picksNotInHisList
                ? `<li><span class="flash-breakdown-warn">${bd.picksNotInHisList}</span> no están en su lista — pídeselas aparte</li>`
                : ""
            }
          </ul>
        </div>`
            : ""
        }
      </div>
    </details>`;
}

export function tradeTeamLabel(teamCode, sticker) {
  const name = sticker?.team_name;
  if (name && name !== teamCode && !/^Grupo|FWC|Coca/i.test(name)) return name;
  if (teamCode === "FWC") return "FWC";
  if (teamCode === "COC") return "Coca-Cola";
  return teamCode;
}

function formatTradeSlots(items) {
  return items
    .map((i) => {
      const mark = stickerKindMark(i.sticker);
      return mark ? `${i.slot}${mark}` : String(i.slot);
    })
    .join(", ");
}

/** @param {string[]} keys @param {ReturnType<typeof import('./stickerListParser.js').buildCatalogIndex>} catalog */
export function tradeItemsFromKeys(keys, catalog) {
  /** @type {TradeItem[]} */
  const items = [];
  const seen = new Set();
  for (const key of keys || []) {
    if (seen.has(key)) continue;
    const sticker = catalog.byTeamSlot.get(key);
    if (!sticker) continue;
    seen.add(key);
    const [teamCode, slotStr] = key.split(":");
    items.push({
      sticker,
      teamCode,
      slot: parseInt(slotStr, 10),
      key,
      manual: true,
    });
  }
  return sortByAlbum(items);
}

export function parseTradeListToKeys(text, catalog, mode = "duplicates") {
  const r = parseStickerList(text, catalog, { mode });
  return r.matched.map((m) => stickerRefKey(m.teamCode, m.slot));
}

export function mergeTradePools(base, extras) {
  const byKey = new Map(base.map((i) => [i.key, i]));
  for (const item of extras) {
    if (!byKey.has(item.key)) byKey.set(item.key, item);
  }
  return sortByAlbum([...byKey.values()]);
}

export function boostPoolWithPicks(pool, priorityPickKeys = []) {
  const pickSet = new Set(priorityPickKeys || []);
  if (!pickSet.size) return pool;
  return pool.map((item) => {
    if (!pickSet.has(item.key)) return item;
    return { ...item, isPick: true, requestTier: 0 };
  });
}

export function tradeItemsUserCanOffer(text, catalog, collection) {
  const r = parseStickerList(text, catalog, { mode: "duplicates" });
  const seen = new Set();
  /** @type {TradeItem[]} */
  const items = [];
  for (const m of r.matched) {
    const key = stickerRefKey(m.teamCode, m.slot);
    if (seen.has(key)) continue;
    const myQty = myQtyForSticker(collection, m.sticker.id);
    if (myQty < 2) continue;
    seen.add(key);
    items.push(itemFromMatch(m, collection, { manual: true }));
  }
  return sortOfferList(items);
}

/** @param {TradeItem[]} items */
export function groupTradeItems(items) {
  /** @type {Map<string, { team_code: string, flag: string, team_name: string, items: TradeItem[] }>} */
  const byTeam = new Map();
  for (const item of items) {
    if (!byTeam.has(item.teamCode)) {
      byTeam.set(item.teamCode, {
        team_code: item.teamCode,
        flag: TEAM_FLAGS[item.teamCode] || "⚽",
        team_name: tradeTeamLabel(item.teamCode, item.sticker),
        items: [],
      });
    }
    byTeam.get(item.teamCode).items.push(item);
  }
  return [...byTeam.values()].sort((a, b) => albumOrderIndex(a.team_code) - albumOrderIndex(b.team_code));
}

export function formatFlashDealText(receive, give, meta = {}) {
  const recvCount = receive.length;
  const giveCount = give.length;
  const partner = meta.partnerName ? `\n👤 Para: *${meta.partnerName}*` : "";
  const balance =
    recvCount === giveCount
      ? "⚖️ *Parejo*"
      : recvCount > giveCount
        ? `📊 Te pido ${recvCount - giveCount} más`
        : `📊 Te doy ${giveCount - recvCount} más`;

  const lines = [
    `🤝 *TRATO PANINI WC 2026*`,
    `Propuesta de intercambio${partner}`,
    "",
    "────────────────",
    "",
    `📤 *TE DOY · ${giveCount}*`,
  ];

  for (const g of groupTradeItems(give)) {
    const code = shareTeamCode(g.team_code);
    const nums = formatTradeSlots(g.items);
    lines.push(`${g.flag} *${g.team_name}* (${code})  ${nums}`);
  }

  lines.push("", `📥 *TE PIDO · ${recvCount}*`);

  for (const g of groupTradeItems(receive)) {
    const code = shareTeamCode(g.team_code);
    const nums = formatTradeSlots(g.items);
    lines.push(`${g.flag} *${g.team_name}* (${code})  ${nums}`);
  }

  lines.push("", "────────────────", balance, "", "✅ ¿Te va este trato?");
  return lines.join("\n");
}

export function formatFlashDealPlain(receive, give, meta = {}) {
  const recvCount = receive.length;
  const giveCount = give.length;
  const who = meta.partnerName ? `Para ${meta.partnerName}` : "Intercambio";
  const lines = [
    `TRATO PANINI WC 2026 — ${who}`,
    "",
    `TE DOY (${giveCount}):`,
  ];
  for (const g of groupTradeItems(give)) {
    lines.push(`${g.flag} ${g.team_name} ${shareTeamCode(g.team_code)} ${formatTradeSlots(g.items)}`);
  }
  lines.push("", `TE PIDO (${recvCount}):`);
  for (const g of groupTradeItems(receive)) {
    lines.push(`${g.flag} ${g.team_name} ${shareTeamCode(g.team_code)} ${formatTradeSlots(g.items)}`);
  }
  lines.push("", "¿Confirmamos?");
  return lines.join("\n");
}

export function renderFlashDealPreviewHtml(receive, give, meta = {}) {
  const recvCount = receive.length;
  const giveCount = give.length;
  const balanced = recvCount === giveCount;

  const renderSide = (items, label, emoji) => {
    if (!items.length) {
      return `<div class="flash-deal-side flash-deal-side--empty"><span class="flash-deal-side-label">${emoji} ${label}</span><p class="flash-deal-empty">—</p></div>`;
    }
    const rows = groupTradeItems(items)
      .map((g) => {
        const slots = g.items
          .map((i) => {
            const mark = stickerKindMark(i.sticker);
            const title = stickerKindTitle(i.sticker);
            const kind = title ? ` title="${title}"` : "";
            return `<span class="share-msg-num"${kind}>${i.slot}${mark}</span>`;
          })
          .join('<span class="share-msg-dot">·</span>');
        return `
          <div class="share-msg-row">
            <span class="share-msg-flag">${g.flag}</span>
            <span class="share-msg-team">
              <span class="share-msg-code">${shareTeamCode(g.team_code)}</span>
              <span class="share-msg-name">${g.team_name}</span>
            </span>
            <span class="share-msg-slots">${slots}</span>
          </div>`;
      })
      .join("");
    return `
      <div class="flash-deal-side">
        <span class="flash-deal-side-label">${emoji} ${label} · ${items.length}</span>
        <div class="flash-deal-side-rows">${rows}</div>
      </div>`;
  };

  return `
    <div class="flash-deal-card">
      <div class="flash-deal-glow"></div>
      <div class="flash-deal-inner">
        <div class="flash-deal-header">
          <span class="flash-deal-badge">Trato</span>
          <span class="flash-deal-title">Intercambio WC 2026</span>
        </div>
        <div class="flash-deal-stats">
          <div class="flash-deal-stat flash-deal-stat--out">
            <span class="flash-deal-stat-value">${giveCount}</span>
            <span class="flash-deal-stat-label">Te doy</span>
          </div>
          <div class="flash-deal-stat-divider ${balanced ? "balanced" : ""}">⇄</div>
          <div class="flash-deal-stat flash-deal-stat--in">
            <span class="flash-deal-stat-value">${recvCount}</span>
            <span class="flash-deal-stat-label">Te pido</span>
          </div>
        </div>
        <div class="flash-deal-body">
          ${renderSide(give, "Te doy", "📤")}
          ${renderSide(receive, "Te pido", "📥")}
        </div>
        ${
          meta.partnerName
            ? `<p class="flash-deal-partner">Con ${meta.partnerName}</p>`
            : ""
        }
      </div>
    </div>`;
}

export async function copyFlashDealText(receive, give, meta, { plain = false } = {}) {
  const text = plain ? formatFlashDealPlain(receive, give, meta) : formatFlashDealText(receive, give, meta);
  await copyTextToClipboard(text);
  return text;
}

export async function openFlashDealWhatsApp(receive, give, meta) {
  const text = formatFlashDealText(receive, give, meta);
  try {
    await copyTextToClipboard(text);
  } catch {
    /* optional */
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

export function loadFlashSession() {
  try {
    return {
      step: parseInt(sessionStorage.getItem("flashStep") || "1", 10),
      dupsText: sessionStorage.getItem("flashPartnerDups") || "",
      needsText: sessionStorage.getItem("flashPartnerNeeds") || "",
      partnerName: sessionStorage.getItem("flashPartnerName") || "",
      selectedReceive: JSON.parse(sessionStorage.getItem("flashSelReceive") || "null"),
      selectedGive: JSON.parse(sessionStorage.getItem("flashSelGive") || "null"),
      extraReceiveKeys: JSON.parse(sessionStorage.getItem("flashExtraReceive") || "[]"),
      extraGiveKeys: JSON.parse(sessionStorage.getItem("flashExtraGive") || "[]"),
      priorityPickKeys: JSON.parse(sessionStorage.getItem("flashPriorityPicks") || "[]"),
      manualMode: sessionStorage.getItem("flashManualMode") === "1",
    };
  } catch {
    return {
      step: 1,
      dupsText: "",
      needsText: "",
      partnerName: "",
      selectedReceive: null,
      selectedGive: null,
      extraReceiveKeys: [],
      extraGiveKeys: [],
      priorityPickKeys: [],
      manualMode: false,
    };
  }
}

export function saveFlashSession(patch) {
  if (patch.step != null) sessionStorage.setItem("flashStep", String(patch.step));
  if (patch.dupsText != null) sessionStorage.setItem("flashPartnerDups", patch.dupsText);
  if (patch.needsText != null) sessionStorage.setItem("flashPartnerNeeds", patch.needsText);
  if (patch.partnerName != null) sessionStorage.setItem("flashPartnerName", patch.partnerName);
  if (patch.selectedReceive != null) {
    sessionStorage.setItem("flashSelReceive", JSON.stringify(patch.selectedReceive));
  }
  if (patch.selectedGive != null) {
    sessionStorage.setItem("flashSelGive", JSON.stringify(patch.selectedGive));
  }
  if (patch.extraReceiveKeys != null) {
    sessionStorage.setItem("flashExtraReceive", JSON.stringify(patch.extraReceiveKeys));
  }
  if (patch.extraGiveKeys != null) {
    sessionStorage.setItem("flashExtraGive", JSON.stringify(patch.extraGiveKeys));
  }
  if (patch.manualMode != null) {
    sessionStorage.setItem("flashManualMode", patch.manualMode ? "1" : "0");
  }
  if (patch.priorityPickKeys != null) {
    sessionStorage.setItem("flashPriorityPicks", JSON.stringify(patch.priorityPickKeys));
  }
}

export function clearFlashSession() {
  [
    "flashStep",
    "flashPartnerDups",
    "flashPartnerNeeds",
    "flashPartnerName",
    "flashSelReceive",
    "flashSelGive",
    "flashExtraReceive",
    "flashExtraGive",
    "flashPriorityPicks",
    "flashManualMode",
  ].forEach((k) => sessionStorage.removeItem(k));
}

export function resolveSelection(items, selectedKeys) {
  if (!selectedKeys) return items;
  const set = new Set(selectedKeys);
  return items.filter((i) => set.has(i.key));
}

/** Resuelve selección aunque la lámina no esté en el pool (ej. mega fuera de faltantes del amigo). */
export function resolveTradeSelection(selectedKeys, pool, catalog, collection) {
  if (!selectedKeys?.length) return [];
  const byKey = new Map(pool.map((i) => [i.key, i]));
  /** @type {TradeItem[]} */
  const out = [];
  for (const key of selectedKeys) {
    if (byKey.has(key)) {
      out.push(byKey.get(key));
      continue;
    }
    const sticker = catalog.byTeamSlot.get(key);
    if (!sticker) continue;
    const myQty = myQtyForSticker(collection, sticker.id);
    out.push({
      sticker,
      teamCode: sticker.team_code,
      slot: sticker.team_slot,
      key,
      myQty,
      spareQty: myQty > 1 ? myQty - 1 : 0,
      esRepetida: myQty > 1,
      especial: isSpecialSticker(sticker),
    });
  }
  return sortByAlbum(out);
}

export function defaultSelectionKeys(items) {
  return items.map((i) => i.key);
}
