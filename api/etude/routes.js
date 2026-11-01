/* Étude d'AO — routes de l'API MP.
 *   GET  /api/etudes?veilleId=…        études de l'AO (versions), courante complète, coffre, fiche
 *   POST /api/etude-lancer             { veilleId, type: 'complete'|'pre' } → prépare le DCE et soumet le lot
 *   GET  /api/etudes-tick              avance les études en cours + pré-études automatiques (sans entrée, anonyme)
 *   GET  /api/etude-fichier?id=&quoi=  pièce générée (xlsx, docx, pdf, zip)
 *   POST /api/etude-valider            { etudeId, veilleId, quoi: 'moyens_humains'|'references', choix: [...] }
 *   GET/POST /api/etude-params         seuil de pré-étude, plafonds, consommation du mois
 *   GET/POST /api/coffre               documents de la société (liste ; dépôt ou nouvelle version)
 *   GET  /api/coffre-lien?id=&v=       lien de lecture à durée courte (10 min)
 *
 * Exécution asynchrone : lot Anthropic soumis, relevé au tick. Le front n'a AUCUN délai d'attente
 * plus court que le job : il relit l'état tant qu'il est « en cours » (erreur du 07/09 évitée).
 */
"use strict";
const { BlobServiceClient, BlobSASPermissions } = require("@azure/storage-blob");
const MPEtude = require("../etude-calc.js");
const DCE = require("./dce.js");
const CL = require("./claude.js");
const SO = require("./sorties.js");

const C_ETUDES = "mp_etudes_ao";        // PK /veilleId
const C_COFFRE = "mp_coffre_docs";      // PK /id
const C_CONFIG = "mp_config";           // PK /id
const B_DCE = "dce-zips";
const B_ETUDES = "mp-etudes";
const B_COFFRE = "mp-coffre";
const COFFRE_MAX_OCTETS = 15 * 1024 * 1024;
const TYPES_FICHIER = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };

const PARAMS_DEFAUT = { id: "etude_params", seuil_pre_etude: 50, pre_etude_active: true, plafond_etude_usd: 3, plafond_mois_usd: 40,
  modele: CL.MODELE_DEFAUT, marge_defaut: 0.3, pre_etude_depuis: null };

function blobSvc() {
  const conn = process.env.STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("STORAGE_CONNECTION_STRING non configuré côté serveur");
  return BlobServiceClient.fromConnectionString(conn);
}
async function conteneurBlob(nom) { const c = blobSvc().getContainerClient(nom); await c.createIfNotExists(); return c; }
const maintenantISO = () => new Date().toISOString();
const moisCourant = () => new Date().toISOString().slice(0, 7);

async function lireParams(db) {
  try { const r = (await db.container(C_CONFIG).item("etude_params", "etude_params").read()).resource; return Object.assign({}, PARAMS_DEFAUT, r || {}); }
  catch (e) { return Object.assign({}, PARAMS_DEFAUT); }
}
async function consoMois(db, mois) {
  const r = await db.container(C_ETUDES).items.query({ query: "SELECT VALUE SUM(c.cout_usd) FROM c WHERE c.type_doc = 'etude' AND STARTSWITH(c.soumise_le, @m)", parameters: [{ name: "@m", value: mois }] }).fetchAll();
  return r.resources[0] || 0;
}
async function lireVeille(db, veilleId) {
  const r = await db.container("mp_veille_ao").items.query({ query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: veilleId }] }).fetchAll();
  return r.resources[0] || null;
}
async function lireFiche(db, veille) {
  if (!veille) return null;
  const q = veille.ao_id_lie ? { query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: veille.ao_id_lie }] }
    : { query: "SELECT * FROM c WHERE c.veille_id = @v", parameters: [{ name: "@v", value: veille.id }] };
  const r = await db.container("mp_aos").items.query(q).fetchAll();
  return r.resources[0] || null;
}
async function etudesDe(db, veilleId) {
  const r = await db.container(C_ETUDES).items.query({ query: "SELECT * FROM c WHERE c.veilleId = @v AND c.type_doc = 'etude' ORDER BY c.version DESC", parameters: [{ name: "@v", value: veilleId }] }).fetchAll();
  return r.resources;
}
async function lireCoffre(db) {
  const r = await db.container(C_COFFRE).items.query("SELECT * FROM c").fetchAll();
  return r.resources.map((d) => { const o = Object.assign({}, d); Object.keys(o).forEach((k) => { if (k.charAt(0) === "_") delete o[k]; }); return o; });
}
function rendu(doc) { const o = Object.assign({}, doc); Object.keys(o).forEach((k) => { if (k.charAt(0) === "_") delete o[k]; }); return o; }

