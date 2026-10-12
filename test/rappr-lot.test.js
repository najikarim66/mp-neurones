/* =========================================================================
 * GATE — Lot de dépôt « Rapprochement des actes » : chaque dépôt S'AJOUTE au lot.
 * Prouve la LOGIQUE que l'écran reflète (dédoublonnage nom+taille nommé, plafond
 * dur 20 — 21e refusé nommé, PDF-seul). Exécute MPM.ajouterFichiersLot sur des
 * descripteurs {name,size,type}, comme le navigateur passe ses File.
 *
 * NB — la gate « écran rendu » (playwright) est traitée à part : MP n'a pas encore
 * d'infra playwright (voir note Karim). Ici on gate le cerveau, pas le pixel.
 *
 * Lancer : node test/rappr-lot.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPM = require('../public/pv-mainlevee.js');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function pdf(name, size) { return { name: name, size: size, type: 'application/pdf' }; }

console.log('\n=== premier dépôt : 3 PDF -> 3 lignes ===');
var r1 = MPM.ajouterFichiersLot([], [pdf('a.pdf', 10), pdf('b.pdf', 20), pdf('c.pdf', 30)], 20);
check('3 ajoutés, lot = 3', r1.ajoutes === 3 && r1.liste.length === 3, 'ajoutes=' + r1.ajoutes + ' len=' + r1.liste.length);

console.log('\n=== deuxième dépôt : +2 PDF -> 5 (s\'ajoute, n\'écrase pas) ===');
var r2 = MPM.ajouterFichiersLot(r1.liste, [pdf('d.pdf', 40), pdf('e.pdf', 50)], 20);
check('+2 ajoutés, lot = 5', r2.ajoutes === 2 && r2.liste.length === 5, 'len=' + r2.liste.length);

console.log('\n=== même fichier deux fois -> 1 ligne + doublon NOMMÉ ===');
var r3 = MPM.ajouterFichiersLot(r2.liste, [pdf('a.pdf', 10)], 20);
check('doublon nom+taille refusé, lot inchangé (5)', r3.ajoutes === 0 && r3.liste.length === 5, 'len=' + r3.liste.length);
check('doublon nommé par son nom', r3.doublons.length === 1 && r3.doublons[0] === 'a.pdf', r3.doublons.join(','));
check('même nom mais taille différente -> PAS un doublon', (function () { var r = MPM.ajouterFichiersLot(r2.liste, [pdf('a.pdf', 999)], 20); return r.ajoutes === 1 && r.liste.length === 6; })(), '');

console.log('\n=== plafond dur : le 21e est refusé, NOMMÉ « 20 au plus » ===');
var vingt = []; for (var k = 0; k < 20; k++) vingt.push(pdf('f' + k + '.pdf', 100 + k));
var plein = MPM.ajouterFichiersLot([], vingt, 20);
check('20 acceptés', plein.liste.length === 20 && plein.refuses.length === 0, 'len=' + plein.liste.length);
var r21 = MPM.ajouterFichiersLot(plein.liste, [pdf('f21.pdf', 777)], 20);
check('21e refusé, lot reste 20', r21.ajoutes === 0 && r21.liste.length === 20, 'len=' + r21.liste.length);
check('21e nommé dans refuses', r21.refuses.length === 1 && r21.refuses[0] === 'f21.pdf', r21.refuses.join(','));
check('un dépôt de 25 d\'un coup sur lot vide -> 20 pris, 5 refusés nommés', (function () { var big = []; for (var m = 0; m < 25; m++) big.push(pdf('g' + m + '.pdf', m)); var r = MPM.ajouterFichiersLot([], big, 20); return r.liste.length === 20 && r.refuses.length === 5; })(), '');

console.log('\n=== PDF-seul : non-PDF écarté nommé, ne compte pas dans le plafond ===');
var mix = MPM.ajouterFichiersLot([], [pdf('ok.pdf', 1), { name: 'scan.jpg', size: 2, type: 'image/jpeg' }, { name: 'doc.PDF', size: 3, type: '' }], 20);
check('jpg écarté nommé', mix.nonPdf.length === 1 && mix.nonPdf[0] === 'scan.jpg', mix.nonPdf.join(','));
check('.PDF (extension, type vide) accepté', mix.liste.length === 2, 'len=' + mix.liste.length);

console.log('\n=== lot préservé par référence d\'objet (le File réel survit) ===');
var fileLike = pdf('ref.pdf', 123); var rr = MPM.ajouterFichiersLot([], [fileLike], 20);
check('l\'objet poussé est l\'entrée telle quelle', rr.liste[0] === fileLike, '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
