/**
 * Dugout Blood Bowl — synchronisation avec Google Sheets et Google Drive (photos).
 *
 * Installation / mise à jour :
 * 1. Remplacez le code secret ci-dessous par le vôtre (le même que dans Dugout > Réglages).
 * 2. Enregistrez, choisissez la fonction « autoriser » dans la liste en haut, cliquez « Exécuter »
 *    et acceptez les autorisations (Sheets + Drive pour les photos).
 * 3. Déployer > Gérer les déploiements > crayon > Version : Nouvelle version > Déployer.
 *    (Première installation : Déployer > Nouveau déploiement > Application Web,
 *     Exécuter en tant que : Moi, Qui a accès : Tout le monde.)
 *
 * Dans l'onglet « Matchs » :
 * - Triez et filtrez avec les flèches de la ligne d'en-tête (ne triez pas en sélectionnant la ligne 1).
 * - Vous pouvez corriger une valeur à la main : l'appli la reprendra à la synchro suivante.
 * - Ne supprimez pas de colonnes et ne modifiez pas les colonnes masquées.
 */
const TOKEN = 'CHANGEZ-MOI';

const SHEET_NAME = 'Matchs';
const PHOTO_FOLDER = 'Dugout – Photos';
const FORMAT_VERSION = '5';
const COLS = [
  ['id', 'ID'],
  ['date', 'Date'],
  ['myRoster', 'Mon roster'],
  ['oppCoach', 'Coach adverse'],
  ['oppRoster', 'Roster adverse'],
  ['myTD', 'Mes TD'],
  ['oppTD', 'TD adverses'],
  ['myCas', 'Mes sorties'],
  ['oppCas', 'Sorties adverses'],
  ['result', 'Résultat'],
  ['minutes', 'Minutes par joueur'],
  ['usedMe', 'Mon temps utilisé (min)'],
  ['usedOpp', 'Temps adverse utilisé (min)'],
  ['deleted', 'Supprimé'],
  ['updatedAt', 'Modifié (technique)'],
  // Colonnes ajoutées ensuite : toujours à la fin, pour ne pas décaler les anciennes lignes.
  ['oppNaf', 'N° NAF adverse'],
  ['competition', 'Compétition'],
  ['photo', 'Photo'],
  ['note', 'Commentaires'],
];
const col = k => COLS.findIndex(c => c[0] === k) + 1;
const UPD_COL = col('updatedAt'), DEL_COL = col('deleted'), RES_COL = col('result'), PHOTO_COL = col('photo');
const HIDDEN = ['id', 'deleted', 'updatedAt'];
const NUM = ['myTD', 'oppTD', 'myCas', 'oppCas', 'minutes', 'updatedAt'];
const WIDTHS = { date: 130, myRoster: 140, oppCoach: 140, oppRoster: 140, competition: 170, photo: 260, note: 320 };

/* ------------------------------------------------------------------ API web */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return out({ ok: false, error: 'Code secret incorrect' });
  if (p.action === 'photo') return out(getPhoto(p.id));
  return out({ ok: true, matches: readAll() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'Requête illisible' }); }
  if (!body || body.token !== TOKEN) return out({ ok: false, error: 'Code secret incorrect' });
  if (body.action === 'photo') return out(savePhoto(body));
  if (body.action !== 'upsert' || !Array.isArray(body.matches)) return out({ ok: false, error: 'Action inconnue' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const toTrash = [];
  let written = 0;
  try {
    const sh = sheet();
    const last = sh.getLastRow();
    const index = {};
    if (last > 1) {
      const ids = sh.getRange(2, 1, last - 1, 1).getValues();
      const upd = sh.getRange(2, UPD_COL, last - 1, 1).getValues();
      ids.forEach((r, i) => { if (r[0]) index[String(r[0])] = { row: i + 2, updatedAt: Number(upd[i][0]) || 0 }; });
    }
    body.matches.forEach(m => {
      if (!m || !m.id) return;
      const known = index[m.id];
      if (known && known.updatedAt >= (Number(m.updatedAt) || 0)) return; // la version du tableur est déjà plus récente
      const previous = known ? sh.getRange(known.row, 1, 1, COLS.length).getValues()[0] : null;
      const res = toRow(m, previous);
      res.trash.forEach(id => toTrash.push(id));
      if (known) sh.getRange(known.row, 1, 1, COLS.length).setValues([res.row]);
      else { sh.appendRow(res.row); index[m.id] = { row: sh.getLastRow(), updatedAt: Number(m.updatedAt) || 0 }; }
      written++;
    });
    if (written) { try { ensureFilter(sh); } catch (err) { /* la mise en forme ne doit jamais bloquer la synchro */ } }
  } finally {
    lock.releaseLock();
  }
  toTrash.forEach(trashIfOurs);
  return out({ ok: true, written: written });
}

/* ------------------------------------------------------------------ Feuille */

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS.map(c => c[1])]).setFontWeight('bold');
  }
  // Met à jour la ligne d'en-tête si de nouvelles colonnes ont été ajoutées.
  const head = sh.getRange(1, 1, 1, COLS.length);
  const want = COLS.map(c => c[1]);
  if (head.getValues()[0].join('|') !== want.join('|')) head.setValues([want]).setFontWeight('bold');
  formatOnce(sh);
  return sh;
}

