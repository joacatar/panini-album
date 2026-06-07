import { TEAM_FLAGS } from "./teamFlags.js";
import { albumOrderIndex } from "./teamSections.js";

/** @typedef {'owned' | 'missing' | 'duplicates'} ImportMode */

/** @typedef {{ teamCode: string, slot: number, qty: number, raw: string }} ParsedRef */

/** @typedef {{ sticker: object, teamCode: string, slot: number, qty: number, raw: string }} MatchedSticker */

const MAX_SLOT = {
  FWC: 20,
  COC: 12,
  DEFAULT: 20,
};

/** Códigos que otras apps usan distinto al catálogo interno. */
const CODE_NORMALIZE = {
  CC: "COC",
};

const TEAM_ALIASES = {
  fwc: "FWC",
  fifa: "FWC",
  worldcup: "FWC",
  "world cup": "FWC",
  mundial: "FWC",
  trophy: "FWC",
  trofeo: "FWC",
  leyendas: "FWC",
  legends: "FWC",
  coc: "COC",
  cc: "COC",
  coca: "COC",
  coke: "COC",
  cocacola: "COC",
  "coca-cola": "COC",
  "coca cola": "COC",
  mex: "MEX",
  mexico: "MEX",
  méxico: "MEX",
  usa: "USA",
  us: "USA",
  "estados unidos": "USA",
  "united states": "USA",
  can: "CAN",
  canada: "CAN",
  canadá: "CAN",
  arg: "ARG",
  argentina: "ARG",
  bra: "BRA",
  brasil: "BRA",
  brazil: "BRA",
  ecu: "ECU",
  ecuador: "ECU",
  col: "COL",
  colombia: "COL",
  uru: "URU",
  uruguay: "URU",
  par: "PAR",
  paraguay: "PAR",
  fra: "FRA",
  france: "FRA",
  francia: "FRA",
  esp: "ESP",
  spain: "ESP",
  españa: "ESP",
  ger: "GER",
  germany: "GER",
  alemania: "GER",
  eng: "ENG",
  england: "ENG",
  inglaterra: "ENG",
  por: "POR",
  portugal: "POR",
  ned: "NED",
  holanda: "NED",
  netherlands: "NED",
  "paises bajos": "NED",
  "países bajos": "NED",
  bel: "BEL",
  belgium: "BEL",
  bélgica: "BEL",
  cro: "CRO",
  croatia: "CRO",
  croacia: "CRO",
  aut: "AUT",
  austria: "AUT",
  sui: "SUI",
  suiza: "SUI",
  switzerland: "SUI",
  sco: "SCO",
  scotland: "SCO",
  escocia: "SCO",
  nor: "NOR",
  norway: "NOR",
  noruega: "NOR",
  swe: "SWE",
  sweden: "SWE",
  suecia: "SWE",
  cze: "CZE",
  czech: "CZE",
  chequia: "CZE",
  bih: "BIH",
  bosnia: "BIH",
  tur: "TUR",
  turkey: "TUR",
  turquía: "TUR",
  jpn: "JPN",
  japan: "JPN",
  japón: "JPN",
  kor: "KOR",
  korea: "KOR",
  "corea del sur": "KOR",
  "south korea": "KOR",
  aus: "AUS",
  australia: "AUS",
  irn: "IRN",
  iran: "IRN",
  irán: "IRN",
  ksa: "KSA",
  "saudi arabia": "KSA",
  "arabia saudita": "KSA",
  qat: "QAT",
  qatar: "QAT",
  uzb: "UZB",
  uzbekistan: "UZB",
  uzbekistán: "UZB",
  irq: "IRQ",
  iraq: "IRQ",
  irak: "IRQ",
  jor: "JOR",
  jordan: "JOR",
  jordania: "JOR",
  mar: "MAR",
  morocco: "MAR",
  marruecos: "MAR",
  sen: "SEN",
  senegal: "SEN",
  egy: "EGY",
  egypt: "EGY",
  egipto: "EGY",
  alg: "ALG",
  algeria: "ALG",
  argelia: "ALG",
  tun: "TUN",
  tunisia: "TUN",
  túnez: "TUN",
  gha: "GHA",
  ghana: "GHA",
  civ: "CIV",
  "ivory coast": "CIV",
  "costa de marfil": "CIV",
  cod: "COD",
  congo: "COD",
  cpv: "CPV",
  "cape verde": "CPV",
  "cabo verde": "CPV",
  nzl: "NZL",
  "new zealand": "NZL",
  "nueva zelanda": "NZL",
  pan: "PAN",
  panama: "PAN",
  panamá: "PAN",
  hai: "HAI",
  haiti: "HAI",
  haití: "HAI",
  cuw: "CUW",
  curacao: "CUW",
  curaçao: "CUW",
  rsa: "RSA",
  "south africa": "RSA",
  "sudáfrica": "RSA",
  sudáfrica: "RSA",
};

