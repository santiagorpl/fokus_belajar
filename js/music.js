/* =========================================================
   music.js – album, pustaka lagu, pemutar, crossfade,
   visualizer, dan perpindahan otomatis mengikuti fase timer
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
  var DEFAULT_ALBUM_ID = "album_lainnya";

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  }

  function MusicManager(audioElement, settings, hooks) {
    this.audio = audioElement;
    this.settings = settings;
    this.hooks = hooks || {};
    this.listeners = {};

    this.albums = [];
    this.tracks = { study: [], break: [] };
    this.urls = new Map();
    this.selected = { study: null, break: null };
    this.positions = { study: 0, break: 0 };

    this.activeCategory = null;
    this.phase = "idle";
    this.manualPause = false;
    this.autoBlocked = false;
    this.suppressError = false;
    this.playToken = 0;
    this.albumFilter = "all";
    this.fadeTimer = null;
    this.visualCanvases = [];
    this.visContext = null;
    this.sourceNode = null;
    this.analyser = null;
    this.visualFrame = null;

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

  /* ---------- Event emitter ---------- */
  MusicManager.prototype.on = function (event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  };

  MusicManager.prototype.emit = function (event, payload) {
    (this.listeners[event] || []).forEach(function (callback) { callback(payload); });
  };

  MusicManager.prototype._error = function (message) {
    if (typeof this.hooks.onError === "function") this.hooks.onError(message);
  };

  /* ---------- Inisialisasi ---------- */
  MusicManager.prototype.init = async function () {
    var albums = await storage.getAllAlbums();
    if (!albums.some(function (album) { return album.id === DEFAULT_ALBUM_ID; })) {
      await storage.putAlbum({
        id: DEFAULT_ALBUM_ID,
        name: "Lainnya",
        createdAt: Date.now(),
        builtIn: true
      });
    }
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

  MusicManager.prototype.refresh = async function () {
    var wasPlaying = !this.audio.paused && !!this.audio.currentSrc;
    var previousActive = this.activeCategory;
    var previousPositions = { study: this.positions.study, break: this.positions.break };
    var previousSelected = { study: this.selected.study, break: this.selected.break };

    this.revokeAll(true);

    this.albums = await storage.getAllAlbums();
    this.albums.sort(function (a, b) {
      if (a.builtIn) return 1;
      if (b.builtIn) return -1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    var all = await storage.getAllTracks();
    this.tracks = { study: [], break: [] };
    var self = this;

    all.forEach(function (record) {
      if (record.category !== "study" && record.category !== "break") return;
      if (!record.blob || !record.id) return;

      var albumExists = self.albums.some(function (album) { return album.id === record.albumId; });
      if (!record.albumId || !albumExists) record.albumId = DEFAULT_ALBUM_ID;

      var url = URL.createObjectURL(record.blob);
      self.urls.set(record.id, url);
      self.tracks[record.category].push({
        id: record.id,
        category: record.category,
        albumId: record.albumId,
        name: record.name || record.fileName || "Lagu tanpa nama",
        fileName: record.fileName || record.name || "lagu",
        type: record.type || "audio/mpeg",
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

    this.emit("albums");
    this.emit("library");
    this.emit("state");
  };

  /* ---------- Album ---------- */
  MusicManager.prototype.createAlbum = async function (name) {
    var clean = String(name || "").trim();
    if (!clean) return null;
    var album = { id: makeId(), name: clean, createdAt: Date.now() };
    await storage.putAlbum(album);
    await this.refresh();
    return album;
  };

  MusicManager.prototype.deleteAlbum = async function (id) {
    if (id === DEFAULT_ALBUM_ID) return false;

    var all = await storage.getAllTracks();
    for (var i = 0; i < all.length; i++) {
      if (all[i].albumId === id) {
        all[i].albumId = DEFAULT_ALBUM_ID;
        await storage.putTrack(all[i]);
      }
    }
    await storage.deleteAlbum(id);
    if (this.albumFilter === id) this.albumFilter = "all";
    await this.refresh();
    return true;
  };

  MusicManager.prototype.setAlbumFilter = function (id) {
    this.albumFilter = id || "all";
    this.emit("library");
  };

  MusicManager.prototype.albumName = function (id) {
    var album = this.albums.find(function (item) { return item.id === id; });
    return album ? album.name : "Lainnya";
  };

  MusicManager.prototype.filteredTracks = function (category) {
    var list = this.tracks[category] || [];
    if (this.albumFilter === "all") return list;
    return list.filter(function (track) { return track.albumId === this.albumFilter; }, this);
  };

  /* ---------- Upload & metadata ---------- */
  MusicManager.prototype.isSupportedFile = function (file) {
    return EXTENSION_PATTERN.test(file.name || "") || MIME_PATTERN.test(file.type || "");
  };

  MusicManager.prototype.addFiles = async function (fileList, category, albumId) {
    var files = Array.from(fileList || []);
    if (!files.length) return { added: 0, skipped: [] };

    var valid = [];
    var skipped = [];
    files.forEach(function (file) {
      if (this.isSupportedFile(file)) valid.push(file);
      else skipped.push(file.name);
    }, this);

    var targetAlbum = albumId && this.albums.some(function (a) { return a.id === albumId; })
      ? albumId : DEFAULT_ALBUM_ID;

    for (var i = 0; i < valid.length; i++) {
      var file = valid[i];
      var extension = (file.name.match(EXTENSION_PATTERN) || [""])[0];
      var extensionKey = extension.replace(".", "").toLowerCase();
      var name = file.name.slice(0, file.name.length - extension.length).trim() || "Lagu tanpa nama";
      await storage.putTrack({
        id: makeId(),
        category: category,
        albumId: targetAlbum,
        name: name,
        fileName: file.name,
        type: file.type || MIME_GUESS[extensionKey] || "audio/mpeg",
        size: file.size,
        createdAt: Date.now() + i,
        blob: file
      });
    }

    await this.refresh();
    return { added: valid.length, skipped: skipped };
  };

  MusicManager.prototype.updateTrack = async function (id, patch) {
    var all = await storage.getAllTracks();
    var record = all.find(function (item) { return item.id === id; });
    if (!record) return false;
    Object.keys(patch).forEach(function (key) { record[key] = patch[key]; });
    await storage.putTrack(record);
    await this.refresh();
    return true;
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

  /* ---------- Playback ---------- */
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

  MusicManager.prototype._load = function (category, options) {
    options = options || {};
    var track = this.trackById(category, this.selected[category]) ||
      (this.tracks[category].length ? this.tracks[category][0] : null);

    if (!track) {
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
    var self = this;
    var applyPosition = function () {
      try {
        if (target > 0 && (!isFinite(self.audio.duration) || target < self.audio.duration)) {
          self.audio.currentTime = target;
        }
      } catch (error) { /* abaikan */ }
    };
    if (needsLoad) this.audio.addEventListener("loadedmetadata", applyPosition, { once: true });
    else applyPosition();

    if (options.play) this._tryPlay(category);
    else this.emit("state");
  };

  MusicManager.prototype._prepareVisualizer = function () {
    if (!this.visualCanvases.length) return;
    if (this.sourceNode) {
      if (this.visContext && this.visContext.state === "suspended") {
        this.visContext.resume().catch(function () { /* abaikan */ });
      }
      this._drawVisualizer();
      return;
    }
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      if (!this.visContext) this.visContext = new AudioCtx();
      this.sourceNode = this.visContext.createMediaElementSource(this.audio);
      this.analyser = this.visContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.visContext.destination);
      if (this.visContext.state === "suspended") {
        this.visContext.resume().catch(function () { /* abaikan */ });
      }
      this._drawVisualizer();
    } catch (error) {
      // Visualizer opsional; jangan menggagalkan pemutaran lagu.
      this.analyser = null;
    }
  };

  MusicManager.prototype._drawVisualizer = function () {
    if (!this.analyser || !this.visualCanvases.length) return;
    var self = this;
    var data = new Uint8Array(this.analyser.frequencyBinCount);

    if (this.visualFrame) cancelAnimationFrame(this.visualFrame);

    function draw() {
      if (!self.analyser) return;
      self.analyser.getByteFrequencyData(data);
      self.visualCanvases.forEach(function (canvas) {
        var context = canvas.getContext("2d");
        var width = canvas.width;
        var height = canvas.height;
        context.clearRect(0, 0, width, height);
        var bars = 20;
        var barWidth = width / bars;
        for (var i = 0; i < bars; i++) {
          var value = data[i] / 255;
          var barHeight = Math.max(2, value * height);
          context.fillStyle = "rgba(126,240,168," + (0.3 + value * 0.7) + ")";
          context.fillRect(i * barWidth + 1, height - barHeight, Math.max(1, barWidth - 2), barHeight);
        }
      });
      self.visualFrame = requestAnimationFrame(draw);
    }
    draw();
  };

  MusicManager.prototype.attachVisualizer = function (canvas) {
    if (!canvas || this.visualCanvases.indexOf(canvas) >= 0) return;
    this.visualCanvases.push(canvas);
  };

  MusicManager.prototype._tryPlay = function (category) {
    if (!this.activeCategory) this.activeCategory = category;
    var token = ++this.playToken;
    var self = this;

    this._prepareVisualizer();

    var promise;
    try { promise = this.audio.play(); }
    catch (error) { promise = Promise.reject(error); }

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

  MusicManager.prototype._animateVolume = function (from, to, duration, callback) {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    var started = Date.now();
    var self = this;
    this.fadeTimer = setInterval(function () {
      var ratio = Math.min(1, (Date.now() - started) / duration);
      self.audio.volume = from + (to - from) * ratio;
      if (ratio >= 1) {
        clearInterval(self.fadeTimer);
        self.fadeTimer = null;
        if (callback) callback();
      }
    }, 30);
  };

  MusicManager.prototype._crossfadeLoad = function (category, play) {
    var self = this;
    var from = this.audio.volume;
    var target = this.settings.volume;
    this._animateVolume(from, 0, 300, function () {
      self._load(category, { play: play });
      self._animateVolume(0, target, 350, null);
    });
  };

  MusicManager.prototype.applyPhase = function (phase, options) {
    options = options || {};
    var previousPhase = this.phase;
    this.phase = phase;

    if (phase !== "study" && phase !== "break") { this._stopPlaying(); return; }
    if (!this._shouldPlay(phase)) { this._stopPlaying(); return; }

    if (previousPhase !== phase || this.activeCategory !== phase || options.force) {
      if (this.activeCategory && this.activeCategory !== phase) {
        this.positions[this.activeCategory] = this.audio.currentTime || 0;
      }
      this.activeCategory = phase;
      this.manualPause = false;

      var canFade = !this.audio.paused && !options.immediate;
      if (canFade) this._crossfadeLoad(phase, options.autoplay !== false);
      else this._load(phase, { play: options.autoplay !== false });
      return;
    }

    if (!this.manualPause && this.audio.paused && options.autoplay !== false) {
      this._tryPlay(phase);
    } else {
      this.emit("state");
    }
  };

  MusicManager.prototype._stopPlaying = function () {
    if (this.activeCategory) this.positions[this.activeCategory] = this.audio.currentTime || 0;
    this.audio.pause();
    this.activeCategory = null;
    this.manualPause = false;
    this.emit("state");
  };

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
    var list = this.filteredTracks(category).length ? this.filteredTracks(category) : this.tracks[category];

    if (!list || !list.length) {
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
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
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
      breakCount: (this.tracks.break || []).length,
      albumFilter: this.albumFilter
    };
  };

  MusicManager.prototype.release = function () {
    this.playToken++;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (this.visualFrame) cancelAnimationFrame(this.visualFrame);
    this.revokeAll(false);
  };

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.MusicManager = MusicManager;
  window.FocusTune.DEFAULT_ALBUM_ID = DEFAULT_ALBUM_ID;
})();
