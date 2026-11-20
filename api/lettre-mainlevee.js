/* =========================================================================
 * MP - Lettre de demande de mainlevee a la banque (PDF, papier a en-tete NEURONES, UNE PAGE).
 *
 * Regle DG 20/11/2026 : pour liberer une caution, NEURONES depose a la banque une demande de
 * mainlevee appuyee par la mainlevee delivree par le maitre d'ouvrage OU l'original de la caution
 * restitue. La lettre est generee ici, imprimee, signee par le DG et deposee : AUCUN envoi par
 * courriel. Une lettre regroupe plusieurs cautions de la MEME banque et de la MEME agence.
 * Complement DG 20/11 : la lettre TIENT SUR UNE PAGE. La mise en page se resserre d'elle-meme (10,
 * 9,5 puis 9 pt) ; si une page ne suffit toujours pas, la generation est REFUSEE en nommant la
 * limite (diviser la demande), jamais une lettre de deux pages ni un intitule tronque.
 *
 * Entree (donnees PURES, deja validees par MPMainlevee.lignesLettre — aucun identifiant technique) :
 *   { societe, banque, agence, adresse_agence, ville_agence, destinataire, lieu, dateISO,
 *     lignes:[{num,type,montant,date_emission,marche_ref,marche_objet,maitre_ouvrage,piece,piece_type,piece_date}],
 *     total, logo (Buffer PNG, facultatif) }
 * Sortie : Buffer PDF (une page). Intitules ENTIERS replies sur toute la largeur, jamais tronques.
 * ========================================================================= */
"use strict";
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const W = 595.28, H = 841.89, MARGE = 46, LARG = W - 2 * MARGE;
const ENCRE = rgb(0.078, 0.129, 0.239);   // encre de la charte (#14213D)
const MARQUE = rgb(0.122, 0.306, 0.471);  // bleu marque (#1F4E78)
const GRIS = rgb(0.847, 0.867, 0.890);    // bords de tableau (#D8DDE3)
const FOND = rgb(0.910, 0.941, 0.973);    // fond d'en-tete de tableau (#E8F0F8)
const TAILLES = [10, 9.5, 9];             // corps du texte essaye dans l'ordre ; jamais moins de 9 pt
const TYPES_COURTS = { 'Caution définitive': 'Définitive', 'Caution de retenue de garantie': 'Retenue de garantie', 'Caution provisoire': 'Provisoire', "Caution d'avance de démarrage": 'Avance de démarrage', 'Caution de soumission': 'Soumission' };
const PIECES_COURT = { mainlevee_client: "Mainlevée du maître d'ouvrage", original_caution: 'Original de la caution restitué' };
const PIECES_FR = { mainlevee_client: "Mainlevée délivrée par le maître d'ouvrage", original_caution: "Original de la caution restitué par le maître d'ouvrage" };

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

/* Compose la lettre a une taille de corps donnee. Renvoie { pdf, pages } ; l'appelant retient la premiere
 * composition qui tient sur une page. */
