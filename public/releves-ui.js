/* =========================================================================
 * MP - Écran « Relevés banque » (menu Cautions). ES5 strict, 12 px minimum.
 *
 * Import d'un relevé PDF : le texte POSITIONNÉ est extrait dans le navigateur (pdf.js,
 * chargé à la demande), lu par le module pur MPReleves (public/releves-banque.js, le même
 * que le serveur), contrôlé ; l'aperçu montre lignes, écartés, totaux et refus NOMMÉS, les
 * lignes en face de l'image de la page pour correction humaine (cellules éditables, trace).
 * « Importer » envoie pages + corrections + PDF à POST /api/releves-banque : le serveur
 * relit, recontrôle, refuse ou enregistre, rapproche et pose « vue en banque » sur les fiches.
 * Rien n'est écrit tant qu'un contrôle échoue. Jamais d'id technique à l'écran.
 * ========================================================================= */
'use strict';
var RELEVES_PDFJS = {
  src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};
var RELEVES_TYPES_LBL = { CP: 'Provisoire', CD: 'Définitive', RG: 'Retenue de garantie', TRANSIT: 'Transit', DIVERS: 'Divers' };
var RELEVES_VIA_LBL = { reference: 'référence complète', alias: 'alias (n° court)', beneficiaire_montant: 'bénéficiaire + montant' };

