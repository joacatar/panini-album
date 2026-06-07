import { supabase, supabaseConfigured, getSession } from "./lib/supabase.js";
import { api } from "./lib/api.js";
import { TEAM_FLAGS } from "./lib/teamFlags.js";
import {
  WC_GROUPS,
  ALBUM_SPECIAL_FILTERS,
  albumOrderIndex,
  groupForTeam,
  groupLabel,
  sectionLabel,
  teamsInGroupFilter,
} from "./lib/teamSections.js";
import {
  albumPageDividerLabel,
  albumPageLabel,
  albumPageNumbers,
  stickerAlbumPage,
  stickersOnAlbumPage,
} from "./lib/albumPages.js";
import { mergeCatalogExtras } from "./lib/catalogExtras.js";
import {
  buildCatalogIndex,
  detectImportMode,
  parseStickerList,
} from "./lib/stickerListParser.js";
import {
  copyMissingShareText,
  formatMissingSharePlain,
  formatMissingShareText,
  openWhatsAppShare,
  renderMissingSharePreviewHtml,
} from "./lib/shareMissingCard.js";
import {
  formatDuplicatesSharePlain,
  formatDuplicatesShareText,
  openDuplicatesWhatsApp,
  renderDuplicatesSharePreviewHtml,
} from "./lib/shareDuplicatesCard.js";
import {
  initOcrWorker,
  matchOcrText,
  recognizeFromFile,
  recognizeFromVideo,
} from "./lib/stickerScanner.js";
import {
  canUseLiveCamera,
  getLiveCameraBlockInfo,
  startCamera,
  stopCamera,
} from "./lib/cameraAccess.js";
import {
  authCallbackUrl,
  completeAuthFromUrl,
  consumeAuthFlash,
  humanizeAuthError,
  redirectLegacyAuthPort,
  rememberAuthReturnRoute,
  setAuthFlash,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  updateUserPassword,
} from "./lib/auth.js";
import {
  COLLECTION_STORAGE_KEY,
  loadLocalCollection,
  loadLocalCollectionSafe,
  saveLocalCollection,
  sanitizeLocalCollection,
  syncCollectionToRemote,
  syncLocalToRemote,
} from "./lib/collection.js";
import {
  clearFlashSession,
  computeFlashTrade,
  computeMegaDuplicateSwap,
  defaultSelectionKeys,
  formatFlashDealPlain,
  formatFlashDealText,
  groupTradeItems,
  loadFlashSession,
  boostPoolWithPicks,
  mergeTradePools,
  openFlashDealWhatsApp,
  parseTradeListToKeys,
  renderFlashDealPreviewHtml,
  renderTradeBreakdownHtml,
  requestTierLabel,
  resolveSelection,
  resolveTradeSelection,
  saveFlashSession,
  tradeItemsFromKeys,
  tradeItemsUserCanOffer,
  tradeTeamLabel,
} from "./lib/flashTrade.js";
import { escapeHtml as shellEscapeHtml, renderBottomNav, renderWelcomeMessage } from "./lib/appShell.js";
import { copyTextToClipboard } from "./lib/copyText.js";
import {
  collectionFieldsForTotal,
  isSpecialSticker,
  MAX_ALBUM_COPIES,
  mergeCollectionRows,
  normalizeCollectionRow,
  stickerKindMark,
  totalCopiesFromRecord,
} from "./lib/collectionCopies.js";

let activeScanCleanup = null;
let collectionLoadPromise = null;
let loginMergePromise = null;
let loginMergedForUserId = null;

const SHOW_STICKER_NAMES = false;

const AUTH_ROUTES = new Set([
  "cuenta",
  "explore",
  "trades",
  "trade",
  "review",
  "profile",
  "onboarding",
  "user",
]);

const $app = document.getElementById("app");
let bootComplete = false;
let appPainted = false;
let renderInFlight = null;
let renderPending = false;
let collectionRecoveryNotice = null;

function showBootError(message) {
  if (!$app) return;
  $app.innerHTML = `
    <div class="app-shell">
      <header class="app-header"><h1>Panini Intercambios</h1></header>
      <main class="app-main">
        <div class="card" style="padding:1rem">
          <p class="msg error">${shellEscapeHtml(message)}</p>
          <p style="margin-top:1rem;font-size:0.85rem;color:var(--muted);line-height:1.45">
            Si en incógnito sí abre, casi siempre es caché vieja del navegador o datos locales dañados en este teléfono.
          </p>
          <div class="boot-recovery-actions">
            <button type="button" class="btn btn-primary" id="boot-reload">Recargar</button>
            <button type="button" class="btn btn-secondary" id="boot-clear-collection">Borrar solo álbum local</button>
            <button type="button" class="btn btn-ghost" id="boot-clear-auth">Borrar todo y cerrar sesión</button>
          </div>
        </div>
      </main>
    </div>`;
  document.getElementById("boot-reload")?.addEventListener("click", () => location.reload());
  document.getElementById("boot-clear-collection")?.addEventListener("click", (e) => {
    e.preventDefault();
    try {
      localStorage.removeItem(COLLECTION_STORAGE_KEY);
      sessionStorage.removeItem("albumTeamIndex");
      sessionStorage.removeItem("albumSubPage");
    } catch {
      /* ignore */
    }
    location.reload();
  });
  document.getElementById("boot-clear-auth")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await supabase?.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      location.href = "/";
    } catch {
      location.reload();
    }
  });
}

function hydrateLocalCollection(validIds = null) {
  const { raw, error } = loadLocalCollectionSafe();
  if (error) collectionRecoveryNotice = error;
  state.collection = sanitizeLocalCollection(raw, validIds);
  return state.collection;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} tardó demasiado (${ms / 1000}s)`)), ms);
    }),
  ]);
}
let state = {
  user: null,
  profile: null,
  stickers: [],
  collection: {},
  route: "album",
  params: {},
  returnAfterAuth: null,
  albumTeamIndex: 0,
  albumSubPage: 1,
  albumGroupFilter: "all",
  albumMode: "view",
  albumTeamsMissingOnly: false,
};

function navigate(route, params = {}) {
  state.route = route;
  state.params = params;
  render();
  window.location.hash = route === "album" && !params.id ? "" : `${route}${params.id ? "/" + params.id : ""}`;
}

function parseHash() {
  const h = (location.hash || "").replace(/^#/, "");
  const [route, id] = h.split("/").filter(Boolean);
  if (!route) return "album";
  return { route, id };
}

async function loadUser() {
  if (!supabase) return;
  try {
    const session = await withTimeout(getSession(), 8000, "Sesión");
    state.user = session?.user ?? null;
  } catch (err) {
    console.warn("loadUser:", err.message);
    state.user = null;
    state.profile = null;
    return;
  }
  if (!state.user) {
    state.profile = null;
    return;
  }

  try {
    let { data } = await withTimeout(
      supabase.from("profiles").select("*").eq("id", state.user.id).maybeSingle(),
      8000,
      "Perfil"
    );
    if (!data) {
      const displayName =
        state.user.user_metadata?.full_name ||
        state.user.user_metadata?.name ||
        state.user.email?.split("@")[0] ||
        "Coleccionista";
      const ensured = await supabase
        .from("profiles")
        .upsert({ id: state.user.id, display_name: displayName })
        .select()
        .maybeSingle();
      data = ensured.data;
      if (ensured.error) console.warn("profile ensure:", ensured.error.message);
    }
    state.profile = data;
  } catch (err) {
    console.warn("loadUser profile:", err.message);
  }
}

async function loadStickers() {
  if (!supabase) {
    state.stickers = mergeCatalogExtras([]);
    return;
  }
  try {
    const { data, error } = await withTimeout(
      supabase.from("stickers").select("*").order("display_order"),
      12000,
      "Catálogo"
    );
    if (error) console.warn("loadStickers:", error.message);
    state.stickers = mergeCatalogExtras(data || []);
  } catch (err) {
    console.warn("loadStickers:", err.message);
    state.stickers = mergeCatalogExtras([]);
  }
}

async function loadCollection(force = false) {
  if (collectionLoadPromise && !force) return collectionLoadPromise;

  collectionLoadPromise = (async () => {
    const validIds = state.stickers.length ? new Set(state.stickers.map((s) => s.id)) : null;
    const fromLocal = sanitizeLocalCollection(loadLocalCollection(), validIds);

    if (state.user && supabase) {
      try {
        const { data, error } = await withTimeout(
          supabase
            .from("user_stickers")
            .select("sticker_id, owned, duplicates")
            .eq("user_id", state.user.id),
          8000,
          "Colección remota"
        );
        if (error) {
          console.warn("loadCollection remote:", error.message);
          state.collection = fromLocal;
          return;
        }
        const fromRemote = {};
        for (const row of data || []) {
          if (validIds && !validIds.has(row.sticker_id)) continue;
          fromRemote[row.sticker_id] = normalizeCollectionRow(row);
        }
        const ids = new Set([
          ...Object.keys(fromLocal).map((id) => parseInt(id, 10)),
          ...Object.keys(fromRemote).map((id) => parseInt(id, 10)),
        ]);
        const merged = {};
        for (const id of ids) {
          merged[id] = mergeCollectionRows(fromLocal[id], fromRemote[id]);
        }
        state.collection = merged;
        saveLocalCollection(merged);
        return;
      } catch (err) {
        console.warn("loadCollection remote:", err.message);
        state.collection = fromLocal;
        return;
      }
    }

    state.collection = fromLocal;
  })();

  try {
    await collectionLoadPromise;
  } catch (err) {
    console.warn("loadCollection:", err.message);
    const validIds = state.stickers.length ? new Set(state.stickers.map((s) => s.id)) : null;
    state.collection = sanitizeLocalCollection(loadLocalCollection(), validIds);
  } finally {
    collectionLoadPromise = null;
  }
}

/** Tras login: fusiona dispositivo + nube una sola vez y sube el mejor resultado. */
async function mergeCollectionOnLogin() {
  if (!state.user || !supabase) return;
  if (loginMergedForUserId === state.user.id) return;
  if (loginMergePromise) return loginMergePromise;

  loginMergePromise = (async () => {
    const validIds = state.stickers.length ? new Set(state.stickers.map((s) => s.id)) : null;
    const local = sanitizeLocalCollection(loadLocalCollection(), validIds);
    const { data, error } = await withTimeout(
      supabase.from("user_stickers").select("sticker_id, owned, duplicates").eq("user_id", state.user.id),
      15000,
      "Sincronizar álbum"
    );

    if (error) {
      console.warn("mergeCollectionOnLogin:", error.message);
      setAuthFlash(
        "error",
        `Entraste, pero no pudimos leer tu álbum en la nube (${error.message}). Se usa lo de este dispositivo.`
      );
      state.collection = local;
      saveLocalCollection(local);
      return;
    }

    const { error: syncErr, merged } = await syncLocalToRemote(supabase, state.user.id, local, data || []);
    state.collection = merged;
    if (syncErr) {
      console.warn("mergeCollectionOnLogin sync:", syncErr.message);
      setAuthFlash(
        "error",
        `Entraste, pero no se guardó todo en la nube (${syncErr.message}). Tu álbum sigue en este dispositivo.`
      );
      return;
    }

    const owned = Object.values(merged).filter((r) => totalCopies(r) > 0).length;
    setAuthFlash(
      "success",
      `Álbum sincronizado: ${owned} láminas (se combinaron este dispositivo y tu cuenta).`
    );
    loginMergedForUserId = state.user.id;
  })();

  try {
    await loginMergePromise;
  } finally {
    loginMergePromise = null;
  }
}

async function upsertSticker(stickerId, patch) {
  const existing = state.collection[stickerId] || { owned: false, duplicates: 0 };
  const row = normalizeCollectionRow({ ...existing, ...patch });
  state.collection[stickerId] = row;
  saveLocalCollection(state.collection);

  if (state.user && supabase) {
    const { error } = await supabase.from("user_stickers").upsert(
      {
        user_id: state.user.id,
        sticker_id: stickerId,
        owned: row.owned,
        duplicates: row.duplicates || 0,
      },
      { onConflict: "user_id,sticker_id" }
    );
    if (error) console.warn("upsertSticker remote:", error.message);
  }
}

function stats() {
  const total = state.stickers.length;
  let owned = 0;
  let dups = 0;
  let megaCount = 0;
  let dupCount = 0;
  for (const s of state.stickers) {
    const c = state.collection[s.id];
    const copies = totalCopies(c);
    if (copies > 0) owned++;
    if (copies > 1) {
      dupCount++;
      dups += copies - 1;
      if (copies >= 3) megaCount++;
    }
  }
  return { total, owned, missing: total - owned, dups, megaCount, dupCount };
}

function countMyMegas() {
  let n = 0;
  for (const s of state.stickers) {
    if (totalCopies(state.collection[s.id]) >= 3) n++;
  }
  return n;
}

function shell(title, sub, body, showNav = true) {
  appPainted = true;
  const st = stats();
  const pct = state.stickers.length && st.total ? Math.round((st.owned / st.total) * 100) : 0;
  const showProgress = showNav && state.stickers.length > 0 && !["flash", "import", "scan"].includes(state.route);

  const nav = showNav ? renderBottomNav(state.route) : "";
  $app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="header-row">
          <div class="header-text">
            <p class="header-kicker">Mundial FIFA 2026</p>
            <h1>${title}</h1>
            ${sub ? `<p class="sub">${sub}</p>` : ""}
          </div>
          ${
            showNav && (state.route !== "guia" || showProgress)
              ? `<div class="header-aside">
                  ${showNav && state.route !== "guia" ? `<a href="#guia" class="header-guia-link" title="Guía rápida">❓ Guía</a>` : ""}
                  ${
                    showProgress
                      ? `<div class="header-progress" aria-label="Progreso del álbum">
                          <svg class="header-ring" viewBox="0 0 36 36">
                            <circle class="header-ring-bg" cx="18" cy="18" r="15.5" />
                            <circle class="header-ring-fill" cx="18" cy="18" r="15.5" pathLength="100"
                              stroke-dasharray="${pct} 100" stroke-dashoffset="0" />
                          </svg>
                          <span class="header-pct">${pct}%</span>
                        </div>`
                      : ""
                  }
                </div>`
              : ""
          }
        </div>
      </header>
      <main class="app-main">${body}</main>
      ${nav}
    </div>
  `;
  bindNav();
}

function bindNav() {
  $app.querySelectorAll("nav.bottom-nav .nav-item").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      navigate(a.getAttribute("href").slice(1));
    };
  });
}

function msg(text, type = "info") {
  return `<div class="msg ${type}">${text}</div>`;
}

function parsePaniniCode(s) {
  if (s.code) {
    const m = String(s.code).match(/^([A-Z]{2,3})(\d+)$/i);
    if (m) return { team: m[1].toUpperCase(), num: parseInt(m[2], 10) };
  }
  if (s.team_code && s.team_slot != null) {
    return { team: s.team_code, num: s.team_slot };
  }
  return { team: "—", num: s.number };
}

function formatPaniniCode(s) {
  const { team, num } = parsePaniniCode(s);
  return team === "—" ? `#${num}` : `${team} ${num}`;
}

function paniniCodeHtml(s) {
  const { team, num } = parsePaniniCode(s);
  if (team === "—") return `<span class="code-num alone">#${num}</span>`;
  return `<span class="code-team">${team}</span><span class="code-num">${num}</span>`;
}

function kindLabel(s) {
  if (s.sticker_kind === "escudo") return "Escudo";
  if (s.sticker_kind === "foto_equipo") return "Foto equipo";
  if (s.sticker_kind === "fwc") return "FWC";
  if (s.sticker_kind === "coca_cola") return "Coca-Cola";
  return "Jugador";
}

function statusLabel(s) {
  const qty = totalCopies(state.collection[s.id]);
  if (qty === 0) return "Falta";
  if (qty === 1) return "La tengo";
  return `×${qty}`;
}

function totalCopies(c) {
  return totalCopiesFromRecord(c);
}

function stickerTeamPage(s) {
  return stickerAlbumPage(s);
}

async function setStickerCopies(id, qty) {
  await upsertSticker(id, collectionFieldsForTotal(qty));
}

function cycleStickerCopies(id) {
  const c = state.collection[id] || { owned: false, duplicates: 0 };
  const qty = totalCopies(c);
  if (qty >= MAX_ALBUM_COPIES) return setStickerCopies(id, 0);
  return setStickerCopies(id, qty + 1);
}

function groupStickersByTeam() {
  const groups = [];
  const byCode = new Map();
  for (const s of state.stickers) {
    const code = s.team_code || (s.section === "FWC" ? "FWC" : s.section?.slice(0, 3)?.toUpperCase()) || "FWC";
    if (!byCode.has(code)) {
      byCode.set(code, {
        team_code: code,
        team_name: s.team_name || s.section || code,
        flag: TEAM_FLAGS[code] || "⚽",
        stickers: [],
      });
    }
    byCode.get(code).stickers.push(s);
  }
  for (const g of byCode.values()) {
    g.stickers.sort(
      (a, b) =>
        (a.team_slot || 0) - (b.team_slot || 0) ||
        (a.display_order || 0) - (b.display_order || 0)
    );
    const owned = g.stickers.filter((s) => totalCopies(state.collection[s.id]) > 0).length;
    g.owned = owned;
    g.total = g.stickers.length;
    groups.push(g);
  }
  groups.sort((a, b) => albumOrderIndex(a.team_code) - albumOrderIndex(b.team_code));
  return groups;
}

