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

  /* ===== CYCLE DE VIE D'UNE CAUTION (regle DG 20/11/2026 — definitives, RG et provisoires) =====
   *   active --[(facultatif) mainlevee demandee au maitre d'ouvrage : statut mainlevee_demandee]-->
   *   piece_recue      : la mainlevee delivree par le client OU l'original de la caution restitue, avec
   *                      DATE et SCAN (piece_liberation = { type, date, scan }) ;
   *   demande_deposee  : la demande de mainlevee a ete deposee a la banque (demande_banque.date_depot ;
   *                      lettre PDF generee par MP, imprimee, signee, deposee — jamais envoyee par courriel) ;
   *   liberee          : l'accuse de la banque est joint (accuse_banque). Aucune liberation sans accuse.
   * « mainlevee_demandee » = demandee AU CLIENT (rien recu), argent toujours bloque. L'ancien
   * « mainlevee_recue » (cycle du 24/09) se lit comme piece_recue de type mainlevee_client (etatCycle).
   * Chaque piece a un statut de depart impose (pas de saut d'etat) et pose son propre horodatage. */
  var ETATS_CYCLE = ['active', 'mainlevee_demandee', 'piece_recue', 'demande_deposee', 'liberee'];
  var ETATS_BLOQUES = ['active', 'mainlevee_demandee', 'piece_recue', 'demande_deposee'];
  var PIECES_LIBERATION = {
    mainlevee_client: { label: 'Mainlevee delivree par le maitre d\'ouvrage', champ: 'mainlevee_client', dateChamp: 'date_mainlevee_recue' },
    original_caution: { label: 'Original de la caution restitue par le maitre d\'ouvrage', champ: 'original_caution', dateChamp: 'date_original_recu' }
  };
  var PIECE_TRANSITIONS = {
    accuse_banque:   { de: 'demande_deposee', vers: 'liberee',         champ: 'accuse_banque',   dateChamp: 'date_liberation' },
    decharge_banque: { de: 'demande_deposee', vers: 'demande_deposee', champ: 'decharge_banque', dateChamp: 'date_decharge' }
  };
  /* Justificatifs joignables A POSTERIORI sur une caution deja close (statut inchange). */
  var PIECES_JUSTIF = {
    mainlevee_client: PIECES_LIBERATION.mainlevee_client,
    original_caution: PIECES_LIBERATION.original_caution,
    accuse_banque:    PIECE_TRANSITIONS.accuse_banque
  };
  /* Etat du cycle, l'ancien « mainlevee_recue » normalise en piece_recue. */
  function etatCycle(c) {
    var s = c && c.statut;
    return s === 'mainlevee_recue' ? 'piece_recue' : s;
  }
  /* Provisoire (caution_prov portee par un AO) ou definitive/RG : les deux suivent le cycle. */
  function estProvisoire(c) { return !!c && (c.type === 'provisoire' || c._provisoire === true || c.src === 'ao'); }
  function suitLeCycle(c) { return !!c && (estProvisoire(c) || TYPES_MAINLEVEE.indexOf(c.type) >= 0); }
  /* Piece de liberation NORMALISEE : { type, date, scan } ou null. L'ancien mainlevee_recue
   * (mainlevee_client + date_mainlevee_recue) est lu comme une piece de type mainlevee_client. */
  function pieceLiberationDe(c) {
    if (!c) return null;
    if (c.piece_liberation && c.piece_liberation.type) return c.piece_liberation;
    if (c.statut === 'mainlevee_recue' && c.mainlevee_client) return { type: 'mainlevee_client', date: c.date_mainlevee_recue || null, scan: c.mainlevee_client };
    return null;
  }
  function libellePieceLiberation(type) { var p = PIECES_LIBERATION[type]; return p ? p.label : ''; }
  /* Reception de la piece : recevable depuis active ou mainlevee_demandee, type connu, caution du cycle. */
  function pieceLiberationRecevable(c, type) {
    if (!c || !PIECES_LIBERATION[type] || !suitLeCycle(c)) return false;
    var e = etatCycle(c);
    return e === 'active' || e === 'mainlevee_demandee';
  }
  /* active|mainlevee_demandee -> piece_recue. SCAN OBLIGATOIRE (pieceRef.blob) : la piece part a la
   * banque. Pose piece_liberation + le champ historique du type (mainlevee_client / original_caution)
   * pour que les liens « voir la piece » restent les memes. Copie, ne mute pas. null si non recevable. */
  function appliquerPieceLiberation(c, type, pieceRef, dateISO, par) {
    if (!pieceLiberationRecevable(c, type)) return null;
    if (!pieceRef || !pieceRef.blob) return null;
    if (!dateReceptionValide(dateISO)) return null;
    var p = PIECES_LIBERATION[type], out = {};
    Object.keys(c).forEach(function (k) { out[k] = c[k]; });
    out.statut = 'piece_recue';
    out.piece_liberation = { type: type, date: dateISO, scan: pieceRef, recu_le: new Date().toISOString(), recu_par: par || null };
    out[p.champ] = pieceRef;
    out[p.dateChamp] = dateISO;
    return out;
  }
  /* GARDE du depot a la banque : { ok, motif }. Pas de demande sans piece jointe au type enregistre ;
   * scan obligatoire (original de la caution comme mainlevee du client : la piece part a la banque). */
  function depotBanqueRecevable(c) {
    if (!c) return { ok: false, motif: 'caution absente' };
    if (!suitLeCycle(c)) return { ok: false, motif: 'type de caution hors cycle de mainlevee' };
    if (etatCycle(c) === 'demande_deposee') return { ok: false, motif: 'demande deja deposee a la banque' };
    if (etatCycle(c) !== 'piece_recue') return { ok: false, motif: 'aucune piece recue du maitre d\'ouvrage (statut ' + (c.statut || 'inconnu') + ')' };
    var p = pieceLiberationDe(c);
    if (!p || !PIECES_LIBERATION[p.type]) return { ok: false, motif: 'type de piece non enregistre (mainlevee du client ou original de la caution)' };
    if (!p.scan || !p.scan.blob) return { ok: false, motif: p.type === 'original_caution' ? 'scan de l\'original de la caution obligatoire avant le depot' : 'scan de la mainlevee du client obligatoire avant le depot' };
    if (!p.date) return { ok: false, motif: 'date de la piece non renseignee' };
    return { ok: true, motif: '' };
  }
  /* piece_recue -> demande_deposee (date de depot saisie, jamais completee par defaut). Copie. */
  function appliquerDepotBanque(c, dateDepotISO, par, lettreRef) {
    if (!depotBanqueRecevable(c).ok) return null;
    if (!dateReceptionValide(dateDepotISO)) return null;
    var out = {};
    Object.keys(c).forEach(function (k) { out[k] = c[k]; });
    out.statut = 'demande_deposee';
    out.demande_banque = { date_depot: dateDepotISO, depose_par: par || null, enregistre_le: new Date().toISOString(), lettre: lettreRef || (c.lettre_mainlevee || null) };
    return out;
  }
  /* GARDE de l'enregistrement GENERIQUE (/api/data, formulaires) : les etats du cycle se posent par les
   * depots de pieces et la demande a la banque, jamais par un formulaire. Renvoie le motif du refus ou null.
   * avant = document stocke (null a la creation), apres = document recu. Autorise : creation en active /
   * expiree / en_attente / mainlevee_demandee, aller-retour active <-> expiree / mainlevee_demandee (demande
   * au client), retour d'un etat quelconque vers active (correction, tracee par le marche), statut inchange. */
  var ETATS_PAR_PIECE = ['piece_recue', 'mainlevee_recue', 'demande_deposee', 'liberee', 'restituee'];
  function refusChangementStatutGenerique(avant, apres) {
    if (!apres) return null;
    var sa = avant ? avant.statut : null, sb = apres.statut;
    if (sa === sb) return null;
    if (ETATS_PAR_PIECE.indexOf(sb) >= 0) {
      return 'Le statut « ' + sb + ' » se pose par le depot de la piece correspondante (mainlevee du client ou original restitue, demande a la banque, accuse de la banque — regle DG 20/11/2026), jamais par un formulaire.';
    }
    return null;
  }
  /* ACCUSE RECU alors que le depot n'est pas encore enregistre (constat DG 20/11 13h05 : la lettre a ete deposee
   * mais la date de depot n'a pas ete saisie) : l'accuse reste joignable depuis piece_recue A CONDITION de donner
   * la date de depot dans le meme geste — le depot est alors enregistre puis l'accuse applique (deux transitions,
   * aucune sautee). Recevable = piece_recue ET garde du depot satisfaite. */
  function accuseAvecDepotRecevable(c) {
    return !!c && etatCycle(c) === 'piece_recue' && depotBanqueRecevable(c).ok;
  }
  /* Jours ecoules depuis le depot a la banque (nowMs injecte). 0 si pas de depot. */
  function joursDepuisDepot(c, nowMs) {
    var d = c && c.demande_banque && c.demande_banque.date_depot;
    if (!d) return 0;
    var t = new Date(d).getTime();
    return isNaN(t) ? 0 : Math.floor((nowMs - t) / DAY);
  }
  var DELAI_ALERTE_BANQUE_DEFAUT = 15; // jours : au-dela, la banque continue a prelever ses commissions
  /* Lettre de demande de mainlevee : DONNEES PURES (aucun id, intitules ENTIERS). Une lettre = UNE
   * banque ; toutes les cautions doivent etre en piece_recue et passer la garde du depot.
   * gm(marche_id) -> { ref, titre, objet, maitre_ouvrage } ; pour une provisoire, l'appelant fournit
   * ref/objet/maitre_ouvrage de l'AO sur la ligne (c.ref, c.objet, c.maitre_ouvrage). */
  /* ===== REFERENTIEL DES BANQUES ET AGENCES (complement DG 20/11/2026 : la lettre se genere SANS saisie) =====
   * Document mp_banques : { id, nom, agences: [ { id, nom, adresse, ville, destinataire, par_defaut, statut:
   * 'confirmee'|'a_confirmer', source: { caution_num, lu_le } } ] }. Une caution porte agence_id ; a defaut,
   * l'agence par defaut de sa banque. Rien n'est invente : une agence proposee par lecture d'acte reste
   * « a confirmer » et ne sert PAS a la lettre tant que le DG ne l'a pas confirmee. */
  function normaliserNomBanque(n) { return String(n == null ? '' : n).trim().toLowerCase().replace(/\s+/g, ' '); }
  function trouverBanque(banques, nom) {
    var k = normaliserNomBanque(nom); if (!k) return null;
    for (var i = 0; i < (banques || []).length; i++) { if (normaliserNomBanque(banques[i] && banques[i].nom) === k) return banques[i]; }
    return null;
  }
  function agencesDe(bq) { return (bq && Array.isArray(bq.agences)) ? bq.agences : []; }
  function agenceComplete(a) { return !!(a && String(a.nom || '').trim() && String(a.adresse || '').trim()); }
  /* Agence d'une caution : agence_id de la caution, sinon l'agence par defaut de la banque, sinon l'unique
   * agence. Renvoie { ok, banque, agence, motif, fiche } ; fiche = nom de la banque a completer (Parametres). */
  function resoudreAgence(caution, banques) {
    var nomB = caution && caution.banque;
    if (!String(nomB || '').trim()) return { ok: false, banque: null, agence: null, motif: 'banque non renseignee sur la caution', fiche: null };
    var bq = trouverBanque(banques, nomB);
    if (!bq) return { ok: false, banque: null, agence: null, motif: 'fiche banque « ' + nomB + ' » absente du referentiel (Parametres > Banques et agences)', fiche: nomB };
    var ags = agencesDe(bq), a = null, i;
    if (caution.agence_id) { for (i = 0; i < ags.length; i++) { if (String(ags[i].id) === String(caution.agence_id)) { a = ags[i]; break; } } }
    if (!a) { for (i = 0; i < ags.length; i++) { if (ags[i].par_defaut === true) { a = ags[i]; break; } } }
    if (!a && ags.length === 1) a = ags[0];
    if (!a) return { ok: false, banque: bq, agence: null, motif: 'fiche banque « ' + bq.nom + ' » : aucune agence' + (ags.length ? ' par defaut' : '') + ' (Parametres > Banques et agences)', fiche: bq.nom };
    if (!agenceComplete(a)) return { ok: false, banque: bq, agence: a, motif: 'fiche banque « ' + bq.nom + ' », agence « ' + (a.nom || 'sans nom') + ' » : ' + (String(a.nom || '').trim() ? 'adresse manquante' : 'nom manquant') + ' (Parametres > Banques et agences)', fiche: bq.nom };
    if (a.statut !== 'confirmee') return { ok: false, banque: bq, agence: a, motif: 'fiche banque « ' + bq.nom + ' », agence « ' + a.nom + ' » : lue sur un acte, a confirmer (Parametres > Banques et agences)', fiche: bq.nom };
    return { ok: true, banque: bq, agence: a, motif: '', fiche: null };
  }
  function cleAgence(bq, a) { return normaliserNomBanque(bq && bq.nom) + '|' + String(a && a.id || ''); }
  /* Lettre de demande de mainlevee : DONNEES PURES (aucun id, intitules ENTIERS), SANS AUCUNE SAISIE.
   * Une lettre = UNE banque et UNE agence (deux agences ne se regroupent jamais) ; toutes les cautions
   * doivent etre en piece_recue, passer la garde du depot et resoudre une agence confirmee et complete.
   * gm(marche_id) -> { ref, titre, objet, maitre_ouvrage } ; pour une provisoire, ref/objet/maitre_ouvrage
   * sont sur la ligne. banques = documents mp_banques (referentiel). */
  function lignesLettre(cautions, gm, typeLabel, banques) {
    gm = gm || function () { return {}; };
    typeLabel = typeLabel || function (t) { return t; };
    var erreurs = [], lignes = [], cles = {}, total = 0, dest = null, fiches = {};
    (cautions || []).forEach(function (c) {
      var g = depotBanqueRecevable(c);
      var num = c.referenceBanque || c.num || 'numero non renseigne';
      if (!g.ok) { erreurs.push({ num: num, motif: g.motif }); return; }
      var r = resoudreAgence(c, banques);
      if (!r.ok) { erreurs.push({ num: num, motif: r.motif, fiche: r.fiche }); if (r.fiche) fiches[r.fiche] = true; return; }
      var m = estProvisoire(c) ? { ref: c.ref, objet: c.objet || c.titre, maitre_ouvrage: c.maitre_ouvrage } : (gm(cMarcheId(c)) || {});
      var p = pieceLiberationDe(c);
      cles[cleAgence(r.banque, r.agence)] = { banque: r.banque.nom, agence: r.agence };
      if (!dest) dest = { banque: r.banque.nom, agence: r.agence.nom, adresse: r.agence.adresse, ville: r.agence.ville || '', destinataire: r.agence.destinataire || '' };
      total += (+c.montant || 0);
      lignes.push({
        num: num, type: estProvisoire(c) ? 'Caution provisoire' : typeLabel(c.type), montant: +c.montant || 0,
        date_emission: c.date_emission || null,
        marche_ref: m.ref || 'reference non renseignee',
        marche_objet: m.objet || m.titre || 'objet non renseigne',
        maitre_ouvrage: m.maitre_ouvrage || 'maitre d\'ouvrage non renseigne',
        piece: libellePieceLiberation(p.type), piece_type: p.type, piece_date: p.date || null
      });
    });
    var nb = Object.keys(cles);
    if (nb.length > 1) erreurs.push({ num: '', motif: 'une lettre ne s\'adresse qu\'a une agence (' + nb.map(function (k) { return cles[k].banque + ' — ' + cles[k].agence.nom; }).join(' ; ') + ')' });
    return { ok: erreurs.length === 0 && lignes.length > 0, banque: dest ? dest.banque : '', destinataire: (erreurs.length === 0 && lignes.length) ? dest : null, lignes: lignes, total: total, erreurs: erreurs, fiches: Object.keys(fiches) };
  }
  /* Validation d'une fiche banque avant ecriture (Parametres) : nom, agences a id unique, une seule par
   * defaut au plus, statuts connus. Renvoie le motif du refus ou null. */
  function validerFicheBanque(doc) {
    if (!doc || !String(doc.nom || '').trim()) return 'nom de banque requis';
    var ags = agencesDe(doc), ids = {}, nbDef = 0, i;
    for (i = 0; i < ags.length; i++) {
      var a = ags[i] || {};
      if (!String(a.id || '').trim()) return 'agence sans identifiant';
      if (ids[a.id]) return 'identifiant d\'agence en double (' + a.id + ')';
      ids[a.id] = true;
      if (a.statut !== 'confirmee' && a.statut !== 'a_confirmer') return 'statut d\'agence inconnu (' + a.statut + ')';
      if (a.par_defaut === true) nbDef++;
    }
    if (nbDef > 1) return 'une seule agence par defaut par banque';
    return null;
  }
  /* FUSION des lectures d'actes dans le referentiel (PUR). lectures = [{ caution_num, banque, agence, adresse,
   * ville, lu_le }] (champs vides = non lus). Une agence lue qui n'existe pas encore sur la fiche (meme nom
   * normalise) est AJOUTEE « a_confirmer » avec sa source ; une existante n'est jamais ecrasee (on ajoute la
   * source). Une banque sans fiche est creee (sans agence si rien n'est lu). Renvoie { banques (copies a
   * jour), liens: [{ caution_num, banque, agence_id }], ajoutees, deja, sans_lecture }. */
  function fusionnerLecturesAgences(banquesDocs, lectures, nouvelId) {
    nouvelId = nouvelId || function (bq, n) { return 'ag_' + normaliserNomBanque(bq.nom).replace(/[^a-z0-9]+/g, '-') + '-' + n; };
    var docs = (banquesDocs || []).map(function (b) { var o = {}; Object.keys(b).forEach(function (k) { o[k] = b[k]; }); o.agences = agencesDe(b).map(function (a) { var x = {}; Object.keys(a).forEach(function (k) { x[k] = a[k]; }); x.sources = Array.isArray(a.sources) ? a.sources.slice() : (a.source ? [a.source] : []); return x; }); return o; });
    var liens = [], ajoutees = 0, deja = 0, sansLecture = 0;
    (lectures || []).forEach(function (l) {
      var nomB = String(l.banque || '').trim();
      if (!nomB) { sansLecture++; return; }
      var bq = trouverBanque(docs, nomB);
      if (!bq) { bq = { id: 'bk_' + normaliserNomBanque(nomB).replace(/[^a-z0-9]+/g, '-'), nom: nomB, agences: [] }; docs.push(bq); }
      var nomA = String(l.agence || '').trim();
      if (!nomA) { sansLecture++; return; }
      var a = null, i;
      for (i = 0; i < bq.agences.length; i++) { if (normaliserNomBanque(bq.agences[i].nom) === normaliserNomBanque(nomA)) { a = bq.agences[i]; break; } }
      var src = { caution_num: l.caution_num || '', lu_le: l.lu_le || null, adresse_lue: l.adresse || '', ville_lue: l.ville || '' };
      if (!a) {
        a = { id: nouvelId(bq, bq.agences.length + 1), nom: nomA, adresse: String(l.adresse || '').trim(), ville: String(l.ville || '').trim(), destinataire: '', par_defaut: false, statut: 'a_confirmer', sources: [src] };
        bq.agences.push(a); ajoutees++;
      } else { a.sources.push(src); deja++; }
      liens.push({ caution_num: l.caution_num || '', banque: bq.nom, agence_id: a.id });
    });
    return { banques: docs, liens: liens, ajoutees: ajoutees, deja: deja, sans_lecture: sansLecture };
  }

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

  /* Champs POSSEDES PAR LE SERVEUR (posés par les endpoints de dépôt), que les
   * formulaires ne connaissent pas et ne doivent JAMAIS effacer en s'enregistrant.
   * Incident réel : un save de formulaire marché a écrasé le PV déposé 1 s avant. */
  var CHAMPS_PV_MARCHE = ['reception_definitive_prononcee', 'date_reception_definitive_reelle', 'pv_reception_definitive'];
  // NB : date_demande_mainlevee EXCLU volontairement — le formulaire caution le
  // possede (champ cdemmain), le preserver ecraserait une edition legitime. On ne
  // preserve que les champs de piece que le formulaire ne connait pas.
  var CHAMPS_PIECES_CAUTION = ['mainlevee_client', 'accuse_banque', 'date_mainlevee_recue', 'date_liberation',
    // Cycle du 20/11 : pieces et dates posees par /api/caution-piece et /api/caution-demande-banque.
    'original_caution', 'date_original_recu', 'piece_liberation', 'demande_banque', 'lettre_mainlevee', 'date_lettre', 'decharge_banque', 'date_decharge'];
  // Dates de transition de la provisoire (posées par provMainlevee/provRestituer/
  // attribuerAO), que la reconstruction de caution_prov dans editAO efface sinon.
  var CHAMPS_PROV_TRANSITION = ['date_demande_mainlevee', 'date_restitution'];

  /* Recopie sur `cible` (objet du formulaire) les `champs` présents sur `source`
   * (doc serveur ré-lu juste avant l'upsert). N'invente jamais un champ absent du
   * serveur, ne touche pas les autres champs du formulaire. Mute et renvoie cible. */
  function preserverChampsServeur(cible, source, champs) {
    if (!cible || !source) return cible;
    (champs || []).forEach(function (k) {
      if (source[k] !== undefined) cible[k] = source[k];
    });
    return cible;
  }

  /* Mainlevee MANUELLE (sans PV numerique) : le chemin reste OUVERT pour le cas
   * legitime « reception prononcee avant le systeme » (marche ancien), mais TRACE
   * — motif libre obligatoire + utilisateur — pour ne plus jamais reconstituer qui
   * a demande quoi par deduction sur des horodatages (incident 24/09). */
  function motifMainleveeValide(m) { return typeof m === 'string' && m.trim().length > 0; }

  /* active -> mainlevee_demandee, en enregistrant motif + utilisateur + date.
   * null si la caution n'est pas active (pas de saut d'etat) ou si motif absent.
   * Copie (ne mute pas l'entree). */
  function appliquerMainleveeManuelle(caution, motif, user, dateISO) {
    if (!caution || caution.statut !== 'active') return null;
    if (!motifMainleveeValide(motif)) return null;
    var out = {};
    Object.keys(caution).forEach(function (k) { out[k] = caution[k]; });
    out.statut = 'mainlevee_demandee';
    out.date_demande_mainlevee = dateISO;
    out.mainlevee_par = user || null;
    out.mainlevee_motif = motif.trim();
    return out;
  }

  /* Liberation DIRECTE (active -> liberee sans passer par l'accuse bancaire) : chemin
   * OUVERT pour les cas legitimes anciens (accuse papier, caution soldee hors systeme)
   * mais TRACE — motif libre obligatoire + utilisateur. Sinon une caution sort des
   * montants immobilises sans preuve ni auteur (mesure : 3 cautions, 135 161 MAD). */
  function appliquerLiberationDirecte(caution, motif, user, dateISO) {
    if (!caution || caution.statut !== 'active') return null;
    if (!motifMainleveeValide(motif)) return null;
    var out = {};
    Object.keys(caution).forEach(function (k) { out[k] = caution[k]; });
    out.statut = 'liberee';
    out.date_liberation = dateISO;
    out.liberation_par = user || null;
    out.liberation_motif = motif.trim();
    return out;
  }

  /* ===== Marche TERMINE automatique (decision Karim 08/10) =====
   * Toutes les cautions du marche dans un etat terminal (liberee OU restituee) avec
   * AU MOINS UNE liberee, ET le PV de reception definitive present -> le marche passe
   * « termine », trace « toutes cautions liberees le JJ/MM ». Reversible : si une
   * liberation est annulee (une caution quitte l'etat terminal), un marche « termine »
   * redevient « en cours », trace. Un marche SANS caution ne se termine jamais par ce
   * chemin ; on n'ecrase jamais un marche suspendu/resilie ; les decomptes/factures en
   * attente n'entrent PAS dans la decision (arbitrage Karim : on ne regarde que les cautions). */
  function _jjmm(dateISO) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || ''));
    return m ? (m[3] + '/' + m[2]) : String(dateISO || '');
  }
  /* Liberation PROUVEE = statut liberee/restituee ET accuse de la banque joint. Une liberee sans accuse
   * (constat DG 20/11/2026 : 3 cautions, 135 161 MAD) reste « a justifier » : comptee dans l'engage, et
   * elle ne termine pas un marche. */
  function liberationProuvee(c) { return !!c && (c.statut === 'liberee' || c.statut === 'restituee') && !!c.accuse_banque; }
  function liberationAJustifier(c) { return !!c && (c.statut === 'liberee' || c.statut === 'restituee') && !c.accuse_banque; }
  function marcheDoitTerminer(marche, cautions) {
    if (!marche || !cautions || !cautions.length) return false;
    if (!estRecevable(marche)) return false;
    var terminale = cautions.every(function (c) { return c && (c.statut === 'liberee' || c.statut === 'restituee'); });
    if (!terminale) return false;
    // Depuis le 20/11 : chaque liberation doit etre PROUVEE par l'accuse (aucune libere sans accuse).
    if (cautions.some(liberationAJustifier)) return false;
    return cautions.some(function (c) { return c && c.statut === 'liberee'; });
  }
  /* Marches « termine » dont au moins une caution est liberee SANS accuse : termines sur la foi d'une
   * liberation sans preuve. LISTES, jamais rouverts d'ici (appliquerStatutMarche ne les touche pas). */
  function marchesTerminesSansPreuve(marches, cautions) {
    var parM = {};
    (cautions || []).forEach(function (c) { var k = String(cMarcheId(c)); (parM[k] = parM[k] || []).push(c); });
    return (marches || []).filter(function (m) { return m && m.statut === 'termine' && (parM[String(m.id)] || []).some(liberationAJustifier); })
      .map(function (m) { return { ref: m.ref || '', titre: m.titre || m.objet || '', termine_le: m.termine_le || null, termine_trace: m.termine_trace || '', cautions: (parM[String(m.id)] || []).filter(liberationAJustifier).map(function (c) { return { num: c.referenceBanque || c.num || '', banque: c.banque || '', montant: +c.montant || 0 }; }) }; });
  }
  /* COPIE du marche avec statut/trace mis a jour, ou null si rien a changer (idempotent)
   * ou si le marche est suspendu/resilie. dateISO = date de l'evenement (AAAA-MM-JJ). */
  function appliquerStatutMarche(marche, cautions, dateISO) {
    if (!marche) return null;
    if (marche.statut === 'suspendu' || marche.statut === 'resilie') return null;
    var doit = marcheDoitTerminer(marche, cautions), out = {};
    if (doit && marche.statut !== 'termine') {
      Object.keys(marche).forEach(function (k) { out[k] = marche[k]; });
      out.statut = 'termine'; out.avancement = 100;
      out.termine_le = dateISO || null;
      out.termine_trace = 'toutes cautions liberees le ' + _jjmm(dateISO);
      return out;
    }
    // Retour « en cours » SEULEMENT si une caution a quitte l'etat liberee/restituee (liberation annulee).
    // Un marche termine sur la foi d'une liberation sans accuse n'est PAS rouvert d'ici : il est liste
    // (marchesTerminesSansPreuve), decision DG 20/11.
    var sortieTerminal = (cautions || []).some(function (c) { return c && c.statut !== 'liberee' && c.statut !== 'restituee'; });
    if (!doit && marche.statut === 'termine' && sortieTerminal) {
      Object.keys(marche).forEach(function (k) { out[k] = marche[k]; });
      out.statut = 'en_cours'; out.termine_le = null;
      out.termine_trace = 'retour en cours le ' + _jjmm(dateISO) + ' (liberation annulee)';
      return out;
    }
    return null;
  }

  /* INVARIANT (decision Karim) : une caution DOIT porter un marcheId — sinon elle
   * s'ecrit dans une partition vide au lieu de sa fiche. Refuse a l'API (creation,
   * depot d'acte, cas A comme B). Tolere marcheId (Cosmos) OU marche_id (cote app). */
  function cautionMarcheIdValide(doc) {
    return !!(doc && String((doc.marcheId != null ? doc.marcheId : doc.marche_id) || '').trim());
  }
  /* Operations de PATCH Cosmos pour RATTACHER un acte : touche le SEUL chemin /acte,
   * aucun autre champ de la caution (anti-clobber ; un depot d'acte = une cle patchee). */
  function patchActeOps(acte) { return [{ op: 'add', path: '/acte', value: acte }]; }
  /* PATCH d'un acte de PROVISOIRE : touche le SEUL chemin /caution_prov/acte sur l'AO
   * (aucun autre champ de l'AO). Meme garantie anti-clobber que patchActeOps. */
  function patchActeProvOps(acte) { return [{ op: 'add', path: '/caution_prov/acte', value: acte }]; }

  /* Toggle de la garde de version : réservé au DG (même source de rôle que RH :
   * rh_users.role dans la DB partagée). Tolère casse/espaces. */
  function peutBasculerGarde(role) { return String(role == null ? '' : role).trim().toLowerCase() === 'dg'; }

  /* CAS A (rapprochement) : construit la caution a creer depuis les champs CONFIRMES au
   * formulaire (jamais la valeur lue brute : si l'OCR a mal lu un montant, l'ecran le
   * corrige et c'est la valeur corrigee qui est portee). marcheId IMPOSE (invariant 2b :
   * null si absent, aucune creation hors marche). L'acte (reference blob) est joint. */
  function construireCautionCasA(champs, marcheId, acte) {
    if (!cautionMarcheIdValide({ marche_id: marcheId })) return null;
    champs = champs || {};
    return {
      marche_id: String(marcheId),
      type: champs.type || null,
      num: champs.num || null,
      montant: (champs.montant != null ? champs.montant : null),
      banque: champs.banque || null,
      date_emission: champs.date_emission || null,
      date_echeance: champs.date_echeance || null,
      statut: champs.statut || 'active',
      acte: acte || null
    };
  }

  /* ===== APPARIEMENT d'un acte a une caution (« Rapprochement des actes »), PUR. ===== */
  /* Normalisation du N° de caution = la norm de l'ERP : MAJUSCULE, sans espaces, tirets,
   * slash ni points. (L'egalite est aussi testee apres retrait des zeros de tete.) */
  function normaliserNumCaution(n) { return String(n == null ? '' : n).toUpperCase().replace(/[\s\-\/.]/g, ''); }
  function _numMatch(a, b) {
    var na = normaliserNumCaution(a), nb = normaliserNumCaution(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    var za = na.replace(/^0+/, ''), zb = nb.replace(/^0+/, '');
    return !!za && za === zb;
  }
  /* Référence banque COMPLÈTE (c.referenceBanque, telle qu'écrite par la banque sur
   * ses relevés : ex. BMCE « 810012624000694066 ») et ALIAS abrégé (c.num, l'ancien
   * numéro saisi : « 694066 »). Un numéro lu (acte OCR, ligne de relevé) s'apparie
   * d'abord sur la référence complète, puis sur l'alias. Renvoie 'reference' | 'alias'
   * | null — le mode est NOMMÉ, jamais implicite (décision Karim 23/10/2026). */
  function apparierNumero(lu, c) {
    if (!c) return null;
    if (_numMatch(lu, c.referenceBanque)) return 'reference';
    if (_numMatch(lu, c.num)) return 'alias';
    return null;
  }
  function _lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function _blobHasHash(acte, hash) { return !!(acte && hash && String(acte.blob || acte.hash || '').indexOf(String(hash)) >= 0); }
  /* Marche LU sur l'acte -> marche en base : par reference (normalisee), sinon objet/
   * intitule (contient), sinon maitre d'ouvrage. null si rien de sur. */
  function _resoudreMarcheLu(lu, marches) {
    marches = marches || []; lu = lu || {};
    var ref = normaliserNumCaution(lu.marche_ref), i;
    if (ref) {
      var hits = marches.filter(function (m) { return normaliserNumCaution(m.ref) === ref; });
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return null; // réf portée par plusieurs marchés -> ambigu, « à choisir »
    }
    var obj = _lc(lu.marche_objet);
    if (obj) { for (i = 0; i < marches.length; i++) { if (_lc(marches[i].objet).indexOf(obj) >= 0 || _lc(marches[i].titre).indexOf(obj) >= 0) return marches[i]; } }
    var mo = _lc(lu.marche_mo);
    if (mo) { for (i = 0; i < marches.length; i++) { if (_lc(marches[i].maitre_ouvrage) === mo) return marches[i]; } }
    return null;
  }
  /* LIGNE SÛRE (attachable en masse par « Attacher les lignes sûres ») — DÉFINITION :
   * N° lu = N° d'une caution existante (appariement mode 'a') ET montant lu = montant
   * enregistré. Tout le reste (réf seule, réf+MO, N° à montant différent, N° sur deux
   * cautions, acte déjà joint) est « proposé » -> « Attacher » ligne par ligne, JAMAIS sûr. */
  function ligneSureRapprochement(app, montantLu) {
    if (!app || app.mode !== 'a' || !app.cible) return false;
    var ms = Math.round(+app.cible.montant || 0), ml = Math.round(+montantLu || 0);
    return ml !== 0 && ms === ml;
  }
  /* Construction du LOT de dépôt « Rapprochement des actes » : chaque dépôt (glisser
   * ou dialogue) S'AJOUTE au lot en cours. Garde PDF-seul, dédoublonnage nom+taille
   * (nommé), plafond dur (21e refusé, nommé « 20 au plus par dépôt »). Renvoie le
   * nouveau lot + les noms écartés par motif. Pousse l'objet d'entrée tel quel (le
   * navigateur y conserve le File ; node y met un descripteur {name,size,type}). */
  function ajouterFichiersLot(liste, entrants, max) {
    max = (max != null) ? max : 20;
    var out = (liste || []).slice();
    entrants = entrants || [];
    var doublons = [], refuses = [], nonPdf = [], ajoutes = 0, i, j;
    for (i = 0; i < entrants.length; i++) {
      var f = entrants[i]; if (!f) continue;
      var nom = f.name || '';
      var estPdf = (f.type === 'application/pdf') || /\.pdf$/i.test(nom);
      if (!estPdf) { nonPdf.push(nom); continue; }
      var dup = false;
      for (j = 0; j < out.length; j++) { if (out[j].name === nom && Number(out[j].size) === Number(f.size)) { dup = true; break; } }
      if (dup) { doublons.push(nom); continue; }
      if (out.length >= max) { refuses.push(nom); continue; }
      out.push(f); ajoutes++;
    }
    return { liste: out, ajoutes: ajoutes, doublons: doublons, refuses: refuses, nonPdf: nonPdf };
  }
  /* Garde de version — réarmement au déploiement. gardeBuild = build où l'état de la
   * garde a été fixé pour la dernière fois (toggle ou réarmement). On réarme quand le
   * build DÉPLOYÉ est strictement plus récent (le DG avait éteint pour l'ancien build ;
   * un nouveau build la réactive). Build déployé illisible -> ne conclut jamais (doctrine
   * #35). gardeBuild absent -> jamais armé pour un build -> réarmer. */
  function doitRearmerGarde(gardeBuild, deployBuild) {
    var d = Number(deployBuild);
    if (!isFinite(d) || d <= 0) return false;
    var g = Number(gardeBuild);
    if (!isFinite(g)) return true;
    return d > g;
  }
  /* Pastille ambre « garde inactive » dans l'en-tête : DG SEUL, et seulement quand la
   * garde est explicitement Inactive (false strict ; undefined pendant le chargement
   * n'allume rien). */
  function pastilleGardeInactive(isDg, gardeVersionActive) {
    return isDg === true && gardeVersionActive === false;
  }
  /* Premier match SUR gagne (step 4). candidats = liste unifiee {kind:'caution'|
   * 'provisoire', id, marcheId, num, banque, montant, type, acte}. Renvoie
   * {mode:'doublon_hash'|'deja_acte'|'a'|'b'|'c'|'a_choisir', cible, candidates, marchePropose}. */
  function apparierActe(lu, hash, candidats, marches) {
    lu = lu || {}; candidats = candidats || []; marches = marches || [];
    var i;
    // 0. le hash est deja rattache -> doublon, rien a faire
    for (i = 0; i < candidats.length; i++) { if (_blobHasHash(candidats[i].acte, hash)) return { mode: 'doublon_hash', cible: candidats[i], candidates: [], marchePropose: null }; }
    // a. N° normalise : reference banque COMPLETE d'abord, puis alias abrege
    var parRef = candidats.filter(function (c) { return apparierNumero(lu.num, c) === 'reference'; });
    var via = parRef.length ? 'reference' : 'alias';
    var parNum = parRef.length ? parRef : candidats.filter(function (c) { return apparierNumero(lu.num, c) === 'alias'; });
    if (parNum.length === 1) {
      if (parNum[0].acte) return { mode: 'deja_acte', cible: parNum[0], candidates: [], marchePropose: null, via: via };
      return { mode: 'a', cible: parNum[0], candidates: [], marchePropose: null, via: via };
    }
    if (parNum.length > 1) {
      var aff = parNum.filter(function (c) { return (!lu.type || c.type === lu.type) && (lu.montant == null || Math.round(+c.montant || 0) === Math.round(+lu.montant || 0)); });
      if (aff.length === 1 && !aff[0].acte) return { mode: 'a', cible: aff[0], candidates: [], marchePropose: null, via: via };
      return { mode: 'a_choisir', cible: null, candidates: parNum, marchePropose: null };
    }
    // b. type + banque + montant parmi les cautions SANS acte
    var parBM = candidats.filter(function (c) {
      return !c.acte && lu.type && c.type === lu.type && lu.banque && _lc(c.banque) === _lc(lu.banque) && lu.montant != null && Math.round(+c.montant || 0) === Math.round(+lu.montant || 0);
    });
    if (parBM.length === 1) return { mode: 'b', cible: parBM[0], candidates: [], marchePropose: null };
    if (parBM.length > 1) {
      var mLu = _resoudreMarcheLu(lu, marches);
      if (mLu) { var dis = parBM.filter(function (c) { return String(c.marcheId) === String(mLu.id); }); if (dis.length === 1) return { mode: 'b', cible: dis[0], candidates: [], marchePropose: mLu }; }
      return { mode: 'a_choisir', cible: null, candidates: parBM, marchePropose: mLu || null };
    }
    // c. sans correspondance
    return { mode: 'c', cible: null, candidates: [], marchePropose: _resoudreMarcheLu(lu, marches) };
  }

  function transitionPiece(pieceType) { return PIECE_TRANSITIONS[pieceType] || null; }

  /* Une piece est recevable si : la transition existe, la caution est def/RG,
   * et son statut courant est le statut de depart impose par la piece. */
  function pieceRecevable(caution, pieceType) {
    var t = transitionPiece(pieceType);
    if (!t || !caution) return false;
    if (!suitLeCycle(caution)) return false;
    if (caution[t.champ] && t.vers === t.de) return false; // decharge deja jointe : pas d'ecrasement muet
    return etatCycle(caution) === t.de;
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

  var STATUTS_CLOS = ['liberee', 'restituee'];
  /* Dépôt A POSTERIORI d'un justificatif (mainlevée client / accusé banque) sur une
   * caution DÉJÀ close (libérée/restituée) — typiquement une régularisation rétroactive
   * « sans accusé numérique ». Recevable si : pièce de mainlevée/accusé connue, caution
   * def/RG, statut déjà clos, et la pièce PAS déjà présente (jamais d'écrasement muet). */
  function pieceJustifRecevable(caution, pieceType) {
    var t = PIECES_JUSTIF[pieceType];
    if (!t || !caution) return false;
    if (!suitLeCycle(caution)) return false;
    if (STATUTS_CLOS.indexOf(caution.statut) < 0) return false;
    if (caution[t.champ]) return false; // déjà jointe
    return true;
  }
  /* Applique le justificatif SANS changer le statut (copie) : pose la pièce + sa date +
   * une trace a posteriori {piece, le, par, date_piece}. null si non recevable. */
  function appliquerPieceJustificative(caution, pieceType, pieceRef, dateISO, par) {
    if (!pieceJustifRecevable(caution, pieceType)) return null;
    var t = PIECES_JUSTIF[pieceType];
    var out = {};
    Object.keys(caution).forEach(function (k) { out[k] = caution[k]; });
    out[t.champ] = pieceRef; // statut INCHANGÉ
    out[t.dateChamp] = dateISO;
    out.pieces_justif_trace = (Array.isArray(out.pieces_justif_trace) ? out.pieces_justif_trace : []).concat([{ piece: pieceType, le: new Date().toISOString(), par: par || null, date_piece: dateISO }]);
    return out;
  }

  /* Lecture des pieces : ou vit chaque piece (marche ou caution), son conteneur
   * Blob, son libelle humain et le champ date associe. La resolution du blob se
   * fait UNIQUEMENT depuis le document stocke : aucun chemin fourni par l'appelant
   * n'est jamais servi (defense contre un chemin blob devine). */
  var PIECE_LECTURE = {
    pv:               { sur: 'marche',  champ: 'pv_reception_definitive', dateChamp: 'date_reception_definitive_reelle', conteneur: 'mp-pv-reception', label: 'PV de reception definitive' },
    mainlevee_client: { sur: 'caution', champ: 'mainlevee_client',        dateChamp: 'date_mainlevee_recue',            conteneur: 'mp-preuves',      label: 'Mainlevee du maitre d\'ouvrage' },
    original_caution: { sur: 'caution', champ: 'original_caution',        dateChamp: 'date_original_recu',              conteneur: 'mp-preuves',      label: 'Original de la caution restitue' },
    lettre_mainlevee: { sur: 'caution', champ: 'lettre_mainlevee',        dateChamp: 'date_lettre',                     conteneur: 'mp-preuves',      label: 'Lettre de demande a la banque' },
    decharge_banque:  { sur: 'caution', champ: 'decharge_banque',         dateChamp: 'date_decharge',                   conteneur: 'mp-preuves',      label: 'Decharge de la banque' },
    accuse_banque:    { sur: 'caution', champ: 'accuse_banque',           dateChamp: 'date_liberation',                 conteneur: 'mp-preuves',      label: 'Accuse bancaire' },
    acte:             { sur: 'caution', champ: 'acte',                    dateChamp: 'date_emission',                   conteneur: 'mp-preuves',      label: 'Acte de caution' }
  };
  /* Piece d'une PROVISOIRE : le blob vit sur l'AO (ao.caution_prov[champ]), lu depuis le doc AO. */
  function resoudreBlobPieceProv(type, ao) {
    var s = PIECE_LECTURE[type];
    if (!s || s.sur !== 'caution' || !ao || !ao.caution_prov) return null;
    var ref = ao.caution_prov[s.champ];
    return (ref && ref.blob) || null;
  }

  /* Vrai seulement si un principal Entra est present (userDetails). */
  function principalAutorise(p) { return !!(p && p.userDetails); }

  /* OCR acte de caution — modele PRECIS impose (jamais le "rapide" haiku qui hallucine,
   * lecon ERP incident BR2638). Un seul chemin d'extraction, mis en cache par hash cote
   * serveur. Le nom du modele vit ici (source unique) ; l'appel Anthropic est serveur-only. */
  var MODELE_OCR = 'claude-sonnet-5';

  /* Cle IA presente ? FAIL-SOFT : si absente, le DEPOT reste possible, l'OCR dit
   * seulement "non configure". Ne lit qu'une presence, jamais la valeur. */
  function ocrConfigure(cle) { return typeof cle === 'string' && cle.trim().length > 0; }

  function _normCmp(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  /* CAS B — compare une caution STOCKEE a ce que l'OCR a lu, et renvoie les ECARTS.
   * N'ECRIT RIEN (la donnee saisie fait foi). Ignore les champs que l'OCR n'a pas lus
   * (pas de faux ecart par champ manquant). extrait = { montant, banque, reference,
   * date_emission, echeance } (sortie OCR normalisee). */
  function comparerActe(stockee, extrait) {
    stockee = stockee || {}; extrait = extrait || {};
    var champs = [
      { cle: 'montant', lu: 'montant', num: true },
      { cle: 'banque', lu: 'banque' },
      { cle: 'num', lu: 'reference' },
      { cle: 'date_emission', lu: 'date_emission' },
      { cle: 'date_echeance', lu: 'echeance' }
    ];
    var ecarts = [];
    champs.forEach(function (c) {
      var vl = extrait[c.lu];
      if (vl === undefined || vl === null || vl === '') return; // OCR n'a rien lu -> pas d'ecart
      var vs = stockee[c.cle];
      var diff = c.num ? (Math.round(+vs || 0) !== Math.round(+vl || 0)) : (_normCmp(vs) !== _normCmp(vl));
      // N° : la reference banque COMPLETE lue sur l'acte n'est pas un ecart avec l'alias stocke.
      if (diff && c.cle === 'num' && _numMatch(vl, stockee.referenceBanque)) diff = false;
      if (diff) ecarts.push({ champ: c.cle, stocke: (vs === undefined ? null : vs), lu: vl });
    });
    return ecarts;
  }

  /* Cle de cache OCR = modele ET hash du fichier. Si le modele change, l'ancienne
   * extraction n'est PAS servie comme fraiche (variante du defaut « 2 modeles » de l'ERP). */
  function cleCacheOcr(hashHex, modele) { return String(modele || '') + ':' + String(hashHex || ''); }

  /* ===== Journal du cas B : lecture automatique de la mesure (garde Karim).
   * Verdict humain par ecart, VERROUILLE a ces trois valeurs. */
  var VERDICTS_ECART = ['vrai_ecart', 'mauvaise_lecture', 'ignore'];
  /* Une comparaison est VERDICTEE quand elle n'a aucun ecart (l'acte concorde) OU que
   * CHAQUE ecart porte un verdict connu. Une seule case vide -> pas encore jugee. */
  function _estVerdicte(c) {
    var e = (c && c.ecarts) || [];
    if (!e.length) return true;
    for (var i = 0; i < e.length; i++) { if (VERDICTS_ECART.indexOf(e[i] && e[i].verdict) < 0) return false; }
    return true;
  }
  /* LECTURE de la mesure (sur le journal mp_ocr_comparaisons) : taux d'ecarts REELS et
   * de FAUSSES lectures (global + par champ), et une recommandation qui n'est jamais
   * « peut generaliser » avant 10 comparaisons VERDICTEES, et qui refuse B si les
   * fausses lectures l'emportent sur les ecarts reels. « ignore » n'entre pas dans les
   * taux (denominateur = vrais + mauvaises). PUR : aucune ecriture, aucune horloge. */
  function statsMesure(comparaisons) {
    comparaisons = comparaisons || [];
    var verdictees = comparaisons.filter(_estVerdicte);
    var nbVrais = 0, nbMauvaises = 0, nbIgnores = 0, nbEcarts = 0, parChamp = {};
    verdictees.forEach(function (c) {
      ((c && c.ecarts) || []).forEach(function (e) {
        nbEcarts++;
        var ch = e.champ || '?';
        if (!parChamp[ch]) parChamp[ch] = { total: 0, vraies: 0, mauvaises: 0, ignores: 0, tauxFausse: 0 };
        parChamp[ch].total++;
        if (e.verdict === 'vrai_ecart') { nbVrais++; parChamp[ch].vraies++; }
        else if (e.verdict === 'mauvaise_lecture') { nbMauvaises++; parChamp[ch].mauvaises++; }
        else if (e.verdict === 'ignore') { nbIgnores++; parChamp[ch].ignores++; }
      });
    });
    Object.keys(parChamp).forEach(function (ch) {
      var p = parChamp[ch], denom = p.vraies + p.mauvaises;
      p.tauxFausse = denom > 0 ? (p.mauvaises / denom) : 0;
    });
    var denomGlobal = nbVrais + nbMauvaises;
    var decisionPrete = verdictees.length >= 10;
    return {
      nbComparaisons: comparaisons.length,
      nbVerdictees: verdictees.length,
      decisionPrete: decisionPrete,
      nbEcarts: nbEcarts, nbVrais: nbVrais, nbMauvaises: nbMauvaises, nbIgnores: nbIgnores,
      tauxEcartsReels: denomGlobal > 0 ? (nbVrais / denomGlobal) : null,
      tauxFaussesLectures: denomGlobal > 0 ? (nbMauvaises / denomGlobal) : null,
      parChamp: parChamp,
      recommandation: !decisionPrete ? 'en_attente' : (nbMauvaises > nbVrais ? 'ne_pas_generaliser' : 'peut_generaliser')
    };
  }

  /* Ecarts a TRAITER pour le dashboard : a plat, les ecarts soit VRAIS (a corriger la
   * fiche), soit PAS ENCORE juges (a verdicter — sinon un ecart issu d'un depot
   * automatique resterait invisible). Exclut mauvaise_lecture et ignore (resolus).
   * Porte le contexte humain : caution, champ, valeur fiche vs acte, qui/quand, et
   * l'id de la comparaison (pour poser le verdict). PUR. */
  function ecartsATraiter(comparaisons) {
    comparaisons = comparaisons || [];
    var out = [];
    comparaisons.forEach(function (c) {
      ((c && c.ecarts) || []).forEach(function (e) {
        var v = e && e.verdict;
        if (v === 'vrai_ecart' || v == null || v === '') {
          out.push({
            comparaisonId: c.id || null,
            cautionId: c.cautionId || null,
            marcheId: c.marcheId || null,
            caution_num: c.caution_num || '',
            champ: e.champ,
            valeur_saisie: (e.valeur_saisie === undefined ? null : e.valeur_saisie),
            valeur_acte: (e.valeur_acte === undefined ? null : e.valeur_acte),
            confiance: e.confiance || null,
            verdict: (v == null || v === '') ? null : v,
            verdict_par: e.verdict_par || null,
            verdict_le: e.verdict_le || null,
            compare_par: c.compare_par || null,
            compare_le: c.compare_le || null
          });
        }
      });
    });
    return out;
  }

  var TYPES_OCR_CONNUS = ['soumission', 'bonne_execution', 'retenue_garantie'];
  /* Le type lu par l'OCR est CONTRAINT aux types connus : l'OCR propose, la liste
   * verrouille. Renvoie un type connu ou null (l'utilisateur choisit alors).
   * PONT provisoire -> soumission : « provisoire », « caution provisoire », « CP »
   * designent le meme instrument que la « caution de soumission », seul nom porte
   * par le modele. La TRADUCTION ne doit PAS effacer la valeur brute lue : l'appelant
   * garde le texte d'origine dans la trace (voir ocr-acte.js _normaliser -> lu_brut). */
  function normaliserTypeOcr(propose) {
    var t = _normCmp(propose); if (!t) return null;
    if (t === 'cp' || t.indexOf('provisoire') >= 0 || t.indexOf('soumission') >= 0) return 'soumission';
    if (t.indexOf('retenue') >= 0 || t === 'rg' || t.indexOf('garantie') >= 0) return 'retenue_garantie';
    if (t.indexOf('definitive') >= 0 || t.indexOf('bonne') >= 0 || t.indexOf('execution') >= 0) return 'bonne_execution';
    return null;
  }

  /* La banque lue est rattachee au REFERENTIEL existant, jamais un libelle libre
   * invente par le modele. Renvoie une entree du referentiel ou null. */
  function normaliserBanqueOcr(propose, referentiel) {
    var t = _normCmp(propose); if (!t) return null; referentiel = referentiel || [];
    for (var i = 0; i < referentiel.length; i++) {
      var r = _normCmp(referentiel[i]);
      if (r && (r === t || t.indexOf(r) >= 0 || r.indexOf(t) >= 0)) return referentiel[i];
    }
    return null;
  }

  /* Parsing montant DANS le module pur (pas dans l'UI). Gere « 99 072,00 MAD »,
   * « 99.072 », « 1.234.567,89 ». Renvoie un nombre, ou NULL si illisible — jamais 0
   * (un montant qui ne parse pas est un champ a confiance zero, pas un zero). */
  function parserMontant(s) {
    if (s == null) return null;
    var t = String(s).replace(/[^\d.,\-]/g, '').trim();
    if (!t) return null;
    var dot = t.lastIndexOf('.'), comma = t.lastIndexOf(','), dec = Math.max(dot, comma);
    var sepDecimal = null;
    if (dec >= 0) { var apres = t.length - dec - 1; if (apres === 1 || apres === 2) sepDecimal = dec; }
    var intPart, decPart = '';
    if (sepDecimal !== null) { intPart = t.slice(0, dec).replace(/[.,\s]/g, ''); decPart = t.slice(dec + 1).replace(/\D/g, ''); }
    else { intPart = t.replace(/[.,\s]/g, ''); }
    if (!/^-?\d+$/.test(intPart)) return null;
    var n = parseFloat(intPart + (decPart ? ('.' + decPart) : ''));
    return isNaN(n) ? null : n;
  }

  /* Pastille de confiance : 3 etats (comme l'ERP), pas de pourcentage a l'ecran.
   * >=80 lu ; <80 douteux (confirmation obligatoire) ; absent/illisible non_lu. */
  function etatConfiance(score) {
    if (score == null || isNaN(+score)) return 'non_lu';
    return (+score >= 80) ? 'lu' : 'douteux';
  }

  /* Date de piece (PV, mainlevee, accuse) : AAAA-MM-JJ obligatoire. Refuse le vide
   * -> un depot sans date saisie est rejete, JAMAIS complete par la date du jour
   * (doctrine : quand le systeme ne sait pas, il ne propose pas une valeur plausible). */
  function dateReceptionValide(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)); }

  /* Garde de l'endpoint machine /api/relance-hebdo (voie A, secret partage).
   * PAS de fail-open : si le secret ATTENDU est vide/absent, on REFUSE tout —
   * jamais l'inverse. Il faut que le secret attendu soit non vide ET que
   * l'en-tete fourni corresponde exactement. */
  function enteteRelanceValide(fourni, attendu) {
    if (!attendu) return false;
    return fourni === attendu;
  }

  function _sourcePiece(type) { return PIECE_LECTURE[type] || null; }

  /* Nom du blob a servir, LU depuis le doc (marche ou caution). null si type
   * inconnu ou piece absente. Ne prend jamais un chemin de l'appelant. */
  function resoudreBlobPiece(type, marche, caution) {
    var s = _sourcePiece(type);
    if (!s) return null;
    var doc = s.sur === 'marche' ? marche : caution;
    if (!doc || !doc[s.champ] || !doc[s.champ].blob) return null;
    return doc[s.champ].blob;
  }

  /* Conteneur Blob d'un type de piece (null si type inconnu). */
  function conteneurPiece(type) { var s = _sourcePiece(type); return s ? s.conteneur : null; }

  /* Acte d'une PROVISOIRE : le blob vit sur l'AO (a.caution_prov.acte), pas sur une
   * mp_cautions. Renvoie le nom du blob LU depuis le doc AO, ou null. Conteneur mp-preuves. */
  function resoudreBlobActeProv(ao) { return (ao && ao.caution_prov && ao.caution_prov.acte && ao.caution_prov.acte.blob) || null; }

  /* Libelle humain (jamais le nom de fichier interne). L'appelant y ajoute la date formatee. */
  function libellePiece(type) { var s = _sourcePiece(type); return s ? s.label : ''; }

  /* Champ date associe a une piece (pour composer "<label> du <date>" cote UI). */
  function dateChampPiece(type) { var s = _sourcePiece(type); return s ? s.dateChamp : null; }

  /* Mail du lundi : file de relance = cautions def/RG en mainlevee_demandee (la
   * relance s'arrete a l'etat b : une caution mainlevee_recue n'y est plus).
   * lignesRelance renvoie des LIBELLES HUMAINS uniquement (ref marche, client,
   * type, N°, montant, anciennete en jours) — jamais d'id. gm(marcheId)->{ref,
   * maitre_ouvrage}. nowMs injecte (deterministe). */
  function lignesRelance(cautions, gm, nowMs) {
    gm = gm || function () { return {}; };
    return mainleveesEnAttente(cautions).map(function (c) {
      var m = gm(cMarcheId(c)) || {};
      return {
        ref: m.ref || '', client: m.maitre_ouvrage || '', type: c.type,
        num: c.num || '', montant: +c.montant || 0, jours: joursDepuisDemande(c, nowMs),
        // Adossee a un PV (reception prononcee dans le systeme) ou mainlevee manuelle
        // (sans PV numerique) : le mail doit distinguer laquelle est justifiee par une piece.
        justif: (m.reception_definitive_prononcee === true) ? 'PV' : 'manuel',
        motif: c.mainlevee_motif || null
      };
    }).sort(function (a, b) { return b.jours - a.jours; });
  }

  /* Decide s'il faut envoyer, et le contenu. File VIDE -> envoyer:false (pas de
   * mail : un rappel hebdo vide finit ignore). Pas d'id dans le sujet. */
  function mailHebdo(lignes) {
    if (!lignes || !lignes.length) return { envoyer: false, nb: 0, total: 0 };
    var total = lignes.reduce(function (s, l) { return s + (+l.montant || 0); }, 0);
    return {
      envoyer: true, nb: lignes.length, total: total,
      sujet: 'Mainlevees en attente du client — ' + lignes.length + ' caution(s), ' + total + ' MAD',
      lignes: lignes
    };
  }

  return {
    TYPES_MAINLEVEE: TYPES_MAINLEVEE,
    ETATS_CYCLE: ETATS_CYCLE,
    ETATS_BLOQUES: ETATS_BLOQUES,
    PIECES_LIBERATION: PIECES_LIBERATION,
    PIECES_JUSTIF: PIECES_JUSTIF,
    DELAI_ALERTE_BANQUE_DEFAUT: DELAI_ALERTE_BANQUE_DEFAUT,
    etatCycle: etatCycle,
    estProvisoire: estProvisoire,
    suitLeCycle: suitLeCycle,
    pieceLiberationDe: pieceLiberationDe,
    libellePieceLiberation: libellePieceLiberation,
    pieceLiberationRecevable: pieceLiberationRecevable,
    appliquerPieceLiberation: appliquerPieceLiberation,
    depotBanqueRecevable: depotBanqueRecevable,
    appliquerDepotBanque: appliquerDepotBanque,
    accuseAvecDepotRecevable: accuseAvecDepotRecevable,
    joursDepuisDepot: joursDepuisDepot,
    refusChangementStatutGenerique: refusChangementStatutGenerique,
    lignesLettre: lignesLettre,
    normaliserNomBanque: normaliserNomBanque,
    trouverBanque: trouverBanque,
    agencesDe: agencesDe,
    agenceComplete: agenceComplete,
    resoudreAgence: resoudreAgence,
    cleAgence: cleAgence,
    validerFicheBanque: validerFicheBanque,
    fusionnerLecturesAgences: fusionnerLecturesAgences,
    resoudreBlobPieceProv: resoudreBlobPieceProv,
    PIECE_TRANSITIONS: PIECE_TRANSITIONS,
    PIECE_LECTURE: PIECE_LECTURE,
    cMarcheId: cMarcheId,
    estRecevable: estRecevable,
    cautionsABasculer: cautionsABasculer,
    appliquerBascule: appliquerBascule,
    basculerMarche: basculerMarche,
    mainleveesEnAttente: mainleveesEnAttente,
    joursDepuisDemande: joursDepuisDemande,
    transitionPiece: transitionPiece,
    pieceRecevable: pieceRecevable,
    appliquerPiece: appliquerPiece,
    principalAutorise: principalAutorise,
    cautionMarcheIdValide: cautionMarcheIdValide,
    patchActeOps: patchActeOps,
    patchActeProvOps: patchActeProvOps,
    construireCautionCasA: construireCautionCasA,
    peutBasculerGarde: peutBasculerGarde,
    normaliserNumCaution: normaliserNumCaution,
    apparierNumero: apparierNumero,
    apparierActe: apparierActe,
    ligneSureRapprochement: ligneSureRapprochement,
    ajouterFichiersLot: ajouterFichiersLot,
    pieceJustifRecevable: pieceJustifRecevable,
    appliquerPieceJustificative: appliquerPieceJustificative,
    doitRearmerGarde: doitRearmerGarde,
    pastilleGardeInactive: pastilleGardeInactive,
    marcheDoitTerminer: marcheDoitTerminer,
    liberationProuvee: liberationProuvee,
    liberationAJustifier: liberationAJustifier,
    marchesTerminesSansPreuve: marchesTerminesSansPreuve,
    appliquerStatutMarche: appliquerStatutMarche,
    MODELE_OCR: MODELE_OCR,
    ocrConfigure: ocrConfigure,
    comparerActe: comparerActe,
    cleCacheOcr: cleCacheOcr,
    VERDICTS_ECART: VERDICTS_ECART,
    statsMesure: statsMesure,
    ecartsATraiter: ecartsATraiter,
    TYPES_OCR_CONNUS: TYPES_OCR_CONNUS,
    normaliserTypeOcr: normaliserTypeOcr,
    normaliserBanqueOcr: normaliserBanqueOcr,
    parserMontant: parserMontant,
    etatConfiance: etatConfiance,
    dateReceptionValide: dateReceptionValide,
    motifMainleveeValide: motifMainleveeValide,
    appliquerMainleveeManuelle: appliquerMainleveeManuelle,
    appliquerLiberationDirecte: appliquerLiberationDirecte,
    resoudreBlobPiece: resoudreBlobPiece,
    resoudreBlobActeProv: resoudreBlobActeProv,
    conteneurPiece: conteneurPiece,
    libellePiece: libellePiece,
    dateChampPiece: dateChampPiece,
    lignesRelance: lignesRelance,
    mailHebdo: mailHebdo,
    enteteRelanceValide: enteteRelanceValide,
    CHAMPS_PV_MARCHE: CHAMPS_PV_MARCHE,
    CHAMPS_PIECES_CAUTION: CHAMPS_PIECES_CAUTION,
    CHAMPS_PROV_TRANSITION: CHAMPS_PROV_TRANSITION,
    preserverChampsServeur: preserverChampsServeur
  };
});
