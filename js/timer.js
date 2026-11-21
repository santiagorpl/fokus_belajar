/* =========================================================
   timer.js – Pomodoro timer berbasis timestamp (akurat walau
   tab browser tidak aktif) dengan dukungan multi-sesi
   ========================================================= */
(function () {
  "use strict";

  function pad(number) { return number < 10 ? "0" + number : String(number); }

  function formatTime(milliseconds) {
    var totalSeconds = Math.max(0, Math.ceil((milliseconds || 0) / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return hours > 0
      ? pad(hours) + ":" + pad(minutes) + ":" + pad(seconds)
      : pad(minutes) + ":" + pad(seconds);
  }

  function PomodoroTimer(settings, hooks) {
    this.settings = settings;
    this.hooks = hooks || {};

    this.status = "idle";       // idle | running | paused | finished
    this.phase = "study";       // study | break
    this.session = 1;
    this.totalMs = settings.studyMinutes * 60000;
    this.remainingMs = this.totalMs;
    this.totalStudyMs = 0;

    this.endAt = null;          // timestamp absolut, bukan pengurang per tick
    this.tickHandle = null;
    this.lastBeepSecond = null;
    this.lastCompletedPhase = null;
  }

  PomodoroTimer.prototype._startTick = function () {
    if (this.tickHandle !== null) return;
    var self = this;
    this.tickHandle = setInterval(function () { self._tick(); }, 100);
  };

  PomodoroTimer.prototype._stopTick = function () {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  };

  PomodoroTimer.prototype._schedule = function (durationMs) {
    this.endAt = Date.now() + durationMs;
    // Jika dilanjutkan di dalam rentang 10 detik, detik saat ini tidak dibunyikan ulang.
    this.lastBeepSecond = durationMs <= 10000 ? Math.ceil(durationMs / 1000) : null;
  };

  /* MULAI (dari idle) atau LANJUTKAN (dari paused). */
  PomodoroTimer.prototype.start = function () {
    if (this.status === "running") return false; // mencegah timer berjalan ganda

    if (this.status === "finished") this.reset();

    if (this.status === "idle") {
      this.phase = "study";
      this.session = 1;
      this.totalMs = this.settings.studyMinutes * 60000;
      this.remainingMs = this.totalMs;
      this.totalStudyMs = 0;
      this.lastCompletedPhase = null;
    }

    this.status = "running";
    this._schedule(this.remainingMs);
    this._startTick();
    this._emitUpdate();
    return true;
  };

  PomodoroTimer.prototype.resume = function () {
    if (this.status !== "paused") return false;
    return this.start();
  };

  PomodoroTimer.prototype.pause = function () {
    if (this.status !== "running") return false;
    this.remainingMs = Math.max(0, this.endAt - Date.now());
    this._stopTick();
    this.endAt = null;
    this.status = "paused";
    this._emitUpdate();
    return true;
  };

  PomodoroTimer.prototype.reset = function () {
    this._stopTick();
    this.status = "idle";
    this.phase = "study";
    this.session = 1;
    this.totalMs = this.settings.studyMinutes * 60000;
    this.remainingMs = this.totalMs;
    this.totalStudyMs = 0;
    this.endAt = null;
    this.lastBeepSecond = null;
    this.lastCompletedPhase = null;
    if (typeof this.hooks.onReset === "function") this.hooks.onReset();
    this._emitUpdate();
  };

  PomodoroTimer.prototype.applySettings = function (settings) {
    this.settings = settings;
    if (this.status === "idle") {
      this.totalMs = settings.studyMinutes * 60000;
      this.remainingMs = this.totalMs;
      this._emitUpdate();
    }
  };

  /* Dipanggil saat tab kembali aktif untuk langsung mengejar waktu. */
  PomodoroTimer.prototype.sync = function () {
    if (this.status !== "running") return;
    this._stopTick();
    this._tick();
    if (this.status === "running") this._startTick();
  };

  PomodoroTimer.prototype._tick = function () {
    if (this.status !== "running" || this.endAt === null) return;

    var now = Date.now();
    var guard = 0;

    // Selisih waktu saat tab tidak aktif dikejar dengan benar (bukan dihitung ulang dari 0).
    while (this.status === "running" && now >= this.endAt && guard < 100) {
      this._advancePhase(this.endAt);
      guard++;
    }

    this.remainingMs = this.status === "finished" ? 0 : Math.max(0, this.endAt - now);

    // Alarm 10..1: satu BEEP per detik, tidak dobel meski tick lebih cepat.
    if (this.status === "running" && this.remainingMs > 0 && this.remainingMs <= 10000) {
      var second = Math.ceil(this.remainingMs / 1000);
      if (second !== this.lastBeepSecond) {
        this.lastBeepSecond = second;
        if (typeof this.hooks.onBeep === "function") this.hooks.onBeep();
      }
    }

    this._emitUpdate();
  };

  PomodoroTimer.prototype._advancePhase = function (phaseEndAt) {
    if (this.phase === "study") {
      this.totalStudyMs += this.totalMs;
      this.lastCompletedPhase = "study";
      this.phase = "break";
      this.totalMs = this.settings.breakMinutes * 60000;
      this.endAt = phaseEndAt + this.totalMs;
      this.remainingMs = Math.max(0, this.endAt - Date.now());
      this.lastBeepSecond = null;
      this._emitPhaseChange();
      return;
    }

    // Fase istirahat selesai: lanjut sesi berikutnya atau selesaikan siklus.
    if (this.session >= this.settings.sessions) {
      this._finish();
      return;
    }

    this.session += 1;
    this.lastCompletedPhase = "break";
    this.phase = "study";
    this.totalMs = this.settings.studyMinutes * 60000;
    this.endAt = phaseEndAt + this.totalMs;
    this.remainingMs = Math.max(0, this.endAt - Date.now());
    this.lastBeepSecond = null;
    this._emitPhaseChange();
  };

  PomodoroTimer.prototype._finish = function () {
    this._stopTick();
    this.status = "finished";
    this.phase = "break";
    this.remainingMs = 0;
    this.endAt = null;

    var summary = {
      sessions: this.settings.sessions,
      totalStudyMs: this.totalStudyMs,
      studyMinutes: this.settings.studyMinutes,
      breakMinutes: this.settings.breakMinutes,
      completedAt: new Date().toISOString()
    };

    if (typeof this.hooks.onComplete === "function") this.hooks.onComplete(summary);
  };

  PomodoroTimer.prototype._emitUpdate = function () {
    if (typeof this.hooks.onUpdate === "function") this.hooks.onUpdate(this.getState());
  };

  PomodoroTimer.prototype._emitPhaseChange = function () {
    if (typeof this.hooks.onPhaseChange === "function") this.hooks.onPhaseChange(this.getState());
  };

  PomodoroTimer.prototype.getState = function () {
    var progress = this.totalMs > 0 ? 1 - (this.remainingMs / this.totalMs) : 0;
    progress = Math.min(1, Math.max(0, progress));

    return {
      status: this.status,
      phase: this.phase,
      session: this.session,
      sessions: this.settings.sessions,
      remainingMs: this.remainingMs,
      totalMs: this.totalMs,
      totalStudyMs: this.totalStudyMs,
      lastCompletedPhase: this.lastCompletedPhase,
      progress: progress,
      display: formatTime(this.remainingMs)
    };
  };

  window.FocusTune = window.FocusTune || {};
  window.FocusTune.PomodoroTimer = PomodoroTimer;
  window.FocusTune.formatTime = formatTime;
})();
