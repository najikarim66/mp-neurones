/* Étude d'AO — pièces générées : bordereau Excel (formules vivantes), brouillons Word, Gantt PDF,
 * export Word de l'étude, dossier complet (zip rangé par dossier, avec sommaire).
 * Tout est BROUILLON : chaque pièce porte la mention « à relire avant dépôt ».
 */
"use strict";
const ExcelJS = require("exceljs");
const docx = require("docx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { zipSync, strToU8 } = require("fflate");
const MPEtude = require("../etude-calc.js");

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel,
  BorderStyle, ShadingType, Footer, Header, PageNumber, LevelFormat } = docx;

const fmt = (n) => MPEtude.montantFR(n);
const jourFR = (d) => MPEtude.dateFR((d || new Date()).toISOString().slice(0, 10));

/* ========================= BORDEREAU EXCEL ========================= */
/* articles : [{ num, designation, unite, quantite, section, pa, pa_origine, marge, sources }]
   Colonnes : A N° | B Désignation | C Unité | D Qté | E PA HT | F Origine du PA | G Marge | H PU vente HT | I Total HT | J Source.
   Ligne TOTAL TTC : écart avec l'estimation du maître d'ouvrage À DROITE du total (K = libellé, L = formule). */
const COL = { num: 1, des: 2, u: 3, q: 4, pa: 5, orig: 6, marge: 7, pu: 8, tot: 9, src: 10 };
async function bordereauXlsx(ctx) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MP Manager — étude d'AO";
  wb.created = new Date();
  const ws = wb.addWorksheet("Bordereau", { views: [{ state: "frozen", ySplit: 8 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 8 }, { width: 60 }, { width: 8 }, { width: 10 }, { width: 14 }, { width: 30 }, { width: 9 }, { width: 15 }, { width: 17 }, { width: 34 }, { width: 26 }, { width: 14 }];
  const titre = ws.getCell("A1"); titre.value = "BORDEREAU DES PRIX — DÉTAIL ESTIMATIF (brouillon MP, à relire avant dépôt)"; titre.font = { bold: true, size: 14 };
  ws.getCell("A2").value = "AO n° " + (ctx.ref || "non renseigné") + " — " + (ctx.objet || "");
  ws.getCell("A3").value = "Maître d'ouvrage : " + (ctx.moa || "non renseigné");
  ws.getCell("A4").value = "Marge par défaut"; ws.getCell("B4").value = 0.3; ws.getCell("B4").numFmt = "0%";
  ws.getCell("C4").value = "← la marge se modifie article par article (colonne G) ; le prix de vente (colonne H) est celui du bordereau à remettre.";
  ws.getCell("A5").value = "Estimation MO TTC"; ws.getCell("B5").value = ctx.estimation != null ? ctx.estimation : null; ws.getCell("B5").numFmt = "#,##0.00";
  if (ctx.estimation == null) ws.getCell("C5").value = "estimation absente : à saisir pour calculer l'écart";
  ws.getCell("A6").value = "Taux de TVA"; ws.getCell("B6").value = ctx.tva != null ? ctx.tva : 0.2; ws.getCell("B6").numFmt = "0%";
  const ent = ws.getRow(8);
  ["N°", "Désignation", "Unité", "Quantité", "PA HT estimé", "Origine du PA", "Marge", "PU vente HT (à remettre)", "Total HT", "Source (DCE)"].forEach((t, i) => { ent.getCell(i + 1).value = t; });
  ent.font = { bold: true }; ent.alignment = { wrapText: true, vertical: "middle" };
  ent.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6ECF7" } }; c.border = { bottom: { style: "thin" } }; });
  let r = 9, section = null;
  const premiere = r;
  for (const a of ctx.articles) {
    if (a.section && a.section !== section) {
      section = a.section;
      const s = ws.getRow(r); s.getCell(COL.des).value = section; s.font = { bold: true, color: { argb: "FF1D3A6E" } }; r++;
    }
    const row = ws.getRow(r);
    row.getCell(COL.num).value = a.num;
    row.getCell(COL.des).value = a.designation; row.getCell(COL.des).alignment = { wrapText: true, vertical: "top" };
    row.getCell(COL.u).value = a.unite;
    row.getCell(COL.q).value = a.quantite;
    if (a.pa != null) { row.getCell(COL.pa).value = a.pa; row.getCell(COL.orig).value = a.pa_origine || "non renseignée"; }
    else {
      row.getCell(COL.orig).value = "à consulter";
      row.getCell(COL.pa).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF1DC" } };
      row.getCell(COL.orig).font = { color: { argb: "FF9A5B00" }, bold: true };
    }
    row.getCell(COL.marge).value = a.marge != null ? a.marge : 0.3;
    row.getCell(COL.marge).numFmt = "0%";
    row.getCell(COL.pu).value = { formula: 'IF(E' + r + '="","",ROUND(E' + r + '*(1+G' + r + '),2))' };
    row.getCell(COL.tot).value = { formula: 'IF(H' + r + '="","",ROUND(D' + r + '*H' + r + ',2))' };
    [COL.pa, COL.pu, COL.tot].forEach((c) => { row.getCell(c).numFmt = "#,##0.00"; });
    const s0 = (a.sources || [])[0];
    row.getCell(COL.src).value = s0 ? (s0.fichier.split("/").pop() + (s0.feuille ? ", feuille " + s0.feuille + ", ligne " + s0.ligne : (s0.page ? ", p. " + s0.page : ""))) : MPEtude.A_VERIFIER;
    row.getCell(COL.src).alignment = { wrapText: true, vertical: "top" };
    r++;
  }
  const derniere = r - 1;
  r++;
  const ht = r, tva = r + 1, ttc = r + 2;
  ws.getCell("H" + ht).value = "TOTAL HT"; ws.getCell("I" + ht).value = { formula: "SUM(I" + premiere + ":I" + derniere + ")" };
  ws.getCell("H" + tva).value = "TVA"; ws.getCell("I" + tva).value = { formula: "ROUND(I" + ht + "*$B$6,2)" };
  ws.getCell("H" + ttc).value = "TOTAL TTC"; ws.getCell("I" + ttc).value = { formula: "I" + ht + "+I" + tva };
  // L'écart avec l'estimation, À DROITE du total TTC (règle du DG).
  ws.getCell("J" + ttc).value = "Écart avec l'estimation du maître d'ouvrage";
  ws.getCell("K" + ttc).value = { formula: 'IF(N($B$5)>0,(I' + ttc + '-$B$5)/$B$5,"estimation absente")' };
  ws.getCell("K" + ttc).numFmt = "+0.00%;-0.00%;0.00%";
  ws.getCell("J" + (ttc + 1)).value = "PA à confirmer (à consulter)";
  // PA encore vides parmi les lignes d'articles (se met à jour quand un PA est saisi).
  ws.getCell("K" + (ttc + 1)).value = { formula: 'SUMPRODUCT((A' + premiere + ':A' + derniere + '<>"")*(E' + premiere + ':E' + derniere + '=""))' };
  [ht, tva, ttc].forEach((x) => { ws.getCell("I" + x).numFmt = "#,##0.00"; ws.getCell("H" + x).font = { bold: true }; ws.getCell("I" + x).font = { bold: true }; });
  ws.getCell("J" + ttc).font = { bold: true }; ws.getCell("K" + ttc).font = { bold: true };

  /* Sous-détail des prix : décompose le PU du bordereau (liens vivants vers la feuille Bordereau). */
  const sd = wb.addWorksheet("Sous-détail");
  sd.columns = [{ width: 8 }, { width: 55 }, { width: 15 }, { width: 18 }, { width: 18 }, { width: 15 }, { width: 30 }];
  sd.getCell("A1").value = "SOUS-DÉTAIL DES PRIX (brouillon MP, à relire)"; sd.getCell("A1").font = { bold: true, size: 13 };
  sd.getCell("A2").value = ctx.sousDetailMotif || "Articles retenus : ceux demandés par le RC, sinon les plus lourds du bordereau.";
  const sh = sd.getRow(4);
  ["N°", "Désignation", "Fourniture HT (PA)", "Pose et main d'œuvre", "Frais et marge", "PU vente HT", "Remarque"].forEach((t, i) => { sh.getCell(i + 1).value = t; });
  sh.font = { bold: true };
  let sr = 5;
  const lignesBordereau = {};
  for (let rr = premiere; rr <= derniere; rr++) { const v = ws.getCell("A" + rr).value; if (v != null && v !== "") lignesBordereau[String(v)] = rr; }
  for (const num of ctx.sousDetail || []) {
    const lr = lignesBordereau[String(num)]; if (!lr) continue;
    sd.getCell("A" + sr).value = num;
    sd.getCell("B" + sr).value = { formula: "Bordereau!B" + lr }; sd.getCell("B" + sr).alignment = { wrapText: true };
    sd.getCell("C" + sr).value = { formula: 'IF(Bordereau!E' + lr + '="","",Bordereau!E' + lr + ')' };
    sd.getCell("D" + sr).value = 0;
    sd.getCell("E" + sr).value = { formula: 'IF(F' + sr + '="","",F' + sr + '-N(C' + sr + ')-D' + sr + ')' };
    sd.getCell("F" + sr).value = { formula: 'Bordereau!H' + lr };
    sd.getCell("G" + sr).value = "pose à compléter";
    ["C", "D", "E", "F"].forEach((c) => { sd.getCell(c + sr).numFmt = "#,##0.00"; });
    sr++;
  }

  /* Synthèse : estimation, notre prix, écart, PA à confirmer — mêmes cellules que le bordereau. */
  const sy = wb.addWorksheet("Synthèse");
  sy.columns = [{ width: 40 }, { width: 22 }];
  sy.getCell("A1").value = "Synthèse du bordereau"; sy.getCell("A1").font = { bold: true, size: 13 };
  sy.getCell("A3").value = "Estimation du maître d'ouvrage (TTC)"; sy.getCell("B3").value = { formula: "Bordereau!B5" };
  sy.getCell("A4").value = "Notre prix (TTC)"; sy.getCell("B4").value = { formula: "Bordereau!I" + ttc };
  sy.getCell("A5").value = "Écart avec l'estimation"; sy.getCell("B5").value = { formula: "Bordereau!K" + ttc };
  sy.getCell("A6").value = "Nombre de PA à confirmer"; sy.getCell("B6").value = { formula: "Bordereau!K" + (ttc + 1) };
  sy.getCell("B3").numFmt = "#,##0.00"; sy.getCell("B4").numFmt = "#,##0.00"; sy.getCell("B5").numFmt = "+0.00%;-0.00%;0.00%";
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), lignes: { premiere, derniere, ht, tva, ttc } };
}

