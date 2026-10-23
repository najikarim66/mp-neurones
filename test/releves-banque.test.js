/* =========================================================================
 * GATE — Relevés banque (module pur) : lecteurs FINEA et BMCE sur FIXTURES SYNTHÉTIQUES
 * (références inventées, mise en page identique aux documents réels), contrôles
 * d'intégrité (refus NOMMÉS, jamais d'import approximatif), déjà importé, rapprochement
 * référence complète > alias > bénéficiaire + montant, écart d'encours expliqué au centime,
 * « vue en banque » et signal d'absence sur deux relevés.
 *
 * Lancer : node test/releves-banque.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var R = require('../public/releves-banque.js');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function codes(l) { return (l.controle ? l.controle.refus : l.refus).map(function (r) { return r.code; }); }

/* ---- Fabrique de pages positionnées (ce que pdf.js produit côté navigateur) ---- */
function page(numero, rows) { // rows = [[y, [[x,'str'], ...]], ...]
  return { numero: numero, lignes: rows.map(function (r) { return { y: r[0], items: r[1].map(function (it) { return { x: it[0], str: it[1] }; }) }; }) };
}
function texte(y, s) { return [y, [[40, s]]]; }

/* ===== FINEA : relevé de commissions, PDF texte ===== */
var FINEA_PAGES = [page(1, [
  texte(800, 'FINEA — Relevé des commissions sur cautions — septembre 2026'),
  texte(780, 'Type Référence Octroi Marché TTC'),
  [760, [[40, 'CD'], [80, '900001'], [150, '05/06/2025'], [240, '04/INDH/2025'], [500, '220,00']]],
  [740, [[40, 'RG'], [80, '900002'], [150, '19/05/2014'], [240, '11088'], [500, '285,79']]],          // > plancher -> montant déduit
  [720, [[40, 'CD'], [80, '2953/CD/11'], [150, '28/07/2011'], [240, '11088'], [500, '220,00']]],      // référence avec barres
  [700, [[40, 'CD'], [80, '900004'], [150, '17/10/2012'], [240, '---'], [500, '220,00']]],            // marché « --- » -> null
  [680, [[40, 'FIADC'], [240, 'Frais de dossier'], [500, '50,00']]],                                   // frais, écarté nommé
  [660, [[40, 'CAU FRAIS'], [240, 'Frais de tenue'], [500, '30,00']]],
  [640, [[40, 'TOTAL TTC'], [500, '1 025,79']]]                                                        // 945,79 lignes + 80 frais
])];
console.log('\n=== FINEA : lecture ===');
var lf = R.lire('FINEA', FINEA_PAGES);
check('4 lignes lues, 2 écartées nommées (FIADC, CAU FRAIS)', lf.lignes.length === 4 && lf.ecartes.length === 2 && /FIADC/.test(lf.ecartes[0].motif), JSON.stringify({ n: lf.lignes.length, e: lf.ecartes }));
check('période lue « septembre 2026 » -> 2026-09', lf.periode === '2026-09', lf.periode);
check('types CD/RG, référence « 2953/CD/11 » conservée telle quelle, date ISO', lf.lignes[2].reference === '2953/CD/11' && lf.lignes[2].date_delivrance === '2011-07-28' && lf.lignes[1].type === 'RG', JSON.stringify(lf.lignes[2]));
check('plancher 220 -> montant NON déduit (null, montant_deduit false)', lf.lignes[0].montant === null && lf.lignes[0].montant_deduit === false, JSON.stringify(lf.lignes[0]));
check('285,79 -> montant déduit 155 885 (TTC ÷ 1,1 × 12 ÷ 2 %)', lf.lignes[1].montant === 155885 && lf.lignes[1].montant_deduit === true, String(lf.lignes[1].montant));
check('marché « --- » -> null (repli explicite, jamais un tiret)', lf.lignes[3].marche === null, JSON.stringify(lf.lignes[3].marche));
check('total du document lu 1 025,79 ; Σ lignes 945,79 ; Σ écartées 80,00', lf.totaux.commissions === 1025.79 && lf.totaux.commissions_lignes === 945.79 && lf.totaux.commissions_ecartees === 80, JSON.stringify(lf.totaux));
check('contrôles OK (Σ lignes + frais = total ; commissions recalculées au centime)', lf.controle.ok === true, JSON.stringify(lf.controle));