const FLAG_TO_CODE = Object.fromEntries(
  Object.entries(TEAM_FLAGS)
    .filter(([, flag]) => flag && flag !== "🥤")
    .map(([code, flag]) => [flag, code])
);

const NOISE_LINE =
  /^(missing stickers?|stickers? (i )?need|needed stickers?|faltan?|me faltan|busco|want(ed)?|have|tengo|repetid(as|os)?|duplicates?|dupes?|swap|intercambio|lista|list|updated|actualizado).*$/i;

const MODE_HINTS = {
  missing: /\b(missing|faltan|falta|need|busco|necesito|want)\b/i,
  owned: /\b(have|tengo|got|owned|colecciono|collected)\b/i,
  duplicates: /\b(dupes?|duplicates?|repetid|sobran|doubles?|swap)\b/i,
};

const GLUED_CODE = /\b([A-Za-z]{2,3})(\d{1,2})(?:x(\d+)|×(\d+))?\b/gi;

function normalizeTeamCode(code) {
  const upper = String(code || "").toUpperCase();
  return CODE_NORMALIZE[upper] || upper;
}

function isKnownTeamCode(code) {
  const norm = normalizeTeamCode(code);
  return Boolean(TEAM_FLAGS[norm] || norm === "FWC" || norm === "COC");
}

function maxSlotForTeam(teamCode) {
  return MAX_SLOT[teamCode] || MAX_SLOT.DEFAULT;
}

export function buildCatalogIndex(stickers) {
  const byTeamSlot = new Map();
  const byCode = new Map();
  const byGlobalNumber = new Map();
  for (const s of stickers) {
    const team = (s.team_code || "").toUpperCase();
    const slot = s.team_slot;
    if (team && slot != null) byTeamSlot.set(`${team}:${slot}`, s);
    if (s.code) byCode.set(String(s.code).toUpperCase(), s);
    if (s.number != null) byGlobalNumber.set(s.number, s);
  }
  return { byTeamSlot, byCode, byGlobalNumber };
}

export function detectImportMode(text) {
  for (const mode of ["duplicates", "missing", "owned"]) {
    if (MODE_HINTS[mode].test(text)) return /** @type {ImportMode} */ (mode);
  }
  return "missing";
}

