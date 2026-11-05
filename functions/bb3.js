/**
 * Import des matchs Blood Bowl 3 via l'API officielle de Cyanide (web.cyanide-studio.com/ws).
 * La clé n'est jamais dans le code : elle est passée en paramètre (secret Firebase CYANIDE_KEY).
 *
 * L'API ne filtre pas par coach. On récupère ses équipes (lookup), puis :
 *  - ligue officielle : les matchs de chaque équipe concernée (team_id) ;
 *  - ligues privées (FRANCO BOWL, ETO…) : les compétitions de la ligue, puis leurs matchs, filtrés sur le coach.
 * Mode « récent » (par défaut) : seulement les équipes récentes ou déjà actives et les compétitions en cours,
 * pour limiter le nombre de requêtes (le serveur de Cyanide met plusieurs secondes par réponse).
 */
const API = "https://web.cyanide-studio.com/ws/bb";
const DAY = 864e5;

async function call(key, method, params, fetchImpl) {
  const q = new URLSearchParams(Object.assign({ key, bb: "3", platform: "pc" }, params));
  let last;
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetchImpl(`${API}/${method}/?${q}`);
      if (r.ok) return await r.json();
      last = new Error(`Cyanide a répondu ${r.status}`);
      if (r.status < 500) break;
    } catch (e) { last = e; }
    await new Promise(res => setTimeout(res, 1500 * (k + 1)));
  }
  throw last;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

/** Date de création d'une équipe, lue dans son identifiant (UUID version 1). */
function uuidTime(u) {
  const p = String(u || "").split("-"); if (p.length < 3) return 0;
  const t = (BigInt(parseInt(p[2], 16) & 0x0fff) << 48n) | (BigInt(parseInt(p[1], 16)) << 32n) | BigInt(parseInt(p[0], 16));
  return Number(t / 10000n) - 12219292800000; // 100 ns depuis 1582 → ms depuis 1970
}

/** Ne garde que ce dont l'appli a besoin. */
const slim = m => ({
  uuid: m.uuid, started: m.started, finished: m.finished, leaguename: m.leaguename, competitionname: m.competitionname,
  coaches: (m.coaches || []).map(c => ({ idcoach: c.idcoach, coachname: c.coachname })),
  teams: (m.teams || []).map(t => ({ idteamlisting: t.idteamlisting, idcoach: t.idcoach, idraces: t.idraces, teamname: t.teamname, score: t.score, inflictedcasualties: t.inflictedcasualties }))
});

/**
 * @param full   true : tout l'historique (long) ; false : récent seulement
 * @param teams  équipes déjà connues comme actives (mode récent)
 */
async function fetchCoachMatches({ key, coach, leagues = [], since = "2023-01-01", full = false, teams = [], recentDays = 120, fetchImpl = fetch, concurrency = 8 }) {
  let requests = 0;
  const c = async (m, p) => { requests++; return call(key, m, p, fetchImpl); };
  const look = await c("lookup", { coach_name: coach });
  const found = (look.coaches || []).find(x => String(x.name).toLowerCase() === String(coach).toLowerCase());
  if (!found) return { coach: null, matches: [], requests, candidates: (look.coaches || []).slice(0, 5).map(x => x.name) };
  const byId = new Map();
  const keep = list => (list || []).forEach(m => {
    if (m && m.uuid && (m.coaches || []).some(x => x.idcoach === found.id)) byId.set(m.uuid, slim(m));
  });
  const cutoff = Date.now() - recentDays * DAY;
  const all = found.teams || [];
  const known = new Set(teams.map(String));
  const scan = full ? all : all.filter(t => known.has(t) || uuidTime(t) >= cutoff);
  await pool(scan, concurrency, async t => {
    keep((await c("matches", { team_id: t, start: since, limit: "1000", league: "Official league" })).matches);
  });
  for (const l of leagues.filter(Boolean).slice(0, 10)) {
    const cs = (await c("competitions", { league: l, exact: "1", limit: "300", competitions_limit: "300" })).competitions || [];
    const pick = cs.filter(x => full || String(x.status) !== "4" || Date.parse(String(x.date_created).replace(" ", "T") + "Z") >= cutoff);
    await pool(pick, concurrency, async x => {
      keep((await c("matches", { league: l, competition_id: x.id, start: since, limit: "1000" })).matches);
    });
  }
  return { coach: { id: found.id, name: found.name }, matches: [...byId.values()], requests, scannedTeams: scan.length };
}

module.exports = { fetchCoachMatches, uuidTime };
