/* =========================================================================
 * MPEtude — règles PURES de l'étude d'AO (lot « Étude d'AO automatisée »).
 *
 * Chargé par le navigateur (window.MPEtude) ET par node (require) : la même
 * implémentation sert l'écran, l'API (copie api/etude-calc.js, identité gardée par
 * test/module-copy.test.js) et les gates. ES5 strict : ni let/const, ni fonctions
 * fléchées, ni gabarits.
 *
 * Principe : l'étude est un BROUILLON. Toute information extraite porte sa source
 * (document, page, extrait exact rendu par les citations de l'API Claude) ; sans
 * citation, elle est marquée « à vérifier », jamais affichée comme sûre.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPEtude = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var A_VERIFIER = 'à vérifier';

  /* ---------- Libellés ---------- */
  var FAITS = [
    { cle: 'caution_provisoire', l: 'Caution provisoire' },
    { cle: 'delai_execution', l: "Délai d'exécution" },
    { cle: 'visite_lieux', l: 'Visite des lieux' },
    { cle: 'qualification', l: 'Qualification exigée' },
    { cle: 'criteres_attribution', l: 'Attribution' },
    { cle: 'eclaircissements', l: 'Éclaircissements' },
    { cle: 'estimation', l: "Estimation du maître d'ouvrage" },
    { cle: 'date_limite', l: 'Date limite de dépôt' },
    { cle: 'heure_limite', l: 'Heure limite de dépôt' },
    { cle: 'lieu_depot', l: 'Lieu et mode de dépôt' }
  ];
  var CLAUSES = [
    { cle: 'penalites', l: 'Pénalités de retard et plafond' },
    { cle: 'retenue_garantie', l: 'Retenue de garantie' },
    { cle: 'caution_definitive', l: 'Caution définitive' },
    { cle: 'revision_prix', l: 'Révision des prix' },
    { cle: 'delai_paiement', l: 'Délai de paiement' },
    { cle: 'reception', l: 'Réception' },
    { cle: 'assurances', l: 'Assurances' }
  ];
  var VERDICTS = {
    DEFAVORABLE: { l: 'Défavorable', c: 'bad' },
    HABITUEL: { l: 'Habituel', c: 'ok' },
    A_SURVEILLER: { l: 'À surveiller', c: 'neg' },
    A_DEMANDER: { l: 'À demander', c: 'neg' }
  };
  var DOSSIERS = [
    { cle: 'ADMINISTRATIF', l: 'Dossier administratif' },
    { cle: 'TECHNIQUE', l: 'Dossier technique' },
    { cle: 'ADDITIF', l: 'Dossier additif' },
    { cle: 'OFFRE_TECHNIQUE', l: 'Offre technique' },
    { cle: 'FINANCIER', l: 'Offre financière' }
  ];
  var AVIS = {
    ON_Y_VA: 'On y va',
    ON_N_Y_VA_PAS: "On n'y va pas",
    A_DISCUTER: 'À discuter'
  };
  var COFFRE_TYPES = [
    { cle: 'attestation_fiscale', l: 'Attestation fiscale' },
    { cle: 'cnss', l: 'Attestation CNSS' },
    { cle: 'registre_commerce', l: 'Registre de commerce (modèle 7)' },
    { cle: 'statuts', l: 'Statuts' },
    { cle: 'pouvoirs', l: 'Pouvoirs du signataire' },
    { cle: 'qualification', l: 'Qualification et classification' },
    { cle: 'certificat', l: 'Certificat (ISO, agrément…)' },
    { cle: 'attestation_reference', l: 'Attestation de bonne exécution (par marché)' },
    { cle: 'rib', l: 'RIB' },
    { cle: 'autre', l: 'Autre document' }
  ];
  function libelleDe(liste, cle) {
    for (var i = 0; i < liste.length; i++) if (liste[i].cle === cle) return liste[i].l;
    return cle ? String(cle) : 'non renseigné';
  }

  /* ---------- Texte ---------- */
  var ACC = { 'à': 'a', 'â': 'a', 'ä': 'a', 'á': 'a', 'ç': 'c', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'î': 'i', 'ï': 'i', 'í': 'i', 'ô': 'o', 'ö': 'o', 'ó': 'o', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ú': 'u',
    'œ': 'oe', 'æ': 'ae', '’': "'", '‘': "'" };
  function sansAccents(s) {
    s = String(s == null ? '' : s).toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); out += (ACC[ch] !== undefined ? ACC[ch] : ch); }
    return out;
  }
  var VIDES = { de: 1, du: 1, des: 1, la: 1, le: 1, les: 1, et: 1, en: 1, au: 1, aux: 1, pour: 1, par: 1,
    sur: 1, compris: 1, yc: 1, un: 1, une: 1, ou: 1, avec: 1, dans: 1, fourniture: 1, pose: 1, fourni: 1, pose_: 1 };
  function mots(s) {
    var t = sansAccents(s).replace(/[^a-z0-9]+/g, ' ').split(' ');
    var r = [];
    for (var i = 0; i < t.length; i++) if (t[i] && t[i].length > 1 && !VIDES[t[i]]) r.push(t[i]);
    return r;
  }
  /* Indice de Jaccard sur les mots significatifs (0 à 1). */
  function similarite(a, b) {
    var ma = mots(a), mb = mots(b);
    if (!ma.length || !mb.length) return 0;
    var setB = {}, nb = 0, i;
    for (i = 0; i < mb.length; i++) if (!setB[mb[i]]) { setB[mb[i]] = 1; nb++; }
    var setA = {}, inter = 0, na = 0;
    for (i = 0; i < ma.length; i++) { if (setA[ma[i]]) continue; setA[ma[i]] = 1; na++; if (setB[ma[i]]) inter++; }
    return inter / (na + nb - inter);
  }

  /* ---------- Classement des fichiers du DCE ---------- */
  /* Renvoie { classe, motif }. Un fichier écarté porte TOUJOURS son motif (doctrine §7). */
  function classerFichier(chemin) {
    var nom = String(chemin || '').split('/').pop();
    var n = sansAccents(nom);
    if (!nom) return { classe: 'ignore', motif: 'dossier (pas un fichier)' };
    if (/^~\$/.test(nom)) return { classe: 'ignore', motif: 'fichier temporaire de Word ou Excel (~$)' };
    if (/\.tmp$/i.test(nom)) return { classe: 'ignore', motif: 'fichier temporaire (.tmp)' };
    if (/^\._/.test(nom) || n === '.ds_store' || n === 'thumbs.db') return { classe: 'ignore', motif: 'fichier système' };
    var ext = (n.match(/\.([a-z0-9]+)$/) || [])[1] || '';
    var LISIBLES = { pdf: 1, docx: 1, doc: 1, xlsx: 1, xls: 1, xlsm: 1, txt: 1 };
    var PLANS = { dwg: 1, dxf: 1, jpg: 1, jpeg: 1, png: 1, tif: 1, tiff: 1, bmp: 1 };
    var base = n.replace(/\.[a-z0-9]+$/, '');
    if (ext === 'zip') return { classe: 'archive', motif: 'archive à déplier' };
    if (ext === 'rar' || ext === '7z') return { classe: 'ignore', motif: 'archive .' + ext + ' non lue : à déplier à la main' };
    if (PLANS[ext] || /(^|[^a-z])plans?([^a-z]|$)/.test(base)) return { classe: 'plans', motif: 'plan ou image : non étudié' };
    if (!LISIBLES[ext]) return { classe: 'ignore', motif: 'format .' + (ext || 'sans extension') + ' non lu' };
    var marques = /(^|[^a-z])bpa([^a-z]|$)|marques?/.test(base);
    if (/(^|[^a-z])(bpde|bpu|dqe|bp|brd|bordereau|devis estimatif)([^a-z]|$)|details? estimatif/.test(base) && !marques) {
      return { classe: 'bordereau', motif: 'nom du fichier : bordereau des prix' };
    }
    if (marques) return { classe: 'autres', motif: 'bordereau des marques ou références' };
    if (/(^|[^a-z])(rc|reglement)([^a-z]|$)|reglement de (la )?consultation/.test(base)) return { classe: 'rc', motif: 'nom du fichier : règlement de consultation' };
    if (/(^|[^a-z])(cps|cpt|cctp|ccap)([^a-z]|$)|cahier des prescriptions/.test(base)) return { classe: 'cps', motif: 'nom du fichier : cahier des prescriptions spéciales' };
    if (/(^|[^a-z])avis([^a-z]|$)/.test(base)) {
      if (/(^|[^a-z])ar([^a-z]|$)|arabe/.test(base)) return { classe: 'autres', motif: 'avis en arabe (la version française est étudiée)' };
      return { classe: 'avis', motif: "nom du fichier : avis d'appel d'offres" };
    }
    if (/acte.{0,3}(d.)?engagement|(^|[^a-z])ae([^a-z]|$)/.test(base)) return { classe: 'modele', motif: "modèle d'acte d'engagement fourni par le maître d'ouvrage" };
    if (/declaration.{0,5}(sur )?l?.?honneur|(^|[^a-z])dh([^a-z]|$)/.test(base)) return { classe: 'modele', motif: "modèle de déclaration sur l'honneur fourni par le maître d'ouvrage" };
    return { classe: 'autres', motif: 'aucun motif de classement reconnu dans le nom' };
  }
  var LIBELLES_CLASSES = { avis: 'Avis', rc: 'RC', cps: 'CPS', bordereau: 'Bordereau des prix', plans: 'Plans',
    modele: "Modèle du maître d'ouvrage", autres: 'Autre document', archive: 'Archive', ignore: 'Écarté' };

  /* ---------- Lecture de la réponse (lignes + citations) ---------- */
  /* Page d'un caractère dans un document texte envoyé avec ses repères « === Page N === ». */
  function pageDe(docMeta, charIndex) {
    var pages = (docMeta && docMeta.pages) || [];
    var p = null;
    for (var i = 0; i < pages.length; i++) { if (pages[i].debut <= charIndex) p = pages[i].num; else break; }
    return p;
  }
  function contexteDe(texte, debut, fin, marge) {
    texte = String(texte || ''); marge = marge || 260;
    var a = Math.max(0, debut - marge), b = Math.min(texte.length, fin + marge);
    while (a > 0 && /\S/.test(texte.charAt(a - 1)) && debut - a < marge + 40) a--;
    while (b < texte.length && /\S/.test(texte.charAt(b)) && b - fin < marge + 40) b++;
    return { avant: texte.slice(a, debut), cite: texte.slice(debut, fin), apres: texte.slice(fin, b) };
  }
  function nettoyerRepere(s) { return String(s || '').replace(/=== Page \d+ ===/g, ' '); }
  /* Une citation de l'API → source affichable. docs[i] = { titre, fichier, classe, pages:[{num,debut}], texte? }. */
  function sourceDeCitation(c, docs) {
    if (!c || typeof c.cited_text !== 'string' || !c.cited_text.replace(/\s/g, '')) return null;
    var d = docs && docs[c.document_index];
    if (!d) return null;
    var page = null, debut = null, fin = null;
    if (c.type === 'char_location') { debut = c.start_char_index; fin = c.end_char_index; page = pageDe(d, debut); }
    else if (c.type === 'page_location') { page = c.start_page_number; }
    var s = { fichier: d.fichier || d.titre, classe: d.classe || 'autres', page: page, extrait: nettoyerRepere(c.cited_text).replace(/^\s+|\s+$/g, '') };
    if (debut != null && d.texte) {
      var cx = contexteDe(d.texte, debut, fin);
      s.avant = nettoyerRepere(cx.avant); s.apres = nettoyerRepere(cx.apres);
    }
    return s;
  }
  /* blocks = content de la réponse (text + citations). Renvoie [{ type, champs[], sources[] }]. */
  function lireLignes(blocks, docs) {
    var texte = '', spans = [], i;
    for (i = 0; i < (blocks || []).length; i++) {
      var b = blocks[i];
      if (!b || b.type !== 'text') continue;
      var deb = texte.length; texte += String(b.text || '');
      if (b.citations && b.citations.length) spans.push({ debut: deb, fin: texte.length, citations: b.citations });
    }
    var lignes = [], pos = 0, morceaux = texte.split('\n');
    for (var j = 0; j < morceaux.length; j++) {
      var brut = morceaux[j], d0 = pos, f0 = pos + brut.length; pos = f0 + 1;
      var m = brut.match(/^\s*[-*•]?\s*\**([A-Z_]{3,20})\**\s*:\s*(.*)$/);
      if (!m) {
        /* Une ligne sans étiquette qui suit une ligne étiquetée la prolonge (citations comprises). */
        if (lignes.length && brut.replace(/\s/g, '')) { lignes[lignes.length - 1]._fin = f0; lignes[lignes.length - 1]._suite += ' ' + brut; }
        continue;
      }
      lignes.push({ type: m[1], _brut: m[2], _suite: '', _debut: d0, _fin: f0 });
    }
    for (i = 0; i < lignes.length; i++) {
      var L = lignes[i], sources = [], vus = {};
      for (var k = 0; k < spans.length; k++) {
        var sp = spans[k];
        if (sp.fin <= L._debut || sp.debut >= L._fin) continue;
        for (var q = 0; q < sp.citations.length; q++) {
          var s = sourceDeCitation(sp.citations[q], docs);
          if (!s) continue;
          var cle = s.fichier + '|' + s.page + '|' + s.extrait;
          if (vus[cle]) continue; vus[cle] = 1; sources.push(s);
        }
      }
      var champs = (L._brut + L._suite).split('|');
      for (var z = 0; z < champs.length; z++) champs[z] = champs[z].replace(/^\s+|\s+$/g, '');
      lignes[i] = { type: L.type, champs: champs, sources: sources };
    }
    return lignes;
  }
  function estAbsent(v) { return /^absent/i.test(String(v || '').replace(/^\s+/, '')); }
  function vide(v) { return !v || /^[-–—]?$/.test(String(v).replace(/\s/g, '')); }
  function sourceItem(valeur, article, sources) {
    return { valeur: valeur, article: vide(article) ? null : article, sources: sources || [] };
  }
  function cleVerdict(v) {
    var s = sansAccents(v).toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, '');
    return VERDICTS[s] ? s : null;
  }
  /* Assemble le résultat structuré de l'étude à partir des lignes lues. */
  function construireResultat(lignes, opts) {
    opts = opts || {};
    var r = { avis: null, conditions: [], raisons: [], faits: {}, clauses: [], pieces: [], questions: [],
      articles: [], conformite: [], memoire: [], sous_detail: [], ignorees: [] };
    var chap = null;
    for (var i = 0; i < (lignes || []).length; i++) {
      var L = lignes[i], c = L.champs;
      switch (L.type) {
        case 'AVIS': {
          var d = String(c[0] || '').toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, '');
          r.avis = { decision: AVIS[d] ? d : 'A_DISCUTER', resume: c[1] || '', sources: L.sources };
          break;
        }
        case 'CONDITION': r.conditions.push(sourceItem(c[0], c[1], L.sources)); break;
        case 'RAISON': r.raisons.push(sourceItem(c[0], c[1], L.sources)); break;
        case 'FAIT': if (c[0]) r.faits[c[0]] = sourceItem(c[1], c[2], L.sources); break;
        case 'CLAUSE': {
          var v = cleVerdict(c[2]);
          r.clauses.push({ cle: c[0], valeur: c[1], absent: estAbsent(c[1]), verdict: v || 'A_SURVEILLER',
            article: vide(c[3]) ? null : c[3], pourquoi: c[4] || '', sources: L.sources });
          break;
        }
        case 'PIECE': r.pieces.push({ dossier: String(c[0] || '').toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, ''), piece: c[1], article: vide(c[2]) ? null : c[2], precision: c[3] || '', sources: L.sources }); break;
        case 'QUESTION': r.questions.push({ question: c[0], motif: c[1] || '', article: vide(c[2]) ? null : c[2], sources: L.sources }); break;
        case 'ARTICLE': r.articles.push({ num: c[0], designation: c[1], unite: c[2], quantite: nombre(c[3]), sources: L.sources }); break;
        case 'CONF': r.conformite.push({ num: c[0], exigence: c[1], reponse: 'Conforme', fourniture: /option/i.test(c[3] || '') ? 'option' : 'standard', article: vide(c[4]) ? null : c[4], sources: L.sources }); break;
        case 'SOUSDETAIL': r.sous_detail.push({ num: c[0], motif: c[1] || '', sources: L.sources }); break;
        case 'CHAPITRE': chap = { num: c[0], titre: c[1] || '', paragraphes: [] }; r.memoire.push(chap); break;
        case 'PARA': if (chap) chap.paragraphes.push({ texte: c.join(' | '), sources: L.sources }); break;
        default: r.ignorees.push(L.type);
      }
    }
    /* Clause attendue jamais mentionnée : signalée comme absente (et à vérifier). */
    if (opts.clauses !== false) {
      for (var k = 0; k < CLAUSES.length; k++) {
        var trouve = false;
        for (var q = 0; q < r.clauses.length; q++) if (r.clauses[q].cle === CLAUSES[k].cle) trouve = true;
        if (!trouve) r.clauses.push({ cle: CLAUSES[k].cle, valeur: 'Absent', absent: true, verdict: 'A_DEMANDER', article: null,
          pourquoi: "L'analyse n'a relevé aucune clause sur ce point.", sources: [] });
      }
    }
    return r;
  }

  /* ---------- Règle d'affichage : une source, ou « à vérifier » ---------- */
  /* Vrai seulement si au moins une citation porte un extrait exact. */
  function aSource(item) { return !!(item && item.sources && item.sources.length && item.sources[0].extrait); }
  function etatSource(item) {
    if (aSource(item)) {
      var s = item.sources[0];
      var ou = s.feuille ? ('feuille ' + s.feuille + ', ligne ' + s.ligne) : (s.page ? 'p. ' + s.page : '');
      var lib = (item.article ? item.article : (LIBELLES_CLASSES[s.classe] || s.fichier)) + (ou ? ', ' + ou : '');
      return { etat: 'source', libelle: lib };
    }
    if (item && item.absent) return { etat: 'a_verifier', libelle: 'Absent du dossier : ' + A_VERIFIER, motif: 'aucun article trouvé dans le dossier' };
    return { etat: 'a_verifier', libelle: A_VERIFIER + (item && item.article ? ' : ' + item.article : ''), motif: "aucune citation exacte renvoyée par l'analyse" };
  }

  /* ---------- Dates et montants ---------- */
  function nombre(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).replace(/[\s  ]/g, '').replace(/(dhs|dh|mad|ttc|ht)\.?$/i, '');
    if (!s || !/\d/.test(s)) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else s = s.replace(/,/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function pad(n) { n = String(parseInt(n, 10)); return n.length < 2 ? '0' + n : n; }
  /* Accepte JJ/MM/AAAA, AAAA-MM-JJ, et « 13 novembre 2026 ». Renvoie AAAA-MM-JJ ou null. */
  var MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  function dateISO(v) {
    if (!v) return null;
    var s = sansAccents(String(v)).replace(/^\s+|\s+$/g, '');
    var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
    if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    m = s.match(/(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})/);
    if (m && MOIS[m[2]]) return m[3] + '-' + pad(MOIS[m[2]]) + '-' + pad(m[1]);
    return null;
  }
  function heureHM(v) {
    var m = String(v || '').match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i);
    return m ? pad(m[1]) + ':' + (m[2] || '00') : null;
  }
  function dateFR(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : 'non renseignée'; }
  function ajouterJours(iso, j) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + j * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  /* Date limite des éclaircissements : TOUJOURS calculée, donc TOUJOURS « à vérifier ». */
  function dateEclaircissements(dateLimite, texteDelai) {
    var iso = dateISO(dateLimite);
    var m = String(texteDelai || '').match(/(\d{1,2})\s*(?:\(\s*\d+\s*\)\s*)?jours?/i);
    if (!m) { var m2 = sansAccents(texteDelai).match(/(sept|dix|quinze|cinq|trois|vingt)\s*(?:\(\s*\d+\s*\)\s*)?jours?/); if (m2) m = [m2[0], { sept: 7, dix: 10, quinze: 15, cinq: 5, trois: 3, vingt: 20 }[m2[1]]]; }
    if (!iso || !m) return { date: null, a_verifier: true, motif: !iso ? 'date limite de dépôt inconnue' : 'délai des éclaircissements non lu' };
    var j = parseInt(m[1], 10);
    return { date: ajouterJours(iso, -j), jours: j, a_verifier: true, motif: 'date calculée : ' + dateFR(iso) + ' moins ' + j + ' jours, à confirmer sur le portail' };
  }
  function montantFR(n) {
    if (n == null || !isFinite(n)) return 'non renseigné';
    var neg = n < 0; n = Math.abs(Math.round(n * 100) / 100);
    var ent = Math.floor(n), dec = Math.round((n - ent) * 100);
    var s = String(ent), o = '';
    while (s.length > 3) { o = ' ' + s.slice(-3) + o; s = s.slice(0, -3); }
    return (neg ? '−' : '') + s + o + ',' + (dec < 10 ? '0' : '') + dec;
  }
  /* Écarts dossier ↔ fiche AO (date et heure limite, estimation). Tout écart sort en rouge. */
  function ecartsFiche(faits, fiche) {
    faits = faits || {}; fiche = fiche || {};
    var out = [];
    var dDos = faits.date_limite ? dateISO(faits.date_limite.valeur) : null;
    var dFic = dateISO(fiche.date_limite);
    out.push({ champ: 'date_limite', libelle: 'Date limite de dépôt', dossier: dDos ? dateFR(dDos) : 'non lue dans le dossier',
      fiche: dFic ? dateFR(dFic) : 'non renseignée sur la fiche', ecart: !!(dDos && dFic && dDos !== dFic), incomplet: !(dDos && dFic) });
    var hDos = faits.heure_limite ? heureHM(faits.heure_limite.valeur) : null;
    if (!hDos && faits.date_limite) hDos = heureHM(String(faits.date_limite.valeur).replace(/^.*?\d{4}/, ''));
    var hFic = heureHM(fiche.heure_limite);
    out.push({ champ: 'heure_limite', libelle: 'Heure limite de dépôt', dossier: hDos || 'non lue dans le dossier',
      fiche: hFic || 'non renseignée sur la fiche', ecart: !!(hDos && hFic && hDos !== hFic), incomplet: !(hDos && hFic) });
    var eDos = faits.estimation ? nombre(String(faits.estimation.valeur).replace(/[^\d,.\s]/g, ' ').replace(/^\s+|\s+$/g, '').split(/\s{2,}/)[0]) : null;
    var eFic = fiche.estimation != null && fiche.estimation !== '' ? nombre(fiche.estimation) : null;
    out.push({ champ: 'estimation', libelle: "Estimation du maître d'ouvrage", dossier: eDos != null ? montantFR(eDos) + ' DH' : 'non lue dans le dossier',
      fiche: eFic != null ? montantFR(eFic) + ' DH' : 'non renseignée sur la fiche', ecart: !!(eDos != null && eFic != null && Math.abs(eDos - eFic) > 1), incomplet: !(eDos != null && eFic != null) });
    return out;
  }

  /* ---------- Montant en lettres (acte d'engagement) ---------- */
  var U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
  var DIZ = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };
  function moinsDeCent(n) {
    if (n <= 16) return U[n];
    if (n < 20) return 'dix-' + U[n - 10];
    var d = Math.floor(n / 10), u = n % 10;
    if (d === 7) return 'soixante' + (n === 71 ? ' et ' : '-') + moinsDeCent(n - 60);
    if (d === 9) return 'quatre-vingt-' + moinsDeCent(n - 80);
    if (d === 8) return 'quatre-vingt' + (u ? '-' + U[u] : 's');
    return DIZ[d] + (u === 1 ? ' et un' : (u ? '-' + U[u] : ''));
  }
  function moinsDeMille(n, final) {
    var c = Math.floor(n / 100), r = n % 100, s = '';
    if (c) s = (c > 1 ? U[c] + ' cent' + (r || !final ? '' : 's') : 'cent');
    if (r) s += (s ? ' ' : '') + moinsDeCent(r);
    if (!final) s = s.replace(/quatre-vingts$/, 'quatre-vingt');
    return s || 'zéro';
  }
  function entierEnLettres(n) {
    if (n === 0) return 'zéro';
    var parts = [], ECH = [[1e9, 'milliard'], [1e6, 'million'], [1e3, 'mille']];
    for (var i = 0; i < ECH.length; i++) {
      var q = Math.floor(n / ECH[i][0]);
      if (q) {
        if (ECH[i][1] === 'mille') parts.push(q === 1 ? 'mille' : moinsDeMille(q, false) + ' mille');
        else parts.push(moinsDeMille(q, true) + ' ' + ECH[i][1] + (q > 1 ? 's' : ''));
        n -= q * ECH[i][0];
      }
    }
    if (n) parts.push(moinsDeMille(n, true));
    return parts.join(' ');
  }
  function montantEnLettres(montant) {
    var n = Math.round(Number(montant) * 100);
    if (!isFinite(n) || n < 0) return 'montant non renseigné';
    var ent = Math.floor(n / 100), cts = n % 100;
    var s = entierEnLettres(ent) + (ent >= 1e6 && ent % 1e6 === 0 ? ' de' : '') + ' dirham' + (ent > 1 ? 's' : '');
    if (cts) s += ' et ' + entierEnLettres(cts) + ' centime' + (cts > 1 ? 's' : '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------- Coffre des documents de la société ---------- */
  function versionCourante(doc) {
    var v = (doc && doc.versions) || [];
    return v.length ? v[v.length - 1] : null;
  }
  /* État d'une pièce du coffre à la date de dépôt. 'expire' et 'expire_avant_depot' sortent en rouge. */
  function etatPieceCoffre(doc, dateDepot, aujourdhui) {
    var v = versionCourante(doc);
    if (!v) return { etat: 'absent', rouge: true, libelle: 'Absente du coffre' };
    var val = dateISO(v.date_validite), dep = dateISO(dateDepot), auj = dateISO(aujourdhui);
    if (!val) return { etat: 'sans_validite', rouge: false, libelle: 'Sans date de fin de validité saisie' };
    if (auj && val < auj) return { etat: 'expire', rouge: true, libelle: 'Expirée le ' + dateFR(val) };
    if (dep && val < dep) return { etat: 'expire_avant_depot', rouge: true, libelle: 'Expire le ' + dateFR(val) + ', avant le dépôt du ' + dateFR(dep) };
    return { etat: 'valide', rouge: false, libelle: "Valide jusqu'au " + dateFR(val) };
  }
  /* Documents qui expirent dans les N jours (ou déjà expirés) : rubrique « à traiter » et e-mail. */
  function alertesCoffre(docs, aujourdhui, jours) {
    jours = jours == null ? 15 : jours;
    var auj = dateISO(aujourdhui), lim = ajouterJours(auj, jours), out = [];
    for (var i = 0; i < (docs || []).length; i++) {
      var d = docs[i], v = versionCourante(d);
      if (!v || d.archive) continue;
      var val = dateISO(v.date_validite);
      if (!val || val > lim) continue;
      out.push({ id: d.id, type: d.type, libelle: d.libelle || libelleDe(COFFRE_TYPES, d.type), validite: val,
        expire: val < auj, texte: (val < auj ? 'Expiré le ' : 'Expire le ') + dateFR(val), version: v.v });
    }
    out.sort(function (a, b) { return a.validite < b.validite ? -1 : (a.validite > b.validite ? 1 : 0); });
    return out;
  }

  /* ---------- Dossier de réponse : origine de chaque pièce du RC ---------- */
  /* origine : redige (MP rédige un brouillon) | coffre (MP joint) | propose (un humain valide) | signale (MP ne peut pas). */
  var REGLES_PIECES = [
    { re: /recepisse|caution(nement)? provisoire|cautionnement/, origine: 'signale', type: 'caution_provisoire', motif: 'Récépissé délivré par la banque : la lettre de demande est rédigée, la caution est suivie dans Cautions.' },
    { re: /declaration.{0,6}honneur/, origine: 'redige', type: 'declaration_honneur' },
    { re: /acte.{0,4}engagement/, origine: 'redige', type: 'acte_engagement' },
    { re: /sous.?detail/, origine: 'redige', type: 'sous_detail' },
    { re: /bordereau.{0,12}(prix|detail)|detail estimatif|bpde|bpu|dqe/, origine: 'redige', type: 'bordereau_prix' },
    { re: /reference|bonne execution|attestations? de (realisation|reference)|similaires?/, origine: 'propose', type: 'references' },
    { re: /moyens? humains?|personnel|encadrement|organigramme|\bcv\b|curriculum/, origine: 'propose', type: 'moyens_humains' },
    { re: /moyens? materiels?|materiel|outillage|engins?/, origine: 'redige', type: 'moyens_materiels' },
    { re: /planning|calendrier|programme (previsionnel )?d.?execution/, origine: 'redige', type: 'planning' },
    { re: /note methodologique|memoire|methodologie|note technique|offre technique/, origine: 'redige', type: 'memoire' },
    { re: /conformite|fiches? techniques?|documentation technique|prospectus|catalogue/, origine: 'redige', type: 'conformite' },
    { re: /marques?/, origine: 'redige', type: 'bordereau_references' },
    { re: /attestation fiscale|situation fiscale|impots|\bdgi\b/, origine: 'coffre', type: 'attestation_fiscale' },
    { re: /cnss|securite sociale/, origine: 'coffre', type: 'cnss' },
    { re: /registre (de|du) commerce|modele 7|immatriculation/, origine: 'coffre', type: 'registre_commerce' },
    { re: /pouvoirs?|procuration|habilitation/, origine: 'coffre', type: 'pouvoirs' },
    { re: /statuts?/, origine: 'coffre', type: 'statuts' },
    { re: /qualification|classification|agrement/, origine: 'coffre', type: 'qualification' },
    { re: /certificat|\biso\b/, origine: 'coffre', type: 'certificat' },
    { re: /\brib\b|identite bancaire/, origine: 'coffre', type: 'rib' },
    { re: /paraphe|signe|\bcps\b|cahier des prescriptions|reglement de (la )?consultation/, origine: 'signale', type: 'signature', motif: 'Paraphe et signature : seul le signataire habilité peut les apposer.' }
  ];
  function originePiece(libelle) {
    var n = sansAccents(libelle);
    for (var i = 0; i < REGLES_PIECES.length; i++) {
      if (REGLES_PIECES[i].re.test(n)) return { origine: REGLES_PIECES[i].origine, type: REGLES_PIECES[i].type, motif: REGLES_PIECES[i].motif || null };
    }
    return { origine: 'signale', type: 'autre', motif: 'Pièce non reconnue par MP : à préparer à la main.' };
  }
  var ETATS_LIGNE = {
    redige: { l: 'Rédigé', c: 'ok', groupe: 'pretes' },
    jointe: { l: 'Jointe', c: 'ok', groupe: 'pretes' },
    valide: { l: 'Validé', c: 'ok', groupe: 'pretes' },
    a_valider: { l: 'À valider', c: 'neg', groupe: 'a_completer' },
    a_completer: { l: 'À compléter', c: 'neg', groupe: 'a_completer' },
    a_signer: { l: 'À signer', c: 'neg', groupe: 'a_completer' },
    demande_prete: { l: 'Demande prête', c: 'neg', groupe: 'a_completer' },
    expiree: { l: 'Expirée', c: 'bad', groupe: 'manquantes' },
    a_obtenir: { l: 'À obtenir', c: 'bad', groupe: 'manquantes' }
  };
  /* Une ligne du dossier : pièce du RC → origine + état. ctx.coffre = docs du coffre ; ctx.validations = choix humains. */
  function ligneDossier(piece, ctx) {
    ctx = ctx || {};
    var o = originePiece(piece.piece);
    var L = { dossier: piece.dossier, piece: piece.piece, article: piece.article, precision: piece.precision || '', sources: piece.sources || [], origine: o.origine, type: o.type };
    if (o.origine === 'coffre') {
      var doc = null, cs = ctx.coffre || [];
      for (var i = 0; i < cs.length; i++) if (cs[i].type === o.type && !cs[i].archive) doc = cs[i];
      var e = etatPieceCoffre(doc, ctx.dateDepot, ctx.aujourdhui);
      L.coffreId = doc ? doc.id : null; L.detail = (doc ? 'Coffre des documents : ' : '') + e.libelle;
      L.etat = e.etat === 'absent' ? 'a_obtenir' : (e.rouge ? 'expiree' : 'jointe');
      if (e.rouge) L.action = e.etat === 'absent' ? 'Déposer dans le coffre' : 'Demander la nouvelle';
    } else if (o.origine === 'propose') {
      var val = (ctx.validations || {})[o.type];
      L.etat = val ? 'valide' : 'a_valider';
      L.detail = o.type === 'references' ? 'Marchés les plus proches proposés depuis MP, attestations du coffre' : 'Personnel proposé depuis RH : choisir les noms';
      if (val) L.detail = 'Choix validé par ' + (val.par || 'un utilisateur') + ' le ' + dateFR(val.le);
    } else if (o.origine === 'redige') {
      L.etat = (o.type === 'conformite') ? 'a_completer' : 'redige';
      L.detail = o.type === 'conformite' ? 'Une ligne par article, « Conforme » partout ; fiches techniques à rattacher' : 'Brouillon généré par MP, à relire';
    } else {
      L.etat = o.type === 'caution_provisoire' ? 'demande_prete' : (o.type === 'signature' ? 'a_signer' : 'a_obtenir');
      L.detail = o.motif;
    }
    return L;
  }
  function compteursDossier(lignes) {
    var c = { exigees: 0, pretes: 0, a_completer: 0, manquantes: 0 };
    for (var i = 0; i < (lignes || []).length; i++) {
      c.exigees++;
      var g = (ETATS_LIGNE[lignes[i].etat] || {}).groupe || 'manquantes';
      c[g]++;
    }
    return c;
  }

  /* ---------- Bordereau ---------- */
  /* Lit les feuilles d'un tableur (lignes = tableaux de cellules) → articles sourcés, feuilles exclues avec motif. */
  function lireBordereauFeuilles(fichier, feuilles) {
    var res = { articles: [], feuilles: [], exclues: [] };
    for (var f = 0; f < (feuilles || []).length; f++) {
      var F = feuilles[f], nom = String(F.nom || ''), n = sansAccents(nom);
      if (/metre|quantitatif/.test(n)) { res.exclues.push({ feuille: nom, motif: 'feuille de métré (quantités de détail)' }); continue; }
      var rows = F.lignes || [], ent = -1, col = null;
      for (var r = 0; r < Math.min(rows.length, 40) && ent < 0; r++) {
        var c = { num: -1, des: -1, u: -1, q: -1 };
        for (var k = 0; k < (rows[r] || []).length; k++) {
          var t = sansAccents(rows[r][k]).replace(/^\s+/, '');
          if (c.num < 0 && /^(n\s*[°o]|n\.|numero|art|prix n)/.test(t)) c.num = k;
          else if (c.des < 0 && /designation|libelle|nature des/.test(t)) c.des = k;
          else if (c.u < 0 && /^unit/.test(t)) c.u = k;
          else if (c.q < 0 && /quantit|^qte/.test(t)) c.q = k;
        }
        if (c.des >= 0 && c.q >= 0) { ent = r; col = c; }
      }
      if (ent < 0) { res.exclues.push({ feuille: nom, motif: 'aucun en-tête Désignation / Quantité reconnu' }); continue; }
      var arts = [], section = null;
      for (var r2 = ent + 1; r2 < rows.length; r2++) {
        var row = rows[r2] || [];
        var des = String(row[col.des] == null ? '' : row[col.des]).replace(/^\s+|\s+$/g, '');
        var q = nombre(row[col.q]);
        var num = col.num >= 0 ? String(row[col.num] == null ? '' : row[col.num]).replace(/^\s+|\s+$/g, '') : '';
        var nd = sansAccents(des);
        if (/^(total|t\.?v\.?a|montant|arrete|sous.?total)/.test(nd)) continue;
        if (des && q == null) { section = des; continue; }
        if (!des || q == null) continue;
        arts.push({ num: num || String(arts.length + 1), designation: des, unite: col.u >= 0 ? String(row[col.u] == null ? '' : row[col.u]).replace(/^\s+|\s+$/g, '') : '',
          quantite: q, section: section, feuille: nom, sources: [{ fichier: fichier, classe: 'bordereau', feuille: nom, ligne: r2 + 1, page: null,
            extrait: [num, des, col.u >= 0 ? row[col.u] : '', row[col.q]].join(' | ') }] });
      }
      if (!arts.length) { res.exclues.push({ feuille: nom, motif: 'en-tête trouvé mais aucun article avec quantité' }); continue; }
      res.feuilles.push({ feuille: nom, articles: arts.length });
      for (var a = 0; a < arts.length; a++) res.articles.push(arts[a]);
    }
    return res;
  }
  /* Choix des feuilles quand un tableur en porte plusieurs : une feuille nommée BPDE/détail estimatif
     écarte une feuille « BP » d'un autre projet. Les écartées portent leur motif. */
  function choisirFeuilles(lecture) {
    var fs = lecture.feuilles, nommees = [];
    for (var i = 0; i < fs.length; i++) if (/bpde|detail|dqe|estimatif/.test(sansAccents(fs[i].feuille))) nommees.push(fs[i].feuille);
    if (!nommees.length) return lecture;
    var garde = {}, out = { articles: [], feuilles: [], exclues: lecture.exclues.slice() };
    for (var j = 0; j < nommees.length; j++) garde[nommees[j]] = 1;
    for (var k = 0; k < fs.length; k++) {
      if (garde[fs[k].feuille]) out.feuilles.push(fs[k]);
      else out.exclues.push({ feuille: fs[k].feuille, motif: 'feuille non nommée « BPDE / détail estimatif » alors qu\'une autre l\'est' });
    }
    for (var a = 0; a < lecture.articles.length; a++) if (garde[lecture.articles[a].feuille]) out.articles.push(lecture.articles[a]);
    return out;
  }
  /* Cherche un PA connu : catalogue = [{ designation, pa, origine, ref }]. Seuil de similarité 0,5. */
  function chercherPA(designation, catalogue, seuil) {
    seuil = seuil == null ? 0.5 : seuil;
    var best = null, bs = 0;
    for (var i = 0; i < (catalogue || []).length; i++) {
      var c = catalogue[i]; if (!(c.pa > 0)) continue;
      var s = similarite(designation, c.designation);
      if (s > bs) { bs = s; best = c; }
    }
    if (!best || bs < seuil) return null;
    return { pa: best.pa, origine: best.origine, ref: best.ref || null, designation: best.designation, score: Math.round(bs * 100) / 100 };
  }
  function prixVente(pa, marge) { return (pa == null || !isFinite(pa)) ? null : Math.round(pa * (1 + (marge == null ? 0.3 : marge)) * 100) / 100; }
  function totauxBordereau(articles, estimationTTC, tva) {
    tva = tva == null ? 0.2 : tva;
    var ht = 0, sansPA = 0;
    for (var i = 0; i < (articles || []).length; i++) {
      var a = articles[i], pu = prixVente(a.pa, a.marge);
      if (pu == null) { sansPA++; continue; }
      ht += pu * a.quantite;
    }
    ht = Math.round(ht * 100) / 100;
    var ttc = Math.round(ht * (1 + tva) * 100) / 100;
    var est = nombre(estimationTTC);
    return { ht: ht, tva: Math.round(ht * tva * 100) / 100, ttc: ttc, estimation: est, sans_pa: sansPA, articles: (articles || []).length,
      ecart: (est ? Math.round((ttc - est) / est * 10000) / 100 : null) };
  }

  /* ---------- Pré-étude automatique, plafonds de coût ---------- */
  function eligiblePreEtude(veille, params, dejaEtudie) {
    params = params || {};
    var seuil = params.seuil_pre_etude == null ? 50 : params.seuil_pre_etude;
    if (!veille) return { ok: false, motif: 'AO inconnu' };
    if (params.pre_etude_active === false) return { ok: false, motif: 'pré-étude automatique désactivée' };
    if (veille.dce_status !== 'ready' || !veille.dce_blob_name) return { ok: false, motif: 'DCE non téléchargé' };
    if (veille.statut === 'no_go') return { ok: false, motif: 'AO classé « no go »' };
    if (!(Number(veille.score) >= seuil)) return { ok: false, motif: 'score ' + (veille.score == null ? 'inconnu' : veille.score) + ' sous le seuil ' + seuil };
    if (dejaEtudie) return { ok: false, motif: 'déjà étudié sur ce DCE' };
    return { ok: true, motif: 'score ' + veille.score + ' au-dessus du seuil ' + seuil };
  }
  /* Tarifs USD par million de jetons (docs.claude.com, relus le 01/11/2026) ; traitement par lot = moitié prix. */
  var TARIFS = {
    'claude-opus-5-5': { entree: 4, sortie: 20, lecture_cache: 0.2, ecriture_cache_5m: 5, ecriture_cache_1h: 8 },
    'claude-sonnet-5-5': { entree: 2, sortie: 10, lecture_cache: 0.1, ecriture_cache_5m: 2.5, ecriture_cache_1h: 4 },
    'claude-fable-5-1': { entree: 10, sortie: 50, lecture_cache: 0.25, ecriture_cache_5m: 12.5, ecriture_cache_1h: 20 }
  };
  function coutUsd(usage, modele, lot) {
    var t = TARIFS[modele]; if (!t || !usage) return null;
    var cw = usage.cache_creation || {};
    var w1h = cw.ephemeral_1h_input_tokens || 0;
    var w5m = cw.ephemeral_5m_input_tokens != null ? cw.ephemeral_5m_input_tokens : Math.max(0, (usage.cache_creation_input_tokens || 0) - w1h);
    var c = ((usage.input_tokens || 0) * t.entree + (usage.output_tokens || 0) * t.sortie + (usage.cache_read_input_tokens || 0) * t.lecture_cache +
      w5m * t.ecriture_cache_5m + w1h * t.ecriture_cache_1h) / 1e6;
    if (lot) c = c / 2;
    return Math.round(c * 10000) / 10000;
  }
  /* Estimation avant envoi : environ 3 caractères par jeton en français, sortie au plafond. */
  function estimerCout(caracteres, sortieMax, modele, lot) {
    return coutUsd({ input_tokens: Math.ceil(caracteres / 3), output_tokens: sortieMax || 0 }, modele, lot);
  }
  function controlePlafonds(estimation, consoMois, params) {
    params = params || {};
    var pe = params.plafond_etude_usd == null ? 3 : params.plafond_etude_usd, pm = params.plafond_mois_usd == null ? 40 : params.plafond_mois_usd;
    if (estimation == null) return { ok: false, motif: 'coût non estimable' };
    if (estimation > pe) return { ok: false, motif: 'coût estimé ' + estimation.toFixed(2) + ' USD au-dessus du plafond par étude (' + pe + ' USD)' };
    if ((consoMois || 0) + estimation > pm) return { ok: false, motif: 'plafond du mois atteint : ' + (consoMois || 0).toFixed(2) + ' + ' + estimation.toFixed(2) + ' USD dépasse ' + pm + ' USD' };
    return { ok: true, motif: 'estimé ' + estimation.toFixed(2) + ' USD (plafonds ' + pe + ' USD par étude, ' + pm + ' USD par mois)' };
  }

  return {
    A_VERIFIER: A_VERIFIER, FAITS: FAITS, CLAUSES: CLAUSES, VERDICTS: VERDICTS, DOSSIERS: DOSSIERS, AVIS: AVIS,
    COFFRE_TYPES: COFFRE_TYPES, ETATS_LIGNE: ETATS_LIGNE, LIBELLES_CLASSES: LIBELLES_CLASSES, TARIFS: TARIFS,
    libelleDe: libelleDe, sansAccents: sansAccents, similarite: similarite, classerFichier: classerFichier,
    pageDe: pageDe, contexteDe: contexteDe, sourceDeCitation: sourceDeCitation, lireLignes: lireLignes, construireResultat: construireResultat,
    aSource: aSource, etatSource: etatSource, nombre: nombre, dateISO: dateISO, heureHM: heureHM, dateFR: dateFR, ajouterJours: ajouterJours,
    dateEclaircissements: dateEclaircissements, ecartsFiche: ecartsFiche, montantFR: montantFR, montantEnLettres: montantEnLettres,
    versionCourante: versionCourante, etatPieceCoffre: etatPieceCoffre, alertesCoffre: alertesCoffre,
    originePiece: originePiece, ligneDossier: ligneDossier, compteursDossier: compteursDossier,
    lireBordereauFeuilles: lireBordereauFeuilles, choisirFeuilles: choisirFeuilles, chercherPA: chercherPA, prixVente: prixVente, totauxBordereau: totauxBordereau,
    eligiblePreEtude: eligiblePreEtude, coutUsd: coutUsd, estimerCout: estimerCout, controlePlafonds: controlePlafonds
  };
}));
