/* =========================================================================
 * MP - PV de reception definitive -> mainlevee des cautions du marche : logique PURE.
 *
 * Chargee par public/index.html (global window.MPMainlevee), par la gate node
 * (test/pv-mainlevee.test.js via require) ET destinee au job mail hebdo
 * (Azure Function timer) : une seule implementation, testee telle qu'elle sert.
 * Aucune dependance au DOM, aucun acces reseau, aucune horloge implicite
 * (le "maintenant" du calcul d'anciennete est injecte).
 *
 * Regles (arbitrages Karim) :
 *  - Un marche n'est "recevable" que si le PV definitif est DEPOSE :
 *    reception_definitive_prononcee === true. La date_reception_definitive
 *    CALCULEE (provisoire + delai garantie) ne declenche RIEN a elle seule
 *    (sinon ~44 cautions / ~3,1 M MAD basculeraient d'un coup).
 *  - Seuls bonne_execution (definitive) et retenue_garantie (RG) basculent.
 *    Jamais soumission / avance_demarrage / provisoire (autre cycle, porte par l'AO).
 *  - Seule une caution "active" bascule -> "mainlevee_demandee", datee du jour.
 *    Idempotent : une caution deja mainlevee_demandee/liberee/restituee/expiree
 *    n'est jamais retouchee.
 *  - Les fonctions ne MUTENT PAS leurs entrees (elles renvoient des copies).
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MPMainlevee = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TYPES_MAINLEVEE = ['bonne_execution', 'retenue_garantie'];
  var DAY = 86400000;

  /* Cycle a 3 etats (def/RG) : mainlevee_demandee --[mainlevee du client]-->
   * mainlevee_recue --[accuse de la banque]--> liberee. Chaque piece a un statut
   * de depart impose (pas de saut d'etat) et pose son propre horodatage. */
  var PIECE_TRANSITIONS = {
    mainlevee_client: { de: 'mainlevee_demandee', vers: 'mainlevee_recue', champ: 'mainlevee_client', dateChamp: 'date_mainlevee_recue' },
    accuse_banque:    { de: 'mainlevee_recue',    vers: 'liberee',        champ: 'accuse_banque',   dateChamp: 'date_liberation' }
  };

  /* marcheId (Cosmos brut) OU marche_id (cote app apres fromCosmos) : on tolere les deux. */
  function cMarcheId(c) { return c.marcheId != null ? c.marcheId : c.marche_id; }

  /* Recevable = PV definitif effectivement depose. JAMAIS la date calculee. */
  function estRecevable(m) { return !!m && m.reception_definitive_prononcee === true; }

  function estType(c) { return TYPES_MAINLEVEE.indexOf(c.type) >= 0; }

  /* Cautions du marche a faire passer en mainlevee : def + RG, actives. []
   * si le marche n'est pas recevable (pas de PV). */
  function cautionsABasculer(marche, cautions) {
    if (!estRecevable(marche)) return [];
    var mid = String(marche.id);
    return (cautions || []).filter(function (c) {
      return String(cMarcheId(c)) === mid && estType(c) && c.statut === 'active';
    });
  }

  /* Copie de la caution passee en mainlevee_demandee et datee. Ne mute pas l'entree. */
  function appliquerBascule(caution, dateISO) {
    var out = {};
    Object.keys(caution).forEach(function (k) { out[k] = caution[k]; });
    out.statut = 'mainlevee_demandee';
    out.date_demande_mainlevee = dateISO;
    return out;
  }

  /* Batch a persister pour un marche dont le PV vient d'etre depose. */
  function basculerMarche(marche, cautions, dateISO) {
    var sel = cautionsABasculer(marche, cautions);
    var maj = sel.map(function (c) { return appliquerBascule(c, dateISO); });
    var total = maj.reduce(function (s, c) { return s + (+c.montant || 0); }, 0);
    return { aMettreAJour: maj, count: maj.length, total: total };
  }

  /* File du mail hebdo : cautions encore en attente du retour client (mainlevee
   * demandee mais argent pas revenu). L'appelant fusionne collection + provisoires
   * s'il veut les deux cycles ; ici on ne juge que sur le statut. */
  function mainleveesEnAttente(cautions) {
    return (cautions || []).filter(function (c) { return c.statut === 'mainlevee_demandee'; });
  }

  /* Anciennete de la demande, en jours entiers. "maintenant" injecte (deterministe). */
  function joursDepuisDemande(caution, nowMs) {
    if (!caution || !caution.date_demande_mainlevee) return 0;
    var t = new Date(caution.date_demande_mainlevee).getTime();
    if (isNaN(t)) return 0;
    return Math.floor((nowMs - t) / DAY);
  }

  function transitionPiece(pieceType) { return PIECE_TRANSITIONS[pieceType] || null; }

  /* Une piece est recevable si : la transition existe, la caution est def/RG,
   * et son statut courant est le statut de depart impose par la piece. */
  function pieceRecevable(caution, pieceType) {
    var t = transitionPiece(pieceType);
    if (!t || !caution) return false;
    if (TYPES_MAINLEVEE.indexOf(caution.type) < 0) return false;
    return caution.statut === t.de;
  }

  /* Applique le depot d'une piece : COPIE de la caution avec nouveau statut,
   * reference de piece et horodatage. null si non recevable (aucun saut d'etat).
   * pieceRef = { blob, nom_original, taille, content_type, depose_le, depose_par }. */
  function appliquerPiece(caution, pieceType, pieceRef, dateISO) {
    if (!pieceRecevable(caution, pieceType)) return null;
    var t = transitionPiece(pieceType);
    var out = {};
    Object.keys(caution).forEach(function (k) { out[k] = caution[k]; });
    out.statut = t.vers;
    out[t.champ] = pieceRef;
    out[t.dateChamp] = dateISO;
    return out;
  }

  return {
    TYPES_MAINLEVEE: TYPES_MAINLEVEE,
    PIECE_TRANSITIONS: PIECE_TRANSITIONS,
    cMarcheId: cMarcheId,
    estRecevable: estRecevable,
    cautionsABasculer: cautionsABasculer,
    appliquerBascule: appliquerBascule,
    basculerMarche: basculerMarche,
    mainleveesEnAttente: mainleveesEnAttente,
    joursDepuisDemande: joursDepuisDemande,
    transitionPiece: transitionPiece,
    pieceRecevable: pieceRecevable,
    appliquerPiece: appliquerPiece
  };
});