function filterStats(groups, filterId) {
  const list = teamsInGroupFilter(groups, filterId);
  let owned = 0;
  let total = 0;
  for (const g of list) {
    owned += g.owned;
    total += g.total;
  }
  return { owned, total, teams: list.length };
}

function teamsVisibleInAlbum(groups, filterId) {
  let list = teamsInGroupFilter(groups, filterId);
  if (state.albumTeamsMissingOnly) {
    list = list.filter((g) => g.owned < g.total);
  }
  return list;
}

function filteredTeamIndices(groups, filterId) {
  return teamsVisibleInAlbum(groups, filterId).map((g) => groups.indexOf(g));
}

function ensureTeamInFilter(groups) {
  const list = teamsVisibleInAlbum(groups, state.albumGroupFilter);
  const current = groups[state.albumTeamIndex];
  if (current && list.includes(current)) return;
  if (list.length) {
    state.albumTeamIndex = groups.indexOf(list[0]);
    state.albumSubPage = 1;
  }
}

function groupMissingCount(groups, filterId) {
  return teamsInGroupFilter(groups, filterId).reduce(
    (n, g) => n + g.stickers.filter((s) => !state.collection[s.id]?.owned).length,
    0
  );
}

function ensureAlbumFilterSelection(groups) {
  if (state.albumTeamsMissingOnly) {
    const pillIds = [
      "all",
      "FWC",
      ...WC_GROUPS.map((g) => g.id),
      "COC",
    ];
    if (groupMissingCount(groups, state.albumGroupFilter) === 0) {
      const next = pillIds.find((id) => groupMissingCount(groups, id) > 0);
      if (next) {
        state.albumGroupFilter = next;
        sessionStorage.setItem("albumGroupFilter", next);
      }
    }
  }
  ensureTeamInFilter(groups);
}

function renderAlbumFilterToggle() {
  const missingOnly = state.albumTeamsMissingOnly;
  return `
    <div class="album-filter-toggle">
      <div class="album-filter-toggle-seg" role="tablist" aria-label="Mostrar grupos y equipos">
        <button type="button" class="album-filter-toggle-btn ${!missingOnly ? "active" : ""}" data-team-filter="all" role="tab" aria-selected="${!missingOnly}">Todos</button>
        <button type="button" class="album-filter-toggle-btn ${missingOnly ? "active" : ""}" data-team-filter="missing" role="tab" aria-selected="${missingOnly}">Por completar</button>
      </div>
    </div>`;
}

function renderGroupFilterBar(groups, activeFilterId, { onlyMissing = false, showStatus = false } = {}) {
  const pills = [
    { id: "all", label: "Todos" },
    ...ALBUM_SPECIAL_FILTERS.filter((f) => f.id === "FWC"),
    ...WC_GROUPS.map((g) => ({ id: g.id, label: g.id })),
    ...ALBUM_SPECIAL_FILTERS.filter((f) => f.id === "COC"),
  ];
  return `<div class="section-bar group-filter-bar" role="tablist">${pills
    .map((pill) => {
      const st = filterStats(groups, pill.id);
      if (!st.total) return "";
      const miss = groupMissingCount(groups, pill.id);
      if (onlyMissing) {
        if (!miss) return "";
        const active = pill.id === activeFilterId ? " active" : "";
        return `<button type="button" class="section-pill pending${active}${pill.id === "FWC" || pill.id === "COC" ? " section-pill-special" : ""}" data-group="${pill.id}" role="tab" title="${pill.title || pill.label}">
          <span class="section-pill-label">${pill.label}</span>
          <span class="section-pill-meta">${miss}</span>
        </button>`;
      }
      const pct = st.total ? Math.round((st.owned / st.total) * 100) : 0;
      const active = pill.id === activeFilterId ? " active" : "";
      const statusCls = showStatus ? (miss === 0 ? " complete" : " pending") : "";
      const meta = showStatus && miss === 0 ? "✓" : `${pct}%`;
      return `<button type="button" class="section-pill${statusCls}${active}${pill.id === "all" ? " section-pill-wide" : ""}${pill.id === "FWC" || pill.id === "COC" ? " section-pill-special" : ""}" data-group="${pill.id}" role="tab" title="${pill.title || pill.label}">
        <span class="section-pill-label">${pill.label}</span>
        <span class="section-pill-meta">${meta}</span>
      </button>`;
    })
    .join("")}</div>`;
}

function renderTeamChips(groups, activeIdx, filterId, { onlyMissing = false } = {}) {
  const chips = teamsInGroupFilter(groups, filterId)
    .map((g) => {
      const idx = groups.indexOf(g);
      const miss = g.total - g.owned;
      if (onlyMissing && miss === 0) return "";
      const pct = g.total ? Math.round((g.owned / g.total) * 100) : 0;
      const active = idx === activeIdx ? " active" : "";
      const statusCls = miss === 0 ? " complete" : " pending";
      const badge = onlyMissing ? `${miss}` : miss === 0 ? `✓ ${g.owned}/${g.total}` : `${g.owned}/${g.total}`;
      return `<button type="button" class="team-chip${statusCls}${active}" data-idx="${idx}" title="${g.team_name}">
        <span class="chip-flag">${g.flag}</span>
        <span class="chip-code">${g.team_code}</span>
        <span class="chip-name">${g.team_name}</span>
        <span class="chip-track"><span class="chip-fill" style="width:${pct}%"></span></span>
        <span class="chip-stat">${badge}</span>
      </button>`;
    })
    .join("");
  return `<div class="team-chip-scroll">${chips || `<p class="team-chip-empty">${onlyMissing ? "Nada pendiente aquí." : "Sin equipos."}</p>`}</div>`;
}

function renderTeamHero(team, { missing = 0 } = {}) {
  const eyebrow = sectionLabel(team.team_code);
  const pct = team.total ? Math.round((team.owned / team.total) * 100) : 0;
  const missingLine =
    missing > 0
      ? `<span class="team-hero-missing">${missing} faltan</span>`
      : `<span class="team-hero-complete">Completo</span>`;
  return `
    <div class="team-hero">
      <div class="team-hero-flag" aria-hidden="true">${team.flag}</div>
      <div class="team-hero-body">
        <p class="team-hero-eyebrow">${eyebrow}</p>
        <h2 class="team-hero-name">${team.team_name}</h2>
        <p class="team-hero-meta"><span class="mono">${team.team_code}</span> · ${team.owned}/${team.total} · ${pct}% · ${missingLine}</p>
        <div class="team-hero-track"><div class="team-hero-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`;
}

function hasSticker(id) {
  return totalCopies(state.collection[id]) > 0;
}

function renderSubpageTabs(sub, team) {
  const pages = albumPageNumbers(team);
  return `
    <div class="subpage-segment subpage-segment--scroll" role="tablist">
      ${pages
        .map((pageNum) => {
          const pageStickers = stickersOnAlbumPage(team, pageNum);
          const owned = pageStickers.filter((s) => hasSticker(s.id)).length;
          return `<button type="button" class="subpage-seg ${sub === pageNum ? "active" : ""}" data-subpage="${pageNum}">
        <span class="seg-label">${albumPageLabel(team.team_code, pageNum)}</span>
        <span class="seg-meta">${owned}/${pageStickers.length}</span>
      </button>`;
        })
        .join("")}
    </div>`;
}

function renderStickerGrid(stickers, mode) {
  if (!stickers.length) return "";
  return `<div class="sticker-grid sticker-grid--album">${stickers.map((s) => stickerTileHtml(s, mode)).join("")}</div>`;
}

function renderAlbumPageDivider(team, pageNum, pageStickers) {
  const owned = pageStickers.filter((s) => hasSticker(s.id)).length;
  return `<div class="album-page-divider" role="separator"><span>${albumPageDividerLabel(team.team_code, pageNum)}</span><span class="album-page-divider-meta">${owned}/${pageStickers.length}</span></div>`;
}

function renderAlbumViewContent(team) {
  const pageNums = albumPageNumbers(team);
  const totalMissing = team.total - team.owned;
  const parts = [];

  if (totalMissing === 0) {
    parts.push(`<p class="album-team-complete">¡Equipo completo! 🎉</p>`);
  }

  for (const pageNum of pageNums) {
    const pageStickers = stickersOnAlbumPage(team, pageNum);
    const missing = pageStickers.filter((s) => !hasSticker(s.id));
    const owned = pageStickers.filter((s) => hasSticker(s.id));
    let pageHtml = renderAlbumPageDivider(team, pageNum, pageStickers);

    if (missing.length) {
      pageHtml += `
        <h4 class="album-view-sub album-view-sub--missing">Faltan · ${missing.length}</h4>
        ${renderStickerGrid(missing, "view")}`;
    }
    if (owned.length) {
      pageHtml += `
        <h4 class="album-view-sub album-view-sub--owned">Tienes · ${owned.length}</h4>
        ${renderStickerGrid(owned, "view")}`;
    }

    parts.push(`<section class="album-view-page">${pageHtml}</section>`);
  }

  return parts.join("");
}

function renderAlbumEditContent(team, sub) {
  const pageStickers = stickersOnAlbumPage(team, sub);
  if (!pageStickers.length) {
    return `<p class="album-page-empty">Sin láminas en esta página</p>`;
  }
  return renderStickerGrid(pageStickers, "edit");
}

function albumNavigatePage(delta) {
  const groups = groupStickersByTeam();
  const team = groups[state.albumTeamIndex];
  if (!team) return false;
  const pages = albumPageNumbers(team);
  const pos = pages.indexOf(state.albumSubPage);
  const base = pos >= 0 ? pos : 0;
  const nextPos = base + delta;
  if (nextPos < 0 || nextPos >= pages.length) return false;
  state.albumSubPage = pages[nextPos];
  sessionStorage.setItem("albumSubPage", String(state.albumSubPage));
  return true;
}

function albumNavigateTeam(delta) {
  const groups = groupStickersByTeam();
  const indices = filteredTeamIndices(groups, state.albumGroupFilter);
  const pos = indices.indexOf(state.albumTeamIndex);
  const nextPos = pos + delta;
  if (nextPos < 0 || nextPos >= indices.length) return false;
  state.albumTeamIndex = indices[nextPos];
  state.albumSubPage = 1;
  sessionStorage.setItem("albumTeamIndex", String(state.albumTeamIndex));
  sessionStorage.setItem("albumSubPage", "1");
  return true;
}

function scrollToAlbumSheet() {
  requestAnimationFrame(() => {
    const sheet = $app.querySelector(".album-sheet");
    if (!sheet) return;
    const top = sheet.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  });
}

function captureAlbumScroll() {
  return {
    y: window.scrollY,
    teamChips: $app.querySelector(".team-chip-scroll")?.scrollLeft ?? 0,
    groupBar: $app.querySelector(".group-filter-bar")?.scrollLeft ?? 0,
  };
}

function restoreAlbumScroll(anchors) {
  if (!anchors) return;
  window.scrollTo(0, anchors.y);
  const apply = () => {
    const teamChips = $app.querySelector(".team-chip-scroll");
    if (teamChips) teamChips.scrollLeft = anchors.teamChips;
    const groupBar = $app.querySelector(".group-filter-bar");
    if (groupBar) groupBar.scrollLeft = anchors.groupBar;
  };
  apply();
  requestAnimationFrame(apply);
}

function renderAlbumModeBar() {
  const mode = state.albumMode === "edit" ? "edit" : "view";
  return `
    <div class="album-mode-bar" role="tablist">
      <button type="button" class="album-mode-btn ${mode === "view" ? "active" : ""}" data-album-mode="view">👁 Ver</button>
      <button type="button" class="album-mode-btn ${mode === "edit" ? "active" : ""}" data-album-mode="edit">✏️ Editar</button>
    </div>`;
}

function albumModeHint(team) {
  if (state.albumMode === "edit") {
    const pages = albumPageNumbers(team);
    const range = pages.length > 1 ? ` · pág. ${state.albumSubPage}/${pages.length}` : "";
    return `Editar${range} · toca <strong>+</strong>/<strong>−</strong> · desliza ↔ cambia de página`;
  }
  return "Ver todo · faltantes arriba en cada página · desliza ↔ para otro equipo";
}

function stickerTileHtml(s, mode = "view") {
  const qty = totalCopies(state.collection[s.id]);
  const cls = qty === 0 ? "missing" : qty === 1 ? "owned" : "duplicate";
  const { team, num } = parsePaniniCode(s);
  const kind = stickerKindMark(s);
  const qtyBadge = qty > 0 ? `<span class="stc-qty">×${qty}</span>` : "";
  const kindMark = kind ? `<span class="stc-kind">${kind}</span>` : "";
  const editable = mode === "edit";

  const faceInner = `${kindMark}<span class="stc-code">${team}<b>${num}</b></span>${qtyBadge}`;

  if (!editable) {
    return `
      <div class="sticker-tile-compact ${cls} kind-${s.sticker_kind || "jugador"} readonly">
        ${faceInner}
      </div>`;
  }

  return `
    <div class="sticker-tile-compact ${cls} kind-${s.sticker_kind || "jugador"} editable" data-id="${s.id}">
      <button type="button" class="stc-face stc-face--tap" data-action="cycle" data-id="${s.id}" aria-label="${team} ${num}, ${statusLabel(s)}">
        ${faceInner}
      </button>
      <div class="stc-actions">
        <button type="button" class="stc-btn" data-action="dec" data-id="${s.id}" aria-label="Quitar ${team} ${num}">−</button>
        <button type="button" class="stc-btn" data-action="inc" data-id="${s.id}" aria-label="Agregar ${team} ${num}">+</button>
      </div>
    </div>`;
}

