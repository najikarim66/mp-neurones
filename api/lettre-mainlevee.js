/* =========================================================================
 * MP - Lettre de demande de mainlevee a la banque (PDF, papier a en-tete NEURONES, UNE PAGE).
 *
 * Regle DG 20/11/2026 : pour liberer une caution, NEURONES depose a la banque une demande de mainlevee appuyee par la
 * mainlevee delivree par le maitre d'ouvrage OU l'original de la caution restitue. La lettre est generee ici, imprimee,
 * signee par le DG et deposee : AUCUN envoi par courriel. Une lettre = une banque et une agence, plusieurs cautions possibles.
 * MISE EN PAGE validee par le DG le 20/11/2026 (maquette) : lettre d'affaires — marges larges, corps 11 pt (10,5 / 10 / 9,5 /
 * 9 pt seulement si le nombre de cautions l'impose), bloc destinataire a droite, « Nos references » a gauche, date en toutes
 * lettres, objet avec le marche, tableau a 4 colonnes precede de son marche (objet ENTIER en italique), total si plusieurs
 * cautions, pieces jointes en « P.J. », signature a droite, pied legal centre. UNE page garantie : au-dela, refus nomme
 * (LETTRE_TROP_LONGUE : diviser la demande), jamais deux pages ni un intitule tronque.
 *
 * Entree (donnees PURES, validees par MPMainlevee.lignesLettre — aucun identifiant technique) :
 *   { societe, banque, agence, adresse_agence, ville_agence, destinataire, lieu, dateISO,
 *     lignes:[{num,type,montant,date_emission,marche_ref,marche_objet,maitre_ouvrage,piece,piece_type,piece_date}], total, logo }
 * ========================================================================= */
"use strict";
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const W = 595.28, H = 841.89, MG = 56, MD = 56, LARG = W - MG - MD;
const ENCRE = rgb(0.078, 0.129, 0.239), MARQUE = rgb(0.122, 0.306, 0.471), GRIS = rgb(0.75, 0.78, 0.82), GRIS_T = rgb(0.42, 0.46, 0.52), FOND = rgb(0.93, 0.95, 0.975), FOND2 = rgb(0.975, 0.98, 0.99);
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TYPES = { bonne_execution: "Caution définitive", retenue_garantie: "Retenue de garantie", provisoire: "Caution provisoire", soumission: "Caution de soumission", avance_demarrage: "Avance de démarrage",
  "Caution de retenue de garantie": "Retenue de garantie", "Caution d'avance de démarrage": "Avance de démarrage" };
const PIECE = { mainlevee_client: (l) => "Mainlevée délivrée par le maître d'ouvrage" + (l.piece_date ? " le " + dateFR(l.piece_date) : "") + ", pour la caution n° " + l.num, original_caution: (l) => "Original de la caution n° " + l.num + ", restitué par le maître d'ouvrage" + (l.piece_date ? " le " + dateFR(l.piece_date) : "") };

function txt(s) { return String(s == null ? "" : s).replace(/[\u202F\u00A0\u2009]/g, " ").replace(/[^\x20-\x7E\xA0-\xFF\u0152\u0153\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, "?").replace(/\r?\n/g, " "); }
function montantFR(n) { const v = Math.round((+n || 0) * 100) / 100; const [e, d] = v.toFixed(2).split("."); return e.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + d + " MAD"; }
function dateFR(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : "non renseignée"; }
function dateLettres(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); if (!m) return ""; const j = parseInt(m[3], 10); return (j === 1 ? "1er" : String(j)) + " " + MOIS[parseInt(m[2], 10) - 1] + " " + m[1]; }
function capital(v) { const n = String(v == null ? "" : v).replace(/[^\d]/g, ""); return n && /^\d+$/.test(String(v).trim()) ? n.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " MAD" : String(v || ""); }
function tel(v) { const d = String(v || "").replace(/\D/g, ""); return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : String(v || ""); }
function replier(font, T, texte, largeur) { const mots = txt(texte).split(/\s+/).filter(Boolean), out = []; let cur = ""; for (const mot of mots) { const e = cur ? cur + " " + mot : mot; if (font.widthOfTextAtSize(e, T) <= largeur) { cur = e; continue; } if (cur) out.push(cur); let mo = ""; for (const ch of mot) { if (font.widthOfTextAtSize(mo + ch, T) > largeur && mo) { out.push(mo); mo = ch; } else mo += ch; } cur = mo; } if (cur) out.push(cur); return out.length ? out : [""]; }