/* ---------- Préparation : DCE → fichiers classés + textes (copie privée pour l'étude) ---------- */
async function preparer(db, etude, veille) {
  const zipC = blobSvc().getContainerClient(B_DCE);
  let zip;
  try { zip = await zipC.getBlobClient(veille.dce_blob_name).downloadToBuffer(); }
  catch (e) { throw new Error("DCE introuvable dans le stockage (" + veille.dce_blob_name + ") : il est effacé 30 jours après son téléchargement, relancer le téléchargement du DCE."); }
  const dep = DCE.deplier(zip);
  const docs = await DCE.lireFichiers(dep.fichiers);
  const cont = await conteneurBlob(B_ETUDES);
  // Copie privée des fichiers étudiés et de leurs textes : le zip du DCE s'efface au bout de 30 jours.
  const base = etude.id + "/";
  for (const d of docs) await cont.getBlockBlobClient(base + "dce/" + d.fichier).uploadData(d.octets);
  const textes = docs.map((d) => ({ fichier: d.fichier, classe: d.classe, lecture: d.lecture, texte: d.texte, pages: d.pages, feuilles: d.feuilles || null }));
  await cont.getBlockBlobClient(base + "textes.json").uploadData(Buffer.from(JSON.stringify(textes)), { blobHTTPHeaders: { blobContentType: "application/json" } });
  etude.dce = {
    blob: veille.dce_blob_name, telecharge_le: veille.dce_uploaded_at || null, taille: veille.dce_size_bytes || zip.length,
    fichiers: docs.map((d) => ({ fichier: d.fichier, classe: d.classe, motif_classe: d.motif_classe, format: d.format, taille: d.taille,
      lecture: d.lecture, motif_lecture: d.motif_lecture, pages_total: d.pages_total, pages_scannees: d.pages_scannees.length, caracteres: d.texte.length })),
    ecartes: dep.ecartes
  };
  return docs;
}
async function lireTextes(etude) {
  const cont = blobSvc().getContainerClient(B_ETUDES);
  const buf = await cont.getBlobClient(etude.id + "/textes.json").downloadToBuffer();
  return JSON.parse(buf.toString("utf8"));
}
async function ecrireTextes(etude, textes) {
  const cont = blobSvc().getContainerClient(B_ETUDES);
  await cont.getBlockBlobClient(etude.id + "/textes.json").uploadData(Buffer.from(JSON.stringify(textes)), { blobHTTPHeaders: { blobContentType: "application/json" } });
}
function articlesTableur(textes) {
  let best = null;
  for (const t of textes) {
    if (t.classe !== "bordereau" || !t.feuilles) continue;
    const l = MPEtude.choisirFeuilles(MPEtude.lireBordereauFeuilles(t.fichier, t.feuilles));
    if (!best || l.articles.length > best.articles.length) best = Object.assign({ fichier: t.fichier }, l);
  }
  return best;
}
function majStatut(etude, statut, libelle) {
  etude.statut = statut; etude.statut_libelle = libelle; etude.maj_le = maintenantISO();
  etude.journal = (etude.journal || []).concat([{ le: etude.maj_le, statut, libelle }]).slice(-40);
}

/* Soumet le lot d'analyse (ou d'OCR s'il reste des pages numérisées). Contrôle les plafonds avant tout envoi. */
async function soumettreAnalyse(db, etude, textes, params) {
  const docsEnv = textes.map((t) => Object.assign({ origine: "dce" }, t));
  const bord = articlesTableur(textes);
  etude.bordereau_tableur = bord ? { fichier: bord.fichier, feuilles: bord.feuilles, exclues: bord.exclues, articles: bord.articles.length } : null;
  const { requetes, documents } = CL.requetesEtude(docsEnv, etude.type, { modele: params.modele, typeAo: etude.type_ao, articles: bord ? bord.articles : [] });
  const est = MPEtude.estimerCout(CL.caracteresEnvoyes(requetes), CL.sortieMax(requetes), params.modele, true);
  const pl = MPEtude.controlePlafonds(est + (etude.cout_usd || 0), await consoMois(db, moisCourant()) - (etude.cout_usd || 0), params);
  etude.estimation_usd = est;
  if (!pl.ok) { majStatut(etude, "refusee", "Non envoyée : " + pl.motif); return; }
  etude.documents_envoyes = documents.map((d) => ({ fichier: d.fichier, classe: d.classe, lecture: d.lecture, caracteres: d.texte.length }));
  const lot = await CL.soumettre(requetes);
  etude.lots = (etude.lots || []).concat([{ phase: "analyse", id: lot.id, soumis_le: maintenantISO(), requetes: requetes.map((r) => r.custom_id) }]);
  if (!etude.soumise_le) etude.soumise_le = maintenantISO();
  majStatut(etude, "analyse_en_cours", "Analyse envoyée (" + requetes.length + " requête(s), " + pl.motif + ") : en file chez Anthropic");
}
async function soumettreOcr(db, etude, docs, params) {
  const aOcr = docs.map((d, i) => ({ d, i })).filter((x) => x.d.lecture === "ocr");
  const requetes = aOcr.map((x) => CL.requeteOcr(Object.assign({ origine: "dce" }, x.d), x.i, params.modele));
  const est = MPEtude.estimerCout(CL.caracteresEnvoyes(requetes), CL.sortieMax(requetes), params.modele, true);
  const pl = MPEtude.controlePlafonds(est, await consoMois(db, moisCourant()), params);
  if (!pl.ok) { majStatut(etude, "refusee", "OCR non envoyé : " + pl.motif); return; }
  const lot = await CL.soumettre(requetes);
  etude.lots = (etude.lots || []).concat([{ phase: "ocr", id: lot.id, soumis_le: maintenantISO(), requetes: requetes.map((r) => r.custom_id) }]);
  etude.soumise_le = etude.soumise_le || maintenantISO();
  majStatut(etude, "ocr_en_cours", aOcr.length + " fichier(s) numérisé(s) envoyés en lecture OCR : en file chez Anthropic");
}