function relState() {
  if (!S._rel) S._rel = { banque: '', fichier: null, b64: null, pages: null, images: [], lecture: null, corrections: [], resultat: null, voir: null, lecture_en_cours: false };
  return S._rel;
}
function relPeriodeLbl(p) { if (!p || !/^\d{4}-\d{2}$/.test(p)) return 'période non renseignée'; var mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']; return mois[parseInt(p.slice(5, 7), 10) - 1] + ' ' + p.slice(0, 4); }
function relMad(n) { return (typeof n === 'number' && isFinite(n)) ? new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : 'non renseigné'; }
function relTxt(s, repli) { return (s === null || s === undefined || s === '') ? '<span style="color:var(--ink-muted);font-style:italic">' + esc(repli || 'non renseigné') + '</span>' : esc(s); }

/* ---------- Page ---------- */
function pgReleves() {
  var st = relState();
  var opts = MPReleves.BANQUES.map(function (b) { var dispo = !!MPReleves.LECTEURS[b]; return '<option value="' + esc(b) + '"' + (st.banque === b ? ' selected' : '') + '>' + esc(b) + (dispo ? '' : ' (lecteur à venir)') + '</option>'; }).join('');
  var importCard = '<div class="card" data-releves="import"><div class="sh"><div class="st">Importer un relevé de cautions</div></div>' +
    '<div style="font-size:12px;color:var(--ink-muted);margin-bottom:10px">Un lecteur par banque : FINEA (relevé de commissions, PDF texte) et BMCE (liste d\'encours de l\'agence) sont en ligne ; Attijariwafa (relevé scanné, OCR) et Banque Populaire (lecteur à écrire sur le premier relevé fourni) refusent pour l\'instant, nommément. Rien n\'est enregistré tant qu\'un contrôle d\'intégrité échoue.</div>' +
    '<div class="fr2"><div class="fg"><label>Banque *</label><select class="fc" id="rel-banque" data-releves="banque" onchange="relState().banque=this.value;relevesRendreApercu()"><option value="">- Choisir la banque -</option>' + opts + '</select></div>' +
    '<div class="fg"><label>Relevé (PDF) *</label><input class="fc" type="file" id="rel-file" accept="application/pdf,.pdf" data-releves="fichier" onchange="relevesLire()"></div></div>' +
    '<div id="rel-etat" style="font-size:12px;color:var(--ink-muted)">' + (st.lecture_en_cours ? 'Lecture du PDF…' : (st.fichier ? 'Fichier lu : ' + esc(st.fichier.name) : 'Choisir la banque puis déposer le PDF du relevé.')) + '</div></div>';
  var apercu = '<div id="rel-apercu">' + relevesApercuHTML() + '</div>';
  var resultat = '<div id="rel-resultat">' + (st.resultat ? relevesResultatHTML(st.resultat, 'Résultat de l\'import') : '') + (st.voir ? relevesResultatHTML(st.voir, 'Relevé ' + esc(st.voir.banque) + ' · ' + relPeriodeLbl(st.voir.periode)) : '') + '</div>';
  return importCard + apercu + resultat + relevesHistoriqueHTML();
}

/* ---------- Historique : une ligne par relevé importé ---------- */
function relevesHistoriqueHTML() {
  var rows = (S.releves || []).map(MPReleves.ligneHistorique).sort(function (a, b) { return (b.periode || '') < (a.periode || '') ? -1 : ((b.periode || '') > (a.periode || '') ? 1 : (a.banque < b.banque ? -1 : 1)); });
  var body = rows.length ? rows.map(function (r) {
    return '<tr data-releves="historique-ligne"><td>' + esc(r.banque) + '</td><td>' + esc(relPeriodeLbl(r.periode)) + '</td><td style="font-family:var(--FM)">' + relMad(r.encours_banque) + '</td><td style="font-family:var(--FM)">' + relMad(r.encours_mp) + '</td><td style="font-family:var(--FM);color:' + (r.ecart ? 'var(--terra)' : 'inherit') + '">' + relMad(r.ecart) + '</td><td>' + (r.anomalies ? '<span class="badge bp">' + r.anomalies + '</span>' : '0') + '</td><td>' + (r.inconnues || 0) + ' / ' + (r.absentes || 0) + '</td><td style="font-family:var(--FM)">' + (r.commissions === null || r.commissions === undefined ? 'sans commissions' : relMad(r.commissions)) + '</td><td>' + (r.importe_le ? fdat(r.importe_le) : 'non renseigné') + '</td><td><button class="btn btn-sm" onclick="relevesVoir(\'' + esc(r.id) + '\')">Voir</button></td></tr>';
  }).join('') : '<tr><td colspan="10"><div class="empty">Aucun relevé importé pour l\'instant.</div></td></tr>';
  return '<div class="card" data-releves="historique"><div class="sh"><div class="st">Historique des relevés — ' + rows.length + ' importé(s)</div></div><div class="tw"><table><thead><tr><th>Banque</th><th>Période</th><th>Encours banque</th><th>Encours MP</th><th>Écart</th><th>Anomalies (b)</th><th>Sans fiche / absentes (c)</th><th>Commissions</th><th>Importé le</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

/* ---------- pdf.js : chargement à la demande, extraction des lignes positionnées ---------- */
function relevesChargerPdfjs(cb) {
  if (window.pdfjsLib) { cb(); return; }
  var s = document.createElement('script'); s.src = RELEVES_PDFJS.src;
  s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = RELEVES_PDFJS.worker; } catch (e) {} cb(); };
  s.onerror = function () { toast('pdf.js n\'a pas pu être chargé (réseau) : lecture impossible', false); var st = relState(); st.lecture_en_cours = false; render(); };
  document.head.appendChild(s);
}
/* Items pdf.js -> lignes { y, items:[{x,str}] } : même y (à 2 unités près) = même ligne, items triés par x. */
function relevesLignesDepuisItems(items) {
  var lignes = [];
  (items || []).forEach(function (it) {
    var str = String(it.str || '').trim(); if (!str) return;
    var x = it.transform ? it.transform[4] : 0, y = it.transform ? it.transform[5] : 0;
    var l = null;
    for (var i = 0; i < lignes.length; i++) { if (Math.abs(lignes[i].y - y) <= 2) { l = lignes[i]; break; } }
    if (!l) { l = { y: y, items: [] }; lignes.push(l); }
    l.items.push({ x: x, str: str });
  });
  lignes.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); });
  lignes.sort(function (a, b) { return b.y - a.y; });
  return lignes;
}
function relevesExtraire(pdf, avecImages) {
  var pages = [], images = [], n = pdf.numPages;
  function unePage(i) {
    if (i > n) return Promise.resolve({ pages: pages, images: images });
    return pdf.getPage(i).then(function (page) {
      return page.getTextContent().then(function (tc) {
        pages.push({ numero: i, lignes: relevesLignesDepuisItems(tc.items) });
        if (!avecImages) return null;
        var vp = page.getViewport({ scale: 1.1 });
        var canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () { images[i - 1] = canvas.toDataURL('image/jpeg', 0.7); }).catch(function () { images[i - 1] = null; });
      });
    }).then(function () { return unePage(i + 1); });
  }
  return unePage(1);
}

