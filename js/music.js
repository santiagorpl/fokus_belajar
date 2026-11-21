/* =========================================================
   music.js – manajer pustaka lagu, pemutar, dan perpindahan
   otomatis mengikuti fase timer
   ========================================================= */
(function () {
  "use strict";

  var storage = window.FocusTune.storage;

  var CATEGORY_LABEL = { study: "Belajar", break: "Istirahat" };
  var EXTENSION_PATTERN = /\.(mp3|wav|wave|ogg|oga|m4a)$/i;
  var MIME_PATTERN = /^audio\/(mpeg|mp3|wav|wave|x-wav|ogg|oga|mp4|x-m4a|aac)$/i;
  var MIME_GUESS = {
    mp3: "audio/mpeg", wav: "audio/wav", wave: "audio/wav",
    ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4"
  };

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "track_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  }

  function MusicManager(audioElement, settings, hooks) {
    this.audio = audioElement;
    this.settings = settings;
    this.hooks = hooks || {};
    this.listeners = {};

    this.tracks = { study: [], break: [] };
    this.urls = new Map();              // id lagu -> object URL (Blob URL)
    this.selected = { study: null, break: null };
    this.positions = { study: 0, break: 0 };

    this.activeCategory = null;         // kategori yang sedang dimuat di pemutar
    this.phase = "idle";                // fase timer terakhir yang diketahui
    this.manualPause = false;           // true jika pengguna menekan play/pause sendiri
    this.autoBlocked = false;
    this.suppressError = false;
    this.playToken = 0;

    this.audio.volume = settings.volume;

    var self = this;
    this.audio.addEventListener("ended", function () { self._onEnded(); });
    this.audio.addEventListener("timeupdate", function () {
      if (self.activeCategory) self.positions[self.activeCategory] = self.audio.currentTime || 0;
      self.emit("progress");
    });
    this.audio.addEventListener("play", function () {
      self.autoBlocked = false;
      self.suppressError = false;
      self.emit("state");
    });
    this.audio.addEventListener("pause", function () { self.emit("state"); });
    this.audio.addEventListener("loadedmetadata", function () { self.emit("progress"); });
    this.audio.addEventListener("error", function () {
      if (self.suppressError || !self.audio.getAttribute("src")) return;
      self._error("Lagu tidak dapat diputar. Formatnya mungkin tidak didukung browser ini.");
    });
  }

  /* ---------- Event emitter sederhana ---------- */
  MusicManager.prototype.on = function (event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  };

  MusicManager.prototype.emit = function (event, payload) {
    var callbacks = this.listeners[event] || [];
    callbacks.forEach(function (callback) { callback(payload); });
  };

  MusicManager.prototype._error = function (message) {
    if (typeof this.hooks.onError === "function") this.hooks.onError(message);
  };

  /* ---------- Pemuatan & penyimpanan ---------- */
  MusicManager.prototype.init = async function () {
    await this.refresh();
    return this;
  };

  MusicManager.prototype.revokeAll = function (keepActive) {
    this.audio.pause();
    this.suppressError = true;
    this.audio.removeAttribute("src");
    this.audio.load();
    this.urls.forEach(function (url) { URL.revokeObjectURL(url); });
    this.urls.clear();
    if (!keepActive) this.activeCategory = null;
  };

  /* Ambil semua lagu dari IndexedDB lalu buat Blob URL baru. */
  MusicManager.prototype.refresh = async function () {
    var wasPlaying = !this.audio.paused && !!this.audio.currentSrc;
    var previousActive = this.activeCategory;
    var previousPositions = {
      study: this.positions.study,
      break: this.positions.break
    };
    var previousSelected = {
      study: this.selected.study,
      break: this.selected.break
    };

    this.revokeAll(true);

    var all = await storage.getAllTracks();
    this.tracks = { study: [], break: [] };

    var self = this;
    all.forEach(function (record) {
      if (record.category !== "study" && record.category !== "break") return;
      if (!record.blob || !record.id) return;
      var url = URL.createObjectURL(record.blob);
      self.urls.set(record.id, url);
      self.tracks[record.category].push({
        id: record.id,
        category: record.category,
        name: record.name || record.fileName || "LaguWithoutName",
        fileName: record.fileName || record.name || "lagu",
        type: record.type || "",
        size: record.size || record.blob.size || 0,
        createdAt: record.createdAt || 0,
        blob: record.blob,
        url: url
      });
    });

    ["study", "break"].forEach(function (category) {
      self.tracks[category].sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var stillExists = self.tracks[category].some(function (t) { return t.id === previousSelected[category]; });
      if (!stillExists) {
        self.selected[category] = self.tracks[category].length ? self.tracks[category][0].id : null;
        self.positions[category] = 0;
      } else {
        self.selected[category] = previousSelected[category];
        self.positions[category] = previousPositions[category] || 0;
      }
    });

    if (previousActive && this.tracks[previousActive].length) {
      this.activeCategory = previousActive;
      this._load(previousActive, { play: wasPlaying });
    } else {
      this.activeCategory = null;
    }

    this.emit("library");
    this.emit("state");
  };

  MusicManager.prototype.isSupportedFile = function (file) {
    return EXTENSION_PATTERN.test(file.name || "") || MIME_PATTERN.test(file.type || "");
  };

  /* Unggah banyak lagu sekaligus ke kategori tertentu. */
  MusicManager.prototype.addFiles = async function (fileList, category) {
    var files = Array.from(fileList || []);
    if (!files.length) return { added: 0, skipped: [] };

    var valid = [];
    var skipped = [];
    files.forEach(function (file) {
      if (this.isSupportedFile(file)) valid.push(file);
      else skipped.push(file.name);
    }, this);

    for (var i = 0; i < valid.length; i++) {
      var file = valid[i];
      var extension = (file.name.match(EXTENSION_PATTERN) || [""])[0];
      var extensionKey = extension.replace(".", "").toLowerCase();
      var name = file.name.slice(0, file.name.length - extension.length).trim() || "Lagu tanpa nama";
      var record = {
        id: makeId(),
        category: category,
        name: name,
        fileName: file.name,
        type: file.type || MIME_GUESS[extensionKey] || "audio/mpeg",
        size: file.size,
        createdAt: Date.now() + i,
        blob: file // File adalah turunan Blob, tersimpan utuh di IndexedDB
      };
      await storage.putTrack(record);
    }

    await this.refresh();
    return { added: valid.length, skipped: skipped };
  };

  MusicManager.prototype.removeTrack = async function (id) {
    await storage.deleteTrack(id);
    await this.refresh();
  };

  MusicManager.prototype.clearLibrary = async function () {
    await storage.clearTracks();
    this.activeCategory = null;
    await this.refresh();
  };

  /* ---------- Kontrol pemutar ---------- */
  MusicManager.prototype.trackById = function (category, id) {
    var list = this.tracks[category] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  };

  MusicManager.prototype.currentTrack = function () {
    if (!this.activeCategory) return null;
    return this.trackById(this.activeCategory, this.selected[this.activeCategory]);
  };

  /* Muat lagu ke elemen audio. Object URL lama tidak pernah dipakai ulang. */
  MusicManager.prototype._load = function (category, options) {
    options = options || {};
    var track = this.trackById(category, this.selected[category]) ||
      (this.tracks[category].length ? this.tracks[category][0] : null);

    if (!track) {
      // Jangan biarkan lagu kategori lama tetap berputar saat kategori baru kosong.
      this.audio.pause();
      this.suppressError = true;
      this.audio.removeAttribute("src");
      this.audio.load();
      if (typeof this.hooks.onEmpty === "function") this.hooks.onEmpty(category);
      this.emit("state");
      return;
    }

    this.selected[category] = track.id;
    var url = this.urls.get(track.id);
    if (!url) return;

    this.suppressError = false;
    var needsLoad = this.audio.getAttribute("src") !== url;
    if (needsLoad) {
      this.audio.src = url;
      this.audio.load();
    }

    var target = options.restart ? 0 : (this.positions[category] || 0);
    var applyPosition = function () {
      try {
        if (target > 0 && (!isFinite(self.audio.duration) || target < self.audio.duration)) {
          self.audio.currentTime = target;
        }
      } catch (error) { /* metadata belum siap, abaikan */ }
    };
    var self = this;
    if (needsLoad) this.audio.addEventListener("loadedmetadata", applyPosition, { once: true });
    else applyPosition();

    if (options.play) this._tryPlay(category);
    else this.emit("state");
  };

  MusicManager.prototype._tryPlay = function (category) {
    if (!this.activeCategory) this.activeCategory = category;
    var token = ++this.playToken;
    var self = this;

    var promise;
    try {
      promise = this.audio.play();
    } catch (error) {
      promise = Promise.reject(error);
    }

    if (promise && typeof promise.then === "function") {
      promise.then(function () {
        if (token !== self.playToken) return;
        self.autoBlocked = false;
        self.emit("state");
      }).catch(function () {
        if (token !== self.playToken) return;
        if (!self.autoBlocked) {
          self._error("Browser memblokir autoplay. Klik sekali tombol ▶ pada pemutar musik untuk mengizinkan.");
        }
        self.autoBlocked = true;
        self.emit("state");
      });
    } else {
      this.emit("state");
    }
  };

  MusicManager.prototype._shouldPlay = function (phase) {
    return this.settings.musicMode === "both" || this.settings.musicMode === phase;
  };

  /* Dipanggil setiap kali fase timer berubah. */
  MusicManager.prototype.applyPhase = function (phase, options) {
    options = options || {};
    var previousPhase = this.phase;
    this.phase = phase;

    if (phase !== "study" && phase !== "break") {
      this._stopPlaying();
      return;
    }
    if (!this._shouldPlay(phase)) {
      this._stopPlaying();
      return;
    }

    if (previousPhase !== phase || this.activeCategory !== phase || options.force) {
      if (this.activeCategory && this.activeCategory !== phase) {
        this.positions[this.activeCategory] = this.audio.currentTime || 0;
      }
      this.activeCategory = phase;
      this.manualPause = false;
      this._load(phase, { play: options.autoplay !== false });
      return;
    }

    // Fase sama: cukup lanjutkan jika musik berhenti karena tab tidak aktif.
    if (!this.manualPause && this.audio.paused && options.autoplay !== false) {
      this._tryPlay(phase);
    } else {
      this.emit("state");
    }
  };

  MusicManager.prototype._stopPlaying = function () {
    if (this.activeCategory) {
      this.positions[this.activeCategory] = this.audio.currentTime || 0;
    }
    this.audio.pause();
    this.activeCategory = null;
    this.manualPause = false;
    this.emit("state");
  };

  /* Jeda timer: musik ikut berhenti, tapi posisi lagu disimpan. */
  MusicManager.prototype.suspend = function () {
    if (!this.activeCategory) return;
    this.positions[this.activeCategory] = this.audio.currentTime || 0;
    this.audio.pause();
    this.emit("state");
  };

  MusicManager.prototype.togglePlay = function () {
    if (!this.activeCategory) {
      var category = this.phase === "break" ? "break" : "study";
      if (!this._shouldPlay(category)) {
        this._error("Musik untuk fase ini sedang dinonaktifkan pada pengaturan.");
        return;
      }
      this.activeCategory = category;
      this.manualPause = false;
      this._load(category, { play: true });
      return;
    }

    if (this.audio.paused) {
      this.manualPause = false;
      this._tryPlay(this.activeCategory);
    } else {
      this.manualPause = true;
      this.audio.pause();
    }
  };

  MusicManager.prototype.next = function (direction) {
    direction = direction || 1;
    var category = this.activeCategory || (this.phase === "break" ? "break" : "study");
    var list = this.tracks[category] || [];

    if (!list.length) {
      this._error("Belum ada lagu " + CATEGORY_LABEL[category] + " yang diunggah.");
      return;
    }

    var index = list.findIndex(function (track) { return track.id === this.selected[category]; }, this);
    if (index < 0) index = 0;

    if (this.settings.shuffle && list.length > 1 && direction > 0) {
      var random = index;
      while (random === index) random = Math.floor(Math.random() * list.length);
      index = random;
    } else {
      index = (index + direction + list.length) % list.length;
    }

    this.selected[category] = list[index].id;
    this.positions[category] = 0;
    this.activeCategory = category;
    this.manualPause = false;
    this._load(category, { play: true, restart: true });
  };

  MusicManager.prototype.previous = function () {
    if (this.audio.currentTime > 3 && this.activeCategory) {
      this.seek(0);
      return;
    }
    this.next(-1);
  };

  MusicManager.prototype._onEnded = function () {
    if (this.activeCategory) this.next(1);
  };

  MusicManager.prototype.seek = function (ratio) {
    if (!isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    var time = Math.min(1, Math.max(0, ratio)) * this.audio.duration;
    try { this.audio.currentTime = time; } catch (error) { /* abaikan */ }
    if (this.activeCategory) this.positions[this.activeCategory] = time;
    this.emit("progress");
  };

  MusicManager.prototype.select = function (category, id) {
    var track = this.trackById(category, id);
    if (!track) return false;
    this.selected[category] = id;
    this.positions[category] = 0;
    this.activeCategory = category;
    this.manualPause = false;
    this._load(category, { play: true, restart: true });
    return true;
  };

  /* ---------- Pengaturan ---------- */
  MusicManager.prototype.setVolume = function (value) {
    this.settings.volume = Math.min(1, Math.max(0, Number(value) || 0));
    this.audio.volume = this.settings.volume;
    this.emit("state");
  };

  MusicManager.prototype.setShuffle = function (value) {
    this.settings.shuffle = !!value;
    this.emit("state");
  };

  MusicManager.prototype.setMode = function (value) {
    this.settings.musicMode = value;
    this.emit("state");
  };

  MusicManager.prototype.getState = function () {
    return {
      activeCategory: this.activeCategory,
      phase: this.phase,
      currentTrack: this.currentTrack(),
      playing: !this.audio.paused && !this.audio.ended,
      currentTime: this.audio.currentTime || 0,
      duration: isFinite(this.audio.duration) ? this.audio.duration : 0,
      autoBlocked: this.autoBlocked,
      studyCount: (this.tracks.study || []).length,
      breakCount: (this.tracks.break || []).length
    };
  };

  MusicManager.prototype.release = function () {
    this.playToken++;
    this.revokeAll(false);
  };

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.MusicManager = MusicManager;
})();