function bindStickerRows(rerender) {
  $app.querySelectorAll("[data-action]").forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = parseInt(el.dataset.id, 10);
      const action = el.dataset.action;
      const c = state.collection[id] || { owned: false, duplicates: 0 };
      const qty = totalCopies(c);
      try {
        if (action === "cycle") await cycleStickerCopies(id);
        else if (action === "inc") await setStickerCopies(id, Math.min(9, qty + 1));
        else if (action === "dec") await setStickerCopies(id, qty - 1);
        rerender();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

function albumSwipeNext() {
  const groups = groupStickersByTeam();
  const team = groups[state.albumTeamIndex];
  const multiPage = team && albumPageNumbers(team).length > 1;
  if (state.albumMode === "edit" && multiPage && albumNavigatePage(1)) {
    viewAlbum({ preserveScroll: true });
    return;
  }
  if (albumNavigateTeam(1)) {
    viewAlbum({ scrollToSheet: true, scrollTeamChip: true });
  }
}

function albumSwipePrev() {
  const groups = groupStickersByTeam();
  const team = groups[state.albumTeamIndex];
  const multiPage = team && albumPageNumbers(team).length > 1;
  if (state.albumMode === "edit" && multiPage && albumNavigatePage(-1)) {
    viewAlbum({ preserveScroll: true });
    return;
  }
  if (albumNavigateTeam(-1)) {
    viewAlbum({ scrollToSheet: true, scrollTeamChip: true });
  }
}

function bindAlbumSwipe() {
  const sheet = $app.querySelector(".album-sheet");
  if (!sheet) return;
  let startX = 0;
  let startY = 0;
  sheet.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true }
  );
  sheet.addEventListener(
    "touchend",
    (e) => {
      if (!e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
      if (dx < 0) albumSwipeNext();
      else albumSwipePrev();
    },
    { passive: true }
  );
}

function renderAlbumPageBody() {
  const groups = groupStickersByTeam();
  if (!groups.length) return msg("No hay catálogo. Carga el seed en Supabase.", "error");

  let idx = state.albumTeamIndex;
  if (idx < 0 || idx >= groups.length) idx = 0;
  state.albumTeamIndex = idx;
  ensureAlbumFilterSelection(groups);
  idx = state.albumTeamIndex;
  sessionStorage.setItem("albumTeamIndex", String(idx));
  sessionStorage.setItem("albumGroupFilter", state.albumGroupFilter);

  const team = groups[idx];
  const pageNums = albumPageNumbers(team);
  if (!pageNums.includes(state.albumSubPage)) {
    state.albumSubPage = pageNums[0];
    sessionStorage.setItem("albumSubPage", String(state.albumSubPage));
  }
  const sub = state.albumSubPage;
  const isEdit = state.albumMode === "edit";
  const teamMissing = team.total - team.owned;
  const st = stats();
  const pct = st.total ? Math.round((st.owned / st.total) * 100) : 0;
  const navIndices = filteredTeamIndices(groups, state.albumGroupFilter);
  const navPos = navIndices.indexOf(idx);
  const navTotal = navIndices.length;

  return `
    <div class="album-stats">
      <div class="stat-card">
        <span class="stat-value">${pct}%</span>
        <span class="stat-label">Completo</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${st.owned}</span>
        <span class="stat-label">Tengo</span>
      </div>
      <button type="button" class="stat-card accent stat-card--tap" id="stat-missing" title="Ver y compartir faltantes">
        <span class="stat-value">${st.missing}</span>
        <span class="stat-label">Faltan</span>
      </button>
      <button type="button" class="stat-card gold stat-card--tap" id="stat-dups" title="Ver y compartir repetidas">
        <span class="stat-value">${st.dupCount}</span>
        <span class="stat-label">Repetidas</span>
      </button>
    </div>
    <div class="action-row">
      <button type="button" class="btn btn-primary btn-compact" id="btn-flash">⚡ Flash</button>
      <button type="button" class="btn btn-secondary btn-compact" id="btn-import-list">Pegar lista</button>
    </div>
    <p class="album-guia-hint"><a href="#guia" class="guia-link">¿Primera vez aquí? Guía rápida</a></p>
    ${renderAlbumFilterToggle()}
    ${renderGroupFilterBar(groups, state.albumGroupFilter, {
      onlyMissing: state.albumTeamsMissingOnly,
      showStatus: !state.albumTeamsMissingOnly,
    })}
    ${renderTeamChips(groups, idx, state.albumGroupFilter, { onlyMissing: state.albumTeamsMissingOnly })}
    ${renderAlbumModeBar()}
    <article class="album-sheet card">
      ${renderTeamHero(team, { missing: teamMissing })}
      ${isEdit ? renderSubpageTabs(sub, team) : ""}
      <p class="album-hint">${albumModeHint(team)}</p>
      ${isEdit ? renderAlbumEditContent(team, sub) : renderAlbumViewContent(team)}
    </article>
    <div class="page-nav">
      <button type="button" class="btn btn-secondary nav-btn" id="prev-team" ${navPos <= 0 ? "disabled" : ""}>← Equipo</button>
      <span class="page-indicator">${navPos >= 0 ? navPos + 1 : idx + 1} / ${navTotal || groups.length}</span>
      <button type="button" class="btn btn-secondary nav-btn" id="next-team" ${navPos < 0 || navPos >= navTotal - 1 ? "disabled" : ""}>Equipo →</button>
    </div>`;
}

function bindGroupFilterControls(rerender) {
  $app.querySelectorAll(".section-pill[data-group]").forEach((btn) => {
    btn.onclick = () => {
      const prevTeam = state.albumTeamIndex;
      state.albumGroupFilter = btn.dataset.group;
      sessionStorage.setItem("albumGroupFilter", state.albumGroupFilter);
      let teamChanged = false;
      if (!["missing", "duplicates"].includes(state.route)) {
        const groups = groupStickersByTeam();
        const inFilter = teamsVisibleInAlbum(groups, state.albumGroupFilter);
        if (inFilter.length) {
          const current = groups[state.albumTeamIndex];
          if (!current || !inFilter.includes(current)) {
            state.albumTeamIndex = groups.indexOf(inFilter[0]);
            state.albumSubPage = 1;
            teamChanged = true;
          }
        }
      }
      rerender({ preserveScroll: true, scrollTeamChip: teamChanged });
    };
  });
}

function bindGroupAndTeamControls(rerender) {
  bindGroupFilterControls(rerender);
  $app.querySelectorAll(".team-chip").forEach((btn) => {
    btn.onclick = () => {
      state.albumTeamIndex = parseInt(btn.dataset.idx, 10);
      state.albumSubPage = 1;
      sessionStorage.setItem("albumTeamIndex", String(state.albumTeamIndex));
      sessionStorage.setItem("albumSubPage", "1");
      rerender({ preserveScroll: true });
    };
  });
}

function bindAlbumPageControls() {
  const rerenderAlbum = (opts = {}) => viewAlbum(opts);
  bindGroupAndTeamControls(rerenderAlbum);

  $app.querySelectorAll("[data-team-filter]").forEach((btn) => {
    btn.onclick = () => {
      const missingOnly = btn.dataset.teamFilter === "missing";
      if (state.albumTeamsMissingOnly === missingOnly) return;
      state.albumTeamsMissingOnly = missingOnly;
      sessionStorage.setItem("albumTeamsMissingOnly", missingOnly ? "1" : "0");
      ensureAlbumFilterSelection(groupStickersByTeam());
      viewAlbum({ preserveScroll: true, scrollTeamChip: true });
    };
  });

  $app.querySelectorAll("[data-album-mode]").forEach((btn) => {
    btn.onclick = () => {
      state.albumMode = btn.dataset.albumMode;
      sessionStorage.setItem("albumMode", state.albumMode);
      viewAlbum({ preserveScroll: true });
    };
  });

  $app.querySelectorAll(".subpage-seg").forEach((btn) => {
    btn.onclick = () => {
      state.albumSubPage = parseInt(btn.dataset.subpage, 10);
      sessionStorage.setItem("albumSubPage", String(state.albumSubPage));
      viewAlbum({ preserveScroll: true });
    };
  });
  document.getElementById("prev-team")?.addEventListener("click", () => {
    if (albumNavigateTeam(-1)) {
      viewAlbum({ scrollToSheet: true, scrollTeamChip: true });
    }
  });
  document.getElementById("next-team")?.addEventListener("click", () => {
    if (albumNavigateTeam(1)) {
      viewAlbum({ scrollToSheet: true, scrollTeamChip: true });
    }
  });
  bindStickerRows(() => {
    groupStickersByTeam();
    viewAlbum({ preserveScroll: true });
  });
  bindAlbumSwipe();
  document.getElementById("btn-import-list")?.addEventListener("click", () => navigate("import"));
  document.getElementById("btn-flash")?.addEventListener("click", () => navigate("flash"));
  document.getElementById("stat-dups")?.addEventListener("click", () => navigate("duplicates"));
  document.getElementById("stat-missing")?.addEventListener("click", () => navigate("missing"));
}

function missingGroupsForFilter(filterId) {
  const groups = groupStickersByTeam();
  return teamsInGroupFilter(groups, filterId)
    .map((g) => ({
      ...g,
      missing: g.stickers.filter((s) => !state.collection[s.id]?.owned),
    }))
    .filter((g) => g.missing.length > 0)
    .sort((a, b) => albumOrderIndex(a.team_code) - albumOrderIndex(b.team_code));
}

function formatMissingSharePayload(filterId) {
  const groups = missingGroupsForFilter(filterId);
  const total = groups.reduce((n, g) => n + g.missing.length, 0);
  const st = stats();
  const pct = st.total ? Math.round((st.owned / st.total) * 100) : 0;
  const filterLabel = filterId === "all" ? "Todos" : groupLabel(filterId) || `Grupo ${filterId}`;
  return { groups, total, pct, filterLabel };
}

function duplicateGroupsForFilter(filterId) {
  const groups = groupStickersByTeam();
  return teamsInGroupFilter(groups, filterId)
    .map((g) => ({
      ...g,
      duplicates: g.stickers.filter((s) => totalCopies(state.collection[s.id]) > 1),
    }))
    .filter((g) => g.duplicates.length > 0)
    .sort((a, b) => albumOrderIndex(a.team_code) - albumOrderIndex(b.team_code));
}

/** Siempre todas las repetidas para compartir (el filtro solo afecta el tablero). */
function formatDuplicatesSharePayload(filterId) {
  const groups = duplicateGroupsForFilter("all");
  const total = groups.reduce((n, g) => n + g.duplicates.length, 0);
  const filterLabel = filterId === "all" ? "Todos" : groupLabel(filterId) || `Grupo ${filterId}`;
  return { groups, total, filterLabel };
}

function renderShareToolbar({ waId, copyId, plainId, plainLabel = "App Panini" }) {
  return `
    <div class="share-toolbar">
      <button type="button" class="btn btn-primary share-tool-btn share-tool-wa" id="${waId}">WhatsApp</button>
      <button type="button" class="btn btn-secondary share-tool-btn" id="${copyId}">Copiar</button>
      <button type="button" class="btn btn-secondary share-tool-btn" id="${plainId}">${plainLabel}</button>
    </div>`;
}

function bindShareToolbar({
  waId,
  copyId,
  plainId,
  getPayload,
  getCopyText,
  getPlainText,
  onWa,
  emptyMsg,
  validatePayload,
}) {
  const needPayload = () => {
    const payload = getPayload();
    const ok = validatePayload
      ? validatePayload(payload)
      : Boolean(payload?.groups?.length);
    if (!ok) {
      alert(emptyMsg || "No hay nada que compartir.");
      return null;
    }
    return payload;
  };

  document.getElementById(waId)?.addEventListener("click", async () => {
    const payload = needPayload();
    if (!payload) return;
    try {
      await onWa(payload);
    } catch (err) {
      alert(err.message || "No se pudo abrir WhatsApp.");
    }
  });

  document.getElementById(copyId)?.addEventListener("click", async () => {
    const payload = needPayload();
    if (!payload) return;
    const text = getCopyText(payload);
    try {
      await copyTextToClipboard(text);
      alert("Trato copiado — pégalo en WhatsApp.");
    } catch {
      window.prompt("Copia el trato:", text);
    }
  });

  document.getElementById(plainId)?.addEventListener("click", async () => {
    const payload = needPayload();
    if (!payload) return;
    const text = getPlainText(payload);
    try {
      await copyTextToClipboard(text);
      alert("Formato plano copiado.");
    } catch {
      window.prompt("Copia (formato plano):", text);
    }
  });
}

function renderDuplicateMiniTile(s) {
  const { team, num } = parsePaniniCode(s);
  return `
    <button type="button" class="duplicate-mini-tile kind-${s.sticker_kind || "jugador"}" data-id="${s.id}" aria-label="${team} ${num}, repetida">
      <span class="mmt-code">${team}<b>${num}</b></span>
    </button>`;
}

function renderDuplicateSparseChip(s, team) {
  const { team: tc, num } = parsePaniniCode(s);
  return `
    <button type="button" class="duplicate-sparse-chip kind-${s.sticker_kind || "jugador"}" data-id="${s.id}" aria-label="${team.team_name} ${tc} ${num}">
      <span class="msc-code">${tc}<b>${num}</b></span>
    </button>`;
}

function renderDuplicateTeamRow(g) {
  const sparse = g.duplicates.length <= 2;
  const slotsHtml = g.duplicates
    .map((s) => (sparse ? renderDuplicateSparseChip(s, g) : renderDuplicateMiniTile(s)))
    .join("");

  if (sparse) {
    return `
      <section class="duplicate-team-row duplicate-team-row--sparse">
        <div class="mtr-lead">
          <span class="mtr-flag">${g.flag}</span>
          <span class="mtr-meta">
            <span class="mtr-name">${g.team_name}</span>
            <span class="mtr-code mono">${g.team_code}</span>
          </span>
        </div>
        <div class="duplicate-sparse-flow mtr-slots">${slotsHtml}</div>
      </section>`;
  }

  return `
    <section class="duplicate-team-row duplicate-team-row--dense">
      <header class="missing-team-head duplicate-team-head">
        <span class="mth-flag">${g.flag}</span>
        <div class="mth-text">
          <span class="mth-name">${g.team_name}</span>
          <span class="mth-code mono">${g.team_code}</span>
        </div>
        <span class="mth-count mth-count--dup">${g.duplicates.length}</span>
      </header>
      <div class="duplicate-mini-grid">${slotsHtml}</div>
    </section>`;
}

function renderDuplicatesBoard(filterId) {
  const teamGroups = duplicateGroupsForFilter(filterId);
  if (!teamGroups.length) {
    return msg("Sin repetidas en este filtro. En el álbum toca + hasta ×2 o más.", "info");
  }
  return `<div class="duplicate-board">${teamGroups.map((g) => renderDuplicateTeamRow(g)).join("")}</div>`;
}

function bindDuplicatesBoardControls(rerender) {
  $app.querySelectorAll(".duplicate-sparse-chip, .duplicate-mini-tile").forEach((btn) => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id, 10);
      const qty = totalCopies(state.collection[id]);
      if (qty <= 1) return;
      try {
        await setStickerCopies(id, qty - 1);
        rerender();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

function renderMissingMiniTile(s) {
  const { team, num } = parsePaniniCode(s);
  return `
    <button type="button" class="missing-mini-tile kind-${s.sticker_kind || "jugador"}" data-id="${s.id}" aria-label="${team} ${num}, falta">
      <span class="mmt-code">${team}<b>${num}</b></span>
    </button>`;
}

function renderMissingSparseChip(s, team) {
  const { team: tc, num } = parsePaniniCode(s);
  return `
    <button type="button" class="missing-sparse-chip kind-${s.sticker_kind || "jugador"}" data-id="${s.id}" aria-label="${team.team_name} ${tc} ${num}">
      <span class="msc-code">${tc}<b>${num}</b></span>
    </button>`;
}

function renderMissingTeamRow(g) {
  const sparse = g.missing.length <= 2;
  const slotsHtml = g.missing
    .map((s) => (sparse ? renderMissingSparseChip(s, g) : renderMissingMiniTile(s)))
    .join("");

  if (sparse) {
    return `
      <section class="missing-team-row missing-team-row--sparse">
        <div class="mtr-lead">
          <span class="mtr-flag">${g.flag}</span>
          <span class="mtr-meta">
            <span class="mtr-name">${g.team_name}</span>
            <span class="mtr-code mono">${g.team_code}</span>
          </span>
        </div>
        <div class="missing-sparse-flow mtr-slots">${slotsHtml}</div>
      </section>`;
  }

  return `
    <section class="missing-team-row missing-team-row--dense">
      <header class="missing-team-head">
        <span class="mth-flag">${g.flag}</span>
        <div class="mth-text">
          <span class="mth-name">${g.team_name}</span>
          <span class="mth-code mono">${g.team_code}</span>
        </div>
        <span class="mth-count">${g.missing.length}</span>
      </header>
      <div class="missing-mini-grid">${slotsHtml}</div>
    </section>`;
}

function renderMissingBreakdown(filterId) {
  const groups = missingGroupsForFilter(filterId);
  const all = groups.flatMap((g) => g.missing);
  if (!all.length) return "";

  const buckets = {
    escudo: { label: "Escudos", icon: "🛡️", items: [] },
    foto_equipo: { label: "Fotos de equipo", icon: "📷", items: [] },
    fwc: { label: "FWC", icon: "🏆", items: [] },
    coca_cola: { label: "Coca-Cola", icon: "🥤", items: [] },
    jugador: { label: "Jugadores", icon: "⚽", items: [] },
  };

  for (const s of all) {
    const key = buckets[s.sticker_kind] ? s.sticker_kind : "jugador";
    buckets[key].items.push(s);
  }

  const lines = Object.values(buckets)
    .filter((b) => b.items.length)
    .map((b) => {
      const byTeam = new Map();
      for (const s of b.items) {
        const { team, num } = parsePaniniCode(s);
        if (!byTeam.has(team)) byTeam.set(team, []);
        byTeam.get(team).push(num);
      }
      const detail = [...byTeam.entries()]
        .sort((a, b) => albumOrderIndex(a[0]) - albumOrderIndex(b[0]))
        .map(([team, nums]) => `${team} ${nums.sort((a, c) => a - c).join(", ")}`)
        .join(" · ");
      return `
        <li class="missing-breakdown-item">
          <span class="missing-breakdown-kind">${b.icon} ${b.label}</span>
          <span class="missing-breakdown-count">${b.items.length}</span>
          <span class="missing-breakdown-detail">${scanEscapeHtml(detail)}</span>
        </li>`;
    })
    .join("");

  return `
    <details class="missing-breakdown card">
      <summary>Desglose por tipo · ${all.length} faltantes</summary>
      <ul class="missing-breakdown-list">${lines}</ul>
    </details>`;
}

function renderMissingBoard(filterId) {
  const teamGroups = missingGroupsForFilter(filterId);
  if (!teamGroups.length) {
    return msg("Nada pendiente en este filtro.", "success");
  }

  return `<div class="missing-board">${teamGroups.map((g) => renderMissingTeamRow(g)).join("")}</div>`;
}

function bindMissingBoardControls(rerender) {
  $app.querySelectorAll(".missing-sparse-chip, .missing-mini-tile").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      try {
        await setStickerCopies(id, 1);
        rerender({ preserveScroll: true });
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

let importPreview = null;

function getImportCatalog() {
  return buildCatalogIndex(state.stickers);
}

async function applyBulkCollection(entries) {
  for (const { stickerId, owned, duplicates } of entries) {
    state.collection[stickerId] = normalizeCollectionRow({ owned, duplicates });
  }
  saveLocalCollection(state.collection);

  if (state.user && supabase) {
    const upserts = entries.map(({ stickerId, owned, duplicates }) => ({
      user_id: state.user.id,
      sticker_id: stickerId,
      owned: Boolean(owned) || (duplicates || 0) > 0,
      duplicates: duplicates || 0,
    }));
    for (let i = 0; i < upserts.length; i += 200) {
      const { error } = await supabase
        .from("user_stickers")
        .upsert(upserts.slice(i, i + 200), { onConflict: "user_id,sticker_id" });
      if (error) throw new Error(`Error al sincronizar: ${error.message}`);
    }
  }
}

async function applyImportResult(result) {
  if (result.mode === "missing") {
    const missingIds = new Set(result.matched.map((m) => m.sticker.id));
    const entries = state.stickers.map((s) => ({
      stickerId: s.id,
      owned: !missingIds.has(s.id),
      duplicates: 0,
    }));
    await applyBulkCollection(entries);
    return {
      missing: result.matched.length,
      owned: entries.length - result.matched.length,
    };
  }

  for (const item of result.matched) {
    const id = item.sticker.id;
    if (result.mode === "owned") {
      await setStickerCopies(id, item.qty);
    } else if (result.mode === "duplicates") {
      const listedTotal = item.qty >= 2 ? item.qty : 2;
      const current = totalCopies(state.collection[id]);
      await setStickerCopies(id, Math.min(MAX_ALBUM_COPIES, Math.max(current, listedTotal)));
    }
  }
  return { updated: result.matched.length };
}

function importModeLabel(mode) {
  if (mode === "owned") return "Las tengo";
  if (mode === "duplicates") return "Repetidas";
  return "Me faltan";
}

function renderImportPreviewHtml(preview) {
  const byTeam = new Map();
  for (const m of preview.matched) {
    if (!byTeam.has(m.teamCode)) {
      byTeam.set(m.teamCode, {
        teamCode: m.teamCode,
        slots: [],
        flag: TEAM_FLAGS[m.teamCode] || "⚽",
      });
    }
    byTeam.get(m.teamCode).slots.push(m.slot);
  }
  const teams = [...byTeam.values()].sort(
    (a, b) => albumOrderIndex(a.teamCode) - albumOrderIndex(b.teamCode)
  );

  const teamBlocks = teams
    .map((team) => {
      const slots = team.slots.sort((a, b) => a - b);
      return `
        <div class="import-preview-team">
          <div class="import-preview-team-head">
            <span class="import-preview-flag">${team.flag}</span>
            <span class="import-preview-team-code">${team.teamCode}</span>
            <span class="import-preview-team-count">${slots.length}</span>
          </div>
          <div class="import-preview-slots">
            ${slots.map((slot) => `<span class="import-slot-chip">${slot}</span>`).join("")}
          </div>
        </div>`;
    })
    .join("");

  const unknownHtml = preview.unknown.length
    ? `<div class="import-preview-warn">
        <strong>${preview.unknown.length}</strong> no reconocidas:
        ${preview.unknown
          .slice(0, 6)
          .map((u) => `<code>${scanEscapeHtml(u.raw)}</code>`)
          .join(" ")}${preview.unknown.length > 6 ? "…" : ""}
      </div>`
    : "";

  const applyNote =
    preview.mode === "missing" && state.stickers.length
      ? `<p class="import-preview-note">Al aplicar: <strong>${preview.matched.length} faltantes</strong> · <strong>${state.stickers.length - preview.matched.length}</strong> se marcarán como tengo.</p>`
      : "";

  return `
    <div class="import-preview card">
      <div class="import-preview-head">
        <span class="import-preview-count">${preview.matched.length} láminas</span>
        <span class="import-preview-mode">${importModeLabel(preview.mode)}</span>
      </div>
      ${applyNote}
      <div class="import-preview-scroll">${teamBlocks}</div>
      ${unknownHtml}
    </div>`;
}

function viewGuia() {
  shell(
    "Guía rápida",
    "Lo esencial para empezar",
    `
    <div class="guia-stack">
      <section class="card guia-section">
        <h2>📖 Tu álbum (sin cuenta)</h2>
        <p>Marca láminas en <strong>✏️ Editar</strong>. Todo se guarda en este dispositivo.</p>
        <p class="guia-tip">FWC tiene <strong>5 páginas</strong> — usa las pestañas o desliza ↔ para cambiar de página (no de equipo).</p>
      </section>
      <section class="card guia-section guia-section--highlight">
        <h2>📋 Pegar lista (importante)</h2>
        <ol class="guia-steps">
          <li>Álbum → <strong>Pegar lista</strong></li>
          <li>Elige modo: <strong>Me faltan</strong> · <strong>Las tengo</strong> · <strong>Repetidas</strong></li>
          <li>Pega texto de WhatsApp o la app Panini</li>
          <li><strong>Vista previa</strong> → <strong>Aplicar al álbum</strong></li>
        </ol>
        <p class="guia-examples">Ejemplos: <code>MEX 15, 19</code> · <code>FWC 3, 7</code> · <code>MEX: 4(1x) 10(3x)</code> · <code>CC 1-12</code></p>
        <button type="button" class="btn btn-primary" id="guia-go-import">Ir a pegar lista</button>
      </section>
      <section class="card guia-section guia-section--highlight">
        <h2>⚡ Intercambio flash</h2>
        <p>Arma un trato pegando lo que cada uno tiene de más y de menos. <strong>No necesitas cuenta.</strong></p>
        <ol class="guia-steps">
          <li>Pega sus <strong>repetidas</strong></li>
          <li>Pega lo que <strong>te faltan</strong> de ellos</li>
          <li>Revisa el trato sugerido y compártelo por WhatsApp</li>
        </ol>
        <button type="button" class="btn btn-primary" id="guia-go-flash">Probar flash</button>
      </section>
      <section class="card guia-section">
        <h2>🤝 Cuenta y explorar (opcional)</h2>
        <p>Solo si quieres ver coleccionistas, enviar solicitudes o guardar el álbum en la nube.</p>
        <ul class="guia-list">
          <li><strong>Cuenta</strong> — quinta pestaña abajo → entrar o registrarse</li>
          <li><strong>Cambiar</strong> — intercambio flash sin cuenta</li>
          <li><strong>Ubicación</strong> — solo para Explorar cerca (puedes omitirla al inicio)</li>
        </ul>
        <button type="button" class="btn btn-secondary" id="guia-go-cuenta">Ir a Cuenta</button>
      </section>
    </div>
    <button type="button" class="btn btn-ghost guia-back" id="guia-back">← Volver al álbum</button>
    `,
    true
  );
  document.getElementById("guia-go-import")?.addEventListener("click", () => navigate("import"));
  document.getElementById("guia-go-flash")?.addEventListener("click", () => navigate("flash"));
  document.getElementById("guia-go-cuenta")?.addEventListener("click", () => navigate("cuenta"));
  document.getElementById("guia-back")?.addEventListener("click", () => navigate("album"));
}

function viewImport() {
  const defaultText = sessionStorage.getItem("importListDraft") || "";
  const mode = sessionStorage.getItem("importListMode") || detectImportMode(defaultText);
  importPreview = defaultText
    ? parseStickerList(defaultText, getImportCatalog(), { mode })
    : null;

  const previewHtml = importPreview ? renderImportPreviewHtml(importPreview) : "";

  shell(
    "Pegar lista",
    "Pega el texto de WhatsApp, Panini app u otra app",
    `
    <div class="import-page">
      <div class="import-panel card">
        <details class="import-formats">
          <summary>Formatos que entiende</summary>
          <ul class="import-formats-list">
            <li><code>MEX 15, 19</code> o <code>MEX: 4(1x) 10(3x)</code></li>
            <li><code>FWC 3, 7</code> · <code>CC 1-12</code> (Coca-Cola)</li>
            <li><code>🇲🇽 15</code> · <code>MEX15</code> · <code>#981</code></li>
          </ul>
        </details>
        <div class="import-mode-tabs" role="tablist">
          <label class="import-mode-tab ${mode === "missing" ? "active" : ""}">
            <input type="radio" name="import-mode" value="missing" ${mode === "missing" ? "checked" : ""}>
            <span class="import-mode-tab-title">Me faltan</span>
            <span class="import-mode-tab-sub">resto = tengo</span>
          </label>
          <label class="import-mode-tab ${mode === "owned" ? "active" : ""}">
            <input type="radio" name="import-mode" value="owned" ${mode === "owned" ? "checked" : ""}>
            <span class="import-mode-tab-title">Las tengo</span>
          </label>
          <label class="import-mode-tab ${mode === "duplicates" ? "active" : ""}">
            <input type="radio" name="import-mode" value="duplicates" ${mode === "duplicates" ? "checked" : ""}>
            <span class="import-mode-tab-title">Repetidas</span>
          </label>
        </div>
        <label class="import-text-label" for="import-text">Texto pegado</label>
        <textarea id="import-text" class="import-textarea" rows="8" placeholder="Pega aquí la lista completa…">${defaultText.replace(/</g, "&lt;")}</textarea>
        <div class="import-buttons">
          <button type="button" class="btn btn-secondary" id="import-preview">Vista previa</button>
          <button type="button" class="btn btn-primary" id="import-apply" ${importPreview?.matched.length ? "" : "disabled"}>Aplicar al álbum</button>
        </div>
      </div>
      ${previewHtml}
      <button type="button" class="btn btn-secondary import-back" id="import-back">← Volver al álbum</button>
    </div>
    `,
    true
  );

  const textarea = document.getElementById("import-text");
  const getMode = () => document.querySelector('input[name="import-mode"]:checked')?.value || "missing";

  const refreshPreview = () => {
    const text = textarea.value;
    sessionStorage.setItem("importListDraft", text);
    sessionStorage.setItem("importListMode", getMode());
    importPreview = text.trim()
      ? parseStickerList(text, getImportCatalog(), { mode: getMode() })
      : null;
    viewImport();
  };

  textarea.addEventListener("input", () => {
    sessionStorage.setItem("importListDraft", textarea.value);
  });
  document.querySelectorAll('input[name="import-mode"]').forEach((el) => {
    el.onchange = refreshPreview;
  });
  document.getElementById("import-preview")?.addEventListener("click", refreshPreview);
  document.getElementById("import-apply")?.addEventListener("click", async () => {
    if (!importPreview?.matched.length) return;
    try {
      const summary = await applyImportResult(importPreview);
      sessionStorage.removeItem("importListDraft");
      const msg =
        importPreview.mode === "missing"
          ? `Álbum cargado: ${summary.missing} faltan · ${summary.owned} tengo.`
          : `${summary.updated} láminas actualizadas.`;
      alert(msg);
      navigate(
        importPreview.mode === "duplicates"
          ? "duplicates"
          : importPreview.mode === "owned"
            ? "album"
            : "missing"
      );
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("import-back")?.addEventListener("click", () => navigate("album"));
}

function scanEscapeHtml(s) {
  return shellEscapeHtml(s);
}

function viewScan() {
  activeScanCleanup?.();
  activeScanCleanup = null;

  const catalog = getImportCatalog();
  const scanMode = sessionStorage.getItem("scanMode") || "owned";
  let sessionCount = parseInt(sessionStorage.getItem("scanSessionCount") || "0", 10);
  let cameraStream = null;
  const liveCamera = canUseLiveCamera();
  const cameraBlock = getLiveCameraBlockInfo();
  const statusHint = liveCamera ? "Centra el código en el marco" : "Toca «Tomar foto» para abrir la cámara";

  const alertHtml = cameraBlock
    ? `<div class="scan-alert card">
        <p class="scan-alert-title">${scanEscapeHtml(cameraBlock.title)}</p>
        <p class="scan-alert-detail">${scanEscapeHtml(cameraBlock.detail)}</p>
        <p class="scan-alert-action">${scanEscapeHtml(cameraBlock.action)}</p>
      </div>`
    : "";

  shell(
    "Escanear láminas",
    liveCamera ? "Reverso de la lámina · buena luz" : "Modo foto · reverso de la lámina",
    `
    <div class="scan-wrap">
      ${alertHtml}
      <div class="scan-stage ${liveCamera ? "" : "scan-stage--photo"}" id="scan-stage">
        <video class="scan-video ${liveCamera ? "" : "hidden"}" id="scan-video" playsinline muted></video>
        ${
          liveCamera
            ? `<div class="scan-overlay">
                <div class="scan-guide">
                  <span class="scan-guide-hint">ARG 10</span>
                </div>
              </div>`
            : `<div class="scan-photo-placeholder">
                <span class="scan-photo-icon">📷</span>
                <p>Enfoca el código del reverso</p>
                <p class="scan-photo-sub">ARG 10 · MEX 15 · CC 1</p>
              </div>`
        }
        <div class="scan-status" id="scan-status">${liveCamera ? "Preparando cámara…" : statusHint}</div>
        <div class="scan-busy hidden" id="scan-busy">
          <div class="scan-spinner"></div>
          <span>Leyendo…</span>
        </div>
      </div>

      <div class="scan-result hidden" id="scan-result"></div>

      <div class="scan-manual hidden card" id="scan-manual">
        <p class="scan-manual-title">Escribir código</p>
        <div class="scan-manual-row">
          <input id="manual-team" class="scan-manual-input" maxlength="3" placeholder="MEX" autocapitalize="characters" />
          <input id="manual-slot" class="scan-manual-input scan-manual-num" type="number" min="1" max="20" placeholder="15" />
          <button type="button" class="btn btn-primary" id="manual-go">OK</button>
        </div>
      </div>

      <div class="scan-toolbar card">
        <div class="scan-mode-toggle">
          <button type="button" class="scan-mode-btn ${scanMode === "owned" ? "active" : ""}" data-scan-mode="owned">La tengo</button>
          <button type="button" class="scan-mode-btn ${scanMode === "duplicate" ? "active" : ""}" data-scan-mode="duplicate">Repetida</button>
        </div>
        <div class="scan-action-row">
          <button type="button" class="btn btn-secondary scan-side-btn" id="scan-keyboard">⌨️</button>
          ${
            liveCamera
              ? `<button type="button" class="btn btn-primary scan-capture-btn" id="scan-capture">Capturar</button>
                 <button type="button" class="btn btn-secondary scan-side-btn" id="scan-file-btn" title="Tomar foto">📁</button>`
              : `<button type="button" class="btn btn-primary scan-capture-btn" id="scan-photo-main">Tomar foto</button>
                 <button type="button" class="btn btn-secondary scan-side-btn" id="scan-keyboard2">⌨️</button>`
          }
        </div>
        <input type="file" id="scan-file" accept="image/*" capture="environment" hidden />
        <p class="scan-foot">Sesión: <strong id="scan-count">${sessionCount}</strong> · <a href="#album" id="scan-exit">Salir</a></p>
      </div>
    </div>
    `,
    true
  );

  const video = /** @type {HTMLVideoElement} */ (document.getElementById("scan-video"));
  const statusEl = document.getElementById("scan-status");
  const busyEl = document.getElementById("scan-busy");
  const resultEl = document.getElementById("scan-result");
  const manualEl = document.getElementById("scan-manual");
  const countEl = document.getElementById("scan-count");
  const defaultStatus = statusHint;

  const setStatus = (t) => {
    if (statusEl) statusEl.textContent = t;
  };
  const setBusy = (on) => busyEl?.classList.toggle("hidden", !on);

  activeScanCleanup = () => {
    stopCamera(cameraStream);
    cameraStream = null;
  };

  initOcrWorker().then(() => {
    if (cameraStream || !liveCamera) setStatus(defaultStatus);
  });

  if (liveCamera) {
    startCamera(video)
      .then((stream) => {
        cameraStream = stream;
        setStatus(defaultStatus);
      })
      .catch((err) => {
        setStatus(err.message || "Sin cámara en vivo — usa Tomar foto");
      });
  }

  const bindResultButtons = (match) => {
    document.getElementById("scan-confirm")?.addEventListener("click", async () => {
      if (match) await applyScanMatch(match);
    });
    document.getElementById("scan-retry")?.addEventListener("click", () => {
      resultEl?.classList.add("hidden");
      if (resultEl) resultEl.innerHTML = "";
    });
    document.getElementById("scan-manual-open")?.addEventListener("click", () => {
      manualEl?.classList.remove("hidden");
      if (match) {
        const teamInput = /** @type {HTMLInputElement} */ (document.getElementById("manual-team"));
        const slotInput = /** @type {HTMLInputElement} */ (document.getElementById("manual-slot"));
        if (teamInput) teamInput.value = match.teamCode;
        if (slotInput) slotInput.value = String(match.slot);
      }
      resultEl?.classList.add("hidden");
    });
    resultEl?.querySelectorAll(".scan-alt-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const team = btn.getAttribute("data-team");
        const slot = parseInt(btn.getAttribute("data-slot") || "", 10);
        const sticker = catalog.byTeamSlot.get(`${team}:${slot}`);
        if (sticker) {
          await applyScanMatch({ teamCode: team, slot, sticker, qty: 1, raw: `${team} ${slot}` });
        }
      });
    });
  };

  const renderResult = (payload) => {
    const { match, alternatives, ocrText } = payload;
    if (!resultEl) return;

    if (!match) {
      resultEl.classList.remove("hidden");
      resultEl.innerHTML = `
        <div class="scan-result-card scan-result-fail card">
          <p class="scan-result-label">No detecté un código claro</p>
          <p class="scan-ocr-raw">OCR: «${scanEscapeHtml(String(ocrText || "").trim().slice(0, 80))}»</p>
          <button type="button" class="btn btn-secondary" id="scan-retry">Reintentar</button>
          <button type="button" class="btn btn-primary" id="scan-manual-open">Escribir código</button>
        </div>`;
      bindResultButtons(null);
      return;
    }

    const s = match.sticker;
    const flag = TEAM_FLAGS[match.teamCode] || "⚽";
    const altHtml = alternatives?.length
      ? `<p class="scan-alt">¿Cuál es? ${alternatives
          .slice(0, 4)
          .map(
            (a) =>
              `<button type="button" class="scan-alt-btn" data-team="${a.teamCode}" data-slot="${a.slot}">${a.teamCode} ${a.slot}</button>`
          )
          .join(" ")}</p>`
      : "";

    resultEl.classList.remove("hidden");
    resultEl.innerHTML = `
      <div class="scan-result-card card">
        <p class="scan-result-label">¿Es esta lámina?</p>
        <div class="scan-match-big">${flag} <strong>${match.teamCode} ${match.slot}</strong></div>
        <p class="scan-match-sub">${kindLabel(s)} · ${statusLabel(s)}</p>
        <p class="scan-ocr-raw">Leído: «${scanEscapeHtml(String(ocrText || "").trim().slice(0, 40))}»</p>
        ${altHtml}
        <button type="button" class="btn btn-primary" id="scan-confirm">✓ Sí, agregar</button>
        <button type="button" class="btn btn-secondary" id="scan-retry">Otra foto</button>
        <button type="button" class="btn btn-secondary" id="scan-manual-open">Corregir</button>
      </div>`;
    bindResultButtons(match);
  };

  const applyScanMatch = async (match) => {
    const id = match.sticker.id;
    const mode = sessionStorage.getItem("scanMode") || "owned";
    const qty = totalCopies(state.collection[id]);
    try {
      if (mode === "duplicate") {
        await setStickerCopies(id, Math.min(9, Math.max(1, qty + 1)));
      } else if (qty === 0) {
        await setStickerCopies(id, 1);
      } else {
        await setStickerCopies(id, Math.min(9, qty + 1));
      }
      sessionCount += 1;
      sessionStorage.setItem("scanSessionCount", String(sessionCount));
      if (countEl) countEl.textContent = String(sessionCount);
      resultEl?.classList.add("hidden");
      if (resultEl) resultEl.innerHTML = "";
      manualEl?.classList.add("hidden");
      setStatus("✓ Agregada");
      setTimeout(() => setStatus(defaultStatus), 900);
    } catch (err) {
      alert(err.message);
    }
  };

  const runCapture = async (fn) => {
    setBusy(true);
    try {
      const payload = await fn((p) => setStatus(`Leyendo… ${Math.round(p * 100)}%`));
      renderResult(payload);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
      setStatus(defaultStatus);
    }
  };

  const fileInput = /** @type {HTMLInputElement} */ (document.getElementById("scan-file"));
  const openPhoto = () => fileInput?.click();

  document.getElementById("scan-capture")?.addEventListener("click", () => {
    if (!cameraStream) {
      openPhoto();
      return;
    }
    runCapture((onProgress) => recognizeFromVideo(video, catalog, onProgress));
  });

  document.getElementById("scan-photo-main")?.addEventListener("click", openPhoto);
  document.getElementById("scan-file-btn")?.addEventListener("click", openPhoto);
  document.getElementById("scan-keyboard2")?.addEventListener("click", () => {
    manualEl?.classList.toggle("hidden");
  });
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) runCapture((onProgress) => recognizeFromFile(file, catalog, onProgress));
  });

  document.getElementById("scan-keyboard")?.addEventListener("click", () => {
    manualEl?.classList.toggle("hidden");
  });

  document.getElementById("manual-go")?.addEventListener("click", async () => {
    const team = /** @type {HTMLInputElement} */ (document.getElementById("manual-team"))?.value
      .trim()
      .toUpperCase();
    const slot = parseInt(/** @type {HTMLInputElement} */ (document.getElementById("manual-slot"))?.value || "", 10);
    const payload = matchOcrText(`${team} ${slot}`, catalog);
    if (payload.match) await applyScanMatch(payload.match);
    else alert(`No encontré ${team} ${slot} en el catálogo`);
  });

  document.querySelectorAll("[data-scan-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sessionStorage.setItem("scanMode", btn.getAttribute("data-scan-mode") || "owned");
      document.querySelectorAll("[data-scan-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  document.getElementById("scan-exit")?.addEventListener("click", (e) => {
    e.preventDefault();
    activeScanCleanup?.();
    activeScanCleanup = null;
    navigate("album");
  });
}

// --- Views ---

function authFlashMessageHtml() {
  const flash = consumeAuthFlash();
  if (!flash) return "";
  return msg(flash.message, flash.type === "error" ? "error" : "success");
}

function renderAuthIntentBar(active) {
  return `
    <div class="auth-mode-bar" role="tablist" aria-label="Cuenta">
      <button type="button" class="auth-mode-btn ${active === "signin" ? "active" : ""}" data-auth-intent="signin" aria-selected="${active === "signin"}">Entrar</button>
      <button type="button" class="auth-mode-btn ${active === "signup" ? "active" : ""}" data-auth-intent="signup" aria-selected="${active === "signup"}">Registrarse</button>
    </div>`;
}

function renderAuthModeBar(active) {
  return `
    <div class="auth-mode-bar auth-mode-bar--nested" role="tablist" aria-label="Forma de entrar">
      <button type="button" class="auth-mode-btn ${active === "magic" ? "active" : ""}" data-auth-mode="magic" aria-selected="${active === "magic"}">✉️ Por correo</button>
      <button type="button" class="auth-mode-btn ${active === "password" ? "active" : ""}" data-auth-mode="password" aria-selected="${active === "password"}">🔑 Contraseña</button>
    </div>`;
}

function bindCuentaAuthForm() {
  const getEmail = () => {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) throw new Error("Escribe tu correo.");
    return email;
  };

  const getCreds = () => {
    const email = getEmail();
    const password = document.getElementById("auth-password").value;
    if (!password || password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
    return { email, password };
  };

  const authIntent = sessionStorage.getItem("authIntent") === "signup" ? "signup" : "signin";
  const authMode = sessionStorage.getItem("authMode") === "password" ? "password" : "magic";

  $app.querySelectorAll("[data-auth-intent]").forEach((btn) => {
    btn.onclick = () => {
      sessionStorage.setItem("authIntent", btn.dataset.authIntent);
      viewCuenta();
    };
  });

  $app.querySelectorAll("[data-auth-mode]").forEach((btn) => {
    btn.onclick = () => {
      sessionStorage.setItem("authMode", btn.dataset.authMode);
      viewCuenta();
    };
  });

  document.getElementById("btn-magic-link")?.addEventListener("click", async () => {
    try {
      const email = getEmail();
      const btn = document.getElementById("btn-magic-link");
      rememberAuthReturnRoute("cuenta");
      btn.disabled = true;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authCallbackUrl(),
          shouldCreateUser: true,
        },
      });
      btn.disabled = false;
      if (error) {
        alert(humanizeAuthError(error.message));
        return;
      }
      alert(`Te enviamos un enlace a ${email}. Ábrelo en este mismo navegador.`);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("btn-sign-in")?.addEventListener("click", async () => {
    try {
      const { email, password } = getCreds();
      const btn = document.getElementById("btn-sign-in");
      btn.disabled = true;
      const { error } = await signInWithEmailPassword(email, password);
      btn.disabled = false;
      if (error) {
        alert(humanizeAuthError(error.message));
        return;
      }
      navigate(state.returnAfterAuth || "cuenta");
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("btn-sign-up")?.addEventListener("click", async () => {
    try {
      const { email, password } = getCreds();
      const btn = document.getElementById("btn-sign-up");
      btn.disabled = true;
      const { error, needsConfirm } = await signUpWithEmailPassword(email, password);
      btn.disabled = false;
      if (error) {
        alert(humanizeAuthError(error.message));
        return;
      }
      if (needsConfirm) {
        alert(`Cuenta creada. Revisa ${email} y confirma el enlace para entrar.`);
        sessionStorage.setItem("authIntent", "signin");
        viewCuenta();
        return;
      }
      navigate("cuenta");
    } catch (e) {
      alert(e.message);
    }
  });
}

function viewCuenta() {
  if (state.user) {
    viewCuentaHub();
    return;
  }

  if (!supabaseConfigured) {
    shell(
      "Cuenta",
      "Mundial FIFA 2026",
      `${renderWelcomeMessage()}${msg("Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en frontend/.env.", "error")}`,
      true
    );
    return;
  }

  const authIntent = sessionStorage.getItem("authIntent") === "signup" ? "signup" : "signin";
  const authMode = sessionStorage.getItem("authMode") === "password" ? "password" : "magic";

  const signInPanel =
    authIntent === "signin"
      ? `
      ${renderAuthModeBar(authMode)}
      <div id="auth-panel-magic" class="${authMode === "magic" ? "" : "hidden"}">
        <button class="btn btn-primary" id="btn-magic-link">Enviar enlace</button>
        <p class="auth-email-hint">
          Revisa tu correo → abre <strong>solo el último</strong> enlace → mismo navegador.
        </p>
      </div>
      <div id="auth-panel-password" class="${authMode === "password" ? "" : "hidden"}">
        <label>Contraseña</label>
        <input type="password" id="auth-password" placeholder="Mínimo 8 caracteres" autocomplete="current-password" />
        <button class="btn btn-primary" id="btn-sign-in">Entrar</button>
        <p class="auth-email-hint">
          ¿Entraste antes solo con magic link? Ve a <strong>Perfil → Crear contraseña</strong> (una vez) y luego usa Entrar aquí.
        </p>
      </div>`
      : `
      <label>Contraseña</label>
      <input type="password" id="auth-password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
      <button class="btn btn-primary" id="btn-sign-up">Crear cuenta</button>
      <p class="auth-email-hint">Te enviaremos un correo para confirmar la cuenta.</p>`;

  shell(
    "Cuenta",
    "Opcional — para nube y explorar cerca",
    `
    ${renderWelcomeMessage()}
    <div class="auth-card card">
      ${authFlashMessageHtml()}
      ${renderAuthIntentBar(authIntent)}
      <label>Correo electrónico</label>
      <input type="email" id="auth-email" placeholder="tu@correo.com" autocomplete="email" />
      ${signInPanel}
      <button class="btn btn-ghost" id="btn-back-album">Volver al álbum</button>
    </div>
    `,
    true
  );

  bindCuentaAuthForm();
  document.getElementById("btn-back-album")?.addEventListener("click", () => navigate("album"));
}

function viewCambiarLanding() {
  const st = stats();
  shell(
    "Cambiar",
    "Intercambio flash · sin cuenta",
    `
    <div class="hub-hero card">
      <div class="hub-hero-stat">
        <span class="hub-hero-value">${st.dupCount}</span>
        <span class="hub-hero-label">repetidas</span>
      </div>
      <div class="hub-hero-stat">
        <span class="hub-hero-value">${st.missing}</span>
        <span class="hub-hero-label">faltan</span>
      </div>
    </div>
    <div class="card flash-hub-card">
      <p class="flash-hub-lead">Pega lo que cada uno tiene de más y de menos. La app arma el trato y lo compartes por WhatsApp.</p>
      <button type="button" class="btn btn-primary flash-hub-main" id="go-flash">⚡ Empezar intercambio flash</button>
    </div>
    <p class="auth-email-hint">¿Quieres ver gente cerca o guardar en la nube? Ve a la pestaña <strong>Cuenta</strong>. · <a href="#guia" class="guia-link">Guía</a></p>
    `,
    true
  );
  document.getElementById("go-flash")?.addEventListener("click", () => navigate("flash"));
}

function viewCuentaHub() {
  const st = stats();
  const location = state.profile?.city
    ? `${state.profile.city} · ${state.profile.search_radius_km || 25} km`
    : "Configura tu zona";

  shell(
    "Cuenta",
    location,
    `
    ${authFlashMessageHtml()}
    <div class="hub-hero card">
      <div class="hub-hero-stat">
        <span class="hub-hero-value">${st.dupCount}</span>
        <span class="hub-hero-label">repetidas</span>
      </div>
      <div class="hub-hero-stat">
        <span class="hub-hero-value">${st.missing}</span>
        <span class="hub-hero-label">faltan</span>
      </div>
    </div>
    <div class="hub-grid">
      <button type="button" class="hub-tile" id="go-explore">
        <span class="hub-tile-icon">🔍</span>
        <span class="hub-tile-title">Explorar</span>
        <span class="hub-tile-desc">Coleccionistas cerca</span>
      </button>
      <button type="button" class="hub-tile" id="go-trades">
        <span class="hub-tile-icon">📬</span>
        <span class="hub-tile-title">Solicitudes</span>
        <span class="hub-tile-desc">Tus intercambios</span>
      </button>
      <button type="button" class="hub-tile" id="go-profile">
        <span class="hub-tile-icon">📍</span>
        <span class="hub-tile-title">Perfil</span>
        <span class="hub-tile-desc">${state.profile?.profile_complete ? "Ciudad y radio" : "Ubicación (opcional)"}</span>
      </button>
      <button type="button" class="hub-tile" id="go-guia">
        <span class="hub-tile-icon">❓</span>
        <span class="hub-tile-title">Guía</span>
        <span class="hub-tile-desc">Pegar listas y flash</span>
      </button>
    </div>
    <button type="button" class="btn btn-ghost" id="logout">Cerrar sesión</button>
    `,
    true
  );
  document.getElementById("go-explore")?.addEventListener("click", () => navigate("explore"));
  document.getElementById("go-trades")?.addEventListener("click", () => navigate("trades"));
  document.getElementById("go-profile")?.addEventListener("click", () => navigate("profile"));
  document.getElementById("go-guia")?.addEventListener("click", () => navigate("guia"));
  document.getElementById("logout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    state.user = null;
    state.profile = null;
    navigate("album");
  });
}

function renderFlashSteps(current) {
  const steps = [
    { n: 1, label: "Sus repetidas", short: "R" },
    { n: 2, label: "Sus faltantes", short: "F" },
    { n: 3, label: "Trato", short: "✓" },
  ];
  return `<div class="flash-steps flash-steps--v2">${steps
    .map(
      (s, i) =>
        `<div class="flash-step-wrap">
          ${i > 0 ? `<div class="flash-step-line ${s.n <= current ? "lit" : ""}"></div>` : ""}
          <div class="flash-step ${s.n === current ? "active" : ""} ${s.n < current ? "done" : ""}">
            <span class="flash-step-num">${s.n < current ? "✓" : s.n}</span>
            <span class="flash-step-label">${s.label}</span>
          </div>
        </div>`
    )
    .join("")}</div>`;
}

function renderFlashReceivePanel(items, selectedKeys) {
  if (!items.length) {
    return `<div class="flash-panel-section"><p class="flash-pick-empty">Pega sus repetidas en paso 1 para ver qué te sirve.</p></div>`;
  }

  const tier0 = items.filter((i) => i.isPick || i.requestTier === 0);
  const tier1 = items.filter((i) => !i.isPick && i.requestTier === 1);
  const tier2 = items.filter((i) => !i.isPick && i.requestTier === 2);
  const tier3 = items.filter((i) => !i.isPick && i.requestTier === 3);
  const selected = items.filter((i) => selectedKeys.has(i.key));

  const renderChip = (i) => {
    const on = selectedKeys.has(i.key);
    const kind = stickerKindMark(i.sticker);
    const specialCls = i.especial ? " flash-pick-chip--special" : "";
    const myQty = i.myQty ?? totalCopies(state.collection[i.sticker?.id]);
    const tierLbl = i.isPick ? "Pick" : requestTierLabel(i.requestTier);
    const tierNum = i.isPick ? 0 : i.requestTier;
    const tierTag = tierLbl
      ? `<span class="flash-pick-tag flash-pick-tag--tier${tierNum}">${tierLbl}</span>`
      : "";
    const qtyTag = `<span class="flash-pick-tag flash-pick-tag--myqty">yo ×${myQty}</span>`;
    return `<button type="button" class="flash-pick-chip${specialCls} ${on ? "selected" : ""}" data-side="receive" data-key="${i.key}">
      <span class="flash-pick-slot">${kind}<span class="flash-pick-num">${i.slot}</span></span>${tierTag}${qtyTag}
    </button>`;
  };

  const renderGroup = (groupItems) => {
    const groups = groupTradeItems(groupItems);
    return groups
      .map(
        (g) => `
        <div class="flash-pick-team">
          <div class="flash-pick-team-head">
            <span class="flash-pick-flag">${g.flag}</span>
            <span class="flash-pick-team-name">${scanEscapeHtml(g.team_name || tradeTeamLabel(g.team_code, g.items[0]?.sticker))}</span>
          </div>
          <div class="flash-pick-slots">${g.items.map(renderChip).join("")}</div>
        </div>`
      )
      .join("");
  };

  const tierBlock = (label, cls, list) =>
    list.length
      ? `<div class="flash-pick-category">
          <span class="flash-pick-cat-label ${cls}">${label} · ${list.length}</span>
          <div class="flash-pick-grid">${renderGroup(list)}</div>
        </div>`
      : "";

  return `
    <div class="flash-panel-section">
      <div class="flash-pick-head">
        <span class="flash-pick-emoji">📥</span>
        <span class="flash-pick-title">Yo recibo</span>
        <span class="flash-pick-count">${selected.length} elegidas</span>
      </div>
      <p class="flash-pick-hint">Solo láminas que tú tienes menos de ×3. Cada chip muestra cuántas tienes.</p>
      <div class="flash-pick-actions">
        <button type="button" class="flash-pick-all" data-side="receive" data-action="suggested">Trato sugerido</button>
        <button type="button" class="flash-pick-all" data-side="receive" data-action="picks">Solo mis picks</button>
        <button type="button" class="flash-pick-all" data-side="receive" data-action="all">Todas</button>
        <button type="button" class="flash-pick-all" data-side="receive" data-action="none">Ninguna</button>
      </div>
      ${tierBlock("🎯 Mis picks (prioridad máxima)", "flash-pick-cat--pick", tier0)}
      ${tierBlock("⭐ Especiales (tienes 0–2)", "flash-pick-cat--special", tier1)}
      ${tierBlock("🔴 Te faltan (×0)", "flash-pick-cat--need", tier2)}
      ${tierBlock("🟡 Pocas repetidas (×1–2)", "flash-pick-cat--have", tier3)}
    </div>`;
}

function renderFlashGivePanel(items, selectedKeys) {
  if (!items.length) {
    return `<div class="flash-panel-section"><p class="flash-pick-empty">Marca lo que le falta en paso 2 o añade abajo.</p></div>`;
  }

  const mega = items.filter((i) => (i.myQty || 0) >= 3);
  const normal = items.filter((i) => (i.myQty || 0) === 2);
  const selected = items.filter((i) => selectedKeys.has(i.key));

  const renderChip = (i) => {
    const on = selectedKeys.has(i.key);
    const kind = stickerKindMark(i.sticker);
    const specialCls = i.especial ? " flash-pick-chip--special" : "";
    const myQty = i.myQty ?? 1;
    let statusTag = "";
    if (myQty >= 3) {
      statusTag = `<span class="flash-pick-tag flash-pick-tag--hot">yo ×${myQty}</span>`;
    } else if (myQty === 2) {
      statusTag = `<span class="flash-pick-tag flash-pick-tag--dup">yo ×${myQty}</span>`;
    } else {
      statusTag = `<span class="flash-pick-tag flash-pick-tag--warn">yo ×1</span>`;
    }
    return `<button type="button" class="flash-pick-chip${specialCls} ${on ? "selected" : ""}" data-side="give" data-key="${i.key}">
      <span class="flash-pick-slot">${kind}<span class="flash-pick-num">${i.slot}</span></span>${statusTag}
    </button>`;
  };

  const renderGroup = (groupItems) => {
    const groups = groupTradeItems(groupItems);
    return groups
      .map(
        (g) => `
        <div class="flash-pick-team">
          <div class="flash-pick-team-head">
            <span class="flash-pick-flag">${g.flag}</span>
            <span class="flash-pick-team-name">${scanEscapeHtml(g.team_name || tradeTeamLabel(g.team_code, g.items[0]?.sticker))}</span>
          </div>
          <div class="flash-pick-slots">${g.items.map(renderChip).join("")}</div>
        </div>`
      )
      .join("");
  };

  return `
    <div class="flash-panel-section">
      <div class="flash-pick-head">
        <span class="flash-pick-emoji">📤</span>
        <span class="flash-pick-title">Yo doy</span>
        <span class="flash-pick-count">${selected.length} elegidas</span>
      </div>
      <p class="flash-pick-hint">Solo repetidas tuyas (×2+) que él necesita. Las pegadas (×1) no se tocan.</p>
      <div class="flash-pick-actions">
        <button type="button" class="flash-pick-all" data-side="give" data-action="suggested">Ofrecer todo</button>
        <button type="button" class="flash-pick-all" data-side="give" data-action="mega">Solo ×3+</button>
        <button type="button" class="flash-pick-all" data-side="give" data-action="none">Ninguna</button>
      </div>
      ${mega.length ? `
        <div class="flash-pick-category">
          <span class="flash-pick-cat-label flash-pick-cat--hot">🔥 Mega (yo ×3+) · ${mega.length}</span>
          <div class="flash-pick-grid">${renderGroup(mega)}</div>
        </div>` : ""}
      ${normal.length ? `
        <div class="flash-pick-category">
          <span class="flash-pick-cat-label flash-pick-cat--dup">✅ Repetidas (×2) · ${normal.length}</span>
          <div class="flash-pick-grid">${renderGroup(normal)}</div>
        </div>` : ""}
    </div>`;
}

function renderFlashPicksPanel(pickCount, picksInPool) {
  return `
    <div class="flash-picks card">
      <h3 class="flash-enhance-title">🎯 Mis picks</h3>
      <p class="flash-picks-desc">Láminas que quieres sí o sí. Van <strong>antes</strong> que especiales y faltantes al armar el trato sugerido.</p>
      <label class="flash-label">Añadir picks (código + número)</label>
      <textarea id="flash-picks-input" class="import-textarea flash-textarea" rows="3" placeholder="MEX 15, 19&#10;ARG 10"></textarea>
      <div class="flash-picks-actions">
        <button type="button" class="btn btn-secondary btn-compact" id="flash-picks-save">Guardar picks</button>
        <button type="button" class="btn btn-ghost btn-compact" id="flash-picks-clear" ${pickCount ? "" : "disabled"}>Quitar todas</button>
      </div>
      <p class="flash-picks-status">${pickCount ? `<strong>${pickCount}</strong> guardadas` : "Sin picks aún"} · ${picksInPool ? `<strong>${picksInPool}</strong> en sus repetidas ahora` : "ninguna en su lista pegada"}</p>
    </div>`;
}

function renderFlashManualAdd() {
  return `
    <details class="flash-manual card">
      <summary class="flash-manual-summary">Ajustar trato · añadir láminas</summary>
      <p class="flash-hint">🛡️ = escudo · ⭐ = especial · ×5 = tienes 5 copias. Pide u ofrece láminas extra (ej. <code>MEX 12</code>).</p>
      <label class="flash-label">Pedir más (de lo que repite)</label>
      <textarea id="flash-add-receive" class="import-textarea flash-textarea" rows="3" placeholder="MEX 12, 15&#10;ARG 3"></textarea>
      <button type="button" class="btn btn-secondary btn-compact" id="flash-add-receive-btn">Añadir a «Yo recibo»</button>
      <label class="flash-label">Ofrecer más (tuyas)</label>
      <textarea id="flash-add-give" class="import-textarea flash-textarea" rows="3" placeholder="ECU 4&#10;FWC 7"></textarea>
      <button type="button" class="btn btn-secondary btn-compact" id="flash-add-give-btn">Añadir a «Yo doy»</button>
    </details>`;
}

function viewFlashTrade() {
  const session = loadFlashSession();
  const catalog = getImportCatalog();
  const step = session.step >= 1 && session.step <= 3 ? session.step : 1;

  if (step === 1) {
    shell(
      "Intercambio flash",
      "Paso 1 · lo que repite tu intercambio",
      `
      ${renderFlashSteps(1)}
      <a href="#duplicates" class="flash-share-mine card" id="flash-share-mine-link">
        <span class="flash-share-mine-icon">📤</span>
        <span class="flash-share-mine-text"><strong>Compartir mis repetidas</strong> antes de pegar la suya</span>
        <span class="flash-share-mine-arrow">→</span>
      </a>
      <div class="card flash-panel flash-panel--v2">
        <label class="flash-label">Nombre (opcional)</label>
        <input id="flash-partner" class="flash-input" placeholder="Ej. Luis" value="${scanEscapeHtml(session.partnerName)}" />
        <label class="flash-label">Sus repetidas / swaps</label>
        <p class="flash-hint">Pega lo que <strong>tiene de más</strong> y puede regalarte o cambiar.</p>
        <textarea id="flash-dups" class="import-textarea flash-textarea" rows="8" placeholder="Repetidas&#10;MEX 15, 19&#10;ARG 3, 10&#10;FWC 7">${session.dupsText.replace(/</g, "&lt;")}</textarea>
      </div>
      <button type="button" class="btn btn-primary" id="flash-next-1">Siguiente →</button>
      <button type="button" class="btn btn-secondary" id="flash-back-hub">← Volver</button>
      `,
      true
    );

    document.getElementById("flash-next-1")?.addEventListener("click", () => {
      const dupsText = document.getElementById("flash-dups").value;
      const partnerName = document.getElementById("flash-partner").value.trim();
      if (!dupsText.trim()) return alert("Pega al menos una lista de repetidas.");
      saveFlashSession({ dupsText, partnerName, step: 2 });
      viewFlashTrade();
    });
    document.getElementById("flash-back-hub")?.addEventListener("click", () => navigate("intercambiar"));
    document.getElementById("flash-share-mine-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("duplicates");
    });
    return;
  }

  if (step === 2) {
    shell(
      "Intercambio flash",
      "Paso 2 · lo que le falta a esa persona",
      `
      ${renderFlashSteps(2)}
      <div class="card flash-panel">
        <label class="flash-label">Sus faltantes</label>
        <p class="flash-hint">Pega lo que <strong>le falta</strong> — en el trato podrás elegir qué ofreces (repetidas o no).</p>
        <textarea id="flash-needs" class="import-textarea flash-textarea" rows="8" placeholder="Missing stickers&#10;MEX 15, 19&#10;ECU 4, 8">${session.needsText.replace(/</g, "&lt;")}</textarea>
      </div>
      <button type="button" class="btn btn-primary" id="flash-compare">Ver trato ⚡</button>
      <button type="button" class="btn btn-secondary" id="flash-back-1">← Repetidos</button>
      `,
      true
    );

    document.getElementById("flash-compare")?.addEventListener("click", () => {
      const needsText = document.getElementById("flash-needs").value;
      if (!needsText.trim()) return alert("Pega la lista de faltantes.");
      saveFlashSession({ needsText, step: 3, selectedReceive: null, selectedGive: null });
      viewFlashTrade();
    });
    document.getElementById("flash-back-1")?.addEventListener("click", () => {
      saveFlashSession({ step: 1 });
      viewFlashTrade();
    });
    return;
  }

  const priorityPickKeys = session.priorityPickKeys || [];
  const trade = computeFlashTrade(
    session.dupsText,
    session.needsText,
    catalog,
    state.stickers,
    state.collection,
    priorityPickKeys
  );
  const extraReceive = tradeItemsFromKeys(session.extraReceiveKeys || [], catalog);
  const extraGive = tradeItemsFromKeys(session.extraGiveKeys || [], catalog);
  const poolReceive = boostPoolWithPicks(
    mergeTradePools(trade.poolReceive, extraReceive),
    priorityPickKeys
  );
  const poolGive = mergeTradePools(trade.poolGive, extraGive);

  const staleSelection =
    session.selectedReceive?.length > Math.max(trade.canOffer.length, trade.iReceive.length) + 5;
  if (staleSelection) {
    session.selectedReceive = null;
    session.selectedGive = null;
  }

  let selReceive =
    session.selectedReceive != null ? session.selectedReceive : defaultSelectionKeys(trade.iReceive);
  let selGive = session.selectedGive != null ? session.selectedGive : defaultSelectionKeys(trade.iGive);
  const receiveSet = new Set(selReceive);
  const giveSet = new Set(selGive);

  const selectedReceive = resolveTradeSelection(selReceive, poolReceive, catalog, state.collection);
  const selectedGive = resolveTradeSelection(selGive, poolGive, catalog, state.collection);
  const meta = { partnerName: session.partnerName || "" };

  const hasSelection = selectedReceive.length || selectedGive.length;

  const st = stats();
  const myMegaCount = countMyMegas();
  const bd = trade.breakdown || trade.stats || {};
  const picksInPool = poolReceive.filter((i) => i.isPick).length;
  const tradeContextHtml = `
    <div class="flash-trade-context card">
      <h3 class="flash-enhance-title">📋 Resumen rápido</h3>
      <div class="flash-context-grid">
        <div class="flash-context-item">
          <span class="flash-context-label">Él necesita</span>
          <span class="flash-context-value">${bd.friendNeedsTotal ?? 0}</span>
        </div>
        <div class="flash-context-item flash-context-item--you">
          <span class="flash-context-label">Tú puedes darle</span>
          <span class="flash-context-value">${bd.friendNeedsYouCanFill ?? 0}</span>
        </div>
        <div class="flash-context-item">
          <span class="flash-context-label">Él repite</span>
          <span class="flash-context-value">${bd.friendDupsTotal ?? 0}</span>
        </div>
        <div class="flash-context-item flash-context-item--you">
          <span class="flash-context-label">Te faltan de sus rep.</span>
          <span class="flash-context-value flash-context-value--need">${bd.friendDupsYouMissing ?? 0}</span>
          <span class="flash-context-sub">de ${bd.friendDupsYouCanAsk ?? 0} pedibles</span>
        </div>
      </div>
    </div>
    ${renderTradeBreakdownHtml(bd, selectedGive, selectedReceive)}`;
  const picksPanelHtml = renderFlashPicksPanel(priorityPickKeys.length, picksInPool);
  const quickDealHtml = hasSelection
    ? `<div class="flash-deal-section">
        ${renderFlashDealPreviewHtml(selectedReceive, selectedGive, meta)}
        <div class="flash-share-actions">
          <button type="button" class="btn btn-primary btn-lg flash-share-btn" id="flash-wa">📲 Enviar por WhatsApp</button>
          <button type="button" class="btn btn-secondary" id="flash-copy">📋 Copiar trato</button>
          <button type="button" class="btn btn-ghost" id="flash-copy-plain">Texto plano</button>
        </div>
      </div>`
    : `<p class="flash-empty-hint">No hay cruce automático. Selecciona láminas abajo para armar tu trato.</p>`;

  const enhanceHtml = `
    <div class="flash-inventory card">
      <h3 class="flash-enhance-title">📊 Tu álbum</h3>
      <div class="flash-inv-stats">
        <span class="flash-inv-stat"><strong>${myMegaCount}</strong> mega (×3+)</span>
        <span class="flash-inv-stat"><strong>${st.dupCount}</strong> con ×2</span>
        <span class="flash-inv-stat"><strong>${st.missing}</strong> faltan</span>
      </div>
      <p class="flash-inv-hint">Trato sugerido parejo: <strong>${trade.suggestedCount ?? trade.iGive.length}</strong> ↔ <strong>${trade.suggestedCount ?? trade.iReceive.length}</strong> (no todo el catálogo)</p>
    </div>
    <div class="flash-enhance card">
      <h3 class="flash-enhance-title">⚡ Acciones rápidas</h3>
      <div class="flash-enhance-row">
        <button type="button" class="btn btn-primary flash-enhance-btn" id="flash-apply-suggested">
          ✨ Aplicar trato sugerido (${trade.suggestedCount ?? trade.iGive.length} ↔ ${trade.suggestedCount ?? trade.iReceive.length})
        </button>
        <p class="flash-enhance-desc">Ofrece lo que él necesita y pide lo mejor para ti, igualado</p>
      </div>
      <div class="flash-enhance-row">
        <button type="button" class="btn btn-secondary flash-enhance-btn" id="flash-add-mega" ${myMegaCount ? "" : "disabled"}>
          🔥 Intercambiar mis mega (×3+) · ${myMegaCount} láminas
        </button>
        <p class="flash-enhance-desc">Por cada mega tuya, pide 1 lámina suya (especial → falta → pocas)</p>
      </div>
    </div>`;

  const manualHtml = `
    <div class="flash-manual-board">
      <div class="flash-manual-header">
        <h3 class="flash-enhance-title">🎛️ Selección manual</h3>
        <p class="flash-manual-hint">Toca láminas para incluir/quitar del trato. Los cambios se reflejan arriba al instante.</p>
      </div>
      ${renderFlashReceivePanel(poolReceive, receiveSet)}
      <div class="flash-manual-divider"></div>
      ${renderFlashGivePanel(poolGive, giveSet)}
      ${renderFlashManualAdd()}
    </div>`;

  shell(
    "Intercambio flash",
    session.partnerName ? `Trato con ${session.partnerName}` : "Tu trato",
    `
    ${renderFlashSteps(3)}
    ${tradeContextHtml}
    ${picksPanelHtml}
    ${quickDealHtml}
    ${enhanceHtml}
    ${manualHtml}
    <div class="flash-bottom-actions">
      <button type="button" class="btn btn-secondary" id="flash-back-2">← Editar listas</button>
      <button type="button" class="btn btn-ghost" id="flash-restart">Nuevo intercambio</button>
    </div>
    `,
    true
  );

  const persistAndRerender = (patch = {}) => {
    saveFlashSession({
      selectedReceive: selReceive,
      selectedGive: selGive,
      ...patch,
    });
    viewFlashTrade();
  };

  document.getElementById("flash-apply-suggested")?.addEventListener("click", () => {
    selGive = defaultSelectionKeys(trade.iGive);
    selReceive = defaultSelectionKeys(trade.iReceive);
    persistAndRerender();
  });

  document.getElementById("flash-add-mega")?.addEventListener("click", () => {
    const swap = computeMegaDuplicateSwap(
      state.stickers,
      session.dupsText,
      catalog,
      state.collection,
      priorityPickKeys
    );
    if (!swap.give.length) {
      return alert("No tienes láminas con ×3 o más en tu álbum.");
    }
    selGive = defaultSelectionKeys(swap.give);
    selReceive = defaultSelectionKeys(swap.receive);
    if (swap.receive.length < swap.give.length) {
      alert(
        `Soltaste ${swap.give.length} mega pero solo hay ${swap.receive.length} láminas suyas que te conviene pedir.`
      );
    }
    persistAndRerender();
  });


  // Manual board chip clicks
  $app.querySelectorAll(".flash-pick-chip").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.key;
      const side = btn.dataset.side;
      if (side === "receive") {
        if (receiveSet.has(key)) receiveSet.delete(key);
        else receiveSet.add(key);
        selReceive = [...receiveSet];
      } else {
        if (giveSet.has(key)) giveSet.delete(key);
        else giveSet.add(key);
        selGive = [...giveSet];
      }
      persistAndRerender();
    };
  });

  $app.querySelectorAll(".flash-pick-all").forEach((btn) => {
    btn.onclick = () => {
      const side = btn.dataset.side;
      const action = btn.dataset.action;
      if (side === "receive") {
        if (action === "all") selReceive = defaultSelectionKeys(poolReceive);
        else if (action === "suggested") selReceive = defaultSelectionKeys(trade.iReceive);
        else if (action === "picks") {
          const pickItems = poolReceive.filter((i) => i.isPick);
          selReceive = defaultSelectionKeys(pickItems);
          if (!pickItems.length) {
            alert("Ninguna de tus picks está en sus repetidas. Revisa el desglose o pega su lista de nuevo.");
          }
        } else selReceive = [];
      } else {
        if (action === "all") selGive = defaultSelectionKeys(poolGive);
        else if (action === "mega") selGive = defaultSelectionKeys(poolGive.filter((i) => (i.myQty || 0) >= 3));
        else if (action === "suggested") selGive = defaultSelectionKeys(trade.iGive);
        else selGive = [];
      }
      persistAndRerender();
    };
  });

  document.getElementById("flash-picks-save")?.addEventListener("click", () => {
    const text = document.getElementById("flash-picks-input")?.value || "";
    const keys = parseTradeListToKeys(text, catalog, "duplicates");
    if (!keys.length) return alert("Escribe láminas válidas (ej. MEX 15, ARG 10).");
    const merged = [...new Set([...(session.priorityPickKeys || []), ...keys])];
    saveFlashSession({ priorityPickKeys: merged });
    viewFlashTrade();
  });

  document.getElementById("flash-picks-clear")?.addEventListener("click", () => {
    saveFlashSession({ priorityPickKeys: [] });
    viewFlashTrade();
  });

  document.getElementById("flash-add-receive-btn")?.addEventListener("click", () => {
    const text = document.getElementById("flash-add-receive")?.value || "";
    const keys = parseTradeListToKeys(text, catalog, "duplicates");
    if (!keys.length) return alert("Escribe láminas válidas (ej. MEX 12, 15).");
    const extra = [...new Set([...(session.extraReceiveKeys || []), ...keys])];
    for (const k of keys) receiveSet.add(k);
    selReceive = [...receiveSet];
    persistAndRerender({ extraReceiveKeys: extra });
  });

  document.getElementById("flash-add-give-btn")?.addEventListener("click", () => {
    const text = document.getElementById("flash-add-give")?.value || "";
    const offered = tradeItemsUserCanOffer(text, catalog, state.collection);
    if (!offered.length) {
      return alert("Solo puedes ofrecer láminas repetidas (×2+). Las que tienes una sola vez están pegadas en tu álbum.");
    }
    const keys = offered.map((i) => i.key);
    const extra = [...new Set([...(session.extraGiveKeys || []), ...keys])];
    for (const k of keys) giveSet.add(k);
    selGive = [...giveSet];
    persistAndRerender({ extraGiveKeys: extra });
  });

  // Share buttons
  document.getElementById("flash-wa")?.addEventListener("click", async () => {
    if (!selectedReceive.length && !selectedGive.length) {
      return alert("Elige al menos una lámina en el trato.");
    }
    try {
      await openFlashDealWhatsApp(selectedReceive, selectedGive, meta);
    } catch (err) {
      alert(err.message || "No se pudo compartir.");
    }
  });

  document.getElementById("flash-copy")?.addEventListener("click", async () => {
    if (!selectedReceive.length && !selectedGive.length) {
      return alert("Elige al menos una lámina en el trato.");
    }
    const text = formatFlashDealText(selectedReceive, selectedGive, meta);
    try {
      await copyTextToClipboard(text);
      alert("✅ Trato copiado.");
    } catch {
      window.prompt("Copia el trato manualmente:", text);
    }
  });

  document.getElementById("flash-copy-plain")?.addEventListener("click", async () => {
    if (!selectedReceive.length && !selectedGive.length) {
      return alert("Elige al menos una lámina en el trato.");
    }
    const text = formatFlashDealPlain(selectedReceive, selectedGive, meta);
    try {
      await copyTextToClipboard(text);
      alert("✅ Texto plano copiado.");
    } catch {
      window.prompt("Copia el trato (texto plano):", text);
    }
  });

  document.getElementById("flash-restart")?.addEventListener("click", () => {
    clearFlashSession();
    viewFlashTrade();
  });

  document.getElementById("flash-back-2")?.addEventListener("click", () => {
    saveFlashSession({ step: 2 });
    viewFlashTrade();
  });
}

