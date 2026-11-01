/* =========================================================================
 * GATE — Étude d'AO : toute donnée affichée a une SOURCE ou la mention « à vérifier ».
 *
 * Exécute la lecture réelle de la réponse (lignes + citations de l'API) puis le RENDU de
 * l'écran (MPEtudeUI.htmlEtude) sur une fixture synthétique. Vérifie :
 *  - une donnée citée garde l'extrait exact et sa page (index de caractère → page) ;
 *  - une donnée sans citation sort « à vérifier », jamais comme une donnée sûre ;
 *  - chaque fait, clause, pièce, condition, question, article affiché porte un bouton source ;
 *  - une clause absente est signalée « absent du dossier : à vérifier » ;
 *  - la date des éclaircissements, calculée, est toujours « à vérifier ».
 * Lancer : node test/etude-sources.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }

var M, U, F;
try { M = require('../public/etude-calc.js'); U = require('../public/etude-ui.js'); F = require('./fixtures/etude-fixture.js'); }
catch (e) { check('modules de l\'étude présents (public/etude-calc.js, public/etude-ui.js)', false, e.message); fin(); }

console.log('\n=== Lecture de la réponse : lignes + citations ===');
var lignes = M.lireLignes(F.BLOCS, F.DOCS);
var r = M.construireResultat(lignes);
var cp = r.faits.caution_provisoire;
check('caution provisoire lue', cp && cp.valeur === '35 000,00 DH', JSON.stringify(cp && cp.valeur));
check('caution provisoire : extrait EXACT du RC', cp && cp.sources[0] && cp.sources[0].extrait === 'Le montant du cautionnement provisoire est fixé à trente-cinq mille dirhams (35 000,00 DH).');
check('caution provisoire : page 1 du RC (index de caractère → page)', cp && cp.sources[0].page === 1 && cp.sources[0].classe === 'rc', JSON.stringify(cp && cp.sources[0]));
check('éclaircissements : page 2 du RC', r.faits.eclaircissements.sources[0].page === 2);
check('pénalités : page 2 du CPS', r.clauses.filter(function (c) { return c.cle === 'penalites'; })[0].sources[0].page === 2);
check('contexte autour de l\'extrait conservé (avant / après)', typeof cp.sources[0].avant === 'string' && cp.sources[0].avant.indexOf('Article 5') >= 0);
var q = r.faits.qualification;
check('qualification : donnée SANS citation', q && q.sources.length === 0);
check('qualification : état « à vérifier »', M.etatSource(q).etat === 'a_verifier' && /à vérifier/.test(M.etatSource(q).libelle));
check('citation à extrait vide ignorée (pas de fausse source)', M.sourceDeCitation({ type: 'char_location', cited_text: '  ', document_index: 0, start_char_index: 0, end_char_index: 1 }, F.DOCS) === null);
check('citation vers un document inexistant ignorée', M.sourceDeCitation({ type: 'char_location', cited_text: 'x', document_index: 9, start_char_index: 0, end_char_index: 1 }, F.DOCS) === null);
var abs = r.clauses.filter(function (c) { return c.cle === 'delai_paiement'; })[0];
check('clause absente : marquée absente', abs && abs.absent === true);
check('clause absente : « Absent du dossier : à vérifier »', /^Absent du dossier : à vérifier/.test(M.etatSource(abs).libelle));
check('clause jamais mentionnée (assurances) ajoutée comme absente', r.clauses.some(function (c) { return c.cle === 'assurances' && c.absent; }));
check('8 pièces du RC relevées', r.pieces.length === 8, r.pieces.length);

console.log('\n=== Écran rendu : chaque donnée a son bouton source ===');
var d = F.reponseApi();
var out = U.htmlEtude(d, { onglet: 'etude' }, Date.parse('2026-11-01T09:00:00Z'));
var html = out.html;
function blocs(attr) { var re = new RegExp('<(div|tr|li)[^>]*' + attr + '="[^"]*"[^>]*>', 'g'), m, res = []; while ((m = re.exec(html))) { var deb = m.index, tag = m[1], prof = 0, i = deb; var reT = new RegExp('<' + tag + '[ >]|</' + tag + '>', 'g'); reT.lastIndex = deb; var t; while ((t = reT.exec(html))) { if (t[0].charAt(1) === '/') { prof--; if (prof === 0) { res.push(html.slice(deb, t.index + t[0].length)); break; } } else prof++; } } return res; }
['data-fait', 'data-clause', 'data-piece', 'data-item', 'data-question'].forEach(function (a) {
  var bs = blocs(a);
  check(a + ' : au moins un élément rendu', bs.length > 0, bs.length);
  var sans = bs.filter(function (b) { return b.indexOf('data-src=') < 0; });
  check(a + ' : TOUS portent un bouton source (' + bs.length + ')', sans.length === 0, sans[0] && sans[0].slice(0, 160));
});
var reg = out.reg.items;
var faux = reg.filter(function (x) { return x.etat.etat === 'source' && !(x.item.sources && x.item.sources[0] && x.item.sources[0].extrait); });
check('aucun bouton « source » sans extrait exact derrière', faux.length === 0, faux.length);
var btnQ = blocs('data-fait').filter(function (b) { return b.indexOf('data-fait="qualification"') >= 0; })[0] || '';
check('qualification affichée avec « à vérifier » (bouton warn)', /class="et-src warn"[^>]*data-averifier="1">à vérifier/.test(btnQ), btnQ.slice(0, 300));
var btnCp = blocs('data-fait').filter(function (b) { return b.indexOf('data-fait="caution_provisoire"') >= 0; })[0] || '';
check('caution affichée avec sa référence « RC art. 5, p. 1 »', btnCp.indexOf('RC art. 5, p. 1') >= 0, btnCp.slice(0, 300));
var ecl = blocs('data-fait').filter(function (b) { return b.indexOf('data-fait="eclaircissements"') >= 0; })[0] || '';
check('éclaircissements : date calculée affichée', /data-calcule="1">Jusqu'au 05\/11\/2026/.test(ecl), ecl.slice(0, 400));
check('éclaircissements : date calculée « à vérifier »', /à vérifier : date calculée/.test(ecl));
var art = U.htmlEtude(d, { onglet: 'bordereau' }, Date.parse('2026-11-01T09:00:00Z')).html;
var nArt = (art.match(/<tr data-article=/g) || []).length;
var nArtSrc = (art.match(/<tr data-article="[^"]*">(?:(?!<\/tr>).)*data-src=/g) || []).length;
check('bordereau : 3 articles rendus, tous avec leur source (feuille, ligne)', nArt === 3 && nArtSrc === 3, nArt + ' / ' + nArtSrc);
check('bordereau : source tableur nommée « feuille BPDE, ligne N »', /feuille BPDE, ligne 5/.test(art));
var sel = U.htmlEtude(d, { onglet: 'etude', sel: 1 }).html;
check('panneau source : extrait exact surligné (<mark>)', /<mark>[^<]*cautionnement provisoire est fixé[^<]*<\/mark>/.test(sel) || /<mark>[^<]*pénalité journalière[^<]*<\/mark>/.test(sel), (sel.match(/<mark>[^<]*<\/mark>/) || [''])[0]);
fin();
