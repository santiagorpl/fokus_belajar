/* =========================================================
   alarm.js – alarm, notifikasi, dan 10 suara latar
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
     10 suara latar bawaan
     ======================================================= */
  var NOISE_TYPES = {
    rain:   { label: "Hujan",       icon: "🌧", filter: "highpass", freq: 700,  q: 0.7 },
    white:  { label: "White Noise", icon: "◽", filter: "lowpass",  freq: 14000, q: 0.7 },
    cafe:   { label: "Kafe",        icon: "☕", filter: "bandpass", freq: 520,  q: 0.6 },
    waves:  { label: "Ombak Laut",  icon: "🌊", filter: "lowpass",  freq: 900,  q: 0.7 },
    wind:   { label: "Angin",       icon: "🍃", filter: "bandpass", freq: 380,  q: 0.9 },
    fire:   { label: "Perapian",    icon: "🔥", filter: "lowpass",  freq: 2800, q: 0.7 },
    forest: { label: "Hutan",       icon: "🌲", filter: "lowpass",  freq: 5200, q: 0.7 },
    night:  { label: "Malam",       icon: "🌙", filter: "lowpass",  freq: 3200, q: 0.7 },
    stream: { label: "Air Sungai",  icon: "💧", filter: "highpass", freq: 420,  q: 0.7 },
    brown:  { label: "Brown Noise", icon: "🟤", filter: "lowpass",  freq: 800,  q: 0.7 }
  };

  function addChirps(data, rate, minGap, maxGap, duration, f0, f1, gain) {
    var pos = Math.floor(rate * (minGap + Math.random() * (maxGap - minGap)));
    while (pos < data.length) {
      var dur = Math.floor(rate * duration);
      var base = f0 + Math.random() * (f1 - f0);
      for (var j = 0; j < dur && pos + j < data.length; j++) {
        var envelope = Math.sin(Math.PI * j / dur);
        var freq = base * (1 + 0.18 * Math.sin(Math.PI * j / dur));
        data[pos + j] += Math.sin(2 * Math.PI * freq * (j / rate)) * envelope * gain;
      }
      pos += dur + Math.floor(rate * (minGap + Math.random() * (maxGap - minGap)));
    }
  }

  function encodeWav(samples, rate) {
    var bytes = samples.length * 2;
    var buffer = new ArrayBuffer(44 + bytes);
    var view = new DataView(buffer);

    function writeString(offset, text) {
      for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + bytes, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, bytes, true);

    var offset = 44;
    for (var i = 0; i < samples.length; i++, offset += 2) {
      var value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

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

  NoiseGenerator.prototype._samples = function (type, rate, seconds) {
    var length = Math.floor(rate * seconds);
    var data = new Float32Array(length);
    var last = 0;
    var p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0, p6 = 0;
    var i, white, t, value;

    for (i = 0; i < length; i++) {
      t = i / rate;
      white = Math.random() * 2 - 1;

      switch (type) {
        case "brown":
          last = (last + 0.02 * white) / 1.02;
          value = last * 3.5;
          break;

        case "waves":
          last = (last + 0.02 * white) / 1.02;
          value = last * 2.2 + white * 0.22;
          value *= 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 4));
          break;

        case "wind":
          last = (last + 0.02 * white) / 1.02;
          value = last * 1.7 + white * 0.3;
          value *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 8 + 1.1 * Math.sin(2 * Math.PI * t / 4)));
          break;

        case "fire":
          last = (last + 0.05 * white) / 1.05;
          value = last * 1.9;
          if (Math.random() < 0.0011) value += (Math.random() * 2 - 1) * 0.85;
          break;

        case "forest":
          p0 = 0.99886 * p0 + white * 0.0555179;
          p1 = 0.99332 * p1 + white * 0.0750759;
          p2 = 0.96900 * p2 + white * 0.1538520;
          p3 = 0.86650 * p3 + white * 0.3104856;
          p4 = 0.55000 * p4 + white * 0.5329522;
          p5 = -0.7616 * p5 - white * 0.0168980;
          value = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + white * 0.5362) * 0.12;
          p6 = white * 0.115926;
          value += white * 0.04;
          break;

        case "night":
          last = (last + 0.02 * white) / 1.02;
          value = last * 2.0 + white * 0.06;
          break;

        case "cafe":
          last = (last + 0.02 * white) / 1.02;
          value = last * 2.2 + white * 0.12;
          if (Math.random() < 0.0004) value += (Math.random() * 2 - 1) * 0.3;
          break;

        case "stream":
          value = white * 0.55 + Math.sin(2 * Math.PI * 230 * t) * white * 0.16;
          value *= 0.62 + 0.38 * Math.sin(2 * Math.PI * t / 2);
          break;

        case "rain":
          value = white * 0.8;
          if (Math.random() < 0.0007) value += (Math.random() * 2 - 1) * 0.45;
          break;

        default:
          value = white;
      }

      data[i] = Math.max(-1, Math.min(1, value));
    }

    if (type === "forest") addChirps(data, rate, 0.7, 2.2, 0.14, 1800, 3200, 0.11);
    if (type === "night") addChirps(data, rate, 0.16, 0.42, 0.05, 4200, 5200, 0.05);

    return data;
  };

  NoiseGenerator.prototype._makeBuffer = function (type, seconds) {
    var ctx = this.context;
    var data = this._samples(type, ctx.sampleRate, seconds || 8);
    var buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    return buffer;
  };

  NoiseGenerator.prototype.start = function (type) {
    var self = this;
    if (!NOISE_TYPES[type]) type = "rain";
    if (this.type === type && this.source) return Promise.resolve(true);

    this.stop(true);
    return this.unlock().then(function (ready) {
      if (!ready || !self.context) return false;
      var ctx = self.context;
      var config = NOISE_TYPES[type];

      var source = ctx.createBufferSource();
      source.buffer = self._makeBuffer(type, 8);
      source.loop = true;

      var filter = ctx.createBiquadFilter();
      filter.type = config.filter;
      filter.frequency.value = config.freq;
      filter.Q.value = config.q;

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

  NoiseGenerator.prototype.renderWav = function (type, seconds) {
    var self = this;
    if (!NOISE_TYPES[type]) type = "rain";
    return this.unlock().then(function (ready) {
      if (!ready || !self.context) return null;
      var rate = self.context.sampleRate;
      var samples = self._samples(type, rate, seconds || 60);
      return encodeWav(samples, rate);
    });
  };

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.Alarm = Alarm;
  window.FocusTune.NoiseGenerator = NoiseGenerator;
  window.FocusTune.NOISE_TYPES = NOISE_TYPES;
})();
