/* =========================================================================
 * GATE — Lecture automatique de la mesure cas B (garde Karim : « c'est cette
 * lecture qui decide d'une garde, pas avant »). Node pur, sans dependance.
 *
 * statsMesure(comparaisons) lit le journal mp_ocr_comparaisons : taux d'ecarts
 * REELS, taux de FAUSSES lectures (global + par champ), et une recommandation qui
 * n'est JAMAIS « peut generaliser » avant 10 comparaisons VERDICTEES, et qui
 * refuse B si les fausses lectures l'emportent sur les ecarts reels.
 *
 * Prouve : comptage par verdict ; « verdictee » = 0 ecart OU chaque ecart juge ;
 * taux reels / fausses ; par champ ; recommandation (en_attente < 10 ; ne_pas_
 * generaliser si fausses > vraies ; peut_generaliser sinon).
 *
 * Lancer : node test/ocr-mesure.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPM = require('../public/pv-mainlevee.js');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }

// Fabrique une comparaison : ecarts = liste de [champ, verdict]
function cmp(ecarts) { return { ecarts: (ecarts || []).map(function (e) { return { champ: e[0], valeur_acte: 'x', valeur_saisie: 'y', confiance: 'lu', verdict: e[1] }; }) }; }
// 10 comparaisons concordantes (0 ecart) = 10 verdictees, 0 ecart
function nConcordantes(n) { var a = []; for (var i = 0; i < n; i++) a.push(cmp([])); return a; }

console.log('\n=== 1. Verdictee = 0 ecart OU tous les ecarts juges ===');
var s0 = MPM.statsMesure([]);
check('journal vide -> 0 verdictee, decision pas prete, recommandation en_attente', s0.nbVerdictees === 0 && s0.decisionPrete === false && s0.recommandation === 'en_attente', JSON.stringify(s0));
check('comparaison 0 ecart -> verdictee', MPM.statsMesure([cmp([])]).nbVerdictees === 1, '');
check('comparaison avec un ecart NON juge (verdict null) -> PAS verdictee', MPM.statsMesure([cmp([['montant', null]])]).nbVerdictees === 0, '');
check('comparaison avec tous les ecarts juges -> verdictee', MPM.statsMesure([cmp([['montant', 'vrai_ecart'], ['banque', 'mauvaise_lecture']])]).nbVerdictees === 1, '');

console.log('\n=== 2. Comptage + taux ===');
var jeu = [cmp([['montant', 'vrai_ecart']]), cmp([['banque', 'mauvaise_lecture'], ['num', 'vrai_ecart']]), cmp([['date_echeance', 'ignore']]), cmp([])];
var s = MPM.statsMesure(jeu);
check('nb ecarts = 4, vrais = 2, mauvaises = 1, ignores = 1', s.nbEcarts === 4 && s.nbVrais === 2 && s.nbMauvaises === 1 && s.nbIgnores === 1, JSON.stringify(s));
check('taux ecarts reels = vrais/(vrais+mauvaises) = 2/3', Math.abs(s.tauxEcartsReels - 2 / 3) < 1e-9, String(s.tauxEcartsReels));
check('taux fausses lectures = 1/3', Math.abs(s.tauxFaussesLectures - 1 / 3) < 1e-9, String(s.tauxFaussesLectures));
check('ignore n\'entre pas dans les taux (denominateur = vrais+mauvaises)', s.tauxEcartsReels + s.tauxFaussesLectures === 1, '');

console.log('\n=== 3. Par champ ===');
check('par champ banque : 1 ecart, 1 mauvaise, taux fausse 1', s.parChamp.banque && s.parChamp.banque.total === 1 && s.parChamp.banque.mauvaises === 1 && s.parChamp.banque.tauxFausse === 1, JSON.stringify(s.parChamp.banque));
check('par champ montant : 1 ecart, 0 mauvaise, taux fausse 0', s.parChamp.montant && s.parChamp.montant.mauvaises === 0 && s.parChamp.montant.tauxFausse === 0, JSON.stringify(s.parChamp.montant));

console.log('\n=== 4. Recommandation : jamais « peut » avant 10 verdictees ===');
check('9 verdictees, fausses<=vraies -> en_attente (pas encore 10)', MPM.statsMesure(nConcordantes(9)).recommandation === 'en_attente', '');
var dix_ok = nConcordantes(8).concat([cmp([['montant', 'vrai_ecart'], ['banque', 'vrai_ecart']]), cmp([['num', 'mauvaise_lecture']])]); // 10 verdictees, 2 vrais > 1 mauvaise
check('10 verdictees, fausses <= vraies -> peut_generaliser', MPM.statsMesure(dix_ok).nbVerdictees === 10 && MPM.statsMesure(dix_ok).recommandation === 'peut_generaliser', JSON.stringify({ n: MPM.statsMesure(dix_ok).nbVerdictees, r: MPM.statsMesure(dix_ok).recommandation }));
var dix_ko = nConcordantes(8).concat([cmp([['montant', 'mauvaise_lecture'], ['banque', 'mauvaise_lecture']]), cmp([['num', 'vrai_ecart']])]); // 10 verdictees, 2 mauvaises > 1 vrai
check('10 verdictees, fausses > vraies -> ne_pas_generaliser (B ne part pas)', MPM.statsMesure(dix_ko).recommandation === 'ne_pas_generaliser', MPM.statsMesure(dix_ko).recommandation);

console.log('\n=== 5. Vocabulaire des verdicts exporte + verrouille ===');
check('VERDICTS_ECART = vrai_ecart, mauvaise_lecture, ignore', Array.isArray(MPM.VERDICTS_ECART) && MPM.VERDICTS_ECART.indexOf('vrai_ecart') >= 0 && MPM.VERDICTS_ECART.indexOf('mauvaise_lecture') >= 0 && MPM.VERDICTS_ECART.indexOf('ignore') >= 0 && MPM.VERDICTS_ECART.length === 3, JSON.stringify(MPM.VERDICTS_ECART));

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
