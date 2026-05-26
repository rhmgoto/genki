(function () {
  "use strict";

  const STORAGE_KEY = "genki-records-v1";
  const MAX_PHOTO_WIDTH = 900;
  const ACTION_OPTIONS = [
    { id: "exercise", label: "運動" },
    { id: "alcohol", label: "飲酒" },
    { id: "outing", label: "外出" },
    { id: "bath", label: "入浴" },
    { id: "caffeine", label: "カフェイン" },
    { id: "medicine", label: "薬/サプリ" },
  ];

  // 画面全体で共有する小さな状態です。今後、睡眠・仕事負荷・ストレスなどを
  // 追加するときは、records の各要素に項目を足していく形にできます。
  const state = {
    records: loadRecords(),
    chartRange: "7",
    selectedMonth: "all",
    selectedActions: [],
    photoDataUrl: "",
  };

  const els = {
    todayLabel: document.getElementById("todayLabel"),
    lastUpdatedLabel: document.getElementById("lastUpdatedLabel"),
    latestScoreBadge: document.getElementById("latestScoreBadge"),
    recordForm: document.getElementById("recordForm"),
    editingId: document.getElementById("editingId"),
    score: document.getElementById("score"),
    scoreValue: document.getElementById("scoreValue"),
    scoreSteps: document.getElementById("scoreSteps"),
    actionButtons: document.getElementById("actionButtons"),
    memo: document.getElementById("memo"),
    systolic: document.getElementById("systolic"),
    diastolic: document.getElementById("diastolic"),
    pulse: document.getElementById("pulse"),
    photoInput: document.getElementById("photoInput"),
    photoPreview: document.getElementById("photoPreview"),
    removePhotoButton: document.getElementById("removePhotoButton"),
    saveButton: document.getElementById("saveButton"),
    cancelEditButton: document.getElementById("cancelEditButton"),
    recordList: document.getElementById("recordList"),
    emptyList: document.getElementById("emptyList"),
    monthFilter: document.getElementById("monthFilter"),
    monthSummary: document.getElementById("monthSummary"),
    exportCsvButton: document.getElementById("exportCsvButton"),
    scoreChart: document.getElementById("scoreChart"),
    statsGrid: document.getElementById("statsGrid"),
  };

  boot();

  function boot() {
    els.todayLabel.textContent = formatDate(new Date(), true);
    buildScoreButtons();
    buildActionButtons();
    bindEvents();
    renderAll();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {
        // PWA化の補助なので、登録に失敗しても記録機能は止めません。
      });
    }
  }

  function bindEvents() {
    // 画面下のタブ切り替えです。iPhoneで片手操作しやすい位置に置いています。
    document.querySelectorAll(".tab-nav button").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.dataset.tab);
      });
    });

    document.querySelectorAll(".segmented-control button").forEach(function (button) {
      button.addEventListener("click", function () {
        state.chartRange = button.dataset.range;
        document.querySelectorAll(".segmented-control button").forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
        renderChartAndStats();
      });
    });

    els.score.addEventListener("input", function () {
      updateScoreUi(Number(els.score.value));
    });

    els.recordForm.addEventListener("submit", saveRecord);
    els.cancelEditButton.addEventListener("click", resetForm);
    els.exportCsvButton.addEventListener("click", exportCsv);
    els.monthFilter.addEventListener("change", function () {
      state.selectedMonth = els.monthFilter.value;
      renderList();
    });

    els.photoInput.addEventListener("change", function () {
      const file = els.photoInput.files && els.photoInput.files[0];
      if (!file) return;
      readPhoto(file).then(function (dataUrl) {
        state.photoDataUrl = dataUrl;
        showPhotoPreview(dataUrl);
      });
    });

    els.removePhotoButton.addEventListener("click", function () {
      state.photoDataUrl = "";
      els.photoInput.value = "";
      showPhotoPreview("");
    });
  }

  function buildScoreButtons() {
    for (let value = 1; value <= 10; value += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(value);
      button.addEventListener("click", function () {
        els.score.value = String(value);
        updateScoreUi(value);
      });
      els.scoreSteps.appendChild(button);
    }
    updateScoreUi(Number(els.score.value));
  }

  function buildActionButtons() {
    ACTION_OPTIONS.forEach(function (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action-button";
      button.dataset.action = action.id;
      button.textContent = action.label;
      button.addEventListener("click", function () {
        toggleAction(action.id);
      });
      els.actionButtons.appendChild(button);
    });
    updateActionUi();
  }

  function toggleAction(actionId) {
    if (state.selectedActions.includes(actionId)) {
      state.selectedActions = state.selectedActions.filter(function (id) {
        return id !== actionId;
      });
    } else {
      state.selectedActions.push(actionId);
    }
    updateActionUi();
  }

  function setTab(name) {
    document.querySelectorAll(".tab-nav button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "panel-" + name);
    });
    if (name === "chart") renderChartAndStats();
  }

  function saveRecord(event) {
    event.preventDefault();

    const editingId = els.editingId.value;
    const existing = state.records.find(function (item) {
      return item.id === editingId;
    });

    const record = {
      id: editingId || crypto.randomUUID(),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      score: Number(els.score.value),
      memo: els.memo.value.trim(),
      systolic: toNumberOrEmpty(els.systolic.value),
      diastolic: toNumberOrEmpty(els.diastolic.value),
      pulse: toNumberOrEmpty(els.pulse.value),
      photoDataUrl: state.photoDataUrl || "",
      // 後から項目を増やしやすいよう、任意入力は extra に追加できます。
      // 例: mood, sleepHours, workLoad, stressLevel
      extra: Object.assign({}, existing && existing.extra ? existing.extra : {}, {
        actions: state.selectedActions.slice(),
      }),
    };

    if (editingId) {
      state.records = state.records.map(function (item) {
        return item.id === editingId ? record : item;
      });
    } else {
      state.records.push(record);
    }

    saveRecords();
    resetForm();
    renderAll();
    setTab("list");
  }

  function editRecord(id) {
    const record = state.records.find(function (item) {
      return item.id === id;
    });
    if (!record) return;

    els.editingId.value = record.id;
    els.score.value = String(record.score);
    els.memo.value = record.memo || "";
    els.systolic.value = record.systolic || "";
    els.diastolic.value = record.diastolic || "";
    els.pulse.value = record.pulse || "";
    state.selectedActions = normalizeActions(record.extra && record.extra.actions);
    state.photoDataUrl = record.photoDataUrl || "";
    showPhotoPreview(state.photoDataUrl);
    updateScoreUi(record.score);
    updateActionUi();
    els.saveButton.textContent = "更新";
    els.cancelEditButton.classList.remove("hidden");
    setTab("record");
  }

  function deleteRecord(id) {
    const ok = window.confirm("この記録を削除しますか？");
    if (!ok) return;
    state.records = state.records.filter(function (item) {
      return item.id !== id;
    });
    saveRecords();
    renderAll();
  }

  function resetForm() {
    els.recordForm.reset();
    els.editingId.value = "";
    els.score.value = "5";
    state.selectedActions = [];
    state.photoDataUrl = "";
    showPhotoPreview("");
    updateScoreUi(5);
    updateActionUi();
    els.saveButton.textContent = "保存";
    els.cancelEditButton.classList.add("hidden");
  }

  function renderAll() {
    renderLastUpdated();
    renderLatestBadge();
    renderList();
    renderChartAndStats();
  }

  function renderLastUpdated() {
    const latest = getSortedRecords()[0];
    els.lastUpdatedLabel.textContent = latest ? "最終更新: " + formatDate(new Date(latest.updatedAt || latest.createdAt)) : "最終更新: 未記録";
  }

  function renderLatestBadge() {
    const latest = getSortedRecords()[0];
    els.latestScoreBadge.textContent = latest ? latest.score : "--";
    els.latestScoreBadge.style.background = latest ? scoreColor(latest.score) : "var(--accent-strong)";
  }

  function renderList() {
    buildMonthFilter();

    const records = getVisibleListRecords();
    els.recordList.innerHTML = "";
    els.emptyList.classList.toggle("hidden", records.length > 0);
    els.emptyList.textContent = state.records.length === 0 ? "まだ記録がありません。" : "この月の記録はありません。";
    els.monthSummary.textContent = getMonthSummary(records);

    let currentMonth = "";
    records.forEach(function (record) {
      const recordMonth = monthKey(new Date(record.createdAt));
      if (state.selectedMonth === "all" && recordMonth !== currentMonth) {
        currentMonth = recordMonth;
        const heading = document.createElement("h3");
        heading.className = "month-heading";
        heading.textContent = monthLabel(recordMonth);
        els.recordList.appendChild(heading);
      }

      const card = document.createElement("article");
      card.className = "record-card";

      const meta = [];
      if (record.systolic || record.diastolic) {
        meta.push("血圧 " + (record.systolic || "--") + "/" + (record.diastolic || "--"));
      }
      if (record.pulse) meta.push("脈拍 " + record.pulse);
      actionLabels(record).forEach(function (label) {
        meta.push(label);
      });

      // innerHTMLに入れる自由入力欄は escapeHtml を通して表示します。
      card.innerHTML = [
        '<div class="record-top">',
        '  <div>',
        '    <p class="record-date">' + escapeHtml(formatDate(new Date(record.createdAt))) + "</p>",
        '    <p class="record-memo">' + escapeHtml(shortText(record.memo || "メモなし", 72)) + "</p>",
        '  </div>',
        '  <div class="record-score" style="background:' + scoreColor(record.score) + '">' + record.score + "</div>",
        "</div>",
        record.photoDataUrl ? '<img class="record-photo" src="' + record.photoDataUrl + '" alt="添付写真">' : "",
        '<div class="record-meta">' + meta.map(function (text) {
          return '<span class="meta-chip">' + escapeHtml(text) + "</span>";
        }).join("") + "</div>",
        '<div class="record-actions">',
        '  <button class="secondary-button" type="button" data-action="edit">編集</button>',
        '  <button class="delete-button" type="button" data-action="delete">削除</button>',
        "</div>",
      ].join("");

      card.querySelector('[data-action="edit"]').addEventListener("click", function () {
        editRecord(record.id);
      });
      card.querySelector('[data-action="delete"]').addEventListener("click", function () {
        deleteRecord(record.id);
      });

      els.recordList.appendChild(card);
    });
  }

  function renderChartAndStats() {
    const filtered = filterRecordsByRange(state.records, state.chartRange).sort(function (a, b) {
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    drawScoreChart(filtered);
    renderStats();
  }

  function drawScoreChart(records) {
    const canvas = els.scoreChart;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const pad = { top: 28, right: 24, bottom: 46, left: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fffdf9";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#eadfce";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#756e64";
    ctx.font = "22px system-ui, sans-serif";

    // 1〜10の固定スケールにして、日による見え方のブレを減らします。
    for (let score = 1; score <= 10; score += 1) {
      const y = pad.top + plotH - ((score - 1) / 9) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      if (score === 1 || score === 5 || score === 10) {
        ctx.fillText(String(score), 12, y + 7);
      }
    }

    if (records.length === 0) {
      ctx.fillStyle = "#756e64";
      ctx.textAlign = "center";
      ctx.fillText("記録するとグラフが表示されます", width / 2, height / 2);
      ctx.textAlign = "left";
      return;
    }

    const points = records.map(function (record, index) {
      const x = records.length === 1 ? pad.left + plotW / 2 : pad.left + (index / (records.length - 1)) * plotW;
      const y = pad.top + plotH - ((record.score - 1) / 9) * plotH;
      return { x: x, y: y, record: record };
    });

    ctx.strokeStyle = "#d9891b";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    points.forEach(function (point) {
      ctx.fillStyle = scoreColor(point.record.score);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    ctx.fillStyle = "#756e64";
    ctx.font = "18px system-ui, sans-serif";
    ctx.textAlign = "center";
    const first = records[0];
    const last = records[records.length - 1];
    ctx.fillText(formatShortDate(new Date(first.createdAt)), pad.left, height - 14);
    ctx.fillText(formatShortDate(new Date(last.createdAt)), width - pad.right, height - 14);
    ctx.textAlign = "left";
  }

  function renderStats() {
    const all = state.records;
    const seven = filterRecordsByRange(all, "7");
    const thirty = filterRecordsByRange(all, "30");
    const best = all.reduce(function (winner, item) {
      return !winner || item.score > winner.score ? item : winner;
    }, null);
    const worst = all.reduce(function (winner, item) {
      return !winner || item.score < winner.score ? item : winner;
    }, null);

    const cards = [
      ["全期間平均", averageScore(all)],
      ["直近7日平均", averageScore(seven)],
      ["直近30日平均", averageScore(thirty)],
      ["最高", best ? best.score + " (" + formatShortDate(new Date(best.createdAt)) + ")" : "--"],
      ["最低", worst ? worst.score + " (" + formatShortDate(new Date(worst.createdAt)) + ")" : "--"],
    ];

    els.statsGrid.innerHTML = cards.map(function (card) {
      return '<div class="stats-card"><span>' + card[0] + '</span><strong>' + card[1] + "</strong></div>";
    }).join("");
  }

  function updateScoreUi(value) {
    els.scoreValue.textContent = String(value);
    document.documentElement.style.setProperty("--accent", scoreColor(value));
    els.scoreSteps.querySelectorAll("button").forEach(function (button) {
      button.classList.toggle("active", Number(button.textContent) === value);
    });
  }

  function updateActionUi() {
    els.actionButtons.querySelectorAll(".action-button").forEach(function (button) {
      button.classList.toggle("active", state.selectedActions.includes(button.dataset.action));
    });
  }

  function filterRecordsByRange(records, range) {
    if (range === "all") return records.slice();
    const days = Number(range);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return records.filter(function (record) {
      return new Date(record.createdAt) >= cutoff;
    });
  }

  function exportCsv() {
    const header = ["日時", "元気スコア", "メモ", "行動", "収縮期血圧", "拡張期血圧", "脈拍"];
    const rows = getVisibleListRecords().map(function (record) {
      return [
        formatDate(new Date(record.createdAt)),
        record.score,
        record.memo || "",
        actionLabels(record).join(" / "),
        record.systolic || "",
        record.diastolic || "",
        record.pulse || "",
      ];
    });
    // Excelで開きやすいようにUTF-8 BOMを付けて出力します。
    const csv = [header].concat(rows).map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "genki-records-" + exportDatePart() + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function readPhoto(file) {
    return new Promise(function (resolve) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          const scale = Math.min(1, MAX_PHOTO_WIDTH / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function showPhotoPreview(dataUrl) {
    els.photoPreview.classList.toggle("hidden", !dataUrl);
    els.removePhotoButton.classList.toggle("hidden", !dataUrl);
    if (dataUrl) els.photoPreview.src = dataUrl;
    else els.photoPreview.removeAttribute("src");
  }

  function loadRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  }

  function getSortedRecords() {
    return state.records.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function getVisibleListRecords() {
    return getSortedRecords().filter(function (record) {
      return state.selectedMonth === "all" || monthKey(new Date(record.createdAt)) === state.selectedMonth;
    });
  }

  function buildMonthFilter() {
    const months = Array.from(new Set(getSortedRecords().map(function (record) {
      return monthKey(new Date(record.createdAt));
    })));

    const availableValues = ["all"].concat(months);
    if (!availableValues.includes(state.selectedMonth)) {
      state.selectedMonth = "all";
    }

    els.monthFilter.innerHTML = '<option value="all">すべて</option>' + months.map(function (key) {
      return '<option value="' + key + '">' + monthLabel(key) + "</option>";
    }).join("");
    els.monthFilter.value = state.selectedMonth;
  }

  function getMonthSummary(records) {
    const label = state.selectedMonth === "all" ? "すべての月" : monthLabel(state.selectedMonth);
    return label + " / " + records.length + "件";
  }

  function monthKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function monthLabel(key) {
    const parts = key.split("-");
    return parts[0] + "年" + Number(parts[1]) + "月";
  }

  function exportDatePart() {
    return state.selectedMonth === "all" ? new Date().toISOString().slice(0, 10) : state.selectedMonth;
  }

  function averageScore(records) {
    if (records.length === 0) return "--";
    const total = records.reduce(function (sum, record) {
      return sum + Number(record.score || 0);
    }, 0);
    return (total / records.length).toFixed(1);
  }

  function normalizeActions(actions) {
    return Array.isArray(actions) ? actions.filter(function (id) {
      return ACTION_OPTIONS.some(function (action) {
        return action.id === id;
      });
    }) : [];
  }

  function actionLabels(record) {
    const selected = normalizeActions(record.extra && record.extra.actions);
    return selected.map(function (id) {
      const action = ACTION_OPTIONS.find(function (item) {
        return item.id === id;
      });
      return action ? action.label : id;
    });
  }

  function scoreColor(score) {
    if (score <= 3) return "#f4978e";
    if (score <= 6) return "#f0b429";
    return "#74c69d";
  }

  function toNumberOrEmpty(value) {
    return value === "" ? "" : Number(value);
  }

  function shortText(text, max) {
    return text.length > max ? text.slice(0, max) + "..." : text;
  }

  function formatDate(date, weekdayOnly) {
    const options = weekdayOnly
      ? { month: "long", day: "numeric", weekday: "short" }
      : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" };
    return new Intl.DateTimeFormat("ja-JP", options).format(date);
  }

  function formatShortDate(date) {
    return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
  }

  function csvCell(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
