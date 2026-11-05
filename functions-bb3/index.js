/**
 * Dugout — Blood Bowl 3 : collecte des matchs en arrière-plan (base de code séparée « bb3 »).
 * Déployée à part : npx firebase-tools deploy --only functions:bb3 (voir BB3.md).
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { runCollector } = require("./bb3collect");

initializeApp();
// Clé personnelle de l'API Cyanide : secret Firebase, jamais dans le code (voir BB3.md).
const CYANIDE_KEY = defineSecret("CYANIDE_KEY");
const pushes = async () => (await getDatabase().ref("push").once("value")).val() || {};

async function send(targets, data) {
  if (!targets.length) return;
  const res = await getMessaging().sendEach(targets.map(t => ({
    token: t.token, data, webpush: { headers: { Urgency: "high", TTL: "3600" } }
  })));
  // Jetons expirés (appli désinstallée, notifications coupées) : on nettoie.
  const dead = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code || "";
    if (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) dead["push/" + targets[i].uid] = null;
  });
  if (Object.keys(dead).length) await getDatabase().ref().update(dead);
}


/**
 * Blood Bowl 3 : inscription d'un coach. La collecte se fait ensuite en arrière-plan (bb3Collect) ;
 * l'appli lit bb3coaches/{id} (avancement) et bb3matches/{id} (matchs).
 */
exports.bb3Register = onCall({ region: "europe-west1", secrets: [CYANIDE_KEY], timeoutSeconds: 60, maxInstances: 2 }, async req => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Connexion requise");
  const coach = String((req.data || {}).coach || "").trim().slice(0, 40);
  if (!coach) throw new HttpsError("invalid-argument", "Pseudo Blood Bowl 3 manquant");
  const db = getDatabase(), now = Date.now();
  const rate = db.ref("bb3rate/" + req.auth.uid);
  if (now - ((await rate.get()).val() || 0) < 20e3) throw new HttpsError("resource-exhausted", "Patientez quelques secondes");
  await rate.set(now);
  const q = new URLSearchParams({ key: CYANIDE_KEY.value(), bb: "3", platform: "pc", coach_name: coach });
  const r = await fetch("https://web.cyanide-studio.com/ws/bb/lookup/?" + q);
  if (!r.ok) throw new HttpsError("unavailable", "Cyanide ne répond pas, réessayez plus tard");
  const list = (await r.json()).coaches || [];
  const found = list.find(x => String(x.name).toLowerCase() === coach.toLowerCase());
  if (!found) throw new HttpsError("not-found", `Aucun coach Blood Bowl 3 nommé « ${coach} »` + (list.length ? ` (proches : ${list.slice(0, 4).map(x => x.name).join(", ")})` : ""));
  const ref = db.ref("bb3coaches/" + found.id), cur = (await ref.get()).val();
  const upd = { ["requestedBy/" + req.auth.uid]: true };
  if (!cur) Object.assign(upd, { name: found.name, status: "collecting", createdAt: now, resolved: 0, total: (found.teams || []).length, count: 0 });
  await ref.update(upd);
  return { coachId: found.id, name: found.name };
});

/** Collecte en arrière-plan, toutes les 10 minutes (quota Cyanide : 700 requêtes/h maximum pour le club). */
exports.bb3Collect = onSchedule({ schedule: "every 10 minutes", region: "europe-west1", secrets: [CYANIDE_KEY], timeoutSeconds: 540, memory: "256MiB", maxInstances: 1 }, async () => {
  const root = getDatabase();
  const db = { get: async p => (await root.ref(p).get()).val(), update: o => root.ref().update(o) };
  const notify = async (uids, data) => {
    const p = await pushes();
    await send(uids.filter(u => p[u] && p[u].token).map(u => ({ uid: u, token: p[u].token })), data);
  };
  await runCollector({ db, key: CYANIDE_KEY.value(), fetchImpl: fetch, notify, log: console.log });
});

