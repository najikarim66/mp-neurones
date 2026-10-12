/* =========================================================================
 * GATE — Invariant marcheId cote API + PATCH cible du rattachement d'acte.
 * Verrou de cablage (node pur) complementaire des gates PURES red-first
 * MPM.cautionMarcheIdValide et MPM.patchActeOps (pv-mainlevee.test.js 20 & 21) :
 *  ① /api/data refuse une caution sans marcheId (POST et PUT) ;
 *  ② le rattachement d'acte (cautionActeCompare) ecrit par .patch (/acte seul),
 *     PAS par upsert de l'objet caution entier (anti-clobber : aucun autre champ).
 *
 * Lancer : node test/acte-invariant-patch.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var dataSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'data', 'index.js'), 'utf8');
var apiSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
function bloc(src, de, a) { var i = src.indexOf(de); if (i < 0) return ''; var j = src.indexOf(a, i + de.length); return src.slice(i, j > i ? j : undefined); }

var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }

console.log('\n=== ① /api/data refuse une caution sans marcheId (POST + PUT) ===');
check('data/index.js charge le module pur', /require\(["']\.\.\/pv-mainlevee\.js["']\)/.test(dataSrc), '');
var nbGardes = (dataSrc.match(/mp_cautions"\s*&&\s*!MPMainlevee\.cautionMarcheIdValide/g) || []).length;
check('garde cautionMarcheIdValide presente 2 fois (POST + PUT)', nbGardes >= 2, 'occurrences=' + nbGardes);

console.log('\n=== ② Rattachement d\'acte par PATCH cible, pas upsert objet entier ===');
var cmp = bloc(apiSrc, '"cautionActeCompare"', 'if (fn === "ocrComparaison"');
check('bloc cautionActeCompare localise', cmp.length > 200, 'len=' + cmp.length);
check('utilise .patch(MPMainlevee.patchActeOps(...))', /\.patch\(MPMainlevee\.patchActeOps\(/.test(cmp), '');
check('n\'upsert PAS la caution entiere pour l\'acte (anti-clobber)', cmp.indexOf('caution.acte = acte') < 0 && !/items\.upsert\(caution\)/.test(cmp), '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