function viewOnboarding() {
  shell(
    "Tu ubicación",
    "Opcional — para Explorar coleccionistas cerca",
    `
    ${authFlashMessageHtml()}
    <div class="card">
      <p class="auth-email-hint">Puedes omitir esto y usar flash o pegar listas sin ubicación.</p>
      <label>Nombre para mostrar</label>
      <input id="display_name" value="${state.profile?.display_name || ""}" />
      <label>Ciudad</label>
      <input id="city" value="${state.profile?.city || ""}" placeholder="Ej. Ciudad de México" />
      <label>País</label>
      <input id="country" value="${state.profile?.country || ""}" placeholder="Ej. México" />
      <label>Radio de búsqueda (km)</label>
      <select id="radius">
        ${[5, 10, 25, 50, 100].map(
          (r) =>
            `<option value="${r}" ${state.profile?.search_radius_km === r ? "selected" : ""}>${r} km</option>`
        )}
      </select>
      <button class="btn btn-secondary" id="btn-geo">Usar mi ubicación (GPS)</button>
      <button class="btn btn-primary" id="btn-save-loc">Guardar y continuar</button>
      <button class="btn btn-ghost" id="btn-skip-loc">Omitir por ahora</button>
    </div>
    `,
    false
  );
  let lat = state.profile?.lat;
  let lng = state.profile?.lng;
  document.getElementById("btn-geo").onclick = () => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        lat = p.coords.latitude;
        lng = p.coords.longitude;
        alert("Ubicación capturada. No mostramos tu dirección exacta a otros usuarios.");
      },
      () => alert("No pudimos obtener tu ubicación. Puedes continuar solo con ciudad y país.")
    );
  };
  document.getElementById("btn-save-loc").onclick = async () => {
    const city = document.getElementById("city").value.trim();
    const country = document.getElementById("country").value.trim();
    if (!city || !country) return alert("Ciudad y país son obligatorios.");
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: document.getElementById("display_name").value.trim() || "Coleccionista",
        city,
        country,
        lat,
        lng,
        search_radius_km: parseInt(document.getElementById("radius").value, 10),
        profile_complete: true,
      })
      .eq("id", state.user.id);
    if (error) return alert(error.message);
    await loadUser();
    navigate("cuenta");
  };
  document.getElementById("btn-skip-loc").onclick = () => navigate("cuenta");
}

