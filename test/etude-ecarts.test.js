/* =========================================================================
 * GATE — Étude d'AO : un écart de date limite (ou d'heure, ou d'estimation) entre le
 * DOSSIER et la FICHE AO est signalé, en rouge sur l'écran rendu.
 * Exécute MPEtude.ecartsFiche puis le rendu MPEtudeUI.htmlEtude (fixture : dossier
 * 13/11/2026, fiche 12/11/2026). Lancer : node test/etude-ecarts.test.js
 * ========================================================================= */
'use strict';
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
var M, U, F;
try { M = require('../public/etude-calc.js'); U = require('../public/etude-ui.js'); F = require('./fixtures/etude-fixture.js'); }
catch (e) { check("modules de l'étude présents", false, e.message); fin(); }
if (typeof M.ecartsFiche !== 'function') { check('MPEtude.ecartsFiche existe', false); fin(); }

console.log('\n=== Comparaison dossier / fiche ===');
var faits = { date_limite: { valeur: '13/11/2026' }, heure_limite: { valeur: '10:00' }, estimation: { valeur: '3 480 000,00 DH TTC' } };
var e1 = M.ecartsFiche(faits, { date_limite: '2026-11-12', heure_limite: '10:00', estimation: 3480000 });
var d = e1.filter(function (x) { return x.champ === 'date_limite'; })[0];
check('date limite 13/11 (dossier) différente de 12/11 (fiche) : écart', d && d.ecart === true, JSON.stringify(d));
check("heure identique : pas d'écart", !e1.filter(function (x) { return x.champ === 'heure_limite'; })[0].ecart);
check("estimation identique (3 480 000,00 DH TTC = 3480000) : pas d'écart", !e1.filter(function (x) { return x.champ === 'estimation'; })[0].ecart, JSON.stringify(e1[2]));
var e2 = M.ecartsFiche({ date_limite: { valeur: '13 novembre 2026' }, heure_limite: { valeur: '10h30' }, estimation: { valeur: '3 500 000 DH' } }, { date_limite: '2026-11-13', heure_limite: '10:00', estimation: '3480000' });
check("« 13 novembre 2026 » = 2026-11-13 : pas d'écart", !e2[0].ecart, JSON.stringify(e2[0]));
check('heure 10h30 différente de 10:00 : écart', e2[1].ecart === true, JSON.stringify(e2[1]));
check('estimation 3 500 000 différente de 3 480 000 : écart', e2[2].ecart === true, JSON.stringify(e2[2]));
var e3 = M.ecartsFiche({ date_limite: { valeur: '13/11/2026' } }, {});
check('fiche sans date : « incomplet », pas « identique »', e3[0].incomplet === true && e3[0].ecart === false);
check('dossier sans estimation : nommé « non lue dans le dossier »', /non lue dans le dossier/.test(e3[2].dossier));

console.log('\n=== Écran rendu ===');
var html = U.htmlEtude(F.reponseApi(), { onglet: 'etude' }, Date.parse('2026-11-01T09:00:00Z')).html;
var row = (html.match(/<tr data-ecart="date_limite"[^>]*>(?:(?!<\/tr>).)*<\/tr>/) || [''])[0];
check('ligne « date limite » rendue', !!row);
check('ligne « date limite » en rouge (data-rouge + classe et-ecart)', /data-rouge="1"/.test(row) && /class="et-ecart">13\/11\/2026/.test(row) && /class="et-ecart">12\/11\/2026/.test(row), row.slice(0, 300));
check('libellé « Écart : à corriger »', /Écart : à corriger/.test(row));
var rowH = (html.match(/<tr data-ecart="heure_limite"[^>]*>(?:(?!<\/tr>).)*<\/tr>/) || [''])[0];
check('heure identique : pas en rouge', rowH && rowH.indexOf('data-rouge') < 0 && /Identique/.test(rowH), rowH.slice(0, 200));
fin();
