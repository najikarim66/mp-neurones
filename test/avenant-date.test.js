/* =========================================================================
 * GATE — Date de signature de l'avenant : jamais silencieusement defaultee,
 * toujours la date DU DOCUMENT, repli nomme a l'affichage (meme classe de defaut
 * que la date du PV corrigee en c4d78bc ; doctrines #2 et « quand le systeme ne
 * sait pas, il ne propose pas une valeur plausible »).
 *
 * Node pur, sans dependance : scanne les deux formulaires avenant de index.html.
 * Prouve : ① aucun des deux champs av_date n'est pre-rempli a aujourd'hui
 * (new Date / toISOString) ; ② les DEUX labels « Date de signature » portent le
 * repere « figure sur l'avenant » (le NOUVEL avenant l'avait deja ; l'EDITION
 * ne l'avait pas -> rouge) ; ③ les deux sauvegardes refusent une date vide ;
 * ④ l'affichage d'une date absente est un repli NOMME, pas un « - » nu.
 *
 * Lancer : node test/avenant-date.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function bloc(de, a) { var i = src.indexOf(de); if (i < 0) return ''; var j = src.indexOf(a, i + de.length); return src.slice(i, j > i ? j : undefined); }
var ajout = bloc('function showAddAvenant(', 'function showEditAvenant(');
var edit = bloc('function showEditAvenant(', 'function delAvenant(');
var rendu = bloc('function renderAvenantsSection(', 'function showAddAvenant(');

var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function labelDate(b) { var m = /Date de signature[^<]*/.exec(b); return m ? m[0] : ''; }

console.log('\n=== Date de signature avenant : document, jamais aujourd\'hui ===');
check('nouvel avenant : av_date non pre-rempli a aujourd\'hui', ajout.indexOf('av_date') >= 0 && !/av_date[^;]*(new Date|toISOString)/.test(ajout) && /id="av_date"[^>]*value=""/.test(ajout), '');
check('edition avenant : av_date pre-rempli par la date STOCKEE, jamais aujourd\'hui', !/av_date[^;]*(new Date|toISOString)/.test(edit) && /id="av_date"[^>]*value="'\s*\+\s*esc\(av\.date_signature/.test(edit), '');
check('nouvel avenant : label porte « figure sur l\'avenant »', /figure sur l\\?'avenant/.test(labelDate(ajout)), labelDate(ajout));
check('edition avenant : label porte « figure sur l\'avenant » (coherence)', /figure sur l\\?'avenant/.test(labelDate(edit)), labelDate(edit));
check('edition avenant : champ date marque required', /id="av_date"[^>]*required/.test(edit), '');
check('nouvel avenant : sauvegarde refuse une date vide', /!dateSig/.test(ajout), '');
check('edition avenant : sauvegarde refuse une date vide', /!dateSig/.test(edit), '');
check('affichage : date absente -> repli NOMME, pas un tiret nu', rendu.indexOf('date_signature') >= 0 && !/date_signature\?fdat\(a\.date_signature\):'-'/.test(rendu) && /date_signature\?fdat\(a\.date_signature\):'[^-]/.test(rendu), '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