function viewAlbum(options = {}) {
  const { preserveScroll = false, scrollTeamChip = false, scrollGroupPill = false, scrollToSheet = false } =
    options;
  const shouldRestore = preserveScroll || scrollTeamChip || scrollGroupPill;
  const scroll = shouldRestore ? captureAlbumScroll() : null;
  const groups = groupStickersByTeam();
  const team = groups[state.albumTeamIndex] || groups[0];
  const filterLabel =
    state.albumGroupFilter === "all" ? "Todos" : groupLabel(state.albumGroupFilter);
  const isEdit = state.albumMode === "edit";
  const pageCount = team ? albumPageNumbers(team).length : 2;
  const subtitle = team
    ? isEdit
      ? `${team.flag} ${team.team_name} · pág. ${state.albumSubPage}/${pageCount} · ${filterLabel}`
      : `${team.flag} ${team.team_name} · ${team.owned}/${team.total} · ${filterLabel}`
    : "Mundial FIFA 2026";
  shell("Mi álbum", subtitle, renderAlbumPageBody(), true);
  bindAlbumPageControls();
  if (shouldRestore) {
    requestAnimationFrame(() => {
      restoreAlbumScroll(scroll);
      if (scrollGroupPill) {
        $app
          .querySelector(".group-filter-bar .section-pill.active")
          ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
      }
      if (scrollTeamChip) {
        $app
          .querySelector(".team-chip.active")
          ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
      }
    });
  } else if (scrollToSheet) {
    scrollToAlbumSheet();
  }
}

