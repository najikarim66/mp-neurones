/* =========================================================================
 * GATE - Le bundle ne contient AUCUNE trace d'autolink ni de l'ERP.
 *
 * Decision Karim (retrait autolink) : la mesure ERP montre 0 ecriture
 * autolink depuis le 18/05 ; le rattachement client se fait a la main
 * (2 marches depuis #11, tous lies). L'appel automatique est retire.
 * Cette gate interdit qu'une reference reapparaisse dans ce qui part au
 * navigateur (public/) : ni le mot "autolink", ni le domaine ERP.
 *
 * "Gate rouge d'abord" : ecrite AVANT la suppression, elle doit d'abord
 * echouer sur l'arbre courant, puis passer une fois le code retire.
 *
 * Lancer : node test/no-autolink-bundle.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

var BUNDLE = [
  path.join(__dirname, '..', 'public', 'index.html'),
  path.join(__dirname, '..', 'public', 'pv-mainlevee.js')
];
var INTERDITS = [
  { nom: 'autolink', re: /autolink/i },
  { nom: 'erp.neurones.ma', re: /erp\.neurones\.ma/i }
];

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}

console.log('\n=== Bundle sans autolink ni ERP (public/) ===');
BUNDLE.forEach(function (f) {
  var rel = path.relative(path.join(__dirname, '..'), f);
  var txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  check(rel + ' existe', !!txt, f);
  var lignes = txt.split(/\r?\n/);
  INTERDITS.forEach(function (it) {
    var hits = [];
    lignes.forEach(function (l, i) { if (it.re.test(l)) hits.push(i + 1); });
    check(rel + ' : aucune reference "' + it.nom + '"', hits.length === 0, 'lignes ' + hits.join(', '));
  });
});

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