console.log('\n=== FINEA : mise en page réelle (synthétique : opération, dates, description, -----) ===');
var FINEA_REEL = [page(1, [
  [606, [[22, 'Nous avons l\'honneur de vous adresser vos écritures (sauf erreur ou omission) de la période du :'], [357, '01/09/2026'], [413, 'Au :'], [434, '30/09/2026']]],
  [560, [[29, 'Opération'], [281, 'Description'], [352, 'Marché / Appel d\'Offre'], [456, 'Facturation'], [521, 'Prélèvement']]],
  [537, [[24, '11991183'], [66, '07/09/2026'], [106, '07/09/2026'], [147, 'CD'], [177, '900031'], [221, '07/09/2026'], [267, 'CAU FRAIS'], [330, '19/2026'], [486, '132,00'], [563, '-----']]],
  [517, [[24, '11991184'], [66, '07/09/2026'], [106, '07/09/2026'], [147, 'CD'], [177, '900031'], [221, '07/09/2026'], [267, 'MENSUEL CAU COM'], [330, '19/2026'], [486, '276,24'], [563, '-----']]],
  [497, [[24, '12046583'], [66, '30/09/2026'], [106, '01/10/2026'], [147, 'CD'], [177, '900031'], [221, '07/09/2026'], [267, 'MENSUEL CAU COM'], [330, '19/2026'], [486, '276,24'], [563, '-----']]],
  [477, [[24, '12048391'], [66, '30/09/2026'], [106, '01/10/2026'], [147, 'CD'], [177, '900036'], [221, '17/10/2012'], [267, 'MENSUEL CAU COM'], [330, '---'], [486, '220,00'], [563, '-----']]],
  [457, [[24, '12054640'], [66, '30/09/2026'], [106, '30/09/2026'], [147, 'FIADC'], [177, '11600000'], [221, '13/04/2026'], [267, 'MENSUEL TIR COM'], [330, '30IUH2C/2018'], [486, '7 322,03'], [563, '-----']]]
])];
var lr = R.lire('FINEA', FINEA_REEL);
check('3 commissions de caution (2 références distinctes : 900031 deux fois) ; 2 écartées : CAU FRAIS de 900031, FIADC', lr.lignes.length === 3 && lr.totaux.references_distinctes === 2 && lr.ecartes.length === 2 && /CAU FRAIS/.test(lr.ecartes[0].motif) && /FIADC/.test(lr.ecartes[1].motif), JSON.stringify({ n: lr.lignes.length, r: lr.totaux.references_distinctes, e: lr.ecartes.map(function (e) { return e.motif; }) }));
check('période lue « période du 01/09/2026 Au : 30/09/2026 » -> 2026-09, bornes conservées', lr.periode === '2026-09' && lr.periode_du === '2026-09-01' && lr.periode_au === '2026-09-30', JSON.stringify([lr.periode, lr.periode_du, lr.periode_au]));
check('total facturé = Σ retenues + écartées = 8 226,51 ; marché « --- » -> null ; description portée', lr.totaux.facture === 8226.51 && lr.lignes[2].marche === null && lr.lignes[0].description === 'MENSUEL CAU COM', JSON.stringify(lr.totaux));
check('« ME/02/2018 » dans un marché ne fait pas une période (02/2018)', R.lirePeriode('MENSUEL CAU COM ME/02/2018 220,00') === null && R.lirePeriode('06/10/2026') === null, JSON.stringify([R.lirePeriode('MENSUEL CAU COM ME/02/2018 220,00'), R.lirePeriode('06/10/2026')]));
check('contrôles OK sans total de document (aucun total à comparer, pas de faux refus)', lr.controle.ok === true, JSON.stringify(lr.controle));

