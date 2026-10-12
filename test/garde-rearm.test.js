/* =========================================================================
 * GATE — Garde de version : réarmement au déploiement + pastille ambre DG.
 * ① PUR (exécute la logique) : MPM.doitRearmerGarde (réarme ssi build déployé
 *    strictement plus récent que gardeBuild ; build illisible -> ne conclut pas ;
 *    gardeBuild absent -> réarme) et MPM.pastilleGardeInactive (DG seul, Inactive
 *    strict). ② CÂBLAGE : /api/version réarme + trace « réarmée par déploiement »
 *    + estampille gardeBuild ; le toggle estampille gardeBuild (sinon Inactive est
 *    vain) ; l'en-tête allume la pastille via la fonction pure.
 *
 * Lancer : node test/garde-rearm.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var MPM = require('../public/pv-mainlevee.js');
var api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
var html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function bloc(src, de, a) { var i = src.indexOf(de); if (i < 0) return ''; var j = src.indexOf(a, i + de.length); return src.slice(i, j > i ? j : undefined); }
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }

console.log('\n=== ① doitRearmerGarde ===');
check('gardeBuild absent + build 42 -> réarme (jamais armé)', MPM.doitRearmerGarde(undefined, 42) === true, '');
check('gardeBuild 42 + build 42 -> NE réarme PAS (le toggle tient)', MPM.doitRearmerGarde(42, 42) === false, '');
check('gardeBuild 42 + build 43 -> réarme (build plus récent)', MPM.doitRearmerGarde(42, 43) === true, '');
check('gardeBuild 42 + build 41 -> NE réarme PAS (build plus ancien)', MPM.doitRearmerGarde(42, 41) === false, '');
check('build illisible (null) -> ne conclut pas (false)', MPM.doitRearmerGarde(42, null) === false, '');
check('build illisible (NaN/0) -> false', MPM.doitRearmerGarde(42, 'xx') === false && MPM.doitRearmerGarde(42, 0) === false, '');
check('types string coercés : "42" vs "43" -> réarme', MPM.doitRearmerGarde('42', '43') === true, '');
check('gardeBuild illisible mais build bon -> réarme', MPM.doitRearmerGarde('abc', 7) === true, '');

console.log('\n=== ① pastilleGardeInactive ===');
check('DG + Inactive(false) -> pastille', MPM.pastilleGardeInactive(true, false) === true, '');
check('DG + Active(true) -> pas de pastille', MPM.pastilleGardeInactive(true, true) === false, '');
check('non-DG + Inactive -> pas de pastille', MPM.pastilleGardeInactive(false, false) === false, '');
check('DG + état inconnu (undefined pendant chargement) -> pas de pastille', MPM.pastilleGardeInactive(true, undefined) === false, '');

console.log('\n=== ② /api/version : réarme + trace + estampille gardeBuild ===');
var ver = bloc(api, 'if (fn === "version")', 'if (fn === "roleGet")');
check('version lit le doc parametres (plus de boucle sur tous les docs)', /item\("parametres", "parametres"\)/.test(ver) && !/items\.readAll\(\)/.test(ver), '');
check('version appelle doitRearmerGarde(gardeBuild, build)', /doitRearmerGarde\(doc\.gardeBuild, vj\.build\)/.test(ver), '');
check('réarmement : trace « réarmée par déploiement » + par déploiement + gardeBuild', /r[eé]arm[eé]e par d[eé]ploiement/.test(ver) && /par: "d[eé]ploiement"/.test(ver) && /doc\.gardeBuild = vj\.build/.test(ver), '');

console.log('\n=== ② toggle : estampille gardeBuild (Inactive tient jusqu\'au déploiement) ===');
var tog = bloc(api, 'if (fn === "gardeVersionToggle")', 'if (fn === "ping"');
check('toggle estampille doc.gardeBuild depuis version.json', /doc\.gardeBuild = vjT\.build/.test(tog) && /require\("\.\/version\.json"\)/.test(tog), '');

console.log('\n=== ② en-tête : pastille via la fonction pure, DG seul ===');
var rb = bloc(html, 'function renderBadgeVersion', 'function renderBandeauVersion');
check('renderBadgeVersion appelle pastilleGardeInactive(S._isDg, …)', /pastilleGardeInactive\(S\._isDg,/.test(rb), '');
check('pastille ambre (#f59e0b) + texte « Garde inactive »', /#f59e0b/.test(rb) && /Garde inactive/.test(rb), '');
check('chargerRole rafraîchit le badge une fois le rôle connu', /S\._isDg=!!r\.isDg;[^}]*renderBadgeVersion\(\)/.test(bloc(html, 'function chargerRole', 'function pgParametres')), '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