/* ========================= WORD ========================= */
const POLICE = "Calibri";
function p(texte, o) {
  o = o || {};
  return new Paragraph({ alignment: o.align, spacing: { after: o.after != null ? o.after : 120 }, heading: o.heading,
    children: [new TextRun({ text: String(texte == null ? "" : texte), bold: o.bold, italics: o.italic, size: o.size || 22, font: POLICE, color: o.color })] });
}
function cell(t, w, o) {
  o = o || {};
  return new TableCell({ width: { size: w, type: WidthType.DXA }, shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(t == null ? "" : t).split("\n").map((l) => new Paragraph({ children: [new TextRun({ text: l, bold: o.bold, size: 20, font: POLICE, color: o.color })] })) });
}
function tableau(entetes, lignes, largeurs) {
  const total = largeurs.reduce((a, b) => a + b, 0);
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: largeurs,
    rows: [new TableRow({ tableHeader: true, children: entetes.map((e, i) => cell(e, largeurs[i], { bold: true, fill: "E6ECF7" })) })]
      .concat(lignes.map((l) => new TableRow({ children: l.map((v, i) => cell(v, largeurs[i])) }))) });
}
function identite(soc) {
  soc = soc || {};
  const v = (x) => (x == null || x === "" ? "[à compléter]" : String(x));
  return [
    ["Raison sociale", v(soc.raison_sociale) + (soc.forme_juridique ? " (" + soc.forme_juridique + ")" : "")],
    ["Capital social", v(soc.capital_social)],
    ["Adresse", v([soc.adresse, soc.cp, soc.ville].filter(Boolean).join(" "))],
    ["Registre de commerce", v(soc.rc) + (soc.ville_rc ? " — " + soc.ville_rc : "")],
    ["ICE", v(soc.ice)], ["Identifiant fiscal", v(soc.if)], ["Patente", v(soc.patente)], ["CNSS", v(soc.cnss)],
    ["RIB", v(soc.rib) + (soc.banque ? " — " + soc.banque : "")]
  ];
}
async function documentWord(titre, enfants, ctx) {
  const pied = "Brouillon généré par MP Manager le " + jourFR() + " — à relire et signer avant dépôt. AO n° " + (ctx.ref || "non renseigné");
  const d = new Document({
    creator: "MP Manager", title: titre,
    styles: { default: { document: { run: { font: POLICE, size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [p((ctx.societe && ctx.societe.raison_sociale) || "NEURONES TECHNOLOGIES", { size: 18, color: "4A5672", after: 0 })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: pied + " — page ", size: 16, font: POLICE, color: "4A5672" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, font: POLICE, color: "4A5672" })] })] }) },
      children: [p(titre, { bold: true, size: 30, after: 200 }), p("Appel d'offres n° " + (ctx.ref || "non renseigné") + " — " + (ctx.objet || ""), { size: 22 }),
        p("Maître d'ouvrage : " + (ctx.moa || "non renseigné"), { size: 22, after: 240 })].concat(enfants)
    }]
  });
  return Packer.toBuffer(d);
}
/* Déclaration sur l'honneur : modèle réglementaire générique pré-rempli ; le modèle joint au DCE prime. */
async function declarationHonneur(ctx) {
  const s = ctx.societe || {};
  const lignes = [
    p("Je soussigné : [nom et prénom du signataire], agissant en qualité de [qualité] au nom et pour le compte de " + (s.raison_sociale || "[société]") + ", au capital de " + (s.capital_social || "[capital]") + ",", {}),
    p("adresse du domicile élu : " + ([s.adresse, s.cp, s.ville].filter(Boolean).join(" ") || "[adresse]") + ",", {}),
    p("affiliée à la CNSS sous le n° " + (s.cnss || "[CNSS]") + ", inscrite au registre du commerce de " + (s.ville_rc || "[ville]") + " sous le n° " + (s.rc || "[RC]") + ", n° de patente " + (s.patente || "[patente]") + ", ICE " + (s.ice || "[ICE]") + ", identifiant fiscal " + (s.if || "[IF]") + ",", {}),
    p("titulaire du compte bancaire RIB n° " + (s.rib || "[RIB]") + ",", { after: 200 }),
    p("déclare sur l'honneur :", { bold: true }),
    p("1. m'engager à couvrir, dans les limites fixées dans le cahier des charges, par une police d'assurance, les risques découlant de mon activité professionnelle ;"),
    p("2. que je remplis les conditions prévues par la réglementation des marchés publics pour être admis à concourir ;"),
    p("3. m'engager, si j'envisage de recourir à la sous-traitance, à m'assurer que les sous-traitants remplissent également les conditions prévues par la réglementation et à ne pas sous-traiter plus de la part autorisée du montant du marché, ni le lot ou le corps d'état principal ;"),
    p("4. m'engager à ne pas recourir par moi-même ou par personne interposée à des pratiques de fraude ou de corruption, ni à faire, par moi-même ou par personne interposée, des promesses, des dons ou des présents en vue d'influer sur les procédures de conclusion du marché et de son exécution ;"),
    p("5. ne pas être en situation de conflit d'intérêt ;"),
    p("6. certifier l'exactitude des renseignements contenus dans la présente déclaration sur l'honneur et dans les pièces fournies dans mon dossier de candidature ;"),
    p("7. reconnaître avoir pris connaissance des sanctions prévues par la réglementation des marchés publics, relatives à l'inexactitude de la déclaration sur l'honneur.", { after: 240 }),
    p("Fait à " + (s.ville || "[ville]") + ", le [date]", {}),
    p("Signature et cachet du concurrent : [à signer]", { bold: true, after: 300 }),
    p("Mention de contrôle : texte générique pré-rempli par MP. Le modèle fourni par le maître d'ouvrage dans le DCE prime" + (ctx.modeleDce ? " (" + ctx.modeleDce + ")" : "") + " : le comparer ligne à ligne avant signature.", { italic: true, size: 18, color: "9A5B00" })
  ];
  return documentWord("Déclaration sur l'honneur", lignes, ctx);
}
async function acteEngagement(ctx) {
  const s = ctx.societe || {}, t = ctx.totaux || {};
  const montantTxt = (n) => (n ? fmt(n) + " DH (" + MPEtude.montantEnLettres(n) + ")" : "[à compléter : montant du bordereau]");
  const avert = t.sans_pa ? "Attention : " + t.sans_pa + " article(s) sans PA connu (« à consulter ») ne sont pas chiffrés ; le montant ci-dessous est incomplet tant qu'ils ne le sont pas." : null;
  const enfants = [
    p("A — Partie réservée au maître d'ouvrage", { bold: true }),
    p("Appel d'offres ouvert sur offres de prix n° " + (ctx.ref || "[réf]") + " du [date de la séance d'ouverture]."),
    p("Objet du marché : " + (ctx.objet || "[objet]"), { after: 200 }),
    p("B — Partie réservée au concurrent", { bold: true }),
    p("Je soussigné : [nom et prénom], agissant en qualité de [qualité] au nom et pour le compte de " + (s.raison_sociale || "[société]") + ", au capital de " + (s.capital_social || "[capital]") + ", adresse du siège : " + ([s.adresse, s.cp, s.ville].filter(Boolean).join(" ") || "[adresse]") + ", RC " + (s.rc || "[RC]") + " (" + (s.ville_rc || "[ville]") + "), patente " + (s.patente || "[patente]") + ", CNSS " + (s.cnss || "[CNSS]") + ", ICE " + (s.ice || "[ICE]") + ", IF " + (s.if || "[IF]") + ",", {}),
    p("après avoir pris connaissance du dossier d'appel d'offres et apprécié sous ma responsabilité la nature et les difficultés des prestations à exécuter, remets, revêtu de ma signature, un bordereau des prix et un détail estimatif établis conformément aux cadres figurant au dossier d'appel d'offres, et m'engage à exécuter lesdites prestations conformément au cahier des prescriptions spéciales et moyennant les prix que j'ai établis moi-même, lesquels font ressortir :", {}),
    tableau(["", "Montant"], [["Montant hors TVA", montantTxt(t.ht)], ["Taux de la TVA", "20 %"], ["Montant de la TVA", montantTxt(t.tva)], ["Montant TVA comprise", montantTxt(t.ttc)]], [3600, 6100]),
    p("", {}),
    p("Le maître d'ouvrage se libérera des sommes dues en faisant donner crédit au compte n° " + (s.rib || "[RIB]") + " ouvert auprès de " + (s.banque || "[banque]") + ".", {}),
    p("Fait à " + (s.ville || "[ville]") + ", le [date]   —   Signature et cachet : [à signer]", { bold: true, after: 240 }),
    p("Mention de contrôle : le modèle d'acte d'engagement du DCE prime" + (ctx.modeleDce ? " (" + ctx.modeleDce + ")" : "") + ". Montant en lettres calculé par MP à partir du bordereau chiffré, à recontrôler.", { italic: true, size: 18, color: "9A5B00" })
  ];
  if (avert) enfants.splice(5, 0, p(avert, { bold: true, color: "B3261E" }));
  return documentWord("Acte d'engagement", enfants, ctx);
}
async function memoireWord(ctx) {
  const enfants = [];
  const chap = ctx.memoire || [];
  if (!chap.length) enfants.push(p("La rédaction du mémoire n'a pas été rendue par l'analyse : relancer l'étude.", { color: "B3261E" }));
  for (const c of chap) {
    enfants.push(p(c.num + ". " + c.titre, { bold: true, size: 26, heading: HeadingLevel.HEADING_1, after: 160 }));
    for (const para of c.paragraphes) {
      const src = (para.sources || [])[0];
      enfants.push(p(para.texte, {}));
      if (src) enfants.push(p("Source : " + src.fichier.split("/").pop() + (src.page ? ", p. " + src.page : "") + " — « " + src.extrait.slice(0, 400) + " »", { size: 16, italic: true, color: "4A5672" }));
    }
  }
  return documentWord("Note méthodologique — mémoire technique (" + chap.length + " chapitres)", enfants, ctx);
}
async function moyensMateriels(ctx) {
  const outils = ctx.outillage || [];
  const lignes = outils.map((o) => [o.categorie || "non renseignée", o.designation || "non renseignée", [o.marque, o.modele].filter(Boolean).join(" ") || "non renseignés", o.etat || "non renseigné"]);
  return documentWord("Moyens matériels affectés", [
    p("Liste tirée de l'outillage de Neurones (ERP, lecture seule) le " + jourFR() + " : " + outils.length + " équipement(s).", {}),
    lignes.length ? tableau(["Catégorie", "Désignation", "Marque et modèle", "État"], lignes, [2300, 3600, 2500, 1300]) : p("Aucun outillage enregistré dans l'ERP.", { color: "B3261E" }),
    p("À compléter : appareils de test et de certification exigés par le CPS s'ils ne figurent pas dans la liste.", { italic: true, color: "9A5B00" })
  ], ctx);
}
async function moyensHumains(ctx) {
  const choix = ctx.personnel || [];
  return documentWord("Moyens humains affectés", [
    p(ctx.personnelValide ? "Personnel choisi et validé dans MP." : "PROPOSITION non validée : les noms se choisissent dans l'onglet Dossier (« Choisir les noms »).", { bold: !ctx.personnelValide, color: ctx.personnelValide ? undefined : "B3261E" }),
    choix.length ? tableau(["Nom", "Fonction"], choix.map((x) => [x.nom, x.poste || "non renseignée"]), [5200, 4500]) : p("Aucun nom retenu.", {})
  ], ctx);
}
async function conformiteWord(ctx) {
  const lignes = (ctx.conformite || []).map((c) => [c.num, c.designation || "", c.exigence, "Conforme", c.fourniture === "option" ? "Option à prévoir" : "Standard", c.article || MPEtude.A_VERIFIER]);
  return documentWord("Tableau de conformité", [
    p("Une ligne par article du bordereau des prix. Réponse « Conforme » pour chaque exigence ; la colonne Fourniture distingue ce que le produit fournit en standard de ce qui demande une option.", {}),
    lignes.length ? tableau(["N°", "Article", "Exigence du CPS", "Réponse", "Fourniture", "Source"], lignes, [700, 2300, 3600, 1000, 1100, 1100]) : p("Tableau non rendu par l'analyse : relancer l'étude.", { color: "B3261E" })
  ], ctx);
}
async function bordereauReferencesWord(ctx) {
  const lignes = (ctx.articles || []).map((a) => [a.num, a.designation, "[marque]", "[référence]"]);
  return documentWord("Bordereau des marques et références", [
    p("Limité aux articles du bordereau des prix : une ligne par prix (" + lignes.length + " lignes).", {}),
    tableau(["N° prix", "Désignation", "Marque", "Référence"], lignes, [800, 5600, 1600, 1700])
  ], ctx);
}
async function referencesWord(ctx) {
  const refs = ctx.references || [];
  return documentWord("Références de travaux similaires", [
    p(ctx.referencesValidees ? "Références choisies et validées dans MP." : "PROPOSITION non validée : les 3 marchés les plus proches de l'objet, à valider dans l'onglet Dossier.", { bold: !ctx.referencesValidees, color: ctx.referencesValidees ? undefined : "B3261E" }),
    refs.length ? tableau(["Marché", "Objet", "Maître d'ouvrage", "Montant", "Attestation"], refs.map((r) => [r.ref || "non renseignée", r.objet || "", r.maitre_ouvrage || "non renseigné", r.montant ? fmt(r.montant) + " DH" : "non renseigné", r.attestation || "absente du coffre"]), [1300, 3700, 2000, 1400, 1300]) : p("Aucun marché proche trouvé.", {})
  ], ctx);
}
async function lettreCaution(ctx) {
  const s = ctx.societe || {};
  return documentWord("Demande de caution provisoire", [
    p((s.ville || "[ville]") + ", le " + jourFR(), { align: AlignmentType.RIGHT }),
    p("À l'attention de : " + (ctx.banque || "[banque]") + " — service des engagements par signature", { bold: true }),
    p("Objet : demande d'émission d'une caution provisoire", { bold: true, after: 200 }),
    p("Madame, Monsieur,", {}),
    p("Nous vous prions de bien vouloir émettre, en faveur de " + (ctx.moa || "[maître d'ouvrage]") + ", une caution provisoire d'un montant de " + (ctx.cautionMontant ? fmt(ctx.cautionMontant) + " DH (" + MPEtude.montantEnLettres(ctx.cautionMontant) + ")" : "[montant]") + ", au titre de l'appel d'offres n° " + (ctx.ref || "[réf]") + " ayant pour objet : " + (ctx.objet || "[objet]") + ".", {}),
    p("La date limite de remise des plis est fixée au " + (ctx.dateLimite || "[date]") + ". Nous vous remercions de nous remettre l'original du récépissé avant le [date].", {}),
    p("Veuillez débiter notre compte n° " + (s.rib || "[RIB]") + " des frais correspondants.", {}),
    p("Nous vous prions d'agréer, Madame, Monsieur, nos salutations distinguées.", { after: 300 }),
    p("Pour " + (s.raison_sociale || "[société]") + " — signature et cachet : [à signer]", { bold: true }),
    p("Ce courrier n'est envoyé par personne d'autre que vous : MP le prépare, la banque le reçoit de vos mains.", { italic: true, size: 18, color: "9A5B00" })
  ], ctx);
}
/* Export Word de l'étude : avis, synthèse, clauses, pièces, questions, avec leurs sources. */
async function etudeWord(ctx) {
  const r = ctx.resultat || {};
  const srcTxt = (it) => { const e = MPEtude.etatSource(it); return e.etat === "source" ? e.libelle : e.libelle; };
  const extrait = (it) => (MPEtude.aSource(it) ? "« " + it.sources[0].extrait.slice(0, 300) + " »" : "");
  const enfants = [];
  enfants.push(p("Étude du " + MPEtude.dateFR(ctx.etudeLe) + " sur le DCE du " + MPEtude.dateFR(ctx.dceLe) + " — version " + ctx.version + " (" + (ctx.type === "pre" ? "pré-étude" : "étude complète") + ")", { italic: true }));
  enfants.push(p("1. Avis : " + (r.avis ? MPEtude.AVIS[r.avis.decision] : "non rendu"), { bold: true, size: 26 }));
  if (r.avis && r.avis.resume) enfants.push(p(r.avis.resume));
  (r.conditions || []).forEach((c) => enfants.push(p("Condition : " + c.valeur + " (" + srcTxt(c) + ")")));
  (r.raisons || []).forEach((c) => enfants.push(p("Raison : " + c.valeur + " (" + srcTxt(c) + ")")));
  enfants.push(p("2. Fiche synthèse", { bold: true, size: 26 }));
  enfants.push(tableau(["Donnée", "Valeur", "Source", "Extrait exact"], MPEtude.FAITS.map((f) => {
    const it = (r.faits || {})[f.cle];
    return [f.l, it ? it.valeur : "non relevé", it ? srcTxt(it) : MPEtude.A_VERIFIER, it ? extrait(it) : ""];
  }), [2000, 2400, 1900, 3400]));
  if (ctx.ecarts && ctx.ecarts.length) enfants.push(tableau(["Comparaison avec la fiche AO", "Dossier", "Fiche", "Résultat"], ctx.ecarts.map((e) => [e.libelle, e.dossier, e.fiche, e.ecart ? "ÉCART" : (e.incomplet ? "incomplet" : "identique")]), [3000, 2200, 2200, 2300]));
  if (ctx.eclaircissements) enfants.push(p("Date limite des éclaircissements : " + (ctx.eclaircissements.date ? MPEtude.dateFR(ctx.eclaircissements.date) : "non calculable") + " — " + MPEtude.A_VERIFIER + " (" + ctx.eclaircissements.motif + ")", { color: "9A5B00" }));
  enfants.push(p("3. Clauses", { bold: true, size: 26 }));
  enfants.push(tableau(["Clause", "Ce que dit le dossier", "Pour nous", "Source", "Pourquoi"], (r.clauses || []).map((c) => [MPEtude.libelleDe(MPEtude.CLAUSES, c.cle), c.valeur, (MPEtude.VERDICTS[c.verdict] || {}).l || c.verdict, srcTxt(c), c.pourquoi]), [1700, 2600, 1200, 1700, 2500]));
  enfants.push(p("4. Pièces exigées par le RC (" + (r.pieces || []).length + ")", { bold: true, size: 26 }));
  enfants.push(tableau(["Dossier", "Pièce", "Source"], (r.pieces || []).map((x) => [MPEtude.libelleDe(MPEtude.DOSSIERS, x.dossier), x.piece + (x.precision ? " (" + x.precision + ")" : ""), srcTxt(x)]), [2100, 5400, 2200]));
  enfants.push(p("5. Questions au maître d'ouvrage", { bold: true, size: 26 }));
  (r.questions || []).forEach((q, i) => { enfants.push(p((i + 1) + ". " + q.question)); enfants.push(p("Motif : " + q.motif + " — " + srcTxt(q), { size: 18, color: "4A5672" })); });
  return documentWord("Étude d'AO — brouillon de travail", enfants, ctx);
}