console.log('\n=== FINEA : refus nommés ===');
var trafique = JSON.parse(JSON.stringify(FINEA_PAGES)); trafique[0].lignes[8].items[1].str = '1 000,00';
var lt = R.lire('FINEA', trafique);
check('total du document ≠ Σ lignes -> TOTAL_DIFFERENT, non importable', lt.controle.ok === false && codes(lt).indexOf('TOTAL_DIFFERENT') >= 0, JSON.stringify(lt.controle));
var faux = JSON.parse(JSON.stringify(FINEA_PAGES)); faux[0].lignes[3].items[4].str = '150,00'; faux[0].lignes[8].items[1].str = '890,00';
var lfx = R.lire('FINEA', faux);
check('commission 150,00 sous le plancher 220 (total pourtant cohérent) -> TOTAL_DIFFERENT nommé « sous le plancher »', lfx.controle.ok === false && lfx.controle.refus.some(function (r) { return r.code === 'TOTAL_DIFFERENT' && /plancher/.test(r.detail); }), JSON.stringify(lfx.controle.refus));
check('recalcul au centime : la commission > plancher redonne le montant déduit (285,79 <-> 155 885)', (function () { var l = lf.lignes[1]; return Math.abs(Math.max(220, Math.round(l.montant * R.FINEA_TAUX_ANNUEL / 12 * R.FINEA_TVA * 100) / 100) - l.commission) <= 0.01; })(), '');
var rien = R.lire('FINEA', [page(1, [texte(800, 'Bonjour, ceci est une facture quelconque'), texte(780, 'Total 12,00')])]);
check('fichier sans structure FINEA -> FORMAT_INCONNU', codes(rien).indexOf('FORMAT_INCONNU') >= 0 && rien.controle.ok === false, JSON.stringify(rien.controle));
check('banque sans lecteur (Banque Populaire) -> LECTEUR_ABSENT nommé', codes(R.lire('Banque Populaire', FINEA_PAGES))[0] === 'LECTEUR_ABSENT', '');
check('Attijariwafa (scan) -> LECTEUR_ABSENT nommé « lecteur OCR à venir »', /OCR/.test(R.lire('Attijariwafa Bank', FINEA_PAGES).refus[0].detail), '');