async function lancer(db, veille, type, par, params) {
  const anciennes = await etudesDe(db, veille.id);
  const version = (anciennes[0] ? anciennes[0].version : 0) + 1;
  const fiche = await lireFiche(db, veille);
  const etude = {
    id: "etude_" + veille.id + "_v" + version, veilleId: veille.id, type_doc: "etude", version, type,
    aoId: fiche ? fiche.id : null, ref: (fiche && fiche.ref) || veille.reference_ao || null, objet: (fiche && fiche.objet) || veille.objet || null,
    moa: (fiche && fiche.maitre_ouvrage) || veille.acheteur || null, type_ao: (fiche && fiche.type) || String(veille.categorie || "").toLowerCase() || null,
    cree_le: maintenantISO(), cree_par: par, statut: "preparation", statut_libelle: "Préparation du DCE", modele: params.modele, cout_usd: 0, usage: {}, journal: []
  };
  majStatut(etude, "preparation", "Préparation du DCE (dépliage, classement, lecture des fichiers)");
  const C = db.container(C_ETUDES);
  await C.items.create(etude);
  try {
    const docs = await preparer(db, etude, veille);
    if (docs.some((d) => d.lecture === "ocr")) await soumettreOcr(db, etude, docs, params);
    else await soumettreAnalyse(db, etude, docs.map((d) => ({ fichier: d.fichier, classe: d.classe, lecture: d.lecture, texte: d.texte, pages: d.pages, feuilles: d.feuilles || null })), params);
  } catch (e) {
    majStatut(etude, "echec", "Échec : " + e.message);
  }
  await C.items.upsert(etude);
  return etude;
}

/* ---------- Relevé d'un lot terminé ---------- */
function cumulerUsage(etude, usage) {
  const u = etude.usage || {};
  ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].forEach((k) => { u[k] = (u[k] || 0) + (usage[k] || 0); });
  u.cache_creation = u.cache_creation || {};
  const cc = usage.cache_creation || {};
  ["ephemeral_5m_input_tokens", "ephemeral_1h_input_tokens"].forEach((k) => { u.cache_creation[k] = (u.cache_creation[k] || 0) + (cc[k] || 0); });
  etude.usage = u;
  etude.cout_usd = Math.round(((etude.cout_usd || 0) + (MPEtude.coutUsd(usage, etude.modele, true) || 0)) * 10000) / 10000;
}
function texteOcrEnPages(texte) {
  const morceaux = String(texte || "").split(/=== Page \d+ ===/).slice(1);
  return morceaux.length ? morceaux : [String(texte || "")];
}
async function catalogueAchats(db) {
  const erp = db.client.database("erp-db");
  const out = [];
  try {
    const a = await erp.container("gc_articles").items.query("SELECT c.designation, c.reference, c.prix_achat_moyen FROM c WHERE c.prix_achat_moyen > 0").fetchAll();
    a.resources.forEach((x) => out.push({ designation: [x.designation, x.reference].filter(Boolean).join(" "), pa: x.prix_achat_moyen, origine: "conditions d'achat (article " + (x.reference || x.designation) + ")" }));
  } catch (e) { /* ERP indisponible : les articles restent « à consulter » */ }
  try {
    const b = await erp.container("gc_bons_commande").items.query("SELECT c.numero, c.date_commande, c.reference_marche, c.lignes FROM c").fetchAll();
    b.resources.forEach((bc) => (bc.lignes || []).forEach((l) => { if (l.pu_ht > 0) out.push({ designation: [l.designation, l.reference_article].filter(Boolean).join(" "), pa: Math.round(l.pu_ht * (1 - (l.remise_pct || 0) / 100) * 100) / 100, origine: "bon de commande " + (bc.numero || "") + (bc.reference_marche ? " (marché " + bc.reference_marche + ")" : "") + (bc.date_commande ? " du " + MPEtude.dateFR(String(bc.date_commande).slice(0, 10)) : "") }); }));
  } catch (e) { /* idem */ }
  return out;
}
async function finaliser(db, etude, params) {
  const lot = etude.lots[etude.lots.length - 1];
  const res = await CL.resultatsLot(lot.id);
  lot.fini_le = maintenantISO();
  const textes = await lireTextes(etude);
  const erreurs = [];
  Object.keys(res).forEach((k) => { const r = res[k]; if (r.type === "succeeded") cumulerUsage(etude, r.message.usage || {}); else erreurs.push(k + " : " + r.type + (r.error && r.error.error ? " (" + r.error.error.message + ")" : "")); });
  if (lot.phase === "ocr") {
    Object.keys(res).forEach((k) => {
      const r = res[k]; if (r.type !== "succeeded") return;
      const i = parseInt(k.replace("ocr_", ""), 10);
      const txt = r.message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const tp = DCE.avecPages(texteOcrEnPages(txt));
      textes[i].texte = tp.texte; textes[i].pages = tp.pages; textes[i].lecture = "ocr";
      const f = (etude.dce.fichiers || [])[i]; if (f) { f.lecture = "ocr"; f.motif_lecture = "lu par OCR (transcription des pages numérisées)"; f.caracteres = tp.texte.length; }
    });
    textes.forEach((t, i) => { if (t.lecture === "ocr" && !res["ocr_" + i]) { t.lecture = "non_lu"; } });
    await ecrireTextes(etude, textes);
    if (erreurs.length) etude.erreurs = erreurs;
    await soumettreAnalyse(db, etude, textes, params);
    return;
  }
  // Documents tels qu'envoyés (même ordre) : les citations renvoient à leur index.
  const env = CL.documentsEtudies(textes.map((t) => Object.assign({ origine: "dce" }, t)), etude.type === "pre");
  const docsMeta = env.map((d) => ({ fichier: d.fichier, titre: d.fichier, classe: d.classe, pages: d.pages, texte: d.texte }));
  const lignesDe = (k) => (res[k] && res[k].type === "succeeded" ? MPEtude.lireLignes(res[k].message.content, docsMeta) : []);
  const r = MPEtude.construireResultat(lignesDe("analyse"));
  const mem = MPEtude.construireResultat(lignesDe("memoire"), { clauses: false });
  r.memoire = mem.memoire;
  // Bordereau : tableur du DCE (source = feuille et ligne), sinon articles relevés par l'analyse (citations).
  let articles;
  const bord = articlesTableur(textes);
  if (bord && bord.articles.length) articles = bord.articles;
  else articles = MPEtude.construireResultat(lignesDe("bordereau"), { clauses: false }).articles.map((a, i) => Object.assign({ section: null }, a, { num: a.num || String(i + 1) }));
  const cat = await catalogueAchats(db);
  articles.forEach((a) => {
    const m = MPEtude.chercherPA(a.designation, cat);
    a.pa = m ? m.pa : null; a.pa_origine = m ? m.origine + " — « " + m.designation + " » (similarité " + m.score + ")" : null; a.marge = params.marge_defaut;
  });
  const conf = MPEtude.construireResultat(lignesDe("conformite"), { clauses: false }).conformite;
  const desig = {}; articles.forEach((a) => { desig[String(a.num)] = a.designation; });
  conf.forEach((c) => { c.designation = desig[String(c.num)] || ""; });
  r.conformite = conf;
  r.bordereau = { articles, origine: bord && bord.articles.length ? "tableur" : "analyse", fichier: bord ? bord.fichier : null,
    feuilles: bord ? bord.feuilles : [], exclues: bord ? bord.exclues : [], catalogue: cat.length };
  delete r.articles;
  etude.resultat = r;
  if (erreurs.length) etude.erreurs = erreurs;
  etude.terminee_le = maintenantISO();
  etude.duree_s = Math.round((Date.parse(etude.terminee_le) - Date.parse(etude.cree_le)) / 1000);
  majStatut(etude, erreurs.length && !res.analyse ? "echec" : "prete",
    (erreurs.length ? "Terminée avec " + erreurs.length + " requête(s) en échec : " + erreurs.join(" ; ") : "Étude prête") + " — coût " + etude.cout_usd.toFixed(2) + " USD");
}

