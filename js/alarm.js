/* =========================================================
   alarm.js – alarm, notifikasi, dan noise generator
   (semua suara dibuat dengan Web Audio API, tanpa file audio)
   ========================================================= */
(function () {
  "use strict";

  function getAudioContext() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try { return new AudioCtx(); } catch (error) { return null; }
  }

  /* =======================================================
     Alarm BEEP & notifikasi penyelesaian
     ======================================================= */
  function Alarm() {
    this.enabled = true;
    this.context = null;
    this.volume = 0.9;
  }

  Alarm.prototype.unlock = function () {
    if (!this.context) this.context = getAudioContext();
    if (!this.context) return Promise.resolve(false);
    if (this.context.state === "suspended") {
      return this.context.resume().then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(true);
  };

  Alarm.prototype.setEnabled = function (value) { this.enabled = !!value; };

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

  Alarm.prototype.beep = function (force) {
    if (!this.enabled && !force) return;
    var self = this;
    this.unlock().then(function (ready) {
      if (!ready || !self.context) return;
      self._tone(880, 0, 0.13, 0.22, "sine");
      self._tone(1320, 0.006, 0.075, 0.055, "triangle");
    });
  };

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

  /* =======================================================
     NoiseGenerator – white noise / hujan / kafe
     Dipakai sebagai suara latar saat belajar atau istirahat.
     ======================================================= */
  function NoiseGenerator() {
    this.context = null;
    this.source = null;
    this.filter = null;
    this.gain = null;
    this.type = null;
    this.volume = 0.35;
  }

  NoiseGenerator.prototype.unlock = function () {
    if (!this.context) this.context = getAudioContext();
    if (!this.context) return Promise.resolve(false);
    if (this.context.state === "suspended") {
      return this.context.resume().then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(true);
  };

  NoiseGenerator.prototype._makeBuffer = function (type) {
    var ctx = this.context;
    var length = ctx.sampleRate * 2;
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;

    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      if (type === "brown") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  };

  NoiseGenerator.prototype.start = function (type) {
    var self = this;
    if (this.type === type && this.source) return Promise.resolve(true);

    this.stop(true);
    return this.unlock().then(function (ready) {
      if (!ready || !self.context) return false;
      var ctx = self.context;
      var source = ctx.createBufferSource();
      source.buffer = self._makeBuffer(type === "cafe" ? "brown" : "white");
      source.loop = true;

      var filter = ctx.createBiquadFilter();
      if (type === "rain") {
        filter.type = "highpass";
        filter.frequency.value = 700;
      } else if (type === "cafe") {
        filter.type = "bandpass";
        filter.frequency.value = 520;
        filter.Q.value = 0.7;
      } else {
        filter.type = "lowpass";
        filter.frequency.value = 12000;
      }

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(self.volume, ctx.currentTime + 0.7);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start();

      self.source = source;
      self.filter = filter;
      self.gain = gain;
      self.type = type;
      return true;
    });
  };

  NoiseGenerator.prototype.stop = function (immediate) {
    if (!this.source) {
      this.type = null;
      return;
    }
    var source = this.source;
    var gain = this.gain;
    var ctx = this.context;

    this.source = null;
    this.filter = null;
    this.gain = null;
    this.type = null;

    try {
      if (!immediate && gain && ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
        setTimeout(function () { try { source.stop(); } catch (error) { /* sudah berhenti */ } }, 300);
      } else {
        source.stop();
      }
    } catch (error) { /* sudah berhenti */ }
  };

  NoiseGenerator.prototype.setVolume = function (value) {
    this.volume = Math.min(1, Math.max(0, Number(value) || 0));
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.05);
    }
  };

  NoiseGenerator.prototype.isPlaying = function () { return !!this.source; };

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.Alarm = Alarm;
  window.FocusTune.NoiseGenerator = NoiseGenerator;
})();