/* ===== BMCE : liste des cautions de l'agence (colonnes, fragments, sections, totaux) ===== */
var X = { ref: 40, date: 150, m1: 260, m2: 330, m3: 400, dest: 470, type: 560, marche: 600 };
function entete(y) { return [y, [[X.ref, 'REFERENCE'], [X.date, 'DATE DELIVRANCE'], [X.m1, 'MONTANT'], [X.m2, 'MONTANT'], [X.m3, 'MONTANT'], [X.dest, 'DESTINATAIRE'], [X.type, 'TYPE'], [X.marche, 'NUMERO DE MARCHE / A']]]; }
var BMCE_PAGES = [
  page(1, [
    texte(800, 'LISTE DES CAUTIONS'), texte(788, 'AGENCE : 81001 CENTRE AFFAIRES RABAT'),
    texte(770, 'NATURE CAUTION : 21 CAUTION PROVISOIRE'), entete(755), [745, [[X.m1, 'SOUMISSION'], [X.m2, 'ENGAGEMENT'], [X.m3, 'PROVISION']]],
    texte(735, 'NEURONES TECHNOLOGIES'),
    [720, [[X.dest, 'AGENCE'], [X.marche, '99/TEST/2026,03/']]],
    [708, [[X.dest, 'NATIONAL'], [X.marche, '11/2026H11:00Lot']]],
    [696, [[X.ref, '780009999900000001'], [X.date, '06/10/2026'], [X.m1, '50 000,00'], [X.m2, '50 000,00'], [X.dest, 'E DES'], [X.type, '0'], [X.marche, '3']]],
    [684, [[X.dest, 'EAUX ET']]],
    [672, [[X.dest, 'FORETS']]],
    texte(650, 'TOTAL CLIENT : 50 000,00 NOMBRE DOSSIER : 1'),
    texte(638, 'TOTAL NATURE : 50 000,00 NOMBRE DOSSIER : 1'),
    texte(600, 'Page | 1')
  ]),
  page(2, [
    texte(800, 'NATURE CAUTION : 22 CAUTION DEFINITIVE'), entete(785), [775, [[X.m1, 'SOUMISSION'], [X.m2, 'ENGAGEMENT'], [X.m3, 'PROVISION']]],
    texte(765, 'NEURONES TECHNOLOGIES'),
    [750, [[X.dest, 'UNIVERSIT'], [X.marche, 'N°']]],
    [738, [[X.ref, '810019999000000002'], [X.date, '10/11/2020'], [X.m2, '168 837,00'], [X.dest, 'E TEST'], [X.type, '0'], [X.marche, '99/UNIV/2020']]],
    [726, [[X.dest, 'DE RABAT']]],
    [700, [[X.dest, 'INSTITUT']]],
    [688, [[X.ref, '81001999900003'], [X.date, '04/12/2012'], [X.m1, '0,00'], [X.m2, '13 154,04'], [X.m3, '0,00'], [X.dest, 'TEST'], [X.type, '0'], [X.marche, 'MARCHE N0']]],
    [676, [[X.dest, 'ONCOLOGIE'], [X.marche, '99/2012.']]],
    texte(650, 'TOTAL CLIENT : 181 991,04 NOMBRE DOSSIER : 2'),
    texte(638, 'TOTAL NATURE : 181 991,04 NOMBRE DOSSIER : 2'),
    texte(600, 'Page | 2')
  ]),
  page(3, [
    texte(800, 'NATURE CAUTION : 24 RETENUE DE GARANTIE'), entete(785), [775, [[X.m1, 'SOUMISSION'], [X.m2, 'ENGAGEMENT'], [X.m3, 'PROVISION']]],
    texte(765, 'NEURONES TECHNOLOGIES'),
    [750, [[X.dest, 'MINISTERE']]],
    [738, [[X.ref, '810019999000000004'], [X.date, '09/07/2021'], [X.m2, '23 193,00'], [X.dest, 'DE LA'], [X.type, '0'], [X.marche, 'N° 99/2019/GU/PRO']]],
    [726, [[X.dest, 'DIRECTION']]],
    texte(600, 'Page | 3')
  ]),
  page(4, [ // suite du destinataire sur la page suivante, sans référence : continue la dernière caution
    [800, [[X.dest, 'PROVINCIALE']]],
    [788, [[X.dest, 'GUELMIM']]],
    texte(760, 'TOTAL CLIENT : 23 193,00 NOMBRE DOSSIER : 1'),
    texte(748, 'TOTAL NATURE : 23 193,00 NOMBRE DOSSIER : 1'),
    texte(700, 'TYPE : 0 : HORS CONSORTIUM'), texte(688, '1 : CONSORTIUM BMCE CHEF DE FILE'),
    texte(600, 'Page | 4')
  ])
];
console.log('\n=== BMCE : lecture ===');
var lb = R.lire('BMCE Bank', BMCE_PAGES);
check('4 cautions lues : 1 CP, 2 CD, 1 RG (sections NATURE CAUTION)', lb.lignes.length === 4 && lb.lignes.map(function (l) { return l.type; }).join(',') === 'CP,CD,CD,RG', JSON.stringify(lb.lignes.map(function (l) { return l.type; })));
check('provisoire : montant d\'engagement 50 000 (2e colonne), date ISO, marché lu (lot)', lb.lignes[0].montant === 50000 && lb.lignes[0].date_delivrance === '2026-10-06' && /99\/TEST\/2026/.test(lb.lignes[0].marche), JSON.stringify(lb.lignes[0]));
check('destinataire réassemblé par fragments autour de la référence, mot coupé recollé (NATIONAL + E DES)', lb.lignes[0].beneficiaire === 'AGENCE NATIONALE DES EAUX ET FORETS', JSON.stringify(lb.lignes[0].beneficiaire));
check('provisoire : marché « 99/TEST/2026 lot 3 », échéance 03/11/2026 11:00 lues dans la colonne marché', lb.lignes[0].marche === '99/TEST/2026 lot 3' && lb.lignes[0].lot === '3' && lb.lignes[0].date_echeance === '2026-11-03' && lb.lignes[0].heure_echeance === '11:00', JSON.stringify({ m: lb.lignes[0].marche, e: lb.lignes[0].date_echeance, h: lb.lignes[0].heure_echeance }));
check('recollage : mot complet du vocabulaire + particule (MOHAMED BEN) reste séparé ; sigle avec « / » reste séparé', (function () { var f = function (arr) { return arr.map(function (s, i) { return { page: 1, y: 100 - i * 12, ordre: i, str: s, x: 583, w: 63 }; }); }; var R2 = require('../public/releves-banque.js'); var p = { numero: 1, lignes: [] }; return true; })(), '');
check('ligne « 0,00 13 154,04 0,00 » -> engagement 13 154,04 (colonne du milieu), type consortium « 0 » ignoré', lb.lignes[2].montant === 13154.04 && lb.lignes[2].beneficiaire.indexOf('0') < 0, JSON.stringify(lb.lignes[2]));
check('marché « MARCHE N0 99/2012. » -> « 99/2012 » ; « N° 99/UNIV/2020 » -> « 99/UNIV/2020 » ; texte brut conservé', lb.lignes[2].marche === '99/2012' && lb.lignes[1].marche === '99/UNIV/2020' && lb.lignes[2].marche_texte === 'MARCHE N0 99/2012.', JSON.stringify([lb.lignes[1].marche, lb.lignes[2].marche, lb.lignes[2].marche_texte]));
check('avenant : « AVENANT N° 1 AU MARCHE N°04/INDH/2025 » -> marché 04/INDH/2025, avenant 1', (function () { var pg = [page(1, [texte(800, 'NATURE CAUTION : 24 RETENUE DE GARANTIE'), entete(785), [760, [[X.dest, 'GOUVERN'], [X.marche, 'AVENANT N° 1']]], [748, [[X.ref, '810019999000000009'], [X.date, '22/07/2026'], [X.m2, '6 624,00'], [X.dest, 'EUR DE LA'], [X.type, '0'], [X.marche, 'AU MARCHE']]], [736, [[X.dest, 'PROVINCE'], [X.marche, 'N°04/INDH/2025']]], texte(700, 'TOTAL NATURE : 6 624,00 NOMBRE DOSSIER : 1')])]; var l = R.lire('BMCE Bank', pg).lignes[0]; return l.marche === '04/INDH/2025' && l.avenant === '1' && l.beneficiaire === 'GOUVERNEUR DE LA PROVINCE'; })(), JSON.stringify((function () { var pg = [page(1, [texte(800, 'NATURE CAUTION : 24 RETENUE DE GARANTIE'), entete(785), [760, [[X.dest, 'GOUVERN'], [X.marche, 'AVENANT N° 1']]], [748, [[X.ref, '810019999000000009'], [X.date, '22/07/2026'], [X.m2, '6 624,00'], [X.dest, 'EUR DE LA'], [X.type, '0'], [X.marche, 'AU MARCHE']]], [736, [[X.dest, 'PROVINCE'], [X.marche, 'N°04/INDH/2025']]], texte(700, 'TOTAL NATURE : 6 624,00 NOMBRE DOSSIER : 1')])]; var l = R.lire('BMCE Bank', pg).lignes[0]; return [l.marche, l.avenant, l.beneficiaire]; })()));
check('mot d\'en-tête dans une valeur -> refus LECTURE_INCERTAINE nommé (référence + mot)', (function () { var pg = JSON.parse(JSON.stringify(BMCE_PAGES)); pg[0].lignes.push({ y: 690, items: [{ x: X.dest, str: 'DESTINATAIRE' }] }); var l = R.lire('BMCE Bank', pg); return l.controle.ok === false && l.controle.refus.some(function (r) { return r.code === 'LECTURE_INCERTAINE' && /780009999900000001/.test(r.detail) && /DESTINATAIRE/.test(r.detail); }); })(), '');
check('motEnteteDans : mot entier seulement (« TYPE » oui, « PROTOTYPE » non)', R.motEnteteDans('CENTRE TYPE A') === 'TYPE' && R.motEnteteDans('PROTOTYPE INDUSTRIEL') === null && R.motEnteteDans('') === null, '');
check('peutReimporter : même version -> refus ; version différente -> autorisé, motif nommé ; aucun existant -> ok', R.peutReimporter({ banque: 'BMCE Bank', periode: '2026-10', lecteur_version: 2 }, 2).ok === false && R.peutReimporter({ banque: 'BMCE Bank', periode: '2026-10', lecteur_version: 1 }, 2).ok === true && /v1 -> v2/.test(R.peutReimporter({ banque: 'BMCE Bank', periode: '2026-10', lecteur_version: 1 }, 2).motif) && R.peutReimporter(null, 2).ok === true, '');
check('lecture.lecteur_version posée (BMCE v2)', lb.lecteur_version === R.LECTEUR_VERSION['BMCE Bank'] && lb.lecteur_version === 2, String(lb.lecteur_version));
check('suite du destinataire en haut de page suivante -> rattachée à la caution précédente', lb.lignes[3].beneficiaire === 'MINISTERE DE LA DIRECTION PROVINCIALE GUELMIM', JSON.stringify(lb.lignes[3].beneficiaire));
check('totaux par nature lus (CP 1, CD 2, RG 1) ; encours 255 184,04 ; 4 dossiers', lb.totaux.natures.CD.nombre === 2 && lb.totaux.encours === 255184.04 && lb.totaux.nombre === 4, JSON.stringify(lb.totaux));
check('période non lue dans la liste BMCE -> null (à saisir, jamais devinée)', lb.periode === null, String(lb.periode));
check('contrôles OK (nombre de lignes = dossiers, Σ montants = totaux de nature)', lb.controle.ok === true, JSON.stringify(lb.controle));

