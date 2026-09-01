/* =========================================================================
 * GATE - Echeances de depot d'offres.
 *
 * Rejoue UNE meme echeance a plusieurs instants et prouve que l'affichage dit
 * la verite a chaque fois, plus le cas de la bascule d'heure legale du 20/09.
 *
 * Deterministe par construction : on INJECTE l'offset (offsetResolver) et
 * "maintenant" (nowMs). La gate ne depend donc PAS du tzdata de la machine qui
 * l'execute -- sinon elle reproduirait exactement le defaut qu'elle doit
 * interdire (un fuseau perime cote hote). Teste le module LIVRE tel quel.
 *
 * Lancer : node test/echeances.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPEch = require('../public/echeances.js');

var fails = [];
var count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) { console.log('  OK   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}

/* Instant absolu (epoch ms) d'une heure legale Casablanca donnee, offset connu. */
function casa(y, mo, d, hh, mm, off) { return Date.UTC(y, mo - 1, d, hh, mm) - off * 60000; }

/* Resolver de test : hors Ramadan, Casablanca = UTC+1 tout septembre. */
var R60 = function () { return 60; };

var DL_DATE = '25/09/2026';
var DL_HEURE = '11:00';
function lib(nowMs, heure, resolver) {
  return MPEch.libelleEcheance(DL_DATE, heure === undefined ? DL_HEURE : heure,
    { nowMs: nowMs, offsetResolver: resolver || R60 });
}

console.log('\n=== 1. Une echeance 25/09/2026 11:00, heure CONNUE, rejouee ===');

var veille = lib(casa(2026, 9, 24, 18, 0, 60));
check('la veille (24/09 18:00) -> J-1, pas depassee',
  veille.jours === 1 && veille.passe === false && /^J-1/.test(veille.text),
  JSON.stringify(veille.text));

var matin = lib(casa(2026, 9, 25, 8, 0, 60));
check("le matin meme (08:00) -> aujourd'hui, encore 3 h, pas depassee",
  matin.passe === false && matin.jours === 0 && matin.urgence === 'aujourdhui'
    && /aujourd'hui/.test(matin.text) && /encore 3 h/.test(matin.text),
  JSON.stringify(matin.text));

var uneHeureAvant = lib(casa(2026, 9, 25, 10, 0, 60));
check('une heure avant (10:00) -> encore 1 h, pas depassee',
  uneHeureAvant.passe === false && /encore 1 h/.test(uneHeureAvant.text),
  JSON.stringify(uneHeureAvant.text));

var uneMinAvant = lib(casa(2026, 9, 25, 10, 59, 60));
check('une minute avant (10:59) -> encore 1 min, pas depassee',
  uneMinAvant.passe === false && /encore 1 min/.test(uneMinAvant.text),
  JSON.stringify(uneMinAvant.text));

var uneMinApres = lib(casa(2026, 9, 25, 11, 1, 60));
check('une minute apres (11:01) -> DEPASSEE depuis 1 min (verite a la minute)',
  uneMinApres.passe === true && uneMinApres.urgence === 'passe'
    && /depassee depuis 1 min/.test(uneMinApres.text),
  JSON.stringify(uneMinApres.text));

/* Preuve directe de non-regression du bug d'origine : a 14:00 le jour meme, le
 * module NE doit PAS dire "depassee depuis 1 jour" (l'ancien days() le faisait). */
var apresMidi = lib(casa(2026, 9, 25, 14, 0, 60));
check("l'apres-midi meme (14:00), heure 11:00 connue -> depassee depuis 3 h (PAS 1 jour)",
  apresMidi.passe === true && apresMidi.jours === 0 && /depassee depuis 3 h/.test(apresMidi.text),
  JSON.stringify(apresMidi.text));

console.log('\n=== 2. Meme echeance, heure INCONNUE (estimee 23:59, jamais chiffree) ===');

var estMatin = lib(casa(2026, 9, 25, 8, 0, 60), null);
check("heure estimee, jour meme -> libelle exact 'heure a confirmer sur le portail'",
  estMatin.estimee === true && estMatin.urgence === 'aujourdhui'
    && estMatin.text === "echeance aujourd'hui - heure a confirmer sur le portail",
  JSON.stringify(estMatin.text));
check('heure estimee -> AUCUNE duree chiffree affichee',
  !/encore/.test(estMatin.text) && !/\bh\b/.test(estMatin.text),
  JSON.stringify(estMatin.text));
check('heure estimee & encore ouverte -> sortRank 0 (remonte en tete)',
  estMatin.sortRank === 0, 'sortRank=' + estMatin.sortRank);

var estFinJournee = lib(casa(2026, 9, 25, 23, 58, 60), null);
check('heure estimee -> PAS depassee tant que la journee n\'est pas finie (23:58)',
  estFinJournee.passe === false && estFinJournee.urgence === 'aujourdhui',
  JSON.stringify(estFinJournee.text));

var estLendemain = lib(casa(2026, 9, 26, 0, 5, 60), null);
check('heure estimee -> depassee seulement une fois la journee passee (lendemain 00:05)',
  estLendemain.passe === true && /depassee le 25\/09\/2026/.test(estLendemain.text),
  JSON.stringify(estLendemain.text));

console.log('\n=== 3. Bascule d\'heure legale du 20/09 (offset +60 -> 0) ===');

