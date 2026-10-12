/* =========================================================================
 * GATE « 20 marchés » — cas de référence GLOBAL : un seul dépôt, 20 actes de
 * marchés différents, chaque ligne affectée à SON marché sans que l'utilisateur
 * choisisse. Prouve apparierActe (module pur) sur 20 fixtures :
 *   · 11 actes RÉELS de vendredi (num/banque/montant/type + réf marché), couvrant
 *     7 marchés distincts -> appariement par N° (caution existante), mode 'a' ;
 *   · 9 fixtures construites (cautions NOUVELLES, cas A) -> marché lu sur l'acte :
 *     référence normalisée, puis objet, puis maître d'ouvrage -> mode 'c' + marché proposé.
 * Zéro « à choisir » quand l'acte porte la référence du marché ; « à choisir »
 * SEULEMENT sans référence et ambiguïté banque+montant sur deux marchés.
 *
 * Lancer : node test/rapprochement-20-marches.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPM = require('../public/pv-mainlevee.js');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }

// 7 marchés réels (des 11 actes de vendredi) + 9 marchés pour les nouvelles cautions
var marches = [
  { id: 'm649', ref: '13/2025', objet: 'FOURNITURE, INSTALLATION ET MISE EN', maitre_ouvrage: 'ONP' },
  { id: 'm0', ref: '04/INDH/2025', objet: 'Travaux d electrification du centre', maitre_ouvrage: 'GOUVERNEUR DE LA PROVINCE' },
  { id: 'm893', ref: '137/CAM/2024', objet: 'ACQUISITION, INSTALLATION ET MAINTE', maitre_ouvrage: 'CAM' },
  { id: 'm545', ref: '75/2024', objet: 'Lot n 3 : Travaux d amenagement', maitre_ouvrage: 'DGAPR' },
  { id: 'm67', ref: 'CNER 08/2024', objet: 'Achat de materiels et de logiciels', maitre_ouvrage: 'CNER' },
  { id: 'm80', ref: '18/2026', objet: 'Fourniture installation et configu', maitre_ouvrage: 'ONP' },
  { id: 'm12', ref: '19/2026', objet: 'Fourniture et installation du mater', maitre_ouvrage: 'ONP' },
  { id: 'n1', ref: 'NV-01/2026', objet: 'Marche neuf un', maitre_ouvrage: 'MO-N1' },
  { id: 'n2', ref: 'NV-02/2026', objet: 'Marche neuf deux', maitre_ouvrage: 'MO-N2' },
  { id: 'n3', ref: 'NV-03/2026', objet: 'Marche neuf trois', maitre_ouvrage: 'MO-N3' },
  { id: 'n4', ref: 'NV-04/2026', objet: 'Marche neuf quatre', maitre_ouvrage: 'MO-N4' },
  { id: 'n5', ref: 'NV-05/2026', objet: 'Marche neuf cinq', maitre_ouvrage: 'MO-N5' },
  { id: 'n6', ref: 'NV-06/2026', objet: 'Marche neuf six', maitre_ouvrage: 'MO-N6' },
  { id: 'n7', ref: 'NV-07/2026', objet: 'Climatisation data center unique', maitre_ouvrage: 'MO-N7' }, // resolu par OBJET
  { id: 'n8', ref: 'NV-08/2026', objet: 'Marche neuf huit', maitre_ouvrage: 'OFFICE SINGULIER XYZ' },   // resolu par MO
  { id: 'n9', ref: 'NV-09/2026', objet: 'Marche neuf neuf', maitre_ouvrage: 'MO-N9' }
];
// 11 cautions existantes (acte null) = les 11 de vendredi
var cands = [
  { kind: 'caution', id: 'c1', marcheId: 'm649', num: '221039', banque: 'FINEA', montant: 111124, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'c2', marcheId: 'm0', num: '200972', banque: 'FINEA', montant: 48000, type: 'bonne_execution', acte: null },
  { kind: 'caution', id: 'c3', marcheId: 'm893', num: '03183052U', banque: 'Attijariwafa Bank', montant: 108000, type: 'bonne_execution', acte: null },
  { kind: 'caution', id: 'c4', marcheId: 'm545', num: '185594', banque: 'FINEA', montant: 72349, type: 'bonne_execution', acte: null },
  { kind: 'caution', id: 'c5', marcheId: 'm545', num: '198084', banque: 'FINEA', montant: 168815, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'c6', marcheId: 'm545', num: '694066', banque: 'BMCE Bank', montant: 13088, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'c7', marcheId: 'm67', num: '8105029161', banque: 'Banque Populaire', montant: 17838, type: 'bonne_execution', acte: null },
  { kind: 'caution', id: 'c8', marcheId: 'm67', num: '8105029419', banque: 'Banque Populaire', montant: 41622, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'c9', marcheId: 'm0', num: '229100', banque: 'FINEA', montant: 112000, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'c10', marcheId: 'm80', num: '229933', banque: 'FINEA', montant: 23116, type: 'bonne_execution', acte: null },
  { kind: 'caution', id: 'c11', marcheId: 'm12', num: '231391', banque: 'FINEA', montant: 150678, type: 'bonne_execution', acte: null }
];
// 20 "fichiers" déposés en UN lot : 11 réels (par N°) + 9 nouveaux (par marché lu)
var lot = [
  { f: 'acte-221039.pdf', lu: { num: '221039', banque: 'FINEA', montant: 111124, type: 'retenue_garantie', marche_ref: '13/2025' }, attMarche: 'm649', attMode: 'a' },
  { f: 'acte-200972.pdf', lu: { num: '200972', banque: 'FINEA', montant: 48000, type: 'bonne_execution', marche_ref: '04/INDH/2025' }, attMarche: 'm0', attMode: 'a' },
  { f: 'acte-03183052U.pdf', lu: { num: '0318 3052 U', banque: 'Attijariwafa Bank', montant: 108000, type: 'bonne_execution', marche_ref: '137/CAM/2024' }, attMarche: 'm893', attMode: 'a' },
  { f: 'acte-185594.pdf', lu: { num: '185594', banque: 'FINEA', montant: 72349, type: 'bonne_execution', marche_ref: '75/2024' }, attMarche: 'm545', attMode: 'a' },
  { f: 'acte-198084.pdf', lu: { num: '198084', banque: 'FINEA', montant: 168815, type: 'retenue_garantie', marche_ref: '75/2024' }, attMarche: 'm545', attMode: 'a' },
  { f: 'acte-694066.pdf', lu: { num: '694 066', banque: 'BMCE Bank', montant: 13088, type: 'retenue_garantie', marche_ref: '75/2024' }, attMarche: 'm545', attMode: 'a' },
  { f: 'acte-8105029161.pdf', lu: { num: '8105029161', banque: 'Banque Populaire', montant: 17838, type: 'bonne_execution', marche_ref: 'CNER 08/2024' }, attMarche: 'm67', attMode: 'a' },
  { f: 'acte-8105029419.pdf', lu: { num: '8105029419', banque: 'Banque Populaire', montant: 41622, type: 'retenue_garantie', marche_ref: 'CNER 08/2024' }, attMarche: 'm67', attMode: 'a' },
  { f: 'acte-229100.pdf', lu: { num: '229100', banque: 'FINEA', montant: 112000, type: 'retenue_garantie', marche_ref: '04/INDH/2025' }, attMarche: 'm0', attMode: 'a' },
  { f: 'acte-229933.pdf', lu: { num: '229933', banque: 'FINEA', montant: 23116, type: 'bonne_execution', marche_ref: '18/2026' }, attMarche: 'm80', attMode: 'a' },
  { f: 'acte-231391.pdf', lu: { num: '231391', banque: 'FINEA', montant: 150678, type: 'bonne_execution', marche_ref: '19/2026' }, attMarche: 'm12', attMode: 'a' },
  { f: 'neuf-1.pdf', lu: { num: 'NV-1', banque: 'CIH', montant: 5001, type: 'bonne_execution', marche_ref: 'NV-01/2026' }, attMarche: 'n1', attMode: 'c' },
  { f: 'neuf-2.pdf', lu: { num: 'NV-2', banque: 'CIH', montant: 5002, type: 'retenue_garantie', marche_ref: 'nv 02 / 2026' }, attMarche: 'n2', attMode: 'c' }, // réf avec espaces -> normalisée
  { f: 'neuf-3.pdf', lu: { num: 'NV-3', banque: 'CIH', montant: 5003, type: 'bonne_execution', marche_ref: 'NV-03/2026' }, attMarche: 'n3', attMode: 'c' },
  { f: 'neuf-4.pdf', lu: { num: 'NV-4', banque: 'CIH', montant: 5004, type: 'bonne_execution', marche_ref: 'NV-04/2026' }, attMarche: 'n4', attMode: 'c' },
  { f: 'neuf-5.pdf', lu: { num: 'NV-5', banque: 'CIH', montant: 5005, type: 'bonne_execution', marche_ref: 'NV-05/2026' }, attMarche: 'n5', attMode: 'c' },
  { f: 'neuf-6.pdf', lu: { num: 'NV-6', banque: 'CIH', montant: 5006, type: 'bonne_execution', marche_ref: 'NV-06/2026' }, attMarche: 'n6', attMode: 'c' },
  { f: 'neuf-7.pdf', lu: { num: 'NV-7', banque: 'CIH', montant: 5007, type: 'bonne_execution', marche_objet: 'Climatisation data center unique' }, attMarche: 'n7', attMode: 'c' }, // SANS réf -> objet
  { f: 'neuf-8.pdf', lu: { num: 'NV-8', banque: 'CIH', montant: 5008, type: 'bonne_execution', marche_mo: 'OFFICE SINGULIER XYZ' }, attMarche: 'n8', attMode: 'c' }, // SANS réf/objet -> MO
  { f: 'neuf-9.pdf', lu: { num: 'NV-9', banque: 'CIH', montant: 5009, type: 'bonne_execution', marche_ref: 'NV-09/2026' }, attMarche: 'n9', attMode: 'c' }
];

console.log('\n=== Lot global : 20 fichiers -> 20 propositions ===');
console.log('fichier                | marché proposé   | mode');
var ok20 = 0;
lot.forEach(function (x) {
  var r = MPM.apparierActe(x.lu, 'h-' + x.f, cands, marches);
  var mid = r.mode === 'a' ? (r.cible && r.cible.marcheId) : (r.marchePropose && r.marchePropose.id);
  var ref = (function () { for (var i = 0; i < marches.length; i++) if (marches[i].id === mid) return marches[i].ref; return '(aucun)'; })();
  var bon = (mid === x.attMarche) && (r.mode === x.attMode) && r.mode !== 'a_choisir';
  if (bon) ok20++;
  console.log((bon ? '  OK ' : '  !! ') + x.f.padEnd(20) + ' | ' + String(ref).padEnd(16) + ' | ' + r.mode);
});
check('20/20 affectées au bon marché, 0 « à choisir »', ok20 === 20, ok20 + '/20');

console.log('\n=== « à choisir » SEULEMENT sans référence + ambiguïté banque+montant sur 2 marchés ===');
var ambig = cands.concat([
  { kind: 'caution', id: 'x1', marcheId: 'm649', num: 'AMB-1', banque: 'SGMB', montant: 7777, type: 'retenue_garantie', acte: null },
  { kind: 'caution', id: 'x2', marcheId: 'm0', num: 'AMB-2', banque: 'SGMB', montant: 7777, type: 'retenue_garantie', acte: null }
]);
var rAmb = MPM.apparierActe({ num: 'ZZZ-INCONNU', banque: 'SGMB', montant: 7777, type: 'retenue_garantie' }, 'h', ambig, marches);
check('sans réf + 2 candidates banque+montant -> a_choisir (x1,x2 listées)', rAmb.mode === 'a_choisir' && (rAmb.candidates || []).map(function (c) { return c.id; }).sort().join(',') === 'x1,x2', JSON.stringify(rAmb.mode));
var rAmbRef = MPM.apparierActe({ num: 'ZZZ-INCONNU', banque: 'SGMB', montant: 7777, type: 'retenue_garantie', marche_ref: '13/2025' }, 'h', ambig, marches);
check('MÊME cas AVEC la réf du marché -> tranché (mode b sur m649), plus d\'ambiguïté', rAmbRef.mode === 'b' && rAmbRef.cible && rAmbRef.cible.marcheId === 'm649', JSON.stringify(rAmbRef.mode));

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
