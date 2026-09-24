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

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
