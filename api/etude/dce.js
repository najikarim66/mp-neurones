/* Étude d'AO — préparation du DCE : dépliage du zip, classement, lecture du texte par fichier.
 *
 * Le DCE vient UNIQUEMENT du blob dce-zips (déposé par la veille). Ce module ne lit jamais le
 * coffre des documents de la société : ce qui part vers l'API Claude sort d'ici, marqué
 * origine « dce » (gate test/etude-coffre-hors-api.test.js).
 */
"use strict";
const { unzipSync } = require("fflate");
const MPEtude = require("../etude-calc.js");

const MAX_FICHIERS = 400;
const MAX_OCTETS_DEPLIES = 400 * 1024 * 1024;
const SEUIL_PAGE_SCANNEE = 40; // caractères utiles sous lesquels une page est une image

// Noms non UTF-8 dans les zips Windows : page de code OEM 437/850 (é = 0x82).
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
function nomLisible(nom) {
  // fflate rend un nom sans drapeau UTF-8 en latin-1. Si ces octets forment de l'UTF-8 valide
  // (zip créé sans le drapeau), on le relit en UTF-8 ; sinon en OEM 437.
  const utf = Buffer.from(nom, "latin1").toString("utf8");
  if (utf.indexOf("�") < 0) return utf;
  let fixe = "";
  for (let i = 0; i < nom.length; i++) {
    const c = nom.charCodeAt(i);
    fixe += c >= 0x80 && c <= 0xff ? CP437.charAt(c - 0x80) : nom.charAt(i);
  }
  return fixe;
}

/* Déplie le zip (et les zips imbriqués, 2 niveaux). Renvoie [{ chemin, octets }] + écartés avec motif. */
function deplier(buf, prefixe, profondeur, acc) {
  acc = acc || { fichiers: [], ecartes: [], total: 0 };
  profondeur = profondeur || 0;
  let entrees;
  try {
    entrees = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        if (acc.fichiers.length + acc.ecartes.length > MAX_FICHIERS) return false;
        acc.total += f.originalSize || 0;
        return acc.total <= MAX_OCTETS_DEPLIES;
      }
    });
  } catch (e) {
    acc.ecartes.push({ chemin: prefixe || "DCE", motif: "archive illisible (" + e.message + ")" });
    return acc;
  }
  for (const brut of Object.keys(entrees)) {
    const nom = /[\u0080-ÿ]/.test(brut) ? nomLisible(brut) : brut;
    const chemin = (prefixe ? prefixe + "/" : "") + nom;
    const oct = entrees[brut];
    if (/\/$/.test(brut)) continue;
    const cl = MPEtude.classerFichier(chemin);
    if (cl.classe === "archive") {
      if (profondeur >= 2) { acc.ecartes.push({ chemin, motif: "archive imbriquée trop profonde" }); continue; }
      deplier(Buffer.from(oct), chemin.replace(/\.zip$/i, ""), profondeur + 1, acc);
      continue;
    }
    if (cl.classe === "ignore") { acc.ecartes.push({ chemin, motif: cl.motif }); continue; }
    acc.fichiers.push({ chemin, octets: Buffer.from(oct), classe: cl.classe, motif: cl.motif });
  }
  if (acc.total > MAX_OCTETS_DEPLIES) acc.ecartes.push({ chemin: prefixe || "DCE", motif: "dépliage arrêté au-delà de 400 Mo" });
  return acc;
}

/* Texte avec repères de page « === Page N === » : la page d'une citation se retrouve par l'index du caractère. */
function avecPages(pagesTexte) {
  let texte = "";
  const pages = [];
  pagesTexte.forEach((t, i) => {
    texte += (texte ? "\n\n" : "") + "=== Page " + (i + 1) + " ===\n";
    pages.push({ num: i + 1, debut: texte.length });
    texte += String(t || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  });
  return { texte, pages };
}

async function lirePdf(oct) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(oct));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const scannees = [];
  text.forEach((t, i) => { if (String(t || "").replace(/\s/g, "").length < SEUIL_PAGE_SCANNEE) scannees.push(i + 1); });
  return { pagesTexte: text, pages_total: totalPages, pages_scannees: scannees };
}