/* ---------- Lecture d'un fichier déposé ---------- */
function relevesLire() {
  var st = relState();
  var inp = document.getElementById('rel-file'); var f = inp && inp.files && inp.files[0];
  st.banque = (document.getElementById('rel-banque') || {}).value || st.banque;
  if (!f) return;
  if (!st.banque) { toast('Choisir la banque avant de déposer le relevé', false); inp.value = ''; return; }
  st.fichier = { name: f.name, size: f.size, type: f.type }; st.lecture = null; st.pages = null; st.images = []; st.corrections = []; st.resultat = null; st.lecture_en_cours = true;
  render();
  var reader = new FileReader();
  reader.onload = function () {
    var ab = reader.result;
    var bytes = new Uint8Array(ab), bin = '', i;
    for (i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    st.b64 = btoa(bin);
    relevesChargerPdfjs(function () {
      window.pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) { return relevesExtraire(pdf, true); }).then(function (r) {
        st.pages = r.pages; st.images = r.images;
        st.lecture = MPReleves.lire(st.banque, st.pages);
        st.lecture_en_cours = false;
        render();
      }).catch(function (e) { st.lecture_en_cours = false; toast('PDF illisible : ' + (e && e.message ? e.message : 'erreur'), false); render(); });
    });
  };
  reader.readAsArrayBuffer(f);
}