/* Transition modelisee cote TEST : avant le 20/09 -> +60 ; a partir du 20/09 -> 0. */
var Rtrans = function (y, mo, d) { return (mo === 9 && d >= 20) ? 0 : 60; };
/* Echeance 20/09 11:00 (cote 0), "maintenant" le 19/09 23:00 (cote +60). */
var nowAvant = casa(2026, 9, 19, 23, 0, 60);
var ecT = MPEch.echeanceEpoch('20/09/2026', '11:00', Rtrans);
var trT = MPEch.tempsRestant(ecT.epoch, nowAvant);
check('offset applique PAR DATE (echeance cote 0)', ecT.offsetMin === 0, 'off=' + ecT.offsetMin);
check("l'heure survit a la bascule : reste 13 h, PAS 12 h (sinon 1 h perdue)",
  trT.jours === 0 && trT.heures === 13,
  'jours=' + trT.jours + ' heures=' + trT.heures);
var libT = MPEch.libelleEcheance('20/09/2026', '11:00', { nowMs: nowAvant, offsetResolver: Rtrans });
check('changement d\'heure legale dans l\'intervalle -> avertissement leve',
  libT.transitionWarn === true, 'transitionWarn=' + libT.transitionWarn);
check('sans transition dans l\'intervalle -> pas d\'avertissement (echeance septembre stable)',
  matin.transitionWarn === false, 'transitionWarn=' + matin.transitionWarn);

console.log('\n=== 4. Pin "heure estimee en tete" meme avec un tri actif ===');

/* Liste mixte : le comparateur reel de l'app met sortRank en cle PRIMAIRE, puis
 * le tri metier (ici score desc). On prouve que l'item estimee-ouvert sort 1er. */
var now = casa(2026, 9, 25, 8, 0, 60);
function entry(id, dateStr, heure, score) {
  var L = MPEch.libelleEcheance(dateStr, heure, { nowMs: now, offsetResolver: R60 });
  return { id: id, score: score, L: L };
}
var liste = [
  entry('A-score99', '30/09/2026', '10:00', 99),   // heure connue, gros score
  entry('B-score80', '28/09/2026', '11:00', 80),   // heure connue
  entry('C-ESTIMEE', '27/09/2026', null, 5),        // heure ESTIMEE, tout petit score
  entry('D-score95', '26/09/2026', '09:00', 95)
];
liste.sort(function (a, b) {
  if (a.L.sortRank !== b.L.sortRank) return a.L.sortRank - b.L.sortRank; // pin primaire
  return b.score - a.score;                                             // tri metier actif
});
check('l\'AO a heure estimee est en tete malgre le tri par score',
  liste[0].id === 'C-ESTIMEE', 'tete=' + liste[0].id);
check('sous le pin, le tri par score reste actif (99 avant 95 avant 80)',
  liste[1].id === 'A-score99' && liste[2].id === 'D-score95' && liste[3].id === 'B-score80',
  liste.map(function (x) { return x.id; }).join(','));

console.log('\n=== 5. Parsing tolerant (date + heure collee) ===');
check('accepte "JJ/MM/AAAA HH:MM" (heure collee)',
  (function () { var e = MPEch.echeanceEpoch('20/09/2026 14:30', null, R60);
    return e && e.parts.hh === 14 && e.parts.mm === 30 && e.estimee === false; })(), '');
check('accepte "JJ/MM/AAAA" seul -> estimee 23:59',
  (function () { var e = MPEch.echeanceEpoch('20/09/2026', null, R60);
    return e && e.parts.hh === 23 && e.parts.mm === 59 && e.estimee === true; })(), '');
check('heure separee prime sur l\'heure collee',
  (function () { var e = MPEch.echeanceEpoch('20/09/2026 14:30', '09:15', R60);
    return e && e.parts.hh === 9 && e.parts.mm === 15; })(), '');
check('date invalide -> null (pas de crash)',
  MPEch.echeanceEpoch('pas une date', null, R60) === null, '');

console.log('\n=== 6. Format ISO "AAAA-MM-JJ" (fiche AO, input type=date) ===');
/* Le module AO stocke date_limite en ISO ; la veille en JJ/MM/AAAA. Meme resultat. */
var isoAO = MPEch.libelleEcheance('2026-09-25', '11:00', { nowMs: casa(2026, 9, 25, 8, 0, 60), offsetResolver: R60 });
check('ISO 2026-09-25 11:00 le matin -> identique au format FR (encore 3 h)',
  isoAO.jours === 0 && isoAO.urgence === 'aujourdhui' && /encore 3 h/.test(isoAO.text),
  JSON.stringify(isoAO.text));
check('ISO sans heure -> estimee 23:59 + libelle "heure a confirmer"',
  (function () { var L = MPEch.libelleEcheance('2026-09-25', null, { nowMs: casa(2026, 9, 25, 8, 0, 60), offsetResolver: R60 });
    return L.estimee === true && L.text === "echeance aujourd'hui - heure a confirmer sur le portail"; })(), '');

console.log('\n---------------------------------------------------------------');
if (fails.length) {
  console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | '));
  process.exit(1);
} else {
  console.log('VERT : ' + count + ' / ' + count + ' assertions OK');
  process.exit(0);
}
