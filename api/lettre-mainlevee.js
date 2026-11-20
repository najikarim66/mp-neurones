/* =========================================================================
 * MP - Lettre de demande de mainlevee a la banque (PDF, papier a en-tete NEURONES).
 *
 * Regle DG 20/11/2026 : pour liberer une caution, NEURONES depose a la banque une demande de
 * mainlevee appuyee par la mainlevee delivree par le maitre d'ouvrage OU l'original de la caution
 * restitue. La lettre est generee ici, imprimee, signee par le DG et deposee : AUCUN envoi par
 * courriel. Une lettre regroupe plusieurs cautions de la MEME banque.
 *
 * Entree (donnees PURES, deja validees par MPMainlevee.lignesLettre — aucun identifiant technique) :
 *   { societe, banque, agence, adresse_agence, lieu, dateISO, lignes:[{num,type,montant,date_emission,
 *     marche_ref,marche_objet,maitre_ouvrage,piece,piece_date}], total, logo (Buffer PNG, facultatif) }
 * Sortie : Buffer PDF. Texte en 10 pt minimum, intitules ENTIERS replies sur plusieurs lignes
 * (jamais tronques), pagination « Page i / n » avec en-tete et pied repetes.
 * ========================================================================= */
"use strict";
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const W = 595.28, H = 841.89, MARGE = 50, LARG = W - 2 * MARGE;
const ENCRE = rgb(0.078, 0.129, 0.239);   // encre de la charte (#14213D)
const MARQUE = rgb(0.122, 0.306, 0.471);  // bleu marque (#1F4E78)
const GRIS = rgb(0.847, 0.867, 0.890);    // bords de tableau (#D8DDE3)
const FOND = rgb(0.910, 0.941, 0.973);    // fond d'en-tete de tableau (#E8F0F8)