/* ---------- Aperçu : lignes, écartés, totaux, contrôles, image de page en face ---------- */
function relevesApercuHTML() {
  var st = relState(), L = st.lecture;
  if (!L) return '';
  var ctl = L.controle || { ok: false, refus: L.refus || [] };
  var refusHTML = ctl.ok
    ? '<div class="badge bs" data-releves="controle" data-etat="ok">Contrôles d\'intégrité : OK — ' + L.lignes.length + ' ligne(s) lue(s)' + (L.ecartes.length ? ', ' + L.ecartes.length + ' écartée(s) nommée(s)' : ', 0 écartée') + '</div>'
    : '<div data-releves="controle" data-etat="refus" style="background:var(--terra-pale);border:1px solid var(--terra-mid);border-radius:5px;padding:10px 12px"><div style="font-weight:600;color:var(--terra)">Relevé NON importable — ' + ctl.refus.length + ' refus nommé(s)</div><ul style="margin:6px 0 0 16px;font-size:12px">' + ctl.refus.map(function (r) { return '<li><b>' + esc(r.code) + '</b> : ' + esc(r.detail) + '</li>'; }).join('') + '</ul><div style="font-size:12px;margin-top:6px;color:var(--ink-soft)">Corriger les cellules en face de l\'image de la page (chaque correction est tracée), ou corriger le fichier et le redéposer. Rien n\'est enregistré tant qu\'un refus subsiste.</div></div>';
  var periodeHTML = L.periode
    ? '<div style="font-size:12px">Période lue dans le document : <b>' + esc(relPeriodeLbl(L.periode)) + '</b></div>'
    : '<div class="fg" style="max-width:260px"><label style="font-size:12px">Période (non lue dans le document, à saisir) *</label><input class="fc" type="month" id="rel-periode" data-releves="periode" value="' + esc(st.periode_saisie || '') + '" onchange="relState().periode_saisie=this.value"></div>';
  var totaux = L.totaux || {};
  var totHTML = '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;margin:8px 0">' +
    (typeof totaux.commissions === 'number' ? '<span>Total commissions du relevé : <b style="font-family:var(--FM)">' + relMad(totaux.commissions) + '</b> (Σ lignes ' + relMad(totaux.commissions_lignes) + (totaux.commissions_ecartees ? ', frais écartés ' + relMad(totaux.commissions_ecartees) : '') + ')</span>' : '') +
    (typeof totaux.encours === 'number' ? '<span>Encours total du document : <b style="font-family:var(--FM)">' + relMad(totaux.encours) + '</b> · ' + totaux.nombre + ' dossier(s) annoncé(s)</span>' : '') +
    (L.banque === 'BMCE Bank' ? '<span>Σ montants lus : <b style="font-family:var(--FM)">' + relMad(totaux.encours_lignes) + '</b></span>' : '') + '</div>';
  var ecartes = L.ecartes.length ? '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px">' + L.ecartes.length + ' ligne(s) écartée(s), motif nommé</summary><ul style="font-size:12px;margin:4px 0 0 16px">' + L.ecartes.map(function (e) { return '<li>' + esc(e.texte) + ' — <i>' + esc(e.motif) + '</i></li>'; }).join('') + '</ul></details>' : '<div style="font-size:12px;color:var(--ink-muted)">0 ligne écartée.</div>';
  var pagesHTML = (st.pages || []).map(function (p, pi) {
    var lignesPage = []; L.lignes.forEach(function (l, idx) { if (l.page === p.numero) lignesPage.push({ l: l, idx: idx }); });
    if (!lignesPage.length) return '';
    var img = st.images[pi] ? '<img src="' + st.images[pi] + '" alt="page ' + p.numero + ' du relevé" style="width:100%;border:1px solid var(--line);border-radius:4px">' : '<div style="font-size:12px;color:var(--ink-muted)">Image de la page non disponible.</div>';
    var tbl = '<div class="tw"><table style="font-size:12px"><thead><tr><th>Type</th><th>Référence</th><th>Bénéficiaire</th><th>Marché</th><th>Délivrance</th><th>Montant</th><th>Commission</th></tr></thead><tbody>' + lignesPage.map(function (x) { return relevesLigneEditableHTML(x.l, x.idx); }).join('') + '</tbody></table></div>';
    return '<div style="margin-top:12px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">Page ' + p.numero + ' — ' + lignesPage.length + ' ligne(s)</div><div style="display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1.4fr);gap:12px;align-items:start">' + img + tbl + '</div></div>';
  }).join('');
  var corr = st.corrections.length ? '<div style="font-size:12px;margin-top:8px" data-releves="corrections">' + st.corrections.length + ' correction(s) humaine(s), tracée(s) à l\'import : ' + st.corrections.map(function (c) { return esc(c.champ) + ' de la ligne ' + (c.index + 1) + ' → ' + esc(String(c.valeur)); }).join(' ; ') + '</div>' : '';
  var bouton = '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn btn-prim" data-releves="importer" onclick="relevesImporter()"' + (ctl.ok ? '' : ' disabled title="Un contrôle d\'intégrité échoue : relevé non importable"') + '>Importer et rapprocher</button><span style="font-size:12px;color:var(--ink-muted)">Le serveur relit le document avec le même lecteur, rejoue les contrôles, puis rapproche avec nos cautions ' + esc(L.banque) + '.</span></div>';
  return '<div class="card" data-releves="apercu"><div class="sh"><div class="st">Aperçu — ' + esc(L.banque) + (st.fichier ? ' · ' + esc(st.fichier.name) : '') + '</div></div>' + refusHTML + '<div style="margin-top:8px">' + periodeHTML + '</div>' + totHTML + ecartes + pagesHTML + corr + bouton + '</div>';
}
function relevesLigneEditableHTML(l, idx) {
  function cell(champ, val, aff) { return '<td contenteditable="true" spellcheck="false" data-idx="' + idx + '" data-champ="' + champ + '" onblur="relevesCorriger(this)" title="Cliquer pour corriger (tracé)" style="min-width:60px">' + (val === null || val === undefined ? '<span style="color:var(--ink-muted);font-style:italic">non lu</span>' : esc(aff !== undefined ? aff : val)) + '</td>'; }
  return '<tr>' + cell('type', l.type, RELEVES_TYPES_LBL[l.type] ? l.type : l.type) + cell('reference', l.reference) + cell('beneficiaire', l.beneficiaire) + cell('marche', l.marche) + cell('date_delivrance', l.date_delivrance, l.date_delivrance ? fdat(l.date_delivrance) : null) + cell('montant', l.montant, l.montant !== null ? relMad(l.montant) + (l.montant_deduit ? ' (déduit)' : '') : null) + cell('commission', l.commission, l.commission !== null ? relMad(l.commission) : null) + '</tr>';
}
/* Cellule corrigée : on enregistre la correction (index, champ, valeur) et on rejoue lecture + corrections. */
function relevesCorriger(td) {
  var st = relState(); if (!st.lecture || !st.pages) return;
  var idx = parseInt(td.getAttribute('data-idx'), 10), champ = td.getAttribute('data-champ');
  var brut = String(td.textContent || '').trim();
  var valeur = brut;
  if (champ === 'montant' || champ === 'commission') { valeur = brut.replace(/\s|MAD|\(déduit\)/g, ''); valeur = valeur === '' || /^non/i.test(brut) ? null : valeur.replace(/\./g, '').replace(',', '.'); if (valeur !== null) { valeur = Number(valeur); if (!isFinite(valeur)) { toast('Montant illisible : « ' + brut + ' »', false); render(); return; } } }
  else if (champ === 'date_delivrance') { var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brut); valeur = m ? (m[3] + '-' + m[2] + '-' + m[1]) : (/^\d{4}-\d{2}-\d{2}$/.test(brut) ? brut : null); if (brut && !valeur) { toast('Date illisible : « ' + brut + ' » (JJ/MM/AAAA)', false); render(); return; } }
  else if (/^non lu$/i.test(brut) || brut === '') valeur = null;
  st.corrections = st.corrections.filter(function (c) { return !(c.index === idx && c.champ === champ); });
  st.corrections.push({ index: idx, champ: champ, valeur: valeur });
  st.lecture = MPReleves.lire(st.banque, st.pages);
  MPReleves.appliquerCorrections(st.lecture, st.corrections, (S._user && S._user.email) || null);
  render();
}