function xmlTexte(xml) {
  return String(xml)
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:tc>/g, " | ").replace(/<\/w:tr>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n /g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function lireDocx(oct) {
  const z = unzipSync(new Uint8Array(oct), { filter: (f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name) });
  const doc = z["word/document.xml"];
  if (!doc) throw new Error("document.xml absent");
  return xmlTexte(Buffer.from(doc).toString("utf8"));
}
async function lireDoc(oct) {
  const WordExtractor = require("word-extractor");
  const d = await new WordExtractor().extract(Buffer.from(oct));
  return String(d.getBody() || "").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function lireTableur(oct) {
  const XLSX = require("xlsx");
  const wb = XLSX.read(Buffer.from(oct), { type: "buffer", cellFormula: false, cellHTML: false, cellText: false, dense: false });
  const feuilles = wb.SheetNames.map((nom) => {
    const ws = wb.Sheets[nom];
    const lignes = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: "" });
    return { nom, lignes: lignes.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c))) };
  });
  return feuilles;
}
/* Rendu texte d'un tableur pour l'analyse : une ligne « [feuille X, ligne N] a | b | c », lignes vides omises. */
function tableurEnTexte(feuilles) {
  let texte = "";
  const pages = [];
  feuilles.forEach((f, i) => {
    texte += (texte ? "\n\n" : "") + "=== Page " + (i + 1) + " ===\n[Feuille « " + f.nom + " »]\n";
    pages.push({ num: i + 1, debut: texte.length, feuille: f.nom });
    f.lignes.forEach((r, j) => {
      const cells = r.map((c) => String(c == null ? "" : c).replace(/\s+/g, " ").trim());
      if (!cells.some((c) => c)) return;
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      texte += "[ligne " + (j + 1) + "] " + cells.join(" | ") + "\n";
    });
  });
  return { texte, pages };
}

/* Lit chaque fichier retenu. lecture : texte | ocr (pages images : transcription par l'analyse) | tableur | non_lu (motif). */
async function lireFichiers(fichiers) {
  const docs = [];
  for (const f of fichiers) {
    const ext = (f.chemin.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    const d = { fichier: f.chemin, classe: f.classe, motif_classe: f.motif, format: ext, taille: f.octets.length, origine: "dce",
      lecture: "non_lu", motif_lecture: null, pages_total: null, pages_scannees: [], texte: "", pages: [], feuilles: null, octets: f.octets };
    try {
      if (f.classe === "plans") { d.motif_lecture = "plan ou image : non étudié"; docs.push(d); continue; }
      if (ext === "pdf") {
        const p = await lirePdf(f.octets);
        d.pages_total = p.pages_total; d.pages_scannees = p.pages_scannees;
        const tp = avecPages(p.pagesTexte); d.texte = tp.texte; d.pages = tp.pages;
        d.lecture = p.pages_scannees.length > Math.max(1, p.pages_total * 0.3) ? "ocr" : "texte";
        if (d.lecture === "ocr") d.motif_lecture = p.pages_scannees.length + " page(s) sur " + p.pages_total + " sans texte : lues par OCR";
      } else if (ext === "docx") {
        const tp = avecPages([lireDocx(f.octets)]); d.texte = tp.texte; d.pages = []; d.lecture = "texte"; d.pages_total = null;
      } else if (ext === "doc") {
        const tp = avecPages([await lireDoc(f.octets)]); d.texte = tp.texte; d.pages = []; d.lecture = "texte";
      } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        d.feuilles = lireTableur(f.octets);
        const tp = tableurEnTexte(d.feuilles); d.texte = tp.texte; d.pages = tp.pages; d.lecture = "tableur";
      } else if (ext === "txt") {
        const tp = avecPages([f.octets.toString("utf8")]); d.texte = tp.texte; d.lecture = "texte";
      } else {
        d.motif_lecture = "format ." + ext + " non lu";
      }
      if (d.lecture === "texte" && !d.texte.replace(/=== Page \d+ ===/g, "").replace(/\s/g, "")) { d.lecture = "non_lu"; d.motif_lecture = "aucun texte lisible"; }
    } catch (e) {
      d.lecture = "non_lu"; d.motif_lecture = "lecture impossible : " + e.message;
    }
    docs.push(d);
  }
  return docs;
}

module.exports = { deplier, lireFichiers, avecPages, tableurEnTexte, xmlTexte, nomLisible, SEUIL_PAGE_SCANNEE };
