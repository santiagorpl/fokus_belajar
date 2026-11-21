/* =========================================================
   alarm.js – alarm & notifikasi suara dengan Web Audio API
   (tidak memerlukan file audio tambahan)
   ========================================================= */
(function () {
  "use strict";

  function Alarm() {
    this.enabled = true;
    this.context = null;
    this.volume = 0.9;
  }

  /* Dipanggil dari event klik pengguna agar browser mengizinkan audio. */
  Alarm.prototype.unlock = function () {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return Promise.resolve(false);

    try {
      if (!this.context) this.context = new AudioCtx();
      if (this.context.state === "suspended") {
        return this.context.resume().then(function () { return true; }).catch(function () { return false; });
      }
      return Promise.resolve(true);
    } catch (error) {
      console.warn("FocusTune: Web Audio tidak tersedia", error);
      return Promise.resolve(false);
    }
  };

  Alarm.prototype.setEnabled = function (value) {
    this.enabled = !!value;
  };

  /* Membuat satu nada dengan envelope halus (tidak klik / kasar). */
  Alarm.prototype._tone = function (frequency, offset, duration, gain, type) {
    if (!this.context) return;

    var start = this.context.currentTime + offset;
    var oscillator = this.context.createOscillator();
    var envelope = this.context.createGain();

    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * this.volume), start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(envelope);
    envelope.connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  };

  /* BEEP pendek untuk hitung mundur 10..1. */
  Alarm.prototype.beep = function (force) {
    if (!this.enabled && !force) return;
    var self = this;

    this.unlock().then(function (ready) {
      if (!ready || !self.context) return;
      self._tone(880, 0, 0.13, 0.22, "sine");
      self._tone(1320, 0.006, 0.075, 0.055, "triangle");
    });
  };

  /* Nada naik sebagai notifikasi semua sesi selesai. */
  Alarm.prototype.completion = function (force) {
    if (!this.enabled && !force) return;
    var self = this;

    this.unlock().then(function (ready) {
      if (!ready || !self.context) return;
      var notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (note, index) {
        self._tone(note, index * 0.16, index === notes.length - 1 ? 0.45 : 0.2, 0.16, "sine");
      });
    });
  };

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.Alarm = Alarm;
})();