/* ---------- Import ---------- */
function relevesImporter() {
  var st = relState(); if (!st.lecture || !st.pages) return;
  var periode = st.lecture.periode || st.periode_saisie || (document.getElementById('rel-periode') || {}).value || '';
  if (!st.lecture.periode && !MPReleves.periodeValide(periode)) { toast('Saisir la période du relevé (mois) : elle n\'est pas lue dans le document', false); return; }
  var btn = document.querySelector('[data-releves="importer"]'); if (btn) { btn.disabled = true; btn.textContent = 'Import en cours…'; }
  apiFetch('/api/releves-banque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banque: st.banque, periode: periode, nom_original: st.fichier && st.fichier.name, content_type: 'application/pdf', data_base64: st.b64, pages: st.pages, corrections: st.corrections }) })
    .then(function (r) {
      st.resultat = r.releve; st.lecture = null; st.pages = null; st.images = []; st.b64 = null; st.corrections = []; st.fichier = null;
      return apiFetch('/api/releves-banque').catch(function () { return S.releves || []; }).then(function (liste) { S.releves = liste || []; });
    })
    .then(function () { return apiList('cautions').then(function (cs) { S.cautions = cs; }).catch(function () {}); })
    .then(function () { toast('Relevé importé et rapproché'); render(); })
    .catch(function (e) {
      // apiFetch rejette avec « HTTP <code>: <corps> » : on relit le corps JSON pour nommer le refus.
      var body = null, m = /^HTTP (\d+): ([\s\S]*)$/.exec((e && e.message) || '');
      if (m) { try { body = JSON.parse(m[2]); } catch (x) { body = null; } }
      if (body && body.refus && st.lecture) { st.lecture.controle = { ok: false, refus: body.refus }; toast('Refusé : ' + body.code, false); }
      else toast('Import refusé : ' + (e && e.message ? e.message : 'erreur'), false);
      render();
    });
}

/* ---------- Résultat du rapprochement (import ou relevé historisé) ---------- */
function relevesFicheLbl(f) {
  if (!f) return 'fiche inconnue';
  var num = f.referenceBanque ? esc(f.referenceBanque) + (f.num && MPReleves.normaliserRef(f.num) !== MPReleves.normaliserRef(f.referenceBanque) ? ' <span style="color:var(--ink-muted)">(alias ' + esc(f.num) + ')</span>' : '') : relTxt(f.num, 'n° non renseigné');
  return num + ' · ' + esc(TC[f.type] || (f.type === 'provisoire' ? 'Caution provisoire' : f.type)) + ' · ' + relTxt(f.marche_ref, 'marché non renseigné');
}
function relevesResultatHTML(doc, titre) {
  var rp = doc.rapprochement || {}, enc = rp.encours || {}, cpt = rp.compteurs || {};
  var tete = '<div class="card" style="background:var(--forest);color:var(--cream);border-color:var(--forest)"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">' +
    '<div><div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--green-mid)">Encours banque</div><div style="font-family:var(--FM);font-size:22px">' + relMad(enc.banque) + '</div>' + (enc.lignes_sans_montant ? '<div style="font-size:12px;color:var(--green-mid)">' + enc.lignes_sans_montant + ' ligne(s) sans montant (commission au plancher)</div>' : '') + '</div>' +
    '<div><div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--green-mid)">Encours MP (actives)</div><div style="font-family:var(--FM);font-size:22px">' + relMad(enc.mp) + '</div></div>' +
    '<div><div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--green-mid)">Écart</div><div style="font-family:var(--FM);font-size:22px">' + relMad(enc.ecart) + '</div><div style="font-size:12px;color:var(--green-mid)">reste inexpliqué : ' + relMad(enc.reste) + '</div></div></div>' +
    '<div style="font-size:12px;margin-top:8px;color:var(--cream)">' + (enc.explication || []).map(function (x) { return x.signe + ' ' + esc(x.libelle) + ' : <span style="font-family:var(--FM)">' + relMad(x.montant) + '</span>'; }).join(' &middot; ') + '</div></div>';
  function groupe(cle, lbl, items, rendu, vide) {
    return '<details ' + (items.length && cle !== 'a' ? 'open' : '') + ' style="border:1px solid var(--line);border-radius:5px;margin-bottom:10px;background:var(--cream)" data-releves="groupe-' + cle + '"><summary style="cursor:pointer;padding:10px 14px;font-weight:600;color:var(--forest)">' + lbl + ' — ' + items.length + '</summary><div style="padding:0 14px 12px">' + (items.length ? '<div class="tw"><table style="font-size:12px"><tbody>' + items.map(rendu).join('') + '</tbody></table></div>' : '<div style="font-size:12px;color:var(--ink-muted)">' + vide + '</div>') + '</div></details>';
  }
  var ligneTxt = function (l) { return '<b>' + esc(l.type) + '</b> ' + esc(l.reference) + ' · ' + relTxt(l.beneficiaire, 'bénéficiaire non lu') + ' · ' + relTxt(l.marche, 'marché non lu') + ' · ' + (l.date_delivrance ? fdat(l.date_delivrance) : 'date non lue') + ' · <span style="font-family:var(--FM)">' + relMad(l.montant) + (l.montant_deduit ? ' (déduit)' : '') + '</span>' + (typeof l.commission === 'number' ? ' · commission ' + relMad(l.commission) : ''); };
  var a = groupe('a', '(a) En banque et active chez nous', rp.a || [], function (x) { return '<tr><td>' + ligneTxt(x.ligne) + '</td><td>' + relevesFicheLbl(x.fiche) + '</td><td style="color:var(--ink-muted)">' + esc(RELEVES_VIA_LBL[x.via] || x.via) + (x.ecart_montant ? ' · <span style="color:var(--terra)">écart de montant ' + relMad(x.ecart_montant) + '</span>' : '') + '</td></tr>'; }, 'Aucune.');
  var b = groupe('b', '(b) ANOMALIE — en banque mais libérée, restituée ou en mainlevée chez nous', rp.b || [], function (x) { return '<tr style="background:var(--terra-pale)"><td>' + ligneTxt(x.ligne) + '</td><td>' + relevesFicheLbl(x.fiche) + ' · ' + esc((SMC[x.fiche.statut] || { l: x.fiche.statut }).l) + '</td><td>mainlevée demandée le ' + (x.date_mainlevee ? fdat(x.date_mainlevee) : 'date non renseignée') + (x.date_liberation ? ', libérée le ' + fdat(x.date_liberation) : '') + (x.mois_depuis_mainlevee !== null && x.mois_depuis_mainlevee !== undefined ? ' · ' + x.mois_depuis_mainlevee + ' mois avant la période' : '') + (typeof x.commission_relevee === 'number' ? ' · commission facturée ce relevé ' + relMad(x.commission_relevee) : ' · commission non portée par le document') + '</td></tr>'; }, 'Aucune : la banque ne facture plus rien de libéré chez nous.');
  var inc = groupe('inconnues', 'En banque, sans fiche chez nous', rp.inconnues || [], function (x, i) { return '<tr><td>' + ligneTxt(x.ligne) + '</td><td style="color:var(--ink-muted)">' + esc(x.motif || '') + '</td><td>' + (x.ligne.type === 'CD' || x.ligne.type === 'RG' ? '<button class="btn btn-sm" onclick="relevesCreerFiche(\'' + esc(doc.id) + '\',' + i + ')">Créer la fiche</button>' : (x.ligne.type === 'CP' ? '<span style="font-size:12px">provisoire : créer d\'abord l\'appel d\'offres</span>' : '')) + '</td></tr>'; }, 'Aucune.');
  var c = groupe('c', '(c) Active chez nous, absente du relevé — à expliquer', rp.c || [], function (x) { return '<tr><td>' + relevesFicheLbl(x.fiche) + ' · <span style="font-family:var(--FM)">' + relMad(x.fiche.montant) + '</span></td><td style="color:var(--ink-muted)">' + esc(x.motif || '') + '</td></tr>'; }, 'Aucune : toutes nos actives ' + esc(doc.banque) + ' figurent sur le relevé.');
  var compteurs = '<div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px">' + (cpt.lignes || 0) + ' ligne(s) du relevé · (a) ' + (cpt.a || 0) + ' · (b) ' + (cpt.b || 0) + ' · sans fiche ' + (cpt.inconnues || 0) + ' · (c) ' + (cpt.c || 0) + ' · ' + (cpt.fiches || 0) + ' fiche(s) ' + esc(doc.banque) + ' chez nous' + (doc.corrections && doc.corrections.length ? ' · ' + doc.corrections.length + ' correction(s) humaine(s) tracée(s)' : '') + '</div>';
  return '<div class="card" data-releves="resultat"><div class="sh"><div class="st">' + titre + '</div>' + (doc.importe_le ? '<div style="font-size:12px;color:var(--ink-muted)">importé le ' + fdat(doc.importe_le) + (doc.importe_par ? ' par ' + esc(doc.importe_par) : '') + '</div>' : '') + '</div>' + compteurs + tete + a + b + inc + c + '</div>';
}
function relevesVoir(id) {
  var st = relState();
  apiFetch('/api/releves-banque?id=' + encodeURIComponent(id)).then(function (doc) { st.voir = doc; st.resultat = null; render(); var el = document.getElementById('rel-resultat'); if (el && el.scrollIntoView) el.scrollIntoView(); }).catch(function (e) { toast('Relevé illisible : ' + (e && e.message ? e.message : 'erreur'), false); });
}
/* « Créer la fiche » depuis une ligne du relevé sans fiche : ouvre le formulaire caution
   pré-rempli (référence complète, alias = référence, type, montant, date, banque) ; le
   marché reste à choisir par l'utilisateur. */
function relevesCreerFiche(releveId, i) {
  var st = relState();
  var doc = (st.resultat && st.resultat.id === releveId) ? st.resultat : ((st.voir && st.voir.id === releveId) ? st.voir : null);
  var x = doc && doc.rapprochement && doc.rapprochement.inconnues && doc.rapprochement.inconnues[i]; if (!x) return;
  var l = x.ligne;
  newCaution();
  setTimeout(function () {
    var set = function (id, val) { var el = document.getElementById(id); if (el && val !== null && val !== undefined) el.value = val; };
    set('cref', l.reference); set('cnum', l.reference); set('cmnt', l.montant); set('cdem', l.date_delivrance);
    set('ctype', l.type === 'RG' ? 'retenue_garantie' : 'bonne_execution');
    var sel = document.getElementById('c_banque'); if (sel) { sel.value = doc.banque; if (sel.value !== doc.banque) { sel.value = '__OTHER__'; set('c_banque_autre', doc.banque); } }
  }, 0);
}

/* ---------- Écran Cautions : « vue en banque <période> » / absence sur deux relevés ---------- */
function vueBanqueHTML(c) {
  if (typeof MPReleves === 'undefined' || !c || !c.banque) return '';
  if (!MPCaution.isBlocked(c)) return '';
  var rel = (S.releves || []).filter(function (r) { return r.banque === c.banque; });
  if (!rel.length) return '';
  var sig = MPReleves.signalAbsence(c, rel);
  if (sig) return '<div style="font-size:12px;color:var(--terra);margin-top:2px" data-vue-banque="absente" title="Relevés importés de ' + esc(c.banque) + '">' + esc(sig) + '</div>';
  var v = c.derniere_vue_banque;
  if (v && v.periode) return '<div style="font-size:12px;color:var(--ink-muted);margin-top:2px" data-vue-banque="vue">vue en banque ' + esc(relPeriodeLbl(v.periode)) + '</div>';
  return '<div style="font-size:12px;color:var(--ink-muted);margin-top:2px" data-vue-banque="jamais">jamais vue sur un relevé importé</div>';
}
