/**
 * ocr-acte.js — Extraction OCR d'un acte de caution (SERVEUR only).
 *
 * Un SEUL chemin d'extraction, modèle PRÉCIS impose (MPMainlevee.MODELE_OCR =
 * claude-sonnet-5, jamais haiku). Anthropic SDK direct. FAIL-SOFT : si ANTHROPIC_API_KEY
 * absente, renvoie { configure:false } (le dépôt reste possible côté appelant).
 * La normalisation (montant/type/banque) et les états de confiance viennent du module
 * pur gaté pv-mainlevee.js — aucune règle métier dupliquée ici. Le hash de cache et
 * l'appel réseau vivent ici (serveur), jamais dans le bundle.
 */
const crypto = require("crypto");
const MPMainlevee = require("../pv-mainlevee.js");

function hashActe(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }

const PROMPT = [
  "Tu extrais les champs d'un acte de caution bancaire marocain.",
  "Rends UNIQUEMENT un JSON strict, sans texte autour :",
  '{ "montant": <chaine telle que lue, ex "99 072,00 MAD">, "banque": <chaine>, "reference": <n° de la caution>,',
  '  "type": <"definitive"|"RG"|"provisoire" tel que lu>, "date_emission": <AAAA-MM-JJ si lisible>,',
  '  "echeance": <AAAA-MM-JJ si lisible>,',
  '  "confiances": { "montant":0-100, "banque":0-100, "reference":0-100, "type":0-100, "date_emission":0-100, "echeance":0-100 } }',
  "N'INVENTE JAMAIS une valeur absente : si un champ n'est pas lisible, omets-le et mets sa confiance a 0.",
  "100 = parfaitement lisible ; <80 = incertain."
].join("\n");

/* Extrait les champs bruts via le modèle. Renvoie l'objet parsé (ou lève). */
async function _appelModele(buffer, contentType) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const source = (contentType === "application/pdf")
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: contentType, data: buffer.toString("base64") } };
  const resp = await client.messages.create({
    model: MPMainlevee.MODELE_OCR, // claude-sonnet-5 — jamais haiku
    max_tokens: 1024,
    messages: [{ role: "user", content: [source, { type: "text", text: PROMPT }] }]
  });
  var txt = "";
  (resp.content || []).forEach(function (b) { if (b.type === "text") txt += b.text; });
  var m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Reponse OCR non-JSON");
  return JSON.parse(m[0]);
}

/* Normalise la sortie brute -> champs contraints + etats de confiance (module pur).
 * montant illisible -> null ET confiance forcee a non_lu (jamais un zero).
 * TRACE : la valeur BRUTE lue par le modele est conservee dans lu_brut — une
 * traduction (montant parse, banque rattachee au referentiel, type provisoire ->
 * soumission) ne doit JAMAIS effacer ce qui etait ecrit sur l'acte. */
function _normaliser(brut, referentielBanques) {
  brut = brut || {}; var cf = brut.confiances || {};
  var montant = MPMainlevee.parserMontant(brut.montant);
  var lu_brut = {
    montant: (brut.montant != null && String(brut.montant).trim()) ? String(brut.montant).trim() : null,
    banque: (brut.banque != null && String(brut.banque).trim()) ? String(brut.banque).trim() : null,
    reference: (brut.reference != null && String(brut.reference).trim()) ? String(brut.reference).trim() : null,
    type: (brut.type != null && String(brut.type).trim()) ? String(brut.type).trim() : null,
    date_emission: (brut.date_emission != null && String(brut.date_emission).trim()) ? String(brut.date_emission).trim() : null,
    echeance: (brut.echeance != null && String(brut.echeance).trim()) ? String(brut.echeance).trim() : null
  };
  var champs = {
    montant: montant,
    banque: MPMainlevee.normaliserBanqueOcr(brut.banque, referentielBanques),
    reference: (brut.reference != null && String(brut.reference).trim()) ? String(brut.reference).trim() : null,
    type: MPMainlevee.normaliserTypeOcr(brut.type),
    date_emission: (brut.date_emission && /^\d{4}-\d{2}-\d{2}$/.test(brut.date_emission)) ? brut.date_emission : null,
    echeance: (brut.echeance && /^\d{4}-\d{2}-\d{2}$/.test(brut.echeance)) ? brut.echeance : null
  };
  var conf = {
    montant: (montant == null) ? "non_lu" : MPMainlevee.etatConfiance(cf.montant),
    banque: (champs.banque == null) ? "non_lu" : MPMainlevee.etatConfiance(cf.banque),
    reference: (champs.reference == null) ? "non_lu" : MPMainlevee.etatConfiance(cf.reference),
    type: (champs.type == null) ? "non_lu" : MPMainlevee.etatConfiance(cf.type),
    date_emission: (champs.date_emission == null) ? "non_lu" : MPMainlevee.etatConfiance(cf.date_emission),
    echeance: (champs.echeance == null) ? "non_lu" : MPMainlevee.etatConfiance(cf.echeance)
  };
  return { champs: champs, confiances: conf, lu_brut: lu_brut };
}

/* Point d'entree. cacheGet/cacheSet : fonctions best-effort (cle->objet) fournies par
 * l'endpoint (Cosmos). Renvoie { configure, cache?, champs, confiances, lu_brut, hash }.
 * lu_brut = ce que le modele a LU sur l'acte, avant traduction (trace, jamais efface). */
async function extraireActe(buffer, contentType, referentielBanques, cacheGet, cacheSet) {
  if (!MPMainlevee.ocrConfigure(process.env.ANTHROPIC_API_KEY)) return { configure: false };
  var hash = hashActe(buffer);
  var cle = MPMainlevee.cleCacheOcr(hash, MPMainlevee.MODELE_OCR);
  if (cacheGet) { try { var hit = await cacheGet(cle); if (hit && hit.resultat) return { configure: true, cache: true, hash: hash, champs: hit.resultat.champs, confiances: hit.resultat.confiances, lu_brut: hit.resultat.lu_brut || null }; } catch (e) {} }
  var brut = await _appelModele(buffer, contentType);
  var res = _normaliser(brut, referentielBanques);
  if (cacheSet) { try { await cacheSet(cle, res); } catch (e) {} }
  return { configure: true, cache: false, hash: hash, champs: res.champs, confiances: res.confiances, lu_brut: res.lu_brut };
}

module.exports = { extraireActe, hashActe, _normaliser };
