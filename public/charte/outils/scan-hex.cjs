#!/usr/bin/env node
// Extension .cjs : une appli dont le package.json porte « type: module » (web RH, ERP) doit pouvoir le lancer tel quel (CommonJS).
"use strict";
/**
 * scan-hex.cjs — GATE « AUCUN HEX DE COULEUR HORS DES VARIABLES », AVEC CLIQUET (comme sur le web RH).
 * Compte, dans chaque fichier nommé par le cliquet, les couleurs en dur : #hex (3, 4, 6 ou 8 chiffres), rgb()/rgba()/hsl()/hsla(),
 * hors commentaires (/* *\/, //, <!-- -->) et hors lignes qui DÉCLARENT un jeton (« --nom: #hex » — c'est là que les hex vivent).
 * Le cliquet (JSON { "fichiers": { "<chemin>": <plafond> } }) fixe le nombre admis par fichier : 0 pour l'en-tête, le menu et les écrans
 * migrés ; le compte du jour pour un écran pas encore migré. ROUGE si un fichier dépasse son plafond, ou manque. Un fichier qui descend
 * sous son plafond est signalé ; --maj abaisse les plafonds au compte réel (le cliquet ne remonte jamais par cet outil : un hex de plus
 * se décide, il ne glisse pas).
 * CLI : node charte/outils/scan-hex.cjs --cliquet <fichier.json> [--racine <dossier>] [--maj]
 * Autonome : aucune dépendance.
 */
const fs = require("fs"), path = require("path");
const argv = process.argv.slice(2), arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const RACINE = path.resolve(arg("--racine") || process.cwd());
const CLIQUET = arg("--cliquet");

const MOTIF = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![\w-])|\b(?:rgb|rgba|hsl|hsla)\s*\(/g;
const DECLARATION = /^\s*--[\w-]+\s*:/;              // une ligne qui déclare une variable CSS porte légitimement un hex
const DECLARATION_JS = /^\s*["']?[\w-]+["']?\s*:\s*["']#[0-9a-fA-F]{3,8}["']\s*,?\s*(\/\/.*)?$/; // « clé: '#hex', » d'un fichier de jetons (tailwind.config, tokens)

function sansCommentaires(texte) {
  return String(texte)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'\\])\/\/(?![^\n]*["'`][^\n]*\))[^\n]*/gm, "$1"); // drapeau m : « ^ » vaut en début de CHAQUE ligne (contre-épreuve rouge en CI MP et ERP le 09/11 sans lui)
}
/** Compte les couleurs en dur d'un texte ; rend { total, lignes: [{ligne, occurrence}] }. jetons=true : les lignes de déclaration de jetons sont admises. */
function compter(texte, jetons) {
  const L = [];
  sansCommentaires(texte).split(/\r?\n/).forEach((ligne, i) => {
    if (DECLARATION.test(ligne)) return;
    if (jetons && DECLARATION_JS.test(ligne)) return;
    for (const m of ligne.matchAll(MOTIF)) L.push({ ligne: i + 1, occurrence: m[0] });
  });
  return { total: L.length, lignes: L };
}
module.exports = { compter, sansCommentaires };

if (require.main === module) {
  let ko = 0; const dire = (ok, l) => { console.log((ok ? "ok  - " : "KO  - ") + l); if (!ok) ko++; };
  // Contre-épreuve (#20 ter) : le scanner mord, et il ignore ce qu'il doit ignorer.
  // La déclaration d'un jeton tient sur SA ligne (comme dans tokens.css) : c'est cette forme que le scanner admet.
  const c1 = compter('<div style="color:#1F4E78;background:rgba(0,0,0,.5)">x</div>\n:root {\n  --a: #FFF;\n}\n// #abc en commentaire\n/* #abcdef */\n');
  dire(c1.total === 2, "contre-épreuve : 2 couleurs en dur vues (hex et rgba), déclaration et commentaires ignorés" + (c1.total === 2 ? "" : " — vu " + c1.total));
  const c2 = compter("  --nav-fond: #004186;\n  color: var(--nav-fond);\n");
  dire(c2.total === 0, "contre-épreuve : une déclaration de variable n'est pas une couleur en dur");
  if (!CLIQUET) { console.log("usage : node scan-hex.cjs --cliquet <fichier.json> [--racine <dossier>] [--maj]"); process.exit(ko ? 1 : 2); }
  const cheminCliquet = path.resolve(RACINE, CLIQUET);
  const cliquet = JSON.parse(fs.readFileSync(cheminCliquet, "utf8"));
  const fichiers = cliquet.fichiers || {};
  let change = false;
  for (const [f, plafond] of Object.entries(fichiers)) {
    const p = path.join(RACINE, f);
    if (!fs.existsSync(p)) { dire(false, f + " : fichier du cliquet ABSENT (retirer la ligne du cliquet si l'écran a disparu)"); continue; }
    const r = compter(fs.readFileSync(p, "utf8"), /tokens|tailwind\.config/.test(f));
    const ok = r.total <= plafond;
    dire(ok, f + " : " + r.total + " couleur(s) en dur, plafond " + plafond + (ok ? (r.total < plafond ? " — le cliquet peut descendre à " + r.total : "") : " — DÉPASSÉ : " + r.lignes.filter((x) => true).slice(0, 6).map((x) => "l." + x.ligne + " " + x.occurrence).join(", ")));
    if (r.total < plafond && argv.includes("--maj")) { fichiers[f] = r.total; change = true; }
  }
  if (change) { fs.writeFileSync(cheminCliquet, JSON.stringify({ ...cliquet, fichiers }, null, 2) + "\n"); console.log("cliquet abaissé et écrit : " + cheminCliquet); }
  const total = Object.values(fichiers).reduce((a, b) => a + b, 0);
  console.log("Cliquet : " + Object.keys(fichiers).length + " fichier(s), " + total + " couleur(s) en dur admise(s) au total.");
  console.log(ko ? "########## " + ko + " KO" : "########## TOUT VERT");
  process.exit(ko ? 1 : 0);
}
