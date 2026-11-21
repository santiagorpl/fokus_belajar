/* =========================================================
   app.js – menghubungkan UI dengan timer, musik, album,
   noise, statistik, notifikasi, shortcut, dan PWA
   ========================================================= */
(function () {
  "use strict";

  var FT = window.FocusTune;
  var storage = FT.storage;
  var formatTime = FT.formatTime;
  var DEFAULT_ALBUM_ID = FT.DEFAULT_ALBUM_ID;

  var CATEGORY_LABEL = { study: "Belajar", break: "Istirahat" };
  var PAGE_TITLE = {
    timer: "Timer Belajar",
    music: "Musik & Album",
    stats: "Statistik Fokus",
    settings: "Pengaturan",
    history: "Riwayat Sesi"
  };

  var settings = storage.loadSettings();
  var alarm = new FT.Alarm();
  var noise = new FT.NoiseGenerator();
  alarm.setEnabled(settings.alarmEnabled);

  var audioElement = document.getElementById("audio-player");
  var music = null;
  var timer = null;
  var deferredPrompt = null;
  var wakeLock = null;
  var currentTask = "";

  /* ---------- Utilitas ---------- */
  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
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

  function dateKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
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
    setTimeout(function () { if (element.parentNode) element.parentNode.removeChild(element); }, 4500);
  }

  /* ---------- Notifikasi & wake lock ---------- */
  function requestNotificationPermission() {
    if (!settings.notificationsEnabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      var request = Notification.requestPermission();
      if (request && typeof request.catch === "function") request.catch(function () { /* abaikan */ });
    }
  }

  function notify(title, body) {
    if (!settings.notificationsEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification(title, { body: body, icon: "assets/icons/icon-192.png", tag: "focustune" });
    } catch (error) { /* abaikan */ }
  }

  function acquireWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () { /* tidak didukung / ditolak */ });
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (error) { /* abaikan */ }
    wakeLock = null;
  }

  /* ---------- Manager ---------- */
  music = new FT.MusicManager(audioElement, settings, {
    onError: function (message) { toast(message, "warn"); },
    onEmpty: function (category) {
      toast("Belum ada lagu " + CATEGORY_LABEL[category] + ". Unggah lagu di halaman Musik.", "warn");
    }
  });

  music.on("state", renderMusicUI);
  music.on("library", renderLibraries);
  music.on("albums", renderAlbums);
  music.on("progress", renderSeek);

  timer = new FT.PomodoroTimer(settings, {
    onUpdate: renderTimer,
    onPhaseChange: function (state) {
      flashPhase();
      renderTimer(state);
      music.applyPhase(state.phase, { autoplay: true });

      if (state.lastCompletedPhase === "study") {
        storage.addFocusLog({
          date: dateKey(new Date()),
          minutes: settings.studyMinutes,
          task: currentTask
        });
        renderStats();
      }
      if (state.phase === "study") currentTask = $("#session-task").value.trim();

      notify(
        state.phase === "study" ? "Mulai belajar" : "Waktu istirahat",
        state.phase === "study" ? "Sesi ke-" + state.session + " dimulai. Stay focus!" : "Tarik napas sejenak."
      );
      toast(state.phase === "study" ? "Sesi belajar dimulai." : "Waktu istirahat dimulai.");
    },
    onBeep: function () { alarm.beep(); },
    onComplete: function (summary) {
      summary.task = currentTask;
      alarm.completion(true);
      storage.addHistory(summary);
      renderHistory();
      showCompletion(summary);
      music.applyPhase("done");
      releaseWakeLock();
      notify("Semua sesi selesai!", summary.sessions + " sesi selesai. Total belajar " + formatDuration(summary.totalStudyMs) + ".");
    },
    onReset: function () {
      music.applyPhase("idle");
      $("#completion-banner").classList.add("hidden");
      releaseWakeLock();
    }
  });

  /* ---------- Navigasi & render ---------- */
  function showView(name) {
    $$(".view").forEach(function (view) { view.classList.toggle("active", view.id === "view-" + name); });
    $$(".nav-item").forEach(function (button) {
      var active = button.dataset.view === name;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#page-title").textContent = PAGE_TITLE[name] || "FocusTune";
    if (name === "stats") renderStats();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function flashPhase() {
    var card = $("#timer-card");
    card.classList.remove("phase-switch");
    void card.offsetWidth;
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
    if (state.status === "running") caption = isBreak ? "Tarik napas. Musim istirahat." : "Fokus. Biar lagu menemani Anda.";
    else if (state.status === "paused") caption = "Timer dijeda — siap dilanjutkan.";
    else if (state.status === "finished") caption = "Sesi hari ini selesai. Luar biasa!";
    else caption = "Siap memulai sesi belajar";
    $("#phase-caption").textContent = caption;

    var circumference = 678.58;
    $("#ring-progress").style.strokeDashoffset = String(circumference * (1 - state.progress));

    $("#btn-start").disabled = state.status !== "idle";
    $("#btn-pause").disabled = state.status !== "running";
    $("#btn-resume").disabled = state.status !== "paused";
    $("#btn-reset").disabled = state.status === "idle";

    document.body.classList.toggle("timer-running", state.status === "running");
    document.body.classList.toggle("timer-paused", state.status === "paused");
    document.body.classList.toggle("phase-break", isBreak);

    $("#sidebar-status").textContent = {
      idle: "Siap memulai", running: "Timer berjalan",
      paused: "Timer dijeda", finished: "Semua sesi selesai"
    }[state.status];

    var autoBlocked = music && music.getState().autoBlocked;
    var hint;
    if (autoBlocked && state.status !== "finished") {
      hint = 'Autoplay diblokir browser. Klik sekali tombol <strong>▶</strong> pada pemutar musik, lalu lagu akan diputar otomatis.';
    } else if (state.status === "idle") {
      hint = 'Tekan <strong>MULAI</strong> untuk mengizinkan browser memutar musik dan alarm. Timer tetap akurat meskipun tab tidak aktif.';
    } else if (state.status === "running") {
      hint = 'Timer berjalan. Alarm <strong>BEEP</strong> berbunyi setiap detik saat tersisa 10 detik. Shortcut: <kbd>Space</kbd> musik, <kbd>R</kbd> reset.';
    } else if (state.status === "paused") {
      hint = 'Timer dijeda. Tekan <strong>LANJUTKAN</strong> untuk menyambung waktu dan musik.';
    } else {
      hint = 'Semua sesi selesai. Lihat statistik dan riwayat untuk progres kakak.';
    }
    $("#hint-text").innerHTML = hint;

    document.title = state.display + " · " + (isBreak ? "Istirahat" : "Belajar") + " | FocusTune";
    if (state.status !== "finished") $("#completion-banner").classList.add("hidden");
  }

  function showCompletion(summary) {
    showView("timer");
    $("#completion-title").textContent = "SELAMAT! SEMUA SESI SELESAI";
    $("#completion-detail").textContent =
      "Total belajar " + formatDuration(summary.totalStudyMs) +
      " · " + summary.sessions + " sesi selesai" +
      (summary.task ? " · Fokus: " + summary.task : "") + ".";
    $("#completion-banner").classList.remove("hidden");
    toast("Semua sesi selesai. Kerja bagus!", "info");
  }

  function renderAlbums() {
    var container = $("#album-list");
    var active = music.albumFilter;

    var html = '<button class="album-chip' + (active === "all" ? " active" : "") +
      '" data-album-filter="all" type="button">Semua lagu</button>';

    music.albums.forEach(function (album) {
      var isDefault = album.id === DEFAULT_ALBUM_ID;
      html += '<div class="album-chip' + (active === album.id ? " active" : "") +
        '" data-album-filter="' + escapeHtml(album.id) + '" role="button" tabindex="0">' +
        escapeHtml(album.name) +
        (isDefault ? "" : '<button class="album-delete" data-delete-album="' + escapeHtml(album.id) +
          '" type="button" aria-label="Hapus album">✕</button>') +
        '</div>';
    });

    container.innerHTML = html;
  }

  function renderLibraries() {
    ["study", "break"].forEach(function (category) {
      var list = music.filteredTracks(category);
      var container = $("#list-" + category);
      $("#count-" + category).textContent = String(list.length);

      if (!list.length) {
        container.innerHTML = '<div class="empty-state">Belum ada lagu di album ini. Klik <strong>+ Unggah</strong> untuk menambahkan lagu ' +
          CATEGORY_LABEL[category].toLowerCase() + '.</div>';
        return;
      }

      var albumOptions = music.albums.map(function (album) {
        return '<option value="' + escapeHtml(album.id) + '">' + escapeHtml(album.name) + '</option>';
      }).join("");

      container.innerHTML = list.map(function (track, index) {
        var selected = music.selected[category] === track.id;
        return '<div class="track-item' + (selected ? ' selected' : '') + '" role="button" tabindex="0" ' +
          'data-track-id="' + escapeHtml(track.id) + '" data-category="' + category + '">' +
          '<span class="track-index">' + (index + 1) + '</span>' +
          '<span class="track-meta"><strong>' + escapeHtml(track.name) + '</strong>' +
          '<small>' + escapeHtml(track.fileName) + ' · ' + formatBytes(track.size) +
          ' · ' + escapeHtml(music.albumName(track.albumId)) + '</small></span>' +
          '<span class="track-actions">' +
          '<select class="track-select" data-track-album="' + escapeHtml(track.id) + '" aria-label="Pindah album">' +
          albumOptions.replace('value="' + escapeHtml(track.albumId) + '"', 'value="' + escapeHtml(track.albumId) + '" selected') +
          '</select>' +
          '<button class="cat-btn' + (track.category === "study" ? " active" : "") +
          '" data-set-category="study" data-track-id="' + escapeHtml(track.id) + '" type="button" title="Jadikan lagu belajar">B</button>' +
          '<button class="cat-btn break' + (track.category === "break" ? " active" : "") +
          '" data-set-category="break" data-track-id="' + escapeHtml(track.id) + '" type="button" title="Jadikan lagu istirahat">I</button>' +
          '<button class="icon-btn" data-rename-track="' + escapeHtml(track.id) +
          '" type="button" title="Ganti judul" aria-label="Ganti judul ' + escapeHtml(track.name) + '">✎</button>' +
          '<button class="icon-btn" data-download-track="' + escapeHtml(track.id) +
          '" type="button" title="Unduh lagu" aria-label="Unduh ' + escapeHtml(track.name) + '">⬇</button>' +
          '<button class="icon-btn danger" data-delete-track="' + escapeHtml(track.id) +
          '" type="button" aria-label="Hapus ' + escapeHtml(track.name) + '">✕</button>' +
          '</span></div>';
      }).join("");
    });
    renderMusicUI();
  }

  function renderMusicUI() {
    if (!music || !timer) return;
    var state = music.getState();
    var track = state.currentTrack;
    var source = state.activeCategory || timer.getState().phase;

    $("#now-title").textContent = track ? track.name : "Belum ada lagu";
    $("#now-subtitle").textContent = track
      ? CATEGORY_LABEL[track.category] + " · " + music.albumName(track.albumId) + " · " + formatBytes(track.size)
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
      return '<div class="history-item"><div>' +
        '<div class="history-date">' + escapeHtml(dateText) + '</div>' +
        '<div class="history-stats">' + escapeHtml(formatDuration(entry.totalStudyMs)) +
        ' belajar · ' + (Number(entry.sessions) || 0) + ' sesi' +
        (entry.task ? ' · ' + escapeHtml(entry.task) : '') + '</div></div>' +
        '<span class="history-badge">SELESAI</span></div>';
    }).join("");
  }

  /* ---------- Statistik ---------- */
  function renderStats() {
    var log = storage.getFocusLog();
    var byDate = {};
    log.forEach(function (entry) {
      if (!entry || !entry.date) return;
      byDate[entry.date] = (byDate[entry.date] || 0) + (Number(entry.minutes) || 0);
    });

    var today = new Date();
    var todayKey = dateKey(today);
    $("#stat-today").textContent = String(byDate[todayKey] || 0);
    $("#stat-total").textContent = String(log.reduce(function (sum, entry) {
      return sum + (Number(entry.minutes) || 0);
    }, 0));

    var cursor = new Date(today);
    if (!byDate[todayKey]) cursor.setDate(cursor.getDate() - 1);
    var streak = 0;
    while (byDate[dateKey(cursor)] > 0) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    $("#stat-streak").textContent = String(streak);

    var canvas = $("#focus-chart");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    var days = [];
    for (var i = 6; i >= 0; i--) {
      var date = new Date(today);
      date.setDate(date.getDate() - i);
      days.push({ key: dateKey(date), label: date.toLocaleDateString("id-ID", { weekday: "short" }) });
    }

    var max = Math.max(30, ...days.map(function (day) { return byDate[day.key] || 0; }));
    var padding = 34;
    var chartHeight = height - padding - 24;
    var slot = (width - padding * 2) / days.length;

    ctx.strokeStyle = "rgba(126,240,168,.12)";
    ctx.lineWidth = 1;
    for (var line = 0; line <= 3; line++) {
      var y = 16 + (chartHeight / 3) * line;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    days.forEach(function (day, index) {
      var minutes = byDate[day.key] || 0;
      var barHeight = (minutes / max) * chartHeight;
      var x = padding + index * slot + slot * 0.22;
      var barWidth = slot * 0.56;
      var y = 16 + chartHeight - barHeight;

      var gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      gradient.addColorStop(0, "#7ef0a8");
      gradient.addColorStop(1, "rgba(67,217,127,.25)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, Math.max(2, barHeight));

      ctx.fillStyle = "#9bb8a6";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(day.label, x + barWidth / 2, height - 8);
      if (minutes) ctx.fillText(String(minutes), x + barWidth / 2, Math.max(11, y - 5));
    });
  }

  /* ---------- Pengaturan ---------- */
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
    renderPresetActive();
  }

  function renderPresetActive() {
    $$("[data-preset]").forEach(function (button) {
      var parts = button.dataset.preset.split(",").map(Number);
      var active = parts[0] === settings.studyMinutes &&
        parts[1] === settings.breakMinutes && parts[2] === settings.sessions;
      button.classList.toggle("active", active);
    });
  }

  function updateSettings(patch) {
    settings = storage.saveSettings(Object.assign({}, settings, patch));
    timer.applySettings(settings);
    alarm.setEnabled(settings.alarmEnabled);
    music.setVolume(settings.volume);
    music.setShuffle(settings.shuffle);
    music.setMode(settings.musicMode);
    applySettingsToUI();

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

    if (key === "notificationsEnabled" && value && "Notification" in window) {
      if (Notification.permission === "default") {
        var request = Notification.requestPermission();
        if (request && typeof request.catch === "function") request.catch(function () { /* abaikan */ });
      }
    }
  }

  /* ---------- Aksi ---------- */
  function handleAction(action) {
    switch (action) {
      case "start":
        alarm.unlock();
        noise.unlock();
        requestNotificationPermission();
        currentTask = $("#session-task").value.trim();
        if (timer.start()) {
          acquireWakeLock();
          music.applyPhase(timer.getState().phase, { autoplay: true });
        }
        break;

      case "pause":
        if (timer.pause()) { music.suspend(); releaseWakeLock(); }
        break;

      case "resume":
        alarm.unlock();
        requestNotificationPermission();
        if (timer.resume()) {
          acquireWakeLock();
          music.applyPhase(timer.getState().phase, { autoplay: true });
        }
        break;

      case "reset":
        timer.reset();
        toast("Timer dikembalikan ke pengaturan awal.");
        break;

      case "test-alarm":
        alarm.unlock();
        alarm.beep(true);
        toast("Suara alarm diuji.");
        break;

      case "export-backup":
        exportBackup();
        break;

      case "clear-history":
        if (window.confirm("Hapus semua riwayat sesi?")) {
          storage.clearHistory();
          renderHistory();
          toast("Riwayat dihapus.");
        }
        break;

      case "clear-tracks":
        if (window.confirm("Hapus semua lagu yang tersimpan? Album tetap disimpan.")) {
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
          if (timer.getState().status === "running") music.applyPhase(timer.getState().phase, { autoplay: true });
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

  async function handleUploadFiles(files, category, input) {
    try {
      var albumId = music.albumFilter === "all" ? DEFAULT_ALBUM_ID : music.albumFilter;
      var result = await music.addFiles(files, category, albumId);
      if (input) input.value = "";
      if (result.added) toast(result.added + " lagu " + CATEGORY_LABEL[category].toLowerCase() + " ditambahkan.");
      if (result.skipped.length) {
        toast(result.skipped.length + " file ditolak (format tidak didukung): " + result.skipped.slice(0, 3).join(", "), "warn");
      }
      if (result.added && timer.getState().status === "running") {
        music.applyPhase(timer.getState().phase, { autoplay: true, force: true });
      }
    } catch (error) {
      if (input) input.value = "";
      toast("Gagal menyimpan lagu: " + error.message, "error");
    }
  }

  function handleUpload(input, category) {
    return handleUploadFiles(input.files, category, input);
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportBackup() {
    var data = {
      app: "FocusTune",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: storage.loadSettings(),
      history: storage.getHistory(),
      focusLog: storage.getFocusLog(),
      albums: music.albums.filter(function (album) { return album.id !== DEFAULT_ALBUM_ID; })
    };
    var stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "focustune-backup-" + stamp + ".json");
    toast("Backup berhasil diunduh (" + data.history.length + " riwayat, " + data.albums.length + " album).");
  }

  async function importBackup(input) {
    var file = input.files && input.files[0];
    input.value = "";
    if (!file) return;

    try {
      var data = JSON.parse(await file.text());
      if (!data || data.app !== "FocusTune") {
        toast("File ini bukan backup FocusTune.", "error");
        return;
      }
      if (!window.confirm("Timpa pengaturan, riwayat, log fokus, dan album dengan isi backup ini?")) return;

      if (data.settings) updateSettings(data.settings);
      storage.setHistory(data.history);
      storage.setFocusLog(data.focusLog);

      var importedAlbums = Array.isArray(data.albums) ? data.albums : [];
      for (var i = 0; i < importedAlbums.length; i++) {
        var album = importedAlbums[i];
        if (!album || !album.id || album.id === DEFAULT_ALBUM_ID) continue;
        await storage.putAlbum({
          id: album.id,
          name: String(album.name || "Album").slice(0, 40),
          createdAt: Number(album.createdAt) || Date.now()
        });
      }

      await music.refresh();
      renderHistory();
      renderAlbums();
      renderLibraries();
      renderStats();
      toast("Backup berhasil dipulihkan (" + importedAlbums.length + " album).");
    } catch (error) {
      toast("Gagal membaca backup: " + error.message, "error");
    }
  }

  function findTrackById(id) {
    return music.trackById("study", id) || music.trackById("break", id);
  }

  async function handleRename(id) {
    var track = findTrackById(id);
    if (!track) return;
    var name = window.prompt("Judul lagu baru:", track.name);
    if (name === null) return;
    name = name.trim().slice(0, 80);
    if (!name) { toast("Judul tidak boleh kosong.", "warn"); return; }
    try {
      await music.updateTrack(id, { name: name });
      toast("Judul lagu diubah menjadi '" + name + "'.");
    } catch (error) {
      toast("Gagal mengganti judul: " + error.message, "error");
    }
  }

  function handleDownloadTrack(id) {
    var track = findTrackById(id);
    if (!track || !track.blob) return;
    var extension = (track.fileName.match(/\.[^.]+$/) || [""])[0];
    downloadBlob(track.blob, track.name.replace(/[\\/:*?"<>|]/g, "_") + extension);
    toast("Lagu '" + track.name + "' diunduh.");
  }

  async function handleDeleteTrack(id) {
    try { await music.removeTrack(id); toast("Lagu dihapus dari pustaka."); }
    catch (error) { toast("Gagal menghapus lagu: " + error.message, "error"); }
  }

  async function handleDeleteAlbum(id) {
    if (!window.confirm("Hapus album ini? Lagu di dalamnya akan dipindah ke album 'Lainnya'.")) return;
    try { await music.deleteAlbum(id); toast("Album dihapus. Lagu dipindah ke 'Lainnya'."); }
    catch (error) { toast("Gagal menghapus album: " + error.message, "error"); }
  }

  async function handleSetCategory(id, category) {
    try {
      await music.updateTrack(id, { category: category });
      toast("Lagu dipindah ke musik " + CATEGORY_LABEL[category].toLowerCase() + ".");
      if (timer.getState().status === "running") {
        music.applyPhase(timer.getState().phase, { autoplay: true, force: true });
      }
    } catch (error) { toast("Gagal memindah lagu: " + error.message, "error"); }
  }

  async function handleSetAlbum(id, albumId) {
    try { await music.updateTrack(id, { albumId: albumId }); toast("Lagu dipindah ke album " + music.albumName(albumId) + "."); }
    catch (error) { toast("Gagal memindah album: " + error.message, "error"); }
  }

  /* ---------- Event ---------- */
  function bindEvents() {
    document.addEventListener("click", function (event) {
      var element = event.target;
      if (!element || !element.closest) return;

      var deleteAlbum = element.closest("[data-delete-album]");
      if (deleteAlbum) { event.stopPropagation(); handleDeleteAlbum(deleteAlbum.dataset.deleteAlbum); return; }

      var albumFilter = element.closest("[data-album-filter]");
      if (albumFilter) { music.setAlbumFilter(albumFilter.dataset.albumFilter); return; }

      var setCategory = element.closest("[data-set-category]");
      if (setCategory) { event.stopPropagation(); handleSetCategory(setCategory.dataset.trackId, setCategory.dataset.setCategory); return; }

      var deleteButton = element.closest("[data-delete-track]");
      if (deleteButton) { event.stopPropagation(); handleDeleteTrack(deleteButton.dataset.deleteTrack); return; }

      var renameButton = element.closest("[data-rename-track]");
      if (renameButton) { event.stopPropagation(); handleRename(renameButton.dataset.renameTrack); return; }

      var downloadButton = element.closest("[data-download-track]");
      if (downloadButton) { event.stopPropagation(); handleDownloadTrack(downloadButton.dataset.downloadTrack); return; }

      var track = element.closest("[data-track-id]");
      if (track) { music.select(track.dataset.category, track.dataset.trackId); return; }

      var preset = element.closest("[data-preset]");
      if (preset) {
        var parts = preset.dataset.preset.split(",").map(Number);
        updateSettings({ studyMinutes: parts[0], breakMinutes: parts[1], sessions: parts[2] });
        toast("Preset " + parts[0] + "/" + parts[1] + " · " + parts[2] + " sesi dipilih.");
        return;
      }

      var musicAction = element.closest("[data-music-action]");
      if (musicAction) { handleMusicAction(musicAction.dataset.musicAction); return; }

      var noiseButton = element.closest("[data-noise]");
      if (noiseButton) {
        var type = noiseButton.dataset.noise;
        if (type === "off") {
          noise.stop();
          $("#noise-status").textContent = "Matikan";
          toast("Suara latar dimatikan.");
        } else {
          noise.start(type).then(function (ok) {
            if (!ok) { toast("Browser tidak mengizinkan audio. Klik tombol ini sekali lagi.", "warn"); return; }
            $("#noise-status").textContent = { rain: "Hujan", white: "White Noise", cafe: "Kafe" }[type];
            toast("Suara latar " + $("#noise-status").textContent.toLowerCase() + " aktif.");
          });
        }
        return;
      }

      var modeButton = element.closest("[data-mode]");
      if (modeButton) { updateSettings({ musicMode: modeButton.dataset.mode }); return; }

      var actionButton = element.closest("[data-action]");
      if (actionButton) { handleAction(actionButton.dataset.action); return; }

      var gotoButton = element.closest("[data-goto]");
      if (gotoButton) { showView(gotoButton.dataset.goto); return; }

      var navButton = element.closest("[data-view]");
      if (navButton) { showView(navButton.dataset.view); return; }

      if (element.closest("#btn-help")) { $("#help-overlay").classList.remove("hidden"); return; }
      if (element.closest("#btn-close-help") || element.id === "help-overlay") {
        $("#help-overlay").classList.add("hidden");
        return;
      }

      if (element.closest("#btn-create-album")) {
        var name = $("#album-name").value.trim();
        if (!name) { toast("Isi nama album dulu ya.", "warn"); return; }
        music.createAlbum(name).then(function (album) {
          $("#album-name").value = "";
          music.setAlbumFilter(album.id);
          toast("Album '" + album.name + "' dibuat.");
        }).catch(function (error) { toast("Gagal membuat album: " + error.message, "error"); });
        return;
      }

      if (element.closest("#btn-install")) {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
        } else {
          toast("Buka aplikasi lewat HTTPS (GitHub Pages) lalu gunakan menu browser: Add to Home Screen.", "warn");
        }
      }
    });

    document.addEventListener("change", function (event) {
      var element = event.target;
      if (!element || !element.closest) return;

      var albumSelect = element.closest("[data-track-album]");
      if (albumSelect) { handleSetAlbum(albumSelect.dataset.trackAlbum, albumSelect.value); return; }

      if (element.id === "import-backup") { importBackup(element); return; }

      var setting = element.closest("[data-setting]");
      if (setting && setting.type !== "range") handleSettingElement(setting);
    });

    document.addEventListener("input", function (event) {
      var element = event.target;
      if (!element || !element.closest) return;
      var range = element.closest('input[type="range"][data-setting]');
      if (range) { handleSettingElement(range); return; }
      if (element.id === "noise-volume") {
        var value = Number(element.value);
        noise.setVolume(value);
        $("#noise-volume-value").textContent = Math.round(value * 100) + "%";
      }
    });

    document.addEventListener("keydown", function (event) {
      var target = event.target;
      var typing = target && ((target.matches && target.matches("input, textarea, select")) || target.isContentEditable);

      if (event.key === "Escape") { $("#help-overlay").classList.add("hidden"); return; }
      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        $("#help-overlay").classList.toggle("hidden");
        return;
      }
      if (typing) return;

      var key = event.key.toLowerCase();
      if (event.key === " ") { event.preventDefault(); music.togglePlay(); }
      else if (key === "n") music.next(1);
      else if (key === "p") music.previous();
      else if (key === "s") handleAction(timer.getState().status === "running" ? "pause" : "start");
      else if (key === "r") handleAction("reset");
    });

    ["study", "break"].forEach(function (category) {
      var input = $("#input-" + category);
      input.addEventListener("change", function () { handleUpload(input, category); });

      var zone = $(".library-card[data-category=\"" + category + "\"]");
      if (!zone) return;

      zone.addEventListener("dragover", function (event) {
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", function (event) {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
      });
      zone.addEventListener("drop", function (event) {
        event.preventDefault();
        zone.classList.remove("drag-over");
        if (event.dataTransfer && event.dataTransfer.files.length) {
          handleUploadFiles(event.dataTransfer.files, category, null);
        }
      });
    });

    $("#seek-bar").addEventListener("input", function () { music.seek(Number(this.value) / 1000); });
    $("#seek-bar").addEventListener("change", function () { this.blur(); });

    music.attachVisualizer($("#viz-now"));
    music.attachVisualizer($("#viz-player"));

    function resync() {
      timer.sync();
      var state = timer.getState();
      if (state.status === "running") {
        music.applyPhase(state.phase, { autoplay: true });
        acquireWakeLock();
      } else {
        releaseWakeLock();
      }
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) resync(); });
    window.addEventListener("focus", resync);
    window.addEventListener("beforeunload", function () {
      music.release();
      noise.stop(true);
      releaseWakeLock();
    });

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredPrompt = event;
    });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function (error) {
          console.warn("FocusTune: service worker gagal", error);
        });
      });
    }
  }

  /* ---------- Start ---------- */
  function init() {
    bindEvents();
    applySettingsToUI();
    showView("timer");
    renderTimer(timer.getState());
    renderAlbums();
    renderLibraries();
    renderHistory();
    renderStats();

    music.init().then(function () {
      renderAlbums();
      renderLibraries();
      renderMusicUI();
      if (storage.isFallback()) {
        toast("IndexedDB tidak tersedia. Album & lagu hanya tersedia selama halaman ini terbuka.", "warn");
      }
    }).catch(function (error) {
      toast("Gagal memuat pustaka musik: " + error.message, "error");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
