/* =========================================================================
 * GATE — Garde de version MP (modele ERP 878acef : juger le CONTRAT, plus les
 * empreintes de commit ; + onglet perime). Node pur, sans dependance : les
 * fonctions de rendu renvoient des CHAINES HTML qu'on inspecte (marqueurs,
 * libelles) — equivalent « gate DOM » pour une app statique ES5.
 *
 * Prouve : ① verdict pur (API<exige -> bloquant ; =/> -> rien ; inconnu -> rien ;
 * entier lu depuis une chaine ; interrupteur) ; ② onglet perime (build deploye >
 * build execute -> bloquant) ; ③ les deux ensemble -> perime l'emporte ; ④ DOM :
 * bandeaux marques et distincts, rien quand tout va bien, badge NEURONES/Marches
 * Publics/build·sha·JJMM + survol build/commit API ; ⑤ ecritures suspendues des
 * que bloquant.
 *
 * Lancer : node test/garde-version.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var GV = require('../public/garde-version.js');
var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}
function has(s, sub) { return String(s).indexOf(sub) >= 0; }

var EXEC = { build: '1070', commit: '50d4013', buildDate: '2026-10-08T09:18:00Z', apiContractMin: 1 };
function api(o) { var a = { apiContract: 1, build: '951', commit: '7a009f9', gardeVersionActive: true }; for (var k in (o || {})) a[k] = o[k]; return a; }
function depl(o) { var d = { build: '1070', commit: '50d4013' }; for (var k in (o || {})) d[k] = o[k]; return d; }

console.log('\n=== 1. Verdict pur : juge le CONTRAT (aucune horloge, aucun commit) ===');
var vApi = GV.verdictVersion({ build: '1070', apiContractMin: 2 }, depl({ build: '1070' }), api({ apiContract: 1 }));
check('API < contrat exige -> bloquant, type api_retard', vApi.type === 'api_retard' && vApi.bloquant === true, JSON.stringify(vApi));
check('meme contrat -> rien (cas de tous les jours)', GV.verdictVersion(EXEC, depl(), api({ apiContract: 1 })).type === 'ok', '');
check('API EN AVANCE sur le contrat exige -> rien (compatible)', GV.verdictVersion({ build: '1070', apiContractMin: 1 }, depl(), api({ apiContract: 2 })).type === 'ok', '');
check('contrat servi en texte -> lu comme entier (pas compare en chaine)', GV.verdictVersion({ build: '1070', apiContractMin: 2 }, depl(), api({ apiContract: '1' })).bloquant === true, '');
check('numero manquant/illisible -> ne conclut JAMAIS (doctrine #35)', GV.verdictVersion({ build: '1070', apiContractMin: null }, depl(), api()).type === 'ok' && GV.verdictVersion(EXEC, depl(), api({ apiContract: null })).type === 'ok' && GV.verdictVersion(EXEC, depl(), api({ apiContract: 'x' })).type === 'ok' && GV.verdictVersion(null, null, null).type === 'ok', '');
check('interrupteur gardeVersionActive=false -> tout eteint, meme API en retard', GV.verdictVersion({ build: '1070', apiContractMin: 2 }, depl(), api({ apiContract: 1, gardeVersionActive: false })).type === 'ok', '');

console.log('\n=== 2. Onglet perime : build DEPLOYE > build EXECUTE ===');
check('deploye plus recent -> bloquant, type perime', GV.verdictVersion(EXEC, depl({ build: '1071' }), api()).type === 'perime' && GV.verdictVersion(EXEC, depl({ build: '1071' }), api()).bloquant === true, '');
check('meme build -> rien', GV.verdictVersion(EXEC, depl({ build: '1070' }), api()).type === 'ok', '');
check('deploye plus ancien (ne devrait pas arriver) -> rien (pas perime)', GV.verdictVersion(EXEC, depl({ build: '1069' }), api()).type === 'ok', '');
check('build inconnu -> ne conclut pas', GV.verdictVersion({ build: null, apiContractMin: 1 }, depl({ build: null }), api()).type === 'ok', '');

console.log('\n=== 3. Les deux a la fois -> onglet perime l\'emporte (recharger regle tout) ===');
check('perime + API en retard -> type perime', GV.verdictVersion({ build: '1070', apiContractMin: 2 }, depl({ build: '1071' }), api({ apiContract: 1 })).type === 'perime', '');

console.log('\n=== 4. DOM (chaines HTML) : bandeaux marques et distincts, rien si OK ===');
check('OK -> aucun bandeau (byte vide)', GV.bandeauHTML({ type: 'ok', bloquant: false }) === '', JSON.stringify(GV.bandeauHTML({ type: 'ok' })));
var bP = GV.bandeauHTML(GV.verdictVersion(EXEC, depl({ build: '1071' }), api()));
check('bandeau perime : marque data-version-perime + « Nouvelle version disponible — Recharger »', has(bP, 'data-version-perime') && has(bP, 'Nouvelle version disponible') && has(bP, 'Recharger'), bP.slice(0, 120));
var bA = GV.bandeauHTML(GV.verdictVersion({ build: '1070', apiContractMin: 2 }, depl(), api({ apiContract: 1 })));
check('bandeau API : marque data-version-api + « Mise en service en cours »', has(bA, 'data-version-api') && has(bA, 'Mise en service en cours'), bA.slice(0, 120));
check('les deux marqueurs sont distincts', !has(bP, 'data-version-api') && !has(bA, 'data-version-perime'), '');
var badge = GV.badgeHTML(EXEC, api({ build: '951', commit: '7a009f9' }));
check('badge : NEURONES / Marches Publics / build·sha·JJ/MM', has(badge, 'NEURONES') && has(badge, 'Marchés Publics') && has(badge, 'build 1070') && has(badge, '50d4013') && has(badge, '08/10'), badge.slice(0, 160));
check('badge : survol = build + commit de l\'API', has(badge, '951') && has(badge, '7a009f9') && /title="[^"]*API/.test(badge), badge.slice(0, 200));

console.log('\n=== 5. Ecritures suspendues des que bloquant (message nomme la cause + le geste) ===');
check('perime -> bloquant + message dit « rien n\'a ete envoye » + recharger', GV.MSG_REFUS_PERIME.indexOf('envoy') >= 0 && /recharg/i.test(GV.MSG_REFUS_PERIME), '');
check('API retard -> message dit mise en service + reessayez', /mise en service/i.test(GV.MSG_REFUS_API) && /ssayez|minutes/i.test(GV.MSG_REFUS_API), '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
