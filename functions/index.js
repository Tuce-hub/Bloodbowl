/**
 * Dugout — notifications des matchs en direct.
 * 1. Début d'un direct (création de /lives/{mid})
 * 2. Résultat (apparition de endedAt sur /lives/{mid})
 * 3. Message du tchat (/chats/{mid}/{msg})
 * Destinataires : /push/{uid} = { token, all, chat, me, naf, favs: { <coach normalisé>: true } }
 * Jamais de notification pour son propre match.
 */
const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");


initializeApp();
const DB = { instance: "horloge-bloodbowl-default-rtdb", region: "europe-west1" };

// Même normalisation que l'appli (favKey).
const favKey = n => String(n || "").trim().toLowerCase().replace(/[.#$\[\]\/]/g, "_").slice(0, 60);

/** Choisit les destinataires. kind : "live" (début/résultat) ou "chat". */
function pickTargets(pushes, live, exceptUid, kind) {
  const out = [];
  for (const [uid, p] of Object.entries(pushes || {})) {
    if (!p || !p.token || uid === exceptUid || uid === live.owner) continue;
    // Jamais de notification pour son propre match (diffuseur, ou coach reconnu par son nom ou son n° NAF).
    const a = favKey(live.coachA), b = favKey(live.coachB);
    if (p.me && (p.me === a || p.me === b)) continue;
    if (p.naf && (p.naf === String(live.nafA || "") || p.naf === String(live.nafB || ""))) continue;
    const favs = p.favs || {};
    const followed = !!p.all || !!favs[a] || !!favs[b];
    if (kind === "chat" && p.chat === false) continue;
    if (followed) out.push({ uid, token: p.token });
  }
  return out;
}

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

const pushes = async () => (await getDatabase().ref("push").once("value")).val() || {};
const vs = l => `${l.coachA} vs ${l.coachB}`;

exports.liveStart = onValueCreated({ ref: "/lives/{mid}", ...DB }, async e => {
  const l = e.data.val(); if (!l) return;
  await send(pickTargets(await pushes(), l, l.owner, "live"), {
    title: `🔴 ${vs(l)}`, body: `Match en direct${l.comp ? " · " + l.comp : ""} (${l.rosterA || "?"} – ${l.rosterB || "?"})`,
    url: `./#d-${e.params.mid}`, tag: `live-${e.params.mid}`
  });
});

exports.liveResult = onValueUpdated({ ref: "/lives/{mid}", ...DB }, async e => {
  const before = e.data.before.val() || {}, l = e.data.after.val();
  if (!l || before.endedAt || !l.endedAt) return;
  await send(pickTargets(await pushes(), l, l.owner, "live"), {
    title: `🏁 ${l.coachA} ${Number(l.tdA) || 0}–${Number(l.tdB) || 0} ${l.coachB}`,
    body: `Résultat${l.comp ? " · " + l.comp : ""} · Sorties ${Number(l.casA) || 0}–${Number(l.casB) || 0}`,
    url: `./#d-${e.params.mid}`, tag: `live-${e.params.mid}`
  });
});

exports.chatMessage = onValueCreated({ ref: "/chats/{mid}/{msg}", ...DB }, async e => {
  const m = e.data.val(); if (!m) return;
  const l = (await getDatabase().ref("lives/" + e.params.mid).once("value")).val(); if (!l) return;
  await send(pickTargets(await pushes(), l, m.uid, "chat"), {
    title: `💬 ${m.name} · ${vs(l)}`, body: String(m.text || "").slice(0, 160),
    url: `./#d-${e.params.mid}`, tag: `chat-${e.params.mid}`
  });
});

exports._pickTargets = pickTargets; // pour les tests
