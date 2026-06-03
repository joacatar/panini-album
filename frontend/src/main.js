import { supabase, supabaseConfigured, getSession } from "./lib/supabase.js";
import { api } from "./lib/api.js";
import { TEAM_FLAGS } from "./lib/teamFlags.js";
import { TEAM_SECTIONS, sectionForTeam } from "./lib/teamSections.js";
import {
  loadLocalCollection,
  saveLocalCollection,
  syncLocalToRemote,
} from "./lib/collection.js";

const SHOW_STICKER_NAMES = false;

const AUTH_ROUTES = new Set([
  "intercambiar",
  "explore",
  "trades",
  "trade",
  "review",
  "profile",
  "onboarding",
  "user",
]);

const $app = document.getElementById("app");
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
  albumSectionId: "fwc",
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
  const session = await getSession();
  state.user = session?.user ?? null;
  if (state.user) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", state.user.id)
      .single();
    state.profile = data;
  } else {
    state.profile = null;
  }
}

async function loadStickers() {
  if (!supabase) return;
  const { data } = await supabase.from("stickers").select("*").order("display_order");
  state.stickers = data || [];
}

async function loadCollection() {
  if (state.user && supabase) {
    const { data } = await supabase
      .from("user_stickers")
      .select("sticker_id, owned, duplicates")
      .eq("user_id", state.user.id);
    state.collection = {};
    for (const row of data || []) {
      state.collection[row.sticker_id] = row;
    }
    return;
  }
  const local = loadLocalCollection();
  state.collection = {};
  for (const [id, row] of Object.entries(local)) {
    state.collection[parseInt(id, 10)] = row;
  }
}

async function mergeLocalCollectionOnLogin() {
  const local = loadLocalCollection();
  if (!Object.keys(local).length || !state.user) return;
  const { data } = await supabase
    .from("user_stickers")
    .select("sticker_id, owned, duplicates")
    .eq("user_id", state.user.id);
  await syncLocalToRemote(supabase, state.user.id, local, data);
  await loadCollection();
}

async function upsertSticker(stickerId, patch) {
  const existing = state.collection[stickerId] || { owned: false, duplicates: 0 };
  const row = { ...existing, ...patch };
  state.collection[stickerId] = row;

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
    if (error) throw error;
  } else {
    saveLocalCollection(state.collection);
  }
}

function stats() {
  const total = state.stickers.length;
  let owned = 0;
  let dups = 0;
  for (const s of state.stickers) {
    const c = state.collection[s.id];
    if (c?.owned) owned++;
    if (c?.duplicates > 0) dups += c.duplicates;
  }
  return { total, owned, missing: total - owned, dups };
}

function shell(title, sub, body, showNav = true) {
  const nav = showNav
    ? `<nav class="bottom-nav">
        <a href="#album" class="${state.route === "album" ? "active" : ""}">Álbum</a>
        <a href="#missing" class="${state.route === "missing" ? "active" : ""}">Faltan</a>
        <a href="#intercambiar" class="${["intercambiar", "explore", "trades", "trade"].includes(state.route) ? "active" : ""}">Intercambiar</a>
      </nav>`
    : "";
  $app.innerHTML = `
    <header class="app-header">
      <h1>${title}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ""}
    </header>
    <main>${body}</main>
    ${nav}
  `;
  bindNav();
}