async function avancer(db, etude, params) {
  const lot = (etude.lots || [])[(etude.lots || []).length - 1];
  if (!lot) return false;
  const e = await CL.etatLot(lot.id);
  lot.compte = e.compte;
  if (e.statut !== "ended") {
    const min = Math.round((Date.now() - Date.parse(lot.soumis_le)) / 60000);
    etude.statut_libelle = (lot.phase === "ocr" ? "Lecture OCR" : "Analyse") + " en file chez Anthropic depuis " + min + " min (" + (e.compte ? e.compte.succeeded + " sur " + (e.compte.processing + e.compte.succeeded + e.compte.errored + e.compte.canceled + e.compte.expired) + " terminée(s)" : "") + ")";
    etude.maj_le = maintenantISO();
    return true;
  }
  await finaliser(db, etude, params);
  return true;
}

async function tick(db, context) {
  const cfg = db.container(C_CONFIG);
  // Anti-rafale : un tick toutes les 20 s au plus (la route est anonyme et sans entrée).
  let verrou = null;
  try { verrou = (await cfg.item("etude_tick", "etude_tick").read()).resource; } catch (e) { verrou = null; }
  if (verrou && Date.now() - Date.parse(verrou.le) < 20000) return { ok: true, saute: "tick récent" };
  try {
    if (verrou) await cfg.item("etude_tick", "etude_tick").replace({ id: "etude_tick", le: maintenantISO() }, { accessCondition: { type: "IfMatch", condition: verrou._etag } });
    else await cfg.items.create({ id: "etude_tick", le: maintenantISO() });
  } catch (e) { return { ok: true, saute: "tick concurrent" }; }
  const params = await lireParams(db);
  const C = db.container(C_ETUDES);
  const enCours = (await C.items.query("SELECT * FROM c WHERE c.type_doc = 'etude' AND c.statut IN ('ocr_en_cours','analyse_en_cours','preparation')").fetchAll()).resources;
  const bilan = { en_cours: enCours.length, avancees: 0, terminees: 0, pre_lancees: [], pre_ecartees: [] };
  for (const et of enCours) {
    try {
      if (et.statut === "preparation") {
        // Préparation coupée (délai de la requête) : reprise, 3 essais au plus.
        if (Date.now() - Date.parse(et.maj_le) < 180000) continue;
        et.essais_preparation = (et.essais_preparation || 0) + 1;
        if (et.essais_preparation > 3) { majStatut(et, "echec", "Échec : préparation du DCE interrompue 3 fois (DCE trop lourd ?)"); await C.items.upsert(et); continue; }
        const veille = await lireVeille(db, et.veilleId);
        const docs = await preparer(db, et, veille);
        if (docs.some((d) => d.lecture === "ocr")) await soumettreOcr(db, et, docs, params);
        else await soumettreAnalyse(db, et, docs.map((d) => ({ fichier: d.fichier, classe: d.classe, lecture: d.lecture, texte: d.texte, pages: d.pages, feuilles: d.feuilles || null })), params);
      } else {
        await avancer(db, et, params);
      }
      if (et.statut === "prete") bilan.terminees++;
      bilan.avancees++;
      await C.items.upsert(et);
    } catch (e) {
      context.log.error("etude tick " + et.id + " : " + e.message);
    }
  }
  // Pré-études automatiques : DCE prêt, score au-dessus du seuil, pas encore étudié sur CE DCE.
  if (params.pre_etude_active !== false && CL.client()) {
    const depuis = params.pre_etude_depuis || "2026-11-01T00:00:00Z";
    const cands = (await db.container("mp_veille_ao").items.query({ query: "SELECT * FROM c WHERE c.dce_status = 'ready' AND c.dce_uploaded_at >= @d", parameters: [{ name: "@d", value: depuis }] }).fetchAll()).resources;
    for (const v of cands.slice(0, 20)) {
      const deja = (await etudesDe(db, v.id)).some((e) => e.statut !== "echec" && e.statut !== "refusee" && (!e.dce || e.dce.blob === v.dce_blob_name));
      const el = MPEtude.eligiblePreEtude(v, params, deja);
      if (!el.ok) { bilan.pre_ecartees.push({ ref: v.reference_ao || "AO sans référence", motif: el.motif }); continue; }
      if (bilan.pre_lancees.length >= 2) { bilan.pre_ecartees.push({ ref: v.reference_ao, motif: "reporté au tick suivant (2 par tick)" }); continue; }
      const e = await lancer(db, v, "pre", "pré-étude automatique", params);
      bilan.pre_lancees.push({ ref: v.reference_ao, statut: e.statut, libelle: e.statut_libelle });
    }
  }
  return Object.assign({ ok: true }, bilan);
}

