/* =========================================================================
 * GATE — Appariement d'un acte a une caution (module pur, « Rapprochement des
 * actes »). Premier match SUR gagne (step 4) :
 *   doublon_hash > (a) N° normalise > (b) type+banque+montant sans acte > (c) sans
 *   correspondance. « deja un acte » = refus nomme. Ambiguite -> « a_choisir »,
 *   jamais une proposition au hasard.
 *
 * Fixtures reelles du step 9 : 694066 (ecart de format de vendredi), ambiguite
 * banque+montant sur DEUX marches, provisoire portee par un AO attribue.
 *
 * Lancer : node test/apparier-acte.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPM = require('../public/pv-mainlevee.js');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }

var marches = [
  { id: 'm1', ref: 'AO-12/2025', objet: 'Fourniture equipements', titre: 'Fourniture equipements', maitre_ouvrage: 'ONEE' },
  { id: 'm2', ref: '45/2024', objet: 'Travaux batiment', maitre_ouvrage: 'ANP' }
];
// candidats unifies (le caller fusionne mp_cautions + a.caution_prov)
var cands = [
  { kind: 'caution', id: 'c1', marcheId: 'm1', num: '694066', banque: 'BMCE Bank', montant: 36249, type: 'bonne_execution', acte: null },
  { kind: 'caution', id: 'c2', marcheId: 'm1', num: 'RG-1', banque: 'CIH', montant: 50000, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'c3', marcheId: 'm2', num: 'RG-2', banque: 'CIH', montant: 50000, type: 'retenue_garantie', acte: null }, // meme type+banque+montant que c2, AUTRE marche
  { kind: 'caution', id: 'c4', marcheId: 'm1', num: 'DEF-9', banque: 'ATW', montant: 99999, type: 'bonne_execution', acte: { blob: 'actes/abcdef1234.pdf' } }, // a deja un acte
  { kind: 'provisoire', id: 'p1', aoId: 'ao1', marcheId: 'm1', num: 'PROV-7', banque: 'FINEA', montant: 12000, type: 'soumission', acte: null }
];

console.log('\n=== (a) N° normalise — 694066, l\'ecart de format de vendredi ===');
['694 066', '0694066', '694-066', 'bl694066'.replace('bl', '')].forEach(function (v) {
  check('num « ' + v + " » -> caution c1 (mode a)", (function () { var r = MPM.apparierActe({ num: v }, 'H', cands, marches); return r.mode === 'a' && r.cible && r.cible.id === 'c1'; })(), '');
});

console.log('\n=== doublon hash + deja un acte ===');
check('hash deja rattache -> doublon_hash, cible nommee', (function () { var r = MPM.apparierActe({ num: 'DEF-9' }, 'abcdef1234', cands, marches); return r.mode === 'doublon_hash' && r.cible && r.cible.id === 'c4'; })(), '');
check('N° matche une caution qui a DEJA un (autre) acte -> deja_acte (refus)', (function () { var r = MPM.apparierActe({ num: 'DEF-9' }, 'nouveauhash', cands, marches); return r.mode === 'deja_acte' && r.cible && r.cible.id === 'c4'; })(), '');

console.log('\n=== (b) type+banque+montant, ambiguite sur DEUX marches ===');
check('pas de N°, type+banque+montant sur 2 marches, aucun marche lu -> a_choisir (c2,c3)', (function () { var r = MPM.apparierActe({ num: 'ZZZ', type: 'retenue_garantie', banque: 'CIH', montant: 50000 }, 'H', cands, marches); var ids = (r.candidates || []).map(function (x) { return x.id; }).sort().join(','); return r.mode === 'a_choisir' && ids === 'c2,c3'; })(), '');
check('… avec le marche LU (45/2024) -> departage sur c3 (mode b)', (function () { var r = MPM.apparierActe({ num: 'ZZZ', type: 'retenue_garantie', banque: 'CIH', montant: 50000, marche_ref: '45/2024' }, 'H', cands, marches); return r.mode === 'b' && r.cible && r.cible.id === 'c3'; })(), '');
check('type different -> ne matche pas en (b) (le type departage)', (function () { var r = MPM.apparierActe({ num: 'ZZZ', type: 'bonne_execution', banque: 'CIH', montant: 50000 }, 'H', cands, marches); return r.mode !== 'b' && r.mode !== 'a_choisir'; })(), '');

console.log('\n=== provisoire portee par un AO attribue ===');
check('num PROV 7 -> provisoire p1 (mode a, kind provisoire)', (function () { var r = MPM.apparierActe({ num: 'PROV 7' }, 'H', cands, marches); return r.mode === 'a' && r.cible && r.cible.kind === 'provisoire' && r.cible.id === 'p1'; })(), '');

console.log('\n=== (c) sans correspondance -> marche propose + creation cas A ===');
check('num inconnu + marche lu 45/2024 -> mode c, marche propose m2', (function () { var r = MPM.apparierActe({ num: 'INCONNU-999', marche_ref: '45/2024' }, 'H', cands, marches); return r.mode === 'c' && r.marchePropose && r.marchePropose.id === 'm2'; })(), '');
check('num inconnu, marche illisible -> mode c, marche propose null (a choisir)', (function () { var r = MPM.apparierActe({ num: 'INCONNU-999' }, 'H', cands, marches); return r.mode === 'c' && !r.marchePropose; })(), '');

console.log('\n=== normaliserNumCaution ===');
check('norm : MAJ, sans espaces/tirets/slash/point', MPM.normaliserNumCaution(' a-12/34.5 ') === 'A12345', MPM.normaliserNumCaution(' a-12/34.5 '));

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
