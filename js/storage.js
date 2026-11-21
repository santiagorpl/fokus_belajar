/* =========================================================
   storage.js – localStorage (pengaturan & riwayat)
   dan IndexedDB (file musik yang diunggah)
   ========================================================= */
(function () {
  "use strict";

  var SETTINGS_KEY = "focustune.settings.v1";
  var HISTORY_KEY = "focustune.history.v1";
  var DB_NAME = "focustune-db";
  var DB_VERSION = 1;

  var DEFAULTS = {
    studyMinutes: 30,
    breakMinutes: 10,
    sessions: 2,
    musicMode: "both", // "study" | "break" | "both"
    volume: 0.7,
    alarmEnabled: true,
    shuffle: false
  };

  var dbPromise = null;
  var memoryFallback = false; // dipakai jika IndexedDB diblokir / tidak tersedia
  var memoryTracks = [];

  /* -------------------------------------------------------
     IndexedDB helpers
     ------------------------------------------------------- */
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB tidak didukung browser ini."));
        return;
      }

      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains("tracks")) {
          var store = db.createObjectStore("tracks", { keyPath: "id" });
          store.createIndex("category", "category", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };

      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Gagal membuka IndexedDB.")); };
      request.onblocked = function () { reject(new Error("IndexedDB diblokir oleh tab lain.")); };
    }).catch(function (error) {
      memoryFallback = true;
      throw error;
    });

    return dbPromise;
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error("Transaksi IndexedDB gagal.")); };
      tx.onabort = function () { reject(tx.error || new Error("Transaksi IndexedDB dibatalkan.")); };
    });
  }

  async function getAllTracks() {
    try {
      var db = await openDB();
      return await new Promise(function (resolve, reject) {
        var req = db.transaction("tracks", "readonly").objectStore("tracks").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error || new Error("Gagal membaca lagu.")); };
      });
    } catch (error) {
      if (memoryFallback) return memoryTracks.slice();
      throw error;
    }
  }

  async function putTrack(track) {
    try {
      var db = await openDB();
      var tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").put(track);
      await txDone(tx);
    } catch (error) {
      if (memoryFallback) {
        var index = memoryTracks.findIndex(function (t) { return t.id === track.id; });
        if (index >= 0) memoryTracks[index] = track;
        else memoryTracks.push(track);
        return;
      }
      throw error;
    }
  }

  async function deleteTrack(id) {
    try {
      var db = await openDB();
      var tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").delete(id);
      await txDone(tx);
    } catch (error) {
      if (memoryFallback) {
        memoryTracks = memoryTracks.filter(function (t) { return t.id !== id; });
        return;
      }
      throw error;
    }
  }

  async function clearTracks() {
    try {
      var db = await openDB();
      var tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").clear();
      await txDone(tx);
    } catch (error) {
      if (memoryFallback) {
        memoryTracks = [];
        return;
      }
      throw error;
    }
  }

  /* -------------------------------------------------------
     Pengaturan (localStorage)
     ------------------------------------------------------- */
  function clampNumber(value, min, max, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalizeSettings(raw) {
    raw = raw || {};
    var mode = ["study", "break", "both"].indexOf(raw.musicMode) >= 0 ? raw.musicMode : DEFAULTS.musicMode;
    var volume = Number(raw.volume);
    if (!Number.isFinite(volume)) volume = DEFAULTS.volume;
    volume = Math.min(1, Math.max(0, volume));

    return {
      studyMinutes: clampNumber(raw.studyMinutes, 1, 180, DEFAULTS.studyMinutes),
      breakMinutes: clampNumber(raw.breakMinutes, 1, 180, DEFAULTS.breakMinutes),
      sessions: clampNumber(raw.sessions, 1, 12, DEFAULTS.sessions),
      musicMode: mode,
      volume: volume,
      alarmEnabled: typeof raw.alarmEnabled === "boolean" ? raw.alarmEnabled : DEFAULTS.alarmEnabled,
      shuffle: typeof raw.shuffle === "boolean" ? raw.shuffle : DEFAULTS.shuffle
    };
  }

  function loadSettings() {
    try {
      var stored = localStorage.getItem(SETTINGS_KEY);
      return normalizeSettings(stored ? JSON.parse(stored) : {});
    } catch (error) {
      return normalizeSettings({});
    }
  }

  function saveSettings(settings) {
    var normalized = normalizeSettings(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.warn("FocusTune: gagal menyimpan pengaturan", error);
    }
    return normalized;
  }

  function resetSettings() {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (error) { /* abaikan */ }
    return normalizeSettings({});
  }

  /* -------------------------------------------------------
     Riwayat (localStorage)
     ------------------------------------------------------- */
  function getHistory() {
    try {
      var parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function addHistory(entry) {
    var list = getHistory();
    list.unshift(entry);
    list = list.slice(0, 30);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (error) {
      console.warn("FocusTune: gagal menyimpan riwayat", error);
    }
    return list;
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (error) { /* abaikan */ }
  }

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.storage = {
    defaults: DEFAULTS,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    resetSettings: resetSettings,
    getAllTracks: getAllTracks,
    putTrack: putTrack,
    deleteTrack: deleteTrack,
    clearTracks: clearTracks,
    isFallback: function () { return memoryFallback; },
    getHistory: getHistory,
    addHistory: addHistory,
    clearHistory: clearHistory
  };
})();
