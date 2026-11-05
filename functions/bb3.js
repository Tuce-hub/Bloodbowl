/**
 * Recherche des matchs Blood Bowl 3 d'un coach via l'API officielle de Cyanide (web.cyanide-studio.com/ws).
 * La clé n'est jamais dans le code : elle est passée en paramètre (secret Firebase CYANIDE_KEY).
 *
 * L'API ne filtre pas par coach et ne dit pas dans quelle ligue joue une équipe. Méthode :
 *  1. lookup : liste des équipes du coach ;
 *  2. ligue officielle : matchs de chaque équipe (rapide) ;
 *  3. équipes sans match officiel : recherche « toutes ligues » (league=%), lente (~30 s) ; on découvre ainsi
 *     les ligues privées du coach. Limitée dans le temps : la suite reprend à la recherche suivante (état mémorisé) ;
 *  4. ligues privées découvertes : matchs de leurs compétitions (toutes la 1re fois, puis celles en cours).
 */
const API = "https://web.cyanide-studio.com/ws/bb";
const DAY = 864e5, OFFICIAL = "Official league";

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

async function pool(items, n, fn, stop = () => false) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && !stop()) { const k = i++; await fn(items[k]); }
  }));
}

/** Date de création d'une équipe, lue dans son identifiant (UUID version 1). */
function uuidTime(u) {
  const p = String(u || "").split("-"); if (p.length < 3) return 0;
  const t = (BigInt(parseInt(p[2], 16) & 0x0fff) << 48n) | (BigInt(parseInt(p[1], 16)) << 32n) | BigInt(parseInt(p[0], 16));
  return Number(t / 10000n) - 12219292800000;
}

const slim = m => ({
  uuid: m.uuid, started: m.started, finished: m.finished, leaguename: m.leaguename, competitionname: m.competitionname,
  coaches: (m.coaches || []).map(c => ({ idcoach: c.idcoach, coachname: c.coachname })),
  teams: (m.teams || []).map(t => ({ idteamlisting: t.idteamlisting, idcoach: t.idcoach, idraces: t.idraces, teamname: t.teamname, score: t.score, inflictedcasualties: t.inflictedcasualties }))
});

/**
 * Une étape de recherche, limitée dans le temps ; l'appli enchaîne les étapes tant que « remaining » > 0.
 * @param state mémoire entre étapes : { checked: [équipes résolues], leagues: {nom: true si parcourue en entier} }
 * @param teams équipes déjà actives connues de l'appli (revérifiées à chaque fois, depuis « since »)
 */
async function fetchCoachMatches({ key, coach, since = "2023-01-01", teams = [], state = {}, recentDays = 120,
  budgetMs = 420e3, fetchImpl = fetch, concurrency = 6 }) {
  const t0 = Date.now(); let requests = 0;
  const left = () => budgetMs - (Date.now() - t0);
  const c = async (m, p) => { requests++; return call(key, m, p, fetchImpl); };
  const st = { checked: Array.isArray(state.checked) ? state.checked.slice() : [], leagues: Object.assign({}, state.leagues || {}) };
  const look = await c("lookup", { coach_name: coach });
  const found = (look.coaches || []).find(x => String(x.name).toLowerCase() === String(coach).toLowerCase());
  if (!found) return { coach: null, matches: [], requests, state: st, remaining: 0, total: 0, candidates: (look.coaches || []).slice(0, 5).map(x => x.name) };

  const byId = new Map(), hit = new Set();
  const keep = list => (list || []).forEach(m => {
    if (!m || !m.uuid || !(m.coaches || []).some(x => x.idcoach === found.id)) return;
    byId.set(m.uuid, slim(m));
    (m.teams || []).forEach(t => { if (t.idcoach === found.id) hit.add(t.idteamlisting); });
    if (m.leaguename && m.leaguename !== OFFICIAL && !(m.leaguename in st.leagues)) st.leagues[m.leaguename] = false;
  });
  const all = found.teams || [], cutoff = Date.now() - recentDays * DAY;
  const checked = new Set(st.checked), known = new Set(teams.map(String));

  // a) Équipes déjà résolues et actives : seulement les nouveaux matchs (ligue officielle ; les ligues privées passent en d)
  const refresh = all.filter(t => checked.has(t) && (known.has(t) || uuidTime(t) >= cutoff));
  await pool(refresh, concurrency, async t => keep((await c("matches", { team_id: t, start: since, limit: "1000", league: OFFICIAL })).matches), () => left() < 60e3);

  // b) Équipes jamais résolues, les plus récentes d'abord : ligue officielle, sinon recherche toutes ligues (lente)
  const todo = all.filter(t => !checked.has(t)).sort((a, b) => uuidTime(b) - uuidTime(a));
  await pool(todo, concurrency, async t => {
    keep((await c("matches", { team_id: t, start: "2023-01-01", limit: "1000", league: OFFICIAL })).matches);
    if (!hit.has(t)) keep((await c("matches", { team_id: t, start: "2023-01-01", limit: "1000", league: "%" })).matches);
    checked.add(t);
  }, () => left() < 45e3);
  st.checked = [...checked];

  // c) Ligues privées découvertes : toutes les compétitions la 1re fois, ensuite celles en cours ou récentes
  for (const l of Object.keys(st.leagues).slice(0, 30)) {
    if (left() < 60e3) break;
    const done = st.leagues[l] === true;
    const cs = (await c("competitions", { league: l, exact: "1", limit: "300", competitions_limit: "300" })).competitions || [];
    const pick = cs.filter(x => !done || String(x.status) !== "4" || Date.parse(String(x.date_created).replace(" ", "T") + "Z") >= cutoff);
    let ok = true;
    await pool(pick, concurrency, async x => keep((await c("matches", { league: l, competition_id: x.id, start: done ? since : "2023-01-01", limit: "1000" })).matches), () => { if (left() < 20e3) ok = false; return !ok; });
    if (ok) st.leagues[l] = true;
  }
  const remaining = all.filter(t => !checked.has(t)).length + Object.values(st.leagues).filter(v => v !== true).length;
  return { coach: { id: found.id, name: found.name }, matches: [...byId.values()], requests, state: st, remaining, total: all.length, resolved: checked.size };
}

module.exports = { fetchCoachMatches, uuidTime };