function viewMissing(options = {}) {
  const { preserveScroll = false } = options;
  const scroll = preserveScroll ? captureAlbumScroll() : null;
  const groups = groupStickersByTeam();
  const filterId = state.albumGroupFilter;
  const total = state.stickers.filter((s) => !state.collection[s.id]?.owned).length;
  const st = stats();
  const pct = st.total ? Math.round((st.owned / st.total) * 100) : 0;
  const teamCount = missingGroupsForFilter(filterId).length;

  const sharePayload = total > 0 ? formatMissingSharePayload(filterId) : null;

  const body =
    total === 0
      ? msg("¡Álbum completo! 🎉", "success")
      : `
    <div class="missing-hero card">
      <div class="missing-hero-main">
        <span class="missing-hero-value">${total}</span>
        <span class="missing-hero-label">láminas que faltan</span>
      </div>
      <div class="missing-hero-side">
        <span class="missing-hero-pct">${pct}%</span>
        <span class="missing-hero-sub">${teamCount} equipo${teamCount === 1 ? "" : "s"}</span>
      </div>
    </div>
    ${sharePayload ? renderMissingSharePreviewHtml(sharePayload.groups, sharePayload) : ""}
    ${sharePayload ? renderShareToolbar({ waId: "btn-share-missing", copyId: "btn-copy-missing", plainId: "btn-copy-plain" }) : ""}
    ${renderGroupFilterBar(groups, filterId, { onlyMissing: true })}
    ${renderMissingBoard(filterId)}
    ${renderMissingBreakdown(filterId)}
    <p class="missing-hint">Toca un número si ya la tienes · <a href="#import" id="link-import-missing">pegar lista</a></p>`;

  shell("Me faltan", total ? `${pct}% completo · ${total} pendientes` : "¡Álbum lleno!", body, true);

  bindGroupFilterControls((opts) => viewMissing({ preserveScroll: true, ...opts }));
  bindMissingBoardControls((opts) => viewMissing({ preserveScroll: true, ...opts }));

  if (preserveScroll && scroll) {
    requestAnimationFrame(() => restoreAlbumScroll(scroll));
  }

  bindShareToolbar({
    waId: "btn-share-missing",
    copyId: "btn-copy-missing",
    plainId: "btn-copy-plain",
    getPayload: () => formatMissingSharePayload(filterId),
    getCopyText: (p) => formatMissingShareText(p.groups, p),
    getPlainText: (p) => formatMissingSharePlain(p.groups, p),
    onWa: (p) => openWhatsAppShare(p.groups, p),
    emptyMsg: "No tienes faltantes en este filtro.",
  });

  document.getElementById("link-import-missing")?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("import");
  });
}