/* WinAnsi (polices standard) : on garde les accents latins, on remplace le reste nomme. */
function txt(s) {
  return String(s == null ? "" : s)
    .replace(/[   ]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFFŒœŠšŸŽž–—‘’“”•…€]/g, "?")
    .replace(/\r?\n/g, " ");
}
function montantFR(n) {
  const v = Math.round((+n || 0) * 100) / 100;
  const [ent, dec] = v.toFixed(2).split(".");
  return ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + dec + " MAD";
}
function dateFR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? m[3] + "/" + m[2] + "/" + m[1] : "non renseignée";
}
function replier(font, taille, texte, largeur) {
  const mots = txt(texte).split(/\s+/).filter(Boolean), out = [];
  let cur = "";
  for (const mot of mots) {
    const essai = cur ? cur + " " + mot : mot;
    if (font.widthOfTextAtSize(essai, taille) <= largeur) { cur = essai; continue; }
    if (cur) out.push(cur);
    // Un mot plus large que la colonne se coupe caractere par caractere (jamais d'ellipse).
    let morceau = "";
    for (const ch of mot) {
      if (font.widthOfTextAtSize(morceau + ch, taille) > largeur && morceau) { out.push(morceau); morceau = ch; } else morceau += ch;
    }
    cur = morceau;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

async function genererLettreMainlevee(d) {
  d = d || {};
  const s = d.societe || {};
  const pdf = await PDFDocument.create();
  pdf.setTitle("Demande de mainlevée de caution(s) - " + txt(d.banque || ""));
  pdf.setAuthor(txt(s.raison_sociale || "NEURONES TECHNOLOGIES"));
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (d.logo) { try { logo = await pdf.embedPng(d.logo); } catch (e) { logo = null; } }

  const raison = s.raison_sociale || "NEURONES TECHNOLOGIES";
  const adresse = [s.adresse, [s.cp, s.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const contact = [s.tel ? "Tel. " + s.tel : "", s.email || ""].filter(Boolean).join("  -  ");
  const pied = [
    s.forme_juridique ? raison + " - " + s.forme_juridique : raison,
    s.capital_social ? "Capital " + s.capital_social : "",
    s.rc ? "RC " + s.rc + (s.ville_rc ? " " + s.ville_rc : "") : "",
    s.if ? "IF " + s.if : "", s.ice ? "ICE " + s.ice : "", s.patente ? "Patente " + s.patente : "", s.cnss ? "CNSS " + s.cnss : ""
  ].filter(Boolean).join("  -  ");

  const pages = [];
  let page, y;
  function entete() {
    page = pdf.addPage([W, H]); pages.push(page);
    let hLogo = 0;
    if (logo) { const sc = 44 / logo.height; hLogo = 44; page.drawImage(logo, { x: MARGE, y: H - MARGE - 44, width: logo.width * sc, height: 44 }); }
    const xId = W - MARGE;
    const l1 = txt(raison); page.drawText(l1, { x: xId - B.widthOfTextAtSize(l1, 11), y: H - MARGE - 10, size: 11, font: B, color: MARQUE });
    let yy = H - MARGE - 24;
    for (const l of [adresse, contact]) { if (!l) continue; const t = txt(l); page.drawText(t, { x: xId - F.widthOfTextAtSize(t, 10), y: yy, size: 10, font: F, color: ENCRE }); yy -= 13; }
    const yLigne = H - MARGE - Math.max(hLogo, 50) - 6;
    page.drawLine({ start: { x: MARGE, y: yLigne }, end: { x: W - MARGE, y: yLigne }, thickness: 0.8, color: MARQUE });
    y = yLigne - 28;
  }
  function pieds() {
    pages.forEach((pg, i) => {
      pg.drawLine({ start: { x: MARGE, y: MARGE - 2 }, end: { x: W - MARGE, y: MARGE - 2 }, thickness: 0.5, color: GRIS });
      const t = txt(pied);
      const lignes = replier(F, 9, t, LARG - 70);
      lignes.slice(0, 2).forEach((l, k) => pg.drawText(l, { x: MARGE, y: MARGE - 14 - k * 11, size: 9, font: F, color: ENCRE }));
      const p = "Page " + (i + 1) + " / " + pages.length;
      pg.drawText(p, { x: W - MARGE - F.widthOfTextAtSize(p, 9), y: MARGE - 14, size: 9, font: F, color: ENCRE });
    });
  }
  function place(h) { if (y - h < MARGE + 30) entete(); }
  function para(texte, o) {
    o = o || {};
    const font = o.gras ? B : F, taille = o.taille || 11, inter = taille + 4;
    const lignes = replier(font, taille, texte, LARG);
    for (const l of lignes) {
      place(inter);
      const x = o.droite ? (W - MARGE - font.widthOfTextAtSize(l, taille)) : MARGE;
      page.drawText(l, { x, y, size: taille, font, color: o.couleur || ENCRE });
      y -= inter;
    }
    y -= (o.apres != null ? o.apres : 6);
  }

  entete();
  const lieu = d.lieu || s.ville || "Casablanca";
  para(txt(lieu) + ", le " + dateFR(d.dateISO), { droite: true, apres: 14 });
  para(txt(d.banque || "Banque non renseignée"), { gras: true, taille: 12, apres: 0 });
  if (d.agence) para("Agence " + txt(d.agence), { apres: 0 });
  if (d.adresse_agence) para(txt(d.adresse_agence), { apres: 0 });
  para("À l'attention du service des engagements par signature", { apres: 16 });

  const n = (d.lignes || []).length;
  para("Objet : demande de mainlevée de " + (n > 1 ? n + " cautions bancaires" : "caution bancaire"), { gras: true, taille: 12, apres: 14 });
  para("Madame, Monsieur,", { apres: 8 });
  const types = {};
  (d.lignes || []).forEach((l) => { types[l.piece_type] = true; });
  const pieceTxt = (types.mainlevee_client && types.original_caution)
    ? "la mainlevée délivrée par le maître d'ouvrage ou l'original de la caution restitué par celui-ci, selon le cas indiqué"
    : (types.original_caution ? "l'original de la caution, restitué par le maître d'ouvrage" : "la mainlevée délivrée par le maître d'ouvrage");
  para("Nous vous prions de bien vouloir procéder à la mainlevée " + (n > 1 ? "des cautions bancaires ci-dessous, émises" : "de la caution bancaire ci-dessous, émise")
    + " par vos soins pour le compte de " + txt(raison) + ". Vous trouverez ci-joint, pour chacune, " + pieceTxt + ".", { apres: 12 });

  /* Tableau : intitules ENTIERS, replies ; hauteur de ligne = la plus haute des cellules. */
  const cols = [
    { t: "N° de caution", w: 100, f: (l) => l.num },
    { t: "Type", w: 56, f: (l) => l.type },
    { t: "Montant", w: 82, f: (l) => montantFR(l.montant), droite: true },
    { t: "Émission", w: 62, f: (l) => dateFR(l.date_emission) },
    { t: "Marché (référence, objet) et maître d'ouvrage", w: 130, f: (l) => l.marche_ref + " - " + l.marche_objet + " - " + l.maitre_ouvrage },
    { t: "Pièce jointe", w: 65, f: (l) => PIECES_FR[l.piece_type] || l.piece, sous: (l) => (l.piece_date ? "du " + dateFR(l.piece_date) : "") }
  ];
  const T = 10, INTER = 12, PAD = 4;
  const PIECES_FR = { mainlevee_client: "Mainlevée délivrée par le maître d'ouvrage", original_caution: "Original de la caution restitué par le maître d'ouvrage" };
  function ligneTableau(cellules, gras, fond) {
    const font = gras ? B : F;
    const blocs = cellules.map((c, i) => replier(font, T, c, cols[i].w - 2 * PAD));
    const h = Math.max(...blocs.map((b) => b.length)) * INTER + 2 * PAD;
    place(h);
    let x = MARGE;
    if (fond) page.drawRectangle({ x: MARGE, y: y - h, width: LARG, height: h, color: FOND });
    page.drawRectangle({ x: MARGE, y: y - h, width: LARG, height: h, borderColor: GRIS, borderWidth: 0.5 });
    blocs.forEach((b, i) => {
      b.forEach((l, k) => {
        const xx = cols[i].droite ? (x + cols[i].w - PAD - font.widthOfTextAtSize(l, T)) : (x + PAD);
        page.drawText(l, { x: xx, y: y - PAD - INTER * (k + 1) + 3, size: T, font, color: ENCRE });
      });
      x += cols[i].w;
      if (i < cols.length - 1) page.drawLine({ start: { x, y }, end: { x, y: y - h }, thickness: 0.5, color: GRIS });
    });
    y -= h;
  }
  ligneTableau(cols.map((c) => c.t), true, true);
  (d.lignes || []).forEach((l) => ligneTableau(cols.map((c) => c.f(l) + (c.sous ? " " + c.sous(l) : "")), false, false));
  y -= 8;
  para("Total : " + montantFR(d.total != null ? d.total : (d.lignes || []).reduce((a, l) => a + (+l.montant || 0), 0)), { gras: true, droite: true, apres: 14 });

  para("Nous vous remercions de bien vouloir nous remettre l'accusé de mainlevée correspondant et de cesser, à compter de la date de la présente, le prélèvement des commissions afférentes.", { apres: 8 });
  place(150);
  para("Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.", { apres: 24 });
  para("Le Directeur Général", { gras: true, apres: 54 });
  para(txt(raison), { apres: 16 });
  para("Pièce(s) jointe(s) : " + n + " (" + (d.lignes || []).map((l) => (PIECES_FR[l.piece_type] || l.piece) + " - caution n° " + l.num).join(" ; ") + ")", { taille: 10, apres: 0 });

  pieds();
  return Buffer.from(await pdf.save());
}

module.exports = { genererLettreMainlevee, montantFR, dateFR, txt, replier };
