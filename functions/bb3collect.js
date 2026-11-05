/**
 * Collecte Blood Bowl 3 en arrière-plan (comme Spike) : la base du club garde les matchs des coachs inscrits,
 * l'appli les lit instantanément.
 *
 * Base (écrite uniquement par les fonctions) :
 *   bb3coaches/{coachId} = { name, status: "collecting"|"ready", resolved, total, lastRun, lastMatch, state, requestedBy: {uid: true} }
 *   bb3matches/{coachId}/{matchUuid} = match Cyanide allégé
 *   bb3hour/{AAAA-MM-JJTHH} = requêtes Cyanide consommées dans l'heure (garde-fou de quota)
 */
const { fetchCoachMatches } = require("./bb3");

const HOUR = 3600e3;
const hourKey = t => new Date(t).toISOString().slice(0, 13);

/**
 * Une passe de collecte (appelée toutes les 10 min).
 * Priorité : historiques en cours de récupération (le plus ancien inscrit d'abord), puis mises à jour horaires.
 * @param db     { get(path), update(obj) }  (adaptateur Realtime Database)
 * @param notify async (uids, data) : notification « vos matchs sont prêts »
 */
async function runCollector({ db, key, fetchImpl, now = Date.now(), budgetMs = 420e3, hourCap = 700, notify = async () => {}, log = () => {} }) {
  const t0 = Date.now();
  const coaches = (await db.get("bb3coaches")) || {};
  const used = Number(await db.get("bb3hour/" + hourKey(now))) || 0;
  let spent = 0;
  const backfill = Object.entries(coaches).filter(([, c]) => c && c.status !== "ready").sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  const refresh = Object.entries(coaches).filter(([, c]) => c && c.status === "ready" && now - (c.lastRun || 0) >= HOUR).sort((a, b) => (a[1].lastRun || 0) - (b[1].lastRun || 0));
  for (const [id, c] of [...backfill, ...refresh]) {
    const left = budgetMs - (Date.now() - t0), quota = hourCap - used - spent;
    if (left < 60e3 || quota < 20) break;
    const known = (await db.get("bb3matches/" + id)) || {};
    const recent = now - 365 * 864e5; // équipes ayant joué dans l'année : revérifiées à chaque mise à jour
    const teams = [...new Set(Object.values(known).filter(m => Date.parse(String(m.finished).replace(" ", "T") + "Z") >= recent)
      .flatMap(m => (m.teams || []).filter(t => t.idcoach === id).map(t => t.idteamlisting)))];
    const since = c.lastMatch ? new Date(Date.parse(String(c.lastMatch).replace(" ", "T") + "Z") - 2 * 864e5).toISOString().slice(0, 10) : "2023-01-01";
    const r = await fetchCoachMatches({ key, coach: c.name, since, teams, state: c.state || {}, budgetMs: left - 30e3, maxRequests: quota, fetchImpl });
    spent += r.requests;
    if (!r.coach) { await db.update({ [`bb3coaches/${id}/status`]: "ready", [`bb3coaches/${id}/error`]: "coach introuvable", [`bb3coaches/${id}/lastRun`]: now }); continue; }
    const upd = {};
    let lastMatch = c.lastMatch || "";
    r.matches.forEach(m => { upd[`bb3matches/${id}/${m.uuid}`] = m; if (String(m.finished) > lastMatch) lastMatch = String(m.finished); });
    const ready = r.remaining === 0;
    Object.assign(upd, {
      [`bb3coaches/${id}/state`]: r.state, [`bb3coaches/${id}/resolved`]: r.resolved, [`bb3coaches/${id}/total`]: r.total,
      [`bb3coaches/${id}/lastRun`]: now, [`bb3coaches/${id}/lastMatch`]: lastMatch, [`bb3coaches/${id}/status`]: ready ? "ready" : "collecting",
      [`bb3coaches/${id}/count`]: Object.keys(known).length + r.matches.filter(m => !known[m.uuid]).length
    });
    await db.update(upd);
    log(`${c.name} : ${r.matches.length} matchs, ${r.requests} requêtes, reste ${r.remaining}`);
    if (ready && c.status !== "ready") await notify(Object.keys(c.requestedBy || {}), { title: "🏈 Vos matchs Blood Bowl 3 sont prêts", body: `${upd[`bb3coaches/${id}/count`]} matchs de ${c.name} à importer dans Dugout`, url: "./#bb3", tag: "bb3-" + id });
  }
  await db.update({ ["bb3hour/" + hourKey(now)]: used + spent });
  return { spent };
}

module.exports = { runCollector, hourKey };
