/* =========================================================================
 * MP - Relevés banque : logique PURE (lecteurs, contrôles d'intégrité, rapprochement).
 *
 * Chargé par public/index.html (global window.MPReleves) ET par l'API (copie committée
 * api/releves-banque.js, identité garantie par test/module-copy.test.js) ET par la gate
 * node (test/releves-banque.test.js). Une seule implémentation : ce que le navigateur
 * montre en aperçu est exactement ce que le serveur recalcule avant d'enregistrer.
 *
 * ENTRÉE COMMUNE à tous les lecteurs : les pages du PDF sous forme de LIGNES POSITIONNÉES
 *   pages = [{ numero, lignes: [{ y, items: [{ x, str }] }] }]
 * (extraites par pdf.js côté navigateur, items triés par x dans chaque ligne). Un lecteur
 * par banque, même SORTIE :
 *   { banque, periode (AAAA-MM ou null), lignes: [{ type, reference, beneficiaire, marche,
 *     date_delivrance, montant, montant_deduit, commission, page }], totaux, ecartes: [{ texte,
 *     motif }], refus: [{ code, detail }] }
 * Codes de refus NOMMÉS : FORMAT_INCONNU, TOTAL_DIFFERENT, OCR_INCERTAIN, LECTEUR_ABSENT,
 * RELEVE_DEJA_IMPORTE, PERIODE_ABSENTE. Un refus = relevé NON importé (doctrine : jamais
 * d'import approximatif).
 * ES5 strict, aucune dépendance.
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MPReleves = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BANQUES = ['FINEA', 'Attijariwafa Bank', 'BMCE Bank', 'Banque Populaire'];
  /* Lecteurs disponibles. Les absents refusent LECTEUR_ABSENT (nommé), jamais un import. */
  var LECTEURS = { 'FINEA': 'lireFINEA', 'BMCE Bank': 'lireBMCE' };
  var TYPES = { CP: 'provisoire', CD: 'bonne_execution', RG: 'retenue_garantie', TRANSIT: 'transit', DIVERS: 'divers' };
  /* Barème FINEA (constaté sur le relevé de septembre 2026) : 2 % l'an HT, TVA 10 %,
   * plancher 220,00 TTC par mois. Le montant garanti se DÉDUIT de la commission quand
   * elle dépasse le plancher : montant = TTC ÷ 1,1 × 12 ÷ taux. */
  var FINEA_TAUX_ANNUEL = 0.02, FINEA_TVA = 1.1, FINEA_PLANCHER_TTC = 220;
  var MOIS_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

  function _s(x) { return String(x == null ? '' : x); }
  function _sansAccents(s) { return _s(s).normalize ? _s(s).normalize('NFD').replace(/[̀-ͯ]/g, '') : _s(s); }
  function normaliserRef(n) { return _s(n).toUpperCase().replace(/[\s\-\/.]/g, ''); }
  function _refMatch(a, b) {
    var na = normaliserRef(a), nb = normaliserRef(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    var za = na.replace(/^0+/, ''), zb = nb.replace(/^0+/, '');
    return !!za && za === zb;
  }
  /* « 50 000,00 » / « 13 154,04 » / « 1.234,56 » -> nombre. null si ce n'est pas un montant. */
  function parserMontant(s) {
    var t = _s(s).replace(/\s/g, '').replace(/ /g, '');
    if (!/^-?\d{1,3}(\.?\d{3})*,\d{2}$/.test(t) && !/^-?\d+,\d{2}$/.test(t)) return null;
    var n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function _estMontant(s) { return parserMontant(s) !== null; }
  function dateISO(jjmmaaaa) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(_s(jjmmaaaa).trim());
    if (!m) { var m2 = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(_s(jjmmaaaa).trim()); if (!m2) return null; return (parseInt(m2[3], 10) > 50 ? '19' : '20') + m2[3] + '-' + m2[2] + '-' + m2[1]; }
    return m[3] + '-' + m[2] + '-' + m[1];
  }
  function _texteLigne(l) { return (l.items || []).map(function (i) { return _s(i.str); }).join(' ').replace(/\s+/g, ' ').trim(); }
  function _arrondi2(n) { return Math.round(n * 100) / 100; }
  function _somme(arr, f) { var t = 0; (arr || []).forEach(function (x) { var v = f(x); if (typeof v === 'number' && isFinite(v)) t += v; }); return _arrondi2(t); }

  /* Période lue dans un texte : « septembre 2026 », « 09/2026 », « au 30/09/2026 ». */
  function lirePeriode(texte) {
    var t = _sansAccents(texte).toLowerCase();
    var m = /(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/.exec(t);
    if (m) return m[2] + '-' + ('0' + (MOIS_FR.indexOf(m[1]) + 1)).slice(-2);
    m = /\bau\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
    if (m) return m[3] + '-' + m[2];
    // « 09/2026 » seul, jamais le « 10/2026 » d'une date complète « 06/10/2026 »
    var re = /(\d{2}\/)?\b(0[1-9]|1[0-2])\/(\d{4})\b/g, mm;
    while ((mm = re.exec(t))) { if (!mm[1]) return mm[3] + '-' + mm[2]; }
    return null;
  }

  function _sortie(banque) { return { banque: banque, periode: null, lignes: [], totaux: {}, ecartes: [], refus: [], lecteur: LECTEURS[banque] || null }; }

  /* ===== Lecteur FINEA — relevé de commissions (PDF texte) =====
   * Une ligne par caution : type (CD/RG/CP), référence, date d'octroi, marché, TTC du mois.
   * Les lignes FIADC et CAU FRAIS sont des frais, pas des cautions : écartées, nommées. */
  function lireFINEA(pages) {
    var out = _sortie('FINEA');
    var texteTout = [];
    (pages || []).forEach(function (p) {
      (p.lignes || []).forEach(function (l) {
        var t = _texteLigne(l); if (!t) return;
        texteTout.push(t);
        if (/\bFIADC\b/i.test(t) || /CAU\s*FRAIS/i.test(t)) { out.ecartes.push({ texte: t, motif: 'ligne de frais FINEA (FIADC / CAU FRAIS), pas une caution', montant: _dernierMontant(t), page: p.numero }); return; }
        var m = /^(CD|RG|CP)\s+(\S+)\s+(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(\d{1,3}(?:[ .]\d{3})*,\d{2}|\d+,\d{2})$/.exec(t);
        if (m) {
          var ttc = parserMontant(m[5]);
          var marche = m[4].trim(); if (!marche || /^-+$/.test(marche)) marche = null;
          var deduit = null;
          if (ttc !== null && ttc > FINEA_PLANCHER_TTC + 0.005) deduit = Math.round(ttc / FINEA_TVA * 12 / FINEA_TAUX_ANNUEL);
          out.lignes.push({ type: m[1], reference: m[2], beneficiaire: null, marche: marche, date_delivrance: dateISO(m[3]), montant: deduit, montant_deduit: deduit !== null, commission: ttc, page: p.numero });
          return;
        }
        if (/^TOTAL/i.test(t) || /\bTOTAL\b/i.test(t)) { var tot = _dernierMontant(t); if (tot !== null) out.totaux.commissions = tot; }
      });
    });
    out.periode = lirePeriode(texteTout.join('\n'));
    if (!out.lignes.length) out.refus.push({ code: 'FORMAT_INCONNU', detail: 'aucune ligne « type référence date marché TTC » reconnue : ce fichier n\'a pas la structure du relevé de commissions FINEA' });
    out.totaux.commissions_lignes = _somme(out.lignes, function (l) { return l.commission; });
    out.totaux.commissions_ecartees = _somme(out.ecartes, function (e) { return e.montant; });
    out.totaux.nombre = out.lignes.length;
    return out;
  }
  function _dernierMontant(t) { var ms = _s(t).match(/\d{1,3}(?:[\s.]\d{3})*,\d{2}|\d+,\d{2}/g); if (!ms) return null; return parserMontant(ms[ms.length - 1]); }

  /* ===== Lecteur BMCE — « Liste des cautions » de l'agence (état d'encours, sans commissions) =====
   * Colonnes repérées sur l'en-tête (REFERENCE, DATE, MONTANT ×3, DESTINATAIRE, TYPE, NUMERO
   * DE MARCHE) ; une caution commence à une ligne dont le premier item est une référence longue
   * (12 à 20 chiffres). Le destinataire et le marché sont écrits en fragments sur plusieurs
   * lignes, centrés sur la ligne de référence : chaque fragment est rattaché à la référence
   * la plus proche verticalement ; en haut d'une page, un fragment sans référence au-dessus
   * continue la dernière caution de la page précédente. Sections « NATURE CAUTION : 21/22/24 ».
   * Totaux : « TOTAL NATURE : montant  NOMBRE DOSSIER : n » par section. */
  var BMCE_NATURE = { '21': 'CP', '22': 'CD', '24': 'RG' };
  function lireBMCE(pages) {
    var out = _sortie('BMCE Bank');
    var cols = null, nature = null, texteTout = [];
    var natures = {}; // code -> { total, nombre }
    (pages || []).forEach(function (p) {
      var lignesPage = (p.lignes || []).slice().sort(function (a, b) { return b.y - a.y; }); // haut de page d'abord (pdf.js : y croît vers le haut)
      var refsPage = [];        // { y, ligne }
      var fragments = [];       // { y, x, str, col }
      lignesPage.forEach(function (l) {
        var items = (l.items || []).slice().sort(function (a, b) { return a.x - b.x; });
        var t = items.map(function (i) { return _s(i.str); }).join(' ').replace(/\s+/g, ' ').trim();
        if (!t) return;
        texteTout.push(t);
        var mn = /NATURE CAUTION\s*:\s*(\d+)\s+(.+)/i.exec(t);
        if (mn) { nature = BMCE_NATURE[mn[1]] || (/TRANSIT/i.test(mn[2]) ? 'TRANSIT' : /DIVERS/i.test(mn[2]) ? 'DIVERS' : mn[1]); return; }
        if (/\bREFERENCE\b/i.test(t) && /DESTINATAIRE/i.test(t)) {
          cols = { ref: null, montants: [], dest: null, type: null, marche: null };
          items.forEach(function (i) {
            var s = _s(i.str).toUpperCase();
            if (s.indexOf('REFERENCE') >= 0) cols.ref = i.x;
            else if (s.indexOf('MONTANT') >= 0) cols.montants.push(i.x);
            else if (s.indexOf('DESTINATAIRE') >= 0) cols.dest = i.x;
            else if (s === 'TYPE') cols.type = i.x;
            else if (s.indexOf('NUMERO') >= 0) cols.marche = i.x;
          });
          cols.montants.sort(function (a, b) { return a - b; });
          return;
        }
        var mt = /TOTAL\s+(NATURE|CLIENT)\s*:\s*([\d\s.]*\d,\d{2})\s+NOMBRE\s+DOSSIER\s*:\s*(\d+)/i.exec(t);
        if (mt) { if (mt[1].toUpperCase() === 'NATURE' && nature) natures[nature] = { total: parserMontant(mt[2]), nombre: parseInt(mt[3], 10) }; return; }
        if (/^Page\s*\|/i.test(t) || /^TYPE\s*:/i.test(t) || /^\d\s*:\s*(HORS|CONSORTIUM)/i.test(t) || /LISTE DES CAUTIONS/i.test(t) || /^AGENCE\s*:/i.test(t) || /^NEURONES/i.test(t) || /^(SOUMISSION|ENGAGEMENT|PROVISION)(\s+(SOUMISSION|ENGAGEMENT|PROVISION))*$/i.test(t)) return;
        var premier = items[0];
        if (premier && /^\d{12,20}$/.test(_s(premier.str).trim()) && (!cols || cols.ref == null || Math.abs(premier.x - cols.ref) < 80)) {
          var ligne = { type: nature, reference: _s(premier.str).trim(), beneficiaire: '', marche: '', date_delivrance: null, montant: null, montant_deduit: false, commission: null, page: p.numero, _frag: [], _marche: [] };
          var montants = [];
          items.slice(1).forEach(function (i) {
            var s = _s(i.str).trim();
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(s) && !ligne.date_delivrance) { ligne.date_delivrance = dateISO(s); return; }
            if (_estMontant(s)) { montants.push({ x: i.x, v: parserMontant(s) }); return; }
            _classerFragment(i, cols, ligne, p, l.y);
          });
          if (montants.length) {
            var eng = null;
            if (cols && cols.montants.length >= 2) { var xEng = cols.montants[1]; var best = null; montants.forEach(function (m) { if (!best || Math.abs(m.x - xEng) < Math.abs(best.x - xEng)) best = m; }); eng = best; }
            if (!eng || eng.v === 0) { var nz = montants.filter(function (m) { return m.v !== 0; }); eng = nz.length ? nz[nz.length - 1] : montants[montants.length - 1]; }
            ligne.montant = eng.v;
          }
          refsPage.push({ y: l.y, ligne: ligne });
          out.lignes.push(ligne);
          return;
        }
        // fragments (destinataire / marché / type consortium), à rattacher
        items.forEach(function (i) { fragments.push({ y: l.y, x: i.x, str: _s(i.str).trim(), page: p.numero }); });
      });
      // Rattachement des fragments : à la référence la plus proche verticalement sur la page ;
      // une page sans aucune référence (suite d'un destinataire long) continue la dernière
      // caution lue. Au changement de page, un libellé coupé peut se rattacher à la caution
      // suivante : visible dans l'aperçu, corrigeable ; les montants et comptes ne sont pas touchés.
      fragments.forEach(function (f) {
        var cible = null, d = Infinity;
        refsPage.forEach(function (r) { var dd = Math.abs(r.y - f.y); if (dd < d) { d = dd; cible = r.ligne; } });
        if (!cible && out.lignes.length) cible = out.lignes[out.lignes.length - 1];
        if (cible) _classerFragment({ x: f.x, str: f.str }, cols, cible, { numero: f.page }, f.y);
      });
    });
    out.lignes.forEach(function (l) {
      l.beneficiaire = _joindreFragments(l._frag) || null;
      l.marche = _joindreFragments(l._marche).replace(/\bMARCHE\s*N[°º0o]?\b/ig, ' ').replace(/(^|\s)N[°º0o]?(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() || null;
      delete l._frag; delete l._marche;
    });
    out.periode = lirePeriode(texteTout.join('\n')); // la liste BMCE n'est en général pas datée -> null, période saisie par l'utilisateur
    out.totaux.natures = natures;
    out.totaux.encours = _somme(Object.keys(natures), function (k) { return natures[k].total; });
    out.totaux.nombre = Object.keys(natures).reduce(function (s, k) { return s + (natures[k].nombre || 0); }, 0);
    out.totaux.encours_lignes = _somme(out.lignes, function (l) { return l.montant; });
    if (!cols && !out.lignes.length) out.refus.push({ code: 'FORMAT_INCONNU', detail: 'en-tête « REFERENCE … DESTINATAIRE » introuvable et aucune référence longue lue : ce fichier n\'a pas la structure de la liste des cautions BMCE' });
    else if (!out.lignes.length) out.refus.push({ code: 'FORMAT_INCONNU', detail: 'en-tête reconnu mais aucune ligne de caution (référence de 12 à 20 chiffres) lue' });
    return out;
  }
  /* Un fragment va au destinataire ou au marché selon sa colonne ; sans en-tête connu, au
   * destinataire. Les items « 0 », « 1 », « 2 » dans la colonne TYPE = consortium, ignorés. */
  function _classerFragment(i, cols, ligne, p, y) {
    var s = _s(i.str).trim(); if (!s) return;
    if (/^[012]$/.test(s)) return;
    var frag = { page: p && p.numero != null ? p.numero : 0, y: (typeof y === 'number' ? y : 0), ordre: ligne._frag.length + ligne._marche.length, str: s };
    if (cols && cols.marche != null && i.x >= cols.marche - 40) { ligne._marche.push(frag); return; }
    if (cols && cols.type != null && i.x >= cols.type - 10 && (cols.marche == null || i.x < cols.marche - 40)) return;
    ligne._frag.push(frag);
  }
  /* Fragments remis dans l'ordre de lecture : page, puis de haut en bas (y décroissant). */
  function _joindreFragments(frags) {
    return frags.slice().sort(function (a, b) { return (a.page - b.page) || (b.y - a.y) || (a.ordre - b.ordre); }).map(function (f) { return f.str; }).join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ===== Contrôles d'intégrité : un échec = relevé NON importé, refus nommé ===== */
  function controler(lecture) {
    var refus = (lecture.refus || []).slice();
    var t = lecture.totaux || {};
    if (lecture.banque === 'FINEA' && lecture.lignes.length) {
      if (typeof t.commissions === 'number') {
        var s1 = t.commissions_lignes, s2 = _arrondi2(t.commissions_lignes + (t.commissions_ecartees || 0));
        if (Math.abs(s1 - t.commissions) > 0.005 && Math.abs(s2 - t.commissions) > 0.005) refus.push({ code: 'TOTAL_DIFFERENT', detail: 'Σ commissions lues ' + s1.toFixed(2) + ' (avec frais écartés ' + s2.toFixed(2) + ') ≠ total du relevé ' + t.commissions.toFixed(2) });
      }
      lecture.lignes.forEach(function (l) {
        if (l.commission === null) { refus.push({ code: 'FORMAT_INCONNU', detail: 'ligne ' + l.reference + ' sans commission lisible' }); return; }
        if (l.commission < FINEA_PLANCHER_TTC - 0.005) refus.push({ code: 'TOTAL_DIFFERENT', detail: 'ligne ' + l.reference + ' : commission ' + l.commission.toFixed(2) + ' sous le plancher 220,00' });
        if (l.montant_deduit) {
          var recalc = Math.max(FINEA_PLANCHER_TTC, _arrondi2(l.montant * FINEA_TAUX_ANNUEL / 12 * FINEA_TVA));
          if (Math.abs(recalc - l.commission) > 0.01) refus.push({ code: 'TOTAL_DIFFERENT', detail: 'ligne ' + l.reference + ' : commission recalculée ' + recalc.toFixed(2) + ' ≠ lue ' + l.commission.toFixed(2) });
        }
      });
    }
    if (lecture.banque === 'BMCE Bank' && lecture.lignes.length) {
      var nats = t.natures || {};
      var parNature = {};
      lecture.lignes.forEach(function (l) { var k = l.type || '?'; parNature[k] = parNature[k] || { n: 0, total: 0 }; parNature[k].n++; parNature[k].total = _arrondi2(parNature[k].total + (l.montant || 0)); });
      Object.keys(nats).forEach(function (k) {
        var lu = parNature[k] || { n: 0, total: 0 };
        if (lu.n !== nats[k].nombre) refus.push({ code: 'TOTAL_DIFFERENT', detail: 'nature ' + k + ' : ' + lu.n + ' ligne(s) lue(s) pour ' + nats[k].nombre + ' dossier(s) annoncé(s)' });
        if (typeof nats[k].total === 'number' && Math.abs(lu.total - nats[k].total) > 0.005) refus.push({ code: 'TOTAL_DIFFERENT', detail: 'nature ' + k + ' : Σ montants lus ' + lu.total.toFixed(2) + ' ≠ total nature ' + nats[k].total.toFixed(2) });
      });
      Object.keys(parNature).forEach(function (k) { if (!nats[k]) refus.push({ code: 'TOTAL_DIFFERENT', detail: 'nature ' + k + ' : ' + parNature[k].n + ' ligne(s) lue(s) sans total de nature dans le document' }); });
      lecture.lignes.forEach(function (l) { if (l.montant === null) refus.push({ code: 'FORMAT_INCONNU', detail: 'référence ' + l.reference + ' sans montant d\'engagement lisible' }); if (!l.date_delivrance) refus.push({ code: 'FORMAT_INCONNU', detail: 'référence ' + l.reference + ' sans date de délivrance lisible' }); });
    }
    // dédoublonnage des refus identiques
    var vus = {}, uniq = [];
    refus.forEach(function (r) { var k = r.code + '|' + r.detail; if (!vus[k]) { vus[k] = 1; uniq.push(r); } });
    return { ok: uniq.length === 0, refus: uniq };
  }

  /* Corrections HUMAINES sur les lignes lues (en face de l'image de la page) : appliquées
   * à l'identique par l'aperçu et par le serveur, TRACÉES (avant / après / par / le),
   * puis les totaux de lignes sont recalculés et les contrôles rejoués. Renvoie la trace.
   * Champs corrigeables nommés ; un index hors lignes ou un champ inconnu est ignoré. */
  var CHAMPS_CORRIGEABLES = ['reference', 'type', 'beneficiaire', 'marche', 'date_delivrance', 'montant', 'commission'];
  function appliquerCorrections(lecture, corrections, par, maintenantISO) {
    var trace = [];
    (corrections || []).forEach(function (c) {
      var i = parseInt(c && c.index, 10), champ = _s(c && c.champ);
      if (!(i >= 0 && i < lecture.lignes.length) || CHAMPS_CORRIGEABLES.indexOf(champ) < 0) return;
      var avant = lecture.lignes[i][champ], apres = c.valeur;
      if (champ === 'montant' || champ === 'commission') {
        apres = (apres === null || apres === undefined || apres === '') ? null : (typeof apres === 'number' ? apres : (parserMontant(apres) !== null ? parserMontant(apres) : Number(String(apres).replace(/\s/g, '').replace(',', '.'))));
        if (apres !== null && !isFinite(apres)) return;
        if (champ === 'montant') lecture.lignes[i].montant_deduit = false;
      } else apres = (apres === null || apres === undefined) ? null : _s(apres).trim();
      if (apres === avant) return;
      lecture.lignes[i][champ] = apres;
      // FINEA : le montant d'une ligne DÉDUIT de sa commission se redéduit de la commission corrigée.
      if (champ === 'commission' && lecture.banque === 'FINEA' && lecture.lignes[i].montant_deduit) {
        lecture.lignes[i].montant = (apres !== null && apres > FINEA_PLANCHER_TTC + 0.005) ? Math.round(apres / FINEA_TVA * 12 / FINEA_TAUX_ANNUEL) : null;
        lecture.lignes[i].montant_deduit = lecture.lignes[i].montant !== null;
      }
      trace.push({ index: i, reference: lecture.lignes[i].reference, champ: champ, avant: (avant === undefined ? null : avant), apres: apres, par: par || null, le: maintenantISO || new Date().toISOString() });
    });
    lecture.totaux = lecture.totaux || {};
    if (lecture.banque === 'FINEA') lecture.totaux.commissions_lignes = _somme(lecture.lignes, function (l) { return l.commission; });
    if (lecture.banque === 'BMCE Bank') lecture.totaux.encours_lignes = _somme(lecture.lignes, function (l) { return l.montant; });
    lecture.controle = controler(lecture);
    return trace;
  }

  /* Point d'entrée : lit selon la banque, contrôle, renvoie la lecture + le verdict. */
  function lire(banque, pages) {
    var nom = LECTEURS[banque];
    if (!nom) { var o = _sortie(banque); o.refus.push({ code: 'LECTEUR_ABSENT', detail: 'aucun lecteur pour « ' + banque + ' » (' + (banque === 'Attijariwafa Bank' ? 'relevé scanné : lecteur OCR à venir' : banque === 'Banque Populaire' ? 'lecteur à écrire sur le premier relevé fourni' : 'banque inconnue') + ')' }); o.controle = { ok: false, refus: o.refus }; return o; }
    var lecture = (nom === 'lireFINEA' ? lireFINEA : lireBMCE)(pages);
    lecture.controle = controler(lecture);
    return lecture;
  }

  /* Même banque + même période déjà importées = refus RELEVE_DEJA_IMPORTE. */
  function dejaImporte(releves, banque, periode) {
    return (releves || []).some(function (r) { return r && r.banque === banque && r.periode === periode; });
  }
  function periodeValide(p) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(_s(p)); }

  /* ===== Rapprochement d'un relevé avec nos cautions =====
   * cautions = fiches mp_cautions de la banque ; provisoires = [{ ao, caution_prov }] de la
   * banque. Appariement : référence banque COMPLÈTE, puis ALIAS abrégé, puis bénéficiaire +
   * montant. Groupes : (a) en banque et active chez nous ; (b) en banque mais libérée /
   * restituée / mainlevée demandée ou reçue chez nous — ANOMALIE ; inconnues = en banque
   * sans fiche ; (c) active chez nous, absente du relevé. */
  var STATUTS_B = ['liberee', 'restituee', 'mainlevee_demandee', 'mainlevee_recue'];
  function _motsSignificatifs(s) { return _sansAccents(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 5; }); }
  function beneficiaireProche(a, b) {
    var wa = _motsSignificatifs(a), wb = _motsSignificatifs(b);
    if (!wa.length || !wb.length) return false;
    var hits = 0; wa.forEach(function (w) { if (wb.indexOf(w) >= 0) hits++; });
    return hits >= Math.min(2, wa.length);
  }
  function _fiches(cautions, provisoires, gm) {
    gm = gm || function () { return {}; };
    var out = (cautions || []).map(function (c) { var m = gm(c.marcheId || c.marche_id) || {}; return { kind: 'caution', id: c.id, marcheId: c.marcheId || c.marche_id, num: c.num, referenceBanque: c.referenceBanque || null, type: c.type, montant: +c.montant || 0, statut: c.statut, banque: c.banque, date_emission: c.date_emission || null, date_demande_mainlevee: c.date_demande_mainlevee || null, date_liberation: c.date_liberation_effective || c.date_liberation || null, marche_ref: m.ref || null, beneficiaire: m.maitre_ouvrage || null }; });
    (provisoires || []).forEach(function (x) { var a = x.ao || x, p = (x.caution_prov || a.caution_prov); if (!p) return; out.push({ kind: 'provisoire', id: 'prov_' + a.id, aoId: a.id, num: p.num || '', referenceBanque: p.referenceBanque || null, type: 'provisoire', montant: +p.montant || 0, statut: p.statut || '', banque: p.banque, date_emission: p.date_emission || null, date_demande_mainlevee: p.date_demande_mainlevee || null, date_liberation: p.date_restitution || null, marche_ref: a.ref || null, beneficiaire: a.maitre_ouvrage || null }); });
    return out;
  }
  function apparierLigne(ligne, fiches, pris) {
    var i, f, typeAttendu = TYPES[ligne.type] || null;
    for (i = 0; i < fiches.length; i++) { f = fiches[i]; if (!pris[f.id] && _refMatch(ligne.reference, f.referenceBanque)) return { fiche: f, via: 'reference' }; }
    for (i = 0; i < fiches.length; i++) { f = fiches[i]; if (!pris[f.id] && _refMatch(ligne.reference, f.num)) return { fiche: f, via: 'alias' }; }
    if (typeof ligne.montant === 'number' && ligne.beneficiaire) {
      var tol = ligne.montant_deduit ? 2 : 0.01, cands = [];
      for (i = 0; i < fiches.length; i++) { f = fiches[i]; if (pris[f.id]) continue; if (typeAttendu && f.type !== typeAttendu) continue; if (Math.abs(f.montant - ligne.montant) <= tol && beneficiaireProche(ligne.beneficiaire, f.beneficiaire)) cands.push(f); }
      if (cands.length === 1) return { fiche: cands[0], via: 'beneficiaire_montant' };
    }
    return null;
  }
  function rapprocher(lecture, cautions, provisoires, gm, periode) {
    var fiches = _fiches(cautions, provisoires, gm), pris = {};
    var a = [], b = [], inconnues = [], c = [];
    (lecture.lignes || []).forEach(function (l) {
      var app = apparierLigne(l, fiches, pris);
      if (!app) { inconnues.push({ ligne: l, motif: (l.type === 'TRANSIT' || l.type === 'DIVERS') ? 'hors marchés publics (' + l.type.toLowerCase() + ') : pas de fiche MP par nature' : 'aucune fiche chez nous (référence, alias, bénéficiaire + montant)' }); return; }
      pris[app.fiche.id] = true;
      var item = { ligne: l, fiche: app.fiche, via: app.via, ecart_montant: (typeof l.montant === 'number' && !l.montant_deduit && Math.abs(l.montant - app.fiche.montant) > 0.005) ? _arrondi2(l.montant - app.fiche.montant) : 0 };
      if (STATUTS_B.indexOf(app.fiche.statut) >= 0) {
        item.date_mainlevee = app.fiche.date_demande_mainlevee || null;
        item.date_liberation = app.fiche.date_liberation || null;
        item.mois_depuis_mainlevee = _moisEntre(item.date_mainlevee, periode);
        item.commission_relevee = l.commission;
        b.push(item);
      } else a.push(item);
    });
    fiches.forEach(function (f) { if (!pris[f.id] && f.statut === 'active') c.push({ fiche: f, motif: 'active chez nous, absente du relevé : libérée sans qu\'on le sache, ou non facturée ce mois' }); });
    var encoursBanque = _somme(lecture.lignes, function (l) { return l.montant; });
    var nbSansMontant = (lecture.lignes || []).filter(function (l) { return typeof l.montant !== 'number'; }).length;
    var encoursMP = _somme(fiches.filter(function (f) { return f.statut === 'active'; }), function (f) { return f.montant; });
    var sB = _somme(b, function (x) { return typeof x.ligne.montant === 'number' ? x.ligne.montant : x.fiche.montant; });
    var sInc = _somme(inconnues, function (x) { return x.ligne.montant; });
    var sC = _somme(c, function (x) { return x.fiche.montant; });
    var sEcartA = _somme(a, function (x) { return x.ecart_montant; });
    return {
      periode: periode || lecture.periode || null,
      a: a, b: b, c: c, inconnues: inconnues,
      compteurs: { lignes: (lecture.lignes || []).length, a: a.length, b: b.length, c: c.length, inconnues: inconnues.length, fiches: fiches.length, sans_montant: nbSansMontant },
      encours: { banque: encoursBanque, mp: encoursMP, ecart: _arrondi2(encoursBanque - encoursMP), lignes_sans_montant: nbSansMontant,
        explication: [
          { libelle: '(b) en banque mais libérées / en mainlevée chez nous', montant: sB, signe: '+' },
          { libelle: 'en banque sans fiche chez nous', montant: sInc, signe: '+' },
          { libelle: '(c) actives chez nous, absentes du relevé', montant: sC, signe: '-' },
          { libelle: 'écarts de montant sur les appariées (a)', montant: sEcartA, signe: '+' }
        ],
        reste: _arrondi2(encoursBanque - encoursMP - (sB + sInc - sC + sEcartA)) }
    };
  }
  function _moisEntre(dateISOa, periode) {
    if (!dateISOa || !periodeValide(periode)) return null;
    var a = new Date(dateISOa), y = parseInt(periode.slice(0, 4), 10), m = parseInt(periode.slice(5, 7), 10);
    if (isNaN(a.getTime())) return null;
    return Math.max(0, (y - a.getUTCFullYear()) * 12 + (m - (a.getUTCMonth() + 1)));
  }

  /* « Vue en banque <période> » posée sur chaque fiche appariée : valeur du champ
   * derniere_vue_banque (on ne garde que la période la plus récente). */
  function vueEnBanque(actuelle, periode, releveId) {
    if (!periodeValide(periode)) return actuelle || null;
    if (actuelle && actuelle.periode && actuelle.periode > periode) return actuelle;
    return { periode: periode, releveId: releveId || null, le: new Date().toISOString().slice(0, 10) };
  }
  /* Signal « absente depuis deux relevés » : la banque a au moins deux relevés importés et
   * la fiche n'apparaît sur aucun des deux derniers. Renvoie null, ou le texte du signal. */
  function signalAbsence(caution, relevesBanque) {
    var periodes = (relevesBanque || []).map(function (r) { return r.periode; }).filter(periodeValide).sort().reverse();
    if (periodes.length < 2) return null;
    var vue = caution && caution.derniere_vue_banque && caution.derniere_vue_banque.periode;
    if (vue && vue >= periodes[1]) return null;
    return 'absente des deux derniers relevés (' + periodes[1] + ', ' + periodes[0] + ')';
  }

  /* Ligne d'historique d'un relevé enregistré (une par relevé). */
  function ligneHistorique(releve) {
    var r = releve || {}, rp = r.rapprochement || { encours: r.encours, compteurs: r.compteurs }, enc = rp.encours || {}, cpt = rp.compteurs || {};
    return { id: r.id, banque: r.banque, periode: r.periode, importe_le: r.importe_le, encours_banque: enc.banque, encours_mp: enc.mp, ecart: enc.ecart, anomalies: cpt.b || 0, inconnues: cpt.inconnues || 0, absentes: cpt.c || 0, commissions: (r.totaux && typeof r.totaux.commissions === 'number') ? r.totaux.commissions : ((r.totaux && r.totaux.commissions_lignes) || null), lignes: cpt.lignes || (r.lignes || []).length };
  }

  return {
    BANQUES: BANQUES, LECTEURS: LECTEURS, TYPES: TYPES,
    FINEA_TAUX_ANNUEL: FINEA_TAUX_ANNUEL, FINEA_TVA: FINEA_TVA, FINEA_PLANCHER_TTC: FINEA_PLANCHER_TTC,
    normaliserRef: normaliserRef, parserMontant: parserMontant, dateISO: dateISO, lirePeriode: lirePeriode, periodeValide: periodeValide,
    lireFINEA: lireFINEA, lireBMCE: lireBMCE, lire: lire, controler: controler, dejaImporte: dejaImporte,
    CHAMPS_CORRIGEABLES: CHAMPS_CORRIGEABLES, appliquerCorrections: appliquerCorrections,
    beneficiaireProche: beneficiaireProche, apparierLigne: apparierLigne, rapprocher: rapprocher,
    vueEnBanque: vueEnBanque, signalAbsence: signalAbsence, ligneHistorique: ligneHistorique
  };
});
