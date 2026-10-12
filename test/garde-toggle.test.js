/* =========================================================================
 * GATE — Toggle « Garde de version » (DG seul). Verrou de câblage, complémentaire
 * des gates PURES : MPM.peutBasculerGarde (pv-mainlevee 127/127 : dg -> true, autres
 * -> false) et verdictVersion interrupteur (garde-version 19/19 : gardeVersionActive
 * false -> rien, bandeau éteint à la relecture).
 * Prouve le câblage : ① endpoint gardeVersionToggle gaté DG (403 nommé) + trace
 * (de -> vers) dans mp_config ; ② pgParametres ne montre le contrôle qu'au DG
 * (S._isDg), sinon « réservé au DG » ; ③ la bascule est EXEMPTée du write-guard
 * (le DG peut éteindre la garde même quand elle bloque).
 *
 * Lancer : node test/garde-toggle.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
var html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function bloc(src, de, a) { var i = src.indexOf(de); if (i < 0) return ''; var j = src.indexOf(a, i + de.length); return src.slice(i, j > i ? j : undefined); }
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }

console.log('\n=== ① endpoint gardeVersionToggle : DG seul (403 nommé) + trace ===');
var ep = bloc(api, '"gardeVersionToggle"', 'if (fn === "ping"');
check('endpoint localisé', ep.length > 200, 'len=' + ep.length);
check('gate DG via peutBasculerGarde + 403', /peutBasculerGarde\(role\)/.test(ep) && /status: 403/.test(ep) && /reservee au DG/i.test(ep), '');
check('écrit mp_config + trace (par, de -> vers)', /mp_config/.test(ep) && /gardeVersionActive_trace/.test(ep) && /de: avant/.test(ep) && /vers: active/.test(ep), '');
check('role lu depuis rh_users (même source que RH)', /getRoleFromDb/.test(ep) && /rh_users/.test(api), '');

console.log('\n=== ② pgParametres : contrôle réservé au DG ===');
var pg = bloc(html, 'function pgParametres', 'function chargerParamGarde');
var cp = bloc(html, 'function chargerParamGarde', 'function basculerGarde');
check('contrôle conditionné à S._isDg (sinon réservé au DG)', /S\._isDg/.test(cp) && /r[eé]serv[eé]+ au DG/i.test(cp), '');

console.log('\n=== ③ bascule EXEMPTée du write-guard (échappatoire DG) ===');
var af = bloc(html, 'function apiFetch', 'function apiList');
check('apiFetch laisse passer /api/garde-version-toggle même si bloquant', /garde-version-toggle/.test(af) && /S\._versionBloquant/.test(af), '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