async function composer(d, T) {
  const s = d.societe || {};
  const pdf = await PDFDocument.create();
  pdf.setTitle("Demande de mainlevée de caution(s) - " + txt(d.banque || ""));
  pdf.setAuthor(txt(s.raison_sociale || "NEURONES TECHNOLOGIES"));
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (d.logo) { try { logo = await pdf.embedPng(d.logo); } catch (e) { logo = null; } }

  const raison = s.raison_sociale || "NEURONES TECHNOLOGIES";
  const adresse = [s.adresse, [s.cp, s.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const contact = [s.tel ? "Tél. " + s.tel : "", s.email || ""].filter(Boolean).join("  -  ");
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
    if (logo) { const sc = 40 / logo.height; hLogo = 40; page.drawImage(logo, { x: MARGE, y: H - MARGE - 40, width: logo.width * sc, height: 40 }); }
    const xId = W - MARGE;
    const l1 = txt(raison); page.drawText(l1, { x: xId - B.widthOfTextAtSize(l1, 11), y: H - MARGE - 10, size: 11, font: B, color: MARQUE });
    let yy = H - MARGE - 23;
    for (const l of [adresse, contact]) { if (!l) continue; const t = txt(l); page.drawText(t, { x: xId - F.widthOfTextAtSize(t, 9), y: yy, size: 9, font: F, color: ENCRE }); yy -= 12; }
    const yLigne = H - MARGE - Math.max(hLogo, 44) - 5;
    page.drawLine({ start: { x: MARGE, y: yLigne }, end: { x: W - MARGE, y: yLigne }, thickness: 0.8, color: MARQUE });
    y = yLigne - 20;
  }
  function pieds() {
    pages.forEach((pg, i) => {
      pg.drawLine({ start: { x: MARGE, y: MARGE - 2 }, end: { x: W - MARGE, y: MARGE - 2 }, thickness: 0.5, color: GRIS });
      const lignes = replier(F, 8, pied, LARG - 60);
      lignes.slice(0, 2).forEach((l, k) => pg.drawText(l, { x: MARGE, y: MARGE - 12 - k * 10, size: 8, font: F, color: ENCRE }));
      const p = "Page " + (i + 1) + " / " + pages.length;
      pg.drawText(p, { x: W - MARGE - F.widthOfTextAtSize(p, 8), y: MARGE - 12, size: 8, font: F, color: ENCRE });
    });
  }
  function place(h) { if (y - h < MARGE + 26) entete(); }
  function para(texte, o) {
    o = o || {};
    const font = o.gras ? B : F, taille = o.taille || T, inter = taille + 3.5;
    const lignes = replier(font, taille, texte, LARG);
    for (const l of lignes) {
      place(inter);
      const x = o.droite ? (W - MARGE - font.widthOfTextAtSize(l, taille)) : MARGE;
      page.drawText(l, { x, y, size: taille, font, color: o.couleur || ENCRE });
      y -= inter;
    }
    y -= (o.apres != null ? o.apres : 4);
  }

  entete();
  const lieu = d.lieu || s.ville || "Casablanca";
  para(txt(lieu) + ", le " + dateFR(d.dateISO), { droite: true, apres: 8 });
  para(txt(d.banque || "Banque non renseignée"), { gras: true, taille: T + 1.5, apres: 0 });
  if (d.agence) para(/^agence|^succursale|^centre/i.test(String(d.agence)) ? txt(d.agence) : "Agence " + txt(d.agence), { apres: 0 });
  if (d.adresse_agence) para(txt(d.adresse_agence) + (d.ville_agence && String(d.adresse_agence).toLowerCase().indexOf(String(d.ville_agence).toLowerCase()) < 0 ? ", " + txt(d.ville_agence) : ""), { apres: 0 });
  else if (d.ville_agence) para(txt(d.ville_agence), { apres: 0 });
  para("À l'attention " + (d.destinataire ? (/^(du|de|des|de la|de l')\s/i.test(String(d.destinataire)) ? txt(d.destinataire) : "de : " + txt(d.destinataire)) : "du service des engagements par signature"), { apres: 10 });

  const n = (d.lignes || []).length;
  para("Objet : demande de mainlevée de " + (n > 1 ? n + " cautions bancaires" : "caution bancaire"), { gras: true, taille: T + 1.5, apres: 8 });
  para("Madame, Monsieur,", { apres: 4 });
  const types = {};
  (d.lignes || []).forEach((l) => { types[l.piece_type] = true; });
  const pieceTxt = (types.mainlevee_client && types.original_caution)
    ? "la mainlevée délivrée par le maître d'ouvrage ou l'original de la caution restitué par celui-ci, selon le cas indiqué"
    : (types.original_caution ? "l'original de la caution, restitué par le maître d'ouvrage" : "la mainlevée délivrée par le maître d'ouvrage");
  para("Nous vous prions de bien vouloir procéder à la mainlevée " + (n > 1 ? "des cautions bancaires ci-dessous, émises" : "de la caution bancaire ci-dessous, émise")
    + " par vos soins pour le compte de " + txt(raison) + ". Vous trouverez ci-joint, pour chacune, " + pieceTxt + ".", { apres: 8 });

  /* Tableau : une ligne par caution (numero, type, montant, emission, piece jointe), puis le marche
   * (reference, objet ENTIER, maitre d'ouvrage) sur toute la largeur en dessous — jamais tronque. */
  const PAD = 4, LT = T + 1.5;
  const cols = [
    { t: "N° de caution", w: 108, f: (l) => l.num },
    { t: "Type", w: 100, f: (l) => TYPES_COURTS[l.type] || l.type },
    { t: "Montant", w: 78, f: (l) => montantFR(l.montant), droite: true },
    { t: "Émission", w: 60, f: (l) => dateFR(l.date_emission) },
    { t: "Pièce jointe", w: LARG - 108 - 100 - 78 - 60, f: (l) => (PIECES_COURT[l.piece_type] || l.piece) + (l.piece_date ? " du " + dateFR(l.piece_date) : "") }
  ];
  function rangee(cellules, gras, fond) {
    const font = gras ? B : F;
    const blocs = cellules.map((c, i) => replier(font, T, c, cols[i].w - 2 * PAD));
    const h = Math.max(...blocs.map((b) => b.length)) * LT + 2 * PAD;
    place(h);
    let x = MARGE;
    if (fond) page.drawRectangle({ x: MARGE, y: y - h, width: LARG, height: h, color: FOND });
    page.drawRectangle({ x: MARGE, y: y - h, width: LARG, height: h, borderColor: GRIS, borderWidth: 0.5 });
    blocs.forEach((b, i) => {
      b.forEach((l, k) => {
        const xx = cols[i].droite ? (x + cols[i].w - PAD - font.widthOfTextAtSize(l, T)) : (x + PAD);
        page.drawText(l, { x: xx, y: y - PAD - LT * (k + 1) + 3, size: T, font, color: ENCRE });
      });
      x += cols[i].w;
      if (i < cols.length - 1) page.drawLine({ start: { x, y }, end: { x, y: y - h }, thickness: 0.5, color: GRIS });
    });
    y -= h;
  }
  function rangeeMarche(l) {
    const texte = "Marché " + l.marche_ref + " - " + l.marche_objet + " - Maître d'ouvrage : " + l.maitre_ouvrage;
    // ligne de marche : fond leger pour separer les groupes
    const lignes = replier(F, T - 0.5, texte, LARG - 2 * PAD);
    const h = lignes.length * (LT - 0.5) + 2 * PAD;
    place(h);
    page.drawRectangle({ x: MARGE, y: y - h, width: LARG, height: h, color: rgb(0.97, 0.975, 0.985), borderColor: GRIS, borderWidth: 0.5 });
    lignes.forEach((t, k) => page.drawText(t, { x: MARGE + PAD, y: y - PAD - (LT - 0.5) * (k + 1) + 3, size: T - 0.5, font: F, color: ENCRE }));
    y -= h;
  }
  rangee(cols.map((c) => c.t), true, true);
  // Les cautions d'un MEME marche partagent une seule ligne de marche (groupees, ordre d'entree conserve).
  const groupes = [];
  (d.lignes || []).forEach((l) => { const cle = l.marche_ref + '|' + l.marche_objet + '|' + l.maitre_ouvrage; let g = groupes.find((x) => x.cle === cle); if (!g) { g = { cle, l, lignes: [] }; groupes.push(g); } g.lignes.push(l); });
  groupes.forEach((g) => { rangeeMarche(g.l); g.lignes.forEach((l) => rangee(cols.map((c) => c.f(l)), false, false)); });
  y -= 6;
  para("Total : " + montantFR(d.total != null ? d.total : (d.lignes || []).reduce((a, l) => a + (+l.montant || 0), 0)), { gras: true, droite: true, apres: 8 });

  para("Nous vous remercions de bien vouloir nous remettre l'accusé de mainlevée correspondant et de cesser, à compter de la date de la présente, le prélèvement des commissions afférentes.", { apres: 4 });
  para("Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.", { apres: 14 });
  para("Pour " + txt(raison) + ", le Directeur Général", { gras: true, apres: 38 });
  para("Pièce(s) jointe(s) : " + n + " (une par caution, voir la colonne Pièce jointe).", { taille: T - 1, apres: 0 });

  pieds();
  return { pdf, pages: pages.length };
}

/* Point d'entree : UNE page, sinon refus nomme. */
async function genererLettreMainlevee(d) {
  d = d || {};
  let dernier = null;
  for (const T of TAILLES) {
    const r = await composer(d, T);
    dernier = r;
    if (r.pages === 1) return Buffer.from(await r.pdf.save());
  }
  const n = (d.lignes || []).length;
  const e = new Error("La lettre ne tient pas sur une page avec " + n + " caution(s) (" + dernier.pages + " pages à 9 pt) : diviser la demande en plusieurs lettres (cocher moins de cautions).");
  e.code = "LETTRE_TROP_LONGUE";
  throw e;
}

module.exports = { genererLettreMainlevee, composer, montantFR, dateFR, txt, replier, TAILLES };