function resolveTeamToken(token) {
  const clean = token.toLowerCase().replace(/[*_~`]/g, "").replace(/[^a-z0-9áéíóúüñ\s-]/g, "").trim();
  if (!clean) return null;
  if (TEAM_ALIASES[clean]) return TEAM_ALIASES[clean];
  const upper = normalizeTeamCode(clean.replace(/\s+/g, ""));
  if (/^[A-Z]{2,3}$/.test(upper) && isKnownTeamCode(upper)) {
    return normalizeTeamCode(upper);
  }
  return null;
}

function expandNumberToken(token) {
  const range = token.match(/^(\d{1,2})-(\d{1,2})$/);
  if (range) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    if (a <= b && b - a <= 25) {
      return Array.from({ length: b - a + 1 }, (_, i) => ({ slot: a + i, qty: 1 }));
    }
  }
  const single = token.match(/^(\d{1,2})(?:[x×](\d+)|\([x×]?(\d+)[x×]?\))?$/i);
  if (single) {
    const slot = parseInt(single[1], 10);
    const qty = parseInt(single[2] || single[3] || "1", 10);
    if (slot >= 1 && qty >= 1 && qty <= 9) return [{ slot, qty }];
  }
  return null;
}

function replaceFlags(text) {
  let out = text;
  const found = [];
  for (const [flag, code] of Object.entries(FLAG_TO_CODE)) {
    if (out.includes(flag)) {
      found.push(code);
      out = out.split(flag).join(` ${code} `);
    }
  }
  if (text.includes("🥤") || text.includes("🏆")) {
    out = out.replace(/🥤/g, " COC ").replace(/🏆/g, " FWC ");
  }
  return { text: out, flagsFound: found };
}

export function normalizeStickerListText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[,;/|·•]+/g, " ")
    .replace(/[\u2013\u2014–—]/g, "-")
    .replace(/:\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function stripNoiseLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !NOISE_LINE.test(line))
    .join("\n");
}

/**
 * @param {string} text
 * @param {ReturnType<typeof buildCatalogIndex>} catalog
 * @param {{ mode?: ImportMode }} [options]
 */
export function parseStickerList(text, catalog, options = {}) {
  const mode = options.mode || detectImportMode(text);
  const rawInput = String(text || "");
  const stripped = stripNoiseLines(rawInput);
  const { text: withFlags } = replaceFlags(stripped);
  const normalized = normalizeStickerListText(withFlags);

  /** @type {ParsedRef[]} */
  const refs = [];
  /** @type {{ raw: string, reason: string }[]} */
  const unknown = [];

  const pushRef = (teamCode, slot, qty, raw) => {
    const team = normalizeTeamCode(teamCode);
    const max = maxSlotForTeam(team);
    if (slot < 1 || slot > max) {
      unknown.push({ raw, reason: `${team} ${slot} fuera de rango (1-${max})` });
      return;
    }
    refs.push({ teamCode: team, slot, qty: Math.min(9, Math.max(1, qty)), raw });
  };

  const addGluedMatches = (chunk) => {
    for (const m of chunk.matchAll(GLUED_CODE)) {
      const team = normalizeTeamCode(m[1]);
      if (!isKnownTeamCode(team)) continue;
      pushRef(team, parseInt(m[2], 10), parseInt(m[3] || m[4] || "1", 10), m[0]);
    }
  };

  addGluedMatches(normalized);

  const withoutGlued = normalized.replace(GLUED_CODE, " ");
  const lines = withoutGlued.split("\n").map((l) => l.trim()).filter(Boolean);

  let currentTeam = null;
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const team = resolveTeamToken(token);
      if (team) {
        currentTeam = team;
        continue;
      }
      const nums = expandNumberToken(token);
      if (nums && currentTeam) {
        for (const n of nums) pushRef(currentTeam, n.slot, n.qty, `${currentTeam} ${token}`);
        continue;
      }
      if (token.startsWith("#")) {
        const n = parseInt(token.slice(1), 10);
        const sticker = catalog.byGlobalNumber.get(n);
        if (sticker?.team_code && sticker.team_slot != null) {
          pushRef(sticker.team_code, sticker.team_slot, 1, token);
        } else {
          unknown.push({ raw: token, reason: "Número global no reconocido" });
        }
      }
    }
  }

  /** @type {Map<string, ParsedRef>} */
  const deduped = new Map();
  for (const ref of refs) {
    const key = `${ref.teamCode}:${ref.slot}`;
    const prev = deduped.get(key);
    if (!prev || ref.qty > prev.qty) deduped.set(key, ref);
  }

  /** @type {MatchedSticker[]} */
  const matched = [];
  for (const ref of deduped.values()) {
    const sticker = catalog.byTeamSlot.get(`${ref.teamCode}:${ref.slot}`);
    if (sticker) matched.push({ ...ref, sticker });
    else unknown.push({ raw: ref.raw, reason: `No existe ${ref.teamCode} ${ref.slot} en el catálogo` });
  }

  matched.sort(
    (a, b) => albumOrderIndex(a.teamCode) - albumOrderIndex(b.teamCode) || a.slot - b.slot
  );

  return {
    mode,
    modeDetected: Object.values(MODE_HINTS).some((re) => re.test(rawInput)),
    matched,
    unknown,
    totalRefs: matched.length,
  };
}

export function formatStickerRef(teamCode, slot) {
  return `${teamCode} ${slot}`;
}

export function summarizeParseResult(result) {
  const byTeam = new Map();
  for (const m of result.matched) {
    if (!byTeam.has(m.teamCode)) byTeam.set(m.teamCode, []);
    byTeam.get(m.teamCode).push(m.slot);
  }
  const teams = [...byTeam.keys()].sort((a, b) => albumOrderIndex(a) - albumOrderIndex(b));
  const lines = [];
  for (const team of teams) {
    const slots = byTeam.get(team).sort((a, b) => a - b);
    lines.push(`${team} ${slots.join(", ")}`);
  }
  return lines.join("\n");
}
