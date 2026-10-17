/**
 * text.js
 * ------------------------------------------------------------------
 * LETREIROS 2D e 3D (motor novo, compartilhado pelos dois caminhos de
 * execução: compilador próprio em js/cpp/ e o JSCPP legado).
 *
 * É o espelho, em JavaScript, do src/pixela_text.hpp: mesma fonte vetorial
 * (os traços abaixo são gerados a partir do .hpp — se mexer num, mexa no
 * outro), mesmo layout, mesma matemática, mesmos arredondamentos. Por isso
 * o mesmo letreiro sai com os mesmos pixels na camada interpretada e no WASM.
 *
 * Por que isso fica em JS e não em C++ interpretado: o JSCPP não tem
 * struct/std::vector/std::string (veja o comentário em js/mesh3d.js). Então,
 * igual ao pix_mesh_*, o C++ do usuário só chama funções simples com
 * int/double/string e recebe um "id" (handle) de volta; o armazenamento e a
 * conta pesada (layout, trigonometria, Bresenham, z-buffer) rodam nativos em JS.
 *
 * EXPORTA DUAS SUPERFÍCIES sobre a MESMA implementação:
 *   - TextEngine.api    : funções JS puras (id -> número, valores já
 *                        desserializados). É o que o Runner injeta via
 *                        new Function() no código gerado (js/runner.js).
 *   - TextEngine.install: adaptador que registra as mesmas funções no
 *                        runtime do JSCPP (js/interpreter.js).
 *   Assim os dois motores compartilham layout, desenho e z-buffer — não há
 *   duas implementações para divergirem.
 *
 * Funções expostas ao C++:
 *   2D : pix_text_*      (letreiro de pixels, com espessura/onda/movimento)
 *   3D : pix_text3d_*    (letreiro extrudado: Wire ou Solid com z-buffer)
 * Constantes: PIX_ALIGN_LEFT/CENTER/RIGHT, PIX_EDGE_NONE/WRAP/BOUNCE,
 *             PIX_STYLE_WIRE/SOLID.
 * ------------------------------------------------------------------
 */
