/* =========================================================================
 * GATE - Copie unique du module de regle metier.
 *
 * SWA deploie /public et /api separement : l'API ne peut pas require('../public').
 * On committe donc une copie de public/pv-mainlevee.js dans api/. Cette gate
 * interdit qu'elles DIVERGENT (deux implementations de la meme regle dans le
 * meme depot = ce qu'on a paye ailleurs). Comparaison octet a octet.
 *
 * Lancer : node test/module-copy.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'public', 'pv-mainlevee.js');
var CPY = path.join(__dirname, '..', 'api', 'pv-mainlevee.js');

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}

console.log('\n=== Copie api/pv-mainlevee.js == public/pv-mainlevee.js ===');
var okSrc = fs.existsSync(SRC), okCpy = fs.existsSync(CPY);
check('public/pv-mainlevee.js existe', okSrc, SRC);
check('api/pv-mainlevee.js existe', okCpy, CPY);
if (okSrc && okCpy) {
  var a = fs.readFileSync(SRC), b = fs.readFileSync(CPY);
  check('les deux fichiers sont identiques octet a octet', a.equals(b),
    'tailles ' + a.length + ' vs ' + b.length + ' — resynchroniser : cp public/pv-mainlevee.js api/pv-mainlevee.js');
}

// Même règle pour le module des relevés banque (lecteurs + contrôles + rapprochement) :
// l'aperçu du navigateur et le recalcul serveur doivent être la MÊME implémentation.
var SRC2 = path.join(__dirname, '..', 'public', 'releves-banque.js');
var CPY2 = path.join(__dirname, '..', 'api', 'releves-banque.js');
console.log('\n=== Copie api/releves-banque.js == public/releves-banque.js ===');
var okSrc2 = fs.existsSync(SRC2), okCpy2 = fs.existsSync(CPY2);
check('public/releves-banque.js existe', okSrc2, SRC2);
check('api/releves-banque.js existe', okCpy2, CPY2);
if (okSrc2 && okCpy2) {
  var a2 = fs.readFileSync(SRC2), b2 = fs.readFileSync(CPY2);
  check('les deux fichiers sont identiques octet a octet', a2.equals(b2),
    'tailles ' + a2.length + ' vs ' + b2.length + ' — resynchroniser : cp public/releves-banque.js api/releves-banque.js');
}

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