function formatOnce(sh) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('format') === FORMAT_VERSION) return;
  try {
    sh.setFrozenRows(1);
    sh.getRange(1, col('date'), sh.getMaxRows(), 1).setNumberFormat('dd/mm/yyyy hh:mm');
    Object.keys(WIDTHS).forEach(k => sh.setColumnWidth(col(k), WIDTHS[k]));
    HIDDEN.forEach(k => sh.hideColumns(col(k)));
    ensureFilter(sh);
    props.setProperty('format', FORMAT_VERSION);
  } catch (err) { /* réessayé à l'appel suivant */ }
}

// Filtre (flèches de tri) sur tout le tableau ; masque les matchs supprimés.
function ensureFilter(sh) {
  if (sh.getMaxRows() - sh.getLastRow() < 50) sh.insertRowsAfter(sh.getMaxRows(), 500);
  const rows = sh.getMaxRows();
  let f = sh.getFilter();
  if (f) {
    const r = f.getRange();
    if (r.getRow() === 1 && r.getColumn() === 1 && r.getNumRows() >= rows && r.getNumColumns() >= COLS.length) {
      hideDeleted(f);
      return;
    }
    const saved = {};
    for (let c = 1; c <= r.getNumColumns(); c++) {
      const cr = f.getColumnFilterCriteria(c);
      if (cr) saved[c] = cr;
    }
    f.remove();
    f = sh.getRange(1, 1, rows, COLS.length).createFilter();
    Object.keys(saved).forEach(c => { if (Number(c) <= COLS.length) f.setColumnFilterCriteria(Number(c), saved[c]); });
  } else {
    f = sh.getRange(1, 1, rows, COLS.length).createFilter();
  }
  hideDeleted(f);
}

function hideDeleted(f) {
  const letter = String.fromCharCode(64 + DEL_COL);
  f.setColumnFilterCriteria(DEL_COL, SpreadsheetApp.newFilterCriteria().whenFormulaSatisfied('=NOT($' + letter + '2)').build());
}

// Corrections faites à la main dans le tableau : marquées comme récentes pour que l'appli les reprenne.
function onEdit(e) {
  try {
    const r = e.range, sh = r.getSheet();
    if (sh.getName() !== SHEET_NAME) return;
    const c0 = r.getColumn(), c1 = c0 + r.getNumColumns() - 1;
    if (c0 === UPD_COL && c1 === UPD_COL) return;
    const r0 = Math.max(2, r.getRow()), r1 = r.getRow() + r.getNumRows() - 1;
    if (r1 < r0) return;
    const n = r1 - r0 + 1;
    const data = sh.getRange(r0, 1, n, COLS.length).getValues();
    const now = Date.now();
    const upd = [], res = [];
    data.forEach(row => {
      const has = !!row[0];
      const a = Number(row[col('myTD') - 1]) || 0, b = Number(row[col('oppTD') - 1]) || 0;
      upd.push([has ? now : row[UPD_COL - 1]]);
      res.push([has ? (a > b ? 'V' : a < b ? 'D' : 'N') : row[RES_COL - 1]]);
    });
    sh.getRange(r0, UPD_COL, n, 1).setValues(upd);
    sh.getRange(r0, RES_COL, n, 1).setValues(res);
  } catch (err) { /* ne jamais gêner la saisie */ }
}

