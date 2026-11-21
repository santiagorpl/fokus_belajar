/* =========================================================
   app.js – menghubungkan UI dengan timer, musik, alarm, dan
   penyimpanan
   ========================================================= */
(function () {
  "use strict";

  var FT = window.FocusTune;
  var storage = FT.storage;
  var formatTime = FT.formatTime;

  var CATEGORY_LABEL = { study: "Belajar", break: "Istirahat" };
  var PAGE_TITLE = {
    timer: "Timer Belajar",
    music: "Pustaka Musik",
    settings: "Pengaturan",
    history: "Riwayat Sesi"
  };

  var settings = storage.loadSettings();
  var alarm = new FT.Alarm();
  alarm.setEnabled(settings.alarmEnabled);

  var audioElement = document.getElementById("audio-player");
  var music = null;
  var timer = null;

  /* ---------- Utilitas DOM & format ---------- */
  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatBytes(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDuration(milliseconds) {
    var minutes = Math.round((milliseconds || 0) / 60000);
    if (minutes < 60) return minutes + " menit";
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return hours + " jam" + (rest ? " " + rest + " menit" : "");
  }

  function modeLabel(mode) {
    if (mode === "study") return "Belajar";
    if (mode === "break") return "Istirahat";
    return "Belajar + Istirahat";
  }

  function toast(message, type) {
    type = type || "info";
    var region = $("#toast-region");
    if (!region) return;

    var element = document.createElement("div");
    element.className = "toast" + (type !== "info" ? " " + type : "");

    var icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = type === "error" ? "!" : (type === "warn" ? "▲" : "✓");

    var text = document.createElement("span");
    text.textContent = message;

    element.appendChild(icon);
    element.appendChild(text);
    region.appendChild(element);

    while (region.children.length > 4) region.removeChild(region.firstChild);
    setTimeout(function () {
      if (element.parentNode) element.parentNode.removeChild(element);
    }, 4500);
  }

  /* ---------- Inisialisasi manager ---------- */
  music = new FT.MusicManager(audioElement, settings, {
    onError: function (message) { toast(message, "warn"); },
    onEmpty: function (category) {
      toast("Belum ada lagu " + CATEGORY_LABEL[category] + ". Unggah lagu di halaman Musik.", "warn");
    }
  });

  music.on("state", renderMusicUI);
  music.on("library", renderLibraries);
  music.on("progress", renderSeek);

  timer = new FT.PomodoroTimer(settings, {
    onUpdate: renderTimer,
    onPhaseChange: function (state) {
      flashPhase();
      renderTimer(state);
      music.applyPhase(state.phase, { autoplay: true });
      toast(state.phase === "study" ? "Sesi belajar dimulai." : "Waktu istirahat dimulai.");
    },
    onBeep: function () { alarm.beep(); },
    onComplete: function (summary) {
      alarm.completion(true); // notifikasi penyelesaian tetap dibunyikan
      storage.addHistory(summary);
      renderHistory();
      showCompletion(summary);
      music.applyPhase("done");
    },
    onReset: function () {
      music.applyPhase("idle");
      $("#completion-banner").classList.add("hidden");
    }
  });

  /* ---------- Render UI ---------- */
  function showView(name) {
    $$(".view").forEach(function (view) {
      view.classList.toggle("active", view.id === "view-" + name);
    });
    $$(".nav-item").forEach(function (button) {
      var active = button.dataset.view === name;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#page-title").textContent = PAGE_TITLE[name] || "FocusTune";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function flashPhase() {
    var card = $("#timer-card");
    card.classList.remove("phase-switch");
    void card.offsetWidth; // memaksa reflow agar animasi ulang
    card.classList.add("phase-switch");
    setTimeout(function () { card.classList.remove("phase-switch"); }, 700);
  }

  function renderTimer(state) {
    $("#time-display").textContent = state.display;

    var phaseBadge = $("#phase-badge");
    var isBreak = state.phase === "break" && state.status !== "finished";
    phaseBadge.textContent = state.status === "finished" ? "SELESAI" : (isBreak ? "ISTIRAHAT" : "BELAJAR");
    phaseBadge.classList.toggle("phase-study", !isBreak);
    phaseBadge.classList.toggle("phase-break", isBreak);

    $("#session-badge").textContent = "SESI " + state.session + " DARI " + state.sessions;

    var caption;
    if (state.status === "running") {
      caption = isBreak ? "Tarik napas. Musim istirahat." : "Fokus. Biar lagu menemani Anda.";
    } else if (state.status === "paused") {
      caption = "Timer dijeda — siap dilanjutkan.";
    } else if (state.status === "finished") {
      caption = "Sesi hari ini selesai. Luar biasa!";
    } else {
      caption = "Siap memulai sesi belajar";
    }
    $("#phase-caption").textContent = caption;

    var circumference = 678.58; // sama dengan --ring-circumference di CSS
    $("#ring-progress").style.strokeDashoffset = String(circumference * (1 - state.progress));

    $("#btn-start").disabled = state.status !== "idle";
    $("#btn-pause").disabled = state.status !== "running";
    $("#btn-resume").disabled = state.status !== "paused";
    $("#btn-reset").disabled = state.status === "idle";

    document.body.classList.toggle("timer-running", state.status === "running");
    document.body.classList.toggle("timer-paused", state.status === "paused");
    document.body.classList.toggle("phase-break", isBreak);

    var statusText = {
      idle: "Siap memulai",
      running: "Timer berjalan",
      paused: "Timer dijeda",
      finished: "Semua sesi selesai"
    };
    $("#sidebar-status").textContent = statusText[state.status];

    var autoBlocked = music && music.getState().autoBlocked;
    var hint;
    if (autoBlocked && state.status !== "finished") {
      hint = 'Autoplay diblokir browser. Klik sekali tombol <strong>▶</strong> pada pemutar musik, lalu lagu akan diputar otomatis.';
    } else if (state.status === "idle") {
      hint = 'Tekan <strong>MULAI</strong> untuk mengizinkan browser memutar musik dan alarm. Timer tetap akurat meskipun tab tidak aktif.';
    } else if (state.status === "running") {
      hint = 'Timer berjalan. Alarm <strong>BEEP</strong> akan berbunyi setiap detik saat tersisa 10 detik.';
    } else if (state.status === "paused") {
      hint = 'Timer dijeda. Tekan <strong>LANJUTKAN</strong> untuk menyambung waktu dan musik dari posisi terakhir.';
    } else {
      hint = 'Semua sesi selesai. Lihat detail di banner di atas atau buka halaman <strong>Riwayat</strong>.';
    }
    $("#hint-text").innerHTML = hint;

    document.title = state.display + " · " + (isBreak ? "Istirahat" : "Belajar") + " | FocusTune";
    if (state.status !== "finished") $("#completion-banner").classList.add("hidden");
  }

  function showCompletion(summary) {
    showView("timer");
    $("#completion-title").textContent = "SELAMAT! SEMUA SESI SELESAI";
    $("#completion-detail").textContent =
      "Total waktu belajar " + formatDuration(summary.totalStudyMs) +
      " · " + summary.sessions + " sesi berhasil diselesaikan.";
    $("#completion-banner").classList.remove("hidden");
    toast("Semua sesi selesai. Kerja bagus!", "info");
  }

  function renderLibraries() {
    ["study", "break"].forEach(function (category) {
      var list = music.tracks[category] || [];
      var container = $("#list-" + category);
      $("#count-" + category).textContent = String(list.length);

      if (!list.length) {
        container.innerHTML = '<div class="empty-state">Belum ada lagu. Klik <strong>+ Unggah</strong> untuk menambahkan lagu ' +
          CATEGORY_LABEL[category].toLowerCase() + '.</div>';
        return;
      }

      container.innerHTML = list.map(function (track, index) {
        var selected = music.selected[category] === track.id;
        return '<div class="track-item' + (selected ? ' selected' : '') + '" role="button" tabindex="0" ' +
          'data-track-id="' + escapeHtml(track.id) + '" data-category="' + category + '">' +
          '<span class="track-index">' + (index + 1) + '</span>' +
          '<span class="track-meta"><strong>' + escapeHtml(track.name) + '</strong>' +
          '<small>' + escapeHtml(track.fileName) + ' · ' + formatBytes(track.size) + '</small></span>' +
          '<button class="icon-btn danger" type="button" data-delete-track="' + escapeHtml(track.id) +
          '" data-category="' + category + '" aria-label="Hapus ' + escapeHtml(track.name) + '">✕</button>' +
          '</div>';
      }).join("");
    });
    renderMusicUI();
  }

  function renderMusicUI() {
    if (!music || !timer) return;
    var state = music.getState();
    var track = state.currentTrack;
    var timerState = timer.getState();
    var source = state.activeCategory || timerState.phase;

    $("#now-title").textContent = track ? track.name : "Belum ada lagu";
    $("#now-subtitle").textContent = track
      ? CATEGORY_LABEL[track.category] + " · " + formatBytes(track.size)
      : "Unggah lagu di panel Musik";
    $("#player-subtitle").textContent = track ? track.name : "Pilih lagu dari daftar di atas";

    var sourceText = CATEGORY_LABEL[source] || "Belajar";
    $("#music-source-chip").textContent = sourceText;
    $("#player-source-chip").textContent = sourceText;

    $$('[data-music-action="play"]').forEach(function (button) {
      button.textContent = state.playing ? "❚❚" : "▶";
      button.setAttribute("aria-label", state.playing ? "Jeda musik" : "Putar musik");
    });

    renderSeek();
  }

  function renderSeek() {
    if (!music) return;
    var state = music.getState();
    var ratio = state.duration > 0 ? state.currentTime / state.duration : 0;
    var bar = $("#seek-bar");

    if (document.activeElement !== bar) bar.value = String(Math.round(ratio * 1000));
    $("#seek-current").textContent = formatTime(state.currentTime * 1000);
    $("#seek-duration").textContent = state.duration > 0 ? formatTime(state.duration * 1000) : "0:00";
  }

  function renderHistory() {
    var history = storage.getHistory();
    var container = $("#history-list");

    if (!history.length) {
      container.innerHTML = '<div class="empty-state">Belum ada sesi yang selesai. Selesaikan satu siklus untuk melihat riwayat di sini.</div>';
      return;
    }

    container.innerHTML = history.map(function (entry) {
      var date = new Date(entry.completedAt);
      var dateText = isNaN(date.getTime()) ? "-" : date.toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      });
      return '<div class="history-item">' +
        '<div><div class="history-date">' + escapeHtml(dateText) + '</div>' +
        '<div class="history-stats">' + escapeHtml(formatDuration(entry.totalStudyMs)) +
        ' belajar · ' + (Number(entry.sessions) || 0) + ' sesi · istirahat ' +
        (Number(entry.breakMinutes) || 0) + ' menit</div></div>' +
        '<span class="history-badge">SELESAI</span>' +
        '</div>';
    }).join("");
  }

  function applySettingsToUI() {
    $$("[data-setting]").forEach(function (element) {
      var key = element.dataset.setting;
      if (settings[key] === undefined) return;
      if (element.type === "checkbox") element.checked = !!settings[key];
      else element.value = String(settings[key]);
    });

    var percent = Math.round(settings.volume * 100) + "%";
    $$(".volume-readout").forEach(function (element) { element.textContent = percent; });
    $("#volume-mini-value").textContent = percent;

    $$("[data-mode]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.mode === settings.musicMode);
    });
    $("#mode-label").textContent = "Musik: " + modeLabel(settings.musicMode);
  }

  /* ---------- Update pengaturan ---------- */
  function updateSettings(patch) {
    settings = storage.saveSettings(Object.assign({}, settings, patch));
    timer.applySettings(settings);
    alarm.setEnabled(settings.alarmEnabled);
    music.setVolume(settings.volume);
    music.setShuffle(settings.shuffle);
    music.setMode(settings.musicMode);
    applySettingsToUI();

    // Mode musik berubah saat timer jalan → langsung sesuaikan sumber lagu.
    if (Object.prototype.hasOwnProperty.call(patch, "musicMode") && timer.getState().status === "running") {
      music.applyPhase(timer.getState().phase, { autoplay: true });
    }
  }

  function handleSettingElement(element) {
    var key = element.dataset.setting;
    var value;

    if (element.type === "checkbox") {
      value = element.checked;
    } else if (element.type === "number") {
      value = Number(element.value);
      var min = Number(element.min);
      var max = Number(element.max);
      if (!Number.isFinite(value) || value < min || value > max) {
        toast("Nilai harus antara " + min + " dan " + max + ".", "warn");
        applySettingsToUI();
        return;
      }
      value = Math.round(value);
    } else {
      value = Number(element.value);
      if (!Number.isFinite(value)) return;
    }

    var patch = {};
    patch[key] = value;
    updateSettings(patch);
  }

  /* ---------- Aksi tombol ---------- */
  function handleAction(action) {
    switch (action) {
      case "start":
        alarm.unlock();
        if (timer.start()) {
          music.applyPhase(timer.getState().phase, { autoplay: true });
        }
        break;

      case "pause":
        if (timer.pause()) music.suspend();
        break;

      case "resume":
        alarm.unlock();
        if (timer.resume()) {
          music.applyPhase(timer.getState().phase, { autoplay: true });
        }
        break;

      case "reset":
        timer.reset(); // hook onReset mengembalikan musik ke fase idle
        toast("Timer dikembalikan ke pengaturan awal.");
        break;

      case "test-alarm":
        alarm.unlock();
        alarm.beep(true);
        toast("Suara alarm diuji.");
        break;

      case "clear-history":
        if (window.confirm("Hapus semua riwayat sesi?")) {
          storage.clearHistory();
          renderHistory();
          toast("Riwayat dihapus.");
        }
        break;

      case "clear-tracks":
        if (window.confirm("Hapus semua lagu yang tersimpan? Tindakan ini tidak dapat dibatalkan.")) {
          music.clearLibrary()
            .then(function () { toast("Semua lagu dihapus."); })
            .catch(function (error) { toast("Gagal menghapus lagu: " + error.message, "error"); });
        }
        break;

      case "reset-settings":
        if (window.confirm("Kembalikan semua pengaturan ke nilai default?")) {
          settings = storage.resetSettings();
          alarm.setEnabled(settings.alarmEnabled);
          timer.applySettings(settings);
          music.setVolume(settings.volume);
          music.setShuffle(settings.shuffle);
          music.setMode(settings.musicMode);
          applySettingsToUI();
          if (timer.getState().status === "running") {
            music.applyPhase(timer.getState().phase, { autoplay: true });
          }
          toast("Pengaturan default dipulihkan.");
        }
        break;
    }
  }

  function handleMusicAction(action) {
    if (action === "play") music.togglePlay();
    else if (action === "next") music.next(1);
    else if (action === "prev") music.previous();
  }

  async function handleUpload(input, category) {
    try {
      var result = await music.addFiles(input.files, category);
      input.value = "";

      if (result.added) {
        toast(result.added + " lagu " + CATEGORY_LABEL[category].toLowerCase() + " ditambahkan.");
      }
      if (result.skipped.length) {
        toast(result.skipped.length + " file ditolak (format tidak didukung): " + result.skipped.slice(0, 3).join(", "), "warn");
      }
      if (result.added && timer.getState().status === "running") {
        music.applyPhase(timer.getState().phase, { autoplay: true, force: true });
      }
    } catch (error) {
      input.value = "";
      toast("Gagal menyimpan lagu: " + error.message, "error");
    }
  }

  async function handleDeleteTrack(id, category) {
    try {
      await music.removeTrack(id);
      toast("Lagu dihapus dari pustaka " + CATEGORY_LABEL[category].toLowerCase() + ".");
    } catch (error) {
      toast("Gagal menghapus lagu: " + error.message, "error");
    }
  }

  /* ---------- Event binding ---------- */
  function bindEvents() {
    document.addEventListener("click", function (event) {
      var element = event.target;

      var deleteButton = element.closest("[data-delete-track]");
      if (deleteButton) {
        event.stopPropagation();
        handleDeleteTrack(deleteButton.dataset.deleteTrack, deleteButton.dataset.category);
        return;
      }

      var track = element.closest("[data-track-id]");
      if (track) {
        music.select(track.dataset.category, track.dataset.trackId);
        return;
      }

      var musicAction = element.closest("[data-music-action]");
      if (musicAction) { handleMusicAction(musicAction.dataset.musicAction); return; }

      var modeButton = element.closest("[data-mode]");
      if (modeButton) { updateSettings({ musicMode: modeButton.dataset.mode }); return; }

      var actionButton = element.closest("[data-action]");
      if (actionButton) { handleAction(actionButton.dataset.action); return; }

      var gotoButton = element.closest("[data-goto]");
      if (gotoButton) { showView(gotoButton.dataset.goto); return; }

      var navButton = element.closest("[data-view]");
      if (navButton) { showView(navButton.dataset.view); }
    });

    // Keyboard: memilih lagu dari daftar dengan Enter / Spasi
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest && event.target.closest("[data-delete-track]")) return;
      var item = event.target.closest && event.target.closest("[data-track-id]");
      if (!item) return;
      event.preventDefault();
      music.select(item.dataset.category, item.dataset.trackId);
    });

    document.addEventListener("change", function (event) {
      var element = event.target.closest && event.target.closest("[data-setting]");
      if (!element || element.type === "range") return;
      handleSettingElement(element);
    });

    document.addEventListener("input", function (event) {
      var element = event.target.closest && event.target.closest('input[type="range"][data-setting]');
      if (element) handleSettingElement(element);
    });

    ["study", "break"].forEach(function (category) {
      var input = $("#input-" + category);
      input.addEventListener("change", function () { handleUpload(input, category); });
    });

    $("#seek-bar").addEventListener("input", function () {
      music.seek(Number(this.value) / 1000);
    });
    $("#seek-bar").addEventListener("change", function () { this.blur(); });

    // Tab tidak aktif: setInterval bisa di-throttle, jadi hitung ulang saat tab aktif.
    function resync() {
      timer.sync();
      var state = timer.getState();
      if (state.status === "running") music.applyPhase(state.phase, { autoplay: true });
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) resync();
    });
    window.addEventListener("focus", resync);
    window.addEventListener("beforeunload", function () { music.release(); });
  }

  /* ---------- Start ---------- */
  function init() {
    bindEvents();
    applySettingsToUI();
    showView("timer");
    renderTimer(timer.getState());
    renderLibraries();
    renderHistory();

    music.init().then(function () {
      renderLibraries();
      renderMusicUI();
      if (storage.isFallback()) {
        toast("IndexedDB tidak tersedia. Lagu hanya tersedia selama halaman ini terbuka.", "warn");
      }
    }).catch(function (error) {
      toast("Gagal memuat pustaka musik: " + error.message, "error");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
