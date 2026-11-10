/* Pure logic (no browser APIs) so it can be unit-tested: YOLOv8 output decoding, NMS, zone test, smoothing. */
const Core = (() => {
  const letterbox = (w, h, S) => {
    const scale = Math.min(S / w, S / h), nw = Math.round(w * scale), nh = Math.round(h * scale);
    return { scale, nw, nh, padX: Math.floor((S - nw) / 2), padY: Math.floor((S - nh) / 2) };
  };

  // RGBA bytes -> Float32 CHW in 0..1
  const preprocess = (rgba, S) => {
    const n = S * S, out = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      out[i] = rgba[i * 4] / 255; out[n + i] = rgba[i * 4 + 1] / 255; out[2 * n + i] = rgba[i * 4 + 2] / 255;
    }
    return out;
  };

  const iou = (a, b) => {
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const uni = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return uni > 0 ? inter / uni : 0;
  };

  const nms = (dets, thr) => {
    const keep = [];
    for (const d of [...dets].sort((a, b) => b.score - a.score)) if (keep.every(k => iou(k, d) <= thr)) keep.push(d);
    return keep;
  };

  // YOLOv8 ONNX output: [1, 4+classes, N] (or [1, N, 4+classes]). Class 0 = person.
  const decodePerson = (data, dims, lb, imgW, imgH, conf, iouThr) => {
    const transposed = dims[1] > dims[2];
    const F = transposed ? dims[2] : dims[1], N = transposed ? dims[1] : dims[2];
    const kS = transposed ? 1 : N, iS = transposed ? F : 1;
    const out = [];
    for (let i = 0; i < N; i++) {
      const score = data[4 * kS + i * iS];
      if (score < conf) continue;
      const cx = data[i * iS], cy = data[kS + i * iS], w = data[2 * kS + i * iS], h = data[3 * kS + i * iS];
      const x1 = Math.max(0, (cx - w / 2 - lb.padX) / lb.scale), y1 = Math.max(0, (cy - h / 2 - lb.padY) / lb.scale);
      const x2 = Math.min(imgW, (cx + w / 2 - lb.padX) / lb.scale), y2 = Math.min(imgH, (cy + h / 2 - lb.padY) / lb.scale);
      if (x2 > x1 && y2 > y1) out.push({ x1, y1, x2, y2, score });
    }
    return nms(out, iouThr);
  };

  const inPolygon = (x, y, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [a, b] = poly[i], [d, e] = poly[j];
      if ((b > y) !== (e > y) && x < (d - a) * (y - b) / (e - b) + a) c = !c;
    }
    return c;
  };

  const median = a => {
    const s = [...a].sort((x, y) => x - y), n = s.length;
    return Math.round(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2);
  };

  class Smoother {
    constructor() { this.buf = []; }
    add(count, now, windowMs) {
      this.buf.push([now, count]);
      while (this.buf.length && now - this.buf[0][0] > windowMs) this.buf.shift();
      return median(this.buf.map(e => e[1]));
    }
  }

  const statusFor = (count, cap, busy, dispatch) => {
    const r = count / Math.max(cap, 1);
    return r >= dispatch ? 'dispatch' : r >= busy ? 'busy' : 'calm';
  };

  return { letterbox, preprocess, iou, nms, decodePerson, inPolygon, median, Smoother, statusFor };
})();
if (typeof module !== 'undefined') module.exports = Core;
