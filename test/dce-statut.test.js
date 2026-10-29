/* =========================================================================
 * GATE - Etat affiche du DCE (public/dce-statut.js), filet du 29/10/2026.
 *
 * Fixture piegee sur l'incident reel : 99/2026/CM reste en "downloading" du
 * 28/09 au 29/10 (run annule), sablier sans fin, relance refusee. Verifie :
 *   - une demande sans reponse au-dela du delai s'affiche INTERROMPUE et relancable,
 *     avec sa date lisible (fuseau Casablanca) et son motif ;
 *   - une demande recente reste "en cours" et NON relancable (pas de doublon) ;
 *   - une demande non datee est interrompue (sinon elle bloquerait pour toujours) ;
 *   - un DCE pret n'est jamais relancable ; un echec garde son message entier.
 *
 * Lancer : node test/dce-statut.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var M = require('../public/dce-statut.js');

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}
var MAINTENANT = Date.parse('2026-10-29T12:00:00Z');
function min(n) { return new Date(MAINTENANT - n * 60000).toISOString(); }

console.log('\n=== Filet : demande sans reponse ===');
var bloque = M.etat({ dce_status: 'downloading', dce_started_at: '2026-09-28T12:45:41Z' }, MAINTENANT);
check('99/2026/CM (28/09) -> interrompu', bloque.etat === 'interrompu', bloque.etat);
check('interrompu -> relancable', bloque.relancable === true);
check('motif date en heure de Casablanca', bloque.titre.indexOf('28/09/2026 à 13:45') >= 0, bloque.titre);
check('motif nomme le delai', bloque.titre.indexOf('plus de ' + M.DELAI_SANS_REPONSE_MIN + ' min') >= 0, bloque.titre);
var q = M.etat({ dce_status: 'queued', dce_started_at: min(M.DELAI_SANS_REPONSE_MIN + 1) }, MAINTENANT);
check('queued au-dela du delai -> interrompu', q.etat === 'interrompu', q.etat);
var nd = M.etat({ dce_status: 'queued' }, MAINTENANT);
check('demande non datee -> interrompu relancable', nd.etat === 'interrompu' && nd.relancable, nd.etat);
check('demande non datee : motif nomme', /non datee/.test(nd.titre), nd.titre);

console.log('\n=== Pas de doublon sur une demande vivante ===');
var r = M.etat({ dce_status: 'downloading', dce_started_at: min(10) }, MAINTENANT);
check('10 min -> en cours', r.etat === 'en_cours', r.etat);
check('en cours -> NON relancable', r.relancable === false);
var lim = M.etat({ dce_status: 'queued', dce_started_at: min(M.DELAI_SANS_REPONSE_MIN) }, MAINTENANT);
check('pile au delai -> encore en cours', lim.etat === 'en_cours', lim.etat);
check('delai >= 18 min (run max) + file', M.DELAI_SANS_REPONSE_MIN >= 30, M.DELAI_SANS_REPONSE_MIN);

console.log('\n=== Autres etats ===');
var p = M.etat({ dce_status: 'ready', dce_url: 'https://x/y.zip' }, MAINTENANT);
check('pret -> NON relancable', p.etat === 'pret' && p.relancable === false, p.etat);
var long = 'TimeoutError: Page.goto: Timeout 30000ms exceeded. ' + new Array(30).join('x ') + 'FIN';
var f = M.etat({ dce_status: 'failed', dce_error: long }, MAINTENANT);
check('echec -> relancable', f.etat === 'echec' && f.relancable === true);
check('echec : message entier, pas tronque', f.titre.indexOf('FIN') >= 0);
var fs0 = M.etat({ dce_status: 'failed' }, MAINTENANT);
check('echec sans message -> repli nomme', /cause non renseignee/.test(fs0.titre), fs0.titre);
check('jamais demande -> a_demander', M.etat({}, MAINTENANT).etat === 'a_demander');
check('pret sans lien -> a_demander (pas de lien mort)', M.etat({ dce_status: 'ready' }, MAINTENANT).etat === 'a_demander');

console.log('\n' + (count - fails.length) + '/' + count + ' OK');
process.exit(fails.length ? 1 : 0);
