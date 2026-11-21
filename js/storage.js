/* =========================================================
   storage.js – localStorage (pengaturan, riwayat, log fokus)
   dan IndexedDB (album + file musik yang diunggah)
   ========================================================= */
(function () {
  "use strict";

  var SETTINGS_KEY = "focustune.settings.v1";
  var HISTORY_KEY = "focustune.history.v1";
  var FOCUS_KEY = "focustune.focuslog.v1";
  var DB_NAME = "focustune-db";
  var DB_VERSION = 2; // v2: menambahkan object store "albums"

  var DEFAULTS = {
    studyMinutes: 30,
    breakMinutes: 10,
    sessions: 2,
    musicMode: "both", // "study" | "break" | "both"
    volume: 0.7,
    alarmEnabled: true,
    shuffle: false,
    notificationsEnabled: false
  };

  var dbPromise = null;
  var memoryFallback = false;
  var memoryTracks = [];
  var memoryAlbums = [];

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
          var tracks = db.createObjectStore("tracks", { keyPath: "id" });
          tracks.createIndex("category", "category", { unique: false });
          tracks.createIndex("createdAt", "createdAt", { unique: false });
          tracks.createIndex("albumId", "albumId", { unique: false });
        }

        if (!db.objectStoreNames.contains("albums")) {
          var albums = db.createObjectStore("albums", { keyPath: "id" });
          albums.createIndex("name", "name", { unique: false });
          albums.createIndex("createdAt", "createdAt", { unique: false });
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

  function getAllFromStore(storeName, memoryArray) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error || new Error("Gagal membaca data.")); };
      });
    }).catch(function (error) {
      if (memoryFallback) return memoryArray.slice();
      throw error;
    });
  }

  function putIntoStore(storeName, record, memoryArray) {
    return openDB().then(function (db) {
      var tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      return txDone(tx);
    }).catch(function (error) {
      if (memoryFallback) {
        var index = memoryArray.findIndex(function (item) { return item.id === record.id; });
        if (index >= 0) memoryArray[index] = record;
        else memoryArray.push(record);
        return;
      }
      throw error;
    });
  }

  function deleteFromStore(storeName, id, memoryArray) {
    return openDB().then(function (db) {
      var tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      return txDone(tx);
    }).catch(function (error) {
      if (memoryFallback) {
        var index = memoryArray.findIndex(function (item) { return item.id === id; });
        if (index >= 0) memoryArray.splice(index, 1);
        return;
      }
      throw error;
    });
  }

  function clearStore(storeName, memoryArray) {
    return openDB().then(function (db) {
      var tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      return txDone(tx);
    }).catch(function (error) {
      if (memoryFallback) {
        memoryArray.length = 0;
        return;
      }
      throw error;
    });
  }

  /* ---------- API album ---------- */
  function getAllAlbums() { return getAllFromStore("albums", memoryAlbums); }
  function putAlbum(album) { return putIntoStore("albums", album, memoryAlbums); }
  function deleteAlbum(id) { return deleteFromStore("albums", id, memoryAlbums); }

  /* ---------- API lagu ---------- */
  function getAllTracks() { return getAllFromStore("tracks", memoryTracks); }
  function putTrack(track) { return putIntoStore("tracks", track, memoryTracks); }
  function deleteTrack(id) { return deleteFromStore("tracks", id, memoryTracks); }
  function clearTracks() { return clearStore("tracks", memoryTracks); }

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
      shuffle: typeof raw.shuffle === "boolean" ? raw.shuffle : DEFAULTS.shuffle,
      notificationsEnabled: typeof raw.notificationsEnabled === "boolean"
        ? raw.notificationsEnabled : DEFAULTS.notificationsEnabled
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
     Riwayat & log fokus (localStorage)
     ------------------------------------------------------- */
  function readArray(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("FocusTune: gagal menyimpan data lokal", error);
    }
  }

  function getHistory() { return readArray(HISTORY_KEY); }

  function addHistory(entry) {
    var list = getHistory();
    list.unshift(entry);
    list = list.slice(0, 30);
    writeArray(HISTORY_KEY, list);
    return list;
  }

  function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch (error) { /* abaikan */ } }

  function setHistory(list) {
    writeArray(HISTORY_KEY, Array.isArray(list) ? list.slice(0, 30) : []);
  }

  function getFocusLog() { return readArray(FOCUS_KEY); }

  function addFocusLog(entry) {
    var list = getFocusLog();
    list.push(entry);
    list = list.slice(-365);
    writeArray(FOCUS_KEY, list);
    return list;
  }

  function setFocusLog(list) {
    writeArray(FOCUS_KEY, Array.isArray(list) ? list.slice(-365) : []);
  }

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.storage = {
    defaults: DEFAULTS,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    resetSettings: resetSettings,
    getAllAlbums: getAllAlbums,
    putAlbum: putAlbum,
    deleteAlbum: deleteAlbum,
    getAllTracks: getAllTracks,
    putTrack: putTrack,
    deleteTrack: deleteTrack,
    clearTracks: clearTracks,
    isFallback: function () { return memoryFallback; },
    getHistory: getHistory,
    addHistory: addHistory,
    setHistory: setHistory,
    clearHistory: clearHistory,
    getFocusLog: getFocusLog,
    addFocusLog: addFocusLog,
    setFocusLog: setFocusLog
  };
})();