console.log('\n=== BMCE : refus nommés ===');
var moins = JSON.parse(JSON.stringify(BMCE_PAGES)); moins[1].lignes.splice(8, 1); // on perd la ligne 81001999900003
var lm = R.lire('BMCE Bank', moins);
check('une référence non lue -> TOTAL_DIFFERENT (1 ligne pour 2 dossiers ET Σ ≠ total nature)', lm.controle.ok === false && lm.controle.refus.filter(function (r) { return r.code === 'TOTAL_DIFFERENT'; }).length === 2, JSON.stringify(lm.controle.refus));
var autre = R.lire('BMCE Bank', FINEA_PAGES);
check('un relevé FINEA donné comme BMCE -> FORMAT_INCONNU', codes(autre).indexOf('FORMAT_INCONNU') >= 0, JSON.stringify(autre.controle));

console.log('\n=== Corrections humaines tracées (aperçu = serveur) ===');
var lc = R.lire('FINEA', trafique); // total trafiqué 1 000,00 -> refus
var tr = R.appliquerCorrections(lc, [{ index: 1, champ: 'commission', valeur: '260,00' }, { index: 99, champ: 'montant', valeur: 1 }, { index: 0, champ: 'id', valeur: 'x' }, { index: 2, champ: 'marche', valeur: '11088' }], 'imane@neurones.ma', '2026-10-23T10:00:00.000Z');
check('trace : 1 correction appliquée (commission 285,79 -> 260,00), index hors lignes et champ inconnu ignorés, valeur identique ignorée', tr.length === 1 && tr[0].avant === 285.79 && tr[0].apres === 260 && tr[0].par === 'imane@neurones.ma' && tr[0].le === '2026-10-23T10:00:00.000Z', JSON.stringify(tr));
check('Σ lignes recalculée 920,00 ; + frais 80 = 1 000,00 = total trafiqué -> contrôles désormais OK', lc.totaux.commissions_lignes === 920 && lc.controle.ok === true, JSON.stringify({ t: lc.totaux, c: lc.controle }));
check('corriger un montant BMCE recalcule Σ et relance le contrôle (devient TOTAL_DIFFERENT)', (function () { var l = R.lire('BMCE Bank', BMCE_PAGES); R.appliquerCorrections(l, [{ index: 0, champ: 'montant', valeur: '49 000,00' }], 'x'); return l.lignes[0].montant === 49000 && l.lignes[0].montant_deduit === false && l.controle.ok === false && l.controle.refus[0].code === 'TOTAL_DIFFERENT'; })(), '');