/* ---------- Pièces générées ---------- */
async function societe(db) {
  try {
    const r = (await db.client.database("erp-db").container("gc_config").items.query("SELECT * FROM c WHERE c.id = 'societe_emettrice'").fetchAll()).resources;
    const s = r.find((x) => x.type === "societe_emettrice") || r[0] || {};
    const o = {}; ["raison_sociale", "forme_juridique", "capital_social", "ice", "if", "rc", "ville_rc", "patente", "cnss", "adresse", "cp", "ville", "tel", "email", "banque", "rib"].forEach((k) => { o[k] = s[k]; });
    return o;
  } catch (e) { return {}; }
}
async function outillage(db) {
  try { return (await db.client.database("erp-db").container("gc_outillage").items.query("SELECT c.categorie, c.designation, c.marque, c.modele, c.etat FROM c WHERE NOT IS_DEFINED(c.etat) OR c.etat != 'rebut'").fetchAll()).resources; }
  catch (e) { return []; }
}
/* Personnel actif depuis RH, en LECTURE et limité au nom et à la fonction (rien d'autre n'est lu). */
async function personnel(db) {
  const r = await db.container("rh_personnel").items.query("SELECT c.id, c.nom, c.prenom, c.poste FROM c WHERE c.statut = 'actif'").fetchAll();
  return r.resources.map((x) => ({ id: x.id, nom: [x.prenom, x.nom].filter(Boolean).join(" ") || "nom non renseigné", poste: x.poste || "fonction non renseignée" }));
}
async function marchesProches(db, objet) {
  const r = (await db.container("mp_marches").items.query("SELECT c.id, c.ref, c.titre, c.objet, c.maitre_ouvrage, c.montant, c.statut FROM c").fetchAll()).resources;
  return r.map((m) => Object.assign(m, { score: Math.round(MPEtude.similarite(objet, m.objet || m.titre) * 100) / 100 }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
}
function semainesDe(texte) {
  const t = MPEtude.sansAccents(texte);
  const m = t.match(/(\d+)\s*(?:\(\s*\w+\s*\)\s*)?(mois|semaines?|jours?)/);
  if (!m) return { semaines: 12, texte: "délai non lu : 12 semaines par défaut" };
  const n = parseInt(m[1], 10);
  return { semaines: m[2] === "mois" ? Math.round(n * 4.33) : (m[2].indexOf("semaine") === 0 ? n : Math.ceil(n / 7)), texte: m[0] };
}
async function contextePieces(db, etude) {
  const veille = await lireVeille(db, etude.veilleId);
  const fiche = await lireFiche(db, veille);
  const r = etude.resultat || {};
  const arts = (r.bordereau && r.bordereau.articles) || [];
  const faits = r.faits || {};
  const est = fiche && fiche.budget_estime != null ? fiche.budget_estime : (veille && veille.estimation_mo);
  const valid = etude.validations || {};
  const coffre = await lireCoffre(db);
  const refs = valid.references ? valid.references.choix : (await marchesProches(db, etude.objet || ""));
  refs.forEach((m) => { const a = coffre.find((d) => d.type === "attestation_reference" && d.marche_ref && m.ref && MPEtude.sansAccents(d.marche_ref) === MPEtude.sansAccents(m.ref)); m.attestation = a ? "dans le coffre" : "absente du coffre"; });
  const modeles = ((etude.dce && etude.dce.fichiers) || []).filter((f) => f.classe === "modele").map((f) => f.fichier.split("/").pop());
  const sd = (r.sous_detail || []).map((x) => x.num);
  const lourds = arts.filter((a) => a.pa != null).sort((a, b) => b.pa * b.quantite - a.pa * a.quantite).slice(0, 10).map((a) => a.num);
  return {
    ref: etude.ref, objet: etude.objet, moa: etude.moa, societe: await societe(db), estimation: MPEtude.nombre(est), tva: 0.2,
    articles: arts, totaux: MPEtude.totauxBordereau(arts, est), memoire: r.memoire || [], conformite: r.conformite || [],
    sousDetail: sd.length ? sd : lourds, sousDetailMotif: sd.length ? "Articles demandés par le RC." : "Le RC ne désigne pas d'articles : les 10 articles les plus lourds (PA × quantité) sont proposés.",
    modeleDce: modeles.join(", "), outillage: await outillage(db), personnel: valid.moyens_humains ? valid.moyens_humains.choix : [],
    personnelValide: !!valid.moyens_humains, references: refs, referencesValidees: !!valid.references,
    banque: (fiche && fiche.caution_prov && fiche.caution_prov.banque) || null, cautionMontant: MPEtude.nombre(faits.caution_provisoire && faits.caution_provisoire.valeur) || (fiche && fiche.caution_prov && fiche.caution_prov.montant) || null,
    dateLimite: fiche && fiche.date_limite ? MPEtude.dateFR(fiche.date_limite) + (fiche.heure_limite ? " à " + fiche.heure_limite : "") : (faits.date_limite ? faits.date_limite.valeur : null),
    delai: semainesDe(faits.delai_execution ? faits.delai_execution.valeur : ""), resultat: r, version: etude.version, type: etude.type,
    etudeLe: (etude.terminee_le || etude.cree_le || "").slice(0, 10), dceLe: ((etude.dce && etude.dce.telecharge_le) || "").slice(0, 10),
    ecarts: MPEtude.ecartsFiche(faits, { date_limite: fiche ? fiche.date_limite : (veille && veille.date_limite), heure_limite: fiche ? fiche.heure_limite : (veille && veille.heure_limite), estimation: est }),
    eclaircissements: MPEtude.dateEclaircissements(fiche ? fiche.date_limite : (veille && veille.date_limite), faits.eclaircissements && faits.eclaircissements.valeur),
    coffre, fiche, veille
  };
}
const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", zip: "application/zip" };
const PIECES = {
  bordereau: { nom: "Bordereau des prix - detail estimatif.xlsx", dossier: "FINANCIER", gen: async (c) => (await SO.bordereauXlsx(c)).buffer },
  etude: { nom: "Etude AO.docx", dossier: null, gen: (c) => SO.etudeWord(c) },
  declaration_honneur: { nom: "Declaration sur l'honneur.docx", dossier: "ADMINISTRATIF", gen: (c) => SO.declarationHonneur(c) },
  acte_engagement: { nom: "Acte d'engagement.docx", dossier: "FINANCIER", gen: (c) => SO.acteEngagement(c) },
  memoire: { nom: "Note methodologique.docx", dossier: "TECHNIQUE", gen: (c) => SO.memoireWord(c) },
  planning: { nom: "Planning d'execution.pdf", dossier: "TECHNIQUE", gen: async (c) => (await SO.ganttPdf({ ref: c.ref, articles: c.articles, semaines: c.delai.semaines, delaiTexte: c.delai.texte })).buffer },
  moyens_materiels: { nom: "Moyens materiels.docx", dossier: "TECHNIQUE", gen: (c) => SO.moyensMateriels(c) },
  moyens_humains: { nom: "Moyens humains.docx", dossier: "TECHNIQUE", gen: (c) => SO.moyensHumains(c) },
  conformite: { nom: "Tableau de conformite.docx", dossier: "TECHNIQUE", gen: (c) => SO.conformiteWord(c) },
  bordereau_references: { nom: "Bordereau des marques et references.docx", dossier: "TECHNIQUE", gen: (c) => SO.bordereauReferencesWord(c) },
  references: { nom: "References.docx", dossier: "TECHNIQUE", gen: (c) => SO.referencesWord(c) },
  sous_detail: { nom: "Sous-detail des prix.xlsx", dossier: "FINANCIER", gen: async (c) => (await SO.bordereauXlsx(c)).buffer },
  bordereau_prix: { nom: "Bordereau des prix - detail estimatif.xlsx", dossier: "FINANCIER", gen: async (c) => (await SO.bordereauXlsx(c)).buffer },
  caution_provisoire: { nom: "Demande de caution provisoire.docx", dossier: "ADMINISTRATIF", gen: (c) => SO.lettreCaution(c) }
};
async function dossierComplet(db, etude, c) {
  const lignes = ((etude.resultat || {}).pieces || []).map((pc) => MPEtude.ligneDossier(pc, { coffre: c.coffre, dateDepot: c.fiche ? c.fiche.date_limite : null, aujourdhui: new Date().toISOString().slice(0, 10), validations: etude.validations }));
  const pieces = [], faits = {};
  const cont = blobSvc().getContainerClient(B_COFFRE);
  for (const l of lignes) {
    const g = PIECES[l.type];
    if (g && !faits[l.type]) {
      faits[l.type] = 1;
      pieces.push({ dossier: l.dossier, nom: g.nom, buffer: await g.gen(c) });
      l.fichier = g.nom;
    } else if (l.origine === "coffre" && l.coffreId) {
      const d = c.coffre.find((x) => x.id === l.coffreId), v = MPEtude.versionCourante(d);
      if (v && !faits["coffre_" + d.id]) {
        faits["coffre_" + d.id] = 1;
        pieces.push({ dossier: l.dossier, nom: (d.libelle || d.type) + " v" + v.v + "." + (v.ext || "pdf"), buffer: await cont.getBlobClient(v.blob).downloadToBuffer() });
        l.fichier = (d.libelle || d.type) + " v" + v.v + "." + (v.ext || "pdf");
      }
    } else if (g) l.fichier = g.nom;
  }
  return SO.zipDossier({ ref: etude.ref, lignes, pieces });
}

/* ---------- Routeur ---------- */
module.exports = async function routesEtude(fn, context, req, outils) {
  const { getDb, getAuthenticatedUser, getRoleFromDb } = outils;
  const db = getDb();
  const json = (status, body) => { context.res = { status, headers: { "Content-Type": "application/json" }, body }; };
  if (fn === "etudesTick") {
    try { json(200, await tick(db, context)); } catch (e) { context.log.error("etudesTick : " + e.message); json(500, { error: e.message }); }
    return true;
  }
  const user = getAuthenticatedUser(req);
  if (!user) { json(401, { error: "Non authentifié" }); return true; }
  const par = user.userDetails;
  try {
    if (fn === "etudes") {
      const veilleId = req.query && req.query.veilleId;
      if (!veilleId) { json(400, { error: "veilleId manquant" }); return true; }
      const veille = await lireVeille(db, veilleId);
      if (!veille) { json(404, { error: "AO de la veille introuvable" }); return true; }
      const etudes = await etudesDe(db, veilleId);
      const fiche = await lireFiche(db, veille);
      const coffre = await lireCoffre(db);
      const params = await lireParams(db);
      let extras = null;
      if (etudes[0] && etudes[0].statut === "prete") {
        const c = await contextePieces(db, etudes[0]);
        extras = { totaux: c.totaux, ecarts: c.ecarts, eclaircissements: c.eclaircissements, references: c.references, delai: c.delai, sousDetail: c.sousDetail };
      }
      json(200, { veille: rendu(veille), fiche: fiche ? rendu(fiche) : null, courante: etudes[0] ? rendu(etudes[0]) : null, extras,
        versions: etudes.map((e) => ({ id: e.id, version: e.version, type: e.type, statut: e.statut, cree_le: e.cree_le, cree_par: e.cree_par, cout_usd: e.cout_usd, dce: e.dce ? e.dce.blob : null })),
        coffre, cle_configuree: !!CL.client(), params: { marge_defaut: params.marge_defaut, plafond_etude_usd: params.plafond_etude_usd } });
      return true;
    }
    if (fn === "etudeLancer") {
      const b = req.body || {};
      const veille = await lireVeille(db, b.veilleId);
      if (!veille) { json(404, { error: "AO de la veille introuvable" }); return true; }
      if (veille.dce_status !== "ready" || !veille.dce_blob_name) { json(409, { error: "DCE non téléchargé : demander le DCE d'abord (bouton ⬇ de la veille)." }); return true; }
      if (!CL.client()) { json(503, { error: "Clé de l'étude d'AO non configurée côté API (" + CL.NOM_CLE + ")." }); return true; }
      const enCours = (await etudesDe(db, veille.id)).find((e) => ["preparation", "ocr_en_cours", "analyse_en_cours"].indexOf(e.statut) >= 0);
      if (enCours) { json(409, { error: "Une étude est déjà en cours (version " + enCours.version + ")." }); return true; }
      const e = await lancer(db, veille, b.type === "pre" ? "pre" : "complete", par, await lireParams(db));
      json(200, { etude: rendu(e) });
      return true;
    }
    if (fn === "etudeValider") {
      const b = req.body || {};
      if (["moyens_humains", "references"].indexOf(b.quoi) < 0 || !Array.isArray(b.choix)) { json(400, { error: "quoi / choix invalides" }); return true; }
      const C = db.container(C_ETUDES);
      const e = (await C.item(b.etudeId, b.veilleId).read()).resource;
      if (!e) { json(404, { error: "Étude introuvable" }); return true; }
      e.validations = e.validations || {};
      e.validations[b.quoi] = { choix: b.choix.slice(0, 60), par, le: maintenantISO() };
      await C.items.upsert(e);
      json(200, { ok: true, validations: e.validations });
      return true;
    }
    if (fn === "etudeFichier") {
      const q = req.query || {};
      const C = db.container(C_ETUDES);
      const e = (await C.item(q.id, q.veilleId).read()).resource;
      if (!e || e.statut !== "prete") { json(404, { error: "Étude introuvable ou pas encore prête" }); return true; }
      const c = await contextePieces(db, e);
      let buf, nom;
      if (q.quoi === "dossier") { buf = await dossierComplet(db, e, c); nom = "Dossier de reponse - AO " + String(e.ref || "").replace(/[\\/:*?"<>|]/g, "-") + ".zip"; }
      else if (q.quoi === "personnel") { json(200, { personnel: await personnel(db) }); return true; }
      else if (PIECES[q.quoi]) { buf = await PIECES[q.quoi].gen(c); nom = PIECES[q.quoi].nom; }
      else { json(400, { error: "Pièce inconnue" }); return true; }
      const ext = nom.split(".").pop();
      context.res = { status: 200, isRaw: true, body: buf, headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(nom), "Cache-Control": "no-store" } };
      return true;
    }
    if (fn === "etudeParams") {
      const params = await lireParams(db);
      if ((req.method || "GET").toUpperCase() === "POST") {
        const role = await getRoleFromDb(par);
        if (role !== "dg") { json(403, { error: "Paramètres de l'étude d'AO : réservés au DG." }); return true; }
        const b = req.body || {};
        const num = (v, min, max) => { const n = Number(v); return isFinite(n) && n >= min && n <= max ? n : null; };
        const maj = Object.assign({}, params);
        if (b.seuil_pre_etude != null) { const n = num(b.seuil_pre_etude, 0, 100); if (n == null) { json(400, { error: "Seuil entre 0 et 100" }); return true; } maj.seuil_pre_etude = n; }
        if (b.plafond_etude_usd != null) { const n = num(b.plafond_etude_usd, 0, 50); if (n == null) { json(400, { error: "Plafond par étude entre 0 et 50 USD" }); return true; } maj.plafond_etude_usd = n; }
        if (b.plafond_mois_usd != null) { const n = num(b.plafond_mois_usd, 0, 1000); if (n == null) { json(400, { error: "Plafond mensuel entre 0 et 1000 USD" }); return true; } maj.plafond_mois_usd = n; }
        if (typeof b.pre_etude_active === "boolean") maj.pre_etude_active = b.pre_etude_active;
        maj.maj_le = maintenantISO(); maj.maj_par = par;
        delete maj._rid; delete maj._self; delete maj._etag; delete maj._attachments; delete maj._ts;
        await db.container(C_CONFIG).items.upsert(maj);
        json(200, { params: maj, conso_mois_usd: await consoMois(db, moisCourant()) });
        return true;
      }
      const mois = moisCourant();
      const liste = (await db.container(C_ETUDES).items.query({ query: "SELECT c.ref, c.type, c.version, c.cout_usd, c.statut, c.soumise_le, c.duree_s FROM c WHERE c.type_doc = 'etude' AND STARTSWITH(c.soumise_le, @m)", parameters: [{ name: "@m", value: mois }] }).fetchAll()).resources;
      const sc = (await db.container("mp_veille_ao").items.query("SELECT VALUE c.score FROM c WHERE IS_DEFINED(c.score)").fetchAll()).resources;
      json(200, { params, conso_mois_usd: liste.reduce((a, x) => a + (x.cout_usd || 0), 0), etudes_mois: liste, mois, cle_configuree: !!CL.client(), scores: sc });
      return true;
    }
    if (fn === "coffre") {
      const C = db.container(C_COFFRE);
      if ((req.method || "GET").toUpperCase() === "GET") { json(200, { documents: await lireCoffre(db), types: MPEtude.COFFRE_TYPES }); return true; }
      const b = req.body || {};
      const ext = TYPES_FICHIER[b.mime];
      if (!ext) { json(400, { error: "Format refusé (PDF, JPEG, PNG ou Word)" }); return true; }
      if (!MPEtude.COFFRE_TYPES.some((t) => t.cle === b.type)) { json(400, { error: "Type de document inconnu" }); return true; }
      const oct = Buffer.from(String(b.contenu || ""), "base64");
      if (!oct.length || oct.length > COFFRE_MAX_OCTETS) { json(400, { error: "Fichier vide ou de plus de 15 Mo" }); return true; }
      if (b.date_validite && !MPEtude.dateISO(b.date_validite)) { json(400, { error: "Date de validité illisible" }); return true; }
      let doc = null;
      if (b.id) { try { doc = (await C.item(b.id, b.id).read()).resource; } catch (e) { doc = null; } if (!doc) { json(404, { error: "Document introuvable" }); return true; } }
      else doc = { id: "coffre_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7), type: b.type, libelle: String(b.libelle || "").slice(0, 200) || MPEtude.libelleDe(MPEtude.COFFRE_TYPES, b.type), marche_ref: b.marche_ref || null, versions: [], cree_le: maintenantISO(), cree_par: par };
      const v = (doc.versions.length ? doc.versions[doc.versions.length - 1].v : 0) + 1;
      const blob = doc.id + "/v" + v + "." + ext;
      await (await conteneurBlob(B_COFFRE)).getBlockBlobClient(blob).uploadData(oct, { blobHTTPHeaders: { blobContentType: b.mime } });
      doc.versions.push({ v, blob, ext, nom_fichier: String(b.nom_fichier || "").slice(0, 200), taille: oct.length, date_emission: MPEtude.dateISO(b.date_emission), date_validite: MPEtude.dateISO(b.date_validite), depose_le: maintenantISO(), depose_par: par });
      await C.items.upsert(doc);
      json(200, { document: rendu(doc) });
      return true;
    }
    if (fn === "coffreLien") {
      const q = req.query || {};
      const doc = (await db.container(C_COFFRE).item(q.id, q.id).read()).resource;
      if (!doc) { json(404, { error: "Document introuvable" }); return true; }
      const v = (doc.versions || []).find((x) => String(x.v) === String(q.v)) || MPEtude.versionCourante(doc);
      const url = await blobSvc().getContainerClient(B_COFFRE).getBlobClient(v.blob).generateSasUrl({
        permissions: BlobSASPermissions.parse("r"), expiresOn: new Date(Date.now() + 10 * 60000),
        contentDisposition: "inline; filename*=UTF-8''" + encodeURIComponent((doc.libelle || "document") + " v" + v.v + "." + v.ext)
      });
      json(200, { url, expire_dans_min: 10 });
      return true;
    }
  } catch (e) {
    context.log.error(fn + " : " + e.message);
    json(500, { error: e.message });
    return true;
  }
  return false;
};
module.exports._interne = { preparer, soumettreAnalyse, soumettreOcr, articlesTableur, contextePieces, tick, lancer, finaliser, PIECES, semainesDe, catalogueAchats, PARAMS_DEFAUT, texteOcrEnPages };
