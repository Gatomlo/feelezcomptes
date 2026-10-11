(function () {
  "use strict";

  // Chemin de montage de l'app (ex. '/budget-foyer' si une passerelle Node monte
  // plusieurs outils sous des sous-dossiers, '' si servie a la racine). Deduit de
  // l'URL reelle utilisee pour charger ce script (balise <script src="app.js">,
  // volontairement relative) : fonctionne sans configuration a coder en dur.
  var BASE = (function () {
    try {
      var scriptUrl = document.currentScript && document.currentScript.src;
      if (!scriptUrl) return '';
      return new URL('.', scriptUrl).pathname.replace(/\/$/, '');
    } catch (e) { return ''; }
  })();

  var MONTH_ABBREVS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
  var ICONS = [
    '🛒', '🍽️', '☕', '🍕', '🍎', '🚗', '⛽', '🚌', '🚆', '✈️',
    '🏠', '💡', '🔥', '💧', '📶', '📱', '💻', '🎉', '🎬', '🎮',
    '📚', '🎵', '⚽', '🏋️', '👕', '👗', '👟', '💄', '🧴', '💊',
    '🏥', '🦷', '🐾', '🎁', '👶', '🎓', '🧳', '🏖️', '💳', '🏦',
    '📄', '🛡️', '💰', '🧾', '🔧', '🐶', '🌳', '❤️'
  ];
  var DEFAULT_ICON = '🏷️';
  var TAG_COLORS = [
    '#2B5F6B', '#A9711F', '#3E7D4C', '#A23E33', '#6B5B95', '#B5495B', '#4F6D7A', '#8C5E58',
    '#3F6B2F', '#8A4B9E', '#1F7A6C', '#B0562A', '#5A5FA8', '#9E4A6A', '#2E7D8C', '#7A6B1F',
    '#4F8C3E', '#A83E7A', '#2F5F9E', '#8C5F1F', '#6B3E8C', '#3E8C7A', '#9E2F4A', '#5F7A2F'
  ];

  // Couleur d'un budget ou d'un tag : celle choisie manuellement si elle existe,
  // sinon une couleur stable dérivée de l'identifiant. monthKey sert à retrouver
  // un budget éphémère (qui n'existe que dans le mois indiqué).
  function tagColor(id, monthKey) {
    var env = state.recurring.envelopes.find(function (e) { return e.id === id; });
    if (env && env.color) return env.color;
    if (!env) {
      var monthData = state.months[monthKey || selectedMonthKey];
      var eph = monthData && monthData.ephemeralEnvelopes && monthData.ephemeralEnvelopes.find(function (e) { return e.id === id; });
      if (eph && eph.color) return eph.color;
    }
    var tag = state.recurring.tags.find(function (t) { return t.id === id; });
    if (tag && tag.color) return tag.color;
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  }

  // Couleur stable d'un mode de paiement, dérivée de son identifiant (pas de
  // personnalisation manuelle pour ceux-ci, contrairement aux budgets et tags).
  function paymentColor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return TAG_COLORS[(h + 3) % TAG_COLORS.length];
  }

  var state = null;
  var currentUsername = '';
  var isAuthenticated = false;
  var booted = false;

  var uiRestore = restoreUiState();
  var selectedMonthKey = uiRestore.month || currentMonthKey();
  var currentPage = uiRestore.page || 'dashboard';
  var selectedYear = uiRestore.year || new Date().getFullYear();
  var movementGroupBy = uiRestore.groupBy || 'week';
  var statsCols = uiRestore.statsCols || { income: true, budget: true, tags: true, payment: true };
  var editingMovementId = null;
  // Palette de couleurs (budget ou tag) actuellement dépliée, une seule à la fois —
  // vaut 'tag-<id>' ou 'env-<id>', ou null si aucune n'est ouverte. État d'affichage
  // pur, jamais publié.
  var colorGridOpenFor = null;
  // Modale d'icône de budget actuellement ouverte — vaut 'env-<id>' ou 'eph-<id>',
  // ou null. Même logique que colorGridOpenFor : état d'affichage pur.
  var iconModalTarget = null;
  // Formulaire de création d'un nouveau budget : affiché dans une modale plutôt
  // qu'en permanence dans la grille des budgets, pour ne pas alourdir la vue.
  var addEnvelopeModalOpen = false;
  var pendingConfirmAction = null;
  var pendingConfirmMessage = '';
  var pendingConfirmExtra = null;
  var pendingConfirmMainLabel = 'Confirmer';
  // Un seul accordéon ouvert à la fois : si un état restauré en contenait plusieurs
  // (ancienne session), on ne garde que le dernier.
  var restoredAccordions = uiRestore.openAccordions || [];
  var openAccordions = new Set(restoredAccordions.length ? [restoredAccordions[restoredAccordions.length - 1]] : []);
  var loginError = '';
  var accountMessage = '';
  var accountError = false;
  var movementSearchQuery = '';
  var movementTypeFilter = 'all';

  function requestConfirm(message, action, onClose, extra, mainLabel) {
    pendingConfirmMessage = message;
    pendingConfirmAction = action;
    pendingConfirmExtra = extra || null;
    pendingConfirmMainLabel = mainLabel || 'Confirmer';
    var openDlg = document.getElementById('movement-modal');
    if (openDlg && openDlg.open) openDlg.close();
    render();
    var dlg = document.getElementById('confirm-dialog');
    if (dlg) {
      if (onClose) dlg.addEventListener('close', onClose, { once: true });
      dlg.showModal();
    }
  }

  var moneyFmt = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
  var monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

  function defaultState() {
    return { recurring: { incomes: [], fixedExpenses: [], envelopes: [], tags: [], paymentMethods: [] }, months: {}, settings: { weekStartDay: 1, defaultPaymentMethodId: null } };
  }

  function migrateState(st) {
    Object.keys(st.months || {}).forEach(function (key) {
      var m = st.months[key];
      if (!m.movements) {
        var movements = [];
        (m.extraIncomes || []).forEach(function (i) { movements.push({ id: i.id, date: key + '-01', type: 'income', label: i.name, amount: i.amount, envelopeId: null, tagId: null }); });
        (m.extraFixedExpenses || []).forEach(function (f) { movements.push({ id: f.id, date: key + '-01', type: 'expense', label: f.name, amount: f.amount, envelopeId: null, tagId: null }); });
        (m.expenses || []).forEach(function (e) { movements.push({ id: e.id, date: key + '-' + String((e.week || 0) * 7 + 1).padStart(2, '0'), type: 'expense', label: e.label, amount: e.amount, envelopeId: e.envId, tagId: null }); });
        m.movements = movements;
        delete m.extraIncomes; delete m.extraFixedExpenses; delete m.expenses;
      }
      m.movements.forEach(function (mv) {
        if (mv.tagId === undefined) mv.tagId = null;
        if (mv.paymentMethodId === undefined) mv.paymentMethodId = null;
      });
      if (!m.envelopeAmounts) m.envelopeAmounts = {};
      if (!m.envelopeWeeks) m.envelopeWeeks = {};
      if (!m.fixedPaid) m.fixedPaid = {};
      if (!m.ephemeralEnvelopes) m.ephemeralEnvelopes = [];
      if (!m.incomeAmounts) m.incomeAmounts = {};
      if (!m.fixedAmounts) m.fixedAmounts = {};
      if (!m.removedIncomes) m.removedIncomes = [];
      if (!m.removedFixed) m.removedFixed = [];
      if (!m.removedEnvelopes) m.removedEnvelopes = [];
    });
    (st.recurring.envelopes || []).forEach(function (env) {
      if (!env.icon) env.icon = DEFAULT_ICON;
      if (env.startMonth === undefined) env.startMonth = null;
      if (env.endMonth === undefined) env.endMonth = null;
    });
    (st.recurring.incomes || []).forEach(function (i) { if (i.startMonth === undefined) i.startMonth = null; if (i.endMonth === undefined) i.endMonth = null; });
    (st.recurring.fixedExpenses || []).forEach(function (f) { if (f.startMonth === undefined) f.startMonth = null; if (f.endMonth === undefined) f.endMonth = null; });
    if (!st.recurring.tags) st.recurring.tags = [];
    if (!st.recurring.paymentMethods) st.recurring.paymentMethods = [];
    if (!st.settings) st.settings = { weekStartDay: 1 };
    if (st.settings.weekStartDay == null) st.settings.weekStartDay = 1;
    if (st.settings.defaultPaymentMethodId === undefined) st.settings.defaultPaymentMethodId = null;
    delete st.settings.auth; // l'authentification vit désormais côté serveur, jamais dans cet état.
    return st;
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) {
    var v = Math.round((n || 0) * 100) / 100;
    return moneyFmt.format(v);
  }

  function movementMatchesQuery(m, q) {
    if (m.label && m.label.toLowerCase().indexOf(q) !== -1) return true;
    if (String(m.amount).indexOf(q) !== -1) return true;
    if (fmt(m.amount).toLowerCase().indexOf(q) !== -1) return true;
    return false;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function monthKeyAdd(key, delta) {
    var parts = key.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
  }

  function monthLabel(key) {
    var parts = key.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
    var s = monthFmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatDateShort(d) {
    if (!d || d.length < 10) return '';
    return d.slice(8, 10) + '/' + d.slice(5, 7);
  }

  function daysInMonth(key) {
    var parts = key.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  }

  // Numéro de semaine calendaire (lundi-dimanche), indépendant du changement d'année.
  // Jour de départ de semaine configurable (0=dimanche … 6=samedi, 1=lundi par défaut).
  function weekStartDay() {
    return (state.settings && state.settings.weekStartDay != null) ? state.settings.weekStartDay : 1;
  }

  function weekStartIndex(dateUTC) {
    var REF = Date.UTC(1970, 0, 4 + weekStartDay()); // 1970-01-04 est un dimanche
    return Math.floor((dateUTC.getTime() - REF) / 86400000 / 7);
  }

  function weekStartDateOfIndex(w) {
    return new Date(w * 7 * 86400000 + Date.UTC(1970, 0, 4 + weekStartDay()));
  }

  // Semaines de 7 jours pleines (démarrant au jour configuré) attribuées à ce mois :
  // une semaine à cheval sur deux mois est comptée entièrement dans celui où elle a
  // le plus de jours (jamais coupée en deux). Donne toujours 4 ou 5 semaines, jamais plus.
  function monthWeeks(key) {
    var parts = key.split('-').map(Number);
    var totalDays = daysInMonth(key);
    var monthStartMs = Date.UTC(parts[0], parts[1] - 1, 1);
    var monthEndMs = Date.UTC(parts[0], parts[1] - 1, totalDays);
    var firstWeek = weekStartIndex(new Date(monthStartMs));
    var lastWeek = weekStartIndex(new Date(monthEndMs));
    var weeks = [];
    for (var w = firstWeek; w <= lastWeek; w++) {
      var weekStartMs = weekStartDateOfIndex(w).getTime();
      var count = 0;
      for (var i = 0; i < 7; i++) {
        var dayMs = weekStartMs + i * 86400000;
        if (dayMs >= monthStartMs && dayMs <= monthEndMs) count++;
      }
      if (count >= 4) weeks.push(w);
    }
    return weeks;
  }

  function isISODate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // Mois budgétaire d'une date : celui auquel sa semaine pleine est attribuée (même
  // règle que monthWeeks — le mois où la semaine a au moins 4 jours, donc celui de son
  // 4e jour). Ex. avec des semaines du samedi au vendredi : le 01/10 appartient à la
  // dernière semaine de septembre, le 03/10 à la première d'octobre.
  function budgetMonthKeyForDate(dateStr) {
    var parts = dateStr.split('-').map(Number);
    var start = weekStartDateOfIndex(weekStartIndex(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))));
    var mid = new Date(start.getTime() + 3 * 86400000);
    return mid.getUTCFullYear() + '-' + pad2(mid.getUTCMonth() + 1);
  }

  // Mois dans lequel un mouvement est affiché et compté : celui de sa date (mois
  // budgétaire), quel que soit le mois affiché au moment de sa saisie (storedKey).
  // Exception : un mouvement rattaché à un budget ponctuel reste dans le mois de ce
  // budget, qui n'existe nulle part ailleurs.
  function movementMonthKey(st, mv, storedKey) {
    if (!isISODate(mv.date)) return storedKey;
    var eph = (st.months[storedKey] && st.months[storedKey].ephemeralEnvelopes) || [];
    if (mv.envelopeId && eph.some(function (e) { return e.id === mv.envelopeId; })) return storedKey;
    return budgetMonthKeyForDate(mv.date);
  }

  function findMovementMonthKey(id) {
    return Object.keys(state.months).find(function (k) {
      return (state.months[k].movements || []).some(function (mv) { return mv.id === id; });
    }) || null;
  }

  // Attribue une date à sa semaine calendaire pleine dans ce mois. Une date dont la
  // semaine appartient majoritairement au mois voisin (ex. le 31 dans une semaine à
  // cheval sur le mois suivant) est absorbée par la tranche la plus proche. Si
  // weeksCount a été réduit manuellement, l'excédent est absorbé par la dernière tranche.
  function weekIndexForDate(dateStr, monthKey, weeksCount) {
    var parts = (isISODate(dateStr) ? dateStr : monthKey + '-01').split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    var w = weekStartIndex(d);
    var weeks = monthWeeks(monthKey);
    var idx = weeks.indexOf(w);
    if (idx === -1) idx = (weeks.length && w < weeks[0]) ? 0 : weeks.length - 1;
    return Math.min(weeksCount - 1, Math.max(0, idx));
  }

  // Libellé de la semaine idx (peut chevaucher le mois voisin dans son libellé).
  function weekRangeLabel(monthKey, idx) {
    var weeks = monthWeeks(monthKey);
    var w = idx < weeks.length ? weeks[idx] : weeks[weeks.length - 1] + (idx - weeks.length + 1);
    var start = weekStartDateOfIndex(w);
    var end = new Date(start.getTime() + 6 * 86400000);
    return pad2(start.getUTCDate()) + '/' + pad2(start.getUTCMonth() + 1) + '-' + pad2(end.getUTCDate()) + '/' + pad2(end.getUTCMonth() + 1);
  }

  function autoSplit(amount, n) {
    n = Math.max(1, n | 0);
    var base = Math.round((amount / n) * 100) / 100;
    var arr = new Array(n).fill(base);
    var sumSoFar = Math.round(base * (n - 1) * 100) / 100;
    arr[n - 1] = Math.round((amount - sumSoFar) * 100) / 100;
    return arr;
  }

  function ensureMonth(key) {
    if (!state.months[key]) {
      // Pas de weeksCount ici : il est calculé automatiquement à partir du vrai
      // calendrier (4, 5 ou 6 semaines) tant que l'utilisateur ne le force pas
      // explicitement via « Semaines ce mois-ci ».
      state.months[key] = { envelopeAmounts: {}, envelopeWeeks: {}, fixedPaid: {}, movements: [], ephemeralEnvelopes: [], incomeAmounts: {}, fixedAmounts: {}, removedIncomes: [], removedFixed: [], removedEnvelopes: [] };
    }
    return state.months[key];
  }

  // Un revenu ou une dépense fixe n'existe que dans les mois compris entre son
  // démarrage et sa fin (bornes optionnelles) : ainsi, en arrêter un ou en ajouter
  // un nouveau n'affecte jamais rétroactivement les mois déjà passés.
  function isActiveInMonth(item, monthKey) {
    if (item.startMonth && monthKey < item.startMonth) return false;
    if (item.endMonth && monthKey >= item.endMonth) return false;
    return true;
  }

  function computeMonthView(st, key, cache) {
    if (cache[key]) return cache[key];
    var carry = 0;
    var monthData = st.months[key] || {};
    var weeksCount = monthData.weeksCount || monthWeeks(key).length;
    var monthMovements = [];
    Object.keys(st.months).forEach(function (k) {
      (st.months[k].movements || []).forEach(function (m) {
        if (movementMonthKey(st, m, k) === key) monthMovements.push(m);
      });
    });
    var movements = monthMovements.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return 0;
    }).map(function (m) {
      return Object.assign({}, m, { weekIndex: weekIndexForDate(m.date, key, weeksCount) });
    });

    var incomeLines = st.recurring.incomes.filter(function (i) {
      return isActiveInMonth(i, key) && (monthData.removedIncomes || []).indexOf(i.id) === -1;
    }).map(function (i) {
      var amount = (monthData.incomeAmounts && monthData.incomeAmounts[i.id] != null) ? monthData.incomeAmounts[i.id] : i.amount;
      return { id: i.id, name: i.name, amount: amount };
    });
    var recurringIncomeTotal = incomeLines.reduce(function (s, i) { return s + i.amount; }, 0);
    // Un revenu rattaché à un budget est un remboursement qui recrédite ce budget (voir
    // computeEnvelopeView) : il réduit la dépense nette plutôt que de s'ajouter au revenu
    // du mois. Seuls les revenus sans budget comptent comme du revenu réel disponible.
    var movementIncomes = movements.filter(function (m) { return m.type === 'income'; });
    var envelopeTiedIncomeTotal = movementIncomes.filter(function (m) { return m.envelopeId; }).reduce(function (s, m) { return s + m.amount; }, 0);
    var movementIncomeTotal = movementIncomes.filter(function (m) { return !m.envelopeId; }).reduce(function (s, m) { return s + m.amount; }, 0);
    var totalIncome = recurringIncomeTotal + movementIncomeTotal;
    var available = carry + totalIncome;

    var fixedLines = st.recurring.fixedExpenses.filter(function (f) {
      return isActiveInMonth(f, key) && (monthData.removedFixed || []).indexOf(f.id) === -1;
    }).map(function (f) {
      var amount = (monthData.fixedAmounts && monthData.fixedAmounts[f.id] != null) ? monthData.fixedAmounts[f.id] : f.amount;
      var paid = !!(monthData.fixedPaid && monthData.fixedPaid[f.id]);
      return { id: f.id, name: f.name, amount: amount, paid: paid };
    });
    var recurringFixedTotal = fixedLines.filter(function (f) { return f.paid; }).reduce(function (s, f) { return s + f.amount; }, 0);
    var recurringFixedDue = fixedLines.reduce(function (s, f) { return s + f.amount; }, 0);
    var movementExpenses = movements.filter(function (m) { return m.type === 'expense'; });
    var movementExpenseTotal = movementExpenses.reduce(function (s, m) { return s + m.amount; }, 0);
    var totalOutflow = recurringFixedTotal + movementExpenseTotal - envelopeTiedIncomeTotal;

    function computeEnvelopeView(env, isEphemeral) {
      var amount = (!isEphemeral && monthData.envelopeAmounts && monthData.envelopeAmounts[env.id] != null) ? monthData.envelopeAmounts[env.id] : env.amount;
      var weeks = (monthData.envelopeWeeks && monthData.envelopeWeeks[env.id]) || null;
      if (!weeks || weeks.length !== weeksCount) weeks = autoSplit(amount, weeksCount);
      // Les revenus liés à ce budget (ex: remboursement) le recréditent au lieu de le
      // débiter, d'où le filtre sur tous les mouvements (pas seulement les dépenses).
      var envMovements = movements.filter(function (m) { return m.envelopeId === env.id; });
      var spentByWeek = weeks.map(function (_, idx) {
        return envMovements.filter(function (m) { return m.weekIndex === idx; })
          .reduce(function (s, m) { return s + (m.type === 'income' ? -m.amount : m.amount); }, 0);
      });
      // Un dépassement sur une semaine grève le budget de la semaine suivante (report du
      // seul déficit, jamais du surplus) : effectiveWeeks est le budget réellement
      // disponible chaque semaine une fois ce report appliqué (weeks reste la valeur
      // brute éditable par l'utilisateur).
      var effectiveWeeks = weeks.slice();
      var carryDeficit = 0;
      for (var wIdx = 0; wIdx < effectiveWeeks.length; wIdx++) {
        effectiveWeeks[wIdx] = effectiveWeeks[wIdx] - carryDeficit;
        var weekOverage = spentByWeek[wIdx] - effectiveWeeks[wIdx];
        carryDeficit = weekOverage > 0 ? weekOverage : 0;
      }
      var spentTotal = spentByWeek.reduce(function (a, b) { return a + b; }, 0);
      return { id: env.id, name: env.name, icon: env.icon || DEFAULT_ICON, amount: amount, weeksCount: weeksCount, weeks: weeks, effectiveWeeks: effectiveWeeks, movements: envMovements, spentByWeek: spentByWeek, spentTotal: spentTotal, remaining: amount - spentTotal, ephemeral: !!isEphemeral };
    }
    var envelopes = st.recurring.envelopes.filter(function (env) {
      return isActiveInMonth(env, key) && (monthData.removedEnvelopes || []).indexOf(env.id) === -1;
    }).map(function (env) { return computeEnvelopeView(env, false); })
      .concat((monthData.ephemeralEnvelopes || []).map(function (env) { return computeEnvelopeView(env, true); }));
    var totalEnvelopeBudget = envelopes.reduce(function (s, e) { return s + e.amount; }, 0);
    var totalEnvelopeSpent = envelopes.reduce(function (s, e) { return s + e.spentTotal; }, 0);
    var plannedRemaining = available - recurringFixedTotal - totalEnvelopeBudget;
    var endingBalance = available - totalOutflow;

    var view = {
      key: key, carry: carry, incomeLines: incomeLines, recurringIncomeTotal: recurringIncomeTotal, movementIncomeTotal: movementIncomeTotal, totalIncome: totalIncome, available: available,
      recurringFixedTotal: recurringFixedTotal, recurringFixedDue: recurringFixedDue, fixedLines: fixedLines, movementExpenseTotal: movementExpenseTotal, totalOutflow: totalOutflow,
      weeksCount: weeksCount, envelopes: envelopes, totalEnvelopeBudget: totalEnvelopeBudget, totalEnvelopeSpent: totalEnvelopeSpent,
      plannedRemaining: plannedRemaining, endingBalance: endingBalance, movements: movements
    };
    cache[key] = view;
    return view;
  }

  // --- mutations ---
  // Un revenu ou une dépense fixe n'est jamais supprimé rétroactivement : l'arrêter
  // fixe seulement le mois à partir duquel il ne compte plus, les mois précédents
  // gardent leur calcul intact (même logique que pour le montant mensuel des budgets).
  function addIncome(name, amount, startMonth) { state.recurring.incomes.push({ id: uid('inc'), name: name, amount: amount, startMonth: startMonth || null, endMonth: null }); }
  function endIncome(key, id) { var it = state.recurring.incomes.find(function (i) { return i.id === id; }); if (it) it.endMonth = key; }
  // Retire ce revenu uniquement pour ce mois précis (les autres mois, passés comme
  // futurs, continuent de le compter normalement) — alternative à endIncome, qui lui
  // l'arrête définitivement à partir de ce mois.
  function removeIncomeThisMonth(key, id) {
    var m = ensureMonth(key);
    if (!m.removedIncomes) m.removedIncomes = [];
    if (m.removedIncomes.indexOf(id) === -1) m.removedIncomes.push(id);
  }
  function setMonthIncomeAmount(key, incomeId, amount) { var m = ensureMonth(key); m.incomeAmounts[incomeId] = amount; }

  function addFixed(name, amount, startMonth) { state.recurring.fixedExpenses.push({ id: uid('fix'), name: name, amount: amount, startMonth: startMonth || null, endMonth: null }); }
  function endFixed(key, id) { var it = state.recurring.fixedExpenses.find(function (f) { return f.id === id; }); if (it) it.endMonth = key; }
  function removeFixedThisMonth(key, id) {
    var m = ensureMonth(key);
    if (!m.removedFixed) m.removedFixed = [];
    if (m.removedFixed.indexOf(id) === -1) m.removedFixed.push(id);
  }
  function setMonthFixedAmount(key, fixedId, amount) { var m = ensureMonth(key); m.fixedAmounts[fixedId] = amount; }
  function toggleFixedPaid(key, fixedId) {
    var m = ensureMonth(key);
    if (m.fixedPaid[fixedId]) delete m.fixedPaid[fixedId]; else m.fixedPaid[fixedId] = true;
  }

  function addEnvelope(name, amount, icon) { state.recurring.envelopes.push({ id: uid('env'), name: name, amount: amount, icon: icon || DEFAULT_ICON, startMonth: null, endMonth: null }); }
  // Arrête ce budget à partir de ce mois (les mois passés restent inchangés) —
  // même logique que endIncome/endFixed.
  function endEnvelope(key, id) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.endMonth = key; }
  // Retire ce budget uniquement pour ce mois précis — alternative à endEnvelope.
  function removeEnvelopeThisMonth(key, id) {
    var m = ensureMonth(key);
    if (!m.removedEnvelopes) m.removedEnvelopes = [];
    if (m.removedEnvelopes.indexOf(id) === -1) m.removedEnvelopes.push(id);
  }
  function setEnvelopeIcon(id, icon) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.icon = icon; }
  function renameEnvelope(id, name) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.name = name; }
  function setEnvelopeColor(id, color) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.color = color; }

  // Budgets éphémères : n'existent que pour un seul mois, jamais dans state.recurring.
  function addEphemeralEnvelope(key, name, amount, icon) {
    var m = ensureMonth(key);
    if (!m.ephemeralEnvelopes) m.ephemeralEnvelopes = [];
    m.ephemeralEnvelopes.push({ id: uid('eph'), name: name, amount: amount, icon: icon || DEFAULT_ICON });
  }
  function removeEphemeralEnvelope(key, id) {
    var m = state.months[key];
    if (!m) return;
    m.ephemeralEnvelopes = (m.ephemeralEnvelopes || []).filter(function (e) { return e.id !== id; });
    delete m.envelopeWeeks[id];
    m.movements = m.movements.filter(function (mv) { return mv.envelopeId !== id; });
  }
  function renameEphemeralEnvelope(key, id, name) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.name = name;
  }
  function setEphemeralEnvelopeAmount(key, id, amount) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.amount = amount;
    if (m) delete m.envelopeWeeks[id];
  }
  function setEphemeralEnvelopeIcon(key, id, icon) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.icon = icon;
  }
  function setEphemeralEnvelopeColor(key, id, color) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.color = color;
  }

  function addTag(name) { var id = uid('tag'); state.recurring.tags.push({ id: id, name: name }); return id; }
  function renameTag(id, name) { var it = state.recurring.tags.find(function (t) { return t.id === id; }); if (it) it.name = name; }
  function setTagColor(id, color) { var it = state.recurring.tags.find(function (t) { return t.id === id; }); if (it) it.color = color; }
  function removeTag(id) {
    state.recurring.tags = state.recurring.tags.filter(function (t) { return t.id !== id; });
    Object.keys(state.months).forEach(function (k) {
      state.months[k].movements.forEach(function (mv) { if (mv.tagId === id) mv.tagId = null; });
    });
  }

  function addPaymentMethod(name, icon) { state.recurring.paymentMethods.push({ id: uid('pay'), name: name, icon: icon || DEFAULT_ICON }); }
  function renamePaymentMethod(id, name) { var it = state.recurring.paymentMethods.find(function (p) { return p.id === id; }); if (it) it.name = name; }
  function setPaymentMethodIcon(id, icon) { var it = state.recurring.paymentMethods.find(function (p) { return p.id === id; }); if (it) it.icon = icon; }
  function setDefaultPaymentMethod(id) { state.settings.defaultPaymentMethodId = id || null; }
  function removePaymentMethod(id) {
    state.recurring.paymentMethods = state.recurring.paymentMethods.filter(function (p) { return p.id !== id; });
    if (state.settings.defaultPaymentMethodId === id) state.settings.defaultPaymentMethodId = null;
    Object.keys(state.months).forEach(function (k) {
      state.months[k].movements.forEach(function (mv) { if (mv.paymentMethodId === id) mv.paymentMethodId = null; });
    });
  }

  function setMonthEnvelopeAmount(key, envId, amount) {
    var m = ensureMonth(key);
    m.envelopeAmounts[envId] = amount;
    delete m.envelopeWeeks[envId];
  }

  // Nombre de semaines effectif d'un mois (forcé manuellement, ou calculé sur le calendrier réel).
  function monthWeeksCountFor(key) {
    var m = state.months[key];
    return (m && m.weeksCount) || monthWeeks(key).length;
  }

  // Mois qui suivent fromKey (sur les 12 mois suivants, qu'ils existent déjà ou non
  // dans l'état) et comptent le même nombre de semaines — cibles valables pour
  // répercuter une modification de budget. Un mois pas encore visité est créé à la
  // volée si l'utilisateur confirme la répercussion (voir setMonthEnvelopeAmount).
  function futureMonthsWithSameWeeks(fromKey) {
    var fromCount = monthWeeksCountFor(fromKey);
    var results = [];
    for (var i = 1; i <= 12; i++) {
      var k = monthKeyAdd(fromKey, i);
      if (monthWeeksCountFor(k) === fromCount) results.push(k);
    }
    return results;
  }

  // Les 12 mois suivants, sans condition (contrairement aux budgets, un revenu ou
  // une dépense fixe n'a pas de découpage hebdomadaire à faire correspondre).
  function futureMonths(fromKey) {
    var results = [];
    for (var i = 1; i <= 12; i++) results.push(monthKeyAdd(fromKey, i));
    return results;
  }

  function setWeeksCount(key, n) {
    var m = ensureMonth(key);
    m.weeksCount = Math.max(1, Math.min(5, Math.round(n)));
    m.envelopeWeeks = {};
  }

  function setWeekStartDay(day) {
    state.settings.weekStartDay = Math.max(0, Math.min(6, Math.round(day)));
  }

  // Le budget du mois reste corrélé aux semaines : modifier une semaine met à jour
  // le total du mois (somme des semaines), tout comme modifier le total du mois
  // recalcule déjà les semaines (autoSplit).
  function setEnvelopeWeekAmount(key, envId, weekIdx, amount, isEphemeral) {
    var m = ensureMonth(key);
    var view = computeMonthView(state, key, {});
    var env = view.envelopes.find(function (e) { return e.id === envId; });
    var weeks = env ? env.weeks.slice() : [];
    weeks[weekIdx] = amount;
    m.envelopeWeeks[envId] = weeks;
    var total = weeks.reduce(function (a, b) { return a + b; }, 0);
    if (isEphemeral) {
      var eph = (m.ephemeralEnvelopes || []).find(function (e) { return e.id === envId; });
      if (eph) eph.amount = total;
    } else {
      m.envelopeAmounts[envId] = total;
    }
  }

  function addMovement(key, date, type, label, amount, envelopeId, tagId, paymentMethodId) {
    var m = ensureMonth(key);
    m.movements.push({ id: uid('mv'), date: date || todayISO(), type: type === 'income' ? 'income' : 'expense', label: label, amount: amount, envelopeId: envelopeId || null, tagId: tagId || null, paymentMethodId: paymentMethodId || null });
  }
  function updateMovement(key, id, date, type, label, amount, envelopeId, tagId, paymentMethodId) {
    // Le mouvement peut être stocké dans un autre mois que celui affiché (voir movementMonthKey).
    var storedKey = findMovementMonthKey(id);
    var m = state.months[storedKey];
    var mv = m && m.movements.find(function (x) { return x.id === id; });
    if (!mv) return;
    // Re-range le mouvement dans le mois affiché, dont viennent les budgets proposés
    // dans le formulaire (un budget ponctuel n'existe que dans ce mois-là).
    if (storedKey !== key) {
      m.movements = m.movements.filter(function (x) { return x.id !== id; });
      ensureMonth(key).movements.push(mv);
    }
    mv.date = date || todayISO();
    mv.type = type === 'income' ? 'income' : 'expense';
    mv.label = label;
    mv.amount = amount;
    mv.envelopeId = envelopeId || null;
    mv.tagId = tagId || null;
    mv.paymentMethodId = paymentMethodId || null;
  }
  function removeMovement(key, id) {
    var m = state.months[findMovementMonthKey(id) || key];
    if (m) m.movements = m.movements.filter(function (mv) { return mv.id !== id; });
  }

  function mutate(fn) {
    fn();
    commit();
  }

  function navigateMonth(delta) {
    editingMovementId = null;
    selectedMonthKey = monthKeyAdd(selectedMonthKey, delta);
    render();
  }

  function navigatePage(page) {
    editingMovementId = null;
    currentPage = page;
    render();
  }

  function navigateYear(delta) {
    selectedYear += delta;
    render();
  }

  // --- persistence côté client (préférences d'affichage seulement) ---
  function stashUi() {
    try { sessionStorage.setItem('fee-lezcomptes-ui', JSON.stringify({ month: selectedMonthKey, page: currentPage, year: selectedYear, groupBy: movementGroupBy, statsCols: statsCols, openAccordions: Array.from(openAccordions) })); } catch (e) {}
  }
  function restoreUiState() {
    try {
      var raw = sessionStorage.getItem('fee-lezcomptes-ui');
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 4000);
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (el) { el.classList.remove('field-error'); });
  }
  function markFieldError(form, fieldName) {
    var el = form.querySelector('[name="' + fieldName + '"]');
    if (el) el.classList.add('field-error');
    return el;
  }

  function commit() {
    render();
    stashUi();
    saveState();
  }

  // --- API serveur ---
  function apiFetch(url, options) {
    options = options || {};
    options.credentials = 'same-origin';
    if (options.body && typeof options.body !== 'string') {
      options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      options.body = JSON.stringify(options.body);
    }
    return fetch(BASE + url, options);
  }

  // --- Synchronisation et hors-ligne ---
  // L'état vit d'abord sur l'appareil (localStorage) : chaque modification y est
  // écrite tout de suite puis envoyée au serveur dès que possible. Le serveur numérote
  // ses versions ; si quelqu'un a modifié le budget entre-temps (409), on fusionne à
  // trois (dernier état serveur connu / local / serveur actuel) puis on renvoie.
  var STORE_KEY = 'fee-lezcomptes-data';
  var baseState = null;   // dernier état reçu du serveur : ancêtre commun de la fusion
  var baseVersion = null;
  var dirty = false;      // modifications locales pas encore acceptées par le serveur
  var online = true;      // serveur joignable au dernier essai
  var syncing = false;
  var syncAgain = false;
  var retryTimer = null;
  var renderDeferred = false;

  function persistLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ state: state, base: baseState, version: baseVersion, dirty: dirty, user: currentUsername })); } catch (e) {}
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch (e) { return null; }
  }
  function clearLocal() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isPlainObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function idList(arr) { return arr.every(function (x) { return isPlainObj(x) && typeof x.id === 'string'; }); }
  function scalarList(arr) { return arr.every(function (x) { return x === null || typeof x !== 'object'; }); }

  // Fusion à trois (undefined = absent). Ce qui n'a changé que d'un côté est repris ;
  // listes d'objets à `id` fusionnées élément par élément, listes simples comme des
  // ensembles ; vrai conflit : l'appareil l'emporte, et une modification l'emporte
  // sur une suppression.
  function merge3(base, mine, theirs) {
    if (sameJson(mine, theirs)) return mine;
    if (sameJson(mine, base)) return theirs;
    if (sameJson(theirs, base)) return mine;
    if (isPlainObj(mine) && isPlainObj(theirs)) {
      var bo = isPlainObj(base) ? base : {};
      var out = {};
      Object.keys(Object.assign({}, bo, theirs, mine)).forEach(function (k) {
        var v = merge3(bo[k], mine[k], theirs[k]);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (Array.isArray(mine) && Array.isArray(theirs)) {
      var ba = Array.isArray(base) ? base : [];
      if (idList(mine) && idList(theirs) && idList(ba)) {
        var index = function (arr) { var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m; };
        var bm = index(ba), mm = index(mine), tm = index(theirs);
        var ids = theirs.map(function (x) { return x.id; });
        mine.forEach(function (x) { if (!tm[x.id]) ids.push(x.id); });
        var res = [];
        ids.forEach(function (id) { var v = merge3(bm[id], mm[id], tm[id]); if (v !== undefined) res.push(v); });
        return res;
      }
      if (scalarList(mine) && scalarList(theirs) && scalarList(ba)) {
        var kept = theirs.filter(function (x) { return !(ba.indexOf(x) !== -1 && mine.indexOf(x) === -1); });
        mine.forEach(function (x) { if (ba.indexOf(x) === -1 && kept.indexOf(x) === -1) kept.push(x); });
        return kept;
      }
    }
    if (mine === undefined) return theirs;
    return mine;
  }

  // Ne pas redessiner sous une fenêtre ouverte (saisie en cours) : on attend sa fermeture.
  function safeRender() {
    if (document.querySelector('#app dialog[open]')) { renderDeferred = true; return; }
    render();
  }

  function updateSyncStatus() {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var show = isAuthenticated && !online;
    el.hidden = !show;
    if (show) el.textContent = '📴 Hors ligne' + (dirty ? ' · modifications gardées sur l’appareil' : '');
  }
  function setOnline(v) {
    if (online === v) return;
    online = v;
    updateSyncStatus();
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { if (dirty) syncNow(); else pullState(); }, 15000);
  }

  // Reçoit un état serveur : fusionne avec les modifications locales éventuelles.
  function receiveRemote(remote, version) {
    remote = migrateState(remote || defaultState());
    state = (dirty && state) ? merge3(baseState, state, remote) : clone(remote);
    baseState = clone(remote);
    baseVersion = version;
    persistLocal();
  }
  function versionOf(r) {
    var v = r.headers.get('X-State-Version');
    return v != null && /^\d+$/.test(v) ? Number(v) : null;
  }
  function handleUnauthorized() {
    // Session expirée : on garde la copie locale (et ses modifications) pour après la reconnexion.
    isAuthenticated = false;
    updateSyncStatus();
    render();
  }

  function saveState() {
    dirty = true;
    persistLocal();
    updateSyncStatus();
    syncNow();
  }

  function syncNow() {
    if (!dirty || !isAuthenticated) return;
    if (baseVersion == null) { pullState(); return; }
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    var sent = clone(state);
    var hadOfflineChanges = !online;
    apiFetch('/api/state', { method: 'PUT', body: sent, headers: { 'X-Base-Version': String(baseVersion) } }).then(function (r) {
      if (r.status === 401) { handleUnauthorized(); return; }
      if (r.status === 409) {
        setOnline(true);
        return r.json().then(function (body) {
          receiveRemote(body.state, versionOf(r));
          syncAgain = true;
          safeRender();
        });
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().then(function (body) {
        baseState = sent;
        baseVersion = body.version;
        dirty = !sameJson(state, sent);
        persistLocal();
        setOnline(true);
        if (hadOfflineChanges && !dirty) showToast('Modifications synchronisées avec le serveur.');
      });
    }).catch(function () {
      setOnline(false);
      scheduleRetry();
    }).finally(function () {
      syncing = false;
      updateSyncStatus();
      if (syncAgain) { syncAgain = false; syncNow(); }
    });
  }

  function pullState() {
    if (!isAuthenticated || syncing) return Promise.resolve();
    if (dirty && baseVersion != null) { syncNow(); return Promise.resolve(); }
    return apiFetch('/api/state', { cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { handleUnauthorized(); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var v = versionOf(r);
      return r.json().then(function (remote) {
        setOnline(true);
        if (state && v != null && v === baseVersion && !dirty) return;
        var first = !state;
        receiveRemote(remote, v);
        if (first) render(); else safeRender();
        if (dirty) syncNow();
      });
    }).catch(function () {
      setOnline(false);
      scheduleRetry();
    }).finally(updateSyncStatus);
  }

  var POLL_MS = 20000;
  var pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { if (!document.hidden) pullState(); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && isAuthenticated) pullState(); });
  window.addEventListener('focus', function () { if (isAuthenticated) pullState(); });
  window.addEventListener('online', function () { if (isAuthenticated) { if (dirty) syncNow(); else pullState(); } });
  window.addEventListener('offline', function () { setOnline(false); });

  function boot() {
    var saved = readLocal();
    if (saved && saved.state) {
      state = migrateState(saved.state);
      baseState = saved.base || null;
      baseVersion = saved.version == null ? null : saved.version;
      dirty = !!saved.dirty;
      currentUsername = saved.user || '';
    }
    apiFetch('/api/session', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (sess) {
      setOnline(true);
      isAuthenticated = !!sess.authenticated;
      if (sess.username) currentUsername = sess.username;
      booted = true;
      if (!isAuthenticated) { render(); return; }
      if (state) { render(); handleLaunchAction(); }
      startPolling();
      return pullState().then(handleLaunchAction);
    }).catch(function () {
      // Pas de réseau : on ouvre la copie gardée sur l'appareil.
      online = false;
      booted = true;
      isAuthenticated = !!state;
      render();
      updateSyncStatus();
      if (state) { handleLaunchAction(); startPolling(); }
      scheduleRetry();
    });
  }

  // Après connexion : récupère l'état (en fusionnant d'éventuelles modifications locales).
  function loadStateAndRender() {
    booted = true;
    render();
    startPolling();
    return pullState().then(handleLaunchAction);
  }

  // Raccourci de l'icône installée (appui long → « Nouveau mouvement ») : ?action=nouveau-mouvement
  function handleLaunchAction() {
    var params = new URLSearchParams(location.search);
    if (params.get('action') !== 'nouveau-mouvement' || !state || !isAuthenticated) return;
    history.replaceState(null, '', location.pathname + location.hash);
    currentPage = 'dashboard';
    selectedMonthKey = budgetMonthKeyForDate(todayISO());
    editingMovementId = null;
    render();
    var dlg = document.getElementById('movement-modal');
    if (dlg && !dlg.open) dlg.showModal();
  }

  // --- rendering ---
  function render() {
    if (!booted) {
      document.getElementById('app').innerHTML = '<div class="loading-shell">Chargement…</div>';
      return;
    }
    if (!isAuthenticated) {
      document.getElementById('app').innerHTML = renderLoginScreen();
      return;
    }
    if (!state) {
      document.getElementById('app').innerHTML = '<div class="loading-shell">Pas de connexion au serveur.<br>Le budget s’affichera dès que le réseau revient.</div>';
      return;
    }
    renderDeferred = false;
    var view = computeMonthView(state, selectedMonthKey, {});
    document.getElementById('app').innerHTML = renderApp(state, view, selectedMonthKey, currentPage, editingMovementId, selectedYear, movementGroupBy);
  }

  function renderLoginScreen() {
    return '<div class="login-shell"><form class="login-card" data-form="login">' +
      '<img class="login-logo" src="' + BASE + '/logo.png" alt="">' +
      '<h1 class="login-title">Fée Lezcomptes</h1>' +
      (loginError ? '<p class="login-error">' + esc(loginError) + '</p>' : '') +
      '<label>Identifiant<input type="text" name="username" required autocomplete="username"></label>' +
      '<label>Mot de passe<input type="password" name="password" required autocomplete="current-password"></label>' +
      '<label class="login-remember"><input type="checkbox" name="remember" checked> Rester connecté sur cet appareil</label>' +
      '<button type="submit" class="btn-add">Se connecter</button>' +
      '</form></div>';
  }

  function renderConfirmDialog() {
    return '<dialog class="modal" id="confirm-dialog">' +
      '<div class="modal-form">' +
        '<h3 class="card-title">Confirmation</h3>' +
        '<p class="empty-note">' + esc(pendingConfirmMessage) + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" data-action="confirm-no">Non</button>' +
          (pendingConfirmExtra ? '<button type="button" class="btn-secondary" data-action="confirm-extra">' + esc(pendingConfirmExtra.label) + '</button>' : '') +
          '<button type="button" class="btn-danger" data-action="confirm-yes">' + esc(pendingConfirmMainLabel) + '</button>' +
        '</div>' +
      '</div>' +
    '</dialog>';
  }

  function stat(icon, label, value, tone) {
    return '<div class="stat-tile' + (tone ? ' stat-' + tone : '') + '"><span class="stat-label"><span class="stat-icon">' + icon + '</span>' + label + '</span><span class="stat-value">' + fmt(value) + '</span></div>';
  }

  function budgetStat(env) {
    var tone = env.remaining < 0 ? 'critical' : 'good';
    var pct = env.amount > 0 ? Math.min(100, Math.round((env.spentTotal / env.amount) * 100)) : (env.spentTotal > 0 ? 100 : 0);
    var status = env.spentTotal > env.amount ? 'critical' : (pct >= 80 ? 'warning' : 'good');
    return '<button type="button" class="stat-tile stat-tile-btn stat-' + tone + '" data-action="open-budget" data-id="' + env.id + '">' +
      '<span class="stat-label"><span class="stat-icon">' + env.icon + '</span>' + esc(env.name) + (env.ephemeral ? ' · éphémère' : '') + '</span>' +
      '<span class="stat-value">' + fmt(env.remaining) + '</span>' +
      '<span class="stat-caption">disponible</span>' +
      '<div class="week-bar-track"><div class="week-bar-fill week-' + status + '" style="width:' + pct + '%"></div></div>' +
      '<span class="stat-caption stat-pct mono">' + pct + '% dépensé</span>' +
      '</button>';
  }

  function renderResidualCard(view) {
    var tone = view.endingBalance < 0 ? 'critical' : 'good';
    var pct = view.available > 0 ? Math.min(100, Math.round((view.totalOutflow / view.available) * 100)) : (view.totalOutflow > 0 ? 100 : 0);
    var status = view.totalOutflow > view.available ? 'critical' : (pct >= 80 ? 'warning' : 'good');
    var remaining = view.available - view.totalOutflow;
    var remainingHtml = remaining < 0 ? '<span class="amount-critical">' + fmt(remaining) + '</span>' : fmt(remaining);
    return '<section class="card residual-card stat-' + tone + '">' +
      '<div class="residual-top">' +
        '<span class="stat-label"><span class="stat-icon">✅</span>Solde global</span>' +
        '<span class="stat-value">' + fmt(view.totalOutflow) + ' / ' + fmt(view.available) + '</span>' +
      '</div>' +
      '<div class="week-bar-track"><div class="week-bar-fill week-' + status + '" style="width:' + pct + '%"></div></div>' +
      '<span class="stat-caption stat-pct mono">' + pct + '% dépensé · ' + remainingHtml + ' disponible</span>' +
    '</section>';
  }

  function renderApp(st, view, monthKey, page, editingMovementId, year, groupBy) {
    var showMonthNav = page !== 'stats';
    return '' +
      '<div class="app-shell">' +
      '<div class="topbar">' +
        '<div class="brand"><img class="app-logo" src="' + BASE + '/logo.png" alt="">Fée Lezcomptes</div>' +
        '<div class="topbar-right">' +
          '<nav class="page-nav">' +
            '<button type="button" class="page-tab' + (page === 'dashboard' ? ' active' : '') + '" data-action="nav-dashboard">📊 Tableau de bord</button>' +
            '<button type="button" class="page-tab' + (page === 'stats' ? ' active' : '') + '" data-action="nav-stats">📈 Statistiques</button>' +
            '<button type="button" class="page-tab' + (page === 'settings' ? ' active' : '') + '" data-action="nav-settings">⚙️ Réglages</button>' +
          '</nav>' +
          (showMonthNav ? (
            '<div class="month-nav">' +
              '<button type="button" class="icon-btn" data-action="prev-month" aria-label="Mois précédent">‹</button>' +
              '<div class="month-label">' + monthLabel(monthKey) + '</div>' +
              '<button type="button" class="icon-btn" data-action="next-month" aria-label="Mois suivant">›</button>' +
            '</div>'
          ) : (
            '<div class="month-nav">' +
              '<button type="button" class="icon-btn" data-action="prev-year" aria-label="Année précédente">‹</button>' +
              '<div class="month-label">Année ' + year + '</div>' +
              '<button type="button" class="icon-btn" data-action="next-year" aria-label="Année suivante">›</button>' +
            '</div>'
          )) +
        '</div>' +
      '</div>' +
      (page === 'settings' ? renderSettingsPage(st, view, monthKey) :
        page === 'stats' ? renderStatsPage(st, year) :
        renderDashboard(view, monthKey, editingMovementId, groupBy)) +
      '</div>' +
      renderConfirmDialog() +
      renderInstallDialog() +
      '<div class="toast" id="toast" hidden></div>';
  }

  function renderDashboard(view, monthKey, editingMovementId, groupBy) {
    return '<div class="page-stack">' +
      renderInstallBanner() +
      '<div class="stats-row">' +
        view.envelopes.map(function (env) { return budgetStat(env); }).join('') +
      '</div>' +
      renderFixedChecklist(view) +
      renderMovementsSection(view, monthKey, editingMovementId, groupBy) +
      '</div>';
  }

  function renderFixedChecklist(view) {
    if (!view.fixedLines.length) return '';
    var paidCount = view.fixedLines.filter(function (f) { return f.paid; }).length;
    var pct = view.recurringFixedDue > 0 ? Math.min(100, Math.round((view.recurringFixedTotal / view.recurringFixedDue) * 100)) : 0;
    var status = view.recurringFixedTotal >= view.recurringFixedDue ? 'good' : (pct >= 50 ? 'warning' : 'critical');
    var rows = view.fixedLines.map(function (f) {
      return '<label class="fixed-check-row' + (f.paid ? ' is-paid' : '') + '">' +
        '<input type="checkbox" data-field="fixed-paid" data-id="' + f.id + '"' + (f.paid ? ' checked' : '') + '>' +
        '<span class="fixed-check-name">' + esc(f.name) + '</span>' +
        '<span class="fixed-check-amount mono">' + fmt(f.amount) + '</span>' +
        '</label>';
    }).join('');
    var isOpen = openAccordions.has('fixed');
    var remainingToPay = view.recurringFixedDue - view.recurringFixedTotal;
    return '<section class="card">' +
      '<details data-key="fixed"' + (isOpen ? ' open' : '') + '>' +
        '<summary class="week-block-head">' +
          '<span class="week-block-title">Fixes<span class="week-range">' + paidCount + ' / ' + view.fixedLines.length + ' payées · ' + fmt(remainingToPay) + ' restant</span></span>' +
          '<span class="week-block-solde mono">' + fmt(view.recurringFixedTotal) + ' / ' + fmt(view.recurringFixedDue) + '</span>' +
        '</summary>' +
        '<div class="accordion-body">' +
          '<div class="fixed-summary-row">' +
            '<div class="week-bar-track"><div class="week-bar-fill week-' + status + '" style="width:' + pct + '%"></div></div>' +
          '</div>' +
          '<div class="fixed-check-list">' + rows + '</div>' +
        '</div>' +
      '</details>' +
      '</section>';
  }

  function renderMovementRow(m, envById, tagById, paymentById) {
    var env = m.envelopeId ? envById[m.envelopeId] : null;
    var icon = env ? env.icon : (m.type === 'income' ? '💶' : '🔸');
    var tag = m.tagId ? tagById[m.tagId] : null;
    var payment = m.paymentMethodId ? paymentById[m.paymentMethodId] : null;
    var rowInner = '<div class="movement-row movement-' + m.type + '">' +
      '<span class="movement-icon">' + icon + '</span>' +
      '<div class="movement-main">' +
        '<div class="movement-label-row"><span class="movement-label">' + esc(m.label) + '</span>' +
        (tag ? '<span class="tag-chip" style="--tag-color:' + tagColor(tag.id) + '">' + esc(tag.name) + '</span>' : '') +
        '</div>' +
        '<span class="movement-date">' + formatDateShort(m.date) + '</span>' +
      '</div>' +
      '<span class="movement-amount mono">' + (m.type === 'income' ? '+' : '−') + fmt(m.amount) + '</span>' +
      (payment ? '<span class="movement-payment-icon" title="' + esc(payment.name) + '">' + payment.icon + '</span>' : '<span class="movement-payment-icon movement-payment-icon-empty"></span>') +
      // Boutons visibles uniquement à la souris (voir styles.css) ; au doigt, on glisse.
      '<span class="movement-actions">' +
        '<button type="button" class="chip-btn movement-action-edit" data-action="edit-movement" data-id="' + m.id + '" aria-label="Modifier ' + esc(m.label) + '" title="Modifier">✏️</button>' +
        '<button type="button" class="chip-btn" data-action="delete-movement" data-id="' + m.id + '" aria-label="Supprimer ' + esc(m.label) + '" title="Supprimer">🗑️</button>' +
      '</span>' +
      '</div>';
    return '<div class="movement-swipe" data-id="' + m.id + '">' +
      '<div class="swipe-action swipe-delete">🗑️</div>' +
      '<div class="swipe-action swipe-edit">✏️</div>' +
      rowInner +
      '</div>';
  }

  function renderGroupCard(label, colorDot, moves, envById, tagById, paymentById, extraHtml, headerRight, soldeText, accKey, isCurrent) {
    var moveRows = moves.length ? moves.map(function (m) { return renderMovementRow(m, envById, tagById, paymentById); }).join('') : '<p class="empty-note-sm">Aucun mouvement.</p>';
    var isOpen = openAccordions.has(accKey);
    return '<section class="card week-block' + (isCurrent ? ' week-block-current' : '') + '">' +
      '<details data-key="' + accKey + '"' + (isOpen ? ' open' : '') + '>' +
        '<summary class="week-block-head">' +
          '<span class="week-block-title">' + (colorDot ? '<span class="legend-dot" style="background:' + colorDot + '"></span>' : '') + label + (headerRight || '') + '</span>' +
          '<span class="week-block-solde mono">' + (soldeText || '') + '</span>' +
        '</summary>' +
        '<div class="accordion-body">' +
          (extraHtml || '') +
          '<div class="movements-list">' + moveRows + '</div>' +
        '</div>' +
      '</details>' +
      '</section>';
  }

  function renderMovementsSection(view, monthKey, editingMovementId, groupBy) {
    var editingMv = editingMovementId ? view.movements.find(function (m) { return m.id === editingMovementId; }) : null;
    var envById = {};
    view.envelopes.forEach(function (e) { envById[e.id] = e; });
    var tagById = {};
    state.recurring.tags.forEach(function (t) { tagById[t.id] = t; });
    var paymentById = {};
    state.recurring.paymentMethods.forEach(function (p) { paymentById[p.id] = p; });

    var blocks = '';
    var sectionTitle = 'Mouvements par semaine';
    var listMovements = movementTypeFilter === 'all' ? view.movements : view.movements.filter(function (m) { return m.type === movementTypeFilter; });
    var searchQuery = movementSearchQuery.trim().toLowerCase();
    var isSearching = searchQuery.length > 0;

    if (isSearching) {
      sectionTitle = 'Résultats de recherche';
      var searchMoves = listMovements
        .filter(function (m) { return movementMatchesQuery(m, searchQuery); })
        .slice()
        .sort(function (a, b) { return b.date.localeCompare(a.date); });
      var searchTotal = searchMoves.reduce(function (s, m) { return s + (m.type === 'income' ? m.amount : -m.amount); }, 0);
      var searchRowsHtml = searchMoves.length
        ? searchMoves.map(function (m) { return renderMovementRow(m, envById, tagById, paymentById); }).join('')
        : '<p class="empty-note-sm">Aucun mouvement ne correspond à cette recherche.</p>';
      blocks = '<section class="card week-block">' +
        '<div class="week-block-head">' +
          '<span class="week-block-title">🔍 Résultats' + (searchMoves.length ? '<span class="week-range">' + searchMoves.length + ' mouvement' + (searchMoves.length > 1 ? 's' : '') + '</span>' : '') + '</span>' +
          '<span class="week-block-solde mono">' + fmt(searchTotal) + '</span>' +
        '</div>' +
        '<div class="movements-list">' + searchRowsHtml + '</div>' +
      '</section>';
    } else if (groupBy === 'budget') {
      sectionTitle = 'Mouvements par budget';
      blocks = view.envelopes.map(function (env) {
        var moves = listMovements.filter(function (m) { return m.envelopeId === env.id; });
        var envOver = env.spentTotal > env.amount;
        var envSolde = (envOver ? '<span class="amount-critical">' + fmt(env.spentTotal) + '</span>' : fmt(env.spentTotal)) + ' / ' + fmt(env.amount);
        return renderGroupCard(env.icon + ' ' + esc(env.name), null, moves, envById, tagById, paymentById, '', '', envSolde, 'budget-' + env.id);
      }).join('');
      var offBudgetMoves = listMovements.filter(function (m) { return m.type === 'expense' && !m.envelopeId; });
      if (offBudgetMoves.length) {
        var offBudgetTotal = offBudgetMoves.reduce(function (s, m) { return s + m.amount; }, 0);
        blocks += renderGroupCard('🔸 Hors budget', null, offBudgetMoves, envById, tagById, paymentById, '', '', fmt(offBudgetTotal), 'budget-none');
      }
    } else if (groupBy === 'tag') {
      sectionTitle = 'Mouvements par tag';
      blocks = state.recurring.tags.map(function (t) {
        var moves = listMovements.filter(function (m) { return m.tagId === t.id; });
        var tagTotal = moves.reduce(function (s, m) { return s + (m.type === 'income' ? m.amount : -m.amount); }, 0);
        return { html: renderGroupCard(esc(t.name), tagColor(t.id), moves, envById, tagById, paymentById, '', '', fmt(tagTotal), 'tag-' + t.id), tagTotal: tagTotal };
      }).sort(function (a, b) { return movementTypeFilter === 'income' ? b.tagTotal - a.tagTotal : a.tagTotal - b.tagTotal; }).map(function (g) { return g.html; }).join('');
      var noTagMoves = listMovements.filter(function (m) { return !m.tagId; });
      var noTagTotal = noTagMoves.reduce(function (s, m) { return s + (m.type === 'income' ? m.amount : -m.amount); }, 0);
      blocks += renderGroupCard('Sans tag', null, noTagMoves, envById, tagById, paymentById, '', '', fmt(noTagTotal), 'tag-none');
    } else if (groupBy === 'payment') {
      sectionTitle = 'Mouvements par mode de paiement';
      blocks = state.recurring.paymentMethods.map(function (p) {
        var moves = listMovements.filter(function (m) { return m.paymentMethodId === p.id; });
        var paymentTotal = moves.reduce(function (s, m) { return s + (m.type === 'income' ? m.amount : -m.amount); }, 0);
        return renderGroupCard(p.icon + ' ' + esc(p.name), null, moves, envById, tagById, paymentById, '', '', fmt(paymentTotal), 'payment-' + p.id);
      }).join('');
    } else {
      var weeksCount = view.weeksCount;
      var todayStr = todayISO();
      var currentWeekIdx = monthKey === budgetMonthKeyForDate(todayStr) ? weekIndexForDate(todayStr, monthKey, weeksCount) : -1;
      for (var idx = 0; idx < weeksCount; idx++) {
        var rangeLabel = weekRangeLabel(monthKey, idx);
        var moves = listMovements.filter(function (m) { return m.weekIndex === idx; });

        var budgetRows = view.envelopes.map(function (env) {
          var alloc = env.effectiveWeeks[idx];
          var spent = env.spentByWeek[idx];
          var remaining = alloc - spent;
          var pct = alloc > 0 ? Math.min(100, Math.round((spent / alloc) * 100)) : (spent > 0 ? 100 : 0);
          var over = spent > alloc;
          var status = over ? 'critical' : (pct >= 80 ? 'warning' : 'good');
          var planned = env.weeks[idx];
          var adjusted = Math.round(planned * 100) !== Math.round(alloc * 100);
          return '<div class="budget-bilan-row"><span class="budget-bilan-name"><span class="budget-icon">' + env.icon + '</span>' + esc(env.name) + '</span>' +
            '<div class="week-bar-track"><div class="week-bar-fill week-' + status + '" style="width:' + pct + '%"></div></div>' +
            '<span class="budget-bilan-figures mono"><span class="budget-bilan-amounts">' + (over ? '<span class="amount-critical">' + fmt(remaining) + '</span>' : fmt(remaining)) + '</span>' +
            '<span class="' + (adjusted ? 'week-adjusted-badge' : 'week-planned-note') + '">prévu ' + fmt(planned) + '</span>' +
            '</span></div>';
        }).join('');
        var bilanHtml = view.envelopes.length ? '<div class="budget-bilan-list">' + budgetRows + '</div>' : '';
        var weekSpent = view.envelopes.reduce(function (s, env) { return s + env.spentByWeek[idx]; }, 0);
        var weekAlloc = view.envelopes.reduce(function (s, env) { return s + env.effectiveWeeks[idx]; }, 0);
        var weekPlanned = view.envelopes.reduce(function (s, env) { return s + env.weeks[idx]; }, 0);
        var weekOver = weekSpent > weekAlloc;
        var weekAdjusted = Math.round(weekPlanned * 100) !== Math.round(weekAlloc * 100);
        var weekSolde = '<span class="week-block-solde-amounts">' + (weekOver ? '<span class="amount-critical">' + fmt(weekSpent) + '</span>' : fmt(weekSpent)) + ' / ' + fmt(weekAlloc) + '</span>' +
          '<span class="' + (weekAdjusted ? 'week-adjusted-badge' : 'week-planned-note') + '">(' + fmt(weekPlanned) + ')</span>';

        blocks += renderGroupCard(rangeLabel, null, moves, envById, tagById, paymentById, bilanHtml, '', weekSolde, 'week-' + monthKey + '-' + idx, idx === currentWeekIdx);
      }
    }

    var envOptions = view.envelopes.map(function (e) {
      var sel = editingMv && editingMv.envelopeId === e.id;
      return '<option value="' + e.id + '"' + (sel ? ' selected' : '') + '>' + e.icon + ' ' + esc(e.name) + '</option>';
    }).join('');
    var tagOptions = state.recurring.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).map(function (t) {
      var sel = editingMv && editingMv.tagId === t.id;
      return '<option value="' + t.id + '"' + (sel ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    var defaultPaymentMethodId = state.settings.defaultPaymentMethodId;
    var selectedPaymentMethodId = editingMv ? editingMv.paymentMethodId : defaultPaymentMethodId;
    var paymentOptions = state.recurring.paymentMethods.map(function (p) {
      var sel = selectedPaymentMethodId === p.id;
      return '<option value="' + p.id + '"' + (sel ? ' selected' : '') + '>' + p.icon + ' ' + esc(p.name) + '</option>';
    }).join('');
    var noTagSelected = !editingMv || !editingMv.tagId;
    var isIncomeSelected = editingMv && editingMv.type === 'income';

    var modalHtml =
      '<dialog class="modal" id="movement-modal">' +
        '<form class="modal-form" data-form="add-movement" novalidate>' +
          '<h3 class="card-title">' + (editingMv ? 'Modifier le mouvement' : 'Ajouter un mouvement') + '</h3>' +
          (editingMv ? '<input type="hidden" name="movementId" value="' + editingMv.id + '">' : '') +
          '<label>Date<input type="date" name="date" value="' + (editingMv ? editingMv.date : todayISO()) + '" required></label>' +
          '<label>Description<input type="text" name="label" placeholder="Description" value="' + (editingMv ? esc(editingMv.label) : '') + '" required maxlength="60"></label>' +
          '<label>Montant<input type="number" name="amount" placeholder="Montant" step="0.01" min="0" value="' + (editingMv ? editingMv.amount : '') + '" required></label>' +
          '<label>Budget<select name="envelopeId" required>' + envOptions + '</select></label>' +
          '<label>Tag<select name="tagId" data-field="movement-tag-select">' +
            '<option value="" ' + (noTagSelected ? 'selected' : '') + '>— Aucun tag —</option>' + tagOptions +
            '<option value="__new_tag__">+ Nouveau tag…</option>' +
          '</select></label>' +
          '<input type="text" name="newTagName" placeholder="Nom du nouveau tag" maxlength="30" hidden>' +
          '<label>Type<select name="type">' +
            '<option value="expense"' + (!isIncomeSelected ? ' selected' : '') + '>Dépense</option>' +
            '<option value="income"' + (isIncomeSelected ? ' selected' : '') + '>Revenu</option>' +
          '</select></label>' +
          '<label>Mode de paiement<select name="paymentMethodId" required>' + paymentOptions + '</select></label>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn-secondary" data-action="close-movement-modal">Annuler</button>' +
            '<button type="submit" class="btn-add">' + (editingMv ? 'Enregistrer' : 'Ajouter') + '</button>' +
          '</div>' +
        '</form>' +
      '</dialog>';

    var groupToggle = '<div class="group-toggle">' +
      '<button type="button" class="group-tab' + (groupBy === 'week' ? ' active' : '') + '" data-action="group-week">Semaine</button>' +
      '<button type="button" class="group-tab' + (groupBy === 'budget' ? ' active' : '') + '" data-action="group-budget">Budget</button>' +
      '<button type="button" class="group-tab' + (groupBy === 'tag' ? ' active' : '') + '" data-action="group-tag">Tag</button>' +
      '<button type="button" class="group-tab' + (groupBy === 'payment' ? ' active' : '') + '" data-action="group-payment">Paiement</button>' +
      '</div>';

    var filterActive = isSearching || movementTypeFilter !== 'all';
    var filterBtn = '<button type="button" class="filter-btn' + (filterActive ? ' active' : '') + '" data-action="open-filter-modal" aria-label="Filtrer et rechercher">🔍</button>';
    var filterModalHtml =
      '<dialog class="modal" id="filter-modal">' +
        '<form class="modal-form" data-form="movement-filter">' +
          '<h3 class="card-title">Filtrer les mouvements</h3>' +
          '<label>Recherche<input type="search" name="query" placeholder="Description ou montant" value="' + esc(movementSearchQuery) + '"></label>' +
          '<label>Type<select name="type">' +
            '<option value="all"' + (movementTypeFilter === 'all' ? ' selected' : '') + '>Tout</option>' +
            '<option value="expense"' + (movementTypeFilter === 'expense' ? ' selected' : '') + '>Dépenses</option>' +
            '<option value="income"' + (movementTypeFilter === 'income' ? ' selected' : '') + '>Revenus</option>' +
          '</select></label>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn-secondary" data-action="reset-filter">Réinitialiser</button>' +
            '<button type="submit" class="btn-add">Appliquer</button>' +
          '</div>' +
        '</form>' +
      '</dialog>';

    return '<div class="section-head">' +
        '<h2 class="card-title">' + sectionTitle + '</h2>' +
        '<div class="section-head-controls">' +
          (isSearching ? '' : groupToggle) +
          filterBtn +
          '<button type="button" class="btn-add add-movement-btn" data-action="open-movement-modal">+ Ajouter un mouvement</button>' +
        '</div>' +
      '</div>' +
      blocks +
      renderResidualCard(view) +
      modalHtml +
      filterModalHtml +
      '<button type="button" class="fab" data-action="open-movement-modal" aria-label="Ajouter un mouvement">+</button>';
  }

  function renderIconGrid(selectedIcon, editMode, envId, ephemeral) {
    return '<div class="icon-grid">' + ICONS.map(function (ic) {
      var sel = ic === selectedIcon;
      var action = editMode ? (ephemeral ? 'set-ephemeral-envelope-icon' : 'set-envelope-icon') : 'pick-icon';
      return '<button type="button" class="icon-choice' + (sel ? ' selected' : '') + '" data-action="' + action + '"' + (editMode ? ' data-id="' + envId + '"' : '') + ' data-icon="' + ic + '">' + ic + '</button>';
    }).join('') + '</div>';
  }

  // Palette de couleurs prédéfinies (celles déjà utilisées pour l'attribution auto),
  // affichée en grille dépliable à côté du sélecteur natif — plus facile pour repérer
  // des teintes vraiment distinctes qu'avec la roue de couleurs du navigateur seule.
  function renderColorGrid(selectedColor, action, id) {
    var sel = (selectedColor || '').toLowerCase();
    return '<div class="color-grid">' + TAG_COLORS.map(function (c) {
      var isSel = c.toLowerCase() === sel;
      return '<button type="button" class="color-choice' + (isSel ? ' selected' : '') + '" data-action="' + action + '" data-id="' + id + '" data-color="' + c + '" style="background:' + c + '" aria-label="Choisir ' + c + '"></button>';
    }).join('') + '</div>';
  }

  function renderStatsPage(st, year) {
    var months = [];
    for (var m = 1; m <= 12; m++) {
      months.push(computeMonthView(st, year + '-' + pad2(m), {}));
    }
    function tagAbsTotal(v, tagId) {
      return v.movements.filter(function (m) { return tagId ? m.tagId === tagId : !m.tagId; })
        .reduce(function (s, m) { return s + m.amount; }, 0);
    }
    var maxVal = Math.max(1, Math.max.apply(null, months.map(function (v) {
      var tagTotal = v.movements.reduce(function (s, m) { return s + m.amount; }, 0);
      return Math.max(v.totalIncome, v.totalOutflow, tagTotal);
    })));
    var yearIncome = months.reduce(function (s, v) { return s + v.totalIncome; }, 0);
    var yearOutflow = months.reduce(function (s, v) { return s + v.totalOutflow; }, 0);
    var yearBalance = yearIncome - yearOutflow;

    var chartCols = months.map(function (v) {
      var incPct = Math.round((v.totalIncome / maxVal) * 100);
      var outPct = Math.round((v.totalOutflow / maxVal) * 100);
      var abbrev = MONTH_ABBREVS[parseInt(v.key.slice(5, 7), 10) - 1];
      var offBudget = v.movementExpenseTotal - v.totalEnvelopeSpent;
      var segments = [];
      v.envelopes.forEach(function (env) {
        if (env.spentTotal > 0) segments.push({ amount: env.spentTotal, color: tagColor(env.id, v.key), label: env.name });
      });
      if (v.recurringFixedTotal > 0) segments.push({ amount: v.recurringFixedTotal, color: 'var(--warning)', label: 'Dépenses fixes' });
      if (offBudget > 0) segments.push({ amount: offBudget, color: 'var(--muted)', label: 'Hors budget' });
      var segHtml = segments.map(function (s) {
        return '<div class="stat-chart-seg" style="flex:' + s.amount + ' 0 0; background:' + s.color + '" title="' + esc(s.label) + ' : ' + fmt(s.amount) + '"></div>';
      }).join('');

      var tagSegments = [];
      st.recurring.tags.forEach(function (t) {
        var amt = tagAbsTotal(v, t.id);
        if (amt > 0) tagSegments.push({ amount: amt, color: tagColor(t.id), label: t.name });
      });
      var noTagAmt = tagAbsTotal(v, null);
      if (noTagAmt > 0) tagSegments.push({ amount: noTagAmt, color: 'var(--muted)', label: 'Sans tag' });
      var tagTotal = tagSegments.reduce(function (s, seg) { return s + seg.amount; }, 0);
      var tagPct = Math.round((tagTotal / maxVal) * 100);
      var tagSegHtml = tagSegments.map(function (s) {
        return '<div class="stat-chart-seg" style="flex:' + s.amount + ' 0 0; background:' + s.color + '" title="' + esc(s.label) + ' : ' + fmt(s.amount) + '"></div>';
      }).join('');

      var paymentSegments = [];
      st.recurring.paymentMethods.forEach(function (p) {
        var amt = v.movements.filter(function (m) { return m.paymentMethodId === p.id; }).reduce(function (s, m) { return s + m.amount; }, 0);
        if (amt > 0) paymentSegments.push({ amount: amt, color: paymentColor(p.id), label: p.icon + ' ' + p.name });
      });
      var noPaymentAmt = v.movements.filter(function (m) { return !m.paymentMethodId; }).reduce(function (s, m) { return s + m.amount; }, 0);
      if (noPaymentAmt > 0) paymentSegments.push({ amount: noPaymentAmt, color: 'var(--muted)', label: 'Sans mode de paiement' });
      var paymentTotal = paymentSegments.reduce(function (s, seg) { return s + seg.amount; }, 0);
      var paymentPct = Math.round((paymentTotal / maxVal) * 100);
      var paymentSegHtml = paymentSegments.map(function (s) {
        return '<div class="stat-chart-seg" style="flex:' + s.amount + ' 0 0; background:' + s.color + '" title="' + esc(s.label) + ' : ' + fmt(s.amount) + '"></div>';
      }).join('');

      return '<div class="stat-chart-col">' +
        '<div class="stat-chart-bars">' +
          (statsCols.income ? '<div class="stat-chart-bar stat-chart-bar-income" style="height:' + incPct + '%" title="Revenus : ' + fmt(v.totalIncome) + '"></div>' : '') +
          (statsCols.budget ? '<div class="stat-chart-bar-stack" style="height:' + outPct + '%" title="Dépenses : ' + fmt(v.totalOutflow) + '">' + segHtml + '</div>' : '') +
          (statsCols.tags ? '<div class="stat-chart-bar-stack" style="height:' + tagPct + '%" title="Tags : ' + fmt(tagTotal) + '">' + tagSegHtml + '</div>' : '') +
          (statsCols.payment ? '<div class="stat-chart-bar-stack" style="height:' + paymentPct + '%" title="Paiement : ' + fmt(paymentTotal) + '">' + paymentSegHtml + '</div>' : '') +
        '</div>' +
        '<span class="stat-chart-label">' + abbrev + '</span>' +
        '</div>';
    }).join('');

    var colToggle = '<div class="chart-col-toggle">' +
      '<label><input type="checkbox" data-field="stats-col" data-col="income" ' + (statsCols.income ? 'checked' : '') + '> Revenus</label>' +
      '<label><input type="checkbox" data-field="stats-col" data-col="budget" ' + (statsCols.budget ? 'checked' : '') + '> Budgets</label>' +
      '<label><input type="checkbox" data-field="stats-col" data-col="tags" ' + (statsCols.tags ? 'checked' : '') + '> Tags</label>' +
      '<label><input type="checkbox" data-field="stats-col" data-col="payment" ' + (statsCols.payment ? 'checked' : '') + '> Paiement</label>' +
      '</div>';

    var legendGroups = [];
    if (statsCols.income) {
      legendGroups.push({ title: 'Revenu', items: [{ name: 'Revenus', color: 'var(--good)' }] });
    }
    if (statsCols.budget) {
      var budgetLegendItems = [];
      st.recurring.envelopes.forEach(function (env) { budgetLegendItems.push({ name: env.icon + ' ' + env.name, color: tagColor(env.id) }); });
      if (st.recurring.fixedExpenses.length) budgetLegendItems.push({ name: 'Dépenses fixes', color: 'var(--warning)' });
      budgetLegendItems.push({ name: 'Hors budget', color: 'var(--muted)' });
      legendGroups.push({ title: 'Budget', items: budgetLegendItems });
    }
    if (statsCols.tags) {
      var tagLegendItems = [];
      st.recurring.tags.forEach(function (t) { tagLegendItems.push({ name: t.name, color: tagColor(t.id) }); });
      tagLegendItems.push({ name: 'Sans tag', color: 'var(--muted)' });
      legendGroups.push({ title: 'Tags', items: tagLegendItems });
    }
    if (statsCols.payment) {
      var paymentLegendItems = [];
      st.recurring.paymentMethods.forEach(function (p) { paymentLegendItems.push({ name: p.icon + ' ' + p.name, color: paymentColor(p.id) }); });
      paymentLegendItems.push({ name: 'Sans mode de paiement', color: 'var(--muted)' });
      legendGroups.push({ title: 'Paiement', items: paymentLegendItems });
    }
    var legendHtml = legendGroups.map(function (g) {
      return '<div class="stat-legend-group"><div class="stat-legend-title">' + esc(g.title) + '</div><div class="stat-legend-items">' +
        g.items.map(function (l) { return '<span class="legend-item"><i class="legend-dot" style="background:' + l.color + '"></i>' + esc(l.name) + '</span>'; }).join('') +
        '</div></div>';
    }).join('');

    var budgetsTable = '';
    if (st.recurring.envelopes.length) {
      var headerCells = months.map(function (v) { return '<th>' + MONTH_ABBREVS[parseInt(v.key.slice(5, 7), 10) - 1] + '</th>'; }).join('');
      var budgetRowsHtml = st.recurring.envelopes.map(function (env) {
        var cells = months.map(function (v) {
          var b = v.envelopes.find(function (e) { return e.id === env.id; });
          return '<td class="mono">' + fmt(b ? b.spentTotal : 0) + '</td>';
        }).join('');
        var total = months.reduce(function (s, v) {
          var b = v.envelopes.find(function (e) { return e.id === env.id; });
          return s + (b ? b.spentTotal : 0);
        }, 0);
        return '<tr><td>' + env.icon + ' ' + esc(env.name) + '</td>' + cells + '<td class="mono"><strong>' + fmt(total) + '</strong></td></tr>';
      }).join('');
      budgetsTable = '<section class="card"><h2 class="card-title">Budgets par mois</h2><div class="table-scroll"><table class="stat-table"><thead><tr><th>Budget</th>' + headerCells + '<th>Total</th></tr></thead><tbody>' + budgetRowsHtml + '</tbody></table></div></section>';
    }

    function tagMonthTotal(v, tagId) {
      return v.movements.filter(function (m) { return tagId ? m.tagId === tagId : !m.tagId; })
        .reduce(function (s, m) { return s + (m.type === 'income' ? m.amount : -m.amount); }, 0);
    }
    var tagsTable = '';
    if (st.recurring.tags.length) {
      var headerCellsTags = months.map(function (v) { return '<th>' + MONTH_ABBREVS[parseInt(v.key.slice(5, 7), 10) - 1] + '</th>'; }).join('');
      var tagRowsHtml = st.recurring.tags.map(function (t) {
        var cells = months.map(function (v) { return '<td class="mono">' + fmt(tagMonthTotal(v, t.id)) + '</td>'; }).join('');
        var total = months.reduce(function (s, v) { return s + tagMonthTotal(v, t.id); }, 0);
        return '<tr><td>' + esc(t.name) + '</td>' + cells + '<td class="mono"><strong>' + fmt(total) + '</strong></td></tr>';
      }).join('');
      var noTagCells = months.map(function (v) { return '<td class="mono">' + fmt(tagMonthTotal(v, null)) + '</td>'; }).join('');
      var noTagTotal = months.reduce(function (s, v) { return s + tagMonthTotal(v, null); }, 0);
      tagRowsHtml += '<tr><td>Sans tag</td>' + noTagCells + '<td class="mono"><strong>' + fmt(noTagTotal) + '</strong></td></tr>';
      tagsTable = '<section class="card"><h2 class="card-title">Tags par mois</h2><div class="table-scroll"><table class="stat-table"><thead><tr><th>Tag</th>' + headerCellsTags + '<th>Total</th></tr></thead><tbody>' + tagRowsHtml + '</tbody></table></div></section>';
    }

    return '<div class="page-stack">' +
      '<div class="stats-row">' +
        stat('💵', 'Revenu', yearIncome) +
        stat('🧾', 'Dépense', yearOutflow) +
        stat('✅', 'Solde annuel', yearBalance, yearBalance < 0 ? 'critical' : 'good') +
      '</div>' +
      '<section class="card">' +
        '<h2 class="card-title">Revenus et dépenses par mois</h2>' +
        colToggle +
        '<div class="stat-chart">' + chartCols + '</div>' +
        '<div class="stat-chart-legend">' + legendHtml + '</div>' +
      '</section>' +
      budgetsTable +
      tagsTable +
      '</div>';
  }

  function renderSettingsPage(st, view, monthKey) {
    return '<div class="page-stack">' +
      renderRecurringSummaryCard(view) +
      renderRecurringIncomeCard(view) +
      renderRecurringFixedCard(view) +
      renderEnvelopesConfigCard(view, monthKey) +
      renderTagsCard(st) +
      renderPaymentMethodsCard(st) +
      renderGeneralSettingsCard(st) +
      renderInstallCard() +
      renderAccountCard() +
      '</div>' +
      renderIconModal(st, view);
  }

  function renderRecurringSummaryCard(view) {
    var available = view.recurringIncomeTotal - view.recurringFixedDue - view.totalEnvelopeBudget;
    return '<div class="stats-row">' +
      stat('💵', 'Revenus', view.recurringIncomeTotal) +
      stat('🧾', 'Frais fixes', view.recurringFixedDue) +
      stat('📦', 'Budgets', view.totalEnvelopeBudget) +
      stat('✅', 'Disponible', available, available < 0 ? 'critical' : 'good') +
      '</div>';
  }

  function renderRecurringIncomeCard(view) {
    var items = view.incomeLines.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var isOpen = openAccordions.has('settings-income');
    var html = '<section class="card"><details data-key="settings-income"' + (isOpen ? ' open' : '') + '><summary class="card-title">Revenus</summary><div class="settings-body"><div class="ledger">';
    html += items.length ? items.map(function (i) {
      return '<div class="ledger-row"><span class="ledger-name">' + esc(i.name) + '</span>' +
        '<input class="amount-input" type="number" step="0.01" min="0" value="' + i.amount + '" data-field="income-amount" data-id="' + i.id + '">' +
        '<button type="button" class="chip-btn" data-action="remove-income" data-id="' + i.id + '" aria-label="Supprimer ' + esc(i.name) + '">✕</button>' +
        '</div>';
    }).join('') : '<p class="empty-note">Aucun revenu récurrent pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-income">' +
      '<input type="text" name="name" placeholder="Salaire, allocations…" required maxlength="60">' +
      '<input type="number" name="amount" placeholder="Montant" step="0.01" min="0" required>' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  function renderRecurringFixedCard(view) {
    var items = view.fixedLines.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var isOpen = openAccordions.has('settings-fixed');
    var html = '<section class="card"><details data-key="settings-fixed"' + (isOpen ? ' open' : '') + '><summary class="card-title">Frais fixes</summary><div class="settings-body"><div class="ledger">';
    html += items.length ? items.map(function (f) {
      return '<div class="ledger-row"><span class="ledger-name">' + esc(f.name) + '</span>' +
        '<input class="amount-input" type="number" step="0.01" min="0" value="' + f.amount + '" data-field="fixed-amount" data-id="' + f.id + '">' +
        '<button type="button" class="chip-btn" data-action="remove-fixed" data-id="' + f.id + '" aria-label="Supprimer ' + esc(f.name) + '">✕</button>' +
        '</div>';
    }).join('') : '<p class="empty-note">Aucune dépense fixe pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-fixed">' +
      '<input type="text" name="name" placeholder="Loyer, abonnements…" required maxlength="60">' +
      '<input type="number" name="amount" placeholder="Montant" step="0.01" min="0" required>' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  function renderEnvelopesConfigCard(view, monthKey) {
    var isOpen = openAccordions.has('settings-budgets');
    var html = '<section class="card"><details data-key="settings-budgets"' + (isOpen ? ' open' : '') + '><summary class="card-title">Budgets</summary><div class="settings-body">' +
      '<label class="weeks-control">Semaines ce mois-ci<input type="number" min="1" max="5" value="' + view.weeksCount + '" data-field="weeks-count"></label>' +
      '<div class="envelopes-grid">';
    html += view.envelopes.map(function (env) { return renderEnvelopeConfigCard(env, monthKey); }).join('');
    if (!view.envelopes.length) html += '<p class="empty-note">Aucun budget pour l’instant.</p>';
    html += renderAddEnvelopeTrigger();
    html += '</div></div></details></section>';
    html += renderAddEnvelopeModal();
    return html;
  }

  // Le sélecteur d'icône (budget ou mode de paiement) s'ouvre dans une modale
  // partagée plutôt qu'affiché en permanence dans chaque carte, pour ne pas
  // alourdir la vue : iconModalTarget vaut 'env-<id>', 'eph-<id>' ou 'pay-<id>',
  // ou null si aucune n'est ouverte.
  function renderIconModal(st, view) {
    if (!iconModalTarget) return '';
    if (iconModalTarget.indexOf('pay-') === 0) {
      var payId = iconModalTarget.slice(4);
      var pm = st.recurring.paymentMethods.find(function (p) { return p.id === payId; });
      if (!pm) return '';
      return '<dialog class="modal" id="icon-modal">' +
        '<div class="modal-form">' +
          '<h3 class="card-title">Icône de ' + esc(pm.name) + '</h3>' +
          renderPaymentIconGrid(pm.icon, payId) +
          '<div class="modal-actions"><button type="button" class="btn-secondary" data-action="close-icon-modal">Fermer</button></div>' +
        '</div>' +
      '</dialog>';
    }
    var isEph = iconModalTarget.indexOf('eph-') === 0;
    var id = iconModalTarget.slice(4);
    var env = view.envelopes.find(function (e) { return e.id === id; });
    if (!env) return '';
    return '<dialog class="modal" id="icon-modal">' +
      '<div class="modal-form">' +
        '<h3 class="card-title">Icône de ' + esc(env.name) + '</h3>' +
        renderIconGrid(env.icon, true, id, isEph) +
        '<div class="modal-actions"><button type="button" class="btn-secondary" data-action="close-icon-modal">Fermer</button></div>' +
      '</div>' +
    '</dialog>';
  }

  function renderEnvelopeConfigCard(env, monthKey) {
    var eph = !!env.ephemeral;
    var ephAttr = eph ? ' data-ephemeral="true"' : '';
    var weekRows = env.weeks.map(function (planned, idx) {
      var spent = env.spentByWeek[idx];
      var pct = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : (spent > 0 ? 100 : 0);
      var over = spent > planned;
      var status = over ? 'critical' : (pct >= 80 ? 'warning' : 'good');
      return '<div class="week-row"><span class="week-label">Sem. ' + (idx + 1) + '</span>' +
        '<div class="week-bar-track"><div class="week-bar-fill week-' + status + '" style="width:' + pct + '%"></div></div>' +
        '<span class="week-figures"><span class="mono' + (over ? ' amount-critical' : '') + '">' + fmt(spent) + '</span> / <input type="number" step="0.01" class="amount-input amount-input-sm" value="' + planned + '" data-field="envelope-week-amount" data-id="' + env.id + '" data-week="' + idx + '"' + ephAttr + '>' +
        '</span></div>';
    }).join('');
    return '<article class="envelope-card' + (eph ? ' envelope-card-ephemeral' : '') + '"><div class="envelope-flap"></div><div class="envelope-body">' +
      '<div class="envelope-header"><span class="envelope-name">' +
        '<button type="button" class="budget-icon-lg icon-trigger" data-action="open-icon-modal" data-target="' + (eph ? 'eph-' : 'env-') + env.id + '" aria-label="Changer l’icône de ' + esc(env.name) + '">' + env.icon + '</button>' +
        '<input type="text" class="envelope-name-input" value="' + esc(env.name) + '" data-field="envelope-name" data-id="' + env.id + '"' + ephAttr + ' maxlength="40">' +
      '</span>' +
      (eph ? '<span class="tag-extra">Éphémère</span>' : '') +
      '<input type="color" class="color-picker" value="' + tagColor(env.id, monthKey) + '" data-field="envelope-color" data-id="' + env.id + '"' + ephAttr + ' aria-label="Couleur du budget ' + esc(env.name) + '">' +
      '<button type="button" class="palette-toggle" data-action="toggle-color-grid" data-target="env-' + env.id + '" aria-label="Palette de couleurs pour ' + esc(env.name) + '">🎨</button>' +
      '<button type="button" class="chip-btn" data-action="' + (eph ? 'remove-ephemeral-envelope' : 'remove-envelope') + '" data-id="' + env.id + '" aria-label="Supprimer ' + esc(env.name) + '">✕</button>' +
      '</div>' +
      (colorGridOpenFor === 'env-' + env.id ? renderColorGrid(tagColor(env.id, monthKey), eph ? 'set-ephemeral-envelope-color-swatch' : 'set-envelope-color-swatch', env.id) : '') +
      '<div class="envelope-amount-row"><span class="field-label">Budget du mois' + (eph ? ' (éphémère)' : '') + '</span>' +
      '<input type="number" step="0.01" min="0" class="amount-input" value="' + env.amount + '" data-field="envelope-amount" data-id="' + env.id + '"' + ephAttr + '></div>' +
      '<div class="week-list">' + weekRows + '</div>' +
      '</div></article>';
  }

  // Le formulaire de création d'un budget s'ouvre dans une modale plutôt qu'affiché
  // en permanence dans la grille (il contient une grille d'icônes complète, trop
  // lourde pour rester visible en continu).
  function renderAddEnvelopeTrigger() {
    return '<article class="envelope-card envelope-card-add">' +
      '<button type="button" class="btn-add" data-action="open-add-envelope-modal">+ Créer un budget</button>' +
      '</article>';
  }

  function renderAddEnvelopeModal() {
    if (!addEnvelopeModalOpen) return '';
    return '<dialog class="modal" id="add-envelope-modal">' +
      '<div class="modal-form">' +
        '<h3 class="card-title">Nouveau budget</h3>' +
        '<form data-form="add-envelope" class="add-envelope-form">' +
        renderIconGrid(ICONS[0], false, null) +
        '<input type="hidden" name="icon" id="icon-input-new" value="' + ICONS[0] + '">' +
        '<input type="text" name="name" placeholder="Nom du budget (Courses, Loisirs…)" required maxlength="40">' +
        '<input type="number" name="amount" placeholder="Budget mensuel" step="0.01" min="0" required>' +
        '<label class="fixed-check-row"><input type="checkbox" name="ephemeral"><span class="fixed-check-name">Uniquement pour ce mois-ci (éphémère)</span></label>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" data-action="close-add-envelope-modal">Annuler</button>' +
          '<button type="submit" class="btn-add">+ Créer un budget</button>' +
        '</div>' +
        '</form>' +
      '</div>' +
    '</dialog>';
  }

  function renderTagsCard(st) {
    var items = st.recurring.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var isOpen = openAccordions.has('settings-tags');
    var html = '<section class="card"><details data-key="settings-tags"' + (isOpen ? ' open' : '') + '><summary class="card-title">Tags</summary><div class="settings-body"><div class="tags-list">';
    html += items.length ? items.map(function (t) {
      var gridKey = 'tag-' + t.id;
      return '<span class="tag-chip" style="--tag-color:' + tagColor(t.id) + '">' +
        '<input type="color" class="tag-color-picker" value="' + tagColor(t.id) + '" data-field="tag-color" data-id="' + t.id + '" aria-label="Couleur du tag ' + esc(t.name) + '">' +
        '<button type="button" class="palette-toggle" data-action="toggle-color-grid" data-target="' + gridKey + '" aria-label="Palette de couleurs pour ' + esc(t.name) + '">🎨</button>' +
        '<input type="text" class="tag-name-input" value="' + esc(t.name) + '" data-field="tag-name" data-id="' + t.id + '" maxlength="30" size="' + Math.max(4, t.name.length) + '">' +
        '<button type="button" class="tag-remove" data-action="remove-tag" data-id="' + t.id + '" aria-label="Supprimer ' + esc(t.name) + '">✕</button>' +
        '</span>' +
        (colorGridOpenFor === gridKey ? renderColorGrid(tagColor(t.id), 'set-tag-color-swatch', t.id) : '');
    }).join('') : '<p class="empty-note">Aucun tag pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-tag">' +
      '<input type="text" name="name" placeholder="Alimentation, cadeaux…" required maxlength="30">' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  function renderPaymentIconGrid(selectedIcon, id) {
    return '<div class="icon-grid">' + ICONS.map(function (ic) {
      var sel = ic === selectedIcon;
      return '<button type="button" class="icon-choice' + (sel ? ' selected' : '') + '" data-action="set-payment-icon" data-id="' + id + '" data-icon="' + ic + '">' + ic + '</button>';
    }).join('') + '</div>';
  }

  function renderPaymentMethodsCard(st) {
    var items = st.recurring.paymentMethods;
    var isOpen = openAccordions.has('settings-payment-methods');
    var defaultId = st.settings.defaultPaymentMethodId;
    var html = '<section class="card"><details data-key="settings-payment-methods"' + (isOpen ? ' open' : '') + '><summary class="card-title">Modes de paiement</summary><div class="settings-body"><div class="ledger">';
    html += items.length ? items.map(function (p) {
      return '<div class="ledger-row payment-method-row">' +
        '<button type="button" class="budget-icon-lg icon-trigger" data-action="open-icon-modal" data-target="pay-' + p.id + '" aria-label="Changer l’icône de ' + esc(p.name) + '">' + p.icon + '</button>' +
        '<input type="text" class="payment-method-name-input" value="' + esc(p.name) + '" data-field="payment-method-name" data-id="' + p.id + '" maxlength="30">' +
        '<label class="payment-default-label"><input type="radio" name="default-payment-method" data-field="default-payment-method" value="' + p.id + '" ' + (p.id === defaultId ? 'checked' : '') + '> Par défaut</label>' +
        '<button type="button" class="chip-btn" data-action="remove-payment-method" data-id="' + p.id + '" aria-label="Supprimer ' + esc(p.name) + '">✕</button>' +
        '</div>';
    }).join('') : '<p class="empty-note">Aucun mode de paiement pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-payment-method">' +
      '<input type="text" name="name" placeholder="Cash, Carte, Compte…" required maxlength="30">' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  var WEEKDAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  function renderGeneralSettingsCard(st) {
    var currentStart = weekStartDay();
    var dayOptions = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<option value="' + d + '"' + (d === currentStart ? ' selected' : '') + '>' + WEEKDAY_NAMES[d] + '</option>';
    }).join('');
    var isOpen = openAccordions.has('settings-general');
    return '<section class="card"><details data-key="settings-general"' + (isOpen ? ' open' : '') + '><summary class="card-title">Général</summary>' +
      '<div class="settings-body">' +
      '<p class="empty-note">Chaque mois repart de zéro : aucun solde n’est reporté d’un mois sur l’autre.</p>' +
      '<label class="weeks-control">Jour de démarrage de la semaine<select data-field="week-start-day">' + dayOptions + '</select></label>' +
      '<button type="button" class="btn-danger" data-action="reset-all">Réinitialiser toutes les données</button>' +
      '</div></details></section>';
  }

  // --- Installation de l'app (PWA) ---
  // Invite du navigateur quand il en propose une (Chrome Android / PC), sinon marche à
  // suivre (iPhone : Safari > Partager). Rien n'est affiché si l'app tourne installée.
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; if (booted) safeRender(); });
  window.addEventListener('appinstalled', function () { installPrompt = null; showToast('App installée sur l’écran d’accueil.'); if (booted) safeRender(); });
  function isInstalled() {
    return ['standalone', 'fullscreen', 'minimal-ui'].some(function (m) { return window.matchMedia('(display-mode: ' + m + ')').matches; }) || navigator.standalone === true;
  }
  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isAndroid() { return /android/i.test(navigator.userAgent); }
  function installHidden() { try { return localStorage.getItem('fee-lezcomptes-install-hidden') === '1'; } catch (e) { return false; } }
  function setInstallHidden() { try { localStorage.setItem('fee-lezcomptes-install-hidden', '1'); } catch (e) {} }

  function renderInstallBanner() {
    if (isInstalled() || installHidden()) return '';
    return '<div class="install-banner card">' +
      '<img src="' + BASE + '/icon-192.png" alt="" width="36" height="36">' +
      '<button type="button" class="install-banner-main" data-action="install"><b>Installer l’app</b><span>Icône sur l’écran d’accueil, ajout rapide d’un mouvement, marche sans réseau</span></button>' +
      '<button type="button" class="icon-btn" data-action="install-hide" aria-label="Masquer">✕</button>' +
      '</div>';
  }
  function renderInstallCard() {
    var isOpen = openAccordions.has('settings-install');
    return '<section class="card"><details data-key="settings-install"' + (isOpen ? ' open' : '') + '><summary class="card-title">Application</summary>' +
      '<div class="settings-body">' +
      (isInstalled()
        ? '<p class="empty-note">✓ L’app est installée sur cet appareil. Appui long sur son icône → « Nouveau mouvement ».</p>'
        : '<p class="empty-note">Installe Fée Lezcomptes sur l’écran d’accueil : elle s’ouvre comme une app, marche sans réseau, et un appui long sur l’icône permet d’ajouter directement un mouvement.</p>' +
          '<button type="button" class="btn-add" data-action="install">📲 Installer l’app</button>') +
      '</div></details></section>';
  }
  function installStep(n, html) { return '<li><span class="install-step-num">' + n + '</span><span>' + html + '</span></li>'; }
  function renderInstallDialog() {
    var safari = isIos() && !/crios|fxios|edgios/i.test(navigator.userAgent);
    var steps = isIos()
      ? (safari ? '' : installStep(0, 'Ouvre cette page dans <b>Safari</b> (sur iPhone, seul Safari sait installer une app web).')) +
        installStep(1, 'Touche le bouton <b>Partager</b> (carré avec une flèche vers le haut).') +
        installStep(2, 'Choisis <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.')
      : isAndroid()
        ? installStep(1, 'Ouvre le menu <b>⋮</b> de Chrome.') + installStep(2, 'Choisis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.')
        : installStep(1, 'Dans Chrome ou Edge : icône d’installation <b>⊕</b> à droite de la barre d’adresse.') +
          installStep(2, 'Sur téléphone, ouvre plutôt cette adresse dans Chrome :<br><code>' + esc(location.origin + BASE + '/') + '</code>');
    return '<dialog class="modal" id="install-dialog"><div class="modal-form">' +
      '<h3 class="card-title">📲 Installer l’app</h3>' +
      '<ol class="install-steps">' + steps + '</ol>' +
      '<div class="modal-actions"><button type="button" class="btn-secondary" data-action="install-close">Fermer</button></div>' +
      '</div></dialog>';
  }
  function startInstall() {
    if (installPrompt) {
      var p = installPrompt;
      installPrompt = null;
      p.prompt();
      p.userChoice.then(function (r) {
        if (!r || r.outcome !== 'accepted') showToast('Installation annulée : tu pourras la relancer depuis les réglages.');
        safeRender();
      }).catch(function () {});
      return;
    }
    var dlg = document.getElementById('install-dialog');
    if (dlg) dlg.showModal();
  }

  function renderAccountCard() {
    var isOpen = openAccordions.has('settings-account');
    return '<section class="card"><details data-key="settings-account"' + (isOpen ? ' open' : '') + '><summary class="card-title">Compte</summary>' +
      '<div class="settings-body">' +
      '<p class="empty-note">Le mot de passe est stocké haché côté serveur — il ne peut plus être affiché en clair.</p>' +
      '<form class="settings-form" data-form="change-username">' +
        '<label>Identifiant<input type="text" name="username" value="' + esc(currentUsername) + '" required></label>' +
        '<button type="submit" class="btn-add">Mettre à jour</button>' +
      '</form>' +
      '<form class="settings-form" data-form="change-password">' +
        '<label>Mot de passe actuel<input type="password" name="currentPassword" required autocomplete="current-password"></label>' +
        '<label>Nouveau mot de passe<input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></label>' +
        '<button type="submit" class="btn-add">Changer le mot de passe</button>' +
      '</form>' +
      (accountMessage ? '<p class="' + (accountError ? 'login-error' : 'empty-note') + '">' + esc(accountMessage) + '</p>' : '') +
      '<button type="button" class="btn-secondary" data-action="logout">Se déconnecter</button>' +
      '</div></details></section>';
  }

  // --- event delegation ---
  function onClick(e) {
    if (e.target.tagName === 'DIALOG') {
      if (e.target.id === 'confirm-dialog') pendingConfirmAction = null;
      if (e.target.id === 'icon-modal') iconModalTarget = null;
      if (e.target.id === 'add-envelope-modal') addEnvelopeModalOpen = false;
      e.target.close();
      return;
    }
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    if (action === 'prev-month') { navigateMonth(-1); return; }
    if (action === 'next-month') { navigateMonth(1); return; }
    if (action === 'nav-dashboard') { navigatePage('dashboard'); return; }
    if (action === 'nav-stats') { navigatePage('stats'); return; }
    if (action === 'nav-settings') { navigatePage('settings'); return; }
    if (action === 'prev-year') { navigateYear(-1); return; }
    if (action === 'next-year') { navigateYear(1); return; }
    if (action === 'open-filter-modal') { render(); var dlgF = document.getElementById('filter-modal'); if (dlgF) dlgF.showModal(); return; }
    if (action === 'reset-filter') { movementSearchQuery = ''; movementTypeFilter = 'all'; render(); return; }
    if (action === 'group-week') { movementGroupBy = 'week'; render(); return; }
    if (action === 'group-budget') { movementGroupBy = 'budget'; render(); return; }
    if (action === 'group-tag') { movementGroupBy = 'tag'; render(); return; }
    if (action === 'group-payment') { movementGroupBy = 'payment'; render(); return; }
    if (action === 'open-budget') {
      currentPage = 'dashboard';
      movementGroupBy = 'budget';
      openAccordions.add('budget-' + btn.dataset.id);
      render();
      return;
    }
    if (action === 'logout') {
      if (dirty) { showToast('Des modifications ne sont pas encore envoyées au serveur : attends le retour du réseau.'); return; }
      apiFetch('/api/logout', { method: 'POST' }).then(function () {
        isAuthenticated = false;
        clearInterval(pollTimer);
        pollTimer = null;
        clearLocal();
        state = null; baseState = null; baseVersion = null;
        render();
      }).catch(function () { showToast('Pas de réseau : déconnexion impossible pour l’instant.'); });
      return;
    }
    if (action === 'install') { startInstall(); return; }
    if (action === 'install-close') { var dlgI = document.getElementById('install-dialog'); if (dlgI) dlgI.close(); return; }
    if (action === 'install-hide') { setInstallHidden(); render(); return; }
    if (action === 'confirm-yes') {
      var confirmDlg = document.getElementById('confirm-dialog');
      if (confirmDlg) confirmDlg.close();
      var fn = pendingConfirmAction;
      pendingConfirmAction = null;
      pendingConfirmExtra = null;
      if (fn) fn();
      return;
    }
    if (action === 'confirm-extra') {
      var confirmDlgX = document.getElementById('confirm-dialog');
      if (confirmDlgX) confirmDlgX.close();
      var fnX = pendingConfirmExtra && pendingConfirmExtra.action;
      pendingConfirmAction = null;
      pendingConfirmExtra = null;
      if (fnX) fnX();
      return;
    }
    if (action === 'confirm-no') {
      pendingConfirmAction = null;
      pendingConfirmExtra = null;
      var confirmDlg2 = document.getElementById('confirm-dialog');
      if (confirmDlg2) confirmDlg2.close();
      return;
    }
    if (action === 'open-movement-modal') { editingMovementId = null; render(); var dlg = document.getElementById('movement-modal'); if (dlg) dlg.showModal(); return; }
    if (action === 'close-movement-modal') { editingMovementId = null; var dlg2 = document.getElementById('movement-modal'); if (dlg2) dlg2.close(); return; }
    if (action === 'edit-movement') {
      editingMovementId = btn.dataset.id;
      render();
      var dlg3 = document.getElementById('movement-modal');
      if (dlg3) dlg3.showModal();
      return;
    }
    if (action === 'delete-movement') {
      var delId = btn.dataset.id;
      requestConfirm('Supprimer ce mouvement ?', function () {
        if (editingMovementId === delId) editingMovementId = null;
        mutate(function () { removeMovement(selectedMonthKey, delId); });
      });
      return;
    }
    if (action === 'pick-icon') {
      var grid = btn.closest('.icon-grid');
      var hiddenInput = document.getElementById('icon-input-new');
      if (hiddenInput) hiddenInput.value = btn.dataset.icon;
      if (grid) {
        grid.querySelectorAll('.icon-choice').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
      }
      return;
    }
    if (action === 'toggle-color-grid') {
      var target = btn.dataset.target;
      colorGridOpenFor = (colorGridOpenFor === target) ? null : target;
      render();
      return;
    }
    if (action === 'open-icon-modal') {
      iconModalTarget = btn.dataset.target;
      render();
      var dlgIcon = document.getElementById('icon-modal');
      if (dlgIcon) dlgIcon.showModal();
      return;
    }
    if (action === 'close-icon-modal') {
      iconModalTarget = null;
      var dlgIcon2 = document.getElementById('icon-modal');
      if (dlgIcon2) dlgIcon2.close();
      return;
    }
    if (action === 'open-add-envelope-modal') {
      addEnvelopeModalOpen = true;
      render();
      var dlgAddEnv = document.getElementById('add-envelope-modal');
      if (dlgAddEnv) dlgAddEnv.showModal();
      return;
    }
    if (action === 'close-add-envelope-modal') {
      addEnvelopeModalOpen = false;
      var dlgAddEnv2 = document.getElementById('add-envelope-modal');
      if (dlgAddEnv2) dlgAddEnv2.close();
      return;
    }
    if (action === 'reset-all') {
      requestConfirm('Réinitialiser toutes les données du budget ? Cette action est irréversible.', function () {
        state = defaultState();
        selectedMonthKey = currentMonthKey();
        commit();
      });
      return;
    }
    var id = btn.dataset.id;
    switch (action) {
      case 'remove-income':
        requestConfirm(
          'Supprimer ce revenu seulement pour ' + monthLabel(selectedMonthKey) + ', ou aussi pour les mois suivants ?',
          function () { mutate(function () { endIncome(selectedMonthKey, id); }); },
          null,
          { label: 'Ce mois', action: function () { mutate(function () { removeIncomeThisMonth(selectedMonthKey, id); }); } },
          'Tous'
        );
        break;
      case 'remove-fixed':
        requestConfirm(
          'Supprimer cette dépense fixe seulement pour ' + monthLabel(selectedMonthKey) + ', ou aussi pour les mois suivants ?',
          function () { mutate(function () { endFixed(selectedMonthKey, id); }); },
          null,
          { label: 'Ce mois', action: function () { mutate(function () { removeFixedThisMonth(selectedMonthKey, id); }); } },
          'Tous'
        );
        break;
      case 'remove-envelope':
        requestConfirm(
          'Supprimer ce budget seulement pour ' + monthLabel(selectedMonthKey) + ', ou aussi pour les mois suivants ?',
          function () { mutate(function () { endEnvelope(selectedMonthKey, id); }); },
          null,
          { label: 'Ce mois', action: function () { mutate(function () { removeEnvelopeThisMonth(selectedMonthKey, id); }); } },
          'Tous'
        );
        break;
      case 'set-envelope-icon': mutate(function () { setEnvelopeIcon(id, btn.dataset.icon); iconModalTarget = null; }); break;
      case 'set-envelope-color-swatch': mutate(function () { setEnvelopeColor(id, btn.dataset.color); colorGridOpenFor = null; }); break;
      case 'remove-ephemeral-envelope': mutate(function () { removeEphemeralEnvelope(selectedMonthKey, id); }); break;
      case 'set-ephemeral-envelope-icon': mutate(function () { setEphemeralEnvelopeIcon(selectedMonthKey, id, btn.dataset.icon); iconModalTarget = null; }); break;
      case 'set-ephemeral-envelope-color-swatch': mutate(function () { setEphemeralEnvelopeColor(selectedMonthKey, id, btn.dataset.color); colorGridOpenFor = null; }); break;
      case 'remove-tag': mutate(function () { removeTag(id); }); break;
      case 'set-tag-color-swatch': mutate(function () { setTagColor(id, btn.dataset.color); colorGridOpenFor = null; }); break;
      case 'remove-payment-method': mutate(function () { removePaymentMethod(id); }); break;
      case 'set-payment-icon': mutate(function () { setPaymentMethodIcon(id, btn.dataset.icon); iconModalTarget = null; }); break;
      case 'remove-movement':
        requestConfirm('Supprimer ce mouvement ?', function () {
          if (editingMovementId === id) editingMovementId = null;
          mutate(function () { removeMovement(selectedMonthKey, id); });
        });
        break;
    }
  }

  function onChange(e) {
    var el = e.target;
    var field = el.dataset.field;
    if (!field) return;
    if (field === 'stats-col') {
      statsCols[el.dataset.col] = el.checked;
      render();
      stashUi();
      return;
    }
    if (field === 'movement-tag-select') {
      // Pas de render() ici : la modale de mouvement perdrait sa saisie en cours
      // (voir requestConfirm plus haut, qui referme explicitement cette modale
      // avant de re-render pour la même raison).
      var form = el.closest('form');
      var newTagInput = form && form.querySelector('[name="newTagName"]');
      if (newTagInput) {
        var showNewTag = el.value === '__new_tag__';
        newTagInput.hidden = !showNewTag;
        if (showNewTag) newTagInput.focus();
      }
      return;
    }
    var id = el.dataset.id;
    if (field === 'fixed-paid') {
      mutate(function () { toggleFixedPaid(selectedMonthKey, id); });
      return;
    }
    var isEphemeral = el.dataset.ephemeral === 'true';
    if (field === 'envelope-name') {
      if (isEphemeral) {
        mutate(function () { renameEphemeralEnvelope(selectedMonthKey, id, el.value.trim() || 'Budget'); });
      } else {
        mutate(function () { renameEnvelope(id, el.value.trim() || 'Budget'); });
      }
      return;
    }
    if (field === 'envelope-color') {
      if (isEphemeral) {
        mutate(function () { setEphemeralEnvelopeColor(selectedMonthKey, id, el.value); });
      } else {
        mutate(function () { setEnvelopeColor(id, el.value); });
      }
      return;
    }
    if (field === 'tag-name') {
      mutate(function () { renameTag(id, el.value.trim() || 'Tag'); });
      return;
    }
    if (field === 'tag-color') {
      mutate(function () { setTagColor(id, el.value); });
      return;
    }
    if (field === 'payment-method-name') {
      mutate(function () { renamePaymentMethod(id, el.value.trim() || 'Mode de paiement'); });
      return;
    }
    if (field === 'default-payment-method') {
      mutate(function () { setDefaultPaymentMethod(el.value); });
      return;
    }
    if (field === 'envelope-amount') {
      var amountValue = parseFloat(el.value);
      if (Number.isNaN(amountValue)) return;
      if (isEphemeral) {
        mutate(function () { setEphemeralEnvelopeAmount(selectedMonthKey, id, amountValue); });
        return;
      }
      var amountTargets = futureMonthsWithSameWeeks(selectedMonthKey);
      if (!amountTargets.length) {
        mutate(function () { setMonthEnvelopeAmount(selectedMonthKey, id, amountValue); });
        return;
      }
      // On applique le changement de suite (le champ doit refléter la saisie), mais on
      // retarde la publication tant que l'utilisateur n'a pas répondu à la question de
      // répercussion : publier tout de suite provoquerait le rechargement de cette vue
      // (déclenché par la plateforme sur toute publication), qui fermerait la modale de
      // confirmation avant que l'utilisateur ait pu y répondre — quel que soit son choix
      // (ou même s'il ne répond pas), la publication a lieu une fois la modale fermée.
      setMonthEnvelopeAmount(selectedMonthKey, id, amountValue);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(amountValue) + ') sur les ' + amountTargets.length + ' mois suivants ayant le même nombre de semaines ?',
          function () { amountTargets.forEach(function (k) { setMonthEnvelopeAmount(k, id, amountValue); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    if (field === 'envelope-week-amount') {
      var weekIdx = parseInt(el.dataset.week, 10);
      var weekValue = parseFloat(el.value);
      if (Number.isNaN(weekValue)) return;
      var weekTargets = isEphemeral ? [] : futureMonthsWithSameWeeks(selectedMonthKey);
      if (!weekTargets.length) {
        mutate(function () { setEnvelopeWeekAmount(selectedMonthKey, id, weekIdx, weekValue, isEphemeral); });
        return;
      }
      // Voir le commentaire équivalent ci-dessus pour 'envelope-amount'.
      setEnvelopeWeekAmount(selectedMonthKey, id, weekIdx, weekValue, isEphemeral);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(weekValue) + ') sur les ' + weekTargets.length + ' mois suivants ayant le même nombre de semaines ?',
          function () { weekTargets.forEach(function (k) { setEnvelopeWeekAmount(k, id, weekIdx, weekValue, isEphemeral); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    if (field === 'income-amount') {
      var incomeAmountValue = parseFloat(el.value);
      if (Number.isNaN(incomeAmountValue)) return;
      var incomeTargets = futureMonths(selectedMonthKey);
      if (!incomeTargets.length) {
        mutate(function () { setMonthIncomeAmount(selectedMonthKey, id, incomeAmountValue); });
        return;
      }
      // Voir le commentaire équivalent plus haut pour 'envelope-amount'.
      setMonthIncomeAmount(selectedMonthKey, id, incomeAmountValue);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(incomeAmountValue) + ') sur les ' + incomeTargets.length + ' mois suivants ?',
          function () { incomeTargets.forEach(function (k) { setMonthIncomeAmount(k, id, incomeAmountValue); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    if (field === 'fixed-amount') {
      var fixedAmountValue = parseFloat(el.value);
      if (Number.isNaN(fixedAmountValue)) return;
      var fixedTargets = futureMonths(selectedMonthKey);
      if (!fixedTargets.length) {
        mutate(function () { setMonthFixedAmount(selectedMonthKey, id, fixedAmountValue); });
        return;
      }
      // Voir le commentaire équivalent plus haut pour 'envelope-amount'.
      setMonthFixedAmount(selectedMonthKey, id, fixedAmountValue);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(fixedAmountValue) + ') sur les ' + fixedTargets.length + ' mois suivants ?',
          function () { fixedTargets.forEach(function (k) { setMonthFixedAmount(k, id, fixedAmountValue); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    var value = parseFloat(el.value);
    if (Number.isNaN(value)) return;
    switch (field) {
      case 'weeks-count': mutate(function () { setWeeksCount(selectedMonthKey, value); }); break;
      case 'week-start-day': mutate(function () { setWeekStartDay(value); }); break;
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var type = form.dataset.form;
    var fd = new FormData(form);

    if (type === 'movement-filter') {
      movementSearchQuery = (fd.get('query') || '').toString();
      movementTypeFilter = (fd.get('type') || 'all').toString();
      render();
      return;
    }

    if (type === 'login') {
      var u = (fd.get('username') || '').toString().trim();
      var p = (fd.get('password') || '').toString();
      var remember = fd.get('remember') === 'on';
      apiFetch('/api/login', { method: 'POST', body: { username: u, password: p, remember: remember } })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (res.ok) {
            loginError = '';
            isAuthenticated = true;
            currentUsername = res.data.username || u;
            return loadStateAndRender();
          }
          loginError = (res.data && res.data.error) || 'Identifiant ou mot de passe incorrect.';
          render();
        })
        .catch(function () {
          loginError = 'Erreur de connexion au serveur.';
          render();
        });
      return;
    }

    if (type === 'change-username') {
      var newUsername = (fd.get('username') || '').toString().trim();
      apiFetch('/api/account/username', { method: 'POST', body: { username: newUsername } })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (res.ok) {
            currentUsername = res.data.username;
            accountMessage = 'Identifiant mis à jour.';
            accountError = false;
          } else {
            accountMessage = (res.data && res.data.error) || "Impossible de mettre à jour l'identifiant.";
            accountError = true;
          }
          render();
        })
        .catch(function () {
          accountMessage = 'Erreur de connexion au serveur.';
          accountError = true;
          render();
        });
      return;
    }

    if (type === 'change-password') {
      var currentPassword = (fd.get('currentPassword') || '').toString();
      var newPassword = (fd.get('newPassword') || '').toString();
      apiFetch('/api/account/password', { method: 'POST', body: { currentPassword: currentPassword, newPassword: newPassword } })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (res.ok) {
            accountMessage = 'Mot de passe changé.';
            accountError = false;
          } else {
            accountMessage = (res.data && res.data.error) || 'Impossible de changer le mot de passe.';
            accountError = true;
          }
          render();
        })
        .catch(function () {
          accountMessage = 'Erreur de connexion au serveur.';
          accountError = true;
          render();
        });
      return;
    }

    if (type === 'add-income') {
      var name = (fd.get('name') || '').toString().trim();
      var amount = parseFloat(fd.get('amount'));
      if (name && !Number.isNaN(amount)) mutate(function () { addIncome(name, amount, selectedMonthKey); });
    } else if (type === 'add-fixed') {
      name = (fd.get('name') || '').toString().trim();
      amount = parseFloat(fd.get('amount'));
      if (name && !Number.isNaN(amount)) mutate(function () { addFixed(name, amount, selectedMonthKey); });
    } else if (type === 'add-envelope') {
      name = (fd.get('name') || '').toString().trim();
      amount = parseFloat(fd.get('amount'));
      var icon = (fd.get('icon') || '').toString() || DEFAULT_ICON;
      var isEphemeralNew = fd.get('ephemeral') === 'on';
      if (name && !Number.isNaN(amount)) {
        if (isEphemeralNew) {
          mutate(function () { addEphemeralEnvelope(selectedMonthKey, name, amount, icon); addEnvelopeModalOpen = false; });
        } else {
          mutate(function () { addEnvelope(name, amount, icon); addEnvelopeModalOpen = false; });
        }
      }
    } else if (type === 'add-tag') {
      name = (fd.get('name') || '').toString().trim();
      if (name) mutate(function () { addTag(name); });
    } else if (type === 'add-payment-method') {
      name = (fd.get('name') || '').toString().trim();
      var defaultIcons = ['💵', '💳', '🏦'];
      var newIcon = defaultIcons[state.recurring.paymentMethods.length % defaultIcons.length];
      if (name) mutate(function () { addPaymentMethod(name, newIcon); });
    } else if (type === 'add-movement') {
      clearFieldErrors(form);
      var date = (fd.get('date') || '').toString() || todayISO();
      var mtype = (fd.get('type') || 'expense').toString();
      var envelopeId = (fd.get('envelopeId') || '').toString() || null;
      var tagId = (fd.get('tagId') || '').toString() || null;
      var newTagName = (fd.get('newTagName') || '').toString().trim();
      var paymentMethodId = (fd.get('paymentMethodId') || '').toString() || null;
      var label = (fd.get('label') || '').toString().trim();
      amount = parseFloat(fd.get('amount'));
      var movementId = (fd.get('movementId') || '').toString() || null;

      var invalidFields = [];
      if (!label) invalidFields.push('label');
      if (Number.isNaN(amount) || amount < 0) invalidFields.push('amount');
      if (invalidFields.length) {
        invalidFields.forEach(function (f) { markFieldError(form, f); });
        var firstInvalid = form.querySelector('[name="' + invalidFields[0] + '"]');
        if (firstInvalid) firstInvalid.focus();
        showToast('Vérifie les champs entourés en rouge avant d’enregistrer.');
        return;
      }

      editingMovementId = null;
      mutate(function () {
        if (tagId === '__new_tag__') tagId = newTagName ? addTag(newTagName) : null;
        if (movementId) {
          updateMovement(selectedMonthKey, movementId, date, mtype, label, amount, envelopeId, tagId, paymentMethodId);
        } else {
          addMovement(selectedMonthKey, date, mtype, label, amount, envelopeId, tagId, paymentMethodId);
        }
      });
      var shownKey = movementMonthKey(state, { date: date, envelopeId: envelopeId }, selectedMonthKey);
      if (shownKey !== selectedMonthKey) showToast('Mouvement du ' + formatDateShort(date) + ' rangé dans ' + monthLabel(shownKey) + '.');
    }
  }

  // --- swipe-to-edit/delete on movement rows ---
  var swipeState = null;
  var SWIPE_THRESHOLD = 70;
  var SWIPE_MAX = 90;

  function onPointerDown(e) {
    var row = e.target.closest('.movement-row');
    if (!row || e.target.closest('button')) return;
    var container = row.closest('.movement-swipe');
    if (!container) return;
    swipeState = { id: container.dataset.id, row: row, startX: e.clientX, delta: 0, dragging: false };
    try { row.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPointerMove(e) {
    if (!swipeState) return;
    var delta = e.clientX - swipeState.startX;
    if (Math.abs(delta) > 6) swipeState.dragging = true;
    if (!swipeState.dragging) return;
    var clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, delta));
    swipeState.row.style.transform = 'translateX(' + clamped + 'px)';
    swipeState.delta = clamped;
  }
  function onPointerUp(e) {
    if (!swipeState) return;
    var st = swipeState;
    swipeState = null;
    st.row.style.transition = 'transform 0.2s ease';
    st.row.style.transform = 'translateX(0)';
    setTimeout(function () { if (st.row) st.row.style.transition = ''; }, 220);
    if (!st.dragging) return;
    if (st.delta <= -SWIPE_THRESHOLD) {
      requestConfirm('Supprimer ce mouvement ?', function () {
        if (editingMovementId === st.id) editingMovementId = null;
        mutate(function () { removeMovement(selectedMonthKey, st.id); });
      });
    } else if (st.delta >= SWIPE_THRESHOLD) {
      editingMovementId = st.id;
      render();
      var dlg = document.getElementById('movement-modal');
      if (dlg) dlg.showModal();
    }
  }

  var appEl = document.getElementById('app');
  appEl.addEventListener('click', onClick);
  appEl.addEventListener('submit', onSubmit);
  appEl.addEventListener('input', function (e) {
    e.target.classList.remove('field-error');
  });
  appEl.addEventListener('change', onChange);
  appEl.addEventListener('pointerdown', onPointerDown);
  appEl.addEventListener('pointermove', onPointerMove);
  appEl.addEventListener('pointerup', onPointerUp);
  appEl.addEventListener('pointercancel', onPointerUp);
  // Un état reçu du serveur pendant une saisie est affiché à la fermeture de la fenêtre.
  appEl.addEventListener('close', function () {
    if (renderDeferred) setTimeout(function () { if (renderDeferred && !document.querySelector('#app dialog[open]')) render(); }, 0);
  }, true);
  // 'toggle' ne bubble pas : on l'intercepte en phase de capture pour mémoriser
  // l'état ouvert/fermé des accordéons sans provoquer de re-rendu. Un seul accordéon
  // reste ouvert à la fois : en ouvrir un referme tous les autres directement dans le DOM.
  appEl.addEventListener('toggle', function (e) {
    var det = e.target;
    if (!det || det.tagName !== 'DETAILS' || !det.dataset.key) return;
    if (det.open) {
      Array.from(openAccordions).forEach(function (k) {
        if (k === det.dataset.key) return;
        openAccordions.delete(k);
        var other = appEl.querySelector('details[data-key="' + k + '"]');
        if (other && other !== det) other.open = false;
      });
      openAccordions.add(det.dataset.key);
    } else {
      openAccordions.delete(det.dataset.key);
    }
  }, true);

  render();
  boot();
})();