function viewDuplicates(options = {}) {
  const { preserveScroll = false } = options;
  const scroll = preserveScroll ? captureAlbumScroll() : null;
  const groups = groupStickersByTeam();
  const filterId = state.albumGroupFilter;
  const sharePayload = formatDuplicatesSharePayload(filterId);
  const types = sharePayload.total;
  const teamCount = duplicateGroupsForFilter(filterId).length;

  const body =
    types === 0
      ? `
    <div class="dup-empty-hero card">
      <span class="dup-empty-icon">📦</span>
      <p class="dup-empty-title">Aún no tienes repetidas</p>
      <p class="dup-empty-text">En el <strong>Álbum</strong>, activa <strong>Editar</strong> y usa <strong>+</strong> hasta <strong>×2</strong> (o más). Luego vuelve aquí para compartir.</p>
      <button type="button" class="btn btn-primary" id="dup-go-album">Ir al álbum</button>
      <button type="button" class="btn btn-secondary" id="dup-go-flash">Intercambio flash</button>
    </div>`
      : `
    <div class="duplicate-hero card duplicate-hero--simple">
      <span class="duplicate-hero-value">${types}</span>
      <span class="duplicate-hero-label">láminas repetidas para intercambiar</span>
    </div>
    ${renderDuplicatesSharePreviewHtml(sharePayload.groups, sharePayload)}
    ${renderShareToolbar({ waId: "btn-share-dups", copyId: "btn-copy-dups", plainId: "btn-copy-dups-plain", plainLabel: "Plano" })}
    ${renderGroupFilterBar(groups, filterId)}
    ${renderDuplicatesBoard(filterId)}
    <p class="duplicate-hint">El listado para compartir incluye <strong>todas</strong> tus repetidas · el filtro solo ordena la vista · <a href="#flash" id="link-flash-dups">intercambio flash</a></p>`;

  shell(
    "Mis repetidas",
    types ? `${types} láminas · listo para WhatsApp` : "Marca tus swaps en el álbum",
    body,
    true
  );

  bindGroupFilterControls((opts) => viewDuplicates({ preserveScroll: true, ...opts }));
  bindDuplicatesBoardControls((opts) => viewDuplicates({ preserveScroll: true, ...opts }));

  if (preserveScroll && scroll) {
    requestAnimationFrame(() => restoreAlbumScroll(scroll));
  }

  if (types > 0) {
    bindShareToolbar({
      waId: "btn-share-dups",
      copyId: "btn-copy-dups",
      plainId: "btn-copy-dups-plain",
      getPayload: () => formatDuplicatesSharePayload(filterId),
      getCopyText: (p) => formatDuplicatesShareText(p.groups, p),
      getPlainText: (p) => formatDuplicatesSharePlain(p.groups, p),
      onWa: (p) => openDuplicatesWhatsApp(p.groups, p),
      emptyMsg: "Marca ×2 o más en el álbum para compartir repetidas.",
    });
  }

  document.getElementById("dup-go-album")?.addEventListener("click", () => navigate("album"));
  document.getElementById("dup-go-flash")?.addEventListener("click", () => navigate("flash"));
  document.getElementById("link-flash-dups")?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("flash");
  });
}

function numberToPanini(n) {
  const s = state.stickers.find((x) => x.number === n);
  return s ? formatPaniniCode(s) : `#${n}`;
}

function formatMatchList(nums) {
  return nums?.length ? nums.map(numberToPanini).join(" · ") : "—";
}

function renderFilterChips(filters, active) {
  return `<div class="filter-chip-bar">${filters
    .map(
      ([f, label]) =>
        `<button type="button" class="filter-chip ${f === active ? "active" : ""}" data-f="${f}">${label}</button>`
    )
    .join("")}</div>`;
}

function renderMatchCard(m) {
  return `
    <article class="match-card card">
      <div class="match-card-head">
        <div>
          <h3 class="match-name">${shellEscapeHtml(m.display_name)}</h3>
          <p class="match-loc">${shellEscapeHtml(m.city)}, ${shellEscapeHtml(m.country)}${
            m.distance_km != null ? ` · <strong>${m.distance_km} km</strong>` : ""
          }</p>
        </div>
        <span class="match-score">${m.match_score}</span>
      </div>
      <div class="match-lanes">
        <div class="match-lane match-lane--out">
          <span class="match-lane-label">Tú das</span>
          <p class="match-lane-val">${formatMatchList(m.you_offer_numbers)}</p>
        </div>
        <div class="match-lane match-lane--in">
          <span class="match-lane-label">Recibes</span>
          <p class="match-lane-val">${formatMatchList(m.they_offer_numbers)}</p>
        </div>
      </div>
      <div class="match-actions">
        <button type="button" class="btn btn-primary btn-compact btn-trade" data-user="${m.user_id}"
          data-offer="${JSON.stringify(m.you_offer_numbers)}"
          data-want="${JSON.stringify(m.they_offer_numbers)}">Proponer</button>
        <button type="button" class="btn btn-secondary btn-compact btn-profile" data-user="${m.user_id}">Perfil</button>
      </div>
    </article>`;
}

async function viewExplore() {
  if (!state.profile?.profile_complete) {
    shell(
      "Explorar",
      "Necesitas ubicación",
      `
      <div class="card">
        <p>Para ver coleccionistas cerca indica ciudad y país (o GPS).</p>
        <p class="auth-email-hint">Flash y pegar listas funcionan sin ubicación.</p>
        <button type="button" class="btn btn-primary" id="explore-setup-loc">Configurar ubicación</button>
        <button type="button" class="btn btn-ghost" id="explore-back">Volver</button>
      </div>
      `,
      true
    );
    document.getElementById("explore-setup-loc").onclick = () => navigate("onboarding");
    document.getElementById("explore-back").onclick = () => navigate("cuenta");
    return;
  }
  shell("Explorar", "Cargando coincidencias…", "", true);
  const filter = state.params.filter || "cerca";
  try {
    const data = await api.matches(filter);
    const rows = data.matches || [];
    shell(
      "Explorar",
      "Personas con láminas que te sirven",
      `
      ${renderFilterChips(
        [
          ["cerca", "Cerca"],
          ["ciudad", "Mi ciudad"],
          ["pais", "Mi país"],
          ["todos", "Todos"],
        ],
        filter
      )}
      ${rows.length ? `<div class="match-list">${rows.map((m) => renderMatchCard(m)).join("")}</div>` : msg("No hay coincidencias con este filtro. Amplía tu radio o actualiza tu álbum.", "info")}
      `,
      true
    );
    $app.querySelectorAll(".filter-chip").forEach((b) => {
      b.onclick = () => {
        state.params.filter = b.dataset.f;
        viewExplore();
      };
    });
    $app.querySelectorAll(".btn-trade").forEach((b) => {
      b.onclick = async () => {
        if (!state.user?.email_confirmed_at) {
          return alert("Verifica tu correo antes de proponer intercambios.");
        }
        const offer = JSON.parse(b.dataset.offer);
        const want = JSON.parse(b.dataset.want);
        const nums = [...offer, ...want];
        const idMap = Object.fromEntries(state.stickers.map((s) => [s.number, s.id]));
        try {
          await api.createTrade({
            receiver_id: b.dataset.user,
            offer_sticker_ids: offer.map((n) => idMap[n]).filter(Boolean),
            want_sticker_ids: want.map((n) => idMap[n]).filter(Boolean),
          });
          alert("Solicitud enviada.");
          navigate("trades");
        } catch (e) {
          alert(e.message);
        }
      };
    });
    $app.querySelectorAll(".btn-profile").forEach((b) => {
      b.onclick = () => navigate("user", { id: b.dataset.user });
    });
  } catch (e) {
    shell("Explorar", "", msg(e.message, "error"), true);
  }
}

