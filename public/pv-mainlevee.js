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

  /* Champs POSSEDES PAR LE SERVEUR (posés par les endpoints de dépôt), que les
   * formulaires ne connaissent pas et ne doivent JAMAIS effacer en s'enregistrant.
   * Incident réel : un save de formulaire marché a écrasé le PV déposé 1 s avant. */
  var CHAMPS_PV_MARCHE = ['reception_definitive_prononcee', 'date_reception_definitive_reelle', 'pv_reception_definitive'];
  // NB : date_demande_mainlevee EXCLU volontairement — le formulaire caution le
  // possede (champ cdemmain), le preserver ecraserait une edition legitime. On ne
  // preserve que les champs de piece que le formulaire ne connait pas.
  var CHAMPS_PIECES_CAUTION = ['mainlevee_client', 'accuse_banque', 'date_mainlevee_recue', 'date_liberation'];
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

  /* Lecture des pieces : ou vit chaque piece (marche ou caution), son conteneur
   * Blob, son libelle humain et le champ date associe. La resolution du blob se
   * fait UNIQUEMENT depuis le document stocke : aucun chemin fourni par l'appelant
   * n'est jamais servi (defense contre un chemin blob devine). */
  var PIECE_LECTURE = {
    pv:               { sur: 'marche',  champ: 'pv_reception_definitive', dateChamp: 'date_reception_definitive_reelle', conteneur: 'mp-pv-reception', label: 'PV de reception definitive' },
    mainlevee_client: { sur: 'caution', champ: 'mainlevee_client',        dateChamp: 'date_mainlevee_recue',            conteneur: 'mp-preuves',      label: 'Mainlevee recue' },
    accuse_banque:    { sur: 'caution', champ: 'accuse_banque',           dateChamp: 'date_liberation',                 conteneur: 'mp-preuves',      label: 'Accuse bancaire' }
  };

  /* Vrai seulement si un principal Entra est present (userDetails). */
  function principalAutorise(p) { return !!(p && p.userDetails); }

  /* OCR acte de caution — modele PRECIS impose (jamais le "rapide" haiku qui hallucine,
   * lecon ERP incident BR2638). Un seul chemin d'extraction, mis en cache par hash cote
   * serveur. Le nom du modele vit ici (source unique) ; l'appel Anthropic est serveur-only. */
  var MODELE_OCR = 'claude-sonnet-5';

  /* Cle IA presente ? FAIL-SOFT (≠ autolink) : si absente, le DEPOT reste possible,
   * l'OCR dit seulement "non configure". Ne lit qu'une presence, jamais la valeur. */
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
      if (diff) ecarts.push({ champ: c.cle, stocke: (vs === undefined ? null : vs), lu: vl });
    });
    return ecarts;
  }

  /* Cle de cache OCR = modele ET hash du fichier. Si le modele change, l'ancienne
   * extraction n'est PAS servie comme fraiche (variante du defaut « 2 modeles » de l'ERP). */
  function cleCacheOcr(hashHex, modele) { return String(modele || '') + ':' + String(hashHex || ''); }

  var TYPES_OCR_CONNUS = ['provisoire', 'bonne_execution', 'retenue_garantie'];
  /* Le type lu par l'OCR est CONTRAINT aux types connus : l'OCR propose, la liste
   * verrouille. Renvoie un type connu ou null (l'utilisateur choisit alors). */
  function normaliserTypeOcr(propose) {
    var t = _normCmp(propose); if (!t) return null;
    if (t.indexOf('provisoire') >= 0 || t.indexOf('soumission') >= 0) return 'provisoire';
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

  /* Autolink ERP : le secret partagé est-il configuré ? FAIL-CLOSED — si absent/vide,
   * l'endpoint MP refuse (401) et n'appelle JAMAIS l'ERP sans secret. Ne lit qu'une
   * PRÉSENCE, jamais la valeur (les valeurs de secret ne transitent pas par ce module). */
  function autolinkConfigure(secret) { return typeof secret === 'string' && secret.trim().length > 0; }

  /* Date de piece (PV, mainlevee, accuse) : AAAA-MM-JJ obligatoire. Refuse le vide
   * -> un depot sans date saisie est rejete, JAMAIS complete par la date du jour
   * (doctrine : quand le systeme ne sait pas, il ne propose pas une valeur plausible). */
  function dateReceptionValide(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)); }

  /* Garde de l'endpoint machine /api/relance-hebdo (voie A, secret partage).
   * PAS de fail-open (lecon de X-MP-Autolink-Secret cote ERP) : si le secret
   * ATTENDU est vide/absent, on REFUSE tout — jamais l'inverse. Il faut que le
   * secret attendu soit non vide ET que l'en-tete fourni corresponde exactement. */
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
    autolinkConfigure: autolinkConfigure,
    MODELE_OCR: MODELE_OCR,
    ocrConfigure: ocrConfigure,
    comparerActe: comparerActe,
    cleCacheOcr: cleCacheOcr,
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
