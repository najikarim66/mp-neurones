/* =========================================================================
 * GATE — Dépôt A POSTERIORI d'un justificatif (mainlevée client / accusé banque)
 * sur une caution DÉJÀ close, SANS changer le statut (régularisation rétroactive).
 * Exécute la logique PURE : pieceJustifRecevable (statut clos, def/RG, pièce absente)
 * et appliquerPieceJustificative (pose la pièce + date + trace, statut INCHANGÉ, copie).
 *
 * Lancer : node test/piece-justif.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPM = require('../public/pv-mainlevee.js');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function cau(o) { return Object.assign({ id: 'c1', type: 'retenue_garantie', num: '194056', montant: 84580, statut: 'liberee' }, o || {}); }
var ref = { blob: 'm1/caution-c1/accuse_banque.pdf', nom_original: 'acc.pdf', taille: 10, content_type: 'application/pdf', depose_le: '2026-10-13T00:00:00Z', depose_par: 'naji@neurones.ma' };

console.log('\n=== pieceJustifRecevable ===');
check('libérée + accusé absent -> recevable', MPM.pieceJustifRecevable(cau(), 'accuse_banque') === true, '');
check('libérée + accusé DÉJÀ présent -> refus (pas d\'écrasement)', MPM.pieceJustifRecevable(cau({ accuse_banque: { blob: 'x' } }), 'accuse_banque') === false, '');
check('restituée + mainlevée absente -> recevable', MPM.pieceJustifRecevable(cau({ statut: 'restituee' }), 'mainlevee_client') === true, '');
check('ACTIVE -> refus (statut pas clos ; a posteriori réservé aux closes)', MPM.pieceJustifRecevable(cau({ statut: 'active' }), 'accuse_banque') === false, '');
check('mainlevee_recue -> refus a posteriori (c\'est le cycle normal, pas a posteriori)', MPM.pieceJustifRecevable(cau({ statut: 'mainlevee_recue' }), 'accuse_banque') === false, '');
check('type hors def/RG (soumission) -> refus', MPM.pieceJustifRecevable(cau({ type: 'soumission' }), 'accuse_banque') === false, '');
check('pieceType inconnu -> refus', MPM.pieceJustifRecevable(cau(), 'pv_quelconque') === false, '');
check('caution absente -> refus', MPM.pieceJustifRecevable(null, 'accuse_banque') === false, '');

console.log('\n=== appliquerPieceJustificative : statut INCHANGÉ + pièce + trace ===');
var base = cau();
var out = MPM.appliquerPieceJustificative(base, 'accuse_banque', ref, '2025-06-01', 'naji@neurones.ma');
check('statut INCHANGÉ (reste liberee)', out && out.statut === 'liberee', out && out.statut);
check('pièce posée (accuse_banque = ref)', out && out.accuse_banque && out.accuse_banque.blob === ref.blob, '');
check('date posée (date_liberation = date fournie)', out && out.date_liberation === '2025-06-01', out && out.date_liberation);
check('trace a posteriori {piece, par, date_piece}', out && out.pieces_justif_trace && out.pieces_justif_trace.length === 1 && out.pieces_justif_trace[0].piece === 'accuse_banque' && out.pieces_justif_trace[0].par === 'naji@neurones.ma' && out.pieces_justif_trace[0].date_piece === '2025-06-01', JSON.stringify(out && out.pieces_justif_trace));
check('ne MUTE pas l\'entrée (copie)', base.accuse_banque === undefined && base.pieces_justif_trace === undefined, '');
check('non recevable -> null (déjà jointe)', MPM.appliquerPieceJustificative(cau({ accuse_banque: { blob: 'x' } }), 'accuse_banque', ref, '2025-06-01', 'x') === null, '');
// deuxième justificatif (mainlevée) sur une caution qui a déjà l'accusé -> trace cumulée
var out2 = MPM.appliquerPieceJustificative(out, 'mainlevee_client', { blob: 'm1/caution-c1/mainlevee_client.pdf' }, '2025-05-20', 'naji@neurones.ma');
check('2e justificatif cumule la trace (2 entrées) + mainlevée posée', out2 && out2.pieces_justif_trace.length === 2 && out2.mainlevee_client && out2.date_mainlevee_recue === '2025-05-20', '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
