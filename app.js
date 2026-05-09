(function () {
  const STORAGE_KEY = "life-as-signal-history-v1";
  const HINT_KEY = "life-as-signal-hint-seen-v1";
  const DAY_INPUT_KEY_PREFIX = "life-as-signal-input-";
  const HOURS_PER_DAY = 24;
  const MINUTES_PER_HOUR = 60;
  const SECONDS_PER_MINUTE = 60;
  const MS_PER_SECOND = 1000;
  const DAY_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
  const ACTION_KIND = { C: "Consume", E: "Event", R: "Create" };
  const MIN_TRACE_POINTS = 2;
  const CONSUME_MODEL = {
    varianceMin: 3.5,
    varianceFactor: 0.82,
    periodicityMax: 0.11,
    periodicityDelta: 0.008,
    trendSlopeFactor: 0.9,
    breakOffsetFactor: 0.7,
  };
  const EVENT_MODEL = {
    varianceMax: 26,
    varianceFactor: 1.35,
    varianceLift: 2.5,
    periodicityMin: 0.02,
    periodicityFactor: 0.83,
    breakOffsetRange: 22,
    shockCount: 5,
    shockRange: 45,
  };
  const CREATE_MODEL = {
    trendShiftRange: 0.08,
    trendSlopeMin: -0.2,
    trendSlopeMax: 0.2,
    trendOffsetRange: 8,
    varianceFactor: 0.94,
    varianceLift: 1.6,
    periodicityFactor: 0.92,
    periodicityLift: 0.003,
  };

  const canvas = document.getElementById("signalCanvas");
  const ctx = canvas.getContext("2d");
  const hint = document.getElementById("hint");
  const buttons = {
    C: document.getElementById("btnC"),
    E: document.getElementById("btnE"),
    R: document.getElementById("btnR"),
  };

  const state = {
    points: [],
    pointer: 0,
    width: 0,
    height: 0,
    centerY: 0,
    phase: 0,
    trend: 0,
    trendSlope: 0.015,
    variance: 8.5,
    periodicity: 0.04,
    shockQueue: [],
    breakOffset: 0,
    pulseTimer: null,
    history: loadHistory(),
  };

  function dayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item) => item && typeof item.t === "number" && typeof item.a === "string"
      );
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-120)));
  }

  function canInputToday() {
    return !localStorage.getItem(`${DAY_INPUT_KEY_PREFIX}${dayKey()}`);
  }

  function lockTodayInput(action) {
    localStorage.setItem(`${DAY_INPUT_KEY_PREFIX}${dayKey()}`, action);
  }

  function updateButtonState() {
    const locked = !canInputToday();
    Object.values(buttons).forEach((btn) => {
      btn.disabled = locked;
    });
  }

  function pulse() {
    if (state.pulseTimer) {
      clearTimeout(state.pulseTimer);
      state.pulseTimer = null;
    }
    state.variance *= 1.03;
    state.pulseTimer = setTimeout(() => {
      state.variance *= 0.97;
      state.pulseTimer = null;
    }, 400);
  }

  function applyConsume() {
    state.variance = Math.max(CONSUME_MODEL.varianceMin, state.variance * CONSUME_MODEL.varianceFactor);
    state.periodicity = Math.min(
      CONSUME_MODEL.periodicityMax,
      state.periodicity + CONSUME_MODEL.periodicityDelta
    );
    state.trendSlope *= CONSUME_MODEL.trendSlopeFactor;
    state.breakOffset *= CONSUME_MODEL.breakOffsetFactor;
    pulse();
  }

  function applyEvent() {
    state.variance = Math.min(
      EVENT_MODEL.varianceMax,
      state.variance * EVENT_MODEL.varianceFactor + EVENT_MODEL.varianceLift
    );
    state.periodicity = Math.max(EVENT_MODEL.periodicityMin, state.periodicity * EVENT_MODEL.periodicityFactor);
    state.breakOffset += (Math.random() - 0.5) * EVENT_MODEL.breakOffsetRange;
    for (let i = 0; i < EVENT_MODEL.shockCount; i += 1) {
      state.shockQueue.push((Math.random() - 0.5) * EVENT_MODEL.shockRange);
    }
    pulse();
  }

  function applyCreate() {
    const shift = (Math.random() - 0.5) * CREATE_MODEL.trendShiftRange;
    state.trendSlope = clamp(
      state.trendSlope + shift,
      CREATE_MODEL.trendSlopeMin,
      CREATE_MODEL.trendSlopeMax
    );
    state.trend += (Math.random() - 0.5) * CREATE_MODEL.trendOffsetRange;
    state.variance = state.variance * CREATE_MODEL.varianceFactor + CREATE_MODEL.varianceLift;
    state.periodicity = state.periodicity * CREATE_MODEL.periodicityFactor + CREATE_MODEL.periodicityLift;
    pulse();
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function bindActions() {
    buttons.C.addEventListener("click", () => inputAction("C", applyConsume));
    buttons.E.addEventListener("click", () => inputAction("E", applyEvent));
    buttons.R.addEventListener("click", () => inputAction("R", applyCreate));
  }

  function inputAction(actionCode, applyFn) {
    if (!canInputToday()) return;
    applyFn();
    lockTodayInput(actionCode);
    state.history.push({ t: Date.now(), a: actionCode, k: ACTION_KIND[actionCode] });
    saveHistory(state.history);
    updateButtonState();
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.width = cssWidth;
    state.height = cssHeight;
    state.centerY = cssHeight * 0.52;
    bootstrapPoints();
  }

  function bootstrapPoints() {
    state.points = new Array(Math.max(MIN_TRACE_POINTS, Math.floor(state.width))).fill(
      state.centerY
    );
    state.pointer = 0;
  }

  function nextPoint() {
    state.phase += state.periodicity;
    state.trend += state.trendSlope * 0.05;
    state.breakOffset *= 0.995;
    const periodic = Math.sin(state.phase) * 10;
    const noise = (Math.random() - 0.5) * state.variance;
    const shock = state.shockQueue.length ? state.shockQueue.shift() * 0.6 : 0;
    const y = state.centerY + periodic + noise + state.trend + state.breakOffset + shock;
    return clamp(y, 8, state.height - 8);
  }

  function pushPoint(y) {
    state.points[state.pointer] = y;
    state.pointer = (state.pointer + 1) % state.points.length;
  }

  function orderedPoints() {
    return state.points.slice(state.pointer).concat(state.points.slice(0, state.pointer));
  }

  function drawTrace(points, color, lineWidth, glow) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.shadowBlur = glow;
    ctx.shadowColor = color;
    ctx.beginPath();
    for (let x = 0; x < points.length; x += 1) {
      const y = points[x];
      if (x === 0) ctx.moveTo(0, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function recentActions(days) {
    const cutoff = Date.now() - days * DAY_MS;
    return state.history.filter((item) => item.t >= cutoff);
  }

  function ghostTrace(action, index, total, width, centerY) {
    const points = [];
    const scale = (index + 1) / Math.max(1, total);
    let phase = 0;
    let trend = (scale - 0.5) * 10;
    let variance = 6 + (1 - scale) * 10;
    let periodicity = 0.03 + scale * 0.02;
    let slope = 0;

    if (action === "C") {
      variance *= 0.65;
      periodicity += 0.02;
    } else if (action === "E") {
      variance *= 1.5;
      periodicity *= 0.8;
      trend += (Math.random() - 0.5) * 20;
    } else if (action === "R") {
      slope = (Math.random() - 0.5) * 0.06;
      variance *= 0.9;
    }

    for (let x = 0; x < width; x += 1) {
      phase += periodicity;
      trend += slope;
      const v = centerY + Math.sin(phase) * (8 + 4 * scale) + (Math.random() - 0.5) * variance + trend;
      points.push(clamp(v, 8, state.height - 8));
    }
    return points;
  }

  function drawGhosts() {
    const last30 = recentActions(30).slice(-30);
    const last7 = last30.slice(-7);

    last30.forEach((item, i) => {
      drawTrace(
        ghostTrace(item.a, i, last30.length, state.width, state.centerY),
        "rgba(94,245,208,0.06)",
        0.9,
        0
      );
    });

    last7.forEach((item, i) => {
      drawTrace(
        ghostTrace(item.a, i, last7.length, state.width, state.centerY),
        "rgba(94,245,208,0.14)",
        1.1,
        0
      );
    });
  }

  function frame() {
    for (let i = 0; i < 2; i += 1) {
      pushPoint(nextPoint());
    }

    ctx.clearRect(0, 0, state.width, state.height);
    drawGhosts();
    drawTrace(orderedPoints(), "#5ef5d0", 1.35, 8);
    requestAnimationFrame(frame);
  }

  function initHint() {
    if (!localStorage.getItem(HINT_KEY)) {
      hint.classList.remove("hidden");
      localStorage.setItem(HINT_KEY, "1");
      setTimeout(() => {
        hint.classList.add("hidden");
      }, 2800);
    }
  }

  function init() {
    bindActions();
    updateButtonState();
    initHint();
    resize();
    frame();
  }

  window.addEventListener("resize", resize);
  init();
})();
