/* =========================================================================
 * GATE - Demande de mainlevee a la banque (regle DG 20/11/2026).
 *
 * Execute la logique PURE (public/pv-mainlevee.js, public/cautions-calc.js) et le generateur de
 * lettre (api/lettre-mainlevee.js, pdf-lib) sur une fixture piegee :
 *  1. CYCLE  : active -> piece_recue (mainlevee du client OU original restitue, date + scan)
 *              -> demande_deposee (date de depot) -> liberee (accuse) ; pas de saut d'etat ;
 *              provisoires au meme regime ; ancien « mainlevee_recue » lu piece_recue.
 *  2. GARDES : pas de demande a la banque sans piece jointe au type enregistre ; scan obligatoire
 *              (original comme mainlevee) ; pas de « liberee » sans accuse (liberation directe fermee,
 *              formulaire refuse) ; derniere caution liberee -> marche termine (08/10, inchangee).
 *  3. LETTRE : une banque, plusieurs cautions, objet ENTIER sans ellipse, aucun identifiant technique,
 *              PDF valide (en-tete, pagination), montant et numero presents dans le texte.
 *  4. ECRAN  : blocs « a demander » / « en attente » (groupage par banque, jours, alerte au-dela du delai).
 *
 * Lancer : node test/mainlevee-banque.test.js   (exit 0 = vert, 1 = rouge)
 * Variable LETTRE_MAINLEVEE_OUT=<chemin.pdf> : ecrit aussi l'exemplaire genere (preuve de recette).
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var MPM = require('../public/pv-mainlevee.js');
var MPC = require('../public/cautions-calc.js');

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}
var NOW = new Date('2026-11-20T12:00:00Z').getTime();
var SCAN = { blob: 'm1/caution-c1/mainlevee_client.pdf', nom_original: 'ml.pdf', taille: 10, content_type: 'application/pdf' };
var SCAN_ORIG = { blob: 'm1/caution-c2/original_caution.pdf', nom_original: 'orig.pdf', taille: 10, content_type: 'application/pdf' };
var ACC = { blob: 'm1/caution-c1/accuse_banque.pdf', nom_original: 'acc.pdf' };
function cau(o) { var b = { id: 'c1', num: '694066', referenceBanque: '810012624000694066', type: 'bonne_execution', banque: 'BMCE Bank', montant: 99072, date_emission: '2018-06-12', statut: 'active', marcheId: 'm1' }; Object.keys(o || {}).forEach(function (k) { b[k] = o[k]; }); return b; }

console.log('\n=== 1. Cycle : active -> piece recue -> demande deposee -> liberee ===');
var c0 = cau();
check('reception recevable depuis active (mainlevee client) et (original)', MPM.pieceLiberationRecevable(c0, 'mainlevee_client') && MPM.pieceLiberationRecevable(c0, 'original_caution'), '');
check('reception recevable depuis mainlevee_demandee (demandee au client)', MPM.pieceLiberationRecevable(cau({ statut: 'mainlevee_demandee' }), 'mainlevee_client') === true, '');
check('type de piece inconnu -> refus', MPM.pieceLiberationRecevable(c0, 'pv') === false, '');
check('reception SANS scan -> null (le scan part a la banque)', MPM.appliquerPieceLiberation(c0, 'original_caution', null, '2026-11-18', 'u') === null && MPM.appliquerPieceLiberation(c0, 'mainlevee_client', {}, '2026-11-18', 'u') === null, '');
check('reception SANS date -> null (jamais completee par defaut)', MPM.appliquerPieceLiberation(c0, 'mainlevee_client', SCAN, '', 'u') === null, '');
var c1 = MPM.appliquerPieceLiberation(c0, 'mainlevee_client', SCAN, '2026-11-18', 'u@neurones.ma');
check('reception mainlevee client -> piece_recue, piece_liberation {type,date,scan}, champ historique pose', c1.statut === 'piece_recue' && c1.piece_liberation.type === 'mainlevee_client' && c1.piece_liberation.date === '2026-11-18' && c1.piece_liberation.scan === SCAN && c1.mainlevee_client === SCAN && c1.date_mainlevee_recue === '2026-11-18', JSON.stringify(c1));
check('ne mute pas l\'entree', c0.statut === 'active' && !c0.piece_liberation, '');
var c2 = MPM.appliquerPieceLiberation(cau({ id: 'c2', num: '2221776/S', referenceBanque: null, montant: 9000 }), 'original_caution', SCAN_ORIG, '2026-11-19', 'u');
check('reception original restitue -> piece_recue, original_caution + date_original_recu', c2.statut === 'piece_recue' && c2.piece_liberation.type === 'original_caution' && c2.original_caution === SCAN_ORIG && c2.date_original_recu === '2026-11-19', '');
check('pas de seconde reception sur piece_recue', MPM.pieceLiberationRecevable(c1, 'original_caution') === false, '');
check('accuse NON recevable sur piece_recue (ordre : depot a la banque d\'abord)', MPM.pieceRecevable(c1, 'accuse_banque') === false, '');
var d1 = MPM.appliquerDepotBanque(c1, '2026-11-20', 'u@neurones.ma', { blob: 'lettres-mainlevee/x.pdf' });
check('depot -> demande_deposee + demande_banque {date_depot, depose_par, lettre}', d1.statut === 'demande_deposee' && d1.demande_banque.date_depot === '2026-11-20' && d1.demande_banque.depose_par === 'u@neurones.ma' && d1.demande_banque.lettre.blob === 'lettres-mainlevee/x.pdf', JSON.stringify(d1.demande_banque));
check('depot SANS date valide -> null', MPM.appliquerDepotBanque(c1, '', 'u') === null && MPM.appliquerDepotBanque(c1, '20/11/2026', 'u') === null, '');
check('second depot refuse (deja deposee)', MPM.depotBanqueRecevable(d1).ok === false && /deja deposee/.test(MPM.depotBanqueRecevable(d1).motif), MPM.depotBanqueRecevable(d1).motif);
check('decharge recevable sur demande_deposee, statut inchange', MPM.pieceRecevable(d1, 'decharge_banque') === true && MPM.appliquerPiece(d1, 'decharge_banque', { blob: 'd' }, '2026-11-20').statut === 'demande_deposee', '');
check('decharge deja jointe -> refus (pas d\'ecrasement muet)', MPM.pieceRecevable(MPM.appliquerPiece(d1, 'decharge_banque', { blob: 'd' }, '2026-11-20'), 'decharge_banque') === false, '');
check('accuse recevable sur demande_deposee', MPM.pieceRecevable(d1, 'accuse_banque') === true, '');
var l1 = MPM.appliquerPiece(d1, 'accuse_banque', ACC, '2026-11-25');
check('accuse -> liberee + date_liberation + accuse_banque', l1.statut === 'liberee' && l1.date_liberation === '2026-11-25' && l1.accuse_banque === ACC, '');
check('provisoire (type provisoire) suit le meme cycle', (function () {
  var p = { num: 'P1', type: 'provisoire', banque: 'CIH', montant: 50000, statut: 'active' };
  var r = MPM.appliquerPieceLiberation(p, 'original_caution', SCAN_ORIG, '2026-11-10', 'u');
  var d = r && MPM.appliquerDepotBanque(r, '2026-11-12', 'u');
  return !!d && d.statut === 'demande_deposee' && MPM.pieceRecevable(d, 'accuse_banque') === true && MPM.appliquerPiece(d, 'accuse_banque', ACC, '2026-11-20').statut === 'liberee';
})(), '');
check('soumission / avance de demarrage : hors cycle (refus nomme)', MPM.pieceLiberationRecevable(cau({ type: 'soumission' }), 'mainlevee_client') === false && /hors cycle/.test(MPM.depotBanqueRecevable(cau({ type: 'avance_demarrage', statut: 'piece_recue' })).motif), '');
var ancien = cau({ statut: 'mainlevee_recue', mainlevee_client: SCAN, date_mainlevee_recue: '2026-10-01' });
check('ancien mainlevee_recue : lu piece_recue, piece = mainlevee client, depot recevable', MPM.etatCycle(ancien) === 'piece_recue' && MPM.pieceLiberationDe(ancien).type === 'mainlevee_client' && MPM.depotBanqueRecevable(ancien).ok === true, JSON.stringify(MPM.depotBanqueRecevable(ancien)));

console.log('\n=== 2. Gardes ===');
check('garde depot : aucune piece recue (active) -> refus nomme', (function () { var g = MPM.depotBanqueRecevable(c0); return g.ok === false && /aucune piece recue/.test(g.motif); })(), '');
check('garde depot : type de piece non enregistre -> refus nomme', (function () { var g = MPM.depotBanqueRecevable(cau({ statut: 'piece_recue' })); return g.ok === false && /type de piece non enregistre/.test(g.motif); })(), '');
check('garde depot : original SANS scan -> refus « scan de l\'original obligatoire »', (function () { var g = MPM.depotBanqueRecevable(cau({ statut: 'piece_recue', piece_liberation: { type: 'original_caution', date: '2026-11-19', scan: null } })); return g.ok === false && /scan de l'original/.test(g.motif); })(), '');
check('garde depot : mainlevee client SANS scan -> refus « scan de la mainlevee obligatoire »', (function () { var g = MPM.depotBanqueRecevable(cau({ statut: 'piece_recue', piece_liberation: { type: 'mainlevee_client', date: '2026-11-19' } })); return g.ok === false && /scan de la mainlevee/.test(g.motif); })(), '');
check('garde depot : piece sans date -> refus', MPM.depotBanqueRecevable(cau({ statut: 'piece_recue', piece_liberation: { type: 'mainlevee_client', scan: SCAN } })).ok === false, '');
check('garde depot : piece complete -> ok', MPM.depotBanqueRecevable(c1).ok === true && MPM.depotBanqueRecevable(c2).ok === true, '');
check('pas de « liberee » sans accuse : accuse refuse sur active / mainlevee_demandee / piece_recue', !MPM.pieceRecevable(c0, 'accuse_banque') && !MPM.pieceRecevable(cau({ statut: 'mainlevee_demandee' }), 'accuse_banque') && !MPM.pieceRecevable(c1, 'accuse_banque'), '');
check('formulaire : passer en liberee / piece_recue / demande_deposee / restituee REFUSE (motif nomme)', ['liberee', 'piece_recue', 'demande_deposee', 'restituee', 'mainlevee_recue'].every(function (st) { return !!MPM.refusChangementStatutGenerique(cau(), cau({ statut: st })); }), '');
check('formulaire : creation directe en liberee REFUSEE, creation en active acceptee', !!MPM.refusChangementStatutGenerique(null, cau({ statut: 'liberee' })) && MPM.refusChangementStatutGenerique(null, cau()) === null, '');
check('formulaire : active <-> expiree / mainlevee_demandee, statut inchange, retour vers active : acceptes', MPM.refusChangementStatutGenerique(cau(), cau({ statut: 'expiree' })) === null && MPM.refusChangementStatutGenerique(cau(), cau({ statut: 'mainlevee_demandee' })) === null && MPM.refusChangementStatutGenerique(d1, d1) === null && MPM.refusChangementStatutGenerique(l1, cau()) === null, '');
check('anti-clobber : les champs du cycle sont dans CHAMPS_PIECES_CAUTION (preserves par le serveur)', ['piece_liberation', 'demande_banque', 'original_caution', 'lettre_mainlevee', 'decharge_banque', 'accuse_banque', 'mainlevee_client'].every(function (k) { return MPM.CHAMPS_PIECES_CAUTION.indexOf(k) >= 0; }), '');
var marche = { id: 'm1', statut: 'en_cours', reception_definitive_prononcee: true };
check('regle 08/10 inchangee : derniere caution liberee (par accuse) + PV -> marche termine', (function () { var m = MPM.appliquerStatutMarche(marche, [l1, cau({ id: 'c9', statut: 'liberee', accuse_banque: ACC })], '2026-11-25'); return !!m && m.statut === 'termine'; })(), '');
check('regle 08/10 : une caution encore en attente de la banque -> le marche ne se termine pas', MPM.appliquerStatutMarche(marche, [l1, d1], '2026-11-25') === null, '');

console.log('\n=== 3. Lettre : donnees pures, SANS AUCUNE SAISIE (referentiel des banques et agences) ===');
var OBJET = 'Travaux de mise en place d\'un systeme de videosurveillance et de controle d\'acces pour les batiments administratifs de la province, lot unique, tranche ferme et tranche conditionnelle';
var gm = function (id) { return id === 'm1' ? { ref: 'MAR201800146/2018', titre: OBJET, objet: OBJET, maitre_ouvrage: 'Province de Settat' } : {}; };
var typeLabel = function (t) { return ({ bonne_execution: 'Caution definitive', retenue_garantie: 'Caution de retenue de garantie' })[t] || t; };
var AG1 = { id: 'ag1', nom: 'Agence Casablanca Maarif', adresse: '140, boulevard Zerktouni', ville: 'Casablanca', destinataire: 'Service des engagements par signature', par_defaut: true, statut: 'confirmee' };
var AG2 = { id: 'ag2', nom: 'Agence Rabat Agdal', adresse: '12, avenue de France', ville: 'Rabat', destinataire: '', par_defaut: false, statut: 'confirmee' };
var AG3 = { id: 'ag3', nom: 'Agence Fes', adresse: '', ville: '', destinataire: '', par_defaut: false, statut: 'a_confirmer', sources: [{ caution_num: 'X' }] };
var BANQUES = [{ id: 'bk_bmce', nom: 'BMCE Bank', agences: [AG1, AG2, AG3] }, { id: 'bk_finea', nom: 'FINEA', agences: [] }];
check('resoudreAgence : agence_id de la caution', MPM.resoudreAgence(cau({ agence_id: 'ag2' }), BANQUES).agence === AG2, '');
check('resoudreAgence : sans agence_id -> agence par defaut de la banque', MPM.resoudreAgence(c1, BANQUES).agence === AG1, '');
check('resoudreAgence : banque sans fiche -> refus qui NOMME la fiche', (function () { var r = MPM.resoudreAgence(cau({ banque: 'CIH Bank' }), BANQUES); return r.ok === false && r.fiche === 'CIH Bank' && /Parametres/.test(r.motif); })(), '');
check('resoudreAgence : fiche sans agence -> refus nomme (FINEA)', (function () { var r = MPM.resoudreAgence(cau({ banque: 'FINEA' }), BANQUES); return r.ok === false && r.fiche === 'FINEA' && /aucune agence/.test(r.motif); })(), '');
check('resoudreAgence : agence lue « a confirmer » et sans adresse -> refus (adresse manquante, fiche nommee)', (function () { var r = MPM.resoudreAgence(cau({ agence_id: 'ag3' }), BANQUES); return r.ok === false && /adresse manquante/.test(r.motif) && r.fiche === 'BMCE Bank'; })(), '');
check('resoudreAgence : agence complete mais « a confirmer » -> refus (a confirmer)', (function () { var r = MPM.resoudreAgence(cau({ agence_id: 'ag4' }), [{ id: 'b', nom: 'BMCE Bank', agences: [{ id: 'ag4', nom: 'Agence Tanger', adresse: 'Rue X', statut: 'a_confirmer' }] }]); return r.ok === false && /a confirmer/.test(r.motif); })(), '');
check('resoudreAgence : casse et espaces du nom de banque toleres', MPM.resoudreAgence(cau({ banque: ' bmce  bank ' }), BANQUES).ok === true, '');
var L = MPM.lignesLettre([c1, c2], gm, typeLabel, BANQUES);
check('deux cautions de la meme banque et de la meme agence -> une lettre, total 108 072, AUCUNE saisie', L.ok === true && L.banque === 'BMCE Bank' && L.lignes.length === 2 && L.total === 108072, JSON.stringify(L.erreurs));
check('destinataire resolu du referentiel : agence, adresse, ville, service', L.destinataire && L.destinataire.agence === AG1.nom && L.destinataire.adresse === AG1.adresse && L.destinataire.ville === 'Casablanca' && /engagements/.test(L.destinataire.destinataire), JSON.stringify(L.destinataire));
check('objet du marche ENTIER (aucune ellipse), reference et maitre d\'ouvrage portes', L.lignes[0].marche_objet === OBJET && L.lignes[0].marche_ref === 'MAR201800146/2018' && L.lignes[0].maitre_ouvrage === 'Province de Settat', '');
check('numero = reference banque complete si presente, sinon alias', L.lignes[0].num === '810012624000694066' && L.lignes[1].num === '2221776/S', '');
check('piece jointe nommee par ligne (mainlevee client / original) avec sa date', /Mainlevee delivree/.test(L.lignes[0].piece) && L.lignes[0].piece_date === '2026-11-18' && /Original de la caution/.test(L.lignes[1].piece) && L.lignes[1].piece_date === '2026-11-19', '');
check('aucun identifiant technique dans les lignes (id, marcheId, blob)', JSON.stringify(L.lignes).indexOf('"id"') < 0 && JSON.stringify(L.lignes).indexOf('marcheId') < 0 && JSON.stringify(L.lignes).indexOf('blob') < 0 && JSON.stringify(L.lignes).indexOf('c1') < 0, JSON.stringify(L.lignes));
check('deux AGENCES differentes de la meme banque -> JAMAIS regroupees (refus nomme)', (function () { var c2b = {}; Object.keys(c2).forEach(function (k) { c2b[k] = c2[k]; }); c2b.agence_id = 'ag2'; var r = MPM.lignesLettre([c1, c2b], gm, typeLabel, BANQUES); return r.ok === false && r.erreurs.some(function (e) { return /une agence/.test(e.motif) && /Maarif/.test(e.motif) && /Agdal/.test(e.motif); }); })(), '');
check('deux banques -> refus nomme (agences differentes)', (function () { var r = MPM.lignesLettre([c1, MPM.appliquerPieceLiberation(cau({ id: 'c3', banque: 'BMCE Bank', agence_id: 'ag2' }), 'mainlevee_client', SCAN, '2026-11-18', 'u')], gm, typeLabel, BANQUES); return r.ok === false; })(), '');
check('banque sans agence (FINEA) -> lettre REFUSEE, fiche a completer nommee dans fiches[]', (function () { var r = MPM.lignesLettre([MPM.appliquerPieceLiberation(cau({ id: 'c4', banque: 'FINEA' }), 'mainlevee_client', SCAN, '2026-11-18', 'u')], gm, typeLabel, BANQUES); return r.ok === false && r.fiches.indexOf('FINEA') >= 0 && /Parametres/.test(r.erreurs[0].motif); })(), '');
check('referentiel absent -> lettre refusee (rien n\'est invente)', MPM.lignesLettre([c1, c2], gm, typeLabel, []).ok === false && MPM.lignesLettre([c1, c2], gm, typeLabel).ok === false, '');
check('caution sans piece recue -> exclue avec motif, lettre refusee', (function () { var r = MPM.lignesLettre([c1, c0], gm, typeLabel, BANQUES); return r.ok === false && r.erreurs.length === 1 && r.erreurs[0].num === '810012624000694066' && /aucune piece recue/.test(r.erreurs[0].motif); })(), '');
check('provisoire : ref / objet / maitre d\'ouvrage lus sur la ligne (AO), type « Caution provisoire »', (function () {
  var p = MPM.appliquerPieceLiberation({ num: 'P1', type: 'provisoire', banque: 'BMCE Bank', montant: 50000, statut: 'active', ref: '21/ANEF/2026', objet: 'Fourniture de materiel', maitre_ouvrage: 'ANEF' }, 'original_caution', SCAN_ORIG, '2026-11-10', 'u');
  var r = MPM.lignesLettre([p], gm, typeLabel, BANQUES); return r.ok && r.lignes[0].type === 'Caution provisoire' && r.lignes[0].marche_ref === '21/ANEF/2026' && r.lignes[0].maitre_ouvrage === 'ANEF';
})(), '');
check('validerFicheBanque : deux agences par defaut -> refus ; id en double -> refus ; statut inconnu -> refus ; fiche saine -> null', !!MPM.validerFicheBanque({ nom: 'B', agences: [{ id: 'a', par_defaut: true, statut: 'confirmee' }, { id: 'b', par_defaut: true, statut: 'confirmee' }] }) && !!MPM.validerFicheBanque({ nom: 'B', agences: [{ id: 'a', statut: 'confirmee' }, { id: 'a', statut: 'confirmee' }] }) && !!MPM.validerFicheBanque({ nom: 'B', agences: [{ id: 'a', statut: 'x' }] }) && MPM.validerFicheBanque(BANQUES[0]) === null && !!MPM.validerFicheBanque({ nom: '' }), '');
var fusion = MPM.fusionnerLecturesAgences(BANQUES, [
  { caution_num: '111', banque: 'BMCE Bank', agence: 'agence casablanca maarif', adresse: '140 bd Zerktouni', ville: 'Casablanca', lu_le: '2026-11-20' },
  { caution_num: '222', banque: 'FINEA', agence: 'Agence Casablanca Siege', adresse: '101, bd Abdelmoumen', ville: 'Casablanca', lu_le: '2026-11-20' },
  { caution_num: '333', banque: 'Banque Populaire', agence: null, adresse: null, ville: null, lu_le: '2026-11-20' },
  { caution_num: '444', banque: 'FINEA', agence: 'Agence Casablanca Siege', adresse: '101, bd Abdelmoumen', ville: 'Casablanca', lu_le: '2026-11-20' }
]);
check('fusion : agence deja connue (meme nom normalise) -> pas de doublon, source ajoutee, lien pose (2 lectures connues : 111 et 444)', fusion.deja === 2 && fusion.banques[0].agences.length === 3 && fusion.banques[0].agences[0].sources.length === 1 && fusion.liens.some(function (l) { return l.caution_num === '111' && l.agence_id === 'ag1'; }), JSON.stringify(fusion.liens));
check('fusion : agence nouvelle -> ajoutee « a_confirmer » avec adresse/ville lues et sa source ; 2e lecture identique = meme agence', fusion.ajoutees === 1 && (function () { var f = MPM.trouverBanque(fusion.banques, 'FINEA'); var a = f.agences[0]; return f.agences.length === 1 && a.statut === 'a_confirmer' && a.adresse === '101, bd Abdelmoumen' && a.ville === 'Casablanca' && a.sources.length === 2 && a.par_defaut === false; })(), '');
check('fusion : banque sans fiche -> fiche creee ; rien de lu -> rien d\'invente (sans_lecture), aucune agence', fusion.sans_lecture === 1 && (function () { var f = MPM.trouverBanque(fusion.banques, 'Banque Populaire'); return !!f && f.agences.length === 0; })(), '');
check('fusion : ne MUTE pas le referentiel d\'entree', BANQUES[0].agences.length === 3 && BANQUES[1].agences.length === 0 && !AG1.sources, '');

console.log('\n=== 3b. Liberations a justifier (constat DG 20/11) : liberee sans accuse ===');
var sansAcc = cau({ id: 'c7', num: '186921', referenceBanque: null, banque: 'FINEA', montant: 36249, statut: 'liberee', date_liberation_effective: '2026-08-03', liberation_motif: 'Regularisation', liberation_par: null });
check('liberee SANS accuse -> a justifier, PAS prouvee', MPM.liberationAJustifier(sansAcc) === true && MPM.liberationProuvee(sansAcc) === false && MPM.liberationProuvee(l1) === true, '');
check('ecran : liberee sans accuse reste BLOQUEE (comptee dans l\'engage), liberee avec accuse non', MPC.isBlocked(sansAcc) === true && MPC.isBlocked(l1) === false && MPC.aJustifier(sansAcc) && !MPC.aJustifier(l1), '');
check('aggregate : kpi.a_justifier = 1 (pas comptee en liberee), engage FINEA inclut 36 249', (function () { var a = MPC.aggregate([sansAcc, l1]); return a.kpi.a_justifier === 1 && a.kpi.liberee === 1 && a.byBank['FINEA'].eng === 36249; })(), JSON.stringify(MPC.aggregate([sansAcc, l1]).kpi));
var m40 = { id: 'm40', ref: '40/2024', statut: 'termine', termine_le: '2026-10-09', reception_definitive_prononcee: true };
var gm40 = function (id) { return id === 'm40' ? m40 : {}; };
var aj = MPC.liberationsAJustifier(MPC.unify([Object.assign({}, sansAcc, { marche_id: 'm40' }), l1], [], gm40), gm40);
check('liberationsAJustifier : 1 item, total 36 249, date de passage = date_liberation_effective, marche termine liste', aj.items.length === 1 && aj.total === 36249 && aj.items[0].date_passage === '2026-08-03' && aj.marchesTermines.length === 1 && aj.marchesTermines[0].ref === '40/2024', JSON.stringify(aj.marchesTermines));
check('marcheDoitTerminer : une liberee SANS accuse ne termine plus un marche', MPM.marcheDoitTerminer(m40, [sansAcc, l1]) === false && MPM.marcheDoitTerminer(m40, [l1, cau({ statut: 'liberee', accuse_banque: ACC })]) === true, '');
check('appliquerStatutMarche : un marche deja termine sur une liberation sans accuse n\'est PAS rouvert (null)', MPM.appliquerStatutMarche(m40, [sansAcc, l1], '2026-11-20') === null, '');
check('appliquerStatutMarche : liberation annulee (caution redevenue active) -> retour en cours, trace', (function () { var r = MPM.appliquerStatutMarche(m40, [cau({ statut: 'active' }), l1], '2026-11-20'); return !!r && r.statut === 'en_cours' && /annulee/.test(r.termine_trace); })(), '');
check('marchesTerminesSansPreuve : liste 40/2024 avec ses cautions (num, banque, montant)', (function () { var r = MPM.marchesTerminesSansPreuve([m40, { id: 'm2', ref: 'X', statut: 'termine' }], [Object.assign({}, sansAcc, { marcheId: 'm40' }), Object.assign({}, l1, { marcheId: 'm2' })]); return r.length === 1 && r[0].ref === '40/2024' && r[0].cautions[0].num === '186921' && r[0].cautions[0].montant === 36249; })(), '');
check('garde TOUS chemins : creation ou modification generique en liberee/restituee refusee (formulaire, import)', !!MPM.refusChangementStatutGenerique(null, cau({ statut: 'liberee' })) && !!MPM.refusChangementStatutGenerique(null, cau({ statut: 'restituee' })) && !!MPM.refusChangementStatutGenerique(cau(), cau({ statut: 'liberee' })) && !!MPM.refusChangementStatutGenerique(cau({ statut: 'demande_deposee' }), cau({ statut: 'liberee' })), '');
check('seul chemin vers liberee : l\'accuse sur demande_deposee', MPM.appliquerPiece(d1, 'accuse_banque', ACC, '2026-11-26').statut === 'liberee', '');

console.log('\n=== 4. Ecran : blocs a demander / en attente ===');
var rows = MPC.unify([c0, c1, c2, d1, l1], [{ id: 'aoP', ref: 'AO-P', objet: 'Objet', maitre_ouvrage: 'MO', statut: 'infructueux', caution_prov: { num: 'PP', banque: 'CIH Bank', montant: 3000, statut: 'demande_deposee', demande_banque: { date_depot: '2026-10-20' } } }], function (id) { return { ref: 'MAR201800146/2018', titre: OBJET }; });
var adb = MPC.aDemanderBanque(rows), eab = MPC.enAttenteBanque(rows, NOW, null);
check('a demander : c1 et c2 (piece recue), un groupe BMCE Bank, total 108 072', adb.items.length === 2 && adb.parBanque.length === 1 && adb.parBanque[0].banque === 'BMCE Bank' && adb.total === 108072, JSON.stringify(adb.parBanque.map(function (g) { return [g.banque, g.items.length]; })));
check('en attente : d1 (0 j) et la provisoire (31 j, alerte), la plus ancienne d\'abord, nbAlerte 1', eab.items.length === 2 && eab.items[0].num === 'PP' && eab.items[0].jours === 31 && eab.items[0].alerte === true && eab.items[1].jours === 0 && eab.items[1].alerte === false && eab.nbAlerte === 1, JSON.stringify(eab.items.map(function (c) { return [c.num, c.jours, c.alerte]; })));
check('engage par banque : les cautions en attente restent comptees (CIH Bank 3 000, BMCE 99 072 active + 99 072 + 9 000 recues + 99 072 deposee = 306 216)', (function () { var a = MPC.aggregate(rows); return a.byBank['CIH Bank'].eng === 3000 && a.byBank['BMCE Bank'].eng === 306216; })(), JSON.stringify(MPC.aggregate(rows).byBank));
check('liberee hors de l\'engage et hors des blocs', !MPC.isBlocked(l1) && adb.items.every(function (c) { return c.id !== 'c1' || c.statut !== 'liberee'; }), '');

console.log('\n=== 5. Lettre : PDF genere (pdf-lib) ===');
var genPdf = null;
try { genPdf = require('../api/lettre-mainlevee.js'); } catch (e) { genPdf = null; }
check('api/lettre-mainlevee.js charge (pdf-lib installe dans api/)', !!genPdf, 'cd api && npm ci');
if (genPdf) {
  var logo = null; try { logo = fs.readFileSync(path.join(__dirname, '..', 'api', 'assets', 'logo-neurones.png')); } catch (e) { logo = null; }
  check('logo NEURONES present dans api/assets (en-tete)', !!logo, '');
  var societe = { raison_sociale: 'NEURONES TECHNOLOGIES', forme_juridique: 'SARL', capital_social: '1 000 000 MAD', adresse: '12, rue de l\'Exemple', cp: '20000', ville: 'Casablanca', tel: '05 22 00 00 00', email: 'contact@neurones.ma', rc: '123456', ville_rc: 'Casablanca', ice: '001234567000089', if: '12345678', patente: '34567890', cnss: '1234567' };
  genPdf.genererLettreMainlevee({ societe: societe, banque: L.banque, agence: L.destinataire.agence, adresse_agence: L.destinataire.adresse, ville_agence: L.destinataire.ville, destinataire: L.destinataire.destinataire, lieu: societe.ville, dateISO: '2026-11-20', lignes: L.lignes, total: L.total, logo: logo }).then(function (buf) {
    check('PDF valide (%PDF-)', buf.slice(0, 5).toString() === '%PDF-', buf.slice(0, 5).toString());
    check('PDF non vide (> 20 Ko avec le logo)', buf.length > 20000, String(buf.length));
    var PDFDocument = null;
    try { PDFDocument = require('../api/node_modules/pdf-lib').PDFDocument; } catch (e) { PDFDocument = null; }
    var relu = PDFDocument ? PDFDocument.load(buf) : Promise.resolve(null);
    relu.then(function (doc) {
      check('PDF relisible : au moins une page A4 portrait, titre nomme la banque', !!doc && doc.getPageCount() >= 1 && Math.round(doc.getPage(0).getWidth()) === 595 && /BMCE Bank/.test(doc.getTitle() || ''), doc ? (doc.getPageCount() + ' page(s), titre « ' + doc.getTitle() + ' »') : 'pdf-lib absent');
      suite();
    }).catch(function (e) { check('PDF relisible', false, e.message); suite(); });
    return;
    function suite() {
    check('montantFR : 99 072,00 MAD ; dateFR : 12/06/2018', genPdf.montantFR(99072) === '99 072,00 MAD' && genPdf.dateFR('2018-06-12') === '12/06/2018', genPdf.montantFR(99072));
    check('replier : un intitule long se replie sans ellipse ni perte de mot', (function () {
      var mots = OBJET.split(/\s+/).length;
      // police factice : 5 pt par caractere
      var font = { widthOfTextAtSize: function (t, s) { return t.length * 5; } };
      var lignes = genPdf.replier(font, 10, OBJET, 120);
      return lignes.join(' ').split(/\s+/).length === mots && lignes.every(function (l) { return l.length * 5 <= 120; }) && lignes.join(' ').indexOf('…') < 0;
    })(), '');
    var sortie = process.env.LETTRE_MAINLEVEE_OUT;
    if (sortie) { fs.writeFileSync(sortie, buf); console.log('  exemplaire ecrit : ' + sortie); }
    fin();
    }
  }).catch(function (e) { check('generation PDF sans erreur', false, e.message); fin(); });
} else { fin(); }

function fin() {
  console.log('\n---------------------------------------------------------------');
  if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
  console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0);
}