async function viewTrades() {
  shell("Intercambios", "Cargando…", "", true);
  try {
    const data = await api.trades("all");
    const trades = data.trades || [];
    shell(
      "Mis intercambios",
      "Entrantes y salientes",
      trades.length
        ? `<div class="trade-list">${trades
            .map((t) => {
              const mine = t.requester_id === state.user.id;
              const status = t.status;
              return `
            <article class="trade-card card">
              <div class="trade-card-head">
                <span class="trade-status trade-status--${status}">${status}</span>
                <span class="badge">${mine ? "Enviada" : "Recibida"}</span>
              </div>
              <p class="trade-card-body">Ofrezco #${(t.offer_sticker_ids || []).join(", #")} · Quiero #${(t.want_sticker_ids || []).join(", #")}</p>
              <button type="button" class="btn btn-primary btn-compact" data-tid="${t.id}">Abrir</button>
            </article>`;
            })
            .join("")}</div>`
        : msg("Aún no tienes solicitudes.", "info"),
      true
    );
    $app.querySelectorAll("[data-tid]").forEach((b) => {
      b.onclick = () => navigate("trade", { id: b.dataset.tid });
    });
  } catch (e) {
    shell("Intercambios", "", msg(e.message, "error"), true);
  }
}

async function viewTradeDetail() {
  const id = state.params.id;
  shell("Intercambio", "", msg("Cargando…", "info"), true);
  try {
    const data = await api.trade(id);
    const t = data.trade;
    const msgs = data.messages || [];
    const mine = t.requester_id === state.user.id;
    const canReview = t.status === "completado";

    shell(
      "Intercambio",
      `Estado: ${t.status}`,
      `
      <div class="card trade-detail-card">
        <h3 class="panel-title">Detalle del intercambio</h3>
        <p>Oferta: #${(t.offer_sticker_ids || []).join(", #")}</p>
        <p>Pide: #${(t.want_sticker_ids || []).join(", #")}</p>
        ${t.notes ? `<p>Notas: ${t.notes}</p>` : ""}
        ${t.status === "pendiente" && !mine ? `<button class="btn btn-primary" id="accept">Aceptar</button>` : ""}
        ${["pendiente", "aceptado", "coordinando"].includes(t.status)
          ? `<button class="btn btn-secondary" id="advance">${t.status === "aceptado" ? "Marcar coordinando" : t.status === "coordinando" ? "Marcar completado" : ""}</button>
             <button class="btn btn-secondary" id="cancel">Cancelar</button>`
          : ""}
        ${t.status === "aceptado" ? `<button class="btn btn-primary" id="coord">Coordinando</button>` : ""}
        ${t.status === "coordinando" ? `<button class="btn btn-primary" id="done">Completar intercambio</button>` : ""}
        ${canReview ? `<button class="btn btn-primary" id="review">Dejar reseña</button>` : ""}
      </div>
      <div class="card" id="chat">
        <h3 class="panel-title">Mensajes</h3>
        ${msgs.map((m) => `<div class="chat-bubble ${m.sender_id === state.user.id ? "mine" : "theirs"}">${m.body}</div>`).join("")}
        <textarea id="msgbody" rows="2" placeholder="Lugar, hora, acuerdo de envío…"></textarea>
        <button class="btn btn-primary" id="sendmsg">Enviar</button>
      </div>
      `,
      true
    );

    const upd = async (status) => {
      await api.updateTrade(id, { status });
      viewTradeDetail();
    };
    document.getElementById("accept")?.addEventListener("click", () => upd("aceptado"));
    document.getElementById("coord")?.addEventListener("click", () => upd("coordinando"));
    document.getElementById("done")?.addEventListener("click", () => upd("completado"));
    document.getElementById("cancel")?.addEventListener("click", () => upd("cancelado"));
    document.getElementById("advance")?.addEventListener("click", () => {
      const next = t.status === "aceptado" ? "coordinando" : "completado";
      upd(next);
    });
    document.getElementById("sendmsg")?.addEventListener("click", async () => {
      const body = document.getElementById("msgbody").value.trim();
      if (!body) return;
      await api.postMessage(id, body);
      viewTradeDetail();
    });
    document.getElementById("review")?.addEventListener("click", () => navigate("review", { id }));
  } catch (e) {
    shell("Intercambio", "", msg(e.message, "error"), true);
  }
}

function viewReviewForm() {
  const tradeId = state.params.id;
  shell(
    "Dejar reseña",
    "Solo tras intercambio completado",
    `
    <div class="card">
      <label>Estrellas (1–5)</label>
      <select id="rating">${[5, 4, 3, 2, 1].map((r) => `<option value="${r}">${r}</option>`).join("")}</select>
      <label>Comentario</label>
      <textarea id="comment" rows="3" placeholder="¿Cómo fue el intercambio?"></textarea>
      <button class="btn btn-primary" id="submit-review">Publicar reseña</button>
    </div>
    `,
    true
  );
  document.getElementById("submit-review").onclick = async () => {
    try {
      await api.createReview(tradeId, {
        rating: parseInt(document.getElementById("rating").value, 10),
        comment: document.getElementById("comment").value,
      });
      alert("¡Gracias por tu reseña!");
      navigate("profile");
    } catch (e) {
      alert(e.message);
    }
  };
}

async function viewProfile() {
  let reviewsHtml = "";
  try {
    const rev = await api.userReviews(state.user.id);
    reviewsHtml = `
      <p>Promedio: ${rev.avg_rating ?? "—"} (${rev.review_count} reseñas)</p>
      ${(rev.reviews || [])
        .slice(0, 5)
        .map((r) => `<div class="card"><span class="badge">${"★".repeat(r.rating)}</span> ${r.comment || ""}</div>`)
        .join("")}
    `;
  } catch {
    reviewsHtml = msg("Reseñas disponibles cuando la API esté configurada.", "info");
  }

  shell(
    "Mi perfil",
    state.profile?.city ? `${state.profile.city}, ${state.profile.country}` : "",
    `
    <div class="card">
      <p><strong>${state.profile?.display_name || "Coleccionista"}</strong></p>
      <p class="badge">${state.user?.email || ""}</p>
      <p class="badge">Radio: ${state.profile?.search_radius_km || 25} km</p>
      <button class="btn btn-secondary" id="edit-loc">Editar ubicación</button>
      <button class="btn btn-secondary" id="pwa-help">Instalar en iPhone</button>
      <button class="btn btn-secondary" id="logout">Cerrar sesión</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0;font-size:1rem">Contraseña</h3>
      <p class="auth-email-hint">Crea una contraseña para entrar sin magic link la próxima vez.</p>
      <label>Nueva contraseña</label>
      <input type="password" id="profile-new-password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
      <label>Repetir contraseña</label>
      <input type="password" id="profile-confirm-password" autocomplete="new-password" />
      <button class="btn btn-primary" id="btn-save-password">Guardar contraseña</button>
    </div>
    <h3 style="font-size:1rem">Mis reseñas recibidas</h3>
    ${reviewsHtml}
    <div class="card hidden" id="pwa-panel">
      <h3 style="margin-top:0">Instalar en iPhone</h3>
      <ol class="pwa-hint">
        <li>Abre esta página en <strong>Safari</strong> (no en Chrome).</li>
        <li>Toca el botón <strong>Compartir</strong> (cuadrado con flecha).</li>
        <li>Elige <strong>Añadir a pantalla de inicio</strong>.</li>
        <li>Confirma el nombre y toca <strong>Añadir</strong>.</li>
      </ol>
      <p class="pwa-hint">La app necesita HTTPS en producción para funcionar como PWA.</p>
    </div>
    `,
    true
  );
  document.getElementById("edit-loc").onclick = () => navigate("onboarding");
  document.getElementById("btn-save-password").onclick = async () => {
    const pw = document.getElementById("profile-new-password").value;
    const confirm = document.getElementById("profile-confirm-password").value;
    if (pw.length < 8) return alert("La contraseña debe tener al menos 8 caracteres.");
    if (pw !== confirm) return alert("Las contraseñas no coinciden.");
    const { error } = await updateUserPassword(pw);
    if (error) alert(humanizeAuthError(error.message));
    else {
      document.getElementById("profile-new-password").value = "";
      document.getElementById("profile-confirm-password").value = "";
      alert("Contraseña guardada. Ya puedes entrar con correo + contraseña en Intercambiar → 🔑 Contraseña.");
    }
  };
  document.getElementById("pwa-help").onclick = () =>
    document.getElementById("pwa-panel").classList.toggle("hidden");
  document.getElementById("logout").onclick = async () => {
    await supabase.auth.signOut();
    state.user = null;
    state.profile = null;
    navigate("album");
  };
}

async function viewUserPublic() {
  const uid = state.params.id;
  shell("Perfil", "", msg("Cargando…", "info"), true);
  const { data: prof } = await supabase.from("profiles").select("*").eq("id", uid).single();
  const { data: rows } = await supabase
    .from("user_stickers")
    .select("sticker_id, owned, duplicates, stickers(number, name)")
    .eq("user_id", uid);
  const ownedIds = new Set((rows || []).filter((r) => r.owned).map((r) => r.sticker_id));
  const dups = (rows || []).filter((r) => r.duplicates > 0);
  const missing = state.stickers.filter((s) => !ownedIds.has(s.id));
  let rev = { avg_rating: null, review_count: 0 };
  try {
    rev = await api.userReviews(uid);
  } catch {
    /* ignore */
  }
  shell(
    prof?.display_name || "Coleccionista",
    `${prof?.city || ""}, ${prof?.country || ""}`,
    `
    <div class="card">
      <p>⭐ ${rev.avg_rating ?? "—"} (${rev.review_count} reseñas)</p>
      <p><strong>Repetidas:</strong> ${dups.map((r) => formatPaniniCode(r.stickers || { number: r.sticker_id })).join(" · ") || "—"}</p>
      <p><strong>Le faltan:</strong> ${missing.map((s) => formatPaniniCode(s)).slice(0, 30).join(" · ")}${missing.length > 30 ? "…" : ""}</p>
      <button class="btn btn-primary" id="report">Reportar usuario</button>
    </div>
    `,
    true
  );
  document.getElementById("report").onclick = async () => {
    const reason = prompt("Motivo del reporte:");
    if (!reason) return;
    try {
      const res = await api.report({ reported_user_id: uid, reason });
      alert(res.message);
    } catch (e) {
      alert(e.message);
    }
  };
}

async function render() {
  if (renderInFlight) {
    renderPending = true;
    return renderInFlight;
  }
  renderInFlight = (async () => {
    do {
      renderPending = false;
      await renderNow();
    } while (renderPending);
  })().finally(() => {
    renderInFlight = null;
  });
  return renderInFlight;
}

async function renderNow() {
  try {
    const parsed = typeof state.route === "string" ? { route: state.route, id: state.params?.id } : parseHash();
    if (parsed.route) {
      state.route = parsed.route;
      if (parsed.id) state.params.id = parsed.id;
    }

    if (state.route !== "scan" && activeScanCleanup) {
      activeScanCleanup();
      activeScanCleanup = null;
    }

    await loadUser();

    if (!state.stickers.length) {
      await loadStickers();
    }

    if (!state.stickers.length) {
      shell("Mi álbum", "", msg("No hay catálogo cargado. Ejecuta el seed en Supabase (ver supabase/PROJECT.md).", "error"), true);
      return;
    }

  if (state.route === "flash") {
    viewFlashTrade();
    return;
  }

  if (state.route === "intercambiar") {
    viewCambiarLanding();
    return;
  }

  if (state.route === "cuenta") {
    viewCuenta();
    return;
  }

  if (AUTH_ROUTES.has(state.route)) {
    if (!state.user) {
      state.returnAfterAuth = state.route;
      state.route = "cuenta";
      if (location.hash !== "#cuenta") {
        history.replaceState(null, "", `${location.pathname}${location.search}#cuenta`);
      }
      viewCuenta();
      return;
    }
  }

  switch (state.route) {
    case "onboarding":
      viewOnboarding();
      break;
    case "album":
      viewAlbum();
      break;
    case "missing":
      viewMissing();
      break;
    case "duplicates":
      viewDuplicates();
      break;
    case "import":
      viewImport();
      break;
    case "guia":
      viewGuia();
      break;
    case "scan":
      viewScan();
      break;
    case "explore":
      viewExplore();
      break;
    case "trades":
      viewTrades();
      break;
    case "trade":
      viewTradeDetail();
      break;
    case "review":
      viewReviewForm();
      break;
    case "profile":
      viewProfile();
      break;
    case "user":
      viewUserPublic();
      break;
    default:
      viewAlbum();
  }
  } catch (err) {
    console.error("render:", err);
    shell(
      "Panini Intercambios",
      "",
      msg(`Algo falló al cargar la pantalla (${err.message}). Recarga la página; tu álbum sigue en el navegador.`, "error"),
      true
    );
  }
}

async function init() {
  if (redirectLegacyAuthPort()) return;

  if (import.meta.env.DEV && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  let authJustCompleted = false;
  supabase?.auth.onAuthStateChange(async (event) => {
    if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
    if (!bootComplete) return;
    const hadUser = !!state.user;
    await loadUser();
    if (event === "SIGNED_IN" && !hadUser && state.user) {
      mergeCollectionOnLogin().catch((e) => console.warn("merge on sign-in:", e.message));
    }
    if (event === "SIGNED_OUT") {
      state.profile = null;
      loginMergedForUserId = null;
      await loadCollection(true);
    }
    await render();
  });

  if (supabase) {
    try {
      const { error, justCompleted } = await withTimeout(
        completeAuthFromUrl(),
        12000,
        "Confirmar sesión"
      );
      authJustCompleted = justCompleted;
      if (error) setAuthFlash("error", `No se pudo iniciar sesión: ${error}`);
      else if (justCompleted) {
        setAuthFlash("success", "¡Listo! Combinando tu álbum de este dispositivo con tu cuenta…");
      }
    } catch (err) {
      console.warn("completeAuthFromUrl:", err.message);
      setAuthFlash("error", "El enlace de acceso tardó demasiado. Entra de nuevo desde Cuenta.");
    }
  }

  await loadUser();
  await loadStickers();
  const validIds = state.stickers.length ? new Set(state.stickers.map((s) => s.id)) : null;
  hydrateLocalCollection(validIds);
  bootComplete = true;
  const h = parseHash();
  if (typeof h === "object") {
    state.route = h.route;
    if (h.id) state.params.id = h.id;
  } else {
    state.route = h;
  }
  const savedTeam = sessionStorage.getItem("albumTeamIndex");
  if (savedTeam != null) state.albumTeamIndex = parseInt(savedTeam, 10) || 0;
  const savedSub = sessionStorage.getItem("albumSubPage");
  if (savedSub != null) {
    const n = parseInt(savedSub, 10);
    if (Number.isFinite(n) && n >= 1) state.albumSubPage = n;
  }
  const savedFilter = sessionStorage.getItem("albumGroupFilter");
  if (savedFilter) state.albumGroupFilter = savedFilter;
  const savedMode = sessionStorage.getItem("albumMode");
  if (savedMode === "edit") state.albumMode = "edit";
  else state.albumMode = "view";
  state.albumTeamsMissingOnly = sessionStorage.getItem("albumTeamsMissingOnly") === "1";
  try {
    await Promise.race([
      render(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("La app tardó demasiado en abrir")), 25000);
      }),
    ]);
  } catch (err) {
    console.error("init render:", err);
    if (!appPainted) {
      showBootError(
        `${err.message}. Tu álbum sigue guardado en el navegador salvo que elijas borrarlo abajo.`
      );
      return;
    }
  }
  if (collectionRecoveryNotice) {
    setAuthFlash("info", collectionRecoveryNotice);
    collectionRecoveryNotice = null;
  }
  loadCollection(true)
    .then(() => render())
    .catch((e) => console.warn("collection sync:", e.message));
  if (authJustCompleted && state.user) {
    mergeCollectionOnLogin()
      .then(() => render())
      .catch((e) => console.warn("merge on login:", e.message));
  }
}

init().catch((err) => {
  console.error("init:", err);
  showBootError(`No se pudo iniciar la app: ${err.message}`);
});

window.addEventListener("hashchange", () => {
  const h = parseHash();
  if (typeof h === "object") {
    state.route = h.route;
    state.params.id = h.id;
  } else state.route = h;
  render().catch((err) => console.error("hashchange render:", err));
});
