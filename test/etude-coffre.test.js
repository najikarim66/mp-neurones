/* =========================================================================
 * GATE — Étude d'AO : une pièce du coffre EXPIRÉE (ou qui expire avant le dépôt) est
 * détectée, sort en rouge dans le dossier avec « Demander la nouvelle », et compte dans
 * « manquantes ou expirées ». Alerte 15 jours avant l'expiration (rubrique à traiter).
 * Lancer : node test/etude-coffre.test.js
 * ========================================================================= */
'use strict';
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
var M, U, F;
try { M = require('../public/etude-calc.js'); U = require('../public/etude-ui.js'); F = require('./fixtures/etude-fixture.js'); }
catch (e) { check("modules de l'étude présents", false, e.message); fin(); }
if (typeof M.etatPieceCoffre !== 'function') { check('MPEtude.etatPieceCoffre existe', false); fin(); }
var doc = function (val) { return { id: 'c1', type: 'cnss', versions: [{ v: 1, date_validite: val }, { v: 2, date_validite: val }] }; };

console.log("\n=== État d'une pièce à la date de dépôt ===");
var a = M.etatPieceCoffre(doc('2026-10-20'), '2026-11-13', '2026-11-01');
check("validité 20/10, aujourd'hui 01/11 : expirée, rouge", a.etat === 'expire' && a.rouge, JSON.stringify(a));
var b = M.etatPieceCoffre(doc('2026-11-10'), '2026-11-13', '2026-11-01');
check('validité 10/11, dépôt 13/11 : expire AVANT le dépôt, rouge', b.etat === 'expire_avant_depot' && b.rouge && /avant le dépôt du 13\/11\/2026/.test(b.libelle), JSON.stringify(b));
var c = M.etatPieceCoffre(doc('2026-11-13'), '2026-11-13', '2026-11-01');
check('validité = jour du dépôt : valide', c.etat === 'valide' && !c.rouge, JSON.stringify(c));
check('aucun document : absent, rouge', M.etatPieceCoffre(null, '2026-11-13', '2026-11-01').etat === 'absent');
check('version COURANTE = la dernière déposée', M.versionCourante({ versions: [{ v: 1 }, { v: 2 }] }).v === 2);

console.log('\n=== Dossier de réponse ===');
var l = M.ligneDossier({ dossier: 'ADMINISTRATIF', piece: 'Attestation de la CNSS', sources: [] }, { coffre: F.COFFRE, dateDepot: '2026-11-13', aujourdhui: '2026-11-01' });
check('CNSS (fixture : expirée le 20/10) : état « expirée »', l.etat === 'expiree', JSON.stringify(l));
check('action « Demander la nouvelle »', l.action === 'Demander la nouvelle');
var lf = M.ligneDossier({ dossier: 'ADMINISTRATIF', piece: 'Attestation fiscale', sources: [] }, { coffre: F.COFFRE, dateDepot: '2026-11-13', aujourdhui: '2026-11-01' });
check('attestation fiscale valide : « jointe »', lf.etat === 'jointe' && /12\/03\/2027/.test(lf.detail), JSON.stringify(lf));
var lq = M.ligneDossier({ dossier: 'ADMINISTRATIF', piece: 'Attestation de qualification', sources: [] }, { coffre: F.COFFRE, dateDepot: '2026-11-13', aujourdhui: '2026-11-01' });
check('qualification absente du coffre : « à obtenir »', lq.etat === 'a_obtenir');
var cpt = M.compteursDossier([l, lf, lq]);
check('compteurs : 3 exigées, 1 prête, 2 manquantes ou expirées', cpt.exigees === 3 && cpt.pretes === 1 && cpt.manquantes === 2, JSON.stringify(cpt));

console.log('\n=== Libellés réels des RC (recette du 01/11/2026) ===');
var ctxR = { coffre: [], dateDepot: '2026-11-11', aujourdhui: '2026-11-01' };
var dh = M.ligneDossier({ dossier: 'ADMINISTRATIF', piece: "Une déclaration sur l'honneur, en un exemplaire unique, qui doit comporter les mentions prévues à l'article 29 du décret précité." }, ctxR);
check("« déclaration sur l'honneur » (libellé réel) : rédigée par MP", dh.origine === 'redige' && dh.type === 'declaration_honneur', JSON.stringify(dh));
var grp = M.ligneDossier({ dossier: 'ADMINISTRATIF', piece: "En cas de groupement : la convention constitutive du groupement prévue à l'article 150 du décret précité." }, ctxR);
var etr = M.ligneDossier({ dossier: 'ADMINISTRATIF', piece: "l'équivalent des attestations visées aux paragraphes a), b) et c) ci-dessus" }, ctxR);
check('groupement : « sans objet pour Neurones »', grp.etat === 'sans_objet', JSON.stringify(grp));
check('équivalent étranger : « sans objet pour Neurones »', etr.etat === 'sans_objet');
var abs = M.ligneDossier({ dossier: 'ADDITIF', piece: "ABSENT : le RC n'exige aucun dossier additif" }, ctxR);
check('« ABSENT » rendu par l\'analyse : « non exigé par le RC », pas une pièce manquante', abs.etat === 'non_exige', JSON.stringify(abs));
var c2 = M.compteursDossier([dh, grp, etr, abs]);
check('compteurs : 1 exigée, 3 hors compteurs nommées (sans objet)', c2.exigees === 1 && c2.manquantes === 0 && c2.sans_objet === 3, JSON.stringify(c2));

console.log('\n=== Alerte 15 jours ===');
var docs = [doc('2026-11-10'), { id: 'c2', type: 'rib', versions: [{ v: 1, date_validite: '2026-12-31' }] }, { id: 'c3', type: 'statuts', versions: [{ v: 1 }] }];
var al = M.alertesCoffre(docs, '2026-11-01', 15);
check('expire le 10/11 (sous 15 jours) : alerte', al.length === 1 && al[0].id === 'c1', JSON.stringify(al));
check("expire le 31/12 : pas d'alerte ; sans validité : pas d'alerte", al.length === 1);
check('déjà expiré : alerte « Expiré le »', M.alertesCoffre([doc('2026-10-20')], '2026-11-01', 15)[0].texte === 'Expiré le 20/10/2026');

console.log('\n=== Écrans rendus ===');
var html = U.htmlEtude(F.reponseApi(), { onglet: 'etude' }, Date.parse('2026-11-01T09:00:00Z')).html;
var row = (html.match(/<tr data-piece="cnss"[^>]*>(?:(?!<\/tr>).)*<\/tr>/) || [''])[0];
check('dossier : ligne CNSS rendue « Expirée » en rouge', /data-etat="expiree"/.test(row) && /et-tag bad">Expirée/.test(row), row.slice(0, 300));
check('dossier : bouton « Demander la nouvelle »', /Demander la nouvelle<\/button>/.test(row));
var hc = U.htmlCoffre(F.COFFRE, Date.parse('2026-11-01T09:00:00Z'));
check('coffre : rubrique « À traiter » avec 1 document', /data-a-traiter="1"/.test(hc) && /Attestation CNSS — Expiré le 20\/10\/2026/.test(hc), (hc.match(/data-a-traiter="\d+"/) || [''])[0]);
check('coffre : type absent nommé « Absent du coffre »', /Absent du coffre/.test(hc));
fin();