/* ========================= GANTT PDF ========================= */
/* Phases tirées des sections du bordereau, réparties sur le délai d'exécution (en semaines). */
function phasesPlanning(articles, semaines) {
  const sections = [];
  for (const a of articles || []) { const s = a.section || "Travaux"; if (!sections.length || sections[sections.length - 1].nom !== s) sections.push({ nom: s, n: 0 }); sections[sections.length - 1].n++; }
  const total = sections.reduce((x, s) => x + s.n, 0) || 1;
  const util = Math.max(2, semaines - 2);
  const out = [{ nom: "Préparation, études d'exécution, approvisionnements", debut: 0, fin: Math.max(1, Math.round(semaines * 0.15)) }];
  let cur = Math.max(1, Math.round(semaines * 0.1));
  for (const s of sections) {
    const duree = Math.max(1, Math.round(util * s.n / total * 1.6));
    const debut = Math.min(cur, semaines - 2);
    out.push({ nom: s.nom, debut, fin: Math.min(semaines - 1, debut + duree) });
    cur += Math.max(1, Math.round(util * s.n / total * 0.8));
  }
  out.push({ nom: "Essais, mise en service, réception provisoire", debut: Math.max(0, semaines - 2), fin: semaines });
  return out;
}
async function ganttPdf(ctx) {
  const semaines = Math.max(4, ctx.semaines || 12);
  const phases = phasesPlanning(ctx.articles, semaines);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, page = pdf.addPage([W, H]);
  const ascii = (s) => String(s || "").replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/[^\x20-\x7e -ÿ]/g, " ");
  page.drawText(ascii("Planning d'exécution — AO n° " + (ctx.ref || "")), { x: 30, y: H - 40, size: 16, font: bold });
  page.drawText(ascii("Délai : " + semaines + " semaines (" + (ctx.delaiTexte || "délai du dossier") + "). Phases tirées des sections du bordereau. Brouillon MP, à relire."), { x: 30, y: H - 60, size: 12, font });
  // Libellés de phase ENTIERS, repliés sur plusieurs lignes (jamais tronqués) ; texte en 12 pt.
  const x0 = 290, x1 = W - 30, sw = (x1 - x0) / semaines, LARG = x0 - 40;
  const replier = (txt) => {
    const out = []; let cur = "";
    for (const mot of txt.split(/\s+/)) {
      const essai = cur ? cur + " " + mot : mot;
      if (font.widthOfTextAtSize(essai, 12) > LARG && cur) { out.push(cur); cur = mot; } else cur = essai;
    }
    if (cur) out.push(cur);
    return out;
  };
  const blocs = phases.map((ph) => ({ ph, lignes: replier(ascii(ph.nom)) }));
  const entete = (pg, y0) => {
    for (let s = 0; s < semaines; s++) if (semaines <= 26 || s % 2 === 0) pg.drawText("S" + (s + 1), { x: x0 + s * sw + 2, y: y0 + 12, size: 12, font });
  };
  let pg = page, y = H - 95;
  entete(pg, y);
  blocs.forEach((b, i) => {
    const h = Math.max(22, b.lignes.length * 14 + 8);
    if (y - h < 30) { pg = pdf.addPage([W, H]); y = H - 50; entete(pg, y); }
    b.lignes.forEach((l, k) => pg.drawText(l, { x: 30, y: y - 14 - k * 14, size: 12, font }));
    pg.drawRectangle({ x: x0 + b.ph.debut * sw, y: y - 18, width: Math.max(sw * 0.6, (b.ph.fin - b.ph.debut) * sw), height: 12, color: i === blocs.length - 1 ? rgb(0.12, 0.42, 0.27) : rgb(0.11, 0.23, 0.43) });
    for (let s = 0; s <= semaines; s++) pg.drawLine({ start: { x: x0 + s * sw, y: y }, end: { x: x0 + s * sw, y: y - h }, thickness: 0.3, color: rgb(0.8, 0.82, 0.86) });
    y -= h;
  });
  return { buffer: Buffer.from(await pdf.save()), phases };
}