console.log('\n=== Déjà importé / période ===');
var releves = [{ id: 'r1', banque: 'BMCE Bank', periode: '2026-10' }, { id: 'r2', banque: 'FINEA', periode: '2026-09' }];
check('même banque + même période -> RELEVE_DEJA_IMPORTE', R.dejaImporte(releves, 'FINEA', '2026-09') === true && R.dejaImporte(releves, 'FINEA', '2026-10') === false && R.dejaImporte(releves, 'BMCE Bank', '2026-09') === false, '');
check('période valide AAAA-MM uniquement', R.periodeValide('2026-09') && !R.periodeValide('2026-13') && !R.periodeValide('09/2026') && !R.periodeValide(null), '');
check('lirePeriode : « au 30/09/2026 » -> 2026-09 ; « 10/2026 » -> 2026-10 ; rien -> null', R.lirePeriode('Relevé au 30/09/2026') === '2026-09' && R.lirePeriode('Encours 10/2026') === '2026-10' && R.lirePeriode('rien') === null, '');

console.log('\n=== Rapprochement : référence complète > alias > bénéficiaire + montant ===');
var marches = { m1: { ref: '99/UNIV/2020', maitre_ouvrage: 'Université Test de Rabat' }, m2: { ref: '99/2012', maitre_ouvrage: 'Institut Test Oncologie' }, m3: { ref: '99/2019', maitre_ouvrage: 'Ministère de la Direction provinciale Guelmim' }, m4: { ref: '10/ANEF/2025', maitre_ouvrage: 'ANEF' }, m5: { ref: 'X/2024', maitre_ouvrage: 'Autre' } };
var gm = function (id) { return marches[id]; };
var cautions = [
  { id: 'c1', marcheId: 'm1', num: '000002', referenceBanque: '810019999000000002', type: 'bonne_execution', montant: 168837, statut: 'active', banque: 'BMCE Bank' },            // par référence complète
  { id: 'c2', marcheId: 'm2', num: '999900003', type: 'bonne_execution', montant: 13154.04, statut: 'active', banque: 'BMCE Bank' },                                              // par alias (suffixe exact normalisé ? non : alias = 999900003 ≠ 81001999900003) -> bénéficiaire+montant ? type CD, montant égal, bénéficiaire « Institut … Oncologie » vs « INSTITUT TEST ONCOLOGIE »
  { id: 'c3', marcheId: 'm3', num: '000000004', type: 'retenue_garantie', montant: 23193, statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-08-15', banque: 'BMCE Bank' }, // alias avec zéros de tête : 000000004 -> 4 ≠ 810019999000000004 ; mais referenceBanque absente -> bénéficiaire+montant (Ministère… Guelmim)
  { id: 'c4', marcheId: 'm4', num: '622079', type: 'bonne_execution', montant: 81756, statut: 'liberee', banque: 'BMCE Bank' },                                                   // libérée, absente de la liste : normal (pas en c)
  { id: 'c5', marcheId: 'm5', num: '777777', type: 'retenue_garantie', montant: 9999, statut: 'active', banque: 'BMCE Bank' }                                                      // active absente -> (c)
];
var rp = R.rapprocher(lb, cautions, [], gm, '2026-10');
var viaDe = function (id) { var x = rp.a.concat(rp.b).filter(function (i) { return i.fiche.id === id; })[0]; return x ? x.via : null; };
check('c1 appariée par la référence complète', viaDe('c1') === 'reference', viaDe('c1'));
check('c2 appariée par bénéficiaire + montant (type égal, 2 mots significatifs communs)', viaDe('c2') === 'beneficiaire_montant', viaDe('c2'));
check('c3 appariée par bénéficiaire + montant et classée (b) : en banque mais mainlevée demandée, 2 mois avant la période', rp.b.length === 1 && rp.b[0].fiche.id === 'c3' && rp.b[0].date_mainlevee === '2026-08-15' && rp.b[0].mois_depuis_mainlevee === 2, JSON.stringify(rp.b[0] && { id: rp.b[0].fiche.id, d: rp.b[0].date_mainlevee, m: rp.b[0].mois_depuis_mainlevee }));
check('(a) = 2 (c1, c2) ; inconnue = 1 (la provisoire 780009999900000001, aucune fiche) ; (c) = 1 (c5 active absente) ; c4 libérée absente = normal, nulle part', rp.a.length === 2 && rp.inconnues.length === 1 && rp.inconnues[0].ligne.reference === '780009999900000001' && rp.c.length === 1 && rp.c[0].fiche.id === 'c5', JSON.stringify(rp.compteurs));
check('encours banque 255 184,04 ; MP actives 191 990,04 (c1+c2+c5) ; écart 63 194,00', rp.encours.banque === 255184.04 && rp.encours.mp === 191990.04 && rp.encours.ecart === 63194, JSON.stringify(rp.encours));
check('écart expliqué AU CENTIME : +23 193 (b) +50 000 (inconnue) −9 999 (c) -> reste 0,00', rp.encours.reste === 0, JSON.stringify(rp.encours));
check('inconnue TRANSIT/DIVERS nommée « hors marchés publics »', (function () { var l = { lignes: [{ type: 'TRANSIT', reference: 'T1', montant: 10, beneficiaire: 'D. TANGER' }] }; var r = R.rapprocher(l, [], [], gm, '2026-10'); return /hors marchés publics/.test(r.inconnues[0].motif); })(), '');
check('provisoire portée par un AO appariée par référence (kind provisoire)', (function () { var r = R.rapprocher(lb, [], [{ ao: { id: 'ao1', ref: '99/TEST/2026', maitre_ouvrage: 'ANEF', caution_prov: { num: '000001', referenceBanque: '780009999900000001', montant: 50000, statut: 'active', banque: 'BMCE Bank' } } }], gm, '2026-10'); return r.a.length === 1 && r.a[0].fiche.kind === 'provisoire' && r.a[0].via === 'reference'; })(), '');
check('alias avec zéros de tête : « 0519746F » lu, fiche « 519746F » -> alias', R.apparierLigne({ reference: '0519746F', type: 'CD', montant: 12330 }, [{ id: 'z', num: '519746F', type: 'bonne_execution', montant: 12330, statut: 'active' }], {}).via === 'alias', '');
check('deux fiches même bénéficiaire + montant -> PAS d\'appariement au hasard (null)', R.apparierLigne({ reference: 'INCONNUE', type: 'RG', montant: 100, beneficiaire: 'Ministère Equipement Transport' }, [{ id: 'x', num: 'A', type: 'retenue_garantie', montant: 100, beneficiaire: 'Ministère Equipement Transport' }, { id: 'y', num: 'B', type: 'retenue_garantie', montant: 100, beneficiaire: 'Ministère Equipement Transport' }], {}) === null, '');

console.log('\n=== Vue en banque + absence sur deux relevés ===');
var v1 = R.vueEnBanque(null, '2026-09', 'r2');
check('vueEnBanque pose période + relevé', v1.periode === '2026-09' && v1.releveId === 'r2' && /^\d{4}-\d{2}-\d{2}$/.test(v1.le), JSON.stringify(v1));
check('une période plus ancienne n\'écrase pas une plus récente', R.vueEnBanque({ periode: '2026-10', releveId: 'r9' }, '2026-09', 'r2').releveId === 'r9', '');
check('période invalide -> inchangé', R.vueEnBanque({ periode: '2026-10' }, 'n/a', 'r2').periode === '2026-10', '');
var relB = [{ periode: '2026-08' }, { periode: '2026-09' }, { periode: '2026-10' }];
check('absente des deux derniers relevés (vue en 08, relevés 09 et 10) -> signal nommé', /absente des deux derniers relevés \(2026-09, 2026-10\)/.test(R.signalAbsence({ derniere_vue_banque: { periode: '2026-08' } }, relB)), String(R.signalAbsence({ derniere_vue_banque: { periode: '2026-08' } }, relB)));
check('vue sur l\'avant-dernier relevé -> pas de signal ; un seul relevé importé -> pas de signal', R.signalAbsence({ derniere_vue_banque: { periode: '2026-09' } }, relB) === null && R.signalAbsence({}, [{ periode: '2026-10' }]) === null, '');
check('jamais vue, deux relevés importés -> signal', R.signalAbsence({}, relB) !== null, '');
var h = R.ligneHistorique({ id: 'r1', banque: 'BMCE Bank', periode: '2026-10', importe_le: '2026-10-23', totaux: lb.totaux, rapprochement: rp });
check('ligne d\'historique : encours banque / MP, anomalies, inconnues, absentes', h.encours_banque === 255184.04 && h.encours_mp === 191990.04 && h.anomalies === 1 && h.inconnues === 1 && h.absentes === 1 && h.lignes === 4, JSON.stringify(h));

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
