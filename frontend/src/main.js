import { supabase, supabaseConfigured, getSession } from "./lib/supabase.js";
import { api } from "./lib/api.js";

const $app = document.getElementById("app");
let state = {
  user: null,
  profile: null,
  stickers: [],
  collection: {},
  route: "login",
  params: {},
};

function navigate(route, params = {}) {
  state.route = route;
  state.params = params;
  render();
  window.location.hash = route === "login" ? "" : `${route}${params.id ? "/" + params.id : ""}`;
}

function parseHash() {
  const h = (location.hash || "").replace(/^#/, "");
  const [route, id] = h.split("/").filter(Boolean);
  if (!route) return state.user ? "album" : "login";
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
  const { data } = await supabase.from("stickers").select("*").order("number");
  state.stickers = data || [];
}

async function loadCollection() {
  if (!supabase || !state.user) return;
  const { data } = await supabase
    .from("user_stickers")
    .select("sticker_id, owned, duplicates")
    .eq("user_id", state.user.id);
  state.collection = {};
  for (const row of data || []) {
    state.collection[row.sticker_id] = row;
  }
}

async function upsertSticker(stickerId, patch) {
  const existing = state.collection[stickerId] || {
    user_id: state.user.id,
    sticker_id: stickerId,
    owned: false,
    duplicates: 0,
  };
  const row = { ...existing, ...patch, user_id: state.user.id, sticker_id: stickerId };
  const { error } = await supabase.from("user_stickers").upsert(row, {
    onConflict: "user_id,sticker_id",
  });
  if (error) throw error;
  state.collection[stickerId] = row;
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
  const nav = showNav && state.user
    ? `<nav class="bottom-nav">
        <a href="#album" class="${state.route === "album" ? "active" : ""}">Álbum</a>
        <a href="#missing" class="${state.route === "missing" ? "active" : ""}">Faltan</a>
        <a href="#explore" class="${state.route === "explore" ? "active" : ""}">Explorar</a>
        <a href="#trades" class="${state.route === "trades" ? "active" : ""}">Intercambios</a>
        <a href="#profile" class="${state.route === "profile" ? "active" : ""}">Perfil</a>
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

// --- Views ---

function viewLogin() {
  if (!supabaseConfigured) {
    shell(
      "Panini Intercambios",
      "Mundial FIFA 2026",
      msg(
        "Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en frontend/.env (copia desde .env.example).",
        "error"
      ),
      false
    );
    return;
  }
  shell(
    "Panini Intercambios",
    "Intercambia láminas del Mundial 2026",
    `
    ${msg("Cuenta verificada requerida para proponer intercambios.", "info")}
    <button class="btn btn-google" id="btn-google">Continuar con Google</button>
    <hr style="border-color:#2a6b4a;margin:1rem 0" />
    <label>Correo electrónico</label>
    <input type="email" id="email" placeholder="tu@correo.com" />
    <button class="btn btn-primary" id="btn-email">Enviar enlace mágico</button>
    <p class="pwa-hint" style="margin-top:1.5rem">
      Al usar la app aceptas que los intercambios son entre particulares; la plataforma no gestiona envíos ni pagos.
    </p>
    `,
    false
  );
  document.getElementById("btn-google").onclick = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) alert(error.message);
  };
  document.getElementById("btn-email").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    if (!email) return alert("Escribe tu correo.");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) alert(error.message);
    else alert("Revisa tu correo y abre el enlace para entrar.");
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
    navigate("album");
  };
}

function stickerGridInteractive() {
  return state.stickers
    .map((s) => {
      const c = state.collection[s.id];
      const owned = c?.owned;
      const dup = c?.duplicates > 0;
      const cls = owned ? (dup ? "duplicate" : "owned") : "missing";
      const label = dup ? `+${c.duplicates}` : s.number;
      return `<div class="sticker-cell ${cls}" data-id="${s.id}" title="${s.name}">${label}</div>`;
    })
    .join("");
}

function viewAlbum() {
  const st = stats();
  shell(
    "Mi álbum",
    `Tienes ${st.owned}/${st.total} · ${st.dups} repetidas · Faltan ${st.missing}`,
    `
    <div class="card">
      <p style="margin:0 0 0.5rem;font-size:0.85rem;color:var(--muted)">
        Toca una lámina: sin marcar → la tengo → repetida (+1) → quitar
      </p>
      <div class="sticker-grid">${stickerGridInteractive()}</div>
    </div>
    `,
    true
  );
  $app.querySelectorAll(".sticker-cell").forEach((el) => {
    el.onclick = async () => {
      const id = parseInt(el.dataset.id, 10);
      const c = state.collection[id] || { owned: false, duplicates: 0 };
      let owned = c.owned;
      let duplicates = c.duplicates || 0;
      if (!owned) owned = true;
      else if (duplicates === 0) duplicates = 1;
      else if (duplicates < 9) duplicates++;
      else {
        owned = false;
        duplicates = 0;
      }
      try {
        await upsertSticker(id, { owned, duplicates });
        viewAlbum();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

function viewMissing() {
  const missing = state.stickers.filter((s) => !state.collection[s.id]?.owned);
  shell(
    "Me faltan",
    `${missing.length} láminas por conseguir`,
    `
    <div class="card">
      ${missing.length
        ? `<ul style="margin:0;padding-left:1.2rem">${missing
            .map((s) => `<li>#${s.number} — ${s.name} <span class="badge">${s.section}</span></li>`)
            .join("")}</ul>`
        : msg("¡Álbum completo! 🎉", "success")}
    </div>
    `,
    true
  );
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
              Tú ofreces: ${m.you_offer_numbers.length ? m.you_offer_numbers.join(", ") : "—"}<br/>
              Te ofrecen: ${m.they_offer_numbers.length ? m.they_offer_numbers.join(", ") : "—"}
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
        if (!state.user?.email_confirmed_at && !state.user?.identities?.length) {
          const session = await getSession();
          if (!session?.user?.email_confirmed_at) {
            return alert("Verifica tu correo antes de proponer intercambios.");
          }
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
    document.getElementById("sendmsg")?.onclick = async () => {
      const body = document.getElementById("msgbody").value.trim();
      if (!body) return;
      await api.postMessage(id, body);
      viewTradeDetail();
    };
    document.getElementById("review")?.onclick = () => navigate("review", { id });
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
    navigate("login");
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
      <p><strong>Repetidas:</strong> ${dups.map((r) => "#" + r.stickers?.number).join(", ") || "—"}</p>
      <p><strong>Le faltan:</strong> ${missing.map((s) => "#" + s.number).slice(0, 30).join(", ")}${missing.length > 30 ? "…" : ""}</p>
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

  if (!state.user && state.route !== "login") {
    await loadUser();
  }

  if (!state.user) {
    viewLogin();
    return;
  }

  if (!state.profile?.profile_complete && state.route !== "onboarding") {
    navigate("onboarding");
    return;
  }

  await loadStickers();
  await loadCollection();

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
      navigate("album");
  }
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  supabase?.auth.onAuthStateChange(() => {
    loadUser().then(render);
  });
  await loadUser();
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
