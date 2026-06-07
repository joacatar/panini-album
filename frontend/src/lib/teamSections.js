/** Grupos del Mundial 2026 y orden del álbum Panini (FWC → A → B → … → L → Coca-Cola). */

export const WC_GROUPS = [
  { id: "A", label: "Grupo A", teams: ["MEX", "KOR", "RSA", "CZE"] },
  { id: "B", label: "Grupo B", teams: ["CAN", "SUI", "QAT", "BIH"] },
  { id: "C", label: "Grupo C", teams: ["BRA", "MAR", "SCO", "HAI"] },
  { id: "D", label: "Grupo D", teams: ["USA", "PAR", "AUS", "TUR"] },
  { id: "E", label: "Grupo E", teams: ["GER", "ECU", "CIV", "CUW"] },
  { id: "F", label: "Grupo F", teams: ["NED", "JPN", "TUN", "SWE"] },
  { id: "G", label: "Grupo G", teams: ["BEL", "IRN", "EGY", "NZL"] },
  { id: "H", label: "Grupo H", teams: ["ESP", "URU", "KSA", "CPV"] },
  { id: "I", label: "Grupo I", teams: ["FRA", "SEN", "NOR", "IRQ"] },
  { id: "J", label: "Grupo J", teams: ["ARG", "AUT", "ALG", "JOR"] },
  { id: "K", label: "Grupo K", teams: ["POR", "COL", "UZB", "COD"] },
  { id: "L", label: "Grupo L", teams: ["ENG", "CRO", "PAN", "GHA"] },
];

/** Orden de equipos en el álbum (después de la sección FWC). */
export const ALBUM_TEAM_ORDER = WC_GROUPS.flatMap((g) => g.teams);

const ORDER_INDEX = new Map([
  ["FWC", 0],
  ...ALBUM_TEAM_ORDER.map((c, i) => [c, i + 1]),
  ["COC", ALBUM_TEAM_ORDER.length + 1],
]);

const TEAM_TO_GROUP = Object.fromEntries(
  WC_GROUPS.flatMap((g) => g.teams.map((code) => [code, g.id]))
);

export function albumOrderIndex(teamCode) {
  return ORDER_INDEX.get(teamCode) ?? 9999;
}

export function groupForTeam(teamCode) {
  if (teamCode === "FWC" || teamCode === "COC") return null;
  return TEAM_TO_GROUP[teamCode] || null;
}

export function groupLabel(groupId) {
  if (!groupId) return null;
  const g = WC_GROUPS.find((x) => x.id === groupId);
  return g ? g.label : `Grupo ${groupId}`;
}

export function sectionLabel(teamCode) {
  if (teamCode === "FWC") return "FWC";
  if (teamCode === "COC") return "Coca-Cola";
  const grp = groupForTeam(teamCode);
  return grp ? groupLabel(grp) : teamCode;
}

export function teamsInGroupFilter(groups, filterId) {
  if (!filterId || filterId === "all") return groups;
  if (filterId === "FWC") return groups.filter((g) => g.team_code === "FWC");
  if (filterId === "COC") return groups.filter((g) => g.team_code === "COC");
  return groups.filter((g) => {
    if (g.team_code === "FWC" || g.team_code === "COC") return false;
    return groupForTeam(g.team_code) === filterId;
  });
}

export const ALBUM_SPECIAL_FILTERS = [
  { id: "FWC", label: "🏆", title: "FWC · FIFA World Cup" },
  { id: "COC", label: "🥤", title: "Coca-Cola x Panini (12)" },
];