async function composer(d, T) {
  const s = d.societe || {}, raison = s.raison_sociale || "NEURONES TECHNOLOGIES";
  const pdf = await PDFDocument.create();
  pdf.setTitle("Demande de mainlevée de caution(s) - " + txt(d.banque)); pdf.setAuthor(txt(raison));
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold), I = await pdf.embedFont(StandardFonts.HelveticaOblique);
  let logo = null; if (d.logo) { try { logo = await pdf.embedPng(d.logo); } catch (e) { logo = null; } }
  const page = pdf.addPage([W, H]);
  const IL = T * 1.42; // interligne du corps
  let y;
  const texte = (t, x, yy, o) => page.drawText(txt(t), { x, y: yy, size: o.size || T, font: o.font || F, color: o.color || ENCRE });
  const droite = (t, yy, o) => texte(t, W - MD - (o.font || F).widthOfTextAtSize(txt(t), o.size || T), yy, o);
  const para = (t, o) => { o = o || {}; const font = o.font || F, size = o.size || T, il = size * 1.42, larg = o.larg || LARG, x = o.x || MG; const ls = replier(font, size, t, larg); ls.forEach((l) => { texte(l, o.droite ? (W - MD - font.widthOfTextAtSize(l, size)) : x, y, { font, size, color: o.color }); y -= il; }); y -= (o.apres != null ? o.apres : il * 0.55); return ls.length; };

  /* ---- En-tête : logo à gauche, identité à droite, filet ---- */
  const yTop = H - 44;
  if (logo) { const sc = 46 / logo.height; page.drawImage(logo, { x: MG, y: yTop - 46, width: logo.width * sc, height: 46 }); }
  droite(raison, yTop - 11, { font: B, size: 12, color: MARQUE });
  const adr = [s.adresse, [s.cp, s.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (adr) droite(adr, yTop - 25, { size: 9, color: GRIS_T });
  const ctc = [s.tel ? "Tél. " + tel(s.tel) : "", s.email || ""].filter(Boolean).join("   ·   ");
  if (ctc) droite(ctc, yTop - 37, { size: 9, color: GRIS_T });
  page.drawLine({ start: { x: MG, y: yTop - 58 }, end: { x: W - MD, y: yTop - 58 }, thickness: 1.1, color: MARQUE });

  /* ---- Destinataire (bloc à droite) et références (à gauche) ---- */
  y = yTop - 86;
  const xDest = MG + LARG * 0.52;
  let yd = y;
  const dest = [[d.banque, B], [d.agence, F], [d.adresse_agence, F], [d.ville_agence && String(d.adresse_agence || "").toLowerCase().indexOf(String(d.ville_agence).toLowerCase()) < 0 ? d.ville_agence : "", F], ["À l'attention " + (d.destinataire ? (/^(du|de|des|de la|de l')\s/i.test(d.destinataire) ? d.destinataire : "de : " + d.destinataire) : "du service des engagements par signature"), F]].filter((x) => x[0]);
  dest.forEach(([t, font], i) => { replier(font, T, t, LARG - (xDest - MG)).forEach((l) => { texte(l, xDest, yd, { font, size: i === 0 ? T + 1 : T }); yd -= IL; }); });
  const n = d.lignes.length, refs = [...new Set(d.lignes.map((l) => l.marche_ref))];
  let yr = y;
  texte("Nos références", MG, yr, { font: B, size: T - 1.5, color: GRIS_T }); yr -= IL * 0.95;
  replier(F, T - 1, "Caution" + (n > 1 ? "s" : "") + " n° " + d.lignes.map((l) => l.num).join(", "), LARG * 0.46).forEach((l) => { texte(l, MG, yr, { size: T - 1 }); yr -= IL * 0.9; });
  replier(F, T - 1, "Marché" + (refs.length > 1 ? "s" : "") + " n° " + refs.join(", "), LARG * 0.46).forEach((l) => { texte(l, MG, yr, { size: T - 1 }); yr -= IL * 0.9; });
  y = Math.min(yd, yr) - IL * 1.3;
  droite((d.lieu || s.ville || "Casablanca") + ", le " + dateLettres(d.dateISO), y, {}); y -= IL * 1.9;

  /* ---- Objet ---- */
  texte("Objet :", MG, y, { font: B }); texte("Demande de mainlevée de " + (n > 1 ? n + " cautions bancaires" : "caution bancaire") + (refs.length === 1 ? " — marché n° " + refs[0] : ""), MG + B.widthOfTextAtSize("Objet :", T) + 6, y, { font: B });
  y -= IL * 2;

  /* ---- Corps ---- */
  para("Madame, Monsieur,", { apres: IL * 0.4 });
  const types = {}; d.lignes.forEach((l) => { types[l.piece_type] = true; });
  const piece = (types.mainlevee_client && types.original_caution) ? "la mainlevée délivrée par le maître d'ouvrage ou l'original de la caution restitué par celui-ci, selon le cas indiqué ci-dessous" : (types.original_caution ? (n > 1 ? "les originaux des cautions, restitués par le maître d'ouvrage" : "l'original de la caution, restitué par le maître d'ouvrage") : (n > 1 ? "les mainlevées délivrées par le maître d'ouvrage" : "la mainlevée délivrée par le maître d'ouvrage"));
  para("Par la présente, nous vous prions de bien vouloir procéder à la mainlevée " + (n > 1 ? "des cautions bancaires désignées ci-dessous, émises" : "de la caution bancaire désignée ci-dessous, émise") + " par vos soins pour le compte de " + raison + ". Vous trouverez ci-joint " + piece + ".", {});

  /* ---- Cautions : marché puis tableau 4 colonnes ---- */
  y -= IL * 0.3;
  const cols = [{ t: "N° de caution", w: 0.30 }, { t: "Nature", w: 0.30 }, { t: "Émise le", w: 0.17 }, { t: "Montant", w: 0.23, dr: true }].map((c) => ({ ...c, w: Math.round(c.w * LARG) }));
  const PADX = 8, PADY = T >= 10.5 ? 6 : 4, LT = T + 3;
  const groupes = []; d.lignes.forEach((l) => { const k = l.marche_ref + "|" + l.marche_objet; let g = groupes.find((x) => x.k === k); if (!g) { g = { k, l, lignes: [] }; groupes.push(g); } g.lignes.push(l); });
  const rangee = (cells, o) => { o = o || {}; const font = o.font || F, size = o.size || T; const blocs = cells.map((c, i) => replier(font, size, c, cols[i].w - 2 * PADX)); const h = Math.max(...blocs.map((b) => b.length)) * (size + 3) + 2 * PADY; if (o.fond) page.drawRectangle({ x: MG, y: y - h, width: LARG, height: h, color: o.fond }); page.drawLine({ start: { x: MG, y: y - h }, end: { x: W - MD, y: y - h }, thickness: 0.5, color: GRIS }); let x = MG; blocs.forEach((b, i) => { b.forEach((l, k) => texte(l, cols[i].dr ? (x + cols[i].w - PADX - font.widthOfTextAtSize(l, size)) : x + PADX, y - PADY - (size + 3) * (k + 1) + 4, { font, size, color: o.color })); x += cols[i].w; }); y -= h; };
  const marcheRow = (l) => { const t1 = "Marché n° " + l.marche_ref + " — " + l.maitre_ouvrage; const ls2 = replier(I, T - 1, l.marche_objet, LARG - 2 * PADX); const h = (T + 3) + ls2.length * (T + 2) + 2 * PADY + 1; page.drawRectangle({ x: MG, y: y - h, width: LARG, height: h, color: FOND2 }); page.drawLine({ start: { x: MG, y: y - h }, end: { x: W - MD, y: y - h }, thickness: 0.5, color: GRIS }); texte(t1, MG + PADX, y - PADY - T + 1, { font: B, size: T }); let yy = y - PADY - T - (T + 2) + 1; ls2.forEach((l2) => { texte(l2, MG + PADX, yy, { font: I, size: T - 1, color: GRIS_T }); yy -= (T + 2); }); y -= h; };
  page.drawLine({ start: { x: MG, y }, end: { x: W - MD, y }, thickness: 1, color: MARQUE });
  rangee(cols.map((c) => c.t), { font: B, fond: FOND, size: T - 0.5 });
  groupes.forEach((g) => { marcheRow(g.l); g.lignes.forEach((l) => rangee([l.num, TYPES[l.type] || l.type, dateFR(l.date_emission), montantFR(l.montant)], {})); });
  if (n > 1) { y -= PADY; droite("Total : " + montantFR(d.lignes.reduce((a, l) => a + (+l.montant || 0), 0)), y - T + 2, { font: B }); y -= T + PADY; }
  y -= IL * 1.1;

  /* ---- Clôture et signature ---- */
  para("Nous vous remercions de bien vouloir nous adresser l'accusé de mainlevée correspondant et de mettre fin, à compter de la date de la présente, au prélèvement des commissions afférentes.", {});
  para("Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.", { apres: IL * 1.2 });
  const ySig = y;
  texte("Pour " + raison, xDest, ySig, { font: F });
  texte("Le Directeur Général", xDest, ySig - IL, { font: B });
  y = ySig - IL - (T >= 10.5 ? 58 : 46); // espace de signature et cachet

  /* ---- P.J. ---- */
  texte("P.J. :", MG, y, { font: B, size: T - 1.5 });
  const xpj = MG + 30;
  /* Jusqu'à 3 cautions : une ligne par pièce ; au-delà : un paragraphe par nature de pièce (compact, dates conservées). */
  let pj;
  if (n <= 3) pj = d.lignes.map((l, i) => (n > 1 ? (i + 1) + ". " : "") + (PIECE[l.piece_type] ? PIECE[l.piece_type](l) : l.piece));
  else { const g = {}; d.lignes.forEach((l) => { (g[l.piece_type] = g[l.piece_type] || []).push(l); }); pj = Object.keys(g).map((k) => (k === "original_caution" ? "Originaux des cautions restitués par le maître d'ouvrage : " : "Mainlevées délivrées par le maître d'ouvrage pour les cautions : ") + g[k].map((l) => "n° " + l.num + (l.piece_date ? " (" + dateFR(l.piece_date) + ")" : "")).join(", ") + "."); }
  pj.forEach((t0) => { replier(F, T - 1.5, t0, LARG - 30).forEach((t) => { texte(t, xpj, y, { size: T - 1.5 }); y -= (T - 1.5) * 1.35; }); });
  const yFin = y;

  /* ---- Pied légal centré ---- */
  const pied = [s.forme_juridique ? raison + " " + s.forme_juridique : raison, s.capital_social ? "au capital de " + capital(s.capital_social) : "", s.rc ? "RC " + s.rc + (s.ville_rc ? " " + s.ville_rc : "") : "", s.if ? "IF " + s.if : "", s.ice ? "ICE " + s.ice : "", s.patente ? "Patente " + s.patente : "", s.cnss ? "CNSS " + s.cnss : ""].filter(Boolean).join("  ·  ");
  page.drawLine({ start: { x: MG, y: 50 }, end: { x: W - MD, y: 50 }, thickness: 0.5, color: GRIS });
  replier(F, 7.5, pied, LARG).slice(0, 2).forEach((l, k) => texte(l, (W - F.widthOfTextAtSize(txt(l), 7.5)) / 2, 38 - k * 10, { size: 7.5, color: GRIS_T }));
  return { pdf, deborde: yFin < 62, yFin };
}


const TAILLES = [11, 10.5, 10, 9.5, 9];
/* Point d'entree : UNE page, sinon refus nomme. */
async function genererLettreMainlevee(d) {
  d = d || {}; d.lignes = d.lignes || [];
  for (const T of TAILLES) { const r = await composer(d, T); if (!r.deborde) return Buffer.from(await r.pdf.save()); }
  const e = new Error("La lettre ne tient pas sur une page avec " + d.lignes.length + " caution(s) : diviser la demande en plusieurs lettres (cocher moins de cautions).");
  e.code = "LETTRE_TROP_LONGUE";
  throw e;
}

module.exports = { genererLettreMainlevee, composer, montantFR, dateFR, dateLettres, txt, replier, TAILLES };