/* ========================= DOSSIER COMPLET (zip) ========================= */
/* pieces : [{ dossier, nom, buffer }] ; sommaire : lignes du dossier (état, origine). */
function zipDossier(ctx) {
  const arbre = {};
  const DOS = { ADMINISTRATIF: "1 - Dossier administratif", TECHNIQUE: "2 - Dossier technique", ADDITIF: "3 - Dossier additif", OFFRE_TECHNIQUE: "4 - Offre technique", FINANCIER: "5 - Offre financiere" };
  const lignes = ["SOMMAIRE DU DOSSIER DE RÉPONSE — AO n° " + (ctx.ref || ""), "Généré par MP Manager le " + jourFR() + ". BROUILLON : rien n'est déposé sans relecture.", ""];
  const c = MPEtude.compteursDossier(ctx.lignes || []);
  lignes.push("Pièces exigées : " + c.exigees + " · prêtes : " + c.pretes + " · à compléter, signer ou envoyer : " + c.a_completer + " · manquantes ou expirées : " + c.manquantes, "");
  let dossierCourant = null;
  for (const l of ctx.lignes || []) {
    if (l.dossier !== dossierCourant) { dossierCourant = l.dossier; lignes.push("", (DOS[l.dossier] || l.dossier).toUpperCase()); }
    const etat = (MPEtude.ETATS_LIGNE[l.etat] || {}).l || l.etat;
    lignes.push("- " + l.piece + " — " + etat + (l.fichier ? " — fichier : " + l.fichier : " — aucun fichier") + (l.detail ? " — " + l.detail : ""));
  }
  arbre["00 - SOMMAIRE.txt"] = strToU8("﻿" + lignes.join("\r\n"));
  for (const pc of ctx.pieces || []) {
    const d = DOS[pc.dossier] || "6 - Autres";
    arbre[d + "/" + pc.nom.replace(/[\\/:*?"<>|]/g, "_")] = new Uint8Array(pc.buffer);
  }
  return Buffer.from(zipSync(arbre, { level: 6 }));
}

module.exports = { bordereauXlsx, declarationHonneur, acteEngagement, memoireWord, moyensMateriels, moyensHumains, conformiteWord,
  bordereauReferencesWord, referencesWord, lettreCaution, etudeWord, ganttPdf, phasesPlanning, zipDossier, identite, COL };
