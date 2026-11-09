#!/usr/bin/env node
// Extension .cjs : une appli dont le package.json porte « type: module » (web RH, ERP) doit pouvoir le lancer tel quel (CommonJS).
"use strict";
/**
 * verifier-copie.cjs — GATE DE DÉRIVE DE LA COPIE DE LA CHARTE (dans chaque appli, en CI).
 * La copie charte/ doit être EXACTEMENT la version de référence qu'elle déclare (MANIFESTE.json : version, commit du dépôt de charte,
 * empreinte de chaque fichier). Un fichier modifié à la main dans la copie, absent, ou un manifeste périmé : ROUGE, nommé.
 * Les empreintes se prennent sur le contenu normalisé (CRLF -> LF, BOM retiré) : un artefact de plateforme n'est pas une dérive (§46).
 * Option --reference <dossier du dépôt de charte> : compare EN PLUS chaque fichier à la référence vivante (sur le PC ; en CI, la
 * référence est un dépôt privé distinct — la comparaison porte alors sur la version déclarée).
 * CLI : node charte/outils/verifier-copie.cjs [--copie <dossier charte/>] [--reference <dossier>]
 * Autonome : ce fichier ne dépend que de lui-même (il est lui-même dans la distribution et dans le manifeste).
 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const argv = process.argv.slice(2), arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const COPIE = path.resolve(arg("--copie") || path.join(__dirname, ".."));
const REF = arg("--reference") ? path.resolve(arg("--reference")) : null;
const BINAIRE = /\.(png|jpe?g|woff2?|ico)$/i;
const normalise = (fichier) => { let b = fs.readFileSync(fichier); if (!BINAIRE.test(fichier)) { let s = b.toString("utf8"); if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); b = Buffer.from(s.replace(/\r\n/g, "\n"), "utf8"); } return b; };
const empreinte = (fichier) => crypto.createHash("sha256").update(normalise(fichier)).digest("hex");

let ko = 0; const dire = (ok, l) => { console.log((ok ? "ok  - " : "KO  - ") + l); if (!ok) ko++; };
let m = null;
try { m = JSON.parse(fs.readFileSync(path.join(COPIE, "MANIFESTE.json"), "utf8")); } catch (e) { dire(false, "MANIFESTE.json lisible dans " + COPIE); }
if (m) {
  console.log("Copie de la charte " + (m.charte || "?") + " v" + (m.version || "?") + " — référence : " + (m.source ? m.source.depot + " " + String(m.source.commit).slice(0, 7) + " (" + m.source.date + ")" : "NON DÉCLARÉE"));
  dire(!!(m.source && /^[0-9a-f]{40}$/.test(String(m.source.commit))), "le manifeste déclare le commit de référence du dépôt de charte");
  const fichiers = Object.keys(m.fichiers || {});
  dire(fichiers.length > 0, "le manifeste liste des fichiers (" + fichiers.length + ")");
  for (const f of fichiers) {
    const p = path.join(COPIE, f);
    if (!fs.existsSync(p)) { dire(false, f + " : ABSENT de la copie"); continue; }
    const e = empreinte(p);
    dire(e === m.fichiers[f], f + " : empreinte = manifeste" + (e === m.fichiers[f] ? "" : " (copie modifiée localement : recopier depuis la référence, jamais corriger la copie à la main)"));
    if (REF) {
      const r = path.join(REF, f);
      if (!fs.existsSync(r)) dire(false, f + " : absent de la référence " + REF);
      else dire(normalise(r).equals(normalise(p)), f + " : identique à la référence vivante");
    }
  }
  if (REF) {
    try { const tr = JSON.parse(fs.readFileSync(path.join(REF, "tokens.json"), "utf8")); dire(tr.version === m.version, "version de la référence vivante (" + tr.version + ") = version copiée (" + m.version + ")"); } catch (e) { dire(false, "tokens.json de la référence lisible"); }
  }
}
// Contre-épreuve : le comparateur mord sur un octet changé.
{ const a = Buffer.from("abc\n"), b = Buffer.from("abd\n"); dire(!a.equals(b) && crypto.createHash("sha256").update(a).digest("hex") !== crypto.createHash("sha256").update(b).digest("hex"), "contre-épreuve : un octet changé est vu"); }
console.log(ko ? "########## " + ko + " KO — la copie de la charte DIVERGE de sa référence" : "########## TOUT VERT — la copie de la charte est conforme à sa référence");
process.exit(ko ? 1 : 0);