function toRow(m, previous) {
  const deleted = !!m.deleted;
  // Une suppression ne renvoie que l'id : on garde les infos du match pour la lisibilité du tableur.
  const base = {};
  if (previous) COLS.forEach((c, i) => { base[c[0]] = previous[i]; });
  const src = deleted ? Object.assign({}, base, m) : m;
  const myTD = Number(src.myTD) || 0, oppTD = Number(src.oppTD) || 0;

  const prevPhoto = previous ? fileIdFrom(previous[PHOTO_COL - 1]) : '';
  let photoId;
  if (deleted) photoId = '';
  else if (typeof m.photoId === 'string') photoId = m.photoId;
  else photoId = prevPhoto; // appareil pas encore à jour : on ne touche pas à la photo
  const trash = [];
  if (deleted && prevPhoto) trash.push(prevPhoto);
  if (m.removePhotoId && m.removePhotoId !== photoId) trash.push(m.removePhotoId);

  const v = {
    id: m.id,
    date: src.date ? new Date(src.date) : '',
    myRoster: src.myRoster || '',
    oppCoach: src.oppCoach || '',
    oppRoster: src.oppRoster || '',
    myTD: myTD, oppTD: oppTD,
    myCas: Number(src.myCas) || 0, oppCas: Number(src.oppCas) || 0,
    result: myTD > oppTD ? 'V' : myTD < oppTD ? 'D' : 'N',
    minutes: Number(src.minutes) || '',
    usedMe: typeof m.usedMe === 'number' ? Math.round(m.usedMe / 6000) / 10 : (src.usedMe || ''),
    usedOpp: typeof m.usedOpp === 'number' ? Math.round(m.usedOpp / 6000) / 10 : (src.usedOpp || ''),
    deleted: deleted,
    updatedAt: Number(m.updatedAt) || Date.now(),
    oppNaf: src.oppNaf ? String(src.oppNaf) : '',
    competition: src.competition || '',
    photo: photoId ? photoUrl(photoId) : '',
    note: src.note || '',
  };
  return { row: COLS.map(c => v[c[0]]), trash: trash };
}

function readAll() {
  const sh = sheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  return rows.filter(r => r[0]).map(r => {
    const m = {};
    COLS.forEach((c, i) => { m[c[0]] = r[i]; });
    m.id = String(m.id);
    m.date = m.date instanceof Date ? m.date.toISOString() : String(m.date || '');
    NUM.forEach(k => { m[k] = Number(m[k]) || 0; });
    m.usedMe = m.usedMe === '' ? 0 : Math.round(Number(m.usedMe) * 60000);
    m.usedOpp = m.usedOpp === '' ? 0 : Math.round(Number(m.usedOpp) * 60000);
    m.deleted = m.deleted === true || m.deleted === 'TRUE';
    m.oppNaf = m.oppNaf === '' || m.oppNaf == null ? '' : String(m.oppNaf);
    m.competition = String(m.competition || '');
    m.photoId = fileIdFrom(m.photo);
    m.note = String(m.note || '');
    m.myRoster = String(m.myRoster || ''); m.oppCoach = String(m.oppCoach || ''); m.oppRoster = String(m.oppRoster || '');
    delete m.photo;
    delete m.result;
    return m;
  });
}

/* ------------------------------------------------------------------ Photos (Drive) */

function savePhoto(b) {
  if (!b.data || typeof b.data !== 'string') return { ok: false, error: 'Photo vide' };
  if (b.data.length > 8 * 1024 * 1024) return { ok: false, error: 'Photo trop lourde' };
  const mime = /^image\/(jpeg|png|webp)$/.test(b.mime || '') ? b.mime : 'image/jpeg';
  const name = String(b.name || ('Match ' + (b.matchId || ''))).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
  const blob = Utilities.newBlob(Utilities.base64Decode(b.data), mime, name);
  const file = photoFolder().createFile(blob);
  if (b.replaces && b.replaces !== file.getId()) trashIfOurs(b.replaces);
  return { ok: true, fileId: file.getId() };
}

function getPhoto(id) {
  if (!id) return { ok: false, error: 'Photo introuvable' };
  let file;
  try { file = DriveApp.getFileById(id); } catch (err) { return { ok: false, error: 'Photo introuvable' }; }
  if (!inFolder(file) || file.isTrashed()) return { ok: false, error: 'Photo introuvable' };
  const blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function photoFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('photoFolderId');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* recréé ci-dessous */ }
  }
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  props.setProperty('photoFolderId', f.getId());
  return f;
}

function inFolder(file) {
  const fid = photoFolder().getId();
  const it = file.getParents();
  while (it.hasNext()) if (it.next().getId() === fid) return true;
  return false;
}

// Ne met à la corbeille que des fichiers du dossier Dugout (récupérables 30 jours).
function trashIfOurs(id) {
  try { const f = DriveApp.getFileById(id); if (inFolder(f)) f.setTrashed(true); } catch (err) { /* déjà supprimé */ }
}

function fileIdFrom(v) {
  const m = String(v || '').match(/\/d\/([\w-]{10,})/);
  return m ? m[1] : '';
}
const photoUrl = id => 'https://drive.google.com/file/d/' + id + '/view';

/* ------------------------------------------------------------------ Divers */

// À exécuter une fois depuis l'éditeur pour accorder les autorisations et mettre en forme le tableau.
function autoriser() {
  photoFolder();
  PropertiesService.getScriptProperties().deleteProperty('format');
  sheet();
  Logger.log('Autorisations OK. Dossier photos : ' + PHOTO_FOLDER);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
