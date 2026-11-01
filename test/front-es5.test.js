/* =========================================================================
 * GATE — le front reste ES5 (contrôle syntaxique, règle du dépôt : ni let/const, ni
 * fonctions fléchées, ni gabarits). Analyse avec acorn (ecmaVersion 5) :
 *  - chaque public/*.js ;
 *  - chaque script en ligne de public/index.html.
 * La gate se prouve elle-même : une fonction fléchée et un « const » DOIVENT être refusés.
 * Nécessite acorn (devDependency racine). Lancer : node test/front-es5.test.js
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
var acorn = require('acorn');
function es5(src) { try { acorn.parse(src, { ecmaVersion: 5 }); return null; } catch (e) { return e.message; } }

console.log('\n=== La gate refuse bien la syntaxe moderne ===');
check('fonction fléchée refusée', !!es5('var f = (a) => a;'));
check('const refusé', !!es5('const a = 1;'));
check('gabarit refusé', !!es5('var s = `x${1}`;'));
check('ES5 accepté', !es5('var f = function (a) { return a; };'));

console.log('\n=== public/*.js ===');
var dir = path.join(__dirname, '..', 'public');
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort().forEach(function (f) {
  var err = es5(fs.readFileSync(path.join(dir, f), 'utf8'));
  check(f + ' est ES5', !err, err);
});
console.log('\n=== scripts en ligne de index.html ===');
var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
var re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, m, n = 0;
while ((m = re.exec(html))) {
  n++;
  var err = es5(m[1]);
  check('script en ligne n° ' + n + ' (ligne ' + html.slice(0, m.index).split('\n').length + ') est ES5', !err, err);
}
check('au moins un script en ligne analysé', n > 0);
console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0);