const TextEngine = (() => {
  const CAP_H = 6;      // altura da maiúscula (unidades da fonte)
  const GAP = 2;        // espaço entre letras
  const SPACE_W = 3;    // largura do espaço
  const LINE_H = 11;    // distância entre linhas

  const ALIGN_LEFT = 0, ALIGN_CENTER = 1, ALIGN_RIGHT = 2;
  const EDGE_NONE = 0, EDGE_WRAP = 1, EDGE_BOUNCE = 2;
  const STYLE_WIRE = 0, STYLE_SOLID = 1;

  // ---- fonte (gerada de src/pixela_text.hpp) ----
  // Traços = pares "xy" de 1 caractere ('a' = -1, 'b' = -2), separados por espaço.
  const FONT_DEFS = {
    "A": "002640 1333",
    "B": "00063645443303 3342413000",
    "C": "4536160501103041",
    "D": "00062644422000",
    "E": "46060040 0333",
    "F": "460600 0333",
    "G": "45361605011030414323",
    "H": "0006 4046 0343",
    "I": "1636 2620 1030",
    "J": "4641301001",
    "K": "0006 460340",
    "L": "060040",
    "M": "0006234640",
    "N": "00064046",
    "O": "103041453616050110",
    "P": "00063645443303",
    "Q": "103041453616050110 2240",
    "R": "00063645443303 2340",
    "S": "453616050413334241301001",
    "T": "0646 2620",
    "U": "060110304146",
    "V": "062046",
    "W": "0610233046",
    "X": "0640 0046",
    "Y": "062346 2320",
    "Z": "06460040",
    "0": "103041453616050110 1135",
    "1": "152620 1030",
    "2": "05163645440040",
    "3": "05163645443313 334241301001",
    "4": "30360242",
    "5": "460603334241301001",
    "6": "36160501103041423303",
    "7": "064610",
    "8": "13040516364544331302011030414233",
    "9": "43130405163645413010",
    " ": "",
    ".": "1020211110",
    ",": "21201a",
    "!": "2623 2021",
    "?": "051636454423 2021",
    "-": "0343",
    "+": "0343 2125",
    "_": "0a4a",
    "=": "0242 0444",
    ":": "2021 2324",
    ";": "2324 21201a",
    "/": "0046",
    "\\": "0640",
    "(": "36252130",
    ")": "16252110",
    "'": "2624",
    "\"": "1614 3634",
    "*": "0244 0442 2125",
    "#": "1016 3036 0242 0444",
    "%": "0046 0616150506 3141403031",
    "<": "450341",
    ">": "054301",
    "[": "36262030",
    "]": "16262010",
    "|": "2a27",
    "~": "03143243",
    "^": "042644",
  };

  const ACCENT_DEFS = [
    "",
    "2738",
    "1827",
    "172837",
    "07183748",
    "1718 3738",
    "202a1b",
    "1737381817",
  ];

  // [codepoint, letra base, acento]
  const DECOMPOSE = [
    [0xC0, "A", 2],
    [0xC1, "A", 1],
    [0xC2, "A", 3],
    [0xC3, "A", 4],
    [0xC4, "A", 5],
    [0xC5, "A", 7],
    [0xC7, "C", 6],
    [0xC8, "E", 2],
    [0xC9, "E", 1],
    [0xCA, "E", 3],
    [0xCB, "E", 5],
    [0xCC, "I", 2],
    [0xCD, "I", 1],
    [0xCE, "I", 3],
    [0xCF, "I", 5],
    [0xD1, "N", 4],
    [0xD2, "O", 2],
    [0xD3, "O", 1],
    [0xD4, "O", 3],
    [0xD5, "O", 4],
    [0xD9, "U", 2],
    [0xDA, "U", 1],
    [0xDB, "U", 3],
    [0xDC, "U", 5],
  ];

  const A_NONE = 0;

  function coord(c) {
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c === 'a') return -1;
    if (c === 'b') return -2;
    return 0;
  }

  function parseStrokes(s) {
    const out = [];
    for (const tok of s.split(' ')) {
      if (!tok) continue;
      const pts = [];
      for (let i = 0; i + 1 < tok.length; i += 2) pts.push([coord(tok[i]), coord(tok[i + 1])]);
      if (pts.length) out.push(pts);
    }
    return out;
  }

  function makeGlyph(s) {
    const g = { strokes: parseStrokes(s), minX: 0, maxX: 0, blank: true };
    g.blank = g.strokes.length === 0;
    if (!g.blank) {
      g.minX = 1e9; g.maxX = -1e9;
      for (const st of g.strokes) for (const p of st) { g.minX = Math.min(g.minX, p[0]); g.maxX = Math.max(g.maxX, p[0]); }
    }
    return g;
  }

  const GLYPHS = {};
  for (const c of Object.keys(FONT_DEFS)) GLYPHS[c] = makeGlyph(FONT_DEFS[c]);
  const UNKNOWN = makeGlyph('0040460600');           // o tofu
  const ACCENTS = ACCENT_DEFS.map(makeGlyph);
  const DECO = new Map(DECOMPOSE.map(([cp, base, ac]) => [cp, [base, ac]]));

  // Mesmo trabalho do decodeUtf8 do C++: aqui a string do JSCPP já chega como
  // caracteres JS (UTF-16), então basta iterar por codepoint.
  function layout(text, spacing, lineSpacing) {
    const gap = GAP * spacing;
    const L = { items: [], lineW: [], width: 0, height: CAP_H, lines: 1 };
    let cursor = 0, line = 0, index = 0, lineHasGlyph = false;
    const endLine = () => { L.lineW.push(lineHasGlyph ? cursor - gap : 0); cursor = 0; lineHasGlyph = false; };

    for (const ch of String(text)) {
      let cp = ch.codePointAt(0);
      if (cp === 10) { endLine(); line++; continue; }
      if (cp === 9) cp = 32;

      let g = UNKNOWN, accent = A_NONE;
      if (cp < 128) {
        let c = cp;
        if (c >= 97 && c <= 122) c -= 32;
        const k = String.fromCharCode(c);
        if (GLYPHS[k]) g = GLYPHS[k];
      } else {
        let c = cp;
        if (c >= 0xE0 && c <= 0xFC && c !== 0xF7) c -= 0x20;
        const d = DECO.get(c);
        if (d) { g = GLYPHS[d[0]]; accent = d[1]; }
      }
      const w = g.blank ? SPACE_W : (g.maxX - g.minX);
      L.items.push({ g, accent, x: cursor, line, index: index++ });
      cursor += w + gap;
      lineHasGlyph = true;
    }
    endLine();

    L.lines = line + 1;
    L.height = CAP_H + (L.lines - 1) * LINE_H * lineSpacing;
    for (const w of L.lineW) L.width = Math.max(L.width, w);
    return L;
  }

  // f(pontos[[x,y],...], indiceDaLetra) — origem no centro do bloco, y pra cima.
  function forEachStroke(L, align, lineSpacing, f) {
    for (const it of L.items) {
      const lw = L.lineW[it.line];
      const xs = align === ALIGN_LEFT ? -L.width * 0.5
               : align === ALIGN_RIGHT ? L.width * 0.5 - lw
               : -lw * 0.5;
      const base = L.height * 0.5 - CAP_H - it.line * LINE_H * lineSpacing;
      const ox = xs + it.x;

      for (const st of it.g.strokes)
        f(st.map((p) => [ox + p[0] - it.g.minX, base + p[1]]), it.index);

      if (it.accent !== A_NONE) {
        const shift = (it.g.maxX - it.g.minX) * 0.5 - 2.0;
        for (const st of ACCENTS[it.accent].strokes)
          f(st.map((p) => [ox + p[0] + shift, base + p[1]]), it.index);
      }
    }
  }

  const iround = (v) => Math.floor(v + 0.5);   // igual ao txt::iround do C++

  // ------------------------------------------------------------------
  // 2D
  // ------------------------------------------------------------------
  function new2D(text) {
    return {
      text: String(text), x: 0, y: 0, size: 12, angle: 0,
      r: 255, g: 255, b: 255, thickness: 1, spacing: 1, lineSpacing: 1, align: ALIGN_CENTER,
      vx: 0, vy: 0, spin: 0, edge: EDGE_NONE,
      waveAmp: 0, waveFreq: 0.7, waveSpeed: 4, wavePhase: 0,
    };
  }

  function width2D(o)  { return layout(o.text, o.spacing, o.lineSpacing).width  * (o.size / CAP_H); }
  function height2D(o) { return layout(o.text, o.spacing, o.lineSpacing).height * (o.size / CAP_H); }

  function extents2D(o) {
    const L = layout(o.text, o.spacing, o.lineSpacing);
    const s = o.size / CAP_H, w = L.width * s, h = L.height * s;
    const x0 = o.align === ALIGN_LEFT ? 0 : o.align === ALIGN_RIGHT ? -w : -w * 0.5;
    const x1 = x0 + w, y0 = -h * 0.5, y1 = h * 0.5;
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    const cx = [x0, x1, x1, x0], cy = [y0, y0, y1, y1];
    let l = 1e18, t = 1e18, r = -1e18, b = -1e18;
    for (let i = 0; i < 4; i++) {
      const X = cx[i] * ca - cy[i] * sa, Y = cx[i] * sa + cy[i] * ca;
      l = Math.min(l, X); r = Math.max(r, X); t = Math.min(t, Y); b = Math.max(b, Y);
    }
    return { l, r, t, b };
  }

  function update2D(o, dt, W, H) {
    o.x += o.vx * dt; o.y += o.vy * dt;
    o.angle += o.spin * dt;
    o.wavePhase += o.waveSpeed * dt;
    if (o.edge === EDGE_NONE) return;

    const { l, r, t, b } = extents2D(o);
    if (o.edge === EDGE_WRAP) {
      if (o.x + l >= W) o.x = -r; else if (o.x + r <= 0) o.x = W - l;
      if (o.y + t >= H) o.y = -b; else if (o.y + b <= 0) o.y = H - t;
    } else {
      if (r - l >= W) o.x = W * 0.5 - (l + r) * 0.5;
      else {
        if (o.x + l < 0) { o.x = -l; if (o.vx < 0) o.vx = -o.vx; }
        if (o.x + r > W) { o.x = W - r; if (o.vx > 0) o.vx = -o.vx; }
      }
      if (b - t >= H) o.y = H * 0.5 - (t + b) * 0.5;
      else {
        if (o.y + t < 0) { o.y = -t; if (o.vy < 0) o.vy = -o.vy; }
        if (o.y + b > H) { o.y = H - b; if (o.vy > 0) o.vy = -o.vy; }
      }
    }
  }

  // Linha com espessura: "pincel quadrado" de lado t (mesmo algoritmo do C++).
  function thickLine(x0, y0, x1, y1, t, r, g, b) {
    if (t <= 1) { Pixela.drawLine(x0, y0, x1, y1, r, g, b); return; }
    const lo = -Math.trunc((t - 1) / 2), hi = Math.trunc(t / 2);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let j = lo; j <= hi; j++) for (let i = lo; i <= hi; i++) Pixela.setPixel(x0 + i, y0 + j, true, r, g, b);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function draw2D(o) {
    const L = layout(o.text, o.spacing, o.lineSpacing);
    const s = o.size / CAP_H;
    const shiftX = o.align === ALIGN_LEFT ? L.width * s * 0.5 : o.align === ALIGN_RIGHT ? -L.width * s * 0.5 : 0;
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    const t = Math.max(1, o.thickness | 0);

    forEachStroke(L, o.align, o.lineSpacing, (pts, idx) => {
      const wave = o.waveAmp * Math.sin(o.wavePhase + o.waveFreq * idx);
      const px = [], py = [];
      for (const p of pts.slice(0, 64)) {
        const lx = p[0] * s + shiftX;
        const ly = -(p[1] * s + wave);
        px.push(iround(o.x + lx * ca - ly * sa));
        py.push(iround(o.y + lx * sa + ly * ca));
      }
      if (px.length === 1) { thickLine(px[0], py[0], px[0], py[0], t, o.r, o.g, o.b); return; }
      for (let i = 0; i + 1 < px.length; i++) thickLine(px[i], py[i], px[i + 1], py[i + 1], t, o.r, o.g, o.b);
    });
  }

  // ------------------------------------------------------------------
  // 3D (usa a câmera/projeção do Mesh3D: um único pix_mesh_set_focal vale pros dois)
  // ------------------------------------------------------------------
  function new3D(text) {
    return {
      text: String(text), x: 0, y: 0, z: 8, ax: 0, ay: 0, az: 0,
      sx: 0, sy: 0, sz: 0, vx: 0, vy: 0, vz: 0,
      size: 1, depth: 0.35, weight: 0.16, r: 255, g: 255, b: 255, style: STYLE_SOLID,
      spacing: 1, lineSpacing: 1, align: ALIGN_CENTER,
      waveAmp: 0, waveFreq: 0.7, waveSpeed: 4, wavePhase: 0,
    };
  }

  function width3D(o) { return layout(o.text, o.spacing, o.lineSpacing).width * (o.size / CAP_H); }

  function update3D(o, dt) {
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
    o.ax += o.sx * dt; o.ay += o.sy * dt; o.az += o.sz * dt;
    o.wavePhase += o.waveSpeed * dt;
  }

  // ---- z-buffer + triângulo preenchido (porta de Renderer3D::fillProjected) ----
  let zbuf = null, zW = 0, zH = 0, lastClear = -1;
  const LIGHT = (() => { const l = Math.hypot(0.4, 0.7, -0.5); return { x: 0.4 / l, y: 0.7 / l, z: -0.5 / l }; })();

  // O z-buffer zera sozinho no primeiro desenho depois de cada pix_clear()
  // (no C++ você chama r3d.newFrame() na mão; aqui o clear já faz o serviço).
  function ensureZ(w, h) {
    const cc = Pixela.clearCount();
    if (!zbuf || zW !== w || zH !== h) { zbuf = new Float64Array(w * h); zW = w; zH = h; lastClear = -1; }
    if (cc !== lastClear) { zbuf.fill(1e18); lastClear = cc; }
  }

  function fillTri(p0, p1, p2, intensity, r, g, b, w, h) {
    let minX = Math.floor(Math.min(p0.sx, p1.sx, p2.sx)), maxX = Math.ceil(Math.max(p0.sx, p1.sx, p2.sx));
    let minY = Math.floor(Math.min(p0.sy, p1.sy, p2.sy)), maxY = Math.ceil(Math.max(p0.sy, p1.sy, p2.sy));
    minX = Math.max(minX, 0); minY = Math.max(minY, 0);
    maxX = Math.min(maxX, w - 1); maxY = Math.min(maxY, h - 1);
    if (minX > maxX || minY > maxY) return 0;

    const area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p1.sy - p0.sy) * (p2.sx - p0.sx);
    if (Math.abs(area) < 1e-6) return 0;

    const cl = (v) => Math.trunc(Math.min(255, Math.max(0, v)));
    const cr = cl(r * intensity), cg = cl(g * intensity), cb = cl(b * intensity);

    let drawn = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = (p1.sx - px) * (p2.sy - py) - (p1.sy - py) * (p2.sx - px);
        const w1 = (p2.sx - px) * (p0.sy - py) - (p2.sy - py) * (p0.sx - px);
        const w2 = (p0.sx - px) * (p1.sy - py) - (p0.sy - py) * (p1.sx - px);
        const inside = (w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0);
        if (!inside) continue;
        const depth = (w0 / area) * p0.z + (w1 / area) * p1.z + (w2 / area) * p2.z;
        const i = y * w + x;
        if (depth < zbuf[i]) { zbuf[i] = depth; Pixela.setPixel(x, y, true, cr, cg, cb); drawn++; }
      }
    }
    return drawn;
  }

  function drawTri(a, b, c, o, w, h) {
    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    let n = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x };
    const len = Math.hypot(n.x, n.y, n.z);
    n = len > 1e-9 ? { x: n.x / len, y: n.y / len, z: n.z / len } : { x: 0, y: 0, z: 0 };
    const intensity = 0.25 + 0.85 * Math.abs(n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
    const pa = Mesh3D.project(a, w, h), pb = Mesh3D.project(b, w, h), pc = Mesh3D.project(c, w, h);
    if (!pa || !pb || !pc) return 0;
    return fillTri(pa, pb, pc, intensity, o.r, o.g, o.b, w, h);
  }

  // Retorna pixels desenhados (Solid) ou segmentos desenhados (Wire).
  function draw3D(o) {
    const w = Pixela.width(), h = Pixela.height();
    const L = layout(o.text, o.spacing, o.lineSpacing);
    const u = o.size / CAP_H;
    const hd = Math.max(0, o.depth * o.size * 0.5);
    const ht = Math.max(1e-4, o.weight * o.size * 0.5);
    let total = 0;
    const solid = o.style === STYLE_SOLID;
    if (solid) ensureZ(w, h);

    const T = (x, y, z) => {
      let p = Mesh3D.rotateX({ x, y, z }, o.ax);
      p = Mesh3D.rotateY(p, o.ay);
      p = Mesh3D.rotateZ(p, o.az);
      return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
    };
    const line3 = (a, b) => {
      const pa = Mesh3D.project(a, w, h), pb = Mesh3D.project(b, w, h);
      if (pa && pb) Pixela.drawLine(pa.sx | 0, pa.sy | 0, pb.sx | 0, pb.sy | 0, o.r, o.g, o.b);
    };
    const quad = (a, b, c, d) => { total += drawTri(a, b, c, o, w, h); total += drawTri(a, c, d, o, w, h); };

    forEachStroke(L, o.align, o.lineSpacing, (pts, idx) => {
      const wave = o.waveAmp * Math.sin(o.wavePhase + o.waveFreq * idx);
      const n = pts.length;

      if (!solid) {
        for (let i = 0; i < n; i++) {
          const X = pts[i][0] * u, Y = pts[i][1] * u + wave;
          if (i + 1 < n) {
            const X2 = pts[i + 1][0] * u, Y2 = pts[i + 1][1] * u + wave;
            line3(T(X, Y, -hd), T(X2, Y2, -hd)); total++;
            if (hd > 0) { line3(T(X, Y, hd), T(X2, Y2, hd)); total++; }
          }
          if (hd > 0) { line3(T(X, Y, -hd), T(X, Y, hd)); total++; }
        }
        return;
      }

      for (let i = 0; i + 1 < n; i++) {
        let ax = pts[i][0] * u, ay = pts[i][1] * u + wave;
        let bx = pts[i + 1][0] * u, by = pts[i + 1][1] * u + wave;
        let dx = bx - ax, dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) continue;
        dx /= len; dy /= len;
        const nx = -dy, ny = dx;
        ax -= dx * ht; ay -= dy * ht;
        bx += dx * ht; by += dy * ht;

        const f0 = T(ax + nx * ht, ay + ny * ht, hd), b0 = T(ax + nx * ht, ay + ny * ht, -hd);
        const f1 = T(ax - nx * ht, ay - ny * ht, hd), b1 = T(ax - nx * ht, ay - ny * ht, -hd);
        const f2 = T(bx - nx * ht, by - ny * ht, hd), b2 = T(bx - nx * ht, by - ny * ht, -hd);
        const f3 = T(bx + nx * ht, by + ny * ht, hd), b3 = T(bx + nx * ht, by + ny * ht, -hd);

        quad(f0, f1, f2, f3); quad(b0, b1, b2, b3);
        quad(f0, f3, b3, b0); quad(f1, f2, b2, b1);
        quad(f0, f1, b1, b0); quad(f3, f2, b2, b3);
      }
    });
    return total;
  }

  // ------------------------------------------------------------------
  // POOLS: um handle por letreiro. O C++ só guarda o id; todo o estado
  // (posição, cor, movimento) vive aqui em JS nativo.
  // ------------------------------------------------------------------
  const pool2D = new Map(), pool3D = new Map();
  let next2D = 0, next3D = 0;

  function reset() { pool2D.clear(); pool3D.clear(); next2D = 0; next3D = 0; zbuf = null; }

  // ------------------------------------------------------------------
  // SUPERFÍCIE 1 — API em JS puro (usada pelo Runner / codegen).
  // Mesma semântica do install() abaixo, só sem o empacotamento do JSCPP:
  // aqui os argumentos chegam como números/strings já primitivos.
  // ------------------------------------------------------------------
  const api = {
    // ---- 2D ----
    pix_text_create(text) { const id = next2D++; pool2D.set(id, new2D(text)); return id; },
    pix_text_set_string(id, text) { const o = pool2D.get(id); if (o) o.text = String(text); },
    pix_text_set_pos(id, x, y) { const o = pool2D.get(id); if (o) { o.x = x; o.y = y; } },
    pix_text_set_size(id, s) { const o = pool2D.get(id); if (o) o.size = s; },
    pix_text_set_angle(id, a) { const o = pool2D.get(id); if (o) o.angle = a; },
    pix_text_set_color(id, r, g, b) { const o = pool2D.get(id); if (o) { o.r = r; o.g = g; o.b = b; } },
    pix_text_set_thickness(id, t) { const o = pool2D.get(id); if (o) o.thickness = t; },
    pix_text_set_align(id, a) { const o = pool2D.get(id); if (o) o.align = a; },
    pix_text_set_spacing(id, l, ln) { const o = pool2D.get(id); if (o) { o.spacing = l; o.lineSpacing = ln; } },
    pix_text_set_velocity(id, vx, vy) { const o = pool2D.get(id); if (o) { o.vx = vx; o.vy = vy; } },
    pix_text_set_spin(id, s) { const o = pool2D.get(id); if (o) o.spin = s; },
    pix_text_set_edge(id, e) { const o = pool2D.get(id); if (o) o.edge = e; },
    pix_text_set_wave(id, a, f, s) { const o = pool2D.get(id); if (o) { o.waveAmp = a; o.waveFreq = f; o.waveSpeed = s; } },
    pix_text_update(id, dt) { const o = pool2D.get(id); if (o) update2D(o, dt, Pixela.width(), Pixela.height()); },
    pix_text_draw(id) { const o = pool2D.get(id); if (o) draw2D(o); },
    pix_text_remove(id) { pool2D.delete(id); },
    pix_text_width(id) { const o = pool2D.get(id); return o ? width2D(o) : 0; },
    pix_text_height(id) { const o = pool2D.get(id); return o ? height2D(o) : 0; },
    pix_text_x(id) { const o = pool2D.get(id); return o ? o.x : 0; },
    pix_text_y(id) { const o = pool2D.get(id); return o ? o.y : 0; },
    pix_text_angle(id) { const o = pool2D.get(id); return o ? o.angle : 0; },
    pix_text_update_all(dt) { for (const o of pool2D.values()) update2D(o, dt, Pixela.width(), Pixela.height()); },
    pix_text_draw_all() { for (const o of pool2D.values()) draw2D(o); },
    pix_text_clear_all() { pool2D.clear(); },
    // modo avulso (sem guardar handle): pix_text_draw_at("FPS", x, y, size, angulo, r, g, b)
    pix_text_draw_at(text, x, y, size, ang, r, g, b) {
      const o = new2D(text);
      o.x = x; o.y = y; o.size = size; o.angle = ang;
      o.r = r; o.g = g; o.b = b; o.align = ALIGN_LEFT;
      draw2D(o);
    },

    // ---- 3D ----
    pix_text3d_create(text) { const id = next3D++; pool3D.set(id, new3D(text)); return id; },
    pix_text3d_set_string(id, text) { const o = pool3D.get(id); if (o) o.text = String(text); },
    pix_text3d_set_pos(id, x, y, z) { const o = pool3D.get(id); if (o) { o.x = x; o.y = y; o.z = z; } },
    pix_text3d_set_angle(id, x, y, z) { const o = pool3D.get(id); if (o) { o.ax = x; o.ay = y; o.az = z; } },
    pix_text3d_set_spin(id, x, y, z) { const o = pool3D.get(id); if (o) { o.sx = x; o.sy = y; o.sz = z; } },
    pix_text3d_set_velocity(id, x, y, z) { const o = pool3D.get(id); if (o) { o.vx = x; o.vy = y; o.vz = z; } },
    pix_text3d_set_size(id, s) { const o = pool3D.get(id); if (o) o.size = s; },
    pix_text3d_set_depth(id, d, w) { const o = pool3D.get(id); if (o) { o.depth = d; o.weight = w; } },
    pix_text3d_set_color(id, r, g, b) { const o = pool3D.get(id); if (o) { o.r = r; o.g = g; o.b = b; } },
    pix_text3d_set_style(id, s) { const o = pool3D.get(id); if (o) o.style = s; },
    pix_text3d_set_align(id, a) { const o = pool3D.get(id); if (o) o.align = a; },
    pix_text3d_set_spacing(id, l, ln) { const o = pool3D.get(id); if (o) { o.spacing = l; o.lineSpacing = ln; } },
    pix_text3d_set_wave(id, a, f, s) { const o = pool3D.get(id); if (o) { o.waveAmp = a; o.waveFreq = f; o.waveSpeed = s; } },
    pix_text3d_update(id, dt) { const o = pool3D.get(id); if (o) update3D(o, dt); },
    pix_text3d_remove(id) { pool3D.delete(id); },
    pix_text3d_draw(id) { const o = pool3D.get(id); return o ? draw3D(o) : 0; },
    pix_text3d_width(id) { const o = pool3D.get(id); return o ? width3D(o) : 0; },
    pix_text3d_update_all(dt) { for (const o of pool3D.values()) update3D(o, dt); },
    pix_text3d_draw_all() { for (const o of pool3D.values()) draw3D(o); },
    pix_text3d_clear_all() { pool3D.clear(); },
  };

  // Constantes que o C++ usa como argumentos (PIX_ALIGN_CENTER etc.).
  const CONSTANTS = {
    PIX_ALIGN_LEFT: ALIGN_LEFT, PIX_ALIGN_CENTER: ALIGN_CENTER, PIX_ALIGN_RIGHT: ALIGN_RIGHT,
    PIX_EDGE_NONE: EDGE_NONE, PIX_EDGE_WRAP: EDGE_WRAP, PIX_EDGE_BOUNCE: EDGE_BOUNCE,
    PIX_STYLE_WIRE: STYLE_WIRE, PIX_STYLE_SOLID: STYLE_SOLID,
  };

  // ------------------------------------------------------------------
  // SUPERFÍFIE 2 — Adaptador para o runtime do JSCPP.
  // Mesmas funções, traduzidas para o protocolo de valores do JSCPP
  // (cada argumento chega embrulhado em {v: ...}).
  // ------------------------------------------------------------------

  // Tabela de assinaturas: 'S' = char* (string), 'I' = int, 'D' = double.
  // Espelha js/interpreter.js::buildPixHeader e js/runner.js::buildPixFunctions.
  //     nome:                            [params], retorno ('I' | 'D' | 'V')
  const SIGNATURES = {
    // ---- 2D ----
    pix_text_create:                 [['S'], 'I'],
    pix_text_set_string:             [['I', 'S'], 'V'],
    pix_text_set_pos:                [['I', 'D', 'D'], 'V'],
    pix_text_set_size:               [['I', 'D'], 'V'],
    pix_text_set_angle:              [['I', 'D'], 'V'],
    pix_text_set_color:              [['I', 'I', 'I', 'I'], 'V'],
    pix_text_set_thickness:          [['I', 'I'], 'V'],
    pix_text_set_align:              [['I', 'I'], 'V'],
    pix_text_set_spacing:            [['I', 'D', 'D'], 'V'],
    pix_text_set_velocity:           [['I', 'D', 'D'], 'V'],
    pix_text_set_spin:               [['I', 'D'], 'V'],
    pix_text_set_edge:               [['I', 'I'], 'V'],
    pix_text_set_wave:               [['I', 'D', 'D', 'D'], 'V'],
    pix_text_update:                 [['I', 'D'], 'V'],
    pix_text_draw:                   [['I'], 'V'],
    pix_text_remove:                 [['I'], 'V'],
    pix_text_width:                  [['I'], 'D'],
    pix_text_height:                 [['I'], 'D'],
    pix_text_x:                      [['I'], 'D'],
    pix_text_y:                      [['I'], 'D'],
    pix_text_angle:                  [['I'], 'D'],
    pix_text_update_all:             [['D'], 'V'],
    pix_text_draw_all:               [[], 'V'],
    pix_text_clear_all:              [[], 'V'],
    pix_text_draw_at:                [['S', 'D', 'D', 'D', 'D', 'I', 'I', 'I'], 'V'],
    // ---- 3D ----
    pix_text3d_create:               [['S'], 'I'],
    pix_text3d_set_string:           [['I', 'S'], 'V'],
    pix_text3d_set_pos:              [['I', 'D', 'D', 'D'], 'V'],
    pix_text3d_set_angle:            [['I', 'D', 'D', 'D'], 'V'],
    pix_text3d_set_spin:             [['I', 'D', 'D', 'D'], 'V'],
    pix_text3d_set_velocity:         [['I', 'D', 'D', 'D'], 'V'],
    pix_text3d_set_size:             [['I', 'D'], 'V'],
    pix_text3d_set_depth:            [['I', 'D', 'D'], 'V'],
    pix_text3d_set_color:            [['I', 'I', 'I', 'I'], 'V'],
    pix_text3d_set_style:            [['I', 'I'], 'V'],
    pix_text3d_set_align:            [['I', 'I'], 'V'],
    pix_text3d_set_spacing:          [['I', 'D', 'D'], 'V'],
    pix_text3d_set_wave:             [['I', 'D', 'D', 'D'], 'V'],
    pix_text3d_update:               [['I', 'D'], 'V'],
    pix_text3d_remove:               [['I'], 'V'],
    pix_text3d_draw:                 [['I'], 'I'],
    pix_text3d_width:                [['I'], 'D'],
    pix_text3d_update_all:           [['D'], 'V'],
    pix_text3d_draw_all:             [[], 'V'],
    pix_text3d_clear_all:            [[], 'V'],
  };

  function install(rt) {
    reset();
    const g = 'global';
    const tInt = rt.intTypeLiteral, tD = rt.doubleTypeLiteral, tV = rt.voidTypeLiteral;
    const tStr = rt.normalPointerType(rt.charTypeLiteral);
    const typeOf = (c) => (c === 'S' ? tStr : c === 'D' ? tD : c === 'V' ? tV : tInt);

    for (const k of Object.keys(CONSTANTS)) rt.defVar(k, tInt, rt.val(tInt, CONSTANTS[k]));

    for (const name of Object.keys(SIGNATURES)) {
      const sig = SIGNATURES[name];
      const params = sig[0].map(typeOf);
      const retType = typeOf(sig[1]);

      rt.regFunc((rt_, _t, ...args) => {
        const plain = args.map((a, i) => (sig[0][i] === 'S' ? rt_.getStringFromCharArray(a) : a.v));
        const out = api[name](...plain);
        return rt_.val(retType, retType === tV ? 0 : out);
      }, g, name, params, retType);
    }
  }

  return { install, reset, api, SIGNATURES, layout, forEachStroke,
    new2D, update2D, draw2D, width2D, height2D, new3D, update3D, draw3D, width3D,
    FONT_DEFS, ACCENT_DEFS, DECOMPOSE, CONSTANTS };
})();

window.TextEngine = TextEngine;