function bindNav() {
  $app.querySelectorAll("nav.bottom-nav a").forEach((a) => {
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
  return "Jugador";
}

function statusLabel(s) {
  const qty = totalCopies(state.collection[s.id]);
  if (qty === 0) return "Falta";
  if (qty === 1) return "La tengo";
  return `×${qty}`;
}

function totalCopies(c) {
  if (!c?.owned) return 0;
  return 1 + (c.duplicates || 0);
}

function stickerTeamPage(s) {
  const slot = s.team_slot ?? s.number;
  return slot <= 10 ? 1 : 2;
}

function setStickerCopies(id, qty) {
  if (qty <= 0) return upsertSticker(id, { owned: false, duplicates: 0 });
  return upsertSticker(id, { owned: true, duplicates: qty - 1 });
}

function cycleStickerCopies(id) {
  const c = state.collection[id] || { owned: false, duplicates: 0 };
  const qty = totalCopies(c);
  if (qty === 0) return setStickerCopies(id, 1);
  if (qty < 9) return setStickerCopies(id, qty + 1);
  return setStickerCopies(id, 0);
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
    g.stickers.sort((a, b) => (a.team_slot || 0) - (b.team_slot || 0));
    const owned = g.stickers.filter((s) => state.collection[s.id]?.owned).length;
    g.owned = owned;
    g.total = g.stickers.length;
    groups.push(g);
  }
  groups.sort((a, b) => (a.stickers[0]?.display_order || 0) - (b.stickers[0]?.display_order || 0));
  return groups;
}

function syncAlbumSection(groups) {
  const team = groups[state.albumTeamIndex];
  if (team) state.albumSectionId = sectionForTeam(team.team_code);
}

function groupsInSection(groups, sectionId) {
  return groups.filter((g) => sectionForTeam(g.team_code) === sectionId);
}

function sectionStats(groups, sectionId) {
  const list = groupsInSection(groups, sectionId);
  let owned = 0;
  let total = 0;
  for (const g of list) {
    owned += g.owned;
    total += g.total;
  }
  return { owned, total, teams: list.length };
}

function renderSectionBar(groups, activeSectionId) {
  return `<div class="section-bar" role="tablist">${TEAM_SECTIONS.map((sec) => {
    const st = sectionStats(groups, sec.id);
    if (!st.total) return "";
    const pct = st.total ? Math.round((st.owned / st.total) * 100) : 0;
    const active = sec.id === activeSectionId ? " active" : "";
    return `<button type="button" class="section-pill${active}" data-section="${sec.id}" role="tab" title="${sec.title}">
      <span class="section-pill-icon">${sec.icon}</span>
      <span class="section-pill-label">${sec.label}</span>
      <span class="section-pill-meta">${pct}%</span>
    </button>`;
  }).join("")}</div>`;
}

function renderTeamChips(groups, activeIdx, sectionId, { onlyMissing = false } = {}) {
  const chips = groupsInSection(groups, sectionId)
    .map((g) => {
      const idx = groups.indexOf(g);
      const miss = g.total - g.owned;
      if (onlyMissing && miss === 0) return "";
      const pct = g.total ? Math.round((g.owned / g.total) * 100) : 0;
      const active = idx === activeIdx ? " active" : "";
      const complete = g.owned === g.total ? " complete" : "";
      const badge = onlyMissing ? `${miss}` : `${g.owned}/${g.total}`;
      return `<button type="button" class="team-chip${active}${complete}" data-idx="${idx}" title="${g.team_name}">
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

function renderTeamHero(team, sectionId) {
  const sec = TEAM_SECTIONS.find((s) => s.id === sectionId);
  const pct = team.total ? Math.round((team.owned / team.total) * 100) : 0;
  return `
    <div class="team-hero">
      <div class="team-hero-flag" aria-hidden="true">${team.flag}</div>
      <div class="team-hero-body">
        <p class="team-hero-eyebrow">${sec?.icon || ""} ${sec?.title || ""}</p>
        <h2 class="team-hero-name">${team.team_name}</h2>
        <p class="team-hero-meta"><span class="mono">${team.team_code}</span> · ${team.owned}/${team.total} · ${pct}%</p>
        <div class="team-hero-track"><div class="team-hero-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`;
}

function renderSubpageTabs(sub, page1Count, page2Count, team) {
  const p1Owned = team.stickers.filter((s) => stickerTeamPage(s) === 1 && state.collection[s.id]?.owned).length;
  const p2Owned = team.stickers.filter((s) => stickerTeamPage(s) === 2 && state.collection[s.id]?.owned).length;
  return `
    <div class="subpage-segment" role="tablist">
      <button type="button" class="subpage-seg ${sub === 1 ? "active" : ""}" data-subpage="1">
        <span class="seg-label">Página 1</span>
        <span class="seg-meta">${p1Owned}/${page1Count}</span>
      </button>
      <button type="button" class="subpage-seg ${sub === 2 ? "active" : ""}" data-subpage="2">
        <span class="seg-label">Página 2</span>
        <span class="seg-meta">${p2Owned}/${page2Count}</span>
      </button>
    </div>`;
}

function stickerTileHtml(s, interactive = true) {
  const qty = totalCopies(state.collection[s.id]);
  const cls = qty === 0 ? "missing" : qty === 1 ? "owned" : "duplicate";
  const panini = formatPaniniCode(s);
  const kind = kindLabel(s);
  const status = statusLabel(s);
  const name = s.name || "";
  const aria = SHOW_STICKER_NAMES ? `${panini} ${name}, ${status}` : `${panini}, ${kind}, ${status}`;

  if (!interactive) {
    return `
      <div class="sticker-tile ${cls} kind-${s.sticker_kind || "jugador"} readonly">
        <div class="tile-code-wrap">${paniniCodeHtml(s)}</div>
        <span class="tile-kind">${kind}</span>
        <span class="tile-state">${status}</span>
      </div>`;
  }

  return `
    <div class="sticker-tile ${cls} kind-${s.sticker_kind || "jugador"}" data-id="${s.id}">
      <button type="button" class="tile-tap" data-action="cycle" data-id="${s.id}" aria-label="${aria}">
        <div class="tile-code-wrap">${paniniCodeHtml(s)}</div>
        <span class="tile-kind">${kind}</span>
        <span class="tile-state">${status}</span>
      </button>
      <div class="tile-qty">
        <button type="button" class="qty-btn" data-action="dec" data-id="${s.id}" aria-label="Quitar">−</button>
        <span class="qty-value">${qty || "·"}</span>
        <button type="button" class="qty-btn" data-action="inc" data-id="${s.id}" aria-label="Agregar">+</button>
      </div>
    </div>`;
}

function bindStickerRows(rerender) {
  $app.querySelectorAll("[data-action]").forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
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

function renderAlbumPageBody() {
  const groups = groupStickersByTeam();
  if (!groups.length) return msg("No hay catálogo. Carga el seed en Supabase.", "error");

  let idx = state.albumTeamIndex;
  if (idx < 0 || idx >= groups.length) idx = 0;
  state.albumTeamIndex = idx;
  syncAlbumSection(groups);
  sessionStorage.setItem("albumTeamIndex", String(idx));
  sessionStorage.setItem("albumSectionId", state.albumSectionId);

  const team = groups[idx];
  const sub = state.albumSubPage;
  const pageStickers = team.stickers.filter((s) => stickerTeamPage(s) === sub);
  const page1Count = team.stickers.filter((s) => stickerTeamPage(s) === 1).length;
  const page2Count = team.stickers.filter((s) => stickerTeamPage(s) === 2).length;
  const st = stats();
  const pct = st.total ? Math.round((st.owned / st.total) * 100) : 0;

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
      <div class="stat-card accent">
        <span class="stat-value">${st.missing}</span>
        <span class="stat-label">Faltan</span>
      </div>
      <div class="stat-card gold">
        <span class="stat-value">${st.dups}</span>
        <span class="stat-label">Repetidas</span>
      </div>
    </div>
    ${renderSectionBar(groups, state.albumSectionId)}
    ${renderTeamChips(groups, idx, state.albumSectionId)}
    <article class="album-sheet card">
      ${renderTeamHero(team, state.albumSectionId)}
      ${renderSubpageTabs(sub, page1Count, page2Count, team)}
      <p class="album-hint">Toca la lámina · <strong>±</strong> ajusta cantidad</p>
      <div class="sticker-grid">${pageStickers.map((s) => stickerTileHtml(s)).join("")}</div>
    </article>
    <div class="page-nav">
      <button type="button" class="btn btn-secondary nav-btn" id="prev-team" ${idx === 0 ? "disabled" : ""}>← Equipo</button>
      <span class="page-indicator">${idx + 1} / ${groups.length}</span>
      <button type="button" class="btn btn-secondary nav-btn" id="next-team" ${idx === groups.length - 1 ? "disabled" : ""}>Equipo →</button>
    </div>`;
}

function bindSectionAndTeamControls(rerender) {
  $app.querySelectorAll(".section-pill").forEach((btn) => {
    btn.onclick = () => {
      const sectionId = btn.dataset.section;
      state.albumSectionId = sectionId;
      sessionStorage.setItem("albumSectionId", sectionId);
      const groups = groupStickersByTeam();
      const inSection = groupsInSection(groups, sectionId);
      const onlyMissing = state.route === "missing";
      const candidates = onlyMissing
        ? inSection.filter((g) => g.stickers.some((s) => !state.collection[s.id]?.owned))
        : inSection;
      if (candidates.length) {
        const current = groups[state.albumTeamIndex];
        if (!current || !candidates.includes(current)) {
          state.albumTeamIndex = groups.indexOf(candidates[0]);
          state.albumSubPage = 1;
        }
      }
      rerender();
    };
  });
  $app.querySelectorAll(".team-chip").forEach((btn) => {
    btn.onclick = () => {
      state.albumTeamIndex = parseInt(btn.dataset.idx, 10);
      state.albumSubPage = 1;
      syncAlbumSection(groupStickersByTeam());
      rerender();
    };
  });
}

function bindAlbumPageControls() {
  bindSectionAndTeamControls(viewAlbum);
  $app.querySelectorAll(".subpage-seg").forEach((btn) => {
    btn.onclick = () => {
      state.albumSubPage = parseInt(btn.dataset.subpage, 10);
      sessionStorage.setItem("albumSubPage", String(state.albumSubPage));
      viewAlbum();
    };
  });
  document.getElementById("prev-team")?.addEventListener("click", () => {
    if (state.albumTeamIndex > 0) {
      state.albumTeamIndex--;
      syncAlbumSection(groupStickersByTeam());
      viewAlbum();
    }
  });
  document.getElementById("next-team")?.addEventListener("click", () => {
    const n = groupStickersByTeam().length;
    if (state.albumTeamIndex < n - 1) {
      state.albumTeamIndex++;
      syncAlbumSection(groupStickersByTeam());
      viewAlbum();
    }
  });
  bindStickerRows(viewAlbum);
}

// --- Views ---

function viewAuthGate() {
  if (!supabaseConfigured) {
    shell(
      "Panini Intercambios",
      "Mundial FIFA 2026",
      msg("Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en frontend/.env.", "error"),
      true
    );
    return;
  }
  shell(
    "Intercambiar láminas",
    "Solo necesitas cuenta para esto",
    `
    ${msg("Tu álbum se guarda en este dispositivo sin entrar. Entra cuando quieras buscar intercambios.", "info")}
    <button class="btn btn-google" id="btn-google">Continuar con Google</button>
    <hr style="border-color:#2a6b4a;margin:1rem 0" />
    <label>Correo electrónico</label>
    <input type="email" id="email" placeholder="tu@correo.com" />
    <button class="btn btn-primary" id="btn-email">Enviar enlace mágico</button>
    <button class="btn btn-secondary" id="btn-back-album">Volver al álbum sin entrar</button>
    `,
    true
  );
  document.getElementById("btn-google").onclick = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/#intercambiar" },
    });
    if (error) alert(error.message);
  };
  document.getElementById("btn-email").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    if (!email) return alert("Escribe tu correo.");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/#intercambiar" },
    });
    if (error) alert(error.message);
    else alert("Revisa tu correo y abre el enlace para continuar.");
  };
  document.getElementById("btn-back-album").onclick = () => navigate("album");
}

function viewIntercambiarHub() {
  shell(
    "Intercambiar",
    state.profile?.city ? `${state.profile.city} · radio ${state.profile.search_radius_km || 25} km` : "",
    `
    <div class="card">
      <button class="btn btn-primary" id="go-explore">Explorar coleccionistas</button>
      <button class="btn btn-secondary" id="go-trades">Mis solicitudes</button>
      <button class="btn btn-secondary" id="go-profile">Mi perfil y ubicación</button>
      <button class="btn btn-secondary" id="logout">Cerrar sesión</button>
    </div>
    `,
    true
  );
  document.getElementById("go-explore").onclick = () => navigate("explore");
  document.getElementById("go-trades").onclick = () => navigate("trades");
  document.getElementById("go-profile").onclick = () => navigate("profile");
  document.getElementById("logout").onclick = async () => {
    await supabase.auth.signOut();
    state.user = null;
    state.profile = null;
    navigate("album");
  };
}

function viewOnboarding() {
  shell(
    "Tu ubicación",
    "Para encontrar coleccionistas cerca",
    `
    <div class="card">
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
    navigate("intercambiar");
  };
}

function viewAlbum() {
  const groups = groupStickersByTeam();
  const team = groups[state.albumTeamIndex] || groups[0];
  const sec = TEAM_SECTIONS.find((s) => s.id === state.albumSectionId);
  shell(
    "Mi álbum",
    team
      ? `${team.flag} ${team.team_name} · pág. ${state.albumSubPage}/2${sec ? ` · ${sec.label}` : ""}`
      : "Mundial FIFA 2026",
    renderAlbumPageBody(),
    true
  );
  bindAlbumPageControls();
  $app.querySelector(".team-chip.active")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function viewMissing() {
  const groups = groupStickersByTeam();
  let idx = state.albumTeamIndex;
  if (idx >= groups.length) idx = 0;
  syncAlbumSection(groups);

  const team = groups[idx];
  const sub = state.albumSubPage;
  const missingAll = team ? team.stickers.filter((s) => !state.collection[s.id]?.owned) : [];
  const missing = missingAll.filter((s) => stickerTeamPage(s) === sub);
  const total = state.stickers.filter((s) => !state.collection[s.id]?.owned).length;
  const page1Miss = missingAll.filter((s) => stickerTeamPage(s) === 1).length;
  const page2Miss = missingAll.filter((s) => stickerTeamPage(s) === 2).length;

  const sectionsWithMissing = TEAM_SECTIONS.filter((sec) =>
    groupsInSection(groups, sec.id).some((g) => g.stickers.some((s) => !state.collection[s.id]?.owned))
  );

  const body =
    total === 0
      ? msg("¡Álbum completo! 🎉", "success")
      : `
    <div class="album-stats compact">
      <div class="stat-card accent wide">
        <span class="stat-value">${total}</span>
        <span class="stat-label">láminas que te faltan</span>
      </div>
    </div>
    <div class="section-bar" role="tablist">${sectionsWithMissing
      .map((sec) => {
        const active = sec.id === state.albumSectionId ? " active" : "";
        const miss = groupsInSection(groups, sec.id).reduce(
          (n, g) => n + g.stickers.filter((s) => !state.collection[s.id]?.owned).length,
          0
        );
        return `<button type="button" class="section-pill${active}" data-section="${sec.id}" role="tab">
          <span class="section-pill-icon">${sec.icon}</span>
          <span class="section-pill-label">${sec.label}</span>
          <span class="section-pill-meta">${miss}</span>
        </button>`;
      })
      .join("")}</div>
    ${renderTeamChips(groups, idx, state.albumSectionId, { onlyMissing: true })}
    <article class="album-sheet card">
      ${team ? renderTeamHero(team, state.albumSectionId) : ""}
      <div class="subpage-segment">
        <button type="button" class="subpage-seg ${sub === 1 ? "active" : ""}" data-subpage="1">
          <span class="seg-label">Página 1</span><span class="seg-meta">${page1Miss} faltan</span>
        </button>
        <button type="button" class="subpage-seg ${sub === 2 ? "active" : ""}" data-subpage="2">
          <span class="seg-label">Página 2</span><span class="seg-meta">${page2Miss} faltan</span>
        </button>
      </div>
      <div class="sticker-grid">${missing.length ? missing.map((s) => stickerTileHtml(s, false)).join("") : msg("Nada pendiente en esta página.", "info")}</div>
    </article>`;

  shell("Me faltan", team ? `${team.flag} ${team.team_name}` : `${total} en total`, body, true);

  bindSectionAndTeamControls(viewMissing);
  $app.querySelectorAll(".subpage-seg").forEach((btn) => {
    btn.onclick = () => {
      state.albumSubPage = parseInt(btn.dataset.subpage, 10);
      sessionStorage.setItem("albumSubPage", String(state.albumSubPage));
      viewMissing();
    };
  });
  $app.querySelector(".team-chip.active")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function numberToPanini(n) {
  const s = state.stickers.find((x) => x.number === n);
  return s ? formatPaniniCode(s) : `#${n}`;
}

function formatMatchList(nums) {
  return nums?.length ? nums.map(numberToPanini).join(" · ") : "—";
}

async function viewExplore() {
  shell("Explorar", "Cargando coincidencias…", "", true);
  const filter = state.params.filter || "cerca";
  try {
    const data = await api.matches(filter);
    const rows = data.matches || [];
    shell(
      "Explorar",
      "Personas con láminas que te sirven",
      `
      <div style="margin-bottom:0.5rem">
        ${[
          ["cerca", "Cerca"],
          ["ciudad", "Mi ciudad"],
          ["pais", "Mi país"],
          ["todos", "Todos"],
        ]
          .map(
            ([f, label]) =>
              `<button class="btn btn-secondary" style="width:auto;display:inline-block;margin-right:4px;padding:0.4rem 0.6rem;font-size:0.8rem" data-f="${f}">${label}</button>`
          )
          .join("")}
      </div>
      ${rows.length
        ? rows
            .map(
              (m) => `
          <div class="card">
            <strong>${m.display_name}</strong>
            <span class="badge">${m.city}, ${m.country}</span>
            ${m.distance_km != null ? `<span class="badge ok">${m.distance_km} km</span>` : ""}
            <p style="font-size:0.85rem;margin:0.5rem 0 0">
              Tú ofreces: ${formatMatchList(m.you_offer_numbers)}<br/>
              Te ofrecen: ${formatMatchList(m.they_offer_numbers)}
            </p>
            <span class="badge ok">Match: ${m.match_score}</span>
            <button class="btn btn-primary btn-trade" data-user="${m.user_id}"
              data-offer="${JSON.stringify(m.you_offer_numbers)}"
              data-want="${JSON.stringify(m.they_offer_numbers)}">
              Proponer intercambio
            </button>
            <button class="btn btn-secondary btn-profile" data-user="${m.user_id}">Ver perfil</button>
          </div>`
            )
            .join("")
        : msg("No hay coincidencias con este filtro. Amplía tu radio o actualiza tu álbum.", "info")}
      `,
      true
    );
    $app.querySelectorAll("[data-f]").forEach((b) => {
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
        ? trades
            .map((t) => {
              const mine = t.requester_id === state.user.id;
              const status = t.status;
              return `
            <div class="card">
              <span class="badge">${status}</span>
              <span class="badge">${mine ? "Enviada" : "Recibida"}</span>
              <p style="font-size:0.85rem">Ofrezco #${(t.offer_sticker_ids || []).join(", #")} · Quiero #${(t.want_sticker_ids || []).join(", #")}</p>
              <button class="btn btn-primary" data-tid="${t.id}">Abrir</button>
            </div>`;
            })
            .join("")
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
      <div class="card">
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
        <h3 style="margin:0 0 0.5rem;font-size:1rem">Mensajes</h3>
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
      <p class="badge">Radio: ${state.profile?.search_radius_km || 25} km</p>
      <button class="btn btn-secondary" id="edit-loc">Editar ubicación</button>
      <button class="btn btn-secondary" id="pwa-help">Instalar en iPhone</button>
      <button class="btn btn-secondary" id="logout">Cerrar sesión</button>
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
  const parsed = typeof state.route === "string" ? { route: state.route, id: state.params?.id } : parseHash();
  if (parsed.route) {
    state.route = parsed.route;
    if (parsed.id) state.params.id = parsed.id;
  }

  await loadUser();
  await loadStickers();

  if (!state.stickers.length && supabaseConfigured) {
    shell("Mi álbum", "", msg("No hay catálogo cargado. Ejecuta el seed en Supabase (ver supabase/PROJECT.md).", "error"), true);
    return;
  }

  await loadCollection();

  if (state.route === "intercambiar") {
    if (!state.user) {
      viewAuthGate();
      return;
    }
    if (!state.profile?.profile_complete) {
      viewOnboarding();
      return;
    }
    viewIntercambiarHub();
    return;
  }

  if (AUTH_ROUTES.has(state.route) && state.route !== "intercambiar") {
    if (!state.user) {
      state.returnAfterAuth = state.route;
      viewAuthGate();
      return;
    }
    if (!state.profile?.profile_complete && state.route !== "onboarding") {
      viewOnboarding();
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
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  supabase?.auth.onAuthStateChange(async () => {
    const hadUser = !!state.user;
    await loadUser();
    if (!hadUser && state.user) {
      await mergeLocalCollectionOnLogin();
    }
    await render();
  });
  await loadUser();
  if (state.user) await mergeLocalCollectionOnLogin();
  const savedTeam = sessionStorage.getItem("albumTeamIndex");
  if (savedTeam != null) state.albumTeamIndex = parseInt(savedTeam, 10) || 0;
  const savedSub = sessionStorage.getItem("albumSubPage");
  if (savedSub != null) state.albumSubPage = parseInt(savedSub, 10) === 2 ? 2 : 1;
  const savedSection = sessionStorage.getItem("albumSectionId");
  if (savedSection) state.albumSectionId = savedSection;
  const h = parseHash();
  if (typeof h === "object") {
    state.route = h.route;
    if (h.id) state.params.id = h.id;
  } else {
    state.route = h;
  }
  await render();
}

window.addEventListener("hashchange", () => {
  const h = parseHash();
  if (typeof h === "object") {
    state.route = h.route;
    state.params.id = h.id;
  } else state.route = h;
  render();
});

init();
