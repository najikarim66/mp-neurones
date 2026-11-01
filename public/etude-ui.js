/* =========================================================================
 * Écran « Étude d'AO » + « Documents de la société » (maquette validée par le DG le 01/11/2026).
 *
 * Deux parties :
 *  - MPEtudeUI.* : constructeurs HTML PURS (aucun accès au DOM), exécutés tels quels par les gates
 *    node (test/etude-sources.test.js) : toute donnée affichée porte un bouton source ou « à vérifier ».
 *  - le branchement navigateur (pages, appels API, relève de l'état) en bas, si window existe.
 * ES5 strict. Texte jamais sous 12 px ; aucune troncature de données (doctrine §2).
 * ========================================================================= */
(function (root, factory) {
  var M = (typeof module === 'object' && module.exports) ? require('./etude-calc.js') : root.MPEtude;
  var ui = factory(M);
  if (typeof module === 'object' && module.exports) module.exports = ui;
  else root.MPEtudeUI = ui;
}(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function e(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var EN_COURS = { preparation: 1, ocr_en_cours: 1, analyse_en_cours: 1 };

  var CSS = '' +
    '.et-wrap{display:flex;flex-direction:column;gap:14px;font-size:14px;color:#1d2a44}' +
    '.et-ao{background:#fff;border:1px solid #d9dde5;border-radius:12px;padding:16px 20px 0}' +
    '.et-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}' +
    '.et-ref{font-weight:600;color:#1d3a6e;font-size:14px}' +
    '.et-h1{margin:2px 0 4px;font-size:22px;font-weight:600;line-height:1.25;max-width:70ch}' +
    '.et-moa{color:#4a5672;font-size:14px}' +
    '.et-due{text-align:right}.et-due b{display:block;font-size:22px;color:#b3261e}.et-due span{font-size:13px;color:#4a5672}' +
    '.et-tabs{display:flex;gap:2px;margin-top:12px;flex-wrap:wrap}' +
    '.et-tabs button{padding:9px 14px;color:#4a5672;background:none;border:0;border-bottom:3px solid transparent;font-weight:600;font-size:14px;cursor:pointer}' +
    '.et-tabs button[aria-current="page"]{color:#1d3a6e;border-color:#1d3a6e}' +
    '.et-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:start}' +
    '@media (max-width:980px){.et-grid{grid-template-columns:1fr}}' +
    '.et-col{display:flex;flex-direction:column;gap:14px;min-width:0}' +
    '.et-card{background:#fff;border:1px solid #d9dde5;border-radius:12px;padding:16px 18px;min-width:0}' +
    '.et-card h2{margin:0 0 10px;font-size:18px;font-weight:600}.et-card h2 small{font-weight:400;color:#4a5672;font-size:14px;margin-left:6px}' +
    '.et-run{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid #d9dde5;border-radius:12px;padding:12px 16px}' +
    '.et-run p{margin:0;font-size:14px;color:#4a5672}.et-run p b{color:#1d2a44}' +
    '.et-btns{display:flex;gap:8px;flex-wrap:wrap}' +
    '.et-btn{font-weight:600;font-size:14px;border-radius:8px;padding:8px 14px;border:1px solid #d9dde5;background:#fff;color:#1d2a44;cursor:pointer}' +
    '.et-btn.pri{background:#1d3a6e;border-color:#1d3a6e;color:#fff}.et-btn.sm{padding:4px 10px;font-size:13px}' +
    '.et-btn[disabled]{opacity:.55;cursor:not-allowed}' +
    '.et-verdict{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center}' +
    '.et-stamp{transform:rotate(-4deg);border:3px solid #1f6b45;color:#1f6b45;border-radius:8px;padding:8px 14px;text-align:center;font-weight:700;font-size:22px;line-height:1.05}' +
    '.et-stamp.non{border-color:#b3261e;color:#b3261e}.et-stamp.dis{border-color:#9a5b00;color:#9a5b00}' +
    '.et-stamp small{display:block;font-size:13px;font-weight:600}' +
    '.et-verdict ul{margin:0;padding-left:18px}.et-verdict li{margin:3px 0}' +
    '.et-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));border:1px solid #d9dde5;border-radius:10px;overflow:hidden}' +
    '.et-fact{padding:10px 12px;border-right:1px solid #d9dde5;border-bottom:1px solid #d9dde5}' +
    '.et-fact .k{font-size:13px;color:#4a5672}.et-fact .v{font-weight:600;font-size:15px;word-break:break-word}' +
    '.et-src{display:inline-block;margin-top:2px;font-size:13px;color:#1d3a6e;background:#e6ecf7;border-radius:5px;padding:1px 6px;cursor:pointer;border:0;font-family:inherit;text-align:left}' +
    '.et-src:hover{text-decoration:underline}.et-src.warn{color:#9a5b00;background:#fdf1dc}' +
    '.et-tbl{overflow-x:auto}.et-tbl table{width:100%;border-collapse:collapse;min-width:640px}' +
    '.et-tbl th{text-align:left;font-size:13px;font-weight:600;color:#4a5672;padding:8px;border-bottom:2px solid #d9dde5}' +
    '.et-tbl td{padding:9px 8px;border-bottom:1px solid #d9dde5;vertical-align:top;font-size:14px;white-space:normal;word-break:break-word}' +
    '.et-tbl td.n{text-align:right;white-space:nowrap}' +
    '.et-tag{font-size:13px;font-weight:600;border-radius:999px;padding:1px 9px;white-space:nowrap}' +
    '.et-tag.bad{background:#fbe9e7;color:#b3261e}.et-tag.neg{background:#fdf1dc;color:#9a5b00}.et-tag.ok{background:#e3f2ea;color:#1f6b45}' +
    '.et-bord{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:10px}' +
    '.et-bord div{background:#f5f7fa;border-radius:9px;padding:10px 12px}.et-bord .k{font-size:13px;color:#4a5672}.et-bord .v{font-weight:700;font-size:19px}' +
    '.et-bord .v.d{color:#1f6b45}.et-bord .v.r{color:#b3261e}' +
    '.et-cov{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}' +
    '@media (max-width:600px){.et-cov{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '.et-cov div{background:#f5f7fa;border-radius:9px;padding:9px 12px;display:flex;flex-direction:column}' +
    '.et-cov b{font-size:24px;line-height:1.1}.et-cov span{font-size:13px;color:#4a5672}' +
    '.et-cov .g b{color:#1f6b45}.et-cov .a b{color:#9a5b00}.et-cov .r b{color:#b3261e}' +
    '.et-note{margin:8px 0 0;font-size:13px;color:#4a5672}' +
    'tr.et-gr td{background:#f5f7fa;font-weight:600;color:#1d3a6e;padding:6px 8px}' +
    '.et-q{border-left:3px solid #1d3a6e;padding:6px 0 6px 12px;margin:8px 0;font-size:14px}.et-q .why{color:#4a5672;font-size:13px}' +
    '.et-aside{position:sticky;top:12px}' +
    '.et-aside h2{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}' +
    '.et-docline{font-size:13px;color:#4a5672;margin-bottom:8px;word-break:break-word}' +
    '.et-excerpt{font-family:Georgia,serif;font-size:15px;line-height:1.7;background:#f5f7fa;border-radius:8px;padding:14px 16px;white-space:pre-wrap;word-break:break-word}' +
    '.et-excerpt mark{background:#fff1a8;color:inherit;padding:0 2px;border-radius:2px}' +
    '.et-why{font-size:13px;color:#4a5672;margin-top:10px}.et-why b{color:#1d2a44}' +
    '.et-files{list-style:none;margin:10px 0 0;padding:0;font-size:13px}' +
    '.et-files li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #d9dde5}' +
    '.et-files li span:first-child{word-break:break-word}.et-files li span:last-child{color:#4a5672;text-align:right}' +
    '.et-ecart{color:#b3261e;font-weight:700}' +
    '.et-alerte{background:#fbe9e7;border:1px solid #f0b8b2;color:#b3261e;border-radius:10px;padding:10px 14px;font-size:14px}' +
    '.et-info{background:#fdf1dc;border:1px solid #f0d49a;color:#6b4000;border-radius:10px;padding:10px 14px;font-size:14px}';

  function cssTag() { return '<style id="et-css">' + CSS + '</style>'; }

  /* Registre des sources de l'écran : chaque bouton data-src renvoie à reg[i]. */
  function Reg() { this.items = []; }
  Reg.prototype.btn = function (item, pourquoi, libelleForce) {
    var st = M.etatSource(item);
    var i = this.items.length;
    this.items.push({ item: item, etat: st, pourquoi: pourquoi || '' });
    if (st.etat === 'source') return '<button class="et-src" data-src="' + i + '">' + e(libelleForce || st.libelle) + '</button>';
    return '<button class="et-src warn" data-src="' + i + '" data-averifier="1">' + e(st.libelle) + '</button>';
  };

  function joursAvant(dateIso, maintenant) {
    var m = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]), n = new Date(maintenant || Date.now());
    var a = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    return Math.round((t - a) / 86400000);
  }

  function enTete(d, onglet, maintenant) {
    var f = d.fiche || {}, v = d.veille || {};
    var ref = f.ref || v.reference_ao || 'AO sans référence';
    var objet = f.objet || v.objet || 'objet non renseigné';
    var moa = f.maitre_ouvrage || v.acheteur || 'non renseigné';
    var est = f.budget_estime != null ? f.budget_estime : v.estimation_mo;
    var dl = f.date_limite || M.dateISO(v.date_limite);
    var hl = f.heure_limite || v.heure_limite;
    var j = joursAvant(dl, maintenant);
    var due = dl ? '<div class="et-due"><b>' + (j == null ? '' : (j > 0 ? 'J-' + j : (j === 0 ? "Aujourd'hui" : 'Échu'))) + '</b><span>Dépôt le ' + e(M.dateFR(dl)) + (hl ? ' à ' + e(hl) : ', heure non renseignée') + '</span></div>' : '<div class="et-due"><span>Date de dépôt non renseignée</span></div>';
    var tabs = [['etude', 'Étude'], ['bordereau', 'Bordereau'], ['dossier', 'Dossier de réponse'], ['dce', 'Fichiers du DCE']];
    return '<div class="et-ao"><div class="et-top"><div><div class="et-ref">AO n° ' + e(ref) + (v.type_procedure ? ' · ' + e(v.type_procedure) : '') + '</div>' +
      '<div class="et-h1">' + e(objet) + '</div><div class="et-moa">Maître d\'ouvrage : ' + e(moa) + ' · Estimation : ' + (est != null && est !== '' ? e(M.montantFR(M.nombre(est))) + ' DH' : 'non renseignée') + '</div></div>' + due + '</div>' +
      '<nav class="et-tabs" aria-label="Fiche AO">' + tabs.map(function (t) { return '<button data-onglet="' + t[0] + '"' + (onglet === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>'; }).join('') +
      (f.id ? '<button data-action="fiche">Fiche AO</button>' : '') + '</nav></div>';
  }

  function nbPagesDe(et, classe) {
    var fs = (et && et.dce && et.dce.fichiers) || [], n = 0, ok = false;
    for (var i = 0; i < fs.length; i++) if (fs[i].classe === classe && fs[i].pages_total) { n += fs[i].pages_total; ok = true; }
    return ok ? n : null;
  }
  function lignesDossier(d, maintenant) {
    var et = d.courante, r = (et && et.resultat) || {};
    var auj = new Date(maintenant || Date.now()).toISOString().slice(0, 10);
    var dep = (d.fiche && d.fiche.date_limite) || M.dateISO(d.veille && d.veille.date_limite);
    var out = [];
    for (var i = 0; i < (r.pieces || []).length; i++) out.push(M.ligneDossier(r.pieces[i], { coffre: d.coffre, dateDepot: dep, aujourdhui: auj, validations: et.validations }));
    var ordre = {}; for (var k = 0; k < M.DOSSIERS.length; k++) ordre[M.DOSSIERS[k].cle] = k;
    out.sort(function (a, b) { return (ordre[a.dossier] == null ? 9 : ordre[a.dossier]) - (ordre[b.dossier] == null ? 9 : ordre[b.dossier]); });
    return out;
  }
  function pointsAVerifier(r) {
    var n = 0, k;
    for (k = 0; k < M.FAITS.length; k++) { var f = (r.faits || {})[M.FAITS[k].cle]; if (!f || !M.aSource(f)) n++; }
    for (k = 0; k < (r.clauses || []).length; k++) if (!M.aSource(r.clauses[k])) n++;
    return n + 1; /* + la date des éclaircissements, toujours calculée */
  }

  function barreEtat(d, maintenant) {
    var et = d.courante;
    var lancer = '<button class="et-btn pri" data-action="lancer"' + (d.cle_configuree === false ? ' disabled title="Clé de l\'étude non configurée côté API"' : '') + '>Lancer l\'étude</button>';
    if (!et) {
      var raison = (d.veille && d.veille.dce_status === 'ready') ? 'Le DCE est téléchargé : l\'étude peut être lancée. Elle prend quelques minutes et reste un brouillon.' : 'DCE non téléchargé : le demander d\'abord depuis la Veille AO (bouton ⬇).';
      if (d.cle_configuree === false) raison += ' La clé de l\'étude n\'est pas encore configurée côté API.';
      return '<div class="et-run" data-etat="aucune"><p>Aucune étude pour cet AO. ' + e(raison) + '</p><div class="et-btns">' + ((d.veille && d.veille.dce_status === 'ready') ? lancer : '') + '</div></div>';
    }
    if (EN_COURS[et.statut]) {
      return '<div class="et-run" data-etat="en_cours"><p><b>Étude en cours (version ' + et.version + ', ' + (et.type === 'pre' ? 'pré-étude' : 'étude complète') + ').</b> ' + e(et.statut_libelle) +
        '. Lancée le ' + e(dateHeure(et.cree_le)) + '. L\'écran se met à jour seul ; vous pouvez fermer la page, l\'étude continue.</p></div>';
    }
    if (et.statut === 'echec' || et.statut === 'refusee') {
      return '<div class="et-run" data-etat="' + et.statut + '"><p><b>' + (et.statut === 'echec' ? 'Étude en échec' : 'Étude non envoyée') + ' (version ' + et.version + ') :</b> ' + e(et.statut_libelle) + '</p><div class="et-btns">' + lancer.replace('Lancer l\'étude', 'Relancer l\'étude') + '</div></div>';
    }
    var r = et.resultat || {}, lignes = lignesDossier(d, maintenant), c = M.compteursDossier(lignes);
    var cps = nbPagesDe(et, 'cps'), rc = nbPagesDe(et, 'rc'), arts = (r.bordereau && r.bordereau.articles) ? r.bordereau.articles.length : 0;
    var desc = [cps ? 'CPS ' + cps + ' pages' : null, rc ? 'RC ' + rc + ' pages' : null, arts ? 'bordereau ' + arts + ' articles' : 'bordereau non relevé'].filter(function (x) { return x; }).join(', ');
    return '<div class="et-run" data-etat="prete"><p>' + (et.type === 'pre' ? 'Pré-étude' : 'Étude') + ' faite le <b>' + e(dateHeure(et.terminee_le || et.maj_le)) + '</b> sur le DCE téléchargé le ' + e(dateHeure(et.dce && et.dce.telecharge_le)) + ' : ' + e(desc) + '. <b>' + pointsAVerifier(r) + ' points à vérifier.</b> ' +
      (et.type === 'pre' ? 'Pré-étude courte : bordereau et dossier de réponse au bouton « Lancer l\'étude complète ».' : c.pretes + ' pièces du dossier sur ' + c.exigees + ' prêtes.') + ' Coût ' + (et.cout_usd != null ? et.cout_usd.toFixed(2) : '0.00') + ' USD, version ' + et.version + '.</p>' +
      '<div class="et-btns">' + (et.type === 'pre' ? '<button class="et-btn pri" data-action="lancer">Lancer l\'étude complète</button>' : '<button class="et-btn" data-action="lancer">Relancer l\'étude</button>') +
      '<button class="et-btn" data-fichier="etude">Exporter en Word</button>' + (et.type === 'pre' ? '' : '<button class="et-btn pri" data-fichier="bordereau">Ouvrir le bordereau dans Excel</button>') + '</div></div>';
  }
  function dateHeure(iso) {
    if (!iso) return 'date non renseignée';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try { return d.toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (x) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  function carteAvis(r, reg) {
    var a = r.avis;
    if (!a) return '<section class="et-card" data-section="avis"><h2>Avis</h2><p class="et-info">L\'analyse n\'a pas rendu d\'avis : ' + e(M.A_VERIFIER) + '.</p></section>';
    var cls = a.decision === 'ON_Y_VA' ? '' : (a.decision === 'ON_N_Y_VA_PAS' ? ' non' : ' dis');
    var sous = r.conditions.length ? 'sous ' + r.conditions.length + ' condition' + (r.conditions.length > 1 ? 's' : '') : '';
    var li = '';
    if (a.resume) li += '<li data-item="avis">' + e(a.resume) + ' ' + reg.btn({ sources: a.sources }, 'Synthèse de l\'avis') + '</li>';
    for (var i = 0; i < r.conditions.length; i++) li += '<li data-item="condition"><b>Condition ' + (i + 1) + '</b> : ' + e(r.conditions[i].valeur) + ' ' + reg.btn(r.conditions[i], 'Condition de l\'avis') + '</li>';
    for (var j = 0; j < r.raisons.length; j++) li += '<li data-item="raison">' + e(r.raisons[j].valeur) + ' ' + reg.btn(r.raisons[j], 'Raison de l\'avis') + '</li>';
    return '<section class="et-card" data-section="avis"><div class="et-verdict"><div class="et-stamp' + cls + '" aria-label="Avis : ' + e(M.AVIS[a.decision]) + '">' + e(M.AVIS[a.decision]) + (sous ? '<small>' + sous + '</small>' : '') + '</div><div><ul>' + li + '</ul></div></div></section>';
  }
  function carteSynthese(r, extras, reg) {
    var cases = '';
    for (var i = 0; i < M.FAITS.length; i++) {
      var F = M.FAITS[i], it = (r.faits || {})[F.cle];
      var val = it && it.valeur ? it.valeur : 'non relevé dans le dossier';
      var extra = '';
      if (F.cle === 'eclaircissements' && extras && extras.eclaircissements) {
        var ec = extras.eclaircissements;
        extra = '<div class="v" data-calcule="1">' + (ec.date ? 'Jusqu\'au ' + e(M.dateFR(ec.date)) : 'date non calculable') + '</div>' +
          '<button class="et-src warn" data-src="' + reg.items.length + '" data-averifier="1">' + e(M.A_VERIFIER) + ' : date calculée</button>';
        reg.items.push({ item: { sources: [] }, etat: { etat: 'a_verifier', libelle: M.A_VERIFIER, motif: ec.motif }, pourquoi: ec.motif, calcul: true });
      }
      cases += '<div class="et-fact" data-fait="' + F.cle + '"><div class="k">' + e(F.l) + '</div><div class="v">' + e(val) + '</div>' + (it ? reg.btn(it, F.l) : '<button class="et-src warn" data-src="' + reg.items.length + '" data-averifier="1">' + e(M.A_VERIFIER) + '</button>') + extra + '</div>';
      if (!it) reg.items.push({ item: { sources: [] }, etat: { etat: 'a_verifier', libelle: M.A_VERIFIER, motif: 'donnée non relevée par l\'analyse' }, pourquoi: F.l });
    }
    var ecarts = '';
    if (extras && extras.ecarts && extras.ecarts.length) {
      ecarts = '<div class="et-tbl" style="margin-top:12px"><table data-ecarts="1"><thead><tr><th>Comparaison avec la fiche AO</th><th>Dossier</th><th>Fiche</th><th>Résultat</th></tr></thead><tbody>' +
        extras.ecarts.map(function (x) {
          return '<tr data-ecart="' + x.champ + '"' + (x.ecart ? ' data-rouge="1"' : '') + '><td>' + e(x.libelle) + '</td><td' + (x.ecart ? ' class="et-ecart"' : '') + '>' + e(x.dossier) + '</td><td' + (x.ecart ? ' class="et-ecart"' : '') + '>' + e(x.fiche) + '</td><td>' +
            (x.ecart ? '<span class="et-tag bad">Écart : à corriger</span>' : (x.incomplet ? '<span class="et-tag neg">Incomplet : ' + e(M.A_VERIFIER) + '</span>' : '<span class="et-tag ok">Identique</span>')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<section class="et-card" data-section="synthese"><h2>Fiche synthèse</h2><div class="et-facts">' + cases + '</div>' + ecarts + '</section>';
  }
  function carteClauses(r, reg) {
    var rows = (r.clauses || []).map(function (c) {
      var v = M.VERDICTS[c.verdict] || M.VERDICTS.A_SURVEILLER;
      return '<tr data-clause="' + e(c.cle) + '"><td>' + e(M.libelleDe(M.CLAUSES, c.cle)) + '</td><td>' + e(c.absent ? 'Absent du dossier' : c.valeur) + (c.pourquoi ? '<div class="et-note">' + e(c.pourquoi) + '</div>' : '') + '</td><td><span class="et-tag ' + v.c + '">' + v.l + '</span></td><td>' + reg.btn(c, c.pourquoi) + '</td></tr>';
    }).join('');
    return '<section class="et-card" data-section="clauses"><h2>Clauses qui comptent</h2><div class="et-tbl"><table><thead><tr><th>Clause</th><th>Ce que dit le dossier</th><th>Pour nous</th><th>Source</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }
  function carteBordereau(r, extras, et) {
    if (et.type === 'pre') return '';
    var t = extras && extras.totaux;
    var arts = (r.bordereau && r.bordereau.articles) || [];
    if (!t || !arts.length) return '<section class="et-card" data-section="bordereau"><h2>Bordereau des prix</h2><p class="et-info">Aucun article relevé : ' + e(M.A_VERIFIER) + ' dans le DCE.</p></section>';
    var ecart = t.ecart == null ? 'estimation absente' : (t.ecart > 0 ? '+' : '') + String(t.ecart).replace('.', ',') + ' %';
    return '<section class="et-card" data-section="bordereau"><h2>Bordereau des prix <small>' + arts.length + ' articles, au format du kit AO</small></h2><div class="et-bord">' +
      '<div><div class="k">Estimation du maître d\'ouvrage</div><div class="v">' + (t.estimation != null ? e(M.montantFR(t.estimation)) + ' DH TTC' : 'non renseignée') + '</div></div>' +
      '<div><div class="k">Notre prix, marge ' + Math.round(((arts[0] && arts[0].marge) || 0.3) * 100) + ' %</div><div class="v">' + e(M.montantFR(t.ttc)) + ' DH TTC</div></div>' +
      '<div><div class="k">Écart avec l\'estimation</div><div class="v ' + (t.ecart != null && t.ecart <= 0 ? 'd' : 'r') + '" data-ecart-bordereau="1">' + e(ecart) + '</div></div>' +
      '<div><div class="k">PA à confirmer</div><div class="v">' + t.sans_pa + ' article' + (t.sans_pa > 1 ? 's' : '') + '</div></div></div>' +
      '<p class="et-note">Les PA viennent des conditions d\'achat de l\'ERP (' + ((r.bordereau && r.bordereau.catalogue) || 0) + ' prix connus) et des bons de commande des marchés passés. ' +
      (t.sans_pa ? 'Les ' + t.sans_pa + ' articles sans prix connu sont marqués « à consulter » dans l\'Excel, et le total ne les compte pas.' : 'Tous les articles ont un PA estimé.') + '</p></section>';
  }
  function tableDossier(d, reg, maintenant) {
    var lignes = lignesDossier(d, maintenant), c = M.compteursDossier(lignes);
    if (!lignes.length) return '<section class="et-card" data-section="dossier"><h2>Dossier de réponse</h2><p class="et-info">Aucune pièce relevée dans le RC : ' + e(M.A_VERIFIER) + '.</p></section>';
    var rows = '', cur = null;
    for (var i = 0; i < lignes.length; i++) {
      var L = lignes[i];
      if (L.dossier !== cur) { cur = L.dossier; rows += '<tr class="et-gr"><td colspan="4">' + e(M.libelleDe(M.DOSSIERS, cur)) + '</td></tr>'; }
      var st = M.ETATS_LIGNE[L.etat] || { l: L.etat, c: 'neg' };
      var act = '';
      if (L.origine === 'redige' || L.type === 'caution_provisoire') act = '<button class="et-btn sm" data-fichier="' + e(L.type) + '">' + (L.type === 'caution_provisoire' ? 'Lettre à la banque' : 'Ouvrir') + '</button>';
      if (L.origine === 'propose') act = '<button class="et-btn sm" data-valider="' + e(L.type) + '">' + (L.type === 'references' ? 'Valider le choix' : 'Choisir les noms') + '</button>' + (L.etat === 'valide' ? ' <button class="et-btn sm" data-fichier="' + e(L.type) + '">Ouvrir</button>' : '');
      if (L.origine === 'coffre') act = L.action ? '<button class="et-btn sm" data-coffre="' + e(L.type) + '">' + e(L.action) + '</button>' : (L.coffreId ? '<button class="et-btn sm" data-voir-coffre="' + e(L.coffreId) + '">Voir</button>' : '');
      rows += '<tr data-piece="' + e(L.type) + '" data-etat="' + e(L.etat) + '"><td>' + e(L.piece) + (L.precision ? '<div class="et-note">' + e(L.precision) + '</div>' : '') + '<br>' + reg.btn(L, 'Pièce exigée par le RC') + '</td><td>' + e(L.detail || '') + '</td><td><span class="et-tag ' + st.c + '">' + e(st.l) + '</span></td><td>' + act + '</td></tr>';
    }
    return '<section class="et-card" data-section="dossier"><h2>Dossier de réponse <small>toutes les pièces exigées par le RC</small></h2><div class="et-cov" data-compteurs="1">' +
      '<div><b data-c="exigees">' + c.exigees + '</b><span>pièces exigées par le RC</span></div><div class="g"><b data-c="pretes">' + c.pretes + '</b><span>prêtes (rédigées ou jointes)</span></div>' +
      '<div class="a"><b data-c="a_completer">' + c.a_completer + '</b><span>à compléter, signer ou envoyer</span></div><div class="r"><b data-c="manquantes">' + c.manquantes + '</b><span>manquantes ou expirées</span></div></div>' +
      '<div class="et-tbl"><table><thead><tr><th>Pièce exigée</th><th>Ce que MP prépare</th><th>État</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (c.sans_objet ? '<p class="et-note" data-sans-objet="' + c.sans_objet + '">' + c.sans_objet + ' ligne(s) hors compteurs : cas particuliers sans objet pour Neurones (groupement, concurrent étranger…) ou pièce que le RC n\'exige pas. Elles restent affichées.</p>' : '') +
      '<p class="et-note">Trois origines : MP rédige (modèles, mémoire, planning, financier), MP joint depuis le coffre des documents de la société en vérifiant la validité à la date de dépôt, ou MP signale ce que seul quelqu\'un peut produire (qualification, signatures, banque). Rien n\'est déposé sans relecture.</p>' +
      '<div class="et-btns" style="margin-top:10px"><button class="et-btn pri" data-fichier="dossier">Télécharger le dossier complet (zip)</button></div></section>';
  }
  function carteQuestions(r, extras, reg) {
    var qs = r.questions || [];
    var avant = extras && extras.eclaircissements && extras.eclaircissements.date ? ' <small>avant le ' + e(M.dateFR(extras.eclaircissements.date)) + ' (' + e(M.A_VERIFIER) + ')</small>' : '';
    if (!qs.length) return '<section class="et-card" data-section="questions"><h2>Questions à poser au maître d\'ouvrage' + avant + '</h2><p class="et-note">Aucune question relevée.</p></section>';
    return '<section class="et-card" data-section="questions"><h2>Questions à poser au maître d\'ouvrage' + avant + '</h2>' + qs.map(function (q) {
      return '<div class="et-q" data-question="1">' + e(q.question) + '<div class="why">' + e(q.motif) + ' ' + reg.btn(q, q.motif) + '</div></div>';
    }).join('') + '<button class="et-btn" data-action="copier-questions">Copier les questions</button></section>';
  }
  function panneauSource(d, reg, sel) {
    var et = d.courante, fichiers = (et && et.dce && et.dce.fichiers) || [];
    var liste = fichiers.map(function (f) {
      var l = f.lecture === 'texte' ? (f.pages_total ? f.pages_total + ' pages, texte lu' : 'texte lu') : (f.lecture === 'ocr' ? (f.pages_total ? f.pages_total + ' pages, ' : '') + 'lu par OCR' : (f.lecture === 'tableur' ? 'tableur lu' : 'non étudié : ' + (f.motif_lecture || 'motif non renseigné')));
      return '<li><span>' + e(M.LIBELLES_CLASSES[f.classe] || f.classe) + ' — ' + e(String(f.fichier).split('/').pop()) + '</span><span>' + e(l) + '</span></li>';
    }).join('');
    var corps = '<div class="et-docline" data-source-doc="1">Cliquez sur une référence pour afficher l\'extrait exact du dossier.</div>';
    var titre = '';
    var x = sel != null ? reg.items[sel] : null;
    if (x) {
      var s = x.item && x.item.sources && x.item.sources[0];
      if (s) {
        titre = x.etat.libelle;
        corps = '<div class="et-docline" data-source-doc="1">' + e(M.LIBELLES_CLASSES[s.classe] || s.classe) + ' · ' + e(String(s.fichier).split('/').pop()) + (s.page ? ' · page ' + s.page : '') + (s.feuille ? ' · feuille ' + e(s.feuille) + ', ligne ' + s.ligne : '') + '</div>' +
          '<div class="et-excerpt" data-extrait="1">' + (s.avant ? e(s.avant) : '') + '<mark>' + e(s.extrait) + '</mark>' + (s.apres ? e(s.apres) : '') + '</div>' +
          (x.item.sources.length > 1 ? '<div class="et-why">' + (x.item.sources.length - 1) + ' autre(s) extrait(s) cité(s) : ' + x.item.sources.slice(1).map(function (o) { return '« ' + e(o.extrait) + ' »' + (o.page ? ' (p. ' + o.page + ')' : ''); }).join(' ; ') + '</div>' : '');
      } else {
        titre = M.A_VERIFIER;
        corps = '<div class="et-docline" data-source-doc="1">Aucun extrait cité</div><div class="et-excerpt" data-extrait="1">' + e(x.etat.motif || 'aucune citation exacte') + '</div>';
      }
      if (x.pourquoi) corps += '<div class="et-why"><b>Pourquoi c\'est signalé :</b> ' + e(x.pourquoi) + '</div>';
    }
    return '<aside class="et-card et-aside" aria-live="polite" data-panneau-source="1"><h2>Source <small>' + e(titre) + '</small></h2>' + corps + '<ul class="et-files">' + liste + '</ul></aside>';
  }

  function ongletBordereau(d, reg) {
    var r = (d.courante && d.courante.resultat) || {}, b = r.bordereau || {}, arts = b.articles || [], t = d.extras && d.extras.totaux;
    if (!arts.length) return '<section class="et-card"><h2>Bordereau</h2><p class="et-info">Aucun article relevé.</p></section>';
    var rows = '', sec = null;
    for (var i = 0; i < arts.length; i++) {
      var a = arts[i];
      if (a.section && a.section !== sec) { sec = a.section; rows += '<tr class="et-gr"><td colspan="9">' + e(sec) + '</td></tr>'; }
      var pu = M.prixVente(a.pa, a.marge);
      rows += '<tr data-article="' + e(a.num) + '"><td>' + e(a.num) + '</td><td>' + e(a.designation) + '</td><td>' + e(a.unite || 'non renseignée') + '</td><td class="n">' + e(String(a.quantite).replace('.', ',')) + '</td>' +
        '<td class="n">' + (a.pa != null ? e(M.montantFR(a.pa)) : '<span class="et-tag neg">à consulter</span>') + '</td><td>' + e(a.pa_origine || 'aucun PA connu') + '</td><td class="n">' + Math.round((a.marge == null ? 0.3 : a.marge) * 100) + ' %</td>' +
        '<td class="n">' + (pu != null ? e(M.montantFR(pu)) : 'non chiffré') + '</td><td>' + reg.btn(a, 'Article du bordereau') + '</td></tr>';
    }
    var tot = t ? '<tr><td colspan="7" class="n"><b>Total HT</b></td><td class="n"><b>' + e(M.montantFR(t.ht)) + '</b></td><td></td></tr><tr><td colspan="7" class="n">TVA 20 %</td><td class="n">' + e(M.montantFR(t.tva)) + '</td><td></td></tr>' +
      '<tr data-ttc="1"><td colspan="7" class="n"><b>Total TTC</b></td><td class="n"><b>' + e(M.montantFR(t.ttc)) + '</b></td><td data-ecart-ttc="1"><b>Écart avec l\'estimation : ' + (t.ecart == null ? 'estimation absente' : (t.ecart > 0 ? '+' : '') + String(t.ecart).replace('.', ',') + ' %') + '</b></td></tr>' : '';
    var excl = (b.exclues || []).length ? '<p class="et-note">Feuilles non retenues : ' + b.exclues.map(function (x) { return e(x.feuille) + ' (' + e(x.motif) + ')'; }).join(' ; ') + '.</p>' : '';
    return '<section class="et-card" data-section="bordereau-detail"><h2>Bordereau des prix <small>' + arts.length + ' articles · ' + (b.origine === 'tableur' ? 'lu dans le tableur du DCE' : 'relevé par l\'analyse') + '</small></h2>' + excl +
      '<div class="et-tbl"><table><thead><tr><th>N°</th><th>Désignation</th><th>Unité</th><th>Quantité</th><th>PA HT</th><th>Origine du PA</th><th>Marge</th><th>PU vente HT</th><th>Source</th></tr></thead><tbody>' + rows + tot + '</tbody></table></div>' +
      '<p class="et-note">La marge se modifie article par article dans l\'Excel, où les formules restent vivantes.</p><div class="et-btns"><button class="et-btn pri" data-fichier="bordereau">Ouvrir le bordereau dans Excel</button></div></section>';
  }
  function ongletDce(d) {
    var et = d.courante, fs = (et && et.dce && et.dce.fichiers) || [], ex = (et && et.dce && et.dce.ecartes) || [];
    if (!et || !et.dce) return '<section class="et-card"><h2>Fichiers du DCE</h2><p class="et-note">Le DCE n\'a pas encore été déplié par une étude.</p></section>';
    var rows = fs.map(function (f) {
      var l = f.lecture === 'texte' ? 'Texte lu' : (f.lecture === 'ocr' ? 'Lu par OCR' : (f.lecture === 'tableur' ? 'Tableur lu' : 'Non lu'));
      return '<tr><td>' + e(f.fichier) + '</td><td>' + e(M.LIBELLES_CLASSES[f.classe] || f.classe) + '<div class="et-note">' + e(f.motif_classe || '') + '</div></td><td>' + e(l) + (f.motif_lecture ? '<div class="et-note">' + e(f.motif_lecture) + '</div>' : '') + '</td><td class="n">' + (f.pages_total || 'sans pagination') + '</td></tr>';
    }).join('');
    var exr = ex.map(function (x) { return '<tr><td>' + e(x.chemin) + '</td><td colspan="3">Écarté : ' + e(x.motif) + '</td></tr>'; }).join('');
    return '<section class="et-card" data-section="dce"><h2>Fichiers du DCE <small>' + fs.length + ' lus · ' + ex.length + ' écartés</small></h2><div class="et-tbl"><table><thead><tr><th>Fichier</th><th>Classement</th><th>Lecture</th><th>Pages</th></tr></thead><tbody>' + rows + exr + '</tbody></table></div></section>';
  }

  /* Écran complet. d = réponse de /api/etudes ; etat = { onglet, sel } ; renvoie { html, reg }. */
  function htmlEtude(d, etat, maintenant) {
    etat = etat || {};
    var reg = new Reg(), onglet = etat.onglet || 'etude', et = d.courante;
    var corps = '';
    var pret = et && et.statut === 'prete';
    if (onglet === 'etude') {
      if (pret) {
        var r = et.resultat || {};
        corps = carteAvis(r, reg) + carteSynthese(r, d.extras, reg) + carteClauses(r, reg) + carteBordereau(r, d.extras, et) + (et.type === 'pre' ? '' : tableDossier(d, reg, maintenant)) + carteQuestions(r, d.extras, reg);
      }
    } else if (onglet === 'bordereau') corps = pret ? ongletBordereau(d, reg) : '';
    else if (onglet === 'dossier') corps = pret && et.type !== 'pre' ? tableDossier(d, reg, maintenant) : (pret ? '<section class="et-card"><p class="et-note">Pré-étude : le dossier de réponse se prépare avec l\'étude complète.</p></section>' : '');
    else if (onglet === 'dce') corps = ongletDce(d);
    var html = cssTag() + '<div class="et-wrap" data-ecran="etude">' + enTete(d, onglet, maintenant) + barreEtat(d, maintenant) +
      (corps ? '<div class="et-grid"><div class="et-col">' + corps + '</div>' + panneauSource(d, reg, etat.sel) + '</div>' : '') + '</div>';
    return { html: html, reg: reg };
  }

  /* ---------- Documents de la société ---------- */
  function htmlCoffre(docs, maintenant, filtre) {
    var auj = new Date(maintenant || Date.now()).toISOString().slice(0, 10);
    var al = M.alertesCoffre(docs, auj, 15);
    var alertes = al.length ? '<div class="et-alerte" data-a-traiter="' + al.length + '"><b>À traiter : ' + al.length + ' document' + (al.length > 1 ? 's' : '') + ' expiré' + (al.length > 1 ? 's' : '') + ' ou expirant sous 15 jours.</b><ul style="margin:6px 0 0 18px;padding:0">' +
      al.map(function (a) { return '<li>' + e(a.libelle) + ' — ' + e(a.texte) + '</li>'; }).join('') + '</ul></div>' : '<div class="et-info" data-a-traiter="0">Aucun document n\'expire dans les 15 jours.</div>';
    var parType = {};
    for (var i = 0; i < (docs || []).length; i++) { var t = docs[i].type || 'autre'; (parType[t] = parType[t] || []).push(docs[i]); }
    var rows = '';
    for (var k = 0; k < M.COFFRE_TYPES.length; k++) {
      var T = M.COFFRE_TYPES[k];
      if (filtre && filtre !== T.cle) continue;
      var ds = parType[T.cle] || [];
      if (!ds.length) { rows += '<tr data-type="' + T.cle + '"><td>' + e(T.l) + '</td><td colspan="3"><span class="et-tag bad">Absent du coffre</span></td><td><button class="et-btn sm" data-deposer="' + T.cle + '">Déposer</button></td></tr>'; continue; }
      for (var j = 0; j < ds.length; j++) {
        var d = ds[j], v = M.versionCourante(d), st = M.etatPieceCoffre(d, null, auj);
        var bientot = v && v.date_validite && M.ajouterJours(auj, 15) >= v.date_validite && !st.rouge;
        var tag = st.rouge ? 'bad' : (bientot ? 'neg' : 'ok');
        var hist = (d.versions || []).slice().reverse().map(function (x) { return 'v' + x.v + ' déposée le ' + e(M.dateFR((x.depose_le || '').slice(0, 10))) + (x.date_validite ? ', valide jusqu\'au ' + e(M.dateFR(x.date_validite)) : '') + ' <button class="et-btn sm" data-voir-coffre="' + e(d.id) + '" data-v="' + x.v + '">Voir</button>'; }).join('<br>');
        rows += '<tr data-type="' + T.cle + '" data-coffre-etat="' + st.etat + '"><td>' + e(T.l) + '</td><td>' + e(d.libelle || T.l) + (d.marche_ref ? '<div class="et-note">Marché ' + e(d.marche_ref) + '</div>' : '') + '</td><td>' + (v && v.date_emission ? 'Émis le ' + e(M.dateFR(v.date_emission)) : 'Date d\'émission non renseignée') + '<br><span class="et-tag ' + tag + '">' + e(st.libelle) + '</span></td><td style="font-size:13px">' + hist + '</td><td><button class="et-btn sm" data-nouvelle-version="' + e(d.id) + '">Nouvelle version</button></td></tr>';
      }
    }
    return cssTag() + '<div class="et-wrap" data-ecran="coffre">' + alertes + '<section class="et-card"><h2>Documents de la société <small>coffre privé : liens de lecture valables 10 minutes, rien n\'est public</small></h2>' +
      '<div class="et-btns" style="margin-bottom:10px"><button class="et-btn pri" data-deposer="">Déposer un document</button>' + (filtre ? '<button class="et-btn" data-filtre-coffre="">Voir tous les types</button>' : '') + '</div>' +
      '<div class="et-tbl"><table><thead><tr><th>Type</th><th>Document</th><th>Validité</th><th>Versions</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="et-note">Ces pièces sont jointes au dossier de réponse, jamais envoyées à l\'analyse automatique. Une pièce expirée ou qui expire avant la date de dépôt sort en rouge dans le dossier de l\'AO.</p></section></div>';
  }

  /* ---------- Paramètres : étude d'AO ---------- */
  function htmlParams(p, estDg) {
    var pa = p.params || {};
    var sc = (p.scores || []).slice().sort(function (a, b) { return a - b; });
    var q = function (x) { return sc.length ? sc[Math.min(sc.length - 1, Math.floor(sc.length * x))] : 'non calculé'; };
    var nb = function (s) { var n = 0; for (var i = 0; i < sc.length; i++) if (sc[i] >= s) n++; return n; };
    var champ = function (id, lib, val, unite) { return '<label style="display:flex;flex-direction:column;gap:3px;font-size:13px;color:#4a5672">' + lib + '<input class="fc" id="' + id + '" type="number" step="any" value="' + e(val) + '"' + (estDg ? '' : ' disabled') + ' style="font-size:14px">' + (unite ? '<span>' + unite + '</span>' : '') + '</label>'; };
    var liste = (p.etudes_mois || []).map(function (x) { return '<tr><td>' + e(x.ref || 'AO sans référence') + '</td><td>' + (x.type === 'pre' ? 'pré-étude' : 'étude complète') + ' v' + x.version + '</td><td>' + e(x.statut) + '</td><td class="n">' + (x.cout_usd || 0).toFixed(2) + ' USD</td><td class="n">' + (x.duree_s ? Math.round(x.duree_s / 60) + ' min' : 'en cours') + '</td></tr>'; }).join('');
    return '<div class="card" data-param-etude="1" style="margin-top:14px"><div class="sh"><div class="st">Étude d\'AO automatisée</div></div>' +
      '<div style="font-size:13px;color:#4a5672;margin-bottom:8px">Clé de l\'API : ' + (p.cle_configuree ? 'configurée côté serveur' : '<b style="color:#b3261e">non configurée</b>') + ' · modèle ' + e(pa.modele) + ' · traitement par lot (moitié prix).</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">' + champ('ep-seuil', 'Seuil de score pour la pré-étude automatique', pa.seuil_pre_etude) + champ('ep-pe', 'Plafond par étude', pa.plafond_etude_usd, 'USD') + champ('ep-pm', 'Plafond par mois', pa.plafond_mois_usd, 'USD') +
      '<label style="display:flex;gap:6px;align-items:center;font-size:13px;color:#4a5672"><input type="checkbox" id="ep-actif"' + (pa.pre_etude_active !== false ? ' checked' : '') + (estDg ? '' : ' disabled') + '> Pré-étude automatique active</label></div>' +
      '<div class="et-note">Distribution des scores de la veille (' + sc.length + ' AO) : médiane ' + q(0.5) + ', 3e quartile ' + q(0.75) + '. Au seuil ' + e(pa.seuil_pre_etude) + ', ' + nb(pa.seuil_pre_etude) + ' AO sur ' + sc.length + ' auraient eu leur pré-étude.</div>' +
      (estDg ? '<div style="margin-top:8px"><button class="btn btn-sm btn-prim" onclick="etudeEnregistrerParams()">Enregistrer</button></div>' : '<div class="et-note">Modification réservée au DG.</div>') +
      '<div style="margin-top:12px;font-size:14px"><b>Consommation de ' + e(p.mois) + ' : ' + (p.conso_mois_usd || 0).toFixed(2) + ' USD</b> sur ' + e(pa.plafond_mois_usd) + ' USD · ' + (p.etudes_mois || []).length + ' étude(s)</div>' +
      (liste ? '<div class="et-tbl"><table><thead><tr><th>AO</th><th>Étude</th><th>État</th><th>Coût</th><th>Durée</th></tr></thead><tbody>' + liste + '</tbody></table></div>' : '') + '</div>';
  }

  return { CSS: CSS, htmlEtude: htmlEtude, htmlCoffre: htmlCoffre, htmlParams: htmlParams, lignesDossier: lignesDossier, EN_COURS: EN_COURS, dateHeure: dateHeure };
}));

/* =========================================================================
 * Branchement navigateur
 * ========================================================================= */
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  'use strict';
  var M = window.MPEtude, U = window.MPEtudeUI;
  var E = { veilleId: null, data: null, onglet: 'etude', sel: null, reg: null, timer: null, charge: false, erreur: null };
  window.S = window.S || {};

  function pb() { return document.getElementById('pb'); }
  function api(url, opts) { return window.apiFetch ? window.apiFetch(url, opts) : fetch(url, opts).then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ': ' + t); }); return r.json(); }); }
  function msg(t, ok) { if (window.toast) window.toast(t, ok); }

  window.etudeOuvrir = function (veilleId, onglet) {
    E.veilleId = veilleId; E.data = null; E.onglet = onglet || 'etude'; E.sel = null; E.erreur = null;
    window.nav('etude');
  };
  window.etudeBoutonVeille = function (r) {
    if (!r || r.dce_status !== 'ready') return '';
    return '<button class="act" title="Étude du DCE" onclick="etudeOuvrir(\'' + String(r.id).replace(/'/g, '') + '\')" style="color:#1d3a6e;font-weight:600">Étude</button>';
  };
  window.etudeBoutonAO = function (a) {
    if (!a || !a.veille_id) return '';
    return '<button class="act" title="Étude du DCE" onclick="etudeOuvrir(\'' + String(a.veille_id).replace(/'/g, '') + '\')" style="color:#1d3a6e;font-weight:600">Étude</button>';
  };

  function charger() {
    if (!E.veilleId) return;
    api('/api/etudes?veilleId=' + encodeURIComponent(E.veilleId)).then(function (d) {
      E.data = d; E.erreur = null; dessiner(); relancerSiEnCours();
    }).catch(function (x) { E.erreur = x.message; dessiner(); });
  }
  /* Relève tant que l'étude est en cours : AUCUN délai d'attente côté écran, le lot peut durer. */
  function relancerSiEnCours() {
    if (E.timer) { clearTimeout(E.timer); E.timer = null; }
    var c = E.data && E.data.courante;
    if (!c || !U.EN_COURS[c.statut] || window.S.page !== 'etude') return;
    E.timer = setTimeout(function () {
      api('/api/etudes-tick').catch(function () { return null; }).then(function () { if (window.S.page === 'etude') charger(); });
    }, 15000);
  }
  function dessiner() {
    var el = pb(); if (!el || window.S.page !== 'etude') return;
    if (E.erreur) { el.innerHTML = '<div class="info-box info-amber">Étude illisible : ' + window.esc(E.erreur) + '</div>'; return; }
    if (!E.data) { el.innerHTML = '<div style="padding:20px;font-size:14px">Chargement de l\'étude…</div>'; return; }
    try {
      var out = U.htmlEtude(E.data, { onglet: E.onglet, sel: E.sel });
      E.reg = out.reg; el.innerHTML = out.html;
    } catch (x) {
      el.innerHTML = '<div class="info-box info-amber">Écran Étude : affichage impossible (' + window.esc(x.message) + ').</div>';
    }
  }
  function telecharger(quoi) {
    var c = E.data && E.data.courante; if (!c) return;
    msg('Préparation du fichier…');
    fetch('/api/etude-fichier?id=' + encodeURIComponent(c.id) + '&veilleId=' + encodeURIComponent(c.veilleId) + '&quoi=' + encodeURIComponent(quoi)).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      var cd = r.headers.get('Content-Disposition') || '', m = cd.match(/filename\*=UTF-8''([^;]+)/);
      var nom = m ? decodeURIComponent(m[1]) : quoi;
      return r.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nom; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); });
    }).catch(function (x) { msg('Téléchargement impossible : ' + x.message); });
  }
  function lancer() {
    var c = E.data && E.data.courante;
    var type = (c && c.type === 'pre' && c.statut === 'prete') ? 'complete' : 'complete';
    api('/api/etude-lancer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ veilleId: E.veilleId, type: type }) })
      .then(function () { msg('Étude lancée : quelques minutes.', true); charger(); })
      .catch(function (x) { msg('Lancement impossible : ' + x.message); charger(); });
  }
  function valider(quoi) {
    var c = E.data && E.data.courante; if (!c) return;
    if (quoi === 'references') {
      var refs = (E.data.extras && E.data.extras.references) || [];
      var h = '<div style="font-size:13px;margin-bottom:8px">Marchés les plus proches de l\'objet de l\'AO (cochez ceux à présenter) :</div>' + refs.map(function (m, i) {
        return '<label style="display:flex;gap:8px;margin:6px 0;font-size:14px"><input type="checkbox" class="et-ref-ck" data-i="' + i + '" checked><span><b>' + window.esc(m.ref || 'marché sans référence') + '</b> — ' + window.esc(m.objet || m.titre || '') + ' (' + window.esc(m.maitre_ouvrage || 'maître d\'ouvrage non renseigné') + ') · attestation ' + window.esc(m.attestation || 'absente du coffre') + '</span></label>';
      }).join('');
      window.openMod('Références à présenter', h, function () {
        var ch = []; document.querySelectorAll('.et-ref-ck').forEach(function (k) { if (k.checked) { var m = refs[+k.getAttribute('data-i')]; ch.push({ ref: m.ref, objet: m.objet || m.titre, maitre_ouvrage: m.maitre_ouvrage, montant: m.montant }); } });
        envoyerValidation('references', ch);
      });
      return;
    }
    api('/api/etude-fichier?id=' + encodeURIComponent(c.id) + '&veilleId=' + encodeURIComponent(c.veilleId) + '&quoi=personnel').then(function (r) {
      var pers = (r && r.personnel) || [];
      var deja = {}; ((c.validations && c.validations.moyens_humains && c.validations.moyens_humains.choix) || []).forEach(function (x) { deja[x.id] = 1; });
      var h = '<div style="font-size:13px;margin-bottom:8px">Personnel actif (RH, lecture seule : nom et fonction). Cochez l\'équipe affectée :</div><div style="max-height:55vh;overflow:auto">' + pers.map(function (x, i) {
        return '<label style="display:flex;gap:8px;margin:4px 0;font-size:14px"><input type="checkbox" class="et-pers-ck" data-i="' + i + '"' + (deja[x.id] ? ' checked' : '') + '><span>' + window.esc(x.nom) + ' — ' + window.esc(x.poste) + '</span></label>';
      }).join('') + '</div>';
      window.openMod('Moyens humains : choisir les noms', h, function () {
        var ch = []; document.querySelectorAll('.et-pers-ck').forEach(function (k) { if (k.checked) ch.push(pers[+k.getAttribute('data-i')]); });
        envoyerValidation('moyens_humains', ch);
      });
    }).catch(function (x) { msg('Personnel illisible : ' + x.message); });
  }
  function envoyerValidation(quoi, choix) {
    var c = E.data.courante;
    api('/api/etude-valider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ etudeId: c.id, veilleId: c.veilleId, quoi: quoi, choix: choix }) })
      .then(function () { window.closeMod(); msg('Choix enregistré', true); charger(); })
      .catch(function (x) { msg('Enregistrement impossible : ' + x.message); });
  }
  function copierQuestions() {
    var qs = ((E.data.courante.resultat || {}).questions || []).map(function (q, i) { return (i + 1) + '. ' + q.question; }).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(qs).then(function () { msg('Questions copiées', true); }, function () { msg('Copie refusée par le navigateur'); });
  }

  /* ---------- Coffre ---------- */
  var K = { docs: null, filtre: null };
  function chargerCoffre() {
    return api('/api/coffre').then(function (r) { K.docs = (r && r.documents) || []; window.S.coffreDocs = K.docs; if (window.S.page === 'coffre') dessinerCoffre(); return K.docs; })
      .catch(function (x) { if (window.S.page === 'coffre') pb().innerHTML = '<div class="info-box info-amber">Coffre illisible : ' + window.esc(x.message) + '</div>'; });
  }
  function dessinerCoffre() {
    var el = pb(); if (!el) return;
    if (!K.docs) { el.innerHTML = '<div style="padding:20px;font-size:14px">Chargement du coffre…</div>'; return; }
    try { el.innerHTML = U.htmlCoffre(K.docs, Date.now(), K.filtre); } catch (x) { el.innerHTML = '<div class="info-box info-amber">Documents de la société : affichage impossible (' + window.esc(x.message) + ').</div>'; }
  }
  function voirCoffre(id, v) {
    api('/api/coffre-lien?id=' + encodeURIComponent(id) + (v ? '&v=' + encodeURIComponent(v) : '')).then(function (r) { window.open(r.url, '_blank', 'noopener'); }).catch(function (x) { msg('Lien impossible : ' + x.message); });
  }
  function formDepot(type, docId) {
    var doc = docId ? (K.docs || []).filter(function (d) { return d.id === docId; })[0] : null;
    var types = M.COFFRE_TYPES.map(function (t) { return '<option value="' + t.cle + '"' + (((doc && doc.type) || type) === t.cle ? ' selected' : '') + '>' + t.l + '</option>'; }).join('');
    var h = (doc ? '<div style="font-size:14px;margin-bottom:8px">Nouvelle version de : <b>' + window.esc(doc.libelle || M.libelleDe(M.COFFRE_TYPES, doc.type)) + '</b> (les versions précédentes restent dans l\'historique)</div>' :
      '<div class="fg"><label>Type</label><select class="fc" id="cf-type">' + types + '</select></div><div class="fg"><label>Libellé</label><input class="fc" id="cf-lib" placeholder="ex. Attestation fiscale 2026"></div><div class="fg"><label>Marché (pour une attestation de bonne exécution)</label><input class="fc" id="cf-marche" placeholder="référence du marché"></div>') +
      '<div class="fr2"><div class="fg"><label>Date d\'émission</label><input class="fc" id="cf-em" type="date"></div><div class="fg"><label>Date de fin de validité</label><input class="fc" id="cf-val" type="date"></div></div>' +
      '<div class="fg"><label>Fichier (PDF, JPEG, PNG ou Word, 15 Mo au plus)</label><input class="fc" id="cf-fic" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx"></div>';
    window.openMod(doc ? 'Nouvelle version' : 'Déposer un document de la société', h, function () {
      var f = document.getElementById('cf-fic').files[0];
      if (!f) { alert('Choisir un fichier'); return; }
      var rd = new FileReader();
      rd.onload = function () {
        var b64 = String(rd.result).split(',')[1];
        var body = { id: doc ? doc.id : null, type: doc ? doc.type : document.getElementById('cf-type').value, libelle: doc ? null : document.getElementById('cf-lib').value, marche_ref: doc ? null : (document.getElementById('cf-marche').value || null),
          date_emission: document.getElementById('cf-em').value || null, date_validite: document.getElementById('cf-val').value || null, nom_fichier: f.name, mime: f.type, contenu: b64 };
        api('/api/coffre', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function () { window.closeMod(); msg('Document enregistré', true); chargerCoffre(); })
          .catch(function (x) { msg('Dépôt impossible : ' + x.message); });
      };
      rd.readAsDataURL(f);
    });
  }

  /* ---------- Paramètres ---------- */
  window.etudeEnregistrerParams = function () {
    var body = { seuil_pre_etude: document.getElementById('ep-seuil').value, plafond_etude_usd: document.getElementById('ep-pe').value, plafond_mois_usd: document.getElementById('ep-pm').value, pre_etude_active: document.getElementById('ep-actif').checked };
    api('/api/etude-params', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function () { msg('Paramètres de l\'étude enregistrés', true); chargerParams(); }).catch(function (x) { msg('Enregistrement impossible : ' + x.message); });
  };
  function chargerParams() {
    var slot = document.getElementById('param-etude'); if (!slot) return;
    api('/api/etude-params').then(function (p) { slot.innerHTML = U.htmlParams(p, !!window.S._isDg); }).catch(function (x) { slot.innerHTML = '<div class="info-box info-amber">Paramètres de l\'étude illisibles : ' + window.esc(x.message) + '</div>'; });
  }

  /* ---------- Délégation des clics ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-src],[data-onglet],[data-action],[data-fichier],[data-valider],[data-coffre],[data-voir-coffre],[data-deposer],[data-nouvelle-version],[data-filtre-coffre]') : null;
    if (!t || !pb() || !pb().contains(t)) return;
    if (t.hasAttribute('data-src')) { E.sel = +t.getAttribute('data-src'); dessiner(); var a = document.querySelector('[data-panneau-source]'); if (a && a.scrollIntoView && window.innerWidth < 980) a.scrollIntoView({ behavior: 'smooth' }); return; }
    if (t.hasAttribute('data-onglet')) { E.onglet = t.getAttribute('data-onglet'); E.sel = null; dessiner(); return; }
    if (t.hasAttribute('data-fichier')) { telecharger(t.getAttribute('data-fichier')); return; }
    if (t.hasAttribute('data-valider')) { valider(t.getAttribute('data-valider')); return; }
    if (t.hasAttribute('data-coffre')) { K.filtre = t.getAttribute('data-coffre'); window.nav('coffre'); msg('Déposer la nouvelle pièce ici : elle remplacera l\'ancienne dans le dossier.'); return; }
    if (t.hasAttribute('data-voir-coffre')) { voirCoffre(t.getAttribute('data-voir-coffre'), t.getAttribute('data-v')); return; }
    if (t.hasAttribute('data-deposer')) { formDepot(t.getAttribute('data-deposer')); return; }
    if (t.hasAttribute('data-nouvelle-version')) { formDepot(null, t.getAttribute('data-nouvelle-version')); return; }
    if (t.hasAttribute('data-filtre-coffre')) { K.filtre = null; dessinerCoffre(); return; }
    var act = t.getAttribute('data-action');
    if (act === 'lancer') lancer();
    else if (act === 'copier-questions') copierQuestions();
    else if (act === 'fiche') { var f = E.data && E.data.fiche; if (f && window.editAO) { var ok = (window.S.aos || []).some(function (x) { return x.id === f.id; }); if (ok) window.editAO(f.id); else msg('Fiche AO non chargée : rafraîchir'); } }
  });

  /* ---------- Pages ---------- */
  if (typeof window.TITLES !== 'undefined') { window.TITLES.etude = 'Étude d\'AO'; window.TITLES.coffre = 'Documents de la société'; }
  var renderAvant = window.render;
  window.render = function () {
    if (window.S.page === 'etude') { if (!E.data && !E.erreur) charger(); dessiner(); return; }
    if (window.S.page === 'coffre') { if (!K.docs) chargerCoffre(); dessinerCoffre(); return; }
    renderAvant();
    if (window.S.page === 'parametres') { var el = pb(); if (el && !document.getElementById('param-etude')) { var d = document.createElement('div'); d.id = 'param-etude'; el.appendChild(d); } chargerParams(); }
  };
  /* Tableau de bord : rubrique « à traiter » des documents qui expirent. */
  var dashAvant = window.pgDash;
  if (dashAvant) window.pgDash = function () {
    var h = dashAvant();
    var al = M.alertesCoffre(window.S.coffreDocs || [], new Date().toISOString().slice(0, 10), 15);
    if (!al.length) return h;
    return '<div class="ai-box ai-r" data-a-traiter-coffre="' + al.length + '" style="cursor:pointer" onclick="nav(\'coffre\')"><div class="ai-t">À traiter : ' + al.length + ' document(s) de la société expiré(s) ou expirant sous 15 jours</div><div class="ai-s">' +
      al.map(function (a) { return window.esc(a.libelle) + ' — ' + window.esc(a.texte); }).join(' · ') + '</div></div>' + h;
  };
  function lienNav() {
    if (document.querySelector('.ni[data-page="coffre"]')) return;
    var ao = document.querySelector('.ni[data-page="ao"]'); if (!ao) return;
    var n = document.createElement('div'); n.className = 'ni'; n.setAttribute('data-page', 'coffre'); n.style.paddingLeft = '34px'; n.style.fontSize = '12px';
    n.innerHTML = '<span class="ni-ic">&#128274;</span>Documents de la société';
    var apres = document.querySelector('.ni[data-page="veille"]') || ao;
    apres.parentNode.insertBefore(n, apres.nextSibling);
    n.addEventListener('click', function () { K.filtre = null; window.nav('coffre'); });
  }
  function init() { lienNav(); chargerCoffre(); api('/api/etudes-tick').catch(function () { return null; }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 50); }); else setTimeout(init, 50);
})();
