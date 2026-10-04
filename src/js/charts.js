// Tiny canvas time-series renderer: area + line, dotted grid, threshold lines,
// "now" dot and an optional hover crosshair. It draws only when data, size or
// theme changes (no animation loop), which keeps a Pi browser idle between ticks.
import { clock } from './format.js';

const cssCache = new Map();

export function cssVar(name) {
  if (!cssCache.has(name)) {
    cssCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888');
  }
  return cssCache.get(name);
}

const charts = new Set();

export function refreshChartColors() {
  cssCache.clear();
  for (const chart of charts) chart.draw();
}

function niceCeil(value, base = 10) {
  if (!(value > 0)) return 1;
  const exp = base ** Math.floor(Math.log(value) / Math.log(base));
  const unit = value / exp;
  const steps = base === 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
  return steps.find((step) => unit <= step) * exp;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 *   min, max      fixed y range; `max: null` autoscales to the data
 *   axis          draw y/x labels and enable the hover readout (large chart)
 *   format(v)     value formatter for axis labels and tooltip
 *   base          1024 picks byte-friendly axis maxima when autoscaling
 */
export function createChart(canvas, options = {}) {
  const opt = { min: 0, max: 100, axis: false, format: (v) => String(Math.round(v)), ...options };
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let data = { series: [], from: 0, to: 1, thresholds: [], gap: Infinity };
  let hoverX = null;
  let zoom = 1;

  const chart = {
    setData(next) {
      data = { thresholds: [], gap: Infinity, ...next };
      chart.draw();
    },
    setOptions(next) {
      Object.assign(opt, next);
    },
    draw,
    destroy() {
      observer.disconnect();
      charts.delete(chart);
    }
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    // On very large screens the page is CSS-zoomed: draw in layout pixels and
    // let the backing store absorb the zoom so lines and text stay sharp.
    zoom = canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
    const ratio = (window.devicePixelRatio || 1) * zoom;
    width = canvas.offsetWidth;
    height = canvas.offsetHeight;
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function yRange() {
    if (opt.max != null) return [opt.min, opt.max];
    let peak = 0;
    for (const s of data.series) {
      for (let i = 0; i < s.t.length; i++) {
        if (s.v[i] != null && s.t[i] >= data.from && s.v[i] > peak) peak = s.v[i];
      }
    }
    for (const th of data.thresholds) if (th.fit && th.value > peak) peak = th.value;
    const floor = opt.minMax ?? 1;
    return [opt.min, niceCeil(Math.max(peak * 1.1, floor), opt.base || 10)];
  }

  function draw() {
    resize();
    if (width < 8 || height < 8) return;
    ctx.clearRect(0, 0, width, height);

    const rows = 4;
    const [yMin, yMax] = yRange();
    ctx.font = `10px ${cssVar('--font-mono')}`;
    const yLabels = [];
    for (let r = 0; r <= rows; r++) yLabels.push(opt.format(yMax - ((yMax - yMin) * r) / rows));
    const pad = opt.axis
      ? { l: Math.ceil(Math.max(...yLabels.map((label) => ctx.measureText(label).width))) + 16, r: 12, t: 10, b: 22 }
      : { l: 0, r: 5, t: 5, b: 1 };
    const pw = width - pad.l - pad.r;
    const ph = height - pad.t - pad.b;
    const span = Math.max(1, data.to - data.from);
    const xOf = (t) => pad.l + ((t - data.from) / span) * pw;
    const yOf = (v) => pad.t + ph - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * ph;

    ctx.textBaseline = 'middle';

    // Dotted grid
    const cols = opt.axis && width < 520 ? 3 : 6;
    ctx.fillStyle = cssVar('--line-strong');
    for (let r = 0; r <= rows; r++) {
      const y = Math.round(pad.t + (ph * r) / rows);
      for (let x = pad.l; x <= pad.l + pw + 0.5; x += 6) ctx.fillRect(Math.round(x), y, 1, 1);
    }
    for (let c = 1; c < cols; c++) {
      const x = Math.round(pad.l + (pw * c) / cols);
      for (let y = pad.t; y <= pad.t + ph; y += 6) ctx.fillRect(x, Math.round(y), 1, 1);
    }

    if (opt.axis) {
      ctx.fillStyle = cssVar('--text-3');
      ctx.textAlign = 'right';
      yLabels.forEach((label, r) => ctx.fillText(label, pad.l - 8, Math.round(pad.t + (ph * r) / rows)));
      const withSeconds = span <= 10 * 60 * 1000;
      for (let c = 0; c <= cols; c++) {
        ctx.textAlign = c === 0 ? 'left' : c === cols ? 'right' : 'center';
        const time = data.from + (span * c) / cols;
        ctx.fillText(clock(time, withSeconds), pad.l + (pw * c) / cols, height - 8);
      }
    }

    // Threshold lines
    for (const th of data.thresholds) {
      if (th.value < yMin || th.value > yMax) continue;
      const y = Math.round(yOf(th.value)) + 0.5;
      ctx.save();
      ctx.strokeStyle = cssVar(th.color);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + pw, y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, 0, pw + pad.r, height);
    ctx.clip();
    for (const s of data.series) drawSeries(s, xOf, yOf, pad.t + ph);
    ctx.restore();

    if (opt.axis && hoverX != null) drawHover(pad, pw, ph, xOf, yOf);
  }

  function drawSeries(s, xOf, yOf, baseY) {
    const color = cssVar(s.color);
    const segments = [];
    let current = null;
    let prevT = null;
    for (let i = 0; i < s.t.length; i++) {
      const t = s.t[i];
      const v = s.v[i];
      if (t < data.from - data.gap || t > data.to) continue;
      if (v == null || (prevT != null && t - prevT > data.gap)) {
        current = null;
        if (v == null) continue;
      }
      if (!current) {
        current = [];
        segments.push(current);
      }
      current.push(xOf(t), yOf(v));
      prevT = t;
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const points of segments) {
      if (points.length < 4) {
        ctx.fillStyle = color;
        ctx.fillRect(points[0] - 1, points[1] - 1, 2, 2);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (s.fill !== false) {
        ctx.lineTo(points[points.length - 2], baseY);
        ctx.lineTo(points[0], baseY);
        ctx.closePath();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // "Now" dot on the newest sample when it is recent enough to be current
    const lastSeg = segments[segments.length - 1];
    if (data.nowDot !== false && lastSeg && prevT != null && data.to - prevT <= data.gap) {
      const x = lastSeg[lastSeg.length - 2];
      const y = lastSeg[lastSeg.length - 1];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 2.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function nearest(s, time) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < s.t.length; i++) {
      if (s.v[i] == null || s.t[i] < data.from || s.t[i] > data.to) continue;
      const dist = Math.abs(s.t[i] - time);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function drawHover(pad, pw, ph, xOf, yOf) {
    const x = Math.min(Math.max(hoverX, pad.l), pad.l + pw);
    const time = data.from + ((x - pad.l) / pw) * (data.to - data.from);
    const rows = [];
    let snapT = null;
    for (const s of data.series) {
      const i = nearest(s, time);
      if (i < 0) continue;
      if (snapT == null) snapT = s.t[i];
      rows.push({ color: cssVar(s.color), label: s.label, value: s.v[i], y: yOf(s.v[i]) });
    }
    if (!rows.length) return;
    const sx = Math.round(xOf(snapT)) + 0.5;

    ctx.strokeStyle = cssVar('--text-3');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, pad.t);
    ctx.lineTo(sx, pad.t + ph);
    ctx.stroke();
    for (const row of rows) {
      ctx.fillStyle = cssVar('--bg');
      ctx.beginPath();
      ctx.arc(sx, row.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(sx, row.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const lines = [clock(snapT), ...rows.map((r) => `${r.label ? `${r.label} ` : ''}${opt.format(r.value)}`)];
    ctx.font = `11px ${cssVar('--font-mono')}`;
    ctx.textBaseline = 'middle';
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const boxH = lines.length * 16 + 8;
    const boxX = sx + 10 + boxW > pad.l + pw ? sx - 10 - boxW : sx + 10;
    const boxY = pad.t + 4;
    ctx.fillStyle = cssVar('--panel-3');
    ctx.strokeStyle = cssVar('--line-strong');
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(Math.round(boxX) + 0.5, Math.round(boxY) + 0.5, boxW, boxH);
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? cssVar('--text-3') : rows[i - 1].color;
      ctx.fillText(line, boxX + 8, boxY + 12 + i * 16);
    });
  }

  if (opt.axis) {
    canvas.addEventListener('pointermove', (event) => {
      hoverX = (event.clientX - canvas.getBoundingClientRect().left) / zoom;
      draw();
    });
    canvas.addEventListener('pointerleave', () => {
      hoverX = null;
      draw();
    });
  }

  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas);
  charts.add(chart);
  return chart;
}
