/**
 * PCalc 1.4 Web - Bundle Unificado
 * Permite execução direta via duplo clique (file:///) e em qualquer servidor web sem problemas de CORS.
 */
(function() {
  'use strict';

  // ==========================================
  // PARTE 1: NÚCLEO DE ENGENHARIA (engine.js)
  // ==========================================
  /**
 * PCalc Web Engine - Núcleo de engenharia (reconstrução dos algoritmos do PCalc 1.4)
 *
 * Unidades: força kN, comprimento cm (momentos em kN·m), tensões kN/cm², deformações em ‰.
 * Convenção de sinais (igual ao original): compressão negativa; Nsd < 0 = compressão.
 * Momentos de topo/base: o diagrama de 1ª ordem é M(z) = -Mbase + (Mbase+Mtopo)·z/L
 * (valores de mesmo sinal em topo e base => dupla curvatura).
 *
 * Diagrama tensão-deformação do concreto (NBR 6118, Fig. 8.2):
 *   σc = 0,85·ηc·fcd·[1 - (1 - εc/εc2)^n]
 *   fck ≤ 40: ηc = 1,0 | fck > 40: ηc = (40/fck)^(1/3)
 *   fck ≤ 50: n = 2    | fck > 50: n = 1,4 + 23,4·[(90 - fck)/100]^4
 *   ≤ C50: εc2 = 2,0‰, εcu = 3,5‰
 *   C55–C90: εc2 = 2,0‰ + 0,085‰·(fck-50)^0,53 ; εcu = 2,6‰ + 35‰·[(90-fck)/100]^4
 */

function parametrosConcretoNBR(fck) {
  const etaC = fck <= 40 ? 1.0 : Math.pow(40 / fck, 1 / 3);
  const k = Math.pow(Math.max(0, 90 - fck) / 100, 4);
  const n = fck <= 50 ? 2.0 : 1.4 + 23.4 * k;
  const ec2 = fck <= 50 ? 2.0 : 2.0 + 0.085 * Math.pow(fck - 50, 0.53);
  const ecu = fck <= 50 ? 3.5 : 2.6 + 35 * k;
  return { etaC, n, ec2, ecu };
}

class PCalcEngine {
  constructor(config = {}) {
    this.fck = config.fck ?? 30.0; // MPa
    this.gamaC = config.gamaC ?? 1.40;
    this.fyk = config.fyk ?? 500.0; // MPa
    this.modEs = config.modEs ?? 210000.0; // MPa
    this.gamaS = config.gamaS ?? 1.15;
    this.gamaF = config.gamaF ?? 1.40;
    this.gamaF3 = config.gamaF3 ?? 1.10;

    this.tolIt = config.tolIt ?? 100;
    this.tolSomaN = config.tolSomaN ?? 0.05; // kN
    this.tolVarLn = config.tolVarLn ?? 0.001; // cm
    this.nSecao = config.nSecao ?? 400;
    this.nGraficoMr = config.nGraficoMr ?? 72;
    this.taxaMin = config.taxaMin ?? 0.4; // %
    this.taxaMax = config.taxaMax ?? 4.0; // %

    this.criterios = {
      momentoMinimo: config.limMomentoMin ?? true,
      taxaMin: config.taxaMin ?? 0.40,
      taxaMax: config.taxaMax ?? 4.00,
      nFibras: config.nSecao ?? 400,
      nPtsMr: config.nGraficoMr ?? 72,
      tolN: config.tolSomaN ?? 0.05,
      tolLN: config.tolVarLn ?? 0.001
    };

    // 1=sempre, 2=somente se λ ≥ λ1, 3=não calcular
    this.calcular2ord = config.calcular2ord ?? 1;
    // 1=curvatura aprox, 2=rigidez κ aprox, 3=pilar-padrão N,M,1/r,
    // 4=método geral N,M,1/r, 5=método geral N,Mx,My,1/r (direções acopladas)
    this.metodoSegOrd = config.metodoSegOrd ?? 5;
    this.limMb = config.limMb ?? true;
    this.limMomentoMin = config.limMomentoMin ?? true;

    this.secao = {
      tipo: 'Retangular', // Retangular | Retangular Vazada | Circular | Circular Vazada
      hx: 20.0, hy: 40.0, hx2: 0, hy2: 0,
      l: 300.0, // cm
      tipoVinculacao: 1 // 0=só seção, 1=biapoiado (le=L), 2=engastado-livre (le=2L)
    };

    this.barras = []; // { x, y, fi, area } coordenadas relativas ao centro da seção
    this.esforcos = []; // { id, nsd, msxdTopo, msxdBase, msydTopo, msydBase } (valores característicos)
    this.fibrasConcreto = [];
    this.propriedadesGeometricas = {};
    this._eiCache = new Map();
  }

  // --- MATERIAIS ---
  get es() { return (this.modEs || 210000.0) / 1000.0; } // GPa
  set es(val) { this.modEs = (val || 210.0) * 1000.0; }
  get fcd() { return (this.fck / 10.0) / this.gamaC; }
  get fyd() { return (this.fyk / 10.0) / this.gamaS; }
  get modEs_kN_cm2() { return this.modEs / 10.0; }
  get parametrosConcreto() { return parametrosConcretoNBR(this.fck); }

  /** Fabrica função σc(εc) com fator beta (0,85 resistência; 1,1 rigidez). */
  makeFc(beta) {
    const { n, ec2, etaC } = this.parametrosConcreto;
    const f = beta * etaC * this.fcd;
    return (ec) => {
      if (ec >= 0) return 0;
      if (ec > -ec2) return -f * (1 - Math.pow(1 + ec / ec2, n));
      return -f;
    };
  }

  /** σs(εs) (elastoplástico) descontando o concreto deslocado pela barra. */
  makeFs(fcFn) {
    const fyd = this.fyd;
    const ey = fyd / this.modEs_kN_cm2 * 1000.0;
    return (es) => {
      const a = Math.abs(es);
      const s = a < ey ? es * fyd / ey : (es >= 0 ? fyd : -fyd);
      return s - fcFn(es);
    };
  }

  prepararMateriais() {
    this.fc85 = this.makeFc(0.85);
    this.fs85 = this.makeFs(this.fc85);
    this.fc11 = this.makeFc(1.1);
    this.fs11 = this.makeFs(this.fc11);
    this._eiCache = new Map();
  }
  calcFc(ec) { if (!this.fc85) this.prepararMateriais(); return this.fc85(ec); }

  // --- GEOMETRIA ---
  get dimY() {
    const t = this.secao.tipo;
    return (t === 'Circular' || t === 'Circular Vazada') ? this.secao.hx : this.secao.hy;
  }
  get ehCircular() { return this.secao.tipo === 'Circular' || this.secao.tipo === 'Circular Vazada'; }

  atualizarPropriedadesGeometricas() {
    const s = this.secao;
    let Ac, Ix, Iy, xm, ym;
    if (s.tipo === 'Retangular') {
      Ac = s.hx * s.hy; xm = s.hx / 2; ym = s.hy / 2;
      Ix = s.hx * Math.pow(s.hy, 3) / 12; Iy = s.hy * Math.pow(s.hx, 3) / 12;
    } else if (s.tipo === 'Circular') {
      const D = s.hx; Ac = Math.PI * D * D / 4; xm = ym = D / 2;
      Ix = Iy = Math.PI * Math.pow(D, 4) / 64;
    } else if (s.tipo === 'Retangular Vazada') {
      const hx2 = s.hx2 || s.hx * 0.6, hy2 = s.hy2 || s.hy * 0.6;
      Ac = s.hx * s.hy - hx2 * hy2; xm = s.hx / 2; ym = s.hy / 2;
      Ix = (s.hx * Math.pow(s.hy, 3) - hx2 * Math.pow(hy2, 3)) / 12;
      Iy = (s.hy * Math.pow(s.hx, 3) - hy2 * Math.pow(hx2, 3)) / 12;
    } else { // Circular Vazada
      const De = s.hx, Di = s.hx2 || De * 0.6;
      Ac = Math.PI * (De * De - Di * Di) / 4; xm = ym = De / 2;
      Ix = Iy = Math.PI * (Math.pow(De, 4) - Math.pow(Di, 4)) / 64;
    }
    const ix = Math.sqrt(Ix / Ac), iy = Math.sqrt(Iy / Ac);
    const le = s.tipoVinculacao === 2 ? 2 * s.l : s.l;
    this.propriedadesGeometricas = {
      Ac, ac: Ac,
      xm, ym,
      Ix, Iy,
      ix, iy,
      le,
      lambdaX: le / ix, lambdaY: le / iy,
      lambdaMax: Math.max(le / ix, le / iy)
    };
  }

  discretizarSecao() {
    this.atualizarPropriedadesGeometricas();
    const s = this.secao, p = this.propriedadesGeometricas, nTotal = this.nSecao;
    const fibras = [];
    if (s.tipo === 'Retangular' || s.tipo === 'Retangular Vazada') {
      const vaz = s.tipo === 'Retangular Vazada';
      const hx2 = s.hx2 || s.hx * 0.6, hy2 = s.hy2 || s.hy * 0.6;
      const step = Math.sqrt(s.hx * s.hy / nTotal);
      const nHx = Math.max(vaz ? 12 : 8, Math.round(s.hx / step));
      const nHy = Math.max(vaz ? 12 : 8, Math.round(s.hy / step));
      const dx = s.hx / nHx, dy = s.hy / nHy, dA = dx * dy;
      for (let iy = 0; iy < nHy; iy++) {
        for (let ix = 0; ix < nHx; ix++) {
          const x = (0.5 + ix) * dx - p.xm, y = (0.5 + iy) * dy - p.ym;
          if (vaz && Math.abs(x) < hx2 / 2 && Math.abs(y) < hy2 / 2) continue;
          fibras.push({ x, y, dA, dx, dy });
        }
      }
    } else {
      const Rext = s.hx / 2, Rint = s.tipo === 'Circular Vazada' ? (s.hx2 || s.hx * 0.6) / 2 : 0;
      const delta = Math.sqrt(p.Ac / nTotal);
      const nR = Math.max(6, Math.round((Rext - Rint) / delta));
      const dr = (Rext - Rint) / nR;
      for (let i = 0; i < nR; i++) {
        const r1 = Rint + i * dr, r2 = r1 + dr, rm = (r1 + r2) / 2;
        const nA = Math.max(8, Math.round(2 * Math.PI * rm / delta / 4) * 4);
        const dA = Math.PI * (r2 * r2 - r1 * r1) / nA;
        for (let j = 0; j < nA; j++) {
          const al = (j + 0.5) * 2 * Math.PI / nA;
          fibras.push({ x: rm * Math.cos(al), y: rm * Math.sin(al), dA, dx: dr, dy: dr });
        }
      }
    }
    this.fibrasConcreto = fibras;
    // arrays tipados para os laços críticos
    this._fx = Float64Array.from(fibras, f => f.x);
    this._fy = Float64Array.from(fibras, f => f.y);
    this._fa = Float64Array.from(fibras, f => f.dA);
    this._bx = Float64Array.from(this.barras, b => b.x);
    this._by = Float64Array.from(this.barras, b => b.y);
    this._ba = Float64Array.from(this.barras, b => b.area);
    return fibras;
  }

  // --- ARMADURA ---
  static areaBarra(fi_mm) { return Math.PI * Math.pow(fi_mm / 10, 2) / 4; }

  configurarArmacaoRapida(nx, ny, fi_mm, dLinha_cm) {
    this.atualizarPropriedadesGeometricas();
    const p = this.propriedadesGeometricas;
    const area = PCalcEngine.areaBarra(fi_mm);
    const barras = [];
    if (this.ehCircular) {
      const R = this.secao.hx / 2 - dLinha_cm;
      const n = Math.max(3, nx);
      for (let i = 0; i < n; i++) {
        const a = i * 2 * Math.PI / n;
        barras.push({ x: R * Math.cos(a), y: R * Math.sin(a), fi: fi_mm, area });
      }
    } else {
      const x0 = -p.xm + dLinha_cm, x1 = p.xm - dLinha_cm;
      const y0 = -p.ym + dLinha_cm, y1 = p.ym - dLinha_cm;
      const nX = Math.max(2, nx), nY = Math.max(2, ny);
      for (let i = 0; i < nX; i++) {
        const x = x0 + i * (x1 - x0) / (nX - 1);
        barras.push({ x, y: y0, fi: fi_mm, area });
        barras.push({ x, y: y1, fi: fi_mm, area });
      }
      for (let j = 1; j < nY - 1; j++) {
        const y = y0 + j * (y1 - y0) / (nY - 1);
        barras.push({ x: x0, y, fi: fi_mm, area });
        barras.push({ x: x1, y, fi: fi_mm, area });
      }
    }
    this.barras = barras;
    return barras;
  }

  limparArmaduras() {
    this.barras = [];
  }

  removerBarra(index) {
    if (index >= 0 && index < this.barras.length) {
      this.barras.splice(index, 1);
    }
  }

  /** Coordenadas "do usuário": retangulares com origem no canto inferior esquerdo; circulares no centro. */
  paraCentro(x, y) {
    if (this.ehCircular) return { x, y };
    this.atualizarPropriedadesGeometricas();
    return { x: x - this.propriedadesGeometricas.xm, y: y - this.propriedadesGeometricas.ym };
  }
  deCentro(x, y) {
    if (this.ehCircular) return { x, y };
    this.atualizarPropriedadesGeometricas();
    return { x: x + this.propriedadesGeometricas.xm, y: y + this.propriedadesGeometricas.ym };
  }
  adicionarBarra(xu, yu, fi, relativoCentro = false) {
    const c = relativoCentro ? { x: xu, y: yu } : this.paraCentro(xu, yu);
    this.barras.push({ x: c.x, y: c.y, fi, area: PCalcEngine.areaBarra(fi) });
    return true;
  }
  adicionarLinhaBarras(a1, a2, a3, a4, a5, a6) {
    let xi, yi, xf, yf, n, fi;
    if (typeof a5 === 'number' && typeof a6 === 'number' && a5 >= 1) {
      // (xi, yi, xf, yf, n, fi)
      xi = a1; yi = a2; xf = a3; yf = a4; n = a5; fi = a6;
    } else {
      // (n, fi, xi, yi, xf, yf)
      n = a1; fi = a2; xi = a3; yi = a4; xf = a5; yf = a6;
    }
    let count = 0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const x = xi + t * (xf - xi);
      const y = yi + t * (yf - yi);
      if (this.adicionarBarra(x, y, fi, false)) count++;
    }
    return count;
  }
  adicionarArcoBarras(a1, a2, a3, a4, a5) {
    let r, tetaI, tetaF, n, fi;
    if (typeof a4 === 'number' && typeof a5 === 'number') {
      // (r, tetaI, tetaF, n, fi)
      r = a1; tetaI = a2; tetaF = a3; n = a4; fi = a5;
    } else {
      // (n, fi, r, tetaI, tetaF)
      n = a1; fi = a2; r = a3; tetaI = a4; tetaF = a5;
    }
    let count = 0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const a = (tetaI + t * (tetaF - tetaI)) * Math.PI / 180;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      if (this.adicionarBarra(x, y, fi, true)) count++;
    }
    return count;
  }

  get areaAcoTotal() { return this.barras.reduce((a, b) => a + b.area, 0); }
  get taxaArmadura() {
    if (!this.propriedadesGeometricas.Ac) this.atualizarPropriedadesGeometricas();
    return this.areaAcoTotal / this.propriedadesGeometricas.Ac * 100;
  }

  /** Verifica se todas as barras estão dentro do concreto. */
  verificarBarras() {
    const s = this.secao;
    for (const b of this.barras) {
      const eps = 1e-6;
      if (s.tipo === 'Retangular') {
        if (Math.abs(b.x) >= s.hx / 2 - eps || Math.abs(b.y) >= s.hy / 2 - eps) return false;
      } else if (s.tipo === 'Retangular Vazada') {
        const hx2 = s.hx2 || s.hx * 0.6, hy2 = s.hy2 || s.hy * 0.6;
        if (Math.abs(b.x) >= s.hx / 2 - eps || Math.abs(b.y) >= s.hy / 2 - eps) return false;
        if (Math.abs(b.x) <= hx2 / 2 + eps && Math.abs(b.y) <= hy2 / 2 + eps) return false;
      } else {
        const r = Math.hypot(b.x, b.y);
        if (r >= s.hx / 2 - eps) return false;
        if (s.tipo === 'Circular Vazada' && r <= (s.hx2 || s.hx * 0.6) / 2 + eps) return false;
      }
    }
    return true;
  }

  // --- PLANO DE DEFORMAÇÕES / EQUILÍBRIO ---

  /** Esforços internos para o plano ε = e0 + a·y - c·x (‰ e ‰/cm). */
  _esfInternos(e0, a, c, fc, fs) {
    const fx = this._fx, fy = this._fy, fa = this._fa;
    let N = 0, Mx = 0, My = 0;
    for (let i = 0; i < fx.length; i++) {
      const e = e0 + a * fy[i] - c * fx[i];
      if (e >= 0) continue;
      const f = fc(e) * fa[i];
      N += f; Mx += f * fy[i]; My -= f * fx[i];
    }
    const bx = this._bx, by = this._by, ba = this._ba;
    for (let j = 0; j < bx.length; j++) {
      const e = e0 + a * by[j] - c * bx[j];
      const f = fs(e) * ba[j];
      N += f; Mx += f * by[j]; My -= f * bx[j];
    }
    return [N, Mx / 100, My / 100];
  }

  _nUniforme(e0, fc, fs) {
    let aTot = 0; for (let i = 0; i < this._fa.length; i++) aTot += this._fa[i];
    let N = fc(e0) * aTot;
    for (let j = 0; j < this._ba.length; j++) N += fs(e0) * this._ba[j];
    return N;
  }

  /** Limites de esforço normal resistente [Nmin (compressão), Nmax (tração)] */
  limitesNrd() {
    if (!this.fc85) this.prepararMateriais();
    const { ec2 } = this.parametrosConcreto;
    return [this._nUniforme(-ec2, this.fc85, this.fs85), this._nUniforme(10, this.fc85, this.fs85)];
  }

  /**
   * Resolve o plano de deformações para (nd, mx, my). modo: 'x' (só curvatura em x),
   * 'y' ou 'xy' (acoplado). Retorna {e0,a,c} ou null se não houver equilíbrio válido.
   */
  _resolverPlano(nd, mx, my, modo, fc, fs, guess = null) {
    const { ec2, ecu } = this.parametrosConcreto;
    const tolN = this.tolSomaN, tolM = this.tolSomaN / 100;
    const tentar = (fN, fMx, fMy, ini) => {
      const idx = modo === 'x' ? [0, 1] : modo === 'y' ? [0, 2] : [0, 1, 2];
      const m = idx.length;
      const alvo = [fN, fMx, fMy];
      const sel = modo === 'x' ? [0, 1] : modo === 'y' ? [0, 2] : [0, 1, 2];
      const res = (u) => {
        const r = this._esfInternos(u[0], u[1], u[2], fc, fs);
        return sel.map(k => r[k] - alvo[k]);
      };
      const peso = sel.map(k => k === 0 ? tolN : tolM);
      const nrm = (r) => r.reduce((s, v, i) => s + (v / peso[i]) ** 2, 0);
      let u = ini.slice();
      let r = res(u), n0 = nrm(r);
      const hs = [1e-5, 1e-6, 1e-6];
      for (let it = 0; it < 80; it++) {
        if (r.every((v, i) => Math.abs(v) < peso[i])) return u;
        // Jacobiano numérico
        const J = [];
        for (let i = 0; i < m; i++) J.push(new Array(m).fill(0));
        for (let jj = 0; jj < m; jj++) {
          const k = idx[jj];
          const up = u.slice(); up[k] += hs[k];
          const rp = res(up);
          for (let i = 0; i < m; i++) J[i][jj] = (rp[i] - r[i]) / hs[k];
        }
        // Levenberg leve para evitar singularidade
        for (let i = 0; i < m; i++) J[i][i] += 1e-9 + Math.abs(J[i][i]) * 1e-9;
        const d = this._resolverLinear(J, r.map(v => -v));
        if (!d) return null;
        let lam = 1, ok = false, un, rn, nn;
        for (let ls = 0; ls < 12; ls++) {
          un = u.slice();
          for (let jj = 0; jj < m; jj++) un[idx[jj]] += lam * d[jj];
          un[0] = Math.max(-40, Math.min(40, un[0]));
          rn = res(un); nn = nrm(rn);
          if (nn < n0) { ok = true; break; }
          lam /= 2;
        }
        if (!ok) return null;
        u = un; r = rn; n0 = nn;
      }
      return r.every((v, i) => Math.abs(v) < peso[i] * 5) ? u : null;
    };

    const iniciar = (fN) => {
      // e0 para compressão/tração pura por bissecção
      let lo = -ec2, hi = 10;
      const Nlo = this._nUniforme(lo, fc, fs), Nhi = this._nUniforme(hi, fc, fs);
      if (fN < Nlo - 1e-6 || fN > Nhi + 1e-6) return null;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (this._nUniforme(mid, fc, fs) < fN) lo = mid; else hi = mid;
      }
      return [(lo + hi) / 2, 0, 0];
    };

    let u = null;
    const ini0 = guess ? guess.slice() : iniciar(nd);
    if (!ini0) return null;
    u = tentar(nd, mx, my, ini0);
    if (!u && guess) { const i2 = iniciar(nd); if (i2) u = tentar(nd, mx, my, i2); }
    if (!u) { // continuação em passos de carga
      let cur = iniciar(nd);
      if (!cur) return null;
      for (let s = 1; s <= 10 && cur; s++) {
        const t = s / 10;
        cur = tentar(nd, mx * t, my * t, cur);
      }
      u = cur;
    }
    if (!u) return null;
    // verificação de limites de deformação
    let eMin = 1e9;
    for (let i = 0; i < this._fx.length; i++) {
      const e = u[0] + u[1] * this._fy[i] - u[2] * this._fx[i];
      if (e < eMin) eMin = e;
    }
    let eSMax = -1e9;
    for (let j = 0; j < this._bx.length; j++) {
      const e = u[0] + u[1] * this._by[j] - u[2] * this._bx[j];
      if (e > eSMax) eSMax = e;
    }
    if (eMin < -ecu * 1.002 || eSMax > 10.02) return null;
    return { e0: u[0], a: u[1], c: u[2] };
  }

  _resolverLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      if (Math.abs(M[p][i]) < 1e-14) return null;
      [M[i], M[p]] = [M[p], M[i]];
      for (let k = i + 1; k < n; k++) {
        const f = M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // --- CAPACIDADE RESISTENTE Mrd(θ) ---

  /** Momento resistente para linha neutra com direção θ sob Nd (esforços de cálculo). */
  calcularMrd(nd, teta) {
    if (!this.fc85) this.prepararMateriais();
    if (this._fx === undefined || this._fx.length === 0) this.discretizarSecao();
    const { ec2, ecu } = this.parametrosConcreto;
    const fc = this.fc85, fs = this.fs85;
    const ct = Math.cos(teta), st = Math.sin(teta);
    const nF = this._fx.length, nB = this._bx.length;
    const yF = new Float64Array(nF), yB = new Float64Array(nB);
    let yCMin = 1e11, yCMax = -1e11, yAsMax = -1e11;
    for (let i = 0; i < nF; i++) {
      yF[i] = -st * this._fx[i] + ct * this._fy[i];
      if (yF[i] < yCMin) yCMin = yF[i];
      if (yF[i] > yCMax) yCMax = yF[i];
    }
    for (let j = 0; j < nB; j++) {
      yB[j] = -st * this._bx[j] + ct * this._by[j];
      if (yB[j] > yAsMax) yAsMax = yB[j];
    }
    if (nB === 0) yAsMax = yCMax;
    const d = Math.max(1e-6, yAsMax - yCMin);
    const H = yCMax - yCMin;
    const limD = ecu / (ecu + 10);

    const plano = (xLn) => {
      let ec, fi;
      if (xLn / d < limD) { ec = -10 * xLn / (d - xLn); fi = -ec / xLn; }
      else if (xLn / H <= 1) { ec = -ecu; fi = -ec / xLn; }
      else { ec = -ec2 * xLn / (xLn - H * (ecu - ec2) / ecu); fi = -ec / xLn; }
      return { fi, ecg: ec - fi * yCMin };
    };
    const somaN = (xLn) => {
      const { fi, ecg } = plano(xLn);
      let N = 0;
      for (let i = 0; i < nF; i++) N += fc(ecg + yF[i] * fi) * this._fa[i];
      for (let j = 0; j < nB; j++) N += fs(ecg + yB[j] * fi) * this._ba[j];
      return N - nd;
    };
    // bracket: f decrescente em xLn
    let lo = -d, hi = 2 * d, flo = somaN(lo), fhi = somaN(hi), g = 0;
    while (flo <= 0 && g++ < 40) { hi = lo; fhi = flo; lo *= 2; flo = somaN(lo); }
    g = 0;
    while (fhi >= 0 && g++ < 40) { lo = hi; flo = fhi; hi *= 2; fhi = somaN(hi); }
    let xLn = (lo + hi) / 2;
    for (let it = 0; it < Math.max(60, this.tolIt); it++) {
      xLn = (lo * fhi - hi * flo) / (fhi - flo);
      if (!isFinite(xLn) || xLn <= lo || xLn >= hi) xLn = (lo + hi) / 2;
      const f = somaN(xLn);
      if (Math.abs(f) < this.tolSomaN * 0.2 || (hi - lo) < 1e-9) break;
      if (f < 0) { hi = xLn; fhi = f; } else { lo = xLn; flo = f; }
      if (it % 3 === 2) { // passo de bisseção para garantir convergência
        const mid = (lo + hi) / 2, fm = somaN(mid);
        if (fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
      }
    }
    const { fi, ecg } = plano(xLn);
    let mrx = 0, mry = 0;
    for (let i = 0; i < nF; i++) {
      const f = fc(ecg + yF[i] * fi) * this._fa[i];
      mrx += f * this._fy[i]; mry += f * this._fx[i];
    }
    for (let j = 0; j < nB; j++) {
      const f = fs(ecg + yB[j] * fi) * this._ba[j];
      mrx += f * this._by[j]; mry += f * this._bx[j];
    }
    return { mrx: mrx / 100, mry: -mry / 100, xLn, fiCurv: fi, ecg, teta, yCMin };
  }

  gerarCurvaMrd(nd) {
    const pontos = [];
    const n = this.nGraficoMr;
    for (let i = 0; i < n; i++) {
      const teta = i * 2 * Math.PI / n;
      const r = this.calcularMrd(nd, teta);
      pontos.push({ teta, mrx: r.mrx, mry: r.mry, xLn: r.xLn });
    }
    pontos.push({ ...pontos[0] });
    return pontos;
  }

  /** Diagrama N × Mx (eixo 'x') ou N × My ('y') para o gráfico de interação (FCN). */
  gerarCurvaNM(eixo) {
    if (!this.fc85) this.prepararMateriais();
    if (!this._fx || !this._fx.length) this.discretizarSecao();
    const [nMin, nMax] = this.limitesNrd();
    const tetas = eixo === 'x' ? [0, Math.PI] : [Math.PI / 2, 3 * Math.PI / 2];
    const nPts = Math.max(12, Math.round(this.nGraficoMr / 2));
    const lado = (teta) => {
      const arr = [{ m: eixo === 'x' ? this.calcularMrd(nMin + 1e-3, teta).mrx : this.calcularMrd(nMin + 1e-3, teta).mry, n: nMin }];
      for (let i = 1; i < nPts; i++) {
        const nd = nMin + i * (nMax - nMin) / nPts;
        const r = this.calcularMrd(nd, teta);
        arr.push({ m: eixo === 'x' ? r.mrx : r.mry, n: nd });
      }
      const rE = this.calcularMrd(nMax - 1e-3, teta);
      arr.push({ m: eixo === 'x' ? rE.mrx : rE.mry, n: nMax });
      return arr;
    };
    const A = lado(tetas[0]), B = lado(tetas[1]);
    // Para teta=0: mrx>0 ; para teta=π: mrx<0
    return A.concat(B.reverse());
  }

  // --- ESFORÇOS DE 1ª ORDEM ---

  alphaB(tipo, topo, base) {
    if (tipo === 1) {
      let ma = Math.max(Math.abs(topo), Math.abs(base));
      const mb = Math.min(Math.abs(topo), Math.abs(base));
      if (topo * -base < 0) ma = -ma;
      return ma !== 0 ? Math.min(1, Math.max(0.6 + 0.4 * mb / ma, 0.4)) : 1;
    }
    const ma = -base, mc = (topo - base) / 2;
    return ma !== 0 ? Math.min(1, Math.max(0.8 + 0.2 * mc / ma, 0.85)) : 1;
  }

  _limitarMb(t, b) {
    if (this.secao.tipoVinculacao === 1 && this.limMb && -b * t < 0) {
      if (Math.abs(b) < Math.abs(t)) {
        if (-Math.abs(b) < -0.5 * Math.abs(t)) b = 0.5 * t;
      } else if (-Math.abs(t) < -0.5 * Math.abs(b)) t = 0.5 * b;
    }
    return [t, b];
  }

  /** Diagrama de 1ª ordem. geral=true => 11 pontos; senão [base, intermediário, topo]. */
  momento1Ord(topo, base, geral) {
    const tipo = this.secao.tipoVinculacao, l = this.secao.l / 100;
    if (geral) {
      const n = 11, md = new Array(n);
      if (tipo === 1) {
        [topo, base] = this._limitarMb(topo, base);
        const ry = (base + topo) / l;
        for (let k = 0; k < n; k++) md[k] = -base + ry * (k * l / (n - 1));
      } else {
        for (let k = 0; k < n; k++) md[k] = topo + (-base - topo) * (l - k * l / (n - 1)) / l;
      }
      return md;
    }
    let mdI;
    if (tipo === 1) {
      const aB = this.alphaB(1, topo, base);
      mdI = Math.abs(topo) < Math.abs(base) ? -base * aB : topo * aB;
    } else {
      mdI = -base * this.alphaB(2, topo, base);
    }
    return [-base, mdI, topo];
  }

  // --- 2ª ORDEM: MÉTODOS SIMPLIFICADOS ---

  _nu(nsd) { return Math.abs(nsd / this.propriedadesGeometricas.Ac / this.fcd); }

  _p1(nsd, h, m1) {
    const le = this.propriedadesGeometricas.le / 100;
    const invR = Math.min(0.005 / h / (this._nu(nsd) + 0.5), 0.005 / h);
    return m1 - nsd * le * le / 10 * invR * Math.sign(m1);
  }
  _p2(nsd, h, m1) {
    const le = this.propriedadesGeometricas.le / 100;
    const m = Math.abs(m1);
    const a = 5 * h, b = -h * h * nsd + nsd * le * le / 320 - 5 * h * m, c = nsd * h * h * m;
    return (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / 2 / a * Math.sign(m1);
  }
  _p3(nsd, h, m1, eixo, lambda) {
    const ei = this._eiSec(nsd, eixo, m1);
    if (!ei) return null;
    const hh = h, Ac = this.propriedadesGeometricas.Ac / 10000;
    const kapa = ei / (Ac * hh * hh * this.fcd * 10000);
    return m1 / (1 - lambda * lambda / 120 / kapa * this._nu(nsd));
  }

  /** Rigidez secante EIsec (kN·m²) conforme diagrama N,M,1/r (ponto Mrd/γf3, material 1,1·fcd). */
  _eiSec(nd, eixo, sinalM) {
    const s = Math.sign(sinalM) || 1;
    const chave = `${nd.toFixed(3)}|${eixo}|${s}`;
    if (this._eiCache.has(chave)) return this._eiCache.get(chave);
    const g3 = this.gamaF3;
    let teta;
    if (eixo === 'x') teta = s > 0 ? 0 : Math.PI; else teta = s > 0 ? Math.PI / 2 : 3 * Math.PI / 2;
    const mr = this.calcularMrd(nd, teta);
    const mu = Math.abs(eixo === 'x' ? mr.mrx : mr.mry) / g3;
    const sol = this._resolverPlano(nd / g3, eixo === 'x' ? s * mu : 0, eixo === 'y' ? s * mu : 0, eixo, this.fc11, this.fs11);
    let ei = null;
    if (sol) {
      const curv = Math.abs(eixo === 'x' ? sol.a : sol.c) * 0.1; // 1/m
      if (curv > 1e-12) ei = mu / curv;
    }
    this._eiCache.set(chave, ei);
    return ei;
  }

  // --- 2ª ORDEM: MÉTODO GERAL (subdivisão em 11 seções) ---

  /**
   * modo: 'x' | 'y' (N,M,1/r por direção) ou 'xy' (acoplado N,Mx,My,1/r).
   * Retorna { mdX, mdY, erro, curvX, curvY } (momentos majorados por γf3 no fim).
   */
  _metodoGeral(nsd0, tX0, bX0, tY0, bY0, modo, calcX, calcY) {
    const g3 = this.gamaF3, n = 11, l = this.secao.l / 100, tipo = this.secao.tipoVinculacao;
    const nsd = nsd0 / g3;
    let [tX, bX] = this._limitarMb(tX0 / g3, bX0 / g3);
    let [tY, bY] = this._limitarMb(tY0 / g3, bY0 / g3);
    const nIt = 100;
    let dPX = new Array(n).fill(0), dPY = new Array(n).fill(0);
    let guesses = new Array(n).fill(null);
    const dz = l / (n - 1);
    let mdX = null, mdY = null, curvX = null, curvY = null, erro = null;
    for (let j = 0; ; j++) {
      const mX = new Array(n), mY = new Array(n), cX = new Array(n).fill(0), cY = new Array(n).fill(0);
      const i4X = new Array(n).fill(0), i5X = new Array(n).fill(0), i4Y = new Array(n).fill(0), i5Y = new Array(n).fill(0);
      for (let k = 0; k < n; k++) {
        const zk = k * dz;
        if (tipo === 1) {
          const rX = (bX + tX) / l, rY = (bY + tY) / l;
          mX[k] = (calcX ? -nsd * dPX[k] : 0) - bX + rX * zk;
          mY[k] = (calcY ? -nsd * dPY[k] : 0) - bY + rY * zk;
        } else {
          mX[k] = (calcX ? nsd * (dPX[n - 1] - dPX[k]) : 0) + tX + (-bX - tX) * (l - zk) / l;
          mY[k] = (calcY ? nsd * (dPY[n - 1] - dPY[k]) : 0) + tY + (-bY - tY) * (l - zk) / l;
        }
        const sol = this._resolverPlano(nsd, modo === 'y' ? 0 : mX[k], modo === 'x' ? 0 : mY[k], modo, this.fc11, this.fs11, guesses[k]);
        if (!sol) { erro = 'A determinação dos efeitos de 2ª ordem não convergiu (a seção não admite equilíbrio com o material reduzido).'; break; }
        guesses[k] = [sol.e0, sol.a, sol.c];
        cX[k] = modo === 'y' ? 0 : -0.1 * sol.a;
        cY[k] = modo === 'x' ? 0 : -0.1 * sol.c;
        if (k > 0) {
          i4X[k] = i4X[k - 1] + (cX[k] + cX[k - 1]) * dz / 2;
          i5X[k] = i5X[k - 1] + (i4X[k] + i4X[k - 1]) * dz / 2;
          i4Y[k] = i4Y[k - 1] + (cY[k] + cY[k - 1]) * dz / 2;
          i5Y[k] = i5Y[k - 1] + (i4Y[k] + i4Y[k - 1]) * dz / 2;
        }
      }
      if (erro) break;
      if (tipo === 1) {
        const aX = -i5X[n - 1], aY = -i5Y[n - 1];
        for (let k = 0; k < n; k++) {
          const zk = k * dz;
          i4X[k] += aX / l; i5X[k] += aX * zk / l;
          i4Y[k] += aY / l; i5Y[k] += aY * zk / l;
        }
      }
      let max1 = 0, max5 = 0;
      for (let k = 0; k < n; k++) {
        max1 = Math.max(max1, Math.abs(dPX[k]), Math.abs(dPY[k]));
        max5 = Math.max(max5, Math.abs(i5X[k]), Math.abs(i5Y[k]));
      }
      if (max5 === 0 || Math.abs(max5 - max1) / Math.abs(max5) < 1e-4) {
        mdX = mX; mdY = mY; curvX = cX; curvY = cY;
        break;
      }
      if (j >= nIt || max5 > l) {
        erro = 'A determinação dos efeitos de 2ª ordem não convergiu com o número máximo de iterações.';
        break;
      }
      dPX = i5X; dPY = i5Y;
    }
    if (erro) return { mdX: null, mdY: null, erro };
    return { mdX: mdX.map(v => v * g3), mdY: mdY.map(v => v * g3), erro: null, curvX, curvY };
  }

  // --- FATOR DE SEGURANÇA ---

  /** FS = |Mrd|/|Msd| na direção do momento solicitante, a partir da curva de interação. */
  fatorSeguranca(msx, msy, curva) {
    if (Math.abs(msx) < 1e-9 && Math.abs(msy) < 1e-9) return { fs: 1e10, mrdX: 0, mrdY: 0, msd: 0 };
    let melhor = Infinity, mx = 0, my = 0;
    for (let k = 0; k < curva.length - 1; k++) {
      const x1 = curva[k].mry, y1 = curva[k].mrx, x2 = curva[k + 1].mry, y2 = curva[k + 1].mrx;
      // raio (t*msy, t*msx) x segmento
      const den = msy * (y2 - y1) - msx * (x2 - x1);
      if (Math.abs(den) < 1e-12) continue;
      const t = (x1 * (y2 - y1) - y1 * (x2 - x1)) / den;
      const u = (x1 * msx - y1 * msy) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < melhor) { melhor = t; mx = t * msx; my = t * msy; }
    }
    const msd = Math.hypot(msx, msy);
    if (!isFinite(melhor)) return { fs: 0, mrdX: 0, mrdY: 0, msd };
    return { fs: Math.floor(melhor * 100) / 100, mrdX: mx, mrdY: my, msd };
  }

  // --- ANÁLISE DE UMA COMBINAÇÃO ---

  calcularCombinacao(comb, idx) {
    const s = this.secao, p = this.propriedadesGeometricas, g = this.gamaF;
    const hx = s.hx / 100, hy = this.dimY / 100;
    const tipo = s.tipoVinculacao, l = s.l / 100;
    const nsd = g * comb.nsd;
    const r = {
      combId: comb.id ?? idx + 1, nsd, erroNrd: null, erro2Ord: null, erro2OrdMmin: null,
      secoes: null, curvaMrd: null, mmin: null, fsMin: 0, secCritica: 0, seguranca: null,
      lambdaX: p.lambdaX, lambdaY: p.lambdaY
    };
    const [nMin, nMax] = this.limitesNrd();
    if (nsd < nMin || nsd > nMax) {
      const nrd = nsd < 0 ? Math.abs(nMin) : nMax;
      r.erroNrd = `A seção não resiste ao esforço normal solicitante (Nrd = ${nrd.toFixed(1)} kN < Nsd = ${Math.abs(nsd).toFixed(1)} kN).`;
      return r;
    }
    r.curvaMrd = this.gerarCurvaMrd(nsd);

    const topoX = g * comb.msxdTopo, baseX = g * comb.msxdBase;
    const topoY = g * comb.msydTopo, baseY = g * comb.msydBase;
    const geral = this.metodoSegOrd >= 4;
    let z, m1x, m1y, m2x, m2y;

    if (tipo === 0) {
      z = [0]; m1x = [topoX]; m1y = [topoY]; m2x = [topoX]; m2y = [topoY];
    } else {
      const n = geral ? 11 : 3;
      z = Array.from({ length: n }, (_, k) => k * l / (n - 1));
      m1x = this.momento1Ord(topoX, baseX, geral);
      m1y = this.momento1Ord(topoY, baseY, geral);
      m2x = m1x.slice(); m2y = m1y.slice();
      const precisa = (topo, base, h, lamb) => {
        if (nsd >= 0 || this.calcular2ord === 3) return false;
        if (this.calcular2ord === 1) return true;
        const aB = this.alphaB(tipo, topo, base);
        const e1 = Math.max(Math.abs(topo), Math.abs(base)) / Math.abs(nsd);
        const l1 = Math.round(Math.min(90, Math.max(35, (25 + 12.5 * e1 / h) / aB)));
        return lamb >= l1;
      };
      const pX = precisa(topoX, baseX, hy, p.lambdaX);
      const pY = precisa(topoY, baseY, hx, p.lambdaY);
      if (!geral) {
        const f = (ordem, h, m1, eixo, lamb) => {
          if (m1 === 0) return m1;
          if (this.metodoSegOrd === 1) return this._p1(nsd, h, m1);
          if (this.metodoSegOrd === 2) return this._p2(nsd, h, m1);
          return this._p3(nsd, h, m1, eixo, lamb);
        };
        if (pX) { const v = f(2, hy, m1x[1], 'x', p.lambdaX); if (v === null) r.erro2Ord = 'Falha ao obter a rigidez EIsec (eixo x).'; else m2x[1] = v; }
        if (pY) { const v = f(2, hx, m1y[1], 'y', p.lambdaY); if (v === null) r.erro2Ord = 'Falha ao obter a rigidez EIsec (eixo y).'; else m2y[1] = v; }
      } else if (this.metodoSegOrd === 4) {
        if (pX) { const q = this._metodoGeral(nsd, topoX, baseX, 0, 0, 'x', true, false); if (q.erro) r.erro2Ord = q.erro; else m2x = q.mdX; }
        if (pY && !r.erro2Ord) { const q = this._metodoGeral(nsd, 0, 0, topoY, baseY, 'y', false, true); if (q.erro) r.erro2Ord = q.erro; else m2y = q.mdY; }
      } else if (pX || pY) {
        const q = this._metodoGeral(nsd, topoX, baseX, topoY, baseY, 'xy', pX, pY);
        if (q.erro) r.erro2Ord = q.erro; else { m2x = q.mdX; m2y = q.mdY; }
      }
    }

    // Momento mínimo de 1ª ordem
    let mm = null;
    if (this.limMomentoMin && tipo !== undefined) {
      const msxMin = Math.abs(nsd * (0.015 + 0.03 * hy));
      const msyMin = Math.abs(nsd * (0.015 + 0.03 * hx));
      let sx = msxMin, sy = msyMin;
      if (tipo !== 0 && this.calcular2ord !== 3 && nsd < 0 && !r.erro2Ord) {
        const calc = (m, h, lamb, eixo) => {
          const e1 = Math.max(Math.abs(topoX), Math.abs(baseX)) / Math.abs(nsd);
          const l1 = Math.min(90, Math.max(35, (25 + 12.5 * (eixo === 'x' ? e1 : Math.max(Math.abs(topoY), Math.abs(baseY)) / Math.abs(nsd)) / h)));
          if (!(lamb > l1 || this.calcular2ord === 1)) return m;
          const met = this.metodoSegOrd;
          if (met === 1) return this._p1(nsd, h, m);
          if (met === 2) return this._p2(nsd, h, m);
          if (met === 3) { const v = this._p3(nsd, h, m, eixo, lamb); return v === null ? m : v; }
          if (met === 4 || met === 5) {
            const q = eixo === 'x'
              ? this._metodoGeral(nsd, m, -m, 0, 0, met === 4 ? 'x' : 'x', true, false)
              : this._metodoGeral(nsd, 0, 0, m, -m, 'y', false, true);
            if (q.erro) { r.erro2OrdMmin = q.erro; return m; }
            return Math.max(...(eixo === 'x' ? q.mdX : q.mdY).map(Math.abs));
          }
          return m;
        };
        sx = calc(msxMin, hy, p.lambdaX, 'x');
        sy = calc(msyMin, hx, p.lambdaY, 'y');
      }
      let fsMm = 1e10;
      for (let i = 0; i < 100; i++) {
        const ph = i * 2 * Math.PI / 100;
        const q = this.fatorSeguranca(sx * Math.cos(ph), sy * Math.sin(ph), r.curvaMrd);
        fsMm = Math.min(fsMm, q.fs);
      }
      mm = { msx: msxMin, msy: msyMin, msx2: sx, msy2: sy, fs: fsMm };
    }
    r.mmin = mm;

    // FS por seção
    const nrdCap = nsd < 0 ? Math.abs(nMin) : nMax;
    const fsAxial = Math.abs(nsd) > 1e-6 ? (nrdCap / Math.abs(nsd)) : 1e10;

    const secs = { z, m1x, m1y, m2x, m2y, fs: [], seg: [] };
    let fsMin = Infinity, crit = 0;
    for (let k = 0; k < z.length; k++) {
      let q;
      if (r.erro2Ord) {
        q = { fs: 0, mrdX: 0, mrdY: 0, msd: 0 };
      } else if (Math.abs(m2x[k]) < 1e-6 && Math.abs(m2y[k]) < 1e-6) {
        // Sem momento fletor: verificação axial direta |Nrd| / |Nsd|
        const fsNorm = Math.floor(fsAxial * 100) / 100;
        q = { fs: fsNorm, mrdX: 0, mrdY: 0, msd: 0, axialPuro: true };
      } else {
        q = this.fatorSeguranca(m2x[k], m2y[k], r.curvaMrd);
      }
      secs.fs.push(q.fs); secs.seg.push(q);
      if (q.fs < fsMin) { fsMin = q.fs; crit = k; }
    }
    r.secoes = secs;
    r.secCritica = crit;
    r.seguranca = secs.seg[crit];
    r.fsMin = fsMin;
    if (mm && mm.fs < r.fsMin) {
      r.fsMinMomentoMin = mm.fs;
      r.mminGoverna = true;
      r.fsComb = mm.fs;
    } else {
      r.mminGoverna = false;
      r.fsComb = fsMin;
    }
    return r;
  }

  /** Plano de deformações da seção k de uma combinação (material de cálculo 0,85·ηc·fcd). */
  planoSecao(res, k) {
    if (!res || !res.secoes || res.erro2Ord) return null;
    if (!this.fc85) this.prepararMateriais();
    const sol = this._resolverPlano(res.nsd, res.secoes.m2x[k], res.secoes.m2y[k], 'xy', this.fc85, this.fs85);
    return sol;
  }

  /**
   * Calcula as deformações (‰) e tensões (kN/cm²) em cada barra de armadura
   * para o plano de deformações da seção k.
   */
  calcularEstadoBarras(plano) {
    if (!plano) return [];
    const fyd = this.fyd; // kN/cm²
    const eyd = (this.fyk / this.gamaS) / (this.modEs || 210000.0) * 1000.0; // ‰
    return this.barras.map((b, i) => {
      const def = plano.e0 + plano.a * b.y - plano.c * b.x; // ‰
      let tensao;
      if (Math.abs(def) <= eyd) {
        tensao = def * (fyd / eyd); // kN/cm²
      } else {
        tensao = fyd * Math.sign(def); // kN/cm²
      }
      return {
        index: i + 1,
        x: b.x,
        y: b.y,
        fi: b.fi,
        area: b.area,
        deformacao: def, // ‰
        tensao: tensao,  // kN/cm²
        tensaoMpa: tensao * 10.0, // MPa
        escoando: Math.abs(def) >= eyd
      };
    });
  }

  /** Diagrama momento-curvatura (M × 1/r) para um semi-eixo. eixo 'x'|'y', sinal ±1. */
  diagramaMomentoCurvatura(nd, eixo, sinal, gamaF3 = 1.0, beta = 0.85) {
    if (!this.fc85) this.prepararMateriais();
    const fc = this.makeFc(beta), fs = this.makeFs(fc);
    const { ecu } = this.parametrosConcreto;
    const nd0 = nd / gamaF3;
    const pts = [];
    const nP = 60;
    // curvatura máxima aproximada
    let H = 0; const d = this.dimY;
    const kMax = (ecu + 10) / (eixo === 'x' ? d : this.secao.hx) * 1.2;
    for (let i = 0; i <= nP; i++) {
      const kk = kMax * i / nP * sinal;
      const f = (e0) => {
        const r = eixo === 'x' ? this._esfInternos(e0, kk, 0, fc, fs) : this._esfInternos(e0, 0, kk, fc, fs);
        return r;
      };
      let lo = -40, hi = 40;
      for (let t = 0; t < 60; t++) {
        const mid = (lo + hi) / 2;
        if (f(mid)[0] < nd0) lo = mid; else hi = mid;
      }
      const e0 = (lo + hi) / 2, r = f(e0);
      if (Math.abs(r[0] - nd0) > this.tolSomaN * 5) break;
      let eMin = 1e9, eSMax = -1e9;
      for (let i2 = 0; i2 < this._fx.length; i2++) {
        const e = eixo === 'x' ? e0 + kk * this._fy[i2] : e0 - kk * this._fx[i2];
        if (e < eMin) eMin = e;
      }
      for (let j = 0; j < this._bx.length; j++) {
        const e = eixo === 'x' ? e0 + kk * this._by[j] : e0 - kk * this._bx[j];
        if (e > eSMax) eSMax = e;
      }
      if (eMin < -ecu * 1.001 || eSMax > 10.01) break;
      pts.push({ curv: Math.abs(kk) * 0.1, m: Math.abs(eixo === 'x' ? r[1] : r[2]) });
    }
    return pts;
  }

  // --- ANÁLISE COMPLETA ---

  executarAnaliseCompleta() {
    this.prepararMateriais();
    this.discretizarSecao();
    const resultados = [];
    let fsMinGeral = Infinity, combCritica = 0;
    for (let i = 0; i < this.esforcos.length; i++) {
      const r = this.calcularCombinacao(this.esforcos[i], i);
      let fs = r.erroNrd || r.erro2Ord ? 0 : r.fsMin;
      if (r.mmin && r.mmin.fs < fs) fs = r.mmin.fs;
      r.fsComb = fs;
      if (fs < fsMinGeral) { fsMinGeral = fs; combCritica = i; }
      resultados.push(r);
    }
    return {
      propriedades: this.propriedadesGeometricas,
      resultados, fsMinGeral: isFinite(fsMinGeral) ? fsMinGeral : 0, combCritica,
      seguro: fsMinGeral >= 1.0
    };
  }

  calcular() {
    return this.executarAnaliseCompleta();
  }
}

if (typeof window !== 'undefined') {
  window.PCalcEngine = PCalcEngine;
  window.parametrosConcretoNBR = parametrosConcretoNBR;
}


  // ==========================================
  // PARTE 2: RENDERIZADOR GRÁFICO (renderer.js)
  // ==========================================
  /**
 * PCalc Web Renderer - Módulo de Visualização Gráfica do PCalc
 * Renderiza com precisão:
 * 1. Seção Transversal (concreto, barras numeradas com diâmetro, cotas, eixos e Linha Neutra)
 * 2. Diagrama de Interação FCO (Mx × My) com curva Mrd e ponto solicitante Msd
 * 3. Diagramas de Interação FCN (N × Mx e N × My)
 * 4. Perfil de Deformações (ε) na subdivisão z selecionada do pilar
 * 5. Perfil de Tensões (σ) na subdivisão z selecionada do pilar
 * 6. Diagramas ao longo do Pilar (DesenhaEsforcos: esquemático do pilar, Nsd, Msd,x e Msd,y com 1ª e 2ª ordem)
 * 7. Gráfico da Lei Constitutiva do Concreto NBR 6118 (Fig. 8.2) para o diálogo de materiais
 */


class PCalcRenderer {
  constructor() {
    this.theme = {
      bg: '#181818',
      cardBg: '#252526',
      grid: 'rgba(255, 255, 255, 0.08)',
      axis: 'rgba(255, 255, 255, 0.35)',
      text: '#cccccc',
      textBright: '#f1f1f1',
      concreteFill: '#2d2d30',
      concreteStroke: '#555555',
      neutralAxis: '#ef4444',
      rebarFill: '#007acc',
      rebarStroke: '#0098ff',
      curveStroke: '#4ec9b0',
      curveFill: 'rgba(78, 201, 176, 0.12)',
      curveUnsafe: '#f14c4c',
      solicitationPoint: '#cca700',
      safePoint: '#4ec9b0',
      dangerPoint: '#f14c4c',
      m1Color: '#3794ff',
      m2Fill: 'rgba(241, 76, 76, 0.35)',
      m2Stroke: '#f14c4c'
    };
    this.modoEscalaBege = true; // Habilita escala numérica idêntica ao PCalc 1.4 original
    this.activeDiagramRebars = [];
    this.secaoRebars = [];
  }

  desenharTooltipBarra(ctx, b, width, height, tipo = 'geral') {
    if (!b) return;
    ctx.save();
    const lines = [
      `● Barra #${b.index} (Ø ${b.fi.toFixed(1)} mm)`,
      `Posição: x = ${b.coordX >= 0 ? '+' : ''}${b.coordX.toFixed(1)} cm, y = ${b.coordY >= 0 ? '+' : ''}${b.coordY.toFixed(1)} cm`
    ];
    if (b.es !== undefined && b.es !== null && !isNaN(b.es)) {
      const modo = b.es >= 0 ? 'Tração' : 'Compressão';
      lines.push(`Deformação: εs = ${b.es >= 0 ? '+' : ''}${b.es.toFixed(2)} ‰ (${modo})`);
    }
    if (b.sigmas !== undefined && b.sigmas !== null && !isNaN(b.sigmas)) {
      const estadoEsc = b.escoando ? 'Escoamento Plástico' : 'Regime Elástico';
      const mpaVal = (b.tensaoMpa !== undefined && !isNaN(b.tensaoMpa)) ? b.tensaoMpa : (b.sigmas * 10);
      lines.push(`Tensão: fsd = ${b.sigmas.toFixed(2)} kN/cm² (${mpaVal.toFixed(0)} MPa)`);
      lines.push(`Estado: ${estadoEsc}`);
    }

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    let maxW = 0;
    lines.forEach(l => {
      const w = ctx.measureText(l).width;
      if (w > maxW) maxW = w;
    });

    const boxW = maxW + 20;
    const boxH = lines.length * 16 + 12;

    let tipX = b.x + 14;
    let tipY = b.y - boxH / 2;

    if (tipX + boxW > width - 10) tipX = b.x - boxW - 14;
    if (tipX < 10) tipX = 10;
    if (tipY < 10) tipY = 10;
    if (tipY + boxH > height - 10) tipY = height - boxH - 10;

    // Card flutuante estilo PCalc
    ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
    ctx.strokeStyle = '#007acc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    try {
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(tipX, tipY, boxW, boxH, 6);
      } else {
        ctx.rect(tipX, tipY, boxW, boxH);
      }
    } catch (e) {
      ctx.rect(tipX, tipY, boxW, boxH);
    }
    ctx.fill();
    ctx.stroke();

    lines.forEach((l, idx) => {
      if (idx === 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px "Inter", sans-serif';
      } else if (l.includes('Escoamento')) {
        ctx.fillStyle = '#f43f5e';
        ctx.font = '10.5px "JetBrains Mono", monospace';
      } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px "JetBrains Mono", monospace';
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(l, tipX + 10, tipY + 8 + idx * 16);
    });
    ctx.restore();
  }

  setupCanvas(canvas) {
    if (!canvas) return { ctx: null, width: 400, height: 300, dpr: 1 };
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || (canvas.width / dpr);
    const height = canvas.clientHeight || (canvas.height / dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { ctx, width, height, dpr };
  }

  /**
   * Calcula um passo de escala human-readable (1, 2, 5 * 10^k)
   * idêntico ao gerador de TickUnits do JFreeChart (PCalc original).
   */
  calcularPassoEscala(range, maxTicks = 6) {
    if (range <= 0 || !isFinite(range)) return 1;
    const roughStep = range / maxTicks;
    const exponent = Math.floor(Math.log10(roughStep));
    const fraction = roughStep / Math.pow(10, exponent);
    let niceFraction;
    if (fraction <= 1.25) niceFraction = 1;
    else if (fraction <= 2.8) niceFraction = 2;
    else if (fraction <= 6.5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * Math.pow(10, exponent);
  }

  /**
   * Desenha a moldura retangular com escala numérica, traços de ticks externos
   * e linhas tracejadas internas idênticas ao PCalc 1.4 original.
   */
  desenharGradeEEscala(ctx, plotX, plotY, plotW, plotH, toX, toY, fromX, fromY, unitX = 'X (cm)', unitY = 'Y (cm)', opcoes = {}) {
    const estiloBege = (opcoes.estiloBege !== undefined ? opcoes.estiloBege : (this.modoEscalaBege !== false));

    const theme = estiloBege ? {
      plotBg: '#FBF7E6',                  // Bege original do PCalc 1.4 (JFreeChart)
      border: '#333333',                  // Moldura escura do gráfico
      gridDash: 'rgba(90, 80, 70, 0.45)', // Tracejado suave da grade interna
      axisZero: 'rgba(50, 50, 50, 0.70)', // Linha do zero (x=0, y=0)
      tick: '#333333',                    // Traços de escala (ticks externos)
      label: '#1c1c1c',                   // Numerais da escala (-4, -2, 0, 2, 4...)
      axisLabel: '#111111'                // Títulos dos eixos
    } : {
      plotBg: '#1f1f23',                  // Cinza escuro moderno
      border: '#55555a',
      gridDash: 'rgba(255, 255, 255, 0.15)',
      axisZero: 'rgba(255, 255, 255, 0.45)',
      tick: '#888888',
      label: '#e2e8f0',
      axisLabel: '#f1f1f1'
    };

    // 0. Preenchimento de toda a área externa do canvas (margem da escala)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = estiloBege ? '#EDEDED' : '#181818';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    // 1. Preenchimento do fundo interno da moldura
    ctx.fillStyle = theme.plotBg;
    ctx.fillRect(plotX, plotY, plotW, plotH);

    // 2. Limites em coordenadas reais
    const xMin = fromX(plotX);
    const xMax = fromX(plotX + plotW);
    const yMin = fromY(plotY + plotH);
    const yMax = fromY(plotY);
    const rangeX = Math.abs(xMax - xMin);
    const rangeY = Math.abs(yMax - yMin);

    const isometria = opcoes.isometria !== false;
    let stepX, stepY;
    if (isometria) {
      const step = this.calcularPassoEscala(Math.max(rangeX, rangeY), Math.max(4, Math.floor(Math.min(plotW, plotH) / 60)));
      stepX = step;
      stepY = step;
    } else {
      stepX = this.calcularPassoEscala(rangeX, Math.max(4, Math.floor(plotW / 65)));
      stepY = this.calcularPassoEscala(rangeY, Math.max(4, Math.floor(plotH / 50)));
    }

    // 3. Traçar linhas tracejadas internas (com clipping no interior do quadro)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.gridDash;
    ctx.setLineDash([2, 3]);

    const firstX = Math.ceil(Math.min(xMin, xMax) / stepX) * stepX;
    const lastX = Math.floor(Math.max(xMin, xMax) / stepX) * stepX;
    for (let x = firstX; x <= lastX + stepX * 0.01; x += stepX) {
      const px = Math.round(toX(x)) + 0.5;
      if (px >= plotX && px <= plotX + plotW) {
        ctx.beginPath();
        ctx.moveTo(px, plotY);
        ctx.lineTo(px, plotY + plotH);
        ctx.stroke();
      }
    }

    const firstY = Math.ceil(Math.min(yMin, yMax) / stepY) * stepY;
    const lastY = Math.floor(Math.max(yMin, yMax) / stepY) * stepY;
    for (let y = firstY; y <= lastY + stepY * 0.01; y += stepY) {
      const py = Math.round(toY(y)) + 0.5;
      if (py >= plotY && py <= plotY + plotH) {
        ctx.beginPath();
        ctx.moveTo(plotX, py);
        ctx.lineTo(plotX + plotW, py);
        ctx.stroke();
      }
    }

    // Eixos X=0 e Y=0
    ctx.setLineDash([]);
    ctx.strokeStyle = theme.axisZero;
    ctx.lineWidth = 1.2;

    const minXVal = Math.min(xMin, xMax);
    const maxXVal = Math.max(xMin, xMax);
    if (minXVal <= 0 && maxXVal >= 0) {
      const px0 = Math.round(toX(0)) + 0.5;
      if (px0 >= plotX && px0 <= plotX + plotW) {
        ctx.beginPath();
        ctx.moveTo(px0, plotY);
        ctx.lineTo(px0, plotY + plotH);
        ctx.stroke();
      }
    }

    const minYVal = Math.min(yMin, yMax);
    const maxYVal = Math.max(yMin, yMax);
    if (minYVal <= 0 && maxYVal >= 0) {
      const py0 = Math.round(toY(0)) + 0.5;
      if (py0 >= plotY && py0 <= plotY + plotH) {
        ctx.beginPath();
        ctx.moveTo(plotX, py0);
        ctx.lineTo(plotX + plotW, py0);
        ctx.stroke();
      }
    }

    ctx.restore();

    // 4. Borda retangular do gráfico
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // 5. Numerais da escala e traços de ticks externos
    ctx.font = '11px Tahoma, "Segoe UI", Arial, sans-serif';
    ctx.strokeStyle = theme.tick;
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.label;

    const formatTick = (val) => {
      if (Math.abs(val) < 1e-9) return '0';
      if (Math.abs(val) >= 10000 || (Math.abs(val) < 0.01 && Math.abs(val) > 0)) {
        return val.toExponential(1);
      }
      return Number.isInteger(Number(val.toFixed(4))) ? Math.round(val).toString() : val.toFixed(1);
    };

    // Eixo Y (esquerda)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = firstY; y <= lastY + stepY * 0.01; y += stepY) {
      const py = Math.round(toY(y));
      if (py >= plotY - 1 && py <= plotY + plotH + 1) {
        // Traço de escala de 4px saindo para fora
        ctx.beginPath();
        ctx.moveTo(plotX - 4, py);
        ctx.lineTo(plotX, py);
        ctx.stroke();

        ctx.fillText(formatTick(y), plotX - 7, py);
      }
    }

    // Eixo X (inferior)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = firstX; x <= lastX + stepX * 0.01; x += stepX) {
      const px = Math.round(toX(x));
      if (px >= plotX - 1 && px <= plotX + plotW + 1) {
        // Traço de escala de 4px descendo para fora
        ctx.beginPath();
        ctx.moveTo(px, plotY + plotH);
        ctx.lineTo(px, plotY + plotH + 4);
        ctx.stroke();

        ctx.fillText(formatTick(x), px, plotY + plotH + 6);
      }
    }

    // 6. Títulos dos eixos
    ctx.fillStyle = theme.axisLabel;
    ctx.font = 'bold 11px Tahoma, "Segoe UI", Arial, sans-serif';

    // Rótulo X
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${unitX}`, plotX + plotW, plotY + plotH + 20);

    // Rótulo Y
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${unitY}`, plotX + 4, plotY - 5);
  }

  // =========================================================================
  // 1. SEÇÃO TRANSVERSAL
  // =========================================================================
  renderizarSecao(canvas, engine, combRes = null, opcoes = {}, transform = { zoom: 1, panX: 0, panY: 0 }, hoveredBarra = null) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);

    this.secaoRebars = [];
    if (!hoveredBarra && opcoes && opcoes.hoveredBarra) {
      hoveredBarra = opcoes.hoveredBarra;
    }

    const s = engine.secao;
    const p = engine.propriedadesGeometricas;
    const barras = engine.barras;

    const marginLeft = 48;
    const marginRight = 26;
    const marginTop = 22;
    const marginBottom = 36;

    const availW = Math.max(50, width - marginLeft - marginRight);
    const availH = Math.max(50, height - marginTop - marginBottom);
    const side = Math.min(availW, availH);

    const plotX = marginLeft + Math.round((availW - side) / 2);
    const plotY = marginTop + Math.round((availH - side) / 2);
    const plotW = side;
    const plotH = side;

    const dimY = engine.dimY || s.hy || s.hx;
    const maxDim = Math.max(s.hx, dimY);
    const zoom = transform.zoom || 1.0;
    const panX = transform.panX || 0;
    const panY = transform.panY || 0;

    // Escala isométrica com folga (~45%)
    const escala = Math.min(plotW / (maxDim * 1.45), plotH / (maxDim * 1.45)) * zoom;

    const cx = plotX + plotW / 2 + panX;
    const cy = plotY + plotH / 2 + panY;

    const toX = (x) => cx + x * escala;
    const toY = (y) => cy - y * escala;
    const fromX = (px) => (px - cx) / escala;
    const fromY = (py) => (cy - py) / escala;

    const estiloBege = (opcoes.estiloBege !== undefined ? opcoes.estiloBege : (this.modoEscalaBege !== false));

    // 1. Moldura e escala numérica (PCalc 1.4 original)
    this.desenharGradeEEscala(ctx, plotX, plotY, plotW, plotH, toX, toY, fromX, fromY, 'X (cm)', 'Y (cm)', {
      estiloBege,
      isometria: true
    });

    // 2. Traçado dos elementos geométricos da seção com clipping interno
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    // Fibras de concreto (se ativado)
    if (opcoes.mostrarFibras && engine.fibrasConcreto && engine.fibrasConcreto.length > 0) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 0.5;
      for (const f of engine.fibrasConcreto) {
        const fx = toX(f.x - f.dx / 2);
        const fy = toY(f.y + f.dy / 2);
        ctx.fillRect(fx, fy, f.dx * escala, f.dy * escala);
        ctx.strokeRect(fx, fy, f.dx * escala, f.dy * escala);
      }
    }

    // Contorno da seção
    ctx.save();
    ctx.fillStyle = estiloBege ? '#D4D0C5' : this.theme.concreteFill;
    ctx.strokeStyle = estiloBege ? '#262626' : this.theme.concreteStroke;
    ctx.lineWidth = 2.2;

    if (s.tipo === 'Retangular') {
      const rx = toX(-s.hx / 2);
      const ry = toY(s.hy / 2);
      ctx.beginPath();
      ctx.rect(rx, ry, s.hx * escala, s.hy * escala);
      ctx.fill();
      ctx.stroke();
    } else if (s.tipo === 'Circular') {
      ctx.beginPath();
      ctx.arc(cx, cy, (s.hx / 2) * escala, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    } else if (s.tipo === 'Retangular Vazada') {
      const hx2 = s.hx2 || s.hx * 0.6;
      const hy2 = s.hy2 || s.hy * 0.6;
      ctx.beginPath();
      ctx.rect(toX(-s.hx / 2), toY(s.hy / 2), s.hx * escala, s.hy * escala);
      ctx.rect(toX(hx2 / 2), toY(-hy2 / 2), -hx2 * escala, -hy2 * escala);
      ctx.fill('evenodd');
      ctx.stroke();
    } else if (s.tipo === 'Circular Vazada') {
      const re = (s.hx / 2) * escala;
      const ri = ((s.hx2 || s.hx * 0.6) / 2) * escala;
      ctx.beginPath();
      ctx.arc(cx, cy, re, 0, 2 * Math.PI, false);
      ctx.arc(cx, cy, ri, 0, 2 * Math.PI, true);
      ctx.fill('evenodd');
      ctx.stroke();
    }
    ctx.restore();

    // Linha Neutra (LN)
    // Se foi selecionada uma seção k, podemos traçar a LN daquela seção; senão a crítica
    if (combRes) {
      const secK = opcoes.secIndex !== null && opcoes.secIndex !== undefined ? opcoes.secIndex : (combRes.secCritica || 0);
      const plano = engine.planoSecao(combRes, secK);
      const msdX_sec = (combRes.secoes && combRes.secoes.m2x) ? combRes.secoes.m2x[secK] : 0;
      const msdY_sec = (combRes.secoes && combRes.secoes.m2y) ? combRes.secoes.m2y[secK] : 0;
      const msdTotal = Math.hypot(msdX_sec, msdY_sec);

      if (plano) {
        const curv = Math.hypot(plano.a, plano.c);
        if (curv > 1e-6) {
          // ε(x, y) = e0 + a·y - c·x = 0  =>  a·y - c·x + e0 = 0
          // Reta: -c·x + a·y + e0 = 0
          ctx.save();
          ctx.strokeStyle = this.theme.neutralAxis;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);

          const a = plano.a, c = -plano.c, d = plano.e0; // c·x + a·y + d = 0
          const norm = Math.hypot(c, a);
          const nx = c / norm, ny = a / norm;
          const dist = -d / norm; // distância da origem
          const px = toX(nx * dist);
          const py = toY(ny * dist);
          const L = maxDim * escala * 2;
          const vx = -ny * L, vy = nx * L;

          ctx.beginPath();
          ctx.moveTo(px - vx, py + vy);
          ctx.lineTo(px + vx, py - vy);
          ctx.stroke();

          ctx.fillStyle = this.theme.neutralAxis;
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          const zVal = (combRes.secoes && combRes.secoes.z && combRes.secoes.z[secK] !== undefined)
            ? combRes.secoes.z[secK].toFixed(2)
            : '0.00';
          ctx.fillText(`LN (z = ${zVal}m)`, px + 8, py - 8);
          ctx.restore();
        } else {
          // Curvatura nula: compressão ou tração centrada pura
          // A LN está no infinito (não intersecta a seção transversal)
          ctx.save();
          const estiloBege = (this.modoEscalaBege !== false);
          ctx.fillStyle = estiloBege ? '#166534' : '#4ade80';
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          const estadoNome = plano.e0 < 0 ? 'Compressão Centrada (LN no ∞)' : (plano.e0 > 0 ? 'Tração Centrada (LN no ∞)' : 'Esforço Nulo');
          ctx.fillText(`${estadoNome} · ε = ${plano.e0.toFixed(2)} ‰`, plotX + plotW - 10, plotY + 18);
          ctx.restore();
        }
      } else if (msdTotal > 0.1 && combRes.curvaMrd && combRes.curvaMrd.length > 0 && combRes.seguranca && combRes.seguranca.mrdX !== undefined) {
        // Fallback apenas quando NÃO há plano e há momento relevante
        const mrdP = combRes.curvaMrd.reduce((melhor, pt) => {
          const d2 = Math.hypot(pt.mrx - combRes.seguranca.mrdX, pt.mry - combRes.seguranca.mrdY);
          return d2 < melhor.d ? { pt, d: d2 } : melhor;
        }, { pt: combRes.curvaMrd[0], d: 1e9 }).pt;
        if (mrdP && mrdP.xLn !== undefined) {
          ctx.save();
          ctx.strokeStyle = this.theme.neutralAxis;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          const t = mrdP.teta;
          const px = toX(Math.cos(t) * mrdP.xLn);
          const py = toY(Math.sin(t) * mrdP.xLn);
          const L = maxDim * escala * 2;
          const vx = -Math.sin(t) * L, vy = Math.cos(t) * L;
          ctx.beginPath();
          ctx.moveTo(px - vx, py + vy);
          ctx.lineTo(px + vx, py - vy);
          ctx.stroke();
          ctx.fillStyle = this.theme.neutralAxis;
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillText(`LN (x = ${mrdP.xLn.toFixed(1)} cm)`, px + 8, py - 8);
          ctx.restore();
        }
      }
    }

    // Barras de Armadura
    const secK = opcoes.secIndex !== null && opcoes.secIndex !== undefined ? opcoes.secIndex : (combRes ? combRes.secCritica : 0);
    const planoSec = combRes ? engine.planoSecao(combRes, secK) : null;
    const estadoBarras = planoSec ? engine.calcularEstadoBarras(planoSec) : [];

    for (let i = 0; i < barras.length; i++) {
      const b = barras[i];
      const eb = estadoBarras[i] || {};
      const bx = toX(b.x);
      const by = toY(b.y);
      const raio = Math.max(3.5, (b.fi / 20) * escala * 1.1);

      this.secaoRebars.push({
        index: i + 1,
        x: bx,
        y: by,
        raio: raio,
        fi: b.fi,
        coordX: b.x,
        coordY: b.y,
        es: eb.deformacao,
        sigmas: eb.tensao,
        tensaoMpa: eb.tensaoMpa,
        escoando: eb.escoando
      });

      const grad = ctx.createRadialGradient(bx - raio * 0.3, by - raio * 0.3, 1, bx, by, raio);
      grad.addColorStop(0, '#bae6fd');
      grad.addColorStop(0.7, '#0284c7');
      grad.addColorStop(1, '#0369a1');

      ctx.beginPath();
      ctx.arc(bx, by, raio, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (hoveredBarra && hoveredBarra.index === (i + 1)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, raio + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      // Número da barra se houver menos de 30 barras
      if (barras.length <= 32) {
        ctx.fillStyle = '#f8fafc';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${i + 1}`, bx, by);
      }
    }

    // Cotas de Dimensão
    ctx.fillStyle = estiloBege ? '#1f1f1f' : this.theme.textBright;
    ctx.font = '11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (s.tipo === 'Circular' || s.tipo === 'Circular Vazada') {
      const cotaY = cy + (s.hx / 2) * escala + 24;
      ctx.fillText(`Ø ${s.hx} cm`, cx, cotaY);
    } else {
      // Largura hx
      const cotaY = cy + (dimY / 2) * escala + 25;
      ctx.fillText(`hx = ${s.hx} cm`, cx, cotaY);
      ctx.strokeStyle = estiloBege ? '#555555' : this.theme.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - (s.hx / 2) * escala, cotaY - 12);
      ctx.lineTo(cx + (s.hx / 2) * escala, cotaY - 12);
      ctx.stroke();

      // Altura hy
      const cotaX = cx - (s.hx / 2) * escala - 24;
      ctx.save();
      ctx.translate(cotaX, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`hy = ${dimY} cm`, 0, 0);
      ctx.restore();
    }

    ctx.restore(); // Fecha o clipping interno da moldura do gráfico

    // 3. Tooltip da barra (fora do clipping para não ser cortado na borda)
    if (hoveredBarra) {
      const barAtual = (this.secaoRebars && this.secaoRebars.find(b => b.index === hoveredBarra.index)) || hoveredBarra;
      this.desenharTooltipBarra(ctx, barAtual, width, height, 'secao');
    }
  }

  // =========================================================================
  // 2. DIAGRAMA FCO (Mx × My)
  // =========================================================================
  renderizarDiagramaFCO(canvas, curvaMrd, msdX = 0, msdY = 0, seguranca = null, transform = { zoom: 1, panX: 0, panY: 0 }) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);

    if (!curvaMrd || curvaMrd.length === 0) return;

    let maxM = 10;
    for (const p of curvaMrd) {
      if (Math.abs(p.mrx) > maxM) maxM = Math.abs(p.mrx);
      if (Math.abs(p.mry) > maxM) maxM = Math.abs(p.mry);
    }
    if (Math.abs(msdX) > maxM) maxM = Math.abs(msdX);
    if (Math.abs(msdY) > maxM) maxM = Math.abs(msdY);
    maxM *= 1.25;

    const zoom = transform.zoom || 1.0;
    const panX = transform.panX || 0;
    const panY = transform.panY || 0;

    const marginLeft = 56;
    const marginRight = 26;
    const marginTop = 22;
    const marginBottom = 36;

    const availW = Math.max(50, width - marginLeft - marginRight);
    const availH = Math.max(50, height - marginTop - marginBottom);
    const side = Math.min(availW, availH);

    const plotX = marginLeft + Math.round((availW - side) / 2);
    const plotY = marginTop + Math.round((availH - side) / 2);
    const plotW = side;
    const plotH = side;

    const escala = ((side / 2) / maxM) * zoom;
    const cx = plotX + plotW / 2 + panX;
    const cy = plotY + plotH / 2 + panY;

    const toX = (my) => cx + my * escala;
    const toY = (mx) => cy - mx * escala;
    const fromX = (px) => (px - cx) / escala;
    const fromY = (py) => (cy - py) / escala;

    const estiloBege = (this.modoEscalaBege !== false);

    // 1. Moldura e escala numérica (PCalc 1.4 original)
    this.desenharGradeEEscala(ctx, plotX, plotY, plotW, plotH, toX, toY, fromX, fromY, 'Msd,y / Mrd,y (kN·m)', 'Msd,x / Mrd,x (kN·m)', {
      estiloBege,
      isometria: true
    });

    // 2. Traçado dos elementos do gráfico com clipping interno
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    // Círculos concêntricos de referência
    ctx.strokeStyle = estiloBege ? 'rgba(70, 70, 70, 0.22)' : this.theme.grid;
    ctx.lineWidth = 1;
    const step = Math.pow(10, Math.floor(Math.log10(maxM))) * (maxM / Math.pow(10, Math.floor(Math.log10(maxM))) > 5 ? 2 : 1);
    for (let rM = step; rM <= maxM; rM += step) {
      const rPx = rM * escala;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = estiloBege ? '#444444' : this.theme.text;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`${rM.toFixed(0)} kN·m`, cx + rPx + 4, cy - 4);
    }

    // Curva Mrd
    ctx.beginPath();
    for (let i = 0; i < curvaMrd.length; i++) {
      const p = curvaMrd[i];
      const px = toX(p.mry);
      const py = toY(p.mrx);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const isSeguro = seguranca ? seguranca.fs >= 1.0 : true;
    ctx.fillStyle = isSeguro ? (estiloBege ? 'rgba(16, 185, 129, 0.20)' : this.theme.curveFill) : 'rgba(239, 68, 68, 0.15)';
    ctx.fill();
    ctx.strokeStyle = isSeguro ? (estiloBege ? '#059669' : this.theme.curveStroke) : this.theme.curveUnsafe;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Ponto solicitante Msd
    if (Math.hypot(msdX, msdY) > 0.01) {
      const ptX = toX(msdY);
      const ptY = toY(msdX);

      // Linha do centro ao ponto solicitante
      ctx.strokeStyle = isSeguro ? '#10b981' : '#f43f5e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(ptX, ptY);
      ctx.stroke();

      // Ponto Mrd na mesma direção
      if (seguranca && seguranca.mrdX !== undefined) {
        const mrdX = toX(seguranca.mrdY);
        const mrdY = toY(seguranca.mrdX);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = estiloBege ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.moveTo(ptX, ptY); ctx.lineTo(mrdX, mrdY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(mrdX, mrdY, 4, 0, 2 * Math.PI);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(ptX, ptY, 7, 0, 2 * Math.PI);
      ctx.fillStyle = isSeguro ? this.theme.safePoint : this.theme.dangerPoint;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = estiloBege ? '#111111' : '#ffffff';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      const labelFS = seguranca ? `FS = ${seguranca.fs.toFixed(2)}` : 'Msd';
      ctx.fillText(labelFS, ptX + 10, ptY - 8);
    }

    ctx.restore(); // Fecha o clipping interno
  }

  // =========================================================================
  // 3. DIAGRAMAS FCN (N × Mx ou N × My)
  // =========================================================================
  renderizarDiagramaFCN(canvas, engine, combRes, eixo = 'x', transform = { zoom: 1, panX: 0, panY: 0 }) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);

    const curva = engine.gerarCurvaNM(eixo);
    if (!curva || curva.length === 0) return;

    let maxM = 5, minN = 0, maxN = 0;
    for (const p of curva) {
      if (Math.abs(p.m) > maxM) maxM = Math.abs(p.m);
      if (p.n < minN) minN = p.n;
      if (p.n > maxN) maxN = p.n;
    }
    if (combRes) {
      if (Math.abs(combRes.nsd) > Math.abs(minN)) minN = combRes.nsd;
    }
    maxM *= 1.25;
    const folgaN = Math.max(Math.abs(minN), Math.abs(maxN)) * 0.15;
    minN -= folgaN; maxN += folgaN;

    const zoom = transform.zoom || 1.0;
    const panX = transform.panX || 0;
    const panY = transform.panY || 0;

    const marginLeft = 65;
    const marginRight = 26;
    const marginTop = 22;
    const marginBottom = 36;

    const plotX = marginLeft;
    const plotY = marginTop;
    const plotW = Math.max(50, width - marginLeft - marginRight);
    const plotH = Math.max(50, height - marginTop - marginBottom);

    const centerX = plotX + plotW / 2 + panX;
    const centerY = plotY + plotH / 2 + panY;

    const toX = (m) => centerX + (m / (2 * maxM)) * plotW * zoom;
    const toY = (n) => centerY - ((n - (maxN + minN) / 2) / (maxN - minN)) * plotH * zoom;
    const fromX = (px) => ((px - centerX) / (plotW * zoom)) * (2 * maxM);
    const fromY = (py) => ((centerY - py) / (plotH * zoom)) * (maxN - minN) + (maxN + minN) / 2;

    const estiloBege = (this.modoEscalaBege !== false);
    const labelX = `M${eixo} (kN·m)`;
    const labelY = `N (kN)`;

    // 1. Moldura e escala numérica
    this.desenharGradeEEscala(ctx, plotX, plotY, plotW, plotH, toX, toY, fromX, fromY, labelX, labelY, {
      estiloBege,
      isometria: false
    });

    // 2. Traçado com clipping interno
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    // Curva FCN
    ctx.beginPath();
    for (let i = 0; i < curva.length; i++) {
      const px = toX(curva[i].m);
      const py = toY(curva[i].n);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = estiloBege ? 'rgba(78, 201, 176, 0.22)' : this.theme.curveFill;
    ctx.fill();
    ctx.strokeStyle = estiloBege ? '#059669' : this.theme.curveStroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Pontos solicitantes das subdivisões
    if (combRes && combRes.secoes) {
      const mArr = eixo === 'x' ? combRes.secoes.m2x : combRes.secoes.m2y;
      const nsd = combRes.nsd;
      for (let i = 0; i < mArr.length; i++) {
        const px = toX(mArr[i]);
        const py = toY(nsd);
        ctx.beginPath();
        ctx.arc(px, py, i === combRes.secCritica ? 6 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = i === combRes.secCritica ? '#f59e0b' : '#0284c7';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    ctx.restore(); // Fecha o clipping interno
  }

  // =========================================================================
  // 4. PERFIL DE DEFORMAÇÕES (ε) NA SUBDIVISÃO Z (GraficoResultadosSec.java)
  // =========================================================================
  renderizarDeformacoes(canvas, engine, combRes, secIndex = 0, transform = { zoom: 1, panX: 0, panY: 0 }, hoveredBarra = null) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);
    this.activeDiagramRebars = [];

    const estiloBege = (this.modoEscalaBege !== false);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = estiloBege ? '#EDEDED' : '#181818';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    if (!combRes || !combRes.secoes) {
      ctx.fillStyle = estiloBege ? '#333333' : this.theme.text;
      ctx.font = '13px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Execute o cálculo para visualizar o diagrama de deformações.', width / 2, height / 2);
      return;
    }

    const secK = Math.min(secIndex ?? combRes.secCritica, combRes.secoes.z.length - 1);
    const plano = engine.planoSecao(combRes, secK);
    const zVal = combRes.secoes.z[secK];
    const fsSec = (combRes.secoes.fs && combRes.secoes.fs[secK] != null) ? combRes.secoes.fs[secK] : (combRes.seguranca ? combRes.seguranca.fs : 1.0);

    const s = engine.secao;
    const dimY = engine.dimY;
    const maxDimSec = Math.max(s.hx, dimY);

    // Título superior
    ctx.fillStyle = estiloBege ? '#111111' : this.theme.textBright;
    ctx.font = 'bold 12px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Deformações na Seção z = ${zVal.toFixed(2)} m (‰)`, width / 2, 22);

    if (!plano) {
      ctx.fillStyle = this.theme.neutralAxis;
      ctx.font = 'bold 13px "Inter", sans-serif';
      ctx.fillText('A seção não resiste ao esforço solicitante (não converge)', width / 2, height / 2);
      return;
    }

    const e0 = plano.e0;
    const a = plano.a;
    const c = plano.c;
    const curv = Math.hypot(a, c); // ‰ / cm
    const tetaLN = Math.atan2(c, a);
    const yLN = curv > 1e-7 ? -e0 / curv : 0;
    const xLN = Math.abs(yLN);
    const alphaLN = (tetaLN * 180 / Math.PI + 360) % 360;

    // Funções de rotação e conversão
    const cosT = Math.cos(tetaLN);
    const sinT = Math.sin(tetaLN);
    const rot = (x, y) => ({ xr: x * cosT + y * sinT, yr: -x * sinT + y * cosT });
    const unrot = (xr, yr) => ({ x: xr * cosT - yr * sinT, y: xr * sinT + yr * cosT });

    // Determina extremos da seção de concreto rotacionada
    let xCMin = 1e9, xCMax = -1e9, yCMin = 1e9, yCMax = -1e9;
    const halfX = s.hx / 2, halfY = dimY / 2;
    [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]].forEach(([vx, vy]) => {
      const { xr, yr } = rot(vx, vy);
      if (xr < xCMin) xCMin = xr;
      if (xr > xCMax) xCMax = xr;
      if (yr < yCMin) yCMin = yr;
      if (yr > yCMax) yCMax = yr;
    });

    let yAsMax = -1e9, rebarMaisTracionada = null;
    engine.barras.forEach(b => {
      const { xr, yr } = rot(b.x, b.y);
      if (yr > yAsMax) {
        yAsMax = yr;
        rebarMaisTracionada = b;
      }
    });
    if (yAsMax === -1e9) yAsMax = yCMax;

    // Escala e coordenadas na tela com suporte a Zoom e Pan
    const zoom = transform.zoom || 1.0;
    const panX = transform.panX || 0;
    const panY = transform.panY || 0;

    const largRot = (xCMax - xCMin) || s.hx;
    const altRot = (Math.max(yCMax, yAsMax) - yCMin) || dimY;
    const xRef = xCMax + 0.65 * largRot;
    const dimTotal = Math.max(xRef + 0.8 * largRot, altRot * 1.5, maxDimSec * 2.2);

    const baseEscala = Math.min((width - 80) / dimTotal, (height - 80) / dimTotal);
    const escala = baseEscala * zoom;
    const cx = width / 2 - (xRef * 0.35) * escala + panX;
    const cy = height / 2 + panY;

    const toX = (x) => cx + x * escala;
    const toY = (y) => cy - y * escala;
    const toScreen = (xr, yr) => {
      const u = unrot(xr, yr);
      return { px: toX(u.x), py: toY(u.y) };
    };

    // 1. Grid sutil de fundo
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    const step = 20 * escala;
    if (step > 15 && step < 120) {
      for (let x = cx % step; x < width; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = cy % step; y < height; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    // 2. Desenha a Seção de Concreto (como no PCalc original)
    ctx.save();
    ctx.fillStyle = this.theme.concreteFill;
    ctx.strokeStyle = this.theme.concreteStroke;
    ctx.lineWidth = 2.0;

    if (s.tipo === 'Circular') {
      ctx.beginPath();
      ctx.arc(cx, cy, (s.hx / 2) * escala, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    } else if (s.tipo === 'Circular Vazada') {
      const re = (s.hx / 2) * escala;
      const ri = ((s.hx2 || s.hx * 0.6) / 2) * escala;
      ctx.beginPath();
      ctx.arc(cx, cy, re, 0, 2 * Math.PI, false);
      ctx.arc(cx, cy, ri, 0, 2 * Math.PI, true);
      ctx.fill('evenodd');
      ctx.stroke();
    } else if (s.tipo === 'Retangular Vazada') {
      const hx2 = s.hx2 || s.hx * 0.6;
      const hy2 = s.hy2 || s.hy * 0.6;
      ctx.beginPath();
      ctx.rect(toX(-s.hx / 2), toY(dimY / 2), s.hx * escala, dimY * escala);
      ctx.rect(toX(hx2 / 2), toY(-hy2 / 2), -hx2 * escala, -hy2 * escala);
      ctx.fill('evenodd');
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.rect(toX(-s.hx / 2), toY(dimY / 2), s.hx * escala, dimY * escala);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // 3. Linha Neutra (LN) passando pela seção
    if (curv > 1e-7 && Math.abs(yLN) < maxDimSec * 4) {
      const pLN1 = toScreen(-50 * largRot, yLN);
      const pLN2 = toScreen(50 * largRot, yLN);
      ctx.save();
      ctx.strokeStyle = this.theme.neutralAxis;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(pLN1.px, pLN1.py);
      ctx.lineTo(pLN2.px, pLN2.py);
      ctx.stroke();
      ctx.restore();

      const pMid = toScreen(0, yLN);
      ctx.fillStyle = this.theme.neutralAxis;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`LN (xLN=${xLN.toFixed(1)}cm; α=${alphaLN.toFixed(1)}°)`, pMid.px + 8, pMid.py - 6);
    }

    // 4. Diagrama de Deformações rotacionado na lateral (GraficoResultadosSec.java)
    const eCMin = e0 + curv * yCMin;
    const eAsMax = e0 + curv * yAsMax;
    const maxE = Math.max(Math.abs(eCMin), Math.abs(eAsMax), 0.5);
    const scalaE = (0.55 * largRot) / maxE;

    // Linha de Referência Base do Diagrama (xRef)
    const yTopDiag = Math.max(yCMax, yAsMax);
    const pRefBase = toScreen(xRef, yCMin);
    const pRefTop = toScreen(xRef, yTopDiag);

    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(pRefBase.px, pRefBase.py);
    ctx.lineTo(pRefTop.px, pRefTop.py);
    ctx.stroke();

    // Linhas pontilhadas de projeção das fibras extremas
    const pProjC = toScreen(xCMax, yCMin);
    const pDiagC = toScreen(xRef + scalaE * eCMin, yCMin);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pProjC.px, pProjC.py);
    ctx.lineTo(pDiagC.px, pDiagC.py);
    ctx.stroke();

    const pProjS = toScreen(rebarMaisTracionada ? rot(rebarMaisTracionada.x, rebarMaisTracionada.y).xr : xCMax, yAsMax);
    const pDiagS = toScreen(xRef + scalaE * eAsMax, yAsMax);
    ctx.beginPath();
    ctx.moveTo(pProjS.px, pProjS.py);
    ctx.lineTo(pDiagS.px, pDiagS.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // 20 Linhas de Hachura (como no PCalc original)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1.0;
    const nHachuras = 20;
    for (let i = 0; i < nHachuras; i++) {
      const yi = yCMin + (yAsMax - yCMin) * (i / (nHachuras - 1));
      const ei = e0 + curv * yi;
      const p1 = toScreen(xRef, yi);
      const p2 = toScreen(xRef + scalaE * ei, yi);
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();
    }

    // Linha perfil de deformações
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(pDiagC.px, pDiagC.py);
    ctx.lineTo(pDiagS.px, pDiagS.py);
    ctx.stroke();

    // Anotações extremas: εc e εs
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = eCMin < 0 ? '#f43f5e' : '#38bdf8';
    ctx.textAlign = 'right';
    ctx.fillText(`εc = ${eCMin.toFixed(2)} ‰`, pDiagC.px - 6, pDiagC.py - 4);

    ctx.fillStyle = eAsMax >= 0 ? '#38bdf8' : '#f43f5e';
    ctx.textAlign = 'left';
    ctx.fillText(`εs = ${eAsMax.toFixed(2)} ‰`, pDiagS.px + 6, pDiagS.py + 4);
    ctx.restore();

    // 5. Barras de Armadura na Seção e Tooltips
    const estadoBarras = engine.calcularEstadoBarras(plano);
    for (let i = 0; i < engine.barras.length; i++) {
      const b = engine.barras[i];
      const eb = estadoBarras[i] || {};
      const bx = toX(b.x);
      const by = toY(b.y);
      const raio = Math.max(3.5, (b.fi / 20) * escala * 1.1);

      this.activeDiagramRebars.push({
        index: i + 1,
        x: bx,
        y: by,
        raio: raio + 4,
        fi: b.fi,
        coordX: b.x,
        coordY: b.y,
        es: eb.deformacao,
        sigmas: eb.tensao,
        tensaoMpa: eb.tensaoMpa,
        escoando: eb.escoando
      });

      // Desenho da barra com gradiente ciano
      const grad = ctx.createRadialGradient(bx - raio * 0.3, by - raio * 0.3, 1, bx, by, raio);
      grad.addColorStop(0, '#bae6fd');
      grad.addColorStop(0.7, '#0284c7');
      grad.addColorStop(1, '#0369a1');

      ctx.beginPath();
      ctx.arc(bx, by, raio, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Destaque se a barra estiver sob o mouse
      if (hoveredBarra && hoveredBarra.index === (i + 1)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, raio + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      // Número da barra
      if (engine.barras.length <= 32) {
        ctx.fillStyle = '#f8fafc';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${i + 1}`, bx, by);
      }
    }

    // Aviso se FS < 1.0 (como no PCalc original)
    if (fsSec < 1.0) {
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('A seção não resiste ao Msd (FS < 1.00)', width / 2, height - 16);
    }

    // Tooltip flutuante da barra hovered
    if (hoveredBarra) {
      const barAtual = (this.activeDiagramRebars && this.activeDiagramRebars.find(b => b.index === hoveredBarra.index)) || hoveredBarra;
      this.desenharTooltipBarra(ctx, barAtual, width, height, 'deformacao');
    }
  }

  // =========================================================================
  // 5. PERFIL DE TENSÕES (σ) NA SUBDIVISÃO Z (GraficoResultadosSec.java)
  // =========================================================================
  renderizarTensoes(canvas, engine, combRes, secIndex = 0, transform = { zoom: 1, panX: 0, panY: 0 }, hoveredBarra = null) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);
    this.activeDiagramRebars = [];

    const estiloBege = (this.modoEscalaBege !== false);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = estiloBege ? '#EDEDED' : '#181818';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    if (!combRes || !combRes.secoes) {
      ctx.fillStyle = estiloBege ? '#333333' : this.theme.text;
      ctx.font = '13px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Execute o cálculo para visualizar o diagrama de tensões.', width / 2, height / 2);
      return;
    }

    const secK = Math.min(secIndex ?? combRes.secCritica, combRes.secoes.z.length - 1);
    const plano = engine.planoSecao(combRes, secK);
    const zVal = combRes.secoes.z[secK];
    const fsSec = (combRes.secoes.fs && combRes.secoes.fs[secK] != null) ? combRes.secoes.fs[secK] : (combRes.seguranca ? combRes.seguranca.fs : 1.0);

    const s = engine.secao;
    const dimY = engine.dimY;
    const maxDimSec = Math.max(s.hx, dimY);

    ctx.fillStyle = estiloBege ? '#111111' : this.theme.textBright;
    ctx.font = 'bold 12px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Distribuição de Tensões na Seção z = ${zVal.toFixed(2)} m (kN/cm²)`, width / 2, 22);

    if (!plano) {
      ctx.fillStyle = this.theme.neutralAxis;
      ctx.font = 'bold 13px "Inter", sans-serif';
      ctx.fillText('A seção não resiste ao esforço solicitante (não converge)', width / 2, height / 2);
      return;
    }

    const e0 = plano.e0;
    const a = plano.a;
    const c = plano.c;
    const curv = Math.hypot(a, c);
    const tetaLN = Math.atan2(c, a);
    const yLN = curv > 1e-7 ? -e0 / curv : 0;
    const xLN = Math.abs(yLN);
    const alphaLN = (tetaLN * 180 / Math.PI + 360) % 360;

    const cosT = Math.cos(tetaLN);
    const sinT = Math.sin(tetaLN);
    const rot = (x, y) => ({ xr: x * cosT + y * sinT, yr: -x * sinT + y * cosT });
    const unrot = (xr, yr) => ({ x: xr * cosT - yr * sinT, y: xr * sinT + yr * cosT });

    let xCMin = 1e9, xCMax = -1e9, yCMin = 1e9, yCMax = -1e9;
    const halfX = s.hx / 2, halfY = dimY / 2;
    [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]].forEach(([vx, vy]) => {
      const { xr, yr } = rot(vx, vy);
      if (xr < xCMin) xCMin = xr;
      if (xr > xCMax) xCMax = xr;
      if (yr < yCMin) yCMin = yr;
      if (yr > yCMax) yCMax = yr;
    });

    const zoom = transform.zoom || 1.0;
    const panX = transform.panX || 0;
    const panY = transform.panY || 0;

    const largRot = (xCMax - xCMin) || s.hx;
    const altRot = (yCMax - yCMin) || dimY;
    const xRef = xCMax + 0.65 * largRot;
    const dimTotal = Math.max(xRef + 0.8 * largRot, altRot * 1.5, maxDimSec * 2.2);

    const baseEscala = Math.min((width - 80) / dimTotal, (height - 80) / dimTotal);
    const escala = baseEscala * zoom;
    const cx = width / 2 - (xRef * 0.35) * escala + panX;
    const cy = height / 2 + panY;

    const toX = (x) => cx + x * escala;
    const toY = (y) => cy - y * escala;
    const toScreen = (xr, yr) => {
      const u = unrot(xr, yr);
      return { px: toX(u.x), py: toY(u.y) };
    };

    // Grid
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    const step = 20 * escala;
    if (step > 15 && step < 120) {
      for (let x = cx % step; x < width; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = cy % step; y < height; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    // Seção de concreto
    ctx.save();
    ctx.fillStyle = this.theme.concreteFill;
    ctx.strokeStyle = this.theme.concreteStroke;
    ctx.lineWidth = 2.0;

    if (s.tipo === 'Circular') {
      ctx.beginPath();
      ctx.arc(cx, cy, (s.hx / 2) * escala, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    } else if (s.tipo === 'Circular Vazada') {
      const re = (s.hx / 2) * escala;
      const ri = ((s.hx2 || s.hx * 0.6) / 2) * escala;
      ctx.beginPath();
      ctx.arc(cx, cy, re, 0, 2 * Math.PI, false);
      ctx.arc(cx, cy, ri, 0, 2 * Math.PI, true);
      ctx.fill('evenodd');
      ctx.stroke();
    } else if (s.tipo === 'Retangular Vazada') {
      const hx2 = s.hx2 || s.hx * 0.6;
      const hy2 = s.hy2 || s.hy * 0.6;
      ctx.beginPath();
      ctx.rect(toX(-s.hx / 2), toY(dimY / 2), s.hx * escala, dimY * escala);
      ctx.rect(toX(hx2 / 2), toY(-hy2 / 2), -hx2 * escala, -hy2 * escala);
      ctx.fill('evenodd');
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.rect(toX(-s.hx / 2), toY(dimY / 2), s.hx * escala, dimY * escala);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Linha Neutra (LN)
    if (curv > 1e-7 && Math.abs(yLN) < maxDimSec * 4) {
      const pLN1 = toScreen(-50 * largRot, yLN);
      const pLN2 = toScreen(50 * largRot, yLN);
      ctx.save();
      ctx.strokeStyle = this.theme.neutralAxis;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(pLN1.px, pLN1.py);
      ctx.lineTo(pLN2.px, pLN2.py);
      ctx.stroke();
      ctx.restore();

      const pMid = toScreen(0, yLN);
      ctx.fillStyle = this.theme.neutralAxis;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`LN (xLN=${xLN.toFixed(1)}cm; α=${alphaLN.toFixed(1)}°)`, pMid.px + 8, pMid.py - 6);
    }

    // Diagrama de Tensões de Concreto (GraficoResultadosSec.java)
    const eCMin = e0 + curv * yCMin;
    const sigCMin = engine.calcFc(eCMin); // negativo em compressão
    const maxSig = Math.max(Math.abs(sigCMin), 0.1);
    const scalaSig = (0.65 * largRot) / maxSig;

    const pRefBase = toScreen(xRef, yCMin);
    const pRefTop = toScreen(xRef, yCMax);

    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(pRefBase.px, pRefBase.py);
    ctx.lineTo(pRefTop.px, pRefTop.py);
    ctx.stroke();

    // Projeções
    const pProjC = toScreen(xCMax, yCMin);
    const pDiagC = toScreen(xRef + scalaSig * sigCMin, yCMin);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pProjC.px, pProjC.py);
    ctx.lineTo(pDiagC.px, pDiagC.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curva parábola-retângulo e hachuras
    const nHachuras = 20;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.lineWidth = 1.0;
    for (let i = 0; i < nHachuras; i++) {
      const yi = yCMin + (yCMax - yCMin) * (i / (nHachuras - 1));
      const ei = e0 + curv * yi;
      const sigi = engine.calcFc(ei);
      if (sigi !== 0) {
        const p1 = toScreen(xRef, yi);
        const p2 = toScreen(xRef + scalaSig * sigi, yi);
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();
      }
    }

    // Polígono do diagrama de tensões preenchido
    const nPtsCurva = 30;
    ctx.beginPath();
    ctx.moveTo(pRefBase.px, pRefBase.py);
    for (let i = 0; i <= nPtsCurva; i++) {
      const yi = yCMin + (yCMax - yCMin) * (i / nPtsCurva);
      const ei = e0 + curv * yi;
      const sigi = engine.calcFc(ei);
      const pt = toScreen(xRef + scalaSig * sigi, yi);
      ctx.lineTo(pt.px, pt.py);
    }
    ctx.lineTo(pRefTop.px, pRefTop.py);
    ctx.closePath();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.20)';
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Rótulos de tensão máxima de compressão
    if (sigCMin !== 0) {
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f43f5e';
      ctx.textAlign = 'right';
      ctx.fillText(`fcd = ${Math.abs(sigCMin).toFixed(2)} kN/cm²`, pDiagC.px - 6, pDiagC.py - 4);
    }
    ctx.restore();

    // Barras de Armadura e Tooltips
    const estadoBarras = engine.calcularEstadoBarras(plano);
    for (let i = 0; i < engine.barras.length; i++) {
      const b = engine.barras[i];
      const eb = estadoBarras[i] || {};
      const bx = toX(b.x);
      const by = toY(b.y);
      const raio = Math.max(3.5, (b.fi / 20) * escala * 1.1);

      this.activeDiagramRebars.push({
        index: i + 1,
        x: bx,
        y: by,
        raio: raio + 4,
        fi: b.fi,
        coordX: b.x,
        coordY: b.y,
        es: eb.deformacao,
        sigmas: eb.tensao,
        tensaoMpa: eb.tensaoMpa,
        escoando: eb.escoando
      });

      const grad = ctx.createRadialGradient(bx - raio * 0.3, by - raio * 0.3, 1, bx, by, raio);
      grad.addColorStop(0, '#bae6fd');
      grad.addColorStop(0.7, '#0284c7');
      grad.addColorStop(1, '#0369a1');

      ctx.beginPath();
      ctx.arc(bx, by, raio, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (hoveredBarra && hoveredBarra.index === (i + 1)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, raio + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      if (engine.barras.length <= 32) {
        ctx.fillStyle = '#f8fafc';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${i + 1}`, bx, by);
      }
    }

    if (fsSec < 1.0) {
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('A seção não resiste ao Msd (FS < 1.00)', width / 2, height - 16);
    }

    if (hoveredBarra) {
      const barAtual = (this.activeDiagramRebars && this.activeDiagramRebars.find(b => b.index === hoveredBarra.index)) || hoveredBarra;
      this.desenharTooltipBarra(ctx, barAtual, width, height, 'tensao');
    }
  }

  // =========================================================================
  // 6. DIAGRAMAS DE ESFORÇOS AO LONGO DO PILAR (DesenhaEsforcos.java)
  // =========================================================================
  renderizarDiagramasEsforcosPilar(canvas, engine, combRes, secIndexSelecionado = null) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);

    if (!combRes || !combRes.secoes) {
      ctx.fillStyle = this.theme.text;
      ctx.font = '12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Diagramas de esforços disponíveis após o cálculo.', width / 2, height / 2);
      return;
    }

    const n = combRes.secoes.z.length;
    const h0 = height * 0.82; // Base
    const h1 = height * 0.20; // Topo
    const pilarH = h0 - h1;

    // Posições horizontais das 4 colunas (como no DesenhaEsforcos do Java)
    const xPilar = width * 0.12;
    const xNsd   = width * 0.32;
    const xMsdx  = width * 0.58;
    const xMsdy  = width * 0.84;

    // Linhas pontilhadas de Topo e Base
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(width * 0.04, h0); ctx.lineTo(width * 0.96, h0);
    ctx.moveTo(width * 0.04, h1); ctx.lineTo(width * 0.96, h1);
    ctx.stroke();
    ctx.setLineDash([]);

    // Destaque da seção selecionada pelo usuário
    if (secIndexSelecionado !== null && secIndexSelecionado >= 0 && secIndexSelecionado < n) {
      const ySec = h0 - secIndexSelecionado * (pilarH / (n - 1));
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(width * 0.04, ySec);
      ctx.lineTo(width * 0.96, ySec);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`► z = ${combRes.secoes.z[secIndexSelecionado].toFixed(2)}m`, width * 0.02, ySec - 3);
    }

    ctx.fillStyle = this.theme.text;
    ctx.font = 'bold 11px "Inter", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Base (z=0)', width * 0.97, h0 + 4);
    ctx.fillText('Topo (z=L)', width * 0.97, h1 + 4);

    // -------------------------------------------------------------
    // COLUNA 1: PILAR E SUAS VINCULAÇÕES
    // -------------------------------------------------------------
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(xPilar, h0); ctx.lineTo(xPilar, h1);
    ctx.stroke();

    const tipoVinc = engine.secao.tipoVinculacao;
    if (tipoVinc === 1) { // Biapoiado
      // Apoio Topo (móvel)
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xPilar - 6, h1 - 6, 12, 6);
      ctx.beginPath();
      ctx.arc(xPilar - 3, h1 - 8, 2, 0, 2 * Math.PI);
      ctx.arc(xPilar + 3, h1 - 8, 2, 0, 2 * Math.PI);
      ctx.stroke();

      // Apoio Base (fixo / rotulado)
      ctx.beginPath();
      ctx.moveTo(xPilar, h0);
      ctx.lineTo(xPilar - 8, h0 + 12);
      ctx.lineTo(xPilar + 8, h0 + 12);
      ctx.closePath();
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
    } else if (tipoVinc === 2) { // Engastado e livre
      // Engaste na base
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xPilar - 14, h0); ctx.lineTo(xPilar + 14, h0);
      for (let i = -10; i <= 10; i += 5) {
        ctx.moveTo(xPilar + i, h0); ctx.lineTo(xPilar + i - 4, h0 + 6);
      }
      ctx.stroke();
    }

    // Cota L
    const lMetros = (engine.secao.l / 100).toFixed(2);
    ctx.fillStyle = this.theme.textBright;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`L = ${lMetros} m`, xPilar, (h0 + h1) / 2);

    // -------------------------------------------------------------
    // COLUNA 2: DIAGRAMA Nsd
    // -------------------------------------------------------------
    const nsd = combRes.nsd;
    const escalaN = 25 / (Math.abs(nsd) || 1);
    const wN = nsd * escalaN;

    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(xNsd, h1, wN, pilarH);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xNsd, h0); ctx.lineTo(xNsd, h1);
    ctx.stroke();

    ctx.fillStyle = this.theme.textBright;
    ctx.font = 'bold 11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nsd (kN)', xNsd, h1 - 18);
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(`${nsd.toFixed(1)}`, xNsd + wN / 2, (h0 + h1) / 2);

    // -------------------------------------------------------------
    // COLUNAS 3 E 4: DIAGRAMAS Msd,x E Msd,y
    // -------------------------------------------------------------
    const desenharDiagramaM = (xCentro, m1Arr, m2Arr, titulo) => {
      let maxAbs = 0.01;
      for (let i = 0; i < n; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(m1Arr[i]), Math.abs(m2Arr[i]));
      }
      const escalaM = 35 / maxAbs;

      // 1ª Ordem (polígono azul claro)
      ctx.beginPath();
      ctx.moveTo(xCentro, h0);
      for (let i = 0; i < n; i++) {
        const y = h0 - i * (pilarH / (n - 1));
        const x = xCentro + m1Arr[i] * escalaM;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(xCentro, h1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 2ª Ordem (área hachurada em rosa/vermelho se diferente)
      let difere = false;
      for (let i = 0; i < n; i++) {
        if (Math.abs(m2Arr[i] - m1Arr[i]) > 0.05) { difere = true; break; }
      }

      if (difere) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const y = h0 - i * (pilarH / (n - 1));
          ctx.lineTo(xCentro + m1Arr[i] * escalaM, y);
        }
        for (let i = n - 1; i >= 0; i--) {
          const y = h0 - i * (pilarH / (n - 1));
          ctx.lineTo(xCentro + m2Arr[i] * escalaM, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.fill();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Eixo do pilar
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xCentro, h0); ctx.lineTo(xCentro, h1);
      ctx.stroke();

      // Ponto de máximo
      let iMax = 0, vMax = 0;
      for (let i = 0; i < n; i++) {
        if (Math.abs(m2Arr[i]) > vMax) { vMax = Math.abs(m2Arr[i]); iMax = i; }
      }
      const yPontoMax = h0 - iMax * (pilarH / (n - 1));
      const xPontoMax = xCentro + m2Arr[iMax] * escalaM;

      ctx.beginPath();
      ctx.arc(xPontoMax, yPontoMax, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Rótulos
      ctx.fillStyle = this.theme.textBright;
      ctx.font = 'bold 11px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(titulo, xCentro, h1 - 18);

      ctx.fillStyle = '#f59e0b';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`${m2Arr[iMax].toFixed(1)}`, xPontoMax + (m2Arr[iMax] >= 0 ? 14 : -14), yPontoMax + 3);
    };

    desenharDiagramaM(xMsdx, combRes.secoes.m1x, combRes.secoes.m2x, 'Msd,x (kN·m)');
    desenharDiagramaM(xMsdy, combRes.secoes.m1y, combRes.secoes.m2y, 'Msd,y (kN·m)');

    // Indicação do Método de 2ª ordem no rodapé
    const nomesMetodos = [
      '',
      'Método: Pilar-Padrão com curvatura aproximada',
      'Método: Pilar-Padrão com rigidez κ aproximada',
      'Método: Pilar-Padrão acoplado com diagrama N, M, 1/r',
      'Método: Método Geral acoplado com diagrama N, M, 1/r',
      'Método: Método Geral acoplado com diagrama N, Mx, My, 1/r (direções acopladas)'
    ];
    ctx.fillStyle = '#38bdf8';
    ctx.font = '11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(nomesMetodos[engine.metodoSegOrd] || '', width / 2, height - 8);
  }

  // =========================================================================
  // 7. DIAGRAMA DA LEI CONSTITUTIVA DO CONCRETO NBR 6118 (FIG. 8.2)
  // =========================================================================
  renderizarDiagramaConcretoNBR(canvas, fck, gamaC = 1.40) {
    if (!canvas) return;
    const { ctx, width, height } = this.setupCanvas(canvas);

    const { etaC, n, ec2, ecu } = parametrosConcretoNBR(fck);
    const fcd = (fck / 10) / gamaC;
    const fcdMax = 0.85 * etaC * fcd;

    const padL = 50, padR = 25, padT = 30, padB = 40;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const toX = (ec) => padL + (ec / (ecu * 1.15)) * plotW;
    const toY = (sig) => padT + (1 - sig / (fcdMax * 1.25)) * plotH;

    // Grid e eixos
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, toY(0)); ctx.lineTo(padL + plotW, toY(0));
    ctx.moveTo(padL, toY(0)); ctx.lineTo(padL, padT);
    ctx.stroke();

    // Curva Parábola-Retângulo
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));

    const nSteps = 50;
    for (let i = 0; i <= nSteps; i++) {
      const ec = (i / nSteps) * ec2;
      const sig = fcdMax * (1 - Math.pow(1 - ec / ec2, n));
      ctx.lineTo(toX(ec), toY(sig));
    }
    ctx.lineTo(toX(ecu), toY(fcdMax));
    ctx.lineTo(toX(ecu), toY(0));
    ctx.closePath();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Linha do patamar plástico
    ctx.strokeStyle = this.theme.axis;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(ec2), toY(0)); ctx.lineTo(toX(ec2), toY(fcdMax));
    ctx.moveTo(toX(ecu), toY(0)); ctx.lineTo(toX(ecu), toY(fcdMax));
    ctx.moveTo(padL, toY(fcdMax)); ctx.lineTo(toX(ecu), toY(fcdMax));
    ctx.stroke();
    ctx.setLineDash([]);

    // Rótulos técnicos conforme NBR 6118:2026
    ctx.fillStyle = this.theme.textBright;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`εc2=${ec2.toFixed(2)}‰`, toX(ec2), toY(0) + 15);
    ctx.fillText(`εcu=${ecu.toFixed(2)}‰`, toX(ecu), toY(0) + 15);

    ctx.textAlign = 'right';
    ctx.fillText(`0.85ηc·fcd = ${fcdMax.toFixed(2)} kN/cm²`, padL - 8, toY(fcdMax) + 4);

    ctx.fillStyle = '#f59e0b';
    ctx.font = '10px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`ηc = ${etaC.toFixed(3)} | n = ${n.toFixed(2)} (NBR 6118)`, padL + 10, padT + 15);
  }
}

if (typeof window !== 'undefined') {
  window.PCalcRenderer = PCalcRenderer;
}


  // ==========================================
  // PARTE 3: CONTROLADOR DA INTERFACE (app.js)
  // ==========================================
  /**
 * PCalc 1.4 Web - Controlador Principal da Aplicação
 * Atende plenamente à ABNT NBR 6118:2026 e aos recursos originais do software PCalc.
 */


// Instâncias do Motor Matemático e do Renderizador Gráfico
const engine = new PCalcEngine();
const renderer = new PCalcRenderer();

// Estado da Aplicação
const estado = {
  combAtivaIdx: 0,
  secAtivaIdx: null,       // Subdivisão ativa z selecionada na tabela
  graficoAtivo: 'fco',     // 'fco', 'fcnx', 'fcny', 'deformacao', 'tensao'
  mostrarFibras: false,
  ultimoResultado: null,
  abaArmacaoAtiva: 'rapida',// 'rapida' ou 'coord'
  zoomResultados: {
    fco: { zoom: 1.0, panX: 0, panY: 0 },
    fcnx: { zoom: 1.0, panX: 0, panY: 0 },
    fcny: { zoom: 1.0, panX: 0, panY: 0 },
    deformacao: { zoom: 1.0, panX: 0, panY: 0 },
    tensao: { zoom: 1.0, panX: 0, panY: 0 }
  },
  zoomSecao: { zoom: 1.0, panX: 0, panY: 0 },
  hoveredBarraResultados: null,
  hoveredBarraSecao: null,
  selectedBarraResultados: null,
  selectedBarraSecao: null
};

// Mapeamento dos Elementos do DOM
const el = {
  // Barra de Título & Status
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.getElementById('statusText'),
  windowTitle: document.getElementById('windowTitle'),

  // Barra de Menus
  menuNovo: document.getElementById('menuNovo'),
  menuAbrir: document.getElementById('menuAbrir'),
  menuSalvar: document.getElementById('menuSalvar'),
  menuSalvarComo: document.getElementById('menuSalvarComo'),
  menuExemploPadrao: document.getElementById('menuExemploPadrao'),
  menuExemploCircular: document.getElementById('menuExemploCircular'),
  menuExemploEsbelto: document.getElementById('menuExemploEsbelto'),
  menuExportarTxt: document.getElementById('menuExportarTxt'),
  menuImprimir: document.getElementById('menuImprimir'),
  menuGeometria: document.getElementById('menuGeometria'),
  menuMateriais: document.getElementById('menuMateriais'),
  menuArmacaoRapida: document.getElementById('menuArmacaoRapida'),
  menuArmacaoCoord: document.getElementById('menuArmacaoCoord'),
  menuApagarArmaduras: document.getElementById('menuApagarArmaduras'),
  menuEsforcos: document.getElementById('menuEsforcos'),
  menu2Ord: document.getElementById('menu2Ord'),
  menuCriterios: document.getElementById('menuCriterios'),
  menuVerFCO: document.getElementById('menuVerFCO'),
  menuVerFCNx: document.getElementById('menuVerFCNx'),
  menuVerFCNy: document.getElementById('menuVerFCNy'),
  menuVerDeformacao: document.getElementById('menuVerDeformacao'),
  menuVerTensao: document.getElementById('menuVerTensao'),
  menuAvisos: document.getElementById('menuAvisos'),
  menuMemoria: document.getElementById('menuMemoria'),
  menuSobre: document.getElementById('menuSobre'),

  // Barra de Ferramentas (Toolbar)
  btnToolNovo: document.getElementById('btnToolNovo'),
  btnToolAbrir: document.getElementById('btnToolAbrir'),
  btnToolSalvar: document.getElementById('btnToolSalvar'),
  inputAbrirArquivo: document.getElementById('inputAbrirArquivo'),
  btnToolGeometria: document.getElementById('btnToolGeometria'),
  btnToolMateriais: document.getElementById('btnToolMateriais'),
  btnToolArmacao: document.getElementById('btnToolArmacao'),
  btnToolArmacaoMenu: document.getElementById('btnToolArmacaoMenu'),
  dropdownArmacaoOptions: document.getElementById('dropdownArmacaoOptions'),
  optArmacaoRapida: document.getElementById('optArmacaoRapida'),
  optArmacaoCoord: document.getElementById('optArmacaoCoord'),
  btnToolEsforcos: document.getElementById('btnToolEsforcos'),
  btnTool2Ord: document.getElementById('btnTool2Ord'),
  btnToolCriterios: document.getElementById('btnToolCriterios'),
  btnToolCalcular: document.getElementById('btnToolCalcular'),
  btnToolAvisos: document.getElementById('btnToolAvisos'),
  badgeAvisosCount: document.getElementById('badgeAvisosCount'),
  btnToolMemoria: document.getElementById('btnToolMemoria'),

  // Painel Seção Transversal
  chkEscalaBege: document.getElementById('chkEscalaBege'),
  chkFibras: document.getElementById('chkFibras'),
  btnSecaoCoordDirect: document.getElementById('btnSecaoCoordDirect'),
  canvasSecao: document.getElementById('canvasSecao'),
  btnSecaoZoomIn: document.getElementById('btnSecaoZoomIn'),
  btnSecaoZoomOut: document.getElementById('btnSecaoZoomOut'),
  btnSecaoZoomReset: document.getElementById('btnSecaoZoomReset'),

  // Painel Resultados
  chkEscalaBegeRes: document.getElementById('chkEscalaBegeRes'),
  selectComb: document.getElementById('selectComb'),
  txtTaxaAs: document.getElementById('txtTaxaAs'),
  txtLambdaX: document.getElementById('txtLambdaX'),
  txtLambdaY: document.getElementById('txtLambdaY'),
  txtFck: document.getElementById('txtFck'),
  txtFSSecVal: document.getElementById('txtFSSecVal'),
  txtFSCombVal: document.getElementById('txtFSCombVal'),
  txtFSCritBox: document.getElementById('txtFSCritBox'),
  txtFSCritVal: document.getElementById('txtFSCritVal'),
  canvasResultados: document.getElementById('canvasResultados'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnZoomReset: document.getElementById('btnZoomReset'),
  toggleButtons: document.querySelectorAll('.btn-graph-toggle'),

  // Painel Esforços e Subdivisões
  lblSubdivisoesInfo: document.getElementById('lblSubdivisoesInfo'),
  tabelaSubdivisoes: document.getElementById('tabelaSubdivisoes'),
  tbodySubdivisoes: document.getElementById('tbodySubdivisoes'),
  canvasEsforcosPilar: document.getElementById('canvasEsforcosPilar'),

  // Statusbar
  sbSecao: document.getElementById('sbSecao'),
  sbFck: document.getElementById('sbFck'),
  sbArmacao: document.getElementById('sbArmacao'),
  sbMetodo2Ord: document.getElementById('sbMetodo2Ord'),
  sbStatusMsg: document.getElementById('sbStatusMsg'),

  // Modais
  modalGeometria: document.getElementById('modalGeometria'),
  modalMateriais: document.getElementById('modalMateriais'),
  modalArmacao: document.getElementById('modalArmacao'),
  modalEsforcos: document.getElementById('modalEsforcos'),
  modal2Ord: document.getElementById('modal2Ord'),
  modalCriterios: document.getElementById('modalCriterios'),
  modalAvisos: document.getElementById('modalAvisos'),
  modalMemoria: document.getElementById('modalMemoria'),
  modalSobre: document.getElementById('modalSobre'),

  // Diálogo Geometria
  dlgSecaoTipo: document.getElementById('dlgSecaoTipo'),
  dlgSecaoHx: document.getElementById('dlgSecaoHx'),
  dlgSecaoHy: document.getElementById('dlgSecaoHy'),
  rowDimY: document.getElementById('rowDimY'),
  lblDimX: document.getElementById('lblDimX'),
  lblDimY: document.getElementById('lblDimY'),
  rowVazado: document.getElementById('rowVazado'),
  dlgSecaoHx2: document.getElementById('dlgSecaoHx2'),
  dlgSecaoHy2: document.getElementById('dlgSecaoHy2'),
  dlgSecaoL: document.getElementById('dlgSecaoL'),
  dlgSecaoVinculacao: document.getElementById('dlgSecaoVinculacao'),
  btnSalvarGeometria: document.getElementById('btnSalvarGeometria'),

  // Diálogo Materiais
  dlgFckDigitado: document.getElementById('dlgFckDigitado'),
  dlgSliderFck: document.getElementById('dlgSliderFck'),
  dlgGamaC: document.getElementById('dlgGamaC'),
  dlgValFcd: document.getElementById('dlgValFcd'),
  dlgAcoTipo: document.getElementById('dlgAcoTipo'),
  dlgFyk: document.getElementById('dlgFyk'),
  dlgGamaS: document.getElementById('dlgGamaS'),
  dlgEs: document.getElementById('dlgEs'),
  canvasLeiConcreto: document.getElementById('canvasLeiConcreto'),
  lblDetalhesNBR: document.getElementById('lblDetalhesNBR'),
  btnSalvarMateriais: document.getElementById('btnSalvarMateriais'),

  // Diálogo Armação
  tabArmacaoBtnRapida: document.getElementById('tabArmacaoBtnRapida'),
  tabArmacaoBtnCoord: document.getElementById('tabArmacaoBtnCoord'),
  paneArmacaoRapida: document.getElementById('paneArmacaoRapida'),
  paneArmacaoCoord: document.getElementById('paneArmacaoCoord'),
  dlgArmNx: document.getElementById('dlgArmNx'),
  dlgArmNy: document.getElementById('dlgArmNy'),
  rowArmNy: document.getElementById('rowArmNy'),
  dlgArmFi: document.getElementById('dlgArmFi'),
  dlgArmDLinha: document.getElementById('dlgArmDLinha'),
  btnGerarArmacaoRapida: document.getElementById('btnGerarArmacaoRapida'),
  rdCoordBarra: document.getElementById('rdCoordBarra'),
  rdCoordLinha: document.getElementById('rdCoordLinha'),
  rdCoordArco: document.getElementById('rdCoordArco'),
  colNumBarrasLinha: document.getElementById('colNumBarrasLinha'),
  dlgCoordN: document.getElementById('dlgCoordN'),
  dlgCoordFi: document.getElementById('dlgCoordFi'),
  dlgCoordXi: document.getElementById('dlgCoordXi'),
  dlgCoordYi: document.getElementById('dlgCoordYi'),
  colXf: document.getElementById('colXf'),
  colYf: document.getElementById('colYf'),
  dlgCoordXf: document.getElementById('dlgCoordXf'),
  dlgCoordYf: document.getElementById('dlgCoordYf'),
  btnInserirBarraCoord: document.getElementById('btnInserirBarraCoord'),
  btnLimparTodasBarras: document.getElementById('btnLimparTodasBarras'),
  tbodyBarrasCoord: document.getElementById('tbodyBarrasCoord'),
  lblResumoTotalBarras: document.getElementById('lblResumoTotalBarras'),
  lblResumoAreaAs: document.getElementById('lblResumoAreaAs'),
  lblResumoTaxaAs: document.getElementById('lblResumoTaxaAs'),
  btnSalvarArmacao: document.getElementById('btnSalvarArmacao'),

  // Diálogo Esforços
  btnAddCombRow: document.getElementById('btnAddCombRow'),
  dlgGamaF: document.getElementById('dlgGamaF'),
  tbodyEsforcosModal: document.getElementById('tbodyEsforcosModal'),
  btnSalvarEsforcos: document.getElementById('btnSalvarEsforcos'),

  // Diálogo 2ª Ordem
  rdCalc2Ord1: document.getElementById('rdCalc2Ord1'),
  rdCalc2Ord2: document.getElementById('rdCalc2Ord2'),
  rdCalc2Ord3: document.getElementById('rdCalc2Ord3'),
  rdMetodo1: document.getElementById('rdMetodo1'),
  rdMetodo2: document.getElementById('rdMetodo2'),
  rdMetodo3: document.getElementById('rdMetodo3'),
  rdMetodo4: document.getElementById('rdMetodo4'),
  rdMetodo5: document.getElementById('rdMetodo5'),
  dlgCheckLimMb: document.getElementById('dlgCheckLimMb'),
  dlgGamaF3: document.getElementById('dlgGamaF3'),
  btnSalvar2Ord: document.getElementById('btnSalvar2Ord'),

  // Diálogo Critérios
  dlgCheckMomentoMin: document.getElementById('dlgCheckMomentoMin'),
  dlgTaxaMin: document.getElementById('dlgTaxaMin'),
  dlgTaxaMax: document.getElementById('dlgTaxaMax'),
  dlgNFibras: document.getElementById('dlgNFibras'),
  dlgNPtsMr: document.getElementById('dlgNPtsMr'),
  dlgTolN: document.getElementById('dlgTolN'),
  dlgTolLN: document.getElementById('dlgTolLN'),
  btnSalvarCriterios: document.getElementById('btnSalvarCriterios'),

  // Diálogo Avisos
  avisosListContainer: document.getElementById('avisosListContainer'),

  // Diálogo Memória
  reportContentArea: document.getElementById('reportContentArea'),
  btnCopiarRelatorio: document.getElementById('btnCopiarRelatorio'),
  btnCopiarRelatorio2: document.getElementById('btnCopiarRelatorio2'),
  btnBaixarRelatorioTxt: document.getElementById('btnBaixarRelatorioTxt'),
  btnBaixarRelatorioTxt2: document.getElementById('btnBaixarRelatorioTxt2'),
  btnGerarRelatorioPdf: document.getElementById('btnGerarRelatorioPdf'),
  btnGerarRelatorioPdf2: document.getElementById('btnGerarRelatorioPdf2'),
  btnPrintReport: document.getElementById('btnPrintReport'),
  btnPrintReport2: document.getElementById('btnPrintReport2')
};

// =============================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// =============================================================================
function init() {
  configurarEventosModais();
  configurarEventosArmacaoCoord();
  configurarEventosMateriais();
  configurarEventosToggles();
  configurarEventosZoomPanInteracoes();
  carregarPresetPadrao();
  ajustarDimensoesCanvases();
  window.addEventListener('resize', () => {
    ajustarDimensoesCanvases();
    atualizarTodaInterface();
    atualizarVisualizacaoResultados();
  });
  executarCalculo();
}

// Configura tamanho real em pixels dos canvases para suporte Retina / HiDPI
function ajustarDimensoesCanvases() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const ajustar = (canvas) => {
    if (!canvas || !canvas.parentElement) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  };
  ajustar(el.canvasSecao);
  ajustar(el.canvasResultados);
  ajustar(el.canvasEsforcosPilar);
  ajustar(el.canvasLeiConcreto);
}

// =============================================================================
// PRESETS
// =============================================================================
function carregarPresetPadrao() {
  engine.secao.tipo = 'Retangular';
  engine.secao.hx = 20.0;
  engine.secao.hy = 40.0;
  engine.secao.l = 300.0;
  engine.secao.tipoVinculacao = 1;

  engine.fck = 30.0;
  engine.fyk = 500.0;
  engine.gamaC = 1.40;
  engine.gamaS = 1.15;
  engine.gamaF = 1.40;
  engine.gamaF3 = 1.10;

  // 6 barras Ø 12.5 mm
  engine.configurarArmacaoRapida(2, 3, 12.5, 3.5);

  // Método Geral Acoplado N, Mx, My, 1/r
  engine.metodoSegOrd = 5;
  engine.considerarSegundaOrdem = 2; // se lambda > lambda1
  engine.limitarMb = true;

  engine.esforcos = [
    { id: 1, nsd: -500.0, msxdTopo: 35.0, msxdBase: -20.0, msydTopo: 20.0, msydBase: -10.0 },
    { id: 2, nsd: -750.0, msxdTopo: 25.0, msxdBase: 25.0, msydTopo: 15.0, msydBase: 15.0 },
    { id: 3, nsd: -400.0, msxdTopo: 30.0, msxdBase: -15.0, msydTopo: 18.0, msydBase: -9.0 }
  ];

  el.windowTitle.textContent = 'PCalc 1.4 Web - [Pilar Retangular 20×40]';
  atualizarTodaInterface();
}

function carregarPresetCircular() {
  engine.secao.tipo = 'Circular';
  engine.secao.hx = 35.0; // Diâmetro
  engine.secao.hy = 35.0;
  engine.secao.l = 320.0;
  engine.secao.tipoVinculacao = 1;

  engine.fck = 35.0;
  engine.configurarArmacaoRapida(4, 4, 16.0, 3.5);
  engine.metodoSegOrd = 5;

  engine.esforcos = [
    { id: 1, nsd: -650.0, msxdTopo: 40.0, msxdBase: -25.0, msydTopo: 25.0, msydBase: -15.0 }
  ];

  el.windowTitle.textContent = 'PCalc 1.4 Web - [Pilar Circular Ø35]';
  atualizarTodaInterface();
  executarCalculo();
}

function carregarPresetAltaEsbeltez() {
  engine.secao.tipo = 'Retangular';
  engine.secao.hx = 16.0;
  engine.secao.hy = 40.0;
  engine.secao.l = 480.0; // λx = 104
  engine.secao.tipoVinculacao = 1;

  engine.fck = 30.0;
  engine.configurarArmacaoRapida(2, 4, 16.0, 3.5);
  engine.metodoSegOrd = 5;

  engine.esforcos = [
    { id: 1, nsd: -420.0, msxdTopo: 22.0, msxdBase: -15.0, msydTopo: 18.0, msydBase: -9.0 }
  ];

  el.windowTitle.textContent = 'PCalc 1.4 Web - [Pilar Alta Esbeltez λ>90]';
  atualizarTodaInterface();
  executarCalculo();
}

// =============================================================================
// GERENCIAMENTO DE PROJETO (NOVO, SALVAR / GRAVAR E ABRIR)
// =============================================================================
function iniciarNovoProjeto(perguntar = false) {
  if (perguntar && !confirm('Deseja iniciar um novo projeto do zero? As alterações não salvas serão perdidas.')) {
    return;
  }
  engine.secao.tipo = 'Retangular';
  engine.secao.hx = 20.0;
  engine.secao.hy = 20.0;
  engine.secao.hx2 = 0;
  engine.secao.hy2 = 0;
  engine.secao.l = 300.0;
  engine.secao.tipoVinculacao = 1;

  engine.fck = 30.0;
  engine.fyk = 500.0;
  engine.gamaC = 1.40;
  engine.gamaS = 1.15;
  engine.gamaF = 1.40;
  engine.gamaF3 = 1.10;
  engine.es = 210.0;

  engine.limparArmaduras();
  engine.metodoSegOrd = 5;
  engine.considerarSegundaOrdem = 2;
  engine.limitarMb = true;

  engine.esforcos = [
    { id: 1, nsd: -200.0, msxdTopo: 0.0, msxdBase: 0.0, msydTopo: 0.0, msydBase: 0.0 }
  ];

  estado.combAtivaIdx = 0;
  estado.secAtivaIdx = null;
  estado.ultimoResultado = null;

  el.windowTitle.textContent = 'PCalc 1.4 Web - [Novo Pilar]';
  atualizarTodaInterface();
  executarCalculo();
  abrirDialogGeometria();
  el.sbStatusMsg.textContent = 'Novo projeto iniciado do zero. Configure a geometria do pilar.';
}

function gravarProjetoEmArquivo(salvarComo = false) {
  const nomePilar = el.windowTitle.textContent.replace('PCalc 1.4 Web - ', '').replace(/[\[\]]/g, '').trim() || 'Pilar';
  const dados = {
    software: 'PCalc 1.4 Web',
    versao: '1.4',
    dataSalvamento: new Date().toISOString(),
    nome: nomePilar,
    secao: { ...engine.secao },
    materiais: {
      fck: engine.fck,
      gamaC: engine.gamaC,
      fyk: engine.fyk,
      gamaS: engine.gamaS,
      gamaF: engine.gamaF,
      gamaF3: engine.gamaF3,
      es: engine.es
    },
    barras: engine.barras.map(b => ({ x: b.x, y: b.y, fi: b.fi })),
    esforcos: engine.esforcos.map(e => ({ ...e })),
    configuracoes: {
      metodoSegOrd: engine.metodoSegOrd,
      considerarSegundaOrdem: engine.considerarSegundaOrdem,
      limitarMb: engine.limitarMb,
      criterios: { ...engine.criterios }
    }
  };

  const jsonStr = JSON.stringify(dados, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = `${nomePilar.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')}.pcalc`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  el.sbStatusMsg.textContent = `Projeto gravado com sucesso em "${filename}".`;
}

function abrirProjetoDeArquivo(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.secao) Object.assign(engine.secao, data.secao);
      if (data.materiais) {
        engine.fck = data.materiais.fck ?? engine.fck;
        engine.gamaC = data.materiais.gamaC ?? engine.gamaC;
        engine.fyk = data.materiais.fyk ?? engine.fyk;
        engine.gamaS = data.materiais.gamaS ?? engine.gamaS;
        engine.gamaF = data.materiais.gamaF ?? engine.gamaF;
        engine.gamaF3 = data.materiais.gamaF3 ?? engine.gamaF3;
        engine.es = data.materiais.es ?? engine.es;
      }
      engine.limparArmaduras();
      if (Array.isArray(data.barras)) {
        data.barras.forEach(b => {
          engine.adicionarBarra(b.x, b.y, b.fi, true);
        });
      }
      if (Array.isArray(data.esforcos) && data.esforcos.length > 0) {
        engine.esforcos = data.esforcos.map(esf => ({ ...esf }));
      }
      if (data.configuracoes) {
        engine.metodoSegOrd = data.configuracoes.metodoSegOrd ?? engine.metodoSegOrd;
        engine.considerarSegundaOrdem = data.configuracoes.considerarSegundaOrdem ?? engine.considerarSegundaOrdem;
        engine.limitarMb = data.configuracoes.limitarMb ?? engine.limitarMb;
        if (data.configuracoes.criterios) Object.assign(engine.criterios, data.configuracoes.criterios);
      }
      const nome = data.nome || file.name.replace(/\.[^/.]+$/, '');
      el.windowTitle.textContent = `PCalc 1.4 Web - [${nome}]`;
      estado.combAtivaIdx = 0;
      estado.secAtivaIdx = null;
      atualizarTodaInterface();
      executarCalculo();
      el.sbStatusMsg.textContent = `Projeto "${nome}" carregado com sucesso.`;
    } catch (err) {
      alert('Erro ao abrir o arquivo: O formato do arquivo é inválido ou corrompido.');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function copiarRelatorioTexto() {
  const texto = gerarTextoRelatorioCompleto();
  navigator.clipboard.writeText(texto).then(() => {
    el.sbStatusMsg.textContent = 'Memória de cálculo copiada para a área de transferência com sucesso.';
    if (el.btnCopiarRelatorio) el.btnCopiarRelatorio.textContent = '✓ Copiado!';
    if (el.btnCopiarRelatorio2) el.btnCopiarRelatorio2.textContent = '✓ Copiado!';
    setTimeout(() => {
      if (el.btnCopiarRelatorio) el.btnCopiarRelatorio.textContent = '📋 Copiar Texto';
      if (el.btnCopiarRelatorio2) el.btnCopiarRelatorio2.textContent = 'Copiar Texto';
    }, 2000);
  }).catch(() => {
    alert('Não foi possível copiar automaticamente para a área de transferência.');
  });
}

function baixarRelatorioTxt() {
  const texto = gerarTextoRelatorioCompleto();
  const nomePilar = el.windowTitle.textContent.replace('PCalc 1.4 Web - ', '').replace(/[\[\]]/g, '').trim() || 'Pilar';
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = `memoria_calculo_${nomePilar.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')}.txt`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  el.sbStatusMsg.textContent = `Memória de cálculo salva como "${filename}".`;
}

function gerarPdfRelatorio() {
  el.reportContentArea.innerHTML = gerarHtmlRelatorioCompleto();
  const nomePilar = el.windowTitle.textContent.replace('PCalc 1.4 Web - ', '').replace(/[\[\]]/g, '').trim() || 'Pilar';
  const filename = `memoria_calculo_${nomePilar.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')}.pdf`;

  el.sbStatusMsg.textContent = 'Gerando documento PDF da memória de cálculo...';

  if (typeof window.html2pdf !== 'undefined') {
    // Clona o relatório para estilização perfeita em folha A4 com fundo branco
    const elemento = document.createElement('div');
    elemento.innerHTML = el.reportContentArea.innerHTML;
    elemento.style.width = '740px';
    elemento.style.padding = '20px';
    elemento.style.background = '#ffffff';
    elemento.style.color = '#0f172a';
    elemento.style.fontFamily = 'Inter, Segoe UI, Arial, sans-serif';

    // Ajusta estilos no clone para folha A4 limpa
    elemento.querySelectorAll('.report-header').forEach(h => {
      h.style.borderBottom = '2px solid #0284c7';
      h.style.paddingBottom = '10px';
      h.style.marginBottom = '15px';
    });
    elemento.querySelectorAll('.report-title').forEach(t => {
      t.style.color = '#0369a1';
      t.style.fontSize = '18px';
      t.style.fontWeight = 'bold';
    });
    elemento.querySelectorAll('.report-section').forEach(s => {
      s.style.background = '#ffffff';
      s.style.border = '1px solid #cbd5e1';
      s.style.borderRadius = '6px';
      s.style.padding = '12px';
      s.style.marginBottom = '14px';
      s.style.pageBreakInside = 'avoid';
    });
    elemento.querySelectorAll('.report-section-title').forEach(st => {
      st.style.color = '#0f172a';
      st.style.fontWeight = 'bold';
      st.style.borderBottom = '1px solid #e2e8f0';
      st.style.paddingBottom = '4px';
      st.style.marginBottom = '8px';
    });
    elemento.querySelectorAll('.report-table').forEach(tbl => {
      tbl.style.width = '100%';
      tbl.style.borderCollapse = 'collapse';
      tbl.style.fontSize = '11px';
      tbl.style.maxHeight = 'none';
      tbl.style.overflow = 'visible';
      tbl.style.display = 'table';
    });
    elemento.querySelectorAll('.report-table th').forEach(th => {
      th.style.background = '#f1f5f9';
      th.style.color = '#0f172a';
      th.style.border = '1px solid #cbd5e1';
      th.style.padding = '6px';
      th.style.fontWeight = '600';
    });
    elemento.querySelectorAll('.report-table td').forEach(td => {
      td.style.border = '1px solid #e2e8f0';
      td.style.padding = '4px 6px';
      td.style.color = '#1e293b';
    });

    const opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    window.html2pdf().set(opt).from(elemento).save().then(() => {
      el.sbStatusMsg.textContent = `PDF "${filename}" gerado e baixado com sucesso.`;
    }).catch(err => {
      console.warn('html2pdf falhou, acionando fallback de impressão:', err);
      imprimirRelatorioMemoria();
    });
  } else {
    imprimirRelatorioMemoria();
  }
}

function imprimirRelatorioMemoria() {
  el.reportContentArea.innerHTML = gerarHtmlRelatorioCompleto();
  abrirModal(el.modalMemoria);
  setTimeout(() => {
    window.print();
  }, 150);
}

// =============================================================================
// MODAIS: ABERTURA, FECHAMENTO E SALVAMENTO
// =============================================================================
function abrirModal(modal) {
  if (!modal) return;
  modal.classList.add('open');
}

function fecharModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
}

function fecharTodosModais() {
  document.querySelectorAll('.pcalc-modal-backdrop').forEach(m => m.classList.remove('open'));
}

function configurarEventosModais() {
  // Fechar no clique fora ou no botão 'X' / 'Cancelar'
  document.querySelectorAll('.dialog-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.pcalc-modal-backdrop');
      fecharModal(modal);
    });
  });

  // Fechar com a tecla ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharTodosModais();
  });

  // Toolbar Triggers
  if (el.btnToolNovo) el.btnToolNovo.addEventListener('click', () => iniciarNovoProjeto());
  if (el.btnToolAbrir) el.btnToolAbrir.addEventListener('click', () => el.inputAbrirArquivo.click());
  if (el.btnToolSalvar) el.btnToolSalvar.addEventListener('click', () => gravarProjetoEmArquivo(false));
  if (el.inputAbrirArquivo) {
    el.inputAbrirArquivo.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        abrirProjetoDeArquivo(e.target.files[0]);
        el.inputAbrirArquivo.value = '';
      }
    });
  }

  el.btnToolGeometria.addEventListener('click', () => abrirDialogGeometria());
  el.btnToolMateriais.addEventListener('click', () => abrirDialogMateriais());
  el.btnToolArmacao.addEventListener('click', () => abrirDialogArmacao('rapida'));
  el.btnToolArmacaoMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    el.dropdownArmacaoOptions.style.display = el.dropdownArmacaoOptions.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', () => { el.dropdownArmacaoOptions.style.display = 'none'; });
  el.optArmacaoRapida.addEventListener('click', () => abrirDialogArmacao('rapida'));
  el.optArmacaoCoord.addEventListener('click', () => abrirDialogArmacao('coord'));
  el.btnSecaoCoordDirect.addEventListener('click', () => abrirDialogArmacao('coord'));

  el.btnToolEsforcos.addEventListener('click', () => abrirDialogEsforcos());
  el.btnTool2Ord.addEventListener('click', () => abrirDialog2Ord());
  el.btnToolCriterios.addEventListener('click', () => abrirDialogCriterios());
  el.btnToolCalcular.addEventListener('click', () => executarCalculo());
  el.btnToolAvisos.addEventListener('click', () => abrirDialogAvisos());
  el.btnToolMemoria.addEventListener('click', () => abrirDialogMemoria());

  // Menubar Triggers
  if (el.menuNovo) el.menuNovo.addEventListener('click', () => iniciarNovoProjeto());
  if (el.menuAbrir) el.menuAbrir.addEventListener('click', () => el.inputAbrirArquivo.click());
  if (el.menuSalvar) el.menuSalvar.addEventListener('click', () => gravarProjetoEmArquivo(false));
  if (el.menuSalvarComo) el.menuSalvarComo.addEventListener('click', () => gravarProjetoEmArquivo(true));
  if (el.menuExportarTxt) el.menuExportarTxt.addEventListener('click', () => baixarRelatorioTxt());

  el.menuExemploPadrao.addEventListener('click', () => carregarPresetPadrao());
  el.menuExemploCircular.addEventListener('click', () => carregarPresetCircular());
  el.menuExemploEsbelto.addEventListener('click', () => carregarPresetAltaEsbeltez());
  el.menuImprimir.addEventListener('click', () => gerarPdfRelatorio());

  el.menuGeometria.addEventListener('click', () => abrirDialogGeometria());
  el.menuMateriais.addEventListener('click', () => abrirDialogMateriais());
  el.menuArmacaoRapida.addEventListener('click', () => abrirDialogArmacao('rapida'));
  el.menuArmacaoCoord.addEventListener('click', () => abrirDialogArmacao('coord'));
  el.menuApagarArmaduras.addEventListener('click', () => {
    if (confirm('Deseja realmente apagar todas as armaduras do pilar?')) {
      engine.limparArmaduras();
      atualizarTodaInterface();
      executarCalculo();
    }
  });

  el.menuEsforcos.addEventListener('click', () => abrirDialogEsforcos());
  el.menu2Ord.addEventListener('click', () => abrirDialog2Ord());
  el.menuCriterios.addEventListener('click', () => abrirDialogCriterios());

  el.menuVerFCO.addEventListener('click', () => ativarToggleGrafico('fco'));
  el.menuVerFCNx.addEventListener('click', () => ativarToggleGrafico('fcnx'));
  el.menuVerFCNy.addEventListener('click', () => ativarToggleGrafico('fcny'));
  el.menuVerDeformacao.addEventListener('click', () => ativarToggleGrafico('deformacao'));
  el.menuVerTensao.addEventListener('click', () => ativarToggleGrafico('tensao'));
  el.menuAvisos.addEventListener('click', () => abrirDialogAvisos());
  el.menuMemoria.addEventListener('click', () => abrirDialogMemoria());
  el.menuSobre.addEventListener('click', () => abrirModal(el.modalSobre));

  // Salvamentos dos Modais
  el.btnSalvarGeometria.addEventListener('click', salvarDialogGeometria);
  el.btnSalvarMateriais.addEventListener('click', salvarDialogMateriais);
  el.btnSalvarArmacao.addEventListener('click', () => {
    fecharModal(el.modalArmacao);
    atualizarTodaInterface();
    executarCalculo();
  });
  el.btnSalvarEsforcos.addEventListener('click', salvarDialogEsforcos);
  el.btnSalvar2Ord.addEventListener('click', salvarDialog2Ord);
  el.btnSalvarCriterios.addEventListener('click', salvarDialogCriterios);

  // Relatório Impressão e Exportação
  if (el.btnCopiarRelatorio) el.btnCopiarRelatorio.addEventListener('click', copiarRelatorioTexto);
  if (el.btnCopiarRelatorio2) el.btnCopiarRelatorio2.addEventListener('click', copiarRelatorioTexto);
  if (el.btnBaixarRelatorioTxt) el.btnBaixarRelatorioTxt.addEventListener('click', baixarRelatorioTxt);
  if (el.btnBaixarRelatorioTxt2) el.btnBaixarRelatorioTxt2.addEventListener('click', baixarRelatorioTxt);
  if (el.btnGerarRelatorioPdf) el.btnGerarRelatorioPdf.addEventListener('click', gerarPdfRelatorio);
  if (el.btnGerarRelatorioPdf2) el.btnGerarRelatorioPdf2.addEventListener('click', gerarPdfRelatorio);
  if (el.btnPrintReport) el.btnPrintReport.addEventListener('click', imprimirRelatorioMemoria);
  if (el.btnPrintReport2) el.btnPrintReport2.addEventListener('click', imprimirRelatorioMemoria);
}

// -----------------------------------------------------------------------------
// 1. DIÁLOGO GEOMETRIA
// -----------------------------------------------------------------------------
function abrirDialogGeometria() {
  el.dlgSecaoTipo.value = engine.secao.tipo;
  el.dlgSecaoHx.value = engine.secao.hx;
  el.dlgSecaoHy.value = engine.secao.hy;
  el.dlgSecaoHx2.value = engine.secao.hx2 || 10;
  el.dlgSecaoHy2.value = engine.secao.hy2 || 20;
  el.dlgSecaoL.value = (engine.secao.l / 100).toFixed(1);
  el.dlgSecaoVinculacao.value = engine.secao.tipoVinculacao;

  atualizarCamposTipoSecao();
  abrirModal(el.modalGeometria);
}

function atualizarCamposTipoSecao() {
  const tipo = el.dlgSecaoTipo.value;
  if (tipo === 'Circular') {
    el.rowDimY.style.display = 'none';
    el.lblDimX.textContent = 'Diâmetro D (cm):';
    el.rowVazado.style.display = 'none';
  } else if (tipo === 'Circular Vazada') {
    el.rowDimY.style.display = 'none';
    el.lblDimX.textContent = 'Diâmetro externo Dext (cm):';
    el.rowVazado.style.display = 'grid';
    document.getElementById('colDimY2').style.display = 'none';
  } else if (tipo === 'Retangular Vazada') {
    el.rowDimY.style.display = 'flex';
    el.lblDimX.textContent = 'Largura externa hx (cm):';
    el.lblDimY.textContent = 'Altura externa hy (cm):';
    el.rowVazado.style.display = 'grid';
    document.getElementById('colDimY2').style.display = 'flex';
  } else {
    // Retangular padrão
    el.rowDimY.style.display = 'flex';
    el.lblDimX.textContent = 'Largura hx (cm):';
    el.lblDimY.textContent = 'Altura hy (cm):';
    el.rowVazado.style.display = 'none';
  }
}
el.dlgSecaoTipo.addEventListener('change', atualizarCamposTipoSecao);

function salvarDialogGeometria() {
  engine.secao.tipo = el.dlgSecaoTipo.value;
  engine.secao.hx = parseFloat(el.dlgSecaoHx.value) || 20;
  engine.secao.hy = (engine.secao.tipo === 'Circular' || engine.secao.tipo === 'Circular Vazada')
    ? engine.secao.hx
    : (parseFloat(el.dlgSecaoHy.value) || 40);

  engine.secao.hx2 = parseFloat(el.dlgSecaoHx2.value) || 0;
  engine.secao.hy2 = parseFloat(el.dlgSecaoHy2.value) || 0;
  engine.secao.l = (parseFloat(el.dlgSecaoL.value) || 3.0) * 100;
  engine.secao.tipoVinculacao = parseInt(el.dlgSecaoVinculacao.value, 10);

  fecharModal(el.modalGeometria);
  atualizarTodaInterface();
  executarCalculo();
}

// -----------------------------------------------------------------------------
// 2. DIÁLOGO MATERIAIS COM DIGITAÇÃO LIVRE DO FCK E NBR 6118
// -----------------------------------------------------------------------------
function abrirDialogMateriais() {
  el.dlgFckDigitado.value = engine.fck;
  el.dlgSliderFck.value = engine.fck;
  el.dlgGamaC.value = engine.gamaC.toFixed(2);
  el.dlgFyk.value = engine.fyk;
  el.dlgGamaS.value = engine.gamaS.toFixed(2);
  el.dlgEs.value = engine.es;

  atualizarCalculoMateriaisDinâmico();
  abrirModal(el.modalMateriais);
}

function configurarEventosMateriais() {
  // Digitação livre de fck
  el.dlgFckDigitado.addEventListener('input', () => {
    let f = parseFloat(el.dlgFckDigitado.value);
    if (!isNaN(f) && f > 0) {
      el.dlgSliderFck.value = f;
      atualizarCalculoMateriaisDinâmico();
    }
  });

  // Slider de fck
  el.dlgSliderFck.addEventListener('input', () => {
    el.dlgFckDigitado.value = el.dlgSliderFck.value;
    atualizarCalculoMateriaisDinâmico();
  });

  // Chips rápidos C20..C80
  document.querySelectorAll('.chip-fck').forEach(chip => {
    chip.addEventListener('click', () => {
      const v = parseFloat(chip.dataset.val);
      el.dlgFckDigitado.value = v;
      el.dlgSliderFck.value = v;
      document.querySelectorAll('.chip-fck').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      atualizarCalculoMateriaisDinâmico();
    });
  });

  el.dlgGamaC.addEventListener('input', atualizarCalculoMateriaisDinâmico);

  el.dlgAcoTipo.addEventListener('change', () => {
    const f = parseFloat(el.dlgAcoTipo.value);
    el.dlgFyk.value = f;
  });
}

function atualizarCalculoMateriaisDinâmico() {
  const fck = parseFloat(el.dlgFckDigitado.value) || 30;
  const gamaC = parseFloat(el.dlgGamaC.value) || 1.40;
  const fcd = (fck / 10) / gamaC;
  el.dlgValFcd.value = fcd.toFixed(2);

  const { etaC, n, ec2, ecu } = parametrosConcretoNBR(fck);
  const fcdMax = 0.85 * etaC * fcd;

  el.lblDetalhesNBR.innerHTML = `
    <div>&bull; Fator de redução &eta;c: <strong>${etaC.toFixed(3)}</strong> ${fck > 40 ? '(fck > 40 MPa: (40/fck)^(1/3))' : '(fck &le; 40 MPa: 1.0)'}</div>
    <div>&bull; Expoente da parábola n: <strong>${n.toFixed(2)}</strong> ${fck > 50 ? '(reduzido conforme NBR 6118)' : '(fck &le; 50 MPa: 2.0)'}</div>
    <div>&bull; Deformação de pico &epsilon;c2: <strong>${ec2.toFixed(2)} &permil;</strong> | Última &epsilon;cu: <strong>${ecu.toFixed(2)} &permil;</strong></div>
    <div>&bull; Tensão de pico plástica: <strong>${fcdMax.toFixed(2)} kN/cm²</strong></div>
  `;

  // Renderiza gráfico da lei constitutiva
  renderer.renderizarDiagramaConcretoNBR(el.canvasLeiConcreto, fck, gamaC);
}

function salvarDialogMateriais() {
  engine.fck = parseFloat(el.dlgFckDigitado.value) || 30;
  engine.gamaC = parseFloat(el.dlgGamaC.value) || 1.40;
  engine.fyk = parseFloat(el.dlgFyk.value) || 500;
  engine.gamaS = parseFloat(el.dlgGamaS.value) || 1.15;
  engine.es = parseFloat(el.dlgEs.value) || 210;

  fecharModal(el.modalMateriais);
  atualizarTodaInterface();
  executarCalculo();
}

// -----------------------------------------------------------------------------
// 3. DIÁLOGO ARMAÇÃO (EDIÇÃO RÁPIDA E POR COORDENADAS)
// -----------------------------------------------------------------------------
function abrirDialogArmacao(aba = 'rapida') {
  ativarAbaArmacao(aba);
  sincronizarTabelaBarrasCoord();
  abrirModal(el.modalArmacao);
}

function ativarAbaArmacao(aba) {
  estado.abaArmacaoAtiva = aba;
  if (aba === 'rapida') {
    el.tabArmacaoBtnRapida.classList.add('active');
    el.tabArmacaoBtnCoord.classList.remove('active');
    el.paneArmacaoRapida.classList.add('active');
    el.paneArmacaoCoord.classList.remove('active');
  } else {
    el.tabArmacaoBtnCoord.classList.add('active');
    el.tabArmacaoBtnRapida.classList.remove('active');
    el.paneArmacaoCoord.classList.add('active');
    el.paneArmacaoRapida.classList.remove('active');
    atualizarModoCoordenadasInputs();
  }
}

function configurarEventosArmacaoCoord() {
  el.tabArmacaoBtnRapida.addEventListener('click', () => ativarAbaArmacao('rapida'));
  el.tabArmacaoBtnCoord.addEventListener('click', () => ativarAbaArmacao('coord'));

  // Mudança do rádio Barra / Linha / Arco
  document.querySelectorAll('input[name="modoCoord"]').forEach(rd => {
    rd.addEventListener('change', atualizarModoCoordenadasInputs);
  });

  // Botão Gerar Armação Rápida
  el.btnGerarArmacaoRapida.addEventListener('click', () => {
    const nx = parseInt(el.dlgArmNx.value, 10) || 2;
    const ny = parseInt(el.dlgArmNy.value, 10) || 3;
    const fi = parseFloat(el.dlgArmFi.value) || 12.5;
    const dLinha = parseFloat(el.dlgArmDLinha.value) || 3.5;

    engine.configurarArmacaoRapida(nx, ny, fi, dLinha);
    sincronizarTabelaBarrasCoord();
    renderer.renderizarSecao(el.canvasSecao, engine);
  });

  // Botão Inserir Barra(s) por Coordenadas
  el.btnInserirBarraCoord.addEventListener('click', inserirBarrasPorCoordenadas);

  // Botão Limpar Armaduras
  el.btnLimparTodasBarras.addEventListener('click', () => {
    if (confirm('Deseja apagar todas as armaduras cadastradas?')) {
      engine.limparArmaduras();
      sincronizarTabelaBarrasCoord();
      renderer.renderizarSecao(el.canvasSecao, engine);
    }
  });
}

function atualizarModoCoordenadasInputs() {
  const modo = document.querySelector('input[name="modoCoord"]:checked').value;
  if (modo === 'linha') {
    el.colNumBarrasLinha.style.display = 'flex';
    el.colXf.style.display = 'flex';
    el.colYf.style.display = 'flex';
    document.getElementById('lblXi').textContent = 'xi inicial (cm):';
    document.getElementById('lblYi').textContent = 'yi inicial (cm):';
  } else {
    el.colNumBarrasLinha.style.display = 'none';
    el.colXf.style.display = 'none';
    el.colYf.style.display = 'none';
    document.getElementById('lblXi').textContent = 'X (cm):';
    document.getElementById('lblYi').textContent = 'Y (cm):';
  }

  // Se seção for circular, mostra opção de arco
  if (engine.secao.tipo === 'Circular' || engine.secao.tipo === 'Circular Vazada') {
    document.getElementById('lblCoordArco').style.display = 'inline-flex';
  } else {
    document.getElementById('lblCoordArco').style.display = 'none';
  }
}

function inserirBarrasPorCoordenadas() {
  const modo = document.querySelector('input[name="modoCoord"]:checked').value;
  const fi = parseFloat(el.dlgCoordFi.value) || 12.5;
  const xi = parseFloat(el.dlgCoordXi.value) || 0;
  const yi = parseFloat(el.dlgCoordYi.value) || 0;

  if (modo === 'barra') {
    // Adiciona barra individual
    const sucesso = engine.adicionarBarra(xi, yi, fi, false);
    if (!sucesso) {
      alert('Atenção: A barra informada fica fora dos limites da seção transversal do concreto!');
      return;
    }
  } else if (modo === 'linha') {
    const xf = parseFloat(el.dlgCoordXf.value) || 0;
    const yf = parseFloat(el.dlgCoordYf.value) || 0;
    const n = parseInt(el.dlgCoordN.value, 10) || 2;
    if (n < 1) return;

    const inseridas = engine.adicionarLinhaBarras(xi, yi, xf, yf, n, fi, false);
    if (inseridas < n) {
      alert(`Aviso: Apenas ${inseridas} de ${n} barras puderam ser inseridas dentro da seção.`);
    }
  } else if (modo === 'arco') {
    const n = parseInt(el.dlgCoordN.value, 10) || 4;
    const r = xi; // Raio inserido no campo Xi
    engine.adicionarArcoBarras(r, 0, 360, n, fi);
  }

  sincronizarTabelaBarrasCoord();
  renderer.renderizarSecao(el.canvasSecao, engine);
}

function sincronizarTabelaBarrasCoord() {
  el.tbodyBarrasCoord.innerHTML = '';
  const barras = engine.barras;

  for (let i = 0; i < barras.length; i++) {
    const b = barras[i];
    const coordsAmigaveis = engine.deCentro(b.x, b.y);
    const area = Math.PI * Math.pow(b.fi / 20, 2);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>Ø ${b.fi.toFixed(1)}</td>
      <td>${coordsAmigaveis.x.toFixed(1)}</td>
      <td>${coordsAmigaveis.y.toFixed(1)}</td>
      <td>${area.toFixed(2)}</td>
      <td><button class="btn-remove-barra" data-idx="${i}" title="Remover barra">&times;</button></td>
    `;
    el.tbodyBarrasCoord.appendChild(tr);
  }

  // Evento de remover barra
  el.tbodyBarrasCoord.querySelectorAll('.btn-remove-barra').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      engine.removerBarra(idx);
      sincronizarTabelaBarrasCoord();
      renderer.renderizarSecao(el.canvasSecao, engine);
    });
  });

  // Atualiza banner de resumo
  const total = barras.length;
  const asTotal = engine.areaAcoTotal;
  const taxa = engine.taxaArmadura;

  el.lblResumoTotalBarras.textContent = `${total} barra${total === 1 ? '' : 's'}`;
  el.lblResumoAreaAs.textContent = `${asTotal.toFixed(2)} cm²`;
  el.lblResumoTaxaAs.textContent = `${taxa.toFixed(2)} %`;
}

// -----------------------------------------------------------------------------
// 4. DIÁLOGO ESFORÇOS SOLICITANTES
// -----------------------------------------------------------------------------
function abrirDialogEsforcos() {
  el.dlgGamaF.value = engine.gamaF.toFixed(2);
  sincronizarTabelaEsforcosModal();
  abrirModal(el.modalEsforcos);
}

function sincronizarTabelaEsforcosModal() {
  el.tbodyEsforcosModal.innerHTML = '';
  engine.esforcos.forEach((comb, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td><input type="number" class="inp-comb-nsd" data-idx="${idx}" value="${comb.nsd}" step="10"></td>
      <td><input type="number" class="inp-comb-msxt" data-idx="${idx}" value="${comb.msxdTopo}" step="5"></td>
      <td><input type="number" class="inp-comb-msxb" data-idx="${idx}" value="${comb.msxdBase}" step="5"></td>
      <td><input type="number" class="inp-comb-msyt" data-idx="${idx}" value="${comb.msydTopo}" step="5"></td>
      <td><input type="number" class="inp-comb-msyb" data-idx="${idx}" value="${comb.msydBase}" step="5"></td>
      <td style="text-align:center;"><button class="btn-remove-barra btn-del-comb" data-idx="${idx}">&times;</button></td>
    `;
    el.tbodyEsforcosModal.appendChild(tr);
  });

  el.tbodyEsforcosModal.querySelectorAll('.btn-del-comb').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (engine.esforcos.length <= 1) {
        alert('É necessário ter pelo menos uma combinação de esforços cadastrada.');
        return;
      }
      engine.esforcos.splice(idx, 1);
      sincronizarTabelaEsforcosModal();
    });
  });
}

el.btnAddCombRow.addEventListener('click', () => {
  const novoId = engine.esforcos.length + 1;
  engine.esforcos.push({
    id: novoId,
    nsd: -500.0,
    msxdTopo: 20.0,
    msxdBase: -10.0,
    msydTopo: 15.0,
    msydBase: -7.5
  });
  sincronizarTabelaEsforcosModal();
});

function salvarDialogEsforcos() {
  engine.gamaF = parseFloat(el.dlgGamaF.value) || 1.40;

  // Lê todas as linhas da tabela
  const rows = el.tbodyEsforcosModal.querySelectorAll('tr');
  const novasCombs = [];
  rows.forEach((row, idx) => {
    novasCombs.push({
      id: idx + 1,
      nsd: parseFloat(row.querySelector('.inp-comb-nsd').value) || 0,
      msxdTopo: parseFloat(row.querySelector('.inp-comb-msxt').value) || 0,
      msxdBase: parseFloat(row.querySelector('.inp-comb-msxb').value) || 0,
      msydTopo: parseFloat(row.querySelector('.inp-comb-msyt').value) || 0,
      msydBase: parseFloat(row.querySelector('.inp-comb-msyb').value) || 0
    });
  });

  engine.esforcos = novasCombs;
  fecharModal(el.modalEsforcos);
  atualizarTodaInterface();
  executarCalculo();
}

// -----------------------------------------------------------------------------
// 5. DIÁLOGO 2ª ORDEM LOCAL (5 MÉTODOS E OPÇÕES)
// -----------------------------------------------------------------------------
function abrirDialog2Ord() {
  // Opção de cálculo
  if (engine.considerarSegundaOrdem === 1) el.rdCalc2Ord1.checked = true;
  else if (engine.considerarSegundaOrdem === 2) el.rdCalc2Ord2.checked = true;
  else el.rdCalc2Ord3.checked = true;

  // Métodos de 1 a 5
  if (engine.metodoSegOrd === 1) el.rdMetodo1.checked = true;
  else if (engine.metodoSegOrd === 2) el.rdMetodo2.checked = true;
  else if (engine.metodoSegOrd === 3) el.rdMetodo3.checked = true;
  else if (engine.metodoSegOrd === 4) el.rdMetodo4.checked = true;
  else el.rdMetodo5.checked = true;

  el.dlgCheckLimMb.checked = engine.limitarMb;
  el.dlgGamaF3.value = engine.gamaF3.toFixed(2);

  abrirModal(el.modal2Ord);
}

function salvarDialog2Ord() {
  const optCalc = document.querySelector('input[name="optCalcular2Ord"]:checked').value;
  engine.considerarSegundaOrdem = parseInt(optCalc, 10);

  const optMetodo = document.querySelector('input[name="optMetodo2Ord"]:checked').value;
  engine.metodoSegOrd = parseInt(optMetodo, 10);

  engine.limitarMb = el.dlgCheckLimMb.checked;
  engine.gamaF3 = parseFloat(el.dlgGamaF3.value) || 1.10;

  fecharModal(el.modal2Ord);
  atualizarTodaInterface();
  executarCalculo();
}

// -----------------------------------------------------------------------------
// 6. DIÁLOGO CRITÉRIOS
// -----------------------------------------------------------------------------
function abrirDialogCriterios() {
  el.dlgCheckMomentoMin.checked = engine.criterios.momentoMinimo;
  el.dlgTaxaMin.value = engine.criterios.taxaMin.toFixed(2);
  el.dlgTaxaMax.value = engine.criterios.taxaMax.toFixed(2);
  el.dlgNFibras.value = engine.criterios.nFibras;
  el.dlgNPtsMr.value = engine.criterios.nPtsMr;
  el.dlgTolN.value = engine.criterios.tolN;
  el.dlgTolLN.value = engine.criterios.tolLN;

  abrirModal(el.modalCriterios);
}

function salvarDialogCriterios() {
  engine.criterios.momentoMinimo = el.dlgCheckMomentoMin.checked;
  engine.criterios.taxaMin = parseFloat(el.dlgTaxaMin.value) || 0.40;
  engine.criterios.taxaMax = parseFloat(el.dlgTaxaMax.value) || 4.00;
  engine.criterios.nFibras = parseInt(el.dlgNFibras.value, 10) || 400;
  engine.criterios.nPtsMr = parseInt(el.dlgNPtsMr.value, 10) || 72;
  engine.criterios.tolN = parseFloat(el.dlgTolN.value) || 0.05;
  engine.criterios.tolLN = parseFloat(el.dlgTolLN.value) || 0.001;

  fecharModal(el.modalCriterios);
  atualizarTodaInterface();
  executarCalculo();
}

// -----------------------------------------------------------------------------
// 7. DIÁLOGO AVISOS NORMATIVOS (NBR 6118)
// -----------------------------------------------------------------------------
function abrirDialogAvisos() {
  el.avisosListContainer.innerHTML = '';
  const avisos = gerarAvisosNormativos();

  if (avisos.length === 0) {
    el.avisosListContainer.innerHTML = `
      <div class="aviso-card info">
        <span>✓ Nenhuma não conformidade ou aviso detectado conforme a NBR 6118.</span>
      </div>
    `;
  } else {
    avisos.forEach(av => {
      const div = document.createElement('div');
      div.className = `aviso-card ${av.tipo}`;
      div.innerHTML = `<span>${av.icone}</span> <div><strong>${av.titulo}:</strong> ${av.texto}</div>`;
      el.avisosListContainer.appendChild(div);
    });
  }

  abrirModal(el.modalAvisos);
}

function gerarAvisosNormativos() {
  const avisos = [];
  const s = engine.secao;
  const p = engine.propriedadesGeometricas;

  // Dimensão mínima (item 13.2.3 NBR 6118)
  const menorDim = Math.min(s.hx, engine.dimY);
  if (menorDim < 19.0) {
    avisos.push({
      tipo: 'warning',
      icone: '⚠️',
      titulo: 'Dimensão Mínima de Pilar (Item 13.2.3)',
      texto: `A menor dimensão da seção é ${menorDim} cm (< 19 cm). A NBR 6118 permite até 14 cm mediante aplicação de coeficiente adicional γn.`
    });
  }

  // Esbeltez máxima (item 15.8.1: λ ≤ 140, excepcionalmente λ ≤ 200)
  if (p.lambdaX > 140 || p.lambdaY > 140) {
    avisos.push({
      tipo: 'danger',
      icone: '⛔',
      titulo: 'Esbeltez Elevada (Item 15.8.1)',
      texto: `Índice de esbeltez λ = ${Math.max(p.lambdaX, p.lambdaY).toFixed(1)} > 140. Pilares com λ > 140 só são permitidos em casos excepcionais (máx 200).`
    });
  }

  // Taxa de armadura mínima e máxima (item 17.3.5.3)
  const taxa = engine.taxaArmadura;
  if (taxa < engine.criterios.taxaMin) {
    avisos.push({
      tipo: 'warning',
      icone: '⚠️',
      titulo: 'Taxa de Armadura Inferior ao Mínimo (Item 17.3.5.3)',
      texto: `Taxa de armadura atual de ${taxa.toFixed(2)}% é inferior à taxa mínima exigida (${engine.criterios.taxaMin}%).`
    });
  }
  if (taxa > engine.criterios.taxaMax) {
    avisos.push({
      tipo: 'danger',
      icone: '⛔',
      titulo: 'Taxa de Armadura Excessiva (Item 17.3.5.3)',
      texto: `Taxa de armadura atual de ${taxa.toFixed(2)}% excede o limite normativo máximo de ${engine.criterios.taxaMax}%.`
    });
  }

  // Verificação de Segurança (FS)
  if (estado.ultimoResultado && estado.ultimoResultado.resultados) {
    const minFS = Math.min(...estado.ultimoResultado.resultados.map(r => r.seguranca ? r.seguranca.fs : 1.0));
    if (minFS < 1.0) {
      avisos.push({
        tipo: 'danger',
        icone: '⛔',
        titulo: 'Capacidade Resistente Insuficiente (ELS/ELU)',
        texto: `O fator de segurança mínimo obtido é FS = ${minFS.toFixed(2)} < 1.00. O pilar NÃO atende às solicitações de cálculo!`
      });
    }
  }

  return avisos;
}

// -----------------------------------------------------------------------------
// 8. DIÁLOGO MEMÓRIA DE CÁLCULO
// -----------------------------------------------------------------------------
function abrirDialogMemoria() {
  el.reportContentArea.innerHTML = gerarHtmlRelatorioCompleto();
  abrirModal(el.modalMemoria);
}

function gerarHtmlRelatorioCompleto() {
  const s = engine.secao;
  const p = engine.propriedadesGeometricas || {};
  const concNBR = parametrosConcretoNBR(engine.fck);
  const dataHora = new Date().toLocaleString('pt-BR');
  const nomePilar = el.windowTitle.textContent.replace('PCalc 1.4 Web - ', '').replace(/[\[\]]/g, '').trim() || 'Pilar';
  const res = estado.ultimoResultado;
  const minFS = (res && res.fsMinGeral !== undefined) ? res.fsMinGeral : 1.0;
  const seguro = minFS >= 1.0;

  const nomesMetodos = [
    '',
    'Pilar-Padrão com curvatura aproximada',
    'Pilar-Padrão com rigidez κ aproximada',
    'Pilar-Padrão acoplado com diagrama N, M, 1/r',
    'Método Geral acoplado com diagrama N, M, 1/r',
    'Método Geral acoplado com diagrama N, Mx, My, 1/r (direções acopladas)'
  ];

  let html = `
    <div class="report-header">
      <div class="report-title">PCALC 1.4 WEB — MEMÓRIA DE CÁLCULO ESTRUTURAL</div>
      <div class="report-subtitle">Dimensionamento de Pilares sob Flexão Composta Oblíqua conforme ABNT NBR 6118:2014 / Revisão 2026</div>
      <div style="margin-top:6px; font-size:11px; color:#cbd5e1;">
        <strong>Identificação do Pilar:</strong> ${nomePilar} &bull; <strong>Data/Hora de Emissão:</strong> ${dataHora}
      </div>
    </div>

    <!-- 1. GEOMETRIA E PROPRIEDADES DA SEÇÃO -->
    <div class="report-section">
      <div class="report-section-title">1. Dados da Seção Transversal e Geometria do Pilar</div>
      <div class="report-grid-3">
        <div>&bull; <strong>Tipo de Seção:</strong> ${s.tipo}</div>
        <div>&bull; <strong>Dimensões:</strong> ${s.hx} × ${engine.dimY} cm</div>
        <div>&bull; <strong>Área de Concreto (Ac):</strong> ${(p.Ac || p.ac || (s.hx * engine.dimY)).toFixed(1)} cm²</div>
        <div>&bull; <strong>Inércia Ix:</strong> ${(p.Ix || 0).toFixed(1)} cm⁴</div>
        <div>&bull; <strong>Inércia Iy:</strong> ${(p.Iy || 0).toFixed(1)} cm⁴</div>
        <div>&bull; <strong>Raio de Giração ix:</strong> ${(p.ix || 0).toFixed(2)} cm</div>
        <div>&bull; <strong>Raio de Giração iy:</strong> ${(p.iy || 0).toFixed(2)} cm</div>
        <div>&bull; <strong>Comprimento Livre L:</strong> ${(s.l / 100).toFixed(2)} m</div>
        <div>&bull; <strong>Comprimento Efetivo le:</strong> ${(p.le ? p.le / 100 : s.l / 100).toFixed(2)} m</div>
        <div>&bull; <strong>Esbeltez &lambda;x:</strong> ${(p.lambdaX || 0).toFixed(2)}</div>
        <div>&bull; <strong>Esbeltez &lambda;y:</strong> ${(p.lambdaY || 0).toFixed(2)}</div>
        <div>&bull; <strong>Esbeltez Máx &lambda;max:</strong> ${(p.lambdaMax || 0).toFixed(2)} ${p.lambdaMax > 90 ? '(Alta Esbeltez)' : '(Normal)'}</div>
      </div>
    </div>

    <!-- 2. MATERIAIS CONSTITUTIVOS -->
    <div class="report-section">
      <div class="report-section-title">2. Materiais Constitutivos (NBR 6118)</div>
      <div class="report-grid-2">
        <div>
          <div>&bull; <strong>Concreto fck:</strong> ${engine.fck} MPa | <strong>&gamma;c:</strong> ${engine.gamaC.toFixed(2)}</div>
          <div>&bull; <strong>Resistência de Cálculo fcd:</strong> ${engine.fcd.toFixed(2)} kN/cm²</div>
          <div>&bull; <strong>Fator de Redução &eta;c:</strong> ${concNBR.etaC.toFixed(3)} | <strong>Expoente n:</strong> ${concNBR.n.toFixed(2)}</div>
          <div>&bull; <strong>Deformações Limites:</strong> &epsilon;c2 = ${concNBR.ec2.toFixed(2)} &permil; | &epsilon;cu = ${concNBR.ecu.toFixed(2)} &permil;</div>
          <div>&bull; <strong>Tensão de Pico Plástica:</strong> ${(0.85 * concNBR.etaC * engine.fcd).toFixed(2)} kN/cm²</div>
        </div>
        <div>
          <div>&bull; <strong>Aço das Armaduras:</strong> CA-${engine.fyk / 10} | <strong>&gamma;s:</strong> ${engine.gamaS.toFixed(2)}</div>
          <div>&bull; <strong>Tensão de Escoamento fyd:</strong> ${(engine.fyk / (10 * engine.gamaS)).toFixed(2)} kN/cm²</div>
          <div>&bull; <strong>Módulo de Elasticidade Es:</strong> ${(engine.es || 210.0).toFixed(0)} GPa</div>
          <div>&bull; <strong>Deformação de Escoamento &epsilon;yd:</strong> ${(((engine.fyk / engine.gamaS) / (engine.modEs || 210000)) * 1000).toFixed(2)} &permil;</div>
        </div>
      </div>
    </div>

    <!-- 3. ARMADURA LONGITUDINAL -->
    <div class="report-section">
      <div class="report-section-title">3. Armadura Longitudinal e Disposição</div>
      <div class="report-grid-3">
        <div>&bull; <strong>Total de Barras:</strong> ${engine.barras.length}</div>
        <div>&bull; <strong>Área de Aço Total (As):</strong> ${engine.areaAcoTotal.toFixed(2)} cm²</div>
        <div>&bull; <strong>Taxa Geométrica (&rho;s):</strong> ${engine.taxaArmadura.toFixed(2)} % ${engine.taxaArmadura < engine.criterios.taxaMin ? '(Inferior à mínima)' : '(Atende taxa mínima)'}</div>
      </div>
      <table class="report-table" style="max-height:160px; overflow-y:auto; display:block;">
        <thead>
          <tr>
            <th>Barra</th>
            <th>Bitola &Oslash;</th>
            <th>X (cm)</th>
            <th>Y (cm)</th>
            <th>Área (cm²)</th>
          </tr>
        </thead>
        <tbody>
  `;

  engine.barras.forEach((b, i) => {
    const coords = engine.deCentro(b.x, b.y);
    const area = Math.PI * Math.pow(b.fi / 20, 2);
    html += `
      <tr>
        <td>#${i + 1}</td>
        <td>&Oslash; ${b.fi.toFixed(1)} mm</td>
        <td>${coords.x.toFixed(1)}</td>
        <td>${coords.y.toFixed(1)}</td>
        <td>${area.toFixed(2)}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>

    <!-- 4. EFEITOS DE 2ª ORDEM -->
    <div class="report-section">
      <div class="report-section-title">4. Parâmetros de 2ª Ordem Local e Critérios</div>
      <div class="report-grid-2">
        <div>&bull; <strong>Método de Análise:</strong> [${engine.metodoSegOrd}] ${nomesMetodos[engine.metodoSegOrd]}</div>
        <div>&bull; <strong>Fator de Majoração &gamma;f:</strong> ${engine.gamaF.toFixed(2)} | <strong>&gamma;f3:</strong> ${engine.gamaF3.toFixed(2)}</div>
        <div>&bull; <strong>Consideração de 2ª Ordem:</strong> ${engine.considerarSegundaOrdem === 1 ? 'Sempre calcular' : engine.considerarSegundaOrdem === 2 ? 'Calcular se λ > λ1' : 'Não calcular'}</div>
        <div>&bull; <strong>Limitação Mb &ge; -0.5&middot;Ma:</strong> ${engine.limitarMb ? 'Sim' : 'Não'}</div>
      </div>
    </div>

    <!-- 5. RESULTADOS E VERIFICAÇÃO DE SEGURANÇA -->
    <div class="report-section">
      <div class="report-section-title">5. Resultados e Fatores de Segurança por Combinação</div>
  `;

  if (res && res.resultados && res.resultados.length > 0) {
    res.resultados.forEach((c) => {
      const fsComb = c.fsComb !== undefined ? c.fsComb : c.fsMin;
      const seguraComb = fsComb >= 1.0 && !c.erro2Ord;
      html += `
        <div style="margin-top:12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
          <strong>Combinação #${c.combId} (Nsd = ${c.nsd.toFixed(1)} kN)</strong>
          <span class="report-status-badge ${seguraComb ? 'safe' : 'danger'}">
            ${seguraComb ? 'SEGURO' : 'NÃO CONFORME'} &bull; FS Mín = ${fsComb.toFixed(2)}
          </span>
        </div>
        <table class="report-table">
          <thead>
            <tr>
              <th>z (m)</th>
              <th>Nsd (kN)</th>
              <th>M1d,x (kN&middot;m)</th>
              <th>M2d,x (kN&middot;m)</th>
              <th>M1d,y (kN&middot;m)</th>
              <th>M2d,y (kN&middot;m)</th>
              <th>F.S.</th>
            </tr>
          </thead>
          <tbody>
      `;
      for (let k = 0; k < c.secoes.z.length; k++) {
        const isCrit = k === c.secCritica;
        const fsSec = (c.secoes.fs && c.secoes.fs[k] != null) ? c.secoes.fs[k] : (c.seguranca ? c.seguranca.fs : 1.0);
        html += `
          <tr class="${isCrit ? 'row-crit' : ''}">
            <td>${c.secoes.z[k].toFixed(2)}${k === 0 ? ' (Base)' : k === c.secoes.z.length - 1 ? ' (Topo)' : ''}</td>
            <td>${c.nsd.toFixed(1)}</td>
            <td>${c.secoes.m1x[k].toFixed(2)}</td>
            <td>${c.secoes.m2x[k].toFixed(2)}</td>
            <td>${c.secoes.m1y[k].toFixed(2)}</td>
            <td>${c.secoes.m2y[k].toFixed(2)}</td>
            <td style="color:${fsSec >= 1.0 ? '#34d399' : '#f87171'}; font-weight:700;">${fsSec.toFixed(2)}</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;
    });
  } else {
    html += `<p style="color:#94a3b8;">Nenhum cálculo foi executado ainda.</p>`;
  }

  html += `
    </div>

    <!-- 6. PARECER CONCLUSIVO -->
    <div class="report-section" style="text-align:center; padding:16px;">
      <div style="font-size:12px; margin-bottom:8px; color:#cbd5e1;"><strong>PARECER TÉCNICO CONCLUSIVO</strong></div>
      <div class="report-status-badge ${seguro ? 'safe' : 'danger'}" style="font-size:13px; padding:8px 24px;">
        ${seguro ? '✓ ESTRUTURA CONFORME: FS MÍNIMO = ' + minFS.toFixed(2) + ' &ge; 1.00 (NBR 6118)' : '⛔ ESTRUTURA NÃO CONFORME: FS MÍNIMO = ' + minFS.toFixed(2) + ' < 1.00'}
      </div>
    </div>
  `;

  return html;
}

function gerarTextoRelatorioCompleto() {
  const s = engine.secao;
  const p = engine.propriedadesGeometricas || {};
  const concNBR = parametrosConcretoNBR(engine.fck);
  const dataHora = new Date().toLocaleString('pt-BR');
  const nomePilar = el.windowTitle.textContent.replace('PCalc 1.4 Web - ', '').replace(/[\[\]]/g, '').trim() || 'Pilar';

  let t = '';
  t += '========================================================================================\n';
  t += 'PCALC 1.4 WEB - MEMÓRIA DE CÁLCULO ESTRUTURAL DE PILAR DE CONCRETO ARMADO\n';
  t += 'Conforme ABNT NBR 6118:2014 / Revisão 2026\n';
  t += `Pilar: ${nomePilar} | Data de Emissão: ${dataHora}\n`;
  t += '========================================================================================\n\n';

  t += '1. DADOS DA SEÇÃO E GEOMETRIA DO PILAR\n';
  t += '----------------------------------------------------------------------------------------\n';
  t += `Tipo de Seção: ${s.tipo}\n`;
  t += `Dimensões: hx = ${s.hx} cm | hy = ${engine.dimY} cm\n`;
  t += `Área de Concreto (Ac): ${(p.Ac || p.ac || (s.hx * engine.dimY)).toFixed(1)} cm²\n`;
  t += `Momentos de Inércia: Ix = ${(p.Ix || 0).toFixed(1)} cm⁴ | Iy = ${(p.Iy || 0).toFixed(1)} cm⁴\n`;
  t += `Raios de Giração: ix = ${(p.ix || 0).toFixed(2)} cm | iy = ${(p.iy || 0).toFixed(2)} cm\n`;
  t += `Comprimento Livre L: ${(s.l / 100).toFixed(2)} m | Comprimento Efetivo le: ${(p.le ? p.le / 100 : s.l / 100).toFixed(2)} m\n`;
  t += `Índices de Esbeltez: λx = ${(p.lambdaX || 0).toFixed(2)} | λy = ${(p.lambdaY || 0).toFixed(2)}\n\n`;

  t += '2. MATERIAIS CONSTITUTIVOS (NBR 6118:2026)\n';
  t += '----------------------------------------------------------------------------------------\n';
  t += `Concreto fck: ${engine.fck} MPa | γc = ${engine.gamaC.toFixed(2)} | fcd = ${engine.fcd.toFixed(2)} kN/cm²\n`;
  t += `Fator de Redução ηc: ${concNBR.etaC.toFixed(3)} | Expoente n: ${concNBR.n.toFixed(2)}\n`;
  t += `Deformação de pico εc2: ${concNBR.ec2.toFixed(2)} ‰ | Deformação última εcu: ${concNBR.ecu.toFixed(2)} ‰\n`;
  const esVal = engine.es || 210.0;
  const eydVal = ((engine.fyk / engine.gamaS) / (engine.modEs || 210000)) * 1000;
  t += `Aço das Armaduras: CA-${engine.fyk / 10} | fyk = ${engine.fyk} MPa | γs = ${engine.gamaS.toFixed(2)} | fyd = ${(engine.fyk / (10 * engine.gamaS)).toFixed(2)} kN/cm²\n`;
  t += `Módulo de Elasticidade Es: ${esVal.toFixed(0)} GPa | Deformação de Escoamento εyd: ${eydVal.toFixed(2)} ‰\n\n`;

  t += '3. ARMADURA LONGITUDINAL CADASTRADA\n';
  t += '----------------------------------------------------------------------------------------\n';
  t += `Total de Barras: ${engine.barras.length}\n`;
  t += `Área de Aço Total (As): ${engine.areaAcoTotal.toFixed(2)} cm²\n`;
  t += `Taxa Geométrica de Armadura (ρs): ${engine.taxaArmadura.toFixed(2)} %\n`;
  t += 'Coordenadas das Barras:\n';
  engine.barras.forEach((b, i) => {
    const coords = engine.deCentro(b.x, b.y);
    t += `  Barra #${(i + 1).toString().padStart(2, '0')}: Ø ${b.fi.toFixed(1)} mm | x = ${coords.x.toFixed(1)} cm, y = ${coords.y.toFixed(1)} cm\n`;
  });
  t += '\n';

  t += '4. PARÂMETROS DE ANÁLISE DE 2ª ORDEM LOCAL\n';
  t += '----------------------------------------------------------------------------------------\n';
  const nomesMetodos = [
    '',
    'Pilar-Padrão com curvatura aproximada',
    'Pilar-Padrão com rigidez κ aproximada',
    'Pilar-Padrão acoplado com diagrama N, M, 1/r',
    'Método Geral acoplado com diagrama N, M, 1/r',
    'Método Geral acoplado com diagrama N, Mx, My, 1/r (direções acopladas)'
  ];
  t += `Método Selecionado: [${engine.metodoSegOrd}] ${nomesMetodos[engine.metodoSegOrd]}\n`;
  t += `Consideração: ${engine.considerarSegundaOrdem === 1 ? 'Sempre calcular' : engine.considerarSegundaOrdem === 2 ? 'Calcular se λ > λ1' : 'Não calcular'}\n`;
  t += `Fator de Majoração γf3: ${engine.gamaF3.toFixed(2)} | Limitação Mb ≥ -0.5·Ma: ${engine.limitarMb ? 'Sim' : 'Não'}\n\n`;

  t += '5. RESULTADOS POR COMBINAÇÃO E SUBDIVISÃO DO PILAR\n';
  t += '----------------------------------------------------------------------------------------\n';
  if (estado.ultimoResultado && estado.ultimoResultado.resultados) {
    estado.ultimoResultado.resultados.forEach((res) => {
      const fsComb = res.fsComb !== undefined ? res.fsComb : res.fsMin;
      t += `--- COMBINAÇÃO #${res.combId} ---\n`;
      t += `Nsd = ${res.nsd.toFixed(1)} kN | Fator de Segurança Crítico: FS = ${fsComb.toFixed(2)} (${fsComb >= 1.0 ? 'SEGURO' : 'NÃO CONFORME'})\n`;
      t += `Subdivisões ao longo da altura do pilar (z de 0 a L):\n`;
      t += `  z (m)   | Nsd (kN)   | M1d,x (kNm) | M2d,x (kNm) | M1d,y (kNm) | M2d,y (kNm) | F.S.\n`;
      t += `  --------+------------+-------------+-------------+-------------+-------------+-------\n`;
      for (let k = 0; k < res.secoes.z.length; k++) {
        const z = res.secoes.z[k].toFixed(2).padStart(6, ' ');
        const nsdStr = res.nsd.toFixed(1).padStart(10, ' ');
        const m1x = res.secoes.m1x[k].toFixed(1).padStart(11, ' ');
        const m2x = res.secoes.m2x[k].toFixed(1).padStart(11, ' ');
        const m1y = res.secoes.m1y[k].toFixed(1).padStart(11, ' ');
        const m2y = res.secoes.m2y[k].toFixed(1).padStart(11, ' ');
        const fsSec = (res.secoes.fs && res.secoes.fs[k] != null) ? res.secoes.fs[k] : (res.seguranca ? res.seguranca.fs : 1.0);
        const fsStr = fsSec.toFixed(2).padStart(7, ' ');
        t += `  ${z} | ${nsdStr} | ${m1x} | ${m2x} | ${m1y} | ${m2y} | ${fsStr}\n`;
      }
      t += '\n';
    });
  } else {
    t += 'Nenhum cálculo foi executado ainda.\n';
  }

  t += '========================================================================================\n';
  t += 'FIM DO RELATÓRIO\n';
  return t;
}

// =============================================================================
// CONTROLE DE TOGGLES DE RESULTADOS (5 TOGGLES VERTICAIS)
// =============================================================================
function configurarEventosToggles() {
  el.toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.graph;
      ativarToggleGrafico(g);
    });
  });

  // Sincronização do Checkbox Fundo Bege (Escala PCalc 1.4 Original)
  const sincronizarEscalaBege = (ativado) => {
    renderer.modoEscalaBege = ativado;
    if (el.chkEscalaBege) el.chkEscalaBege.checked = ativado;
    if (el.chkEscalaBegeRes) el.chkEscalaBegeRes.checked = ativado;
    atualizarVisualizacaoSecaoTransversal();
    atualizarGraficoResultadoCentral();
  };

  if (el.chkEscalaBege) {
    el.chkEscalaBege.addEventListener('change', () => {
      sincronizarEscalaBege(el.chkEscalaBege.checked);
    });
  }
  if (el.chkEscalaBegeRes) {
    el.chkEscalaBegeRes.addEventListener('change', () => {
      sincronizarEscalaBege(el.chkEscalaBegeRes.checked);
    });
  }

  // Checkbox Fibras
  el.chkFibras.addEventListener('change', () => {
    estado.mostrarFibras = el.chkFibras.checked;
    atualizarVisualizacaoSecaoTransversal();
  });

  // Seletor de combinação ativa
  el.selectComb.addEventListener('change', () => {
    estado.combAtivaIdx = parseInt(el.selectComb.value, 10) || 0;
    estado.secAtivaIdx = null; // reseta seleção específica para pegar a seção crítica
    atualizarVisualizacaoResultados();
  });
}

function ativarToggleGrafico(tipo) {
  estado.graficoAtivo = tipo;
  el.toggleButtons.forEach(b => {
    if (b.dataset.graph === tipo) b.classList.add('active');
    else b.classList.remove('active');
  });
  atualizarGraficoResultadoCentral();
}

// =============================================================================
// ATUALIZAÇÃO DA INTERFACE E RESULTADOS
// =============================================================================
function atualizarTodaInterface() {
  const p = engine.propriedadesGeometricas;

  // Atualiza Seletor de Combinações
  el.selectComb.innerHTML = '';
  engine.esforcos.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Combinação ${i + 1} (Nsd = ${c.nsd} kN)`;
    el.selectComb.appendChild(opt);
  });
  if (estado.combAtivaIdx >= engine.esforcos.length) estado.combAtivaIdx = 0;
  el.selectComb.value = estado.combAtivaIdx;

  // Resumo no painel
  el.txtTaxaAs.textContent = `${engine.taxaArmadura.toFixed(2)} %`;
  el.txtLambdaX.textContent = `${p.lambdaX.toFixed(2)}`;
  el.txtLambdaY.textContent = `${p.lambdaY.toFixed(2)}`;
  el.txtFck.textContent = `fck = ${engine.fck} MPa`;

  // Statusbar
  el.sbSecao.textContent = `${engine.secao.tipo} ${engine.secao.hx}×${engine.dimY} cm`;
  el.sbFck.textContent = `fck = ${engine.fck} MPa (NBR 6118)`;
  el.sbArmacao.textContent = `${engine.barras.length} barras (As = ${engine.areaAcoTotal.toFixed(2)} cm², ${engine.taxaArmadura.toFixed(2)}%)`;

  const nomesMetodosCurto = [
    '',
    'Pilar-Padrão (Curvatura)',
    'Pilar-Padrão (Rigidez κ)',
    'Pilar-Padrão (N-M-1/r)',
    'Método Geral (N-M-1/r)',
    'Método Geral Acoplado (N-Mx-My-1/r)'
  ];
  el.sbMetodo2Ord.textContent = nomesMetodosCurto[engine.metodoSegOrd] || '2ª Ordem';

  // Badges de Avisos
  const avisos = gerarAvisosNormativos();
  if (avisos.length > 0) {
    el.badgeAvisosCount.style.display = 'inline-block';
    el.badgeAvisosCount.textContent = avisos.length;
  } else {
    el.badgeAvisosCount.style.display = 'none';
  }

  // Renderiza seção sem resultado por enquanto se não houver
  const combRes = obterCombResAtiva();
  renderer.renderizarSecao(el.canvasSecao, engine, combRes, {
    mostrarFibras: estado.mostrarFibras,
    secIndex: estado.secAtivaIdx
  });
}

function obterCombResAtiva() {
  if (!estado.ultimoResultado || !estado.ultimoResultado.resultados) return null;
  return estado.ultimoResultado.resultados[estado.combAtivaIdx] || estado.ultimoResultado.resultados[0];
}

// =============================================================================
// MOTOR DE CÁLCULO E RENDERIZAÇÃO CENTRAL
// =============================================================================
// =============================================================================
// MOTOR DE CÁLCULO E RENDERIZAÇÃO CENTRAL
// =============================================================================
function executarCalculo() {
  el.sbStatusMsg.textContent = 'Calculando esforços de 2ª ordem e flexão composta...';

  setTimeout(() => {
    try {
      const res = engine.calcular();
      estado.ultimoResultado = res;

      const minFS = res.fsMinGeral !== undefined ? res.fsMinGeral : (res.segurancaCritica ? res.segurancaCritica.fs : 1.0);
      el.sbStatusMsg.textContent = `Cálculo concluído com sucesso. FS mín geral = ${minFS.toFixed(2)}.`;
      atualizarVisualizacaoResultados();
    } catch (err) {
      console.error(err);
      el.sbStatusMsg.textContent = `Erro no cálculo: ${err.message}`;
    }
  }, 10);
}

function atualizarVisualizacaoResultados() {
  const combRes = obterCombResAtiva();
  if (!combRes) return;

  // Se não tiver seção selecionada, assume a seção crítica da combinação
  if (estado.secAtivaIdx === null || estado.secAtivaIdx >= combRes.secoes.z.length) {
    estado.secAtivaIdx = combRes.secCritica;
  }

  const secK = estado.secAtivaIdx;
  const fsSec = (combRes.secoes.fs && combRes.secoes.fs[secK] != null) ? combRes.secoes.fs[secK] : (combRes.seguranca ? combRes.seguranca.fs : 1.0);
  const fsComb = combRes.fsMin !== undefined ? combRes.fsMin : (combRes.seguranca ? combRes.seguranca.fs : 1.0);
  const fsGeral = (estado.ultimoResultado && estado.ultimoResultado.fsMinGeral !== undefined) ? estado.ultimoResultado.fsMinGeral : fsComb;
  const seguroGeral = (estado.ultimoResultado && estado.ultimoResultado.seguro !== undefined) ? estado.ultimoResultado.seguro : (fsGeral >= 1.0);

  // 1. Atualiza FS da Seção Inspecionada no painel
  if (el.txtFSSecVal) {
    el.txtFSSecVal.textContent = `FS = ${fsSec >= 999 ? '> 999' : fsSec.toFixed(2)}`;
    el.txtFSSecVal.className = fsSec >= 1.0 ? 'val-fs-sec' : 'val-danger';
  }

  // 2. Atualiza FS Mínimo da Combinação Ativa no painel
  if (el.txtFSCombVal) {
    el.txtFSCombVal.textContent = `FS = ${fsComb >= 999 ? '> 999' : fsComb.toFixed(2)}`;
    el.txtFSCombVal.className = fsComb >= 1.0 ? 'val-safe' : 'val-danger';
  }

  // 3. Atualiza Fator de Segurança Geral (Crítico de todo o pilar)
  if (el.txtFSCritVal) {
    el.txtFSCritVal.textContent = `FS = ${fsGeral.toFixed(2)}`;
    if (seguroGeral) {
      if (el.txtFSCritBox) el.txtFSCritBox.className = 'resumo-line-crit';
      el.txtFSCritVal.className = 'val-safe';
    } else {
      if (el.txtFSCritBox) el.txtFSCritBox.className = 'resumo-line-crit danger';
      el.txtFSCritVal.className = 'val-danger';
    }
  }

  // 4. Atualiza Status Badge no canto superior direito da janela
  if (el.statusBadge && el.statusText) {
    if (seguroGeral) {
      el.statusBadge.className = 'status-pill safe';
      el.statusText.innerHTML = `SEGURO &bull; FS = ${fsGeral.toFixed(2)}`;
    } else {
      el.statusBadge.className = 'status-pill danger';
      el.statusText.innerHTML = `NÃO CONFORME &bull; FS = ${fsGeral.toFixed(2)}`;
    }
  }

  // 5. Atualiza Seção Transversal (com LN da seção ativa)
  atualizarVisualizacaoSecaoTransversal();

  // 6. Atualiza Gráfico Central (FCO, FCNx, FCNy, Deformação ou Tensão)
  atualizarGraficoResultadoCentral();

  // 7. Atualiza Tabela de Subdivisões do Pilar
  atualizarTabelaSubdivisoes(combRes);

  // 8. Atualiza Gráfico dos Esforços ao Longo do Pilar (DesenhaEsforcos.java)
  renderer.renderizarDiagramasEsforcosPilar(el.canvasEsforcosPilar, engine, combRes, estado.secAtivaIdx);
}

function atualizarVisualizacaoSecaoTransversal() {
  const combRes = obterCombResAtiva();
  const barraExibir = estado.hoveredBarraSecao || estado.selectedBarraSecao;
  renderer.renderizarSecao(el.canvasSecao, engine, combRes, {
    mostrarFibras: estado.mostrarFibras,
    secIndex: estado.secAtivaIdx
  }, estado.zoomSecao, barraExibir);
}

function atualizarGraficoResultadoCentral() {
  const combRes = obterCombResAtiva();
  if (!combRes) return;

  const secK = estado.secAtivaIdx ?? combRes.secCritica;
  const msdX_sec = combRes.secoes.m2x[secK];
  const msdY_sec = combRes.secoes.m2y[secK];

  // Fator de segurança na seção selecionada
  const fsSec = (combRes.secoes.fs && combRes.secoes.fs[secK]) ? combRes.secoes.fs[secK] : combRes.seguranca.fs;
  const segurancaSec = {
    fs: fsSec,
    mrdX: msdX_sec * fsSec,
    mrdY: msdY_sec * fsSec
  };

  const transform = estado.zoomResultados[estado.graficoAtivo] || { zoom: 1.0, panX: 0, panY: 0 };
  const hoveredBarra = estado.hoveredBarraResultados || estado.selectedBarraResultados;

  switch (estado.graficoAtivo) {
    case 'fco':
      renderer.renderizarDiagramaFCO(el.canvasResultados, combRes.curvaMrd, msdX_sec, msdY_sec, segurancaSec, transform);
      break;
    case 'fcnx':
      renderer.renderizarDiagramaFCN(el.canvasResultados, engine, combRes, 'x', transform);
      break;
    case 'fcny':
      renderer.renderizarDiagramaFCN(el.canvasResultados, engine, combRes, 'y', transform);
      break;
    case 'deformacao':
      renderer.renderizarDeformacoes(el.canvasResultados, engine, combRes, secK, transform, hoveredBarra);
      break;
    case 'tensao':
      renderer.renderizarTensoes(el.canvasResultados, engine, combRes, secK, transform, hoveredBarra);
      break;
  }
}

// -----------------------------------------------------------------------------
// TABELA DE SUBDIVISÕES DO PILAR COM INTERATIVIDADE DE SEÇÃO Z
// -----------------------------------------------------------------------------
function atualizarTabelaSubdivisoes(combRes) {
  el.tbodySubdivisoes.innerHTML = '';
  const secoes = combRes.secoes;
  const nSec = secoes.z.length;

  el.lblSubdivisoesInfo.textContent = `Subdivisões ao longo de L (${nSec} seções discretas)`;

  for (let i = 0; i < nSec; i++) {
    const zVal = secoes.z[i];
    const nsdVal = combRes.nsd;
    const msdxVal = secoes.m2x[i];
    const msdyVal = secoes.m2y[i];
    const fsVal = secoes.fs ? secoes.fs[i] : combRes.seguranca.fs;

    const tr = document.createElement('tr');
    if (i === estado.secAtivaIdx) {
      tr.className = 'row-selected';
    }

    const fsClass = fsVal >= 1.0 ? 'fs-safe' : 'fs-danger';

    // Rótulo da seção z
    let zLabel = `${zVal.toFixed(2)} m`;
    if (i === 0) zLabel = `Base (${zVal.toFixed(2)}m)`;
    else if (i === nSec - 1) zLabel = `Topo (${zVal.toFixed(2)}m)`;

    const fsText = fsVal >= 999 ? '> 999' : fsVal.toFixed(2);
    tr.innerHTML = `
      <td>${zLabel}</td>
      <td>${nsdVal.toFixed(1)}</td>
      <td>${msdxVal.toFixed(2)}</td>
      <td>${msdyVal.toFixed(2)}</td>
      <td class="${fsClass}">${fsText}</td>
    `;

    // Interatividade: clicar na seção z inspeciona esforços e diagramas
    tr.addEventListener('click', () => {
      estado.secAtivaIdx = i;
      el.tbodySubdivisoes.querySelectorAll('tr').forEach((r, idx) => {
        if (idx === i) r.className = 'row-selected';
        else r.className = '';
      });

      // Atualiza FS da Seção Inspecionada no painel
      const fsCurrentSec = (combRes.secoes.fs && combRes.secoes.fs[i] != null) ? combRes.secoes.fs[i] : combRes.seguranca.fs;
      if (el.txtFSSecVal) {
        el.txtFSSecVal.textContent = `FS = ${fsCurrentSec >= 999 ? '> 999' : fsCurrentSec.toFixed(2)}`;
        el.txtFSSecVal.className = fsCurrentSec >= 1.0 ? 'val-fs-sec' : 'val-danger';
      }

      // Atualiza visualização da seção transversal com a Linha Neutra correspondente
      atualizarVisualizacaoSecaoTransversal();

      // Atualiza gráfico ativo com a cota z selecionada
      atualizarGraficoResultadoCentral();

      // Atualiza o diagrama do pilar esquemático marcando a cota z selecionada
      renderer.renderizarDiagramasEsforcosPilar(el.canvasEsforcosPilar, engine, combRes, estado.secAtivaIdx);
    });

    el.tbodySubdivisoes.appendChild(tr);
  }
}

// -----------------------------------------------------------------------------
// EVENTOS DE ZOOM, PAN E INTERAÇÃO COM MOUSE NOS CANVASES
// -----------------------------------------------------------------------------
function configurarEventosZoomPanInteracoes() {
  // 1. CANVAS RESULTADOS (FCO, FCNx, FCNy, Deformação, Tensão)
  let isDraggingRes = false;
  let dragStartRes = { x: 0, y: 0 };

  const getTransformRes = () => {
    if (!estado.zoomResultados[estado.graficoAtivo]) {
      estado.zoomResultados[estado.graficoAtivo] = { zoom: 1.0, panX: 0, panY: 0 };
    }
    return estado.zoomResultados[estado.graficoAtivo];
  };

  // Zoom com a rodinha do mouse centrado na posição do cursor
  el.canvasResultados.addEventListener('wheel', (e) => {
    e.preventDefault();
    const t = getTransformRes();
    const rect = el.canvasResultados.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const oldZoom = t.zoom;
    const newZoom = Math.min(Math.max(0.25, oldZoom * zoomFactor), 15.0);

    const cx = rect.width / 2 + t.panX;
    const cy = rect.height / 2 + t.panY;

    t.panX = mouseX - rect.width / 2 - (mouseX - cx) * (newZoom / oldZoom);
    t.panY = mouseY - rect.height / 2 - (mouseY - cy) * (newZoom / oldZoom);
    t.zoom = newZoom;

    atualizarGraficoResultadoCentral();
  }, { passive: false });

  // Pan com arrasto do mouse
  el.canvasResultados.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDraggingRes = true;
    dragStartRes = { x: e.clientX, y: e.clientY };
    el.canvasResultados.classList.add('grabbing');
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingRes) {
      const dx = e.clientX - dragStartRes.x;
      const dy = e.clientY - dragStartRes.y;
      dragStartRes = { x: e.clientX, y: e.clientY };
      const t = getTransformRes();
      t.panX += dx;
      t.panY += dy;
      atualizarGraficoResultadoCentral();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingRes) {
      isDraggingRes = false;
      el.canvasResultados.classList.remove('grabbing');
    }
  });

  // Hover sobre armaduras no canvas de resultados
  el.canvasResultados.addEventListener('mousemove', (e) => {
    if (isDraggingRes) return;
    const rect = el.canvasResultados.getBoundingClientRect();
    const mx = (typeof e.offsetX === 'number' && !isNaN(e.offsetX)) ? e.offsetX : (e.clientX - rect.left);
    const my = (typeof e.offsetY === 'number' && !isNaN(e.offsetY)) ? e.offsetY : (e.clientY - rect.top);

    let barraEncontrada = null;
    if (renderer.activeDiagramRebars && renderer.activeDiagramRebars.length > 0) {
      for (const b of renderer.activeDiagramRebars) {
        if (Math.hypot(mx - b.x, my - b.y) <= Math.max(18, b.raio + 8)) {
          barraEncontrada = b;
          break;
        }
      }
    }

    if (barraEncontrada) {
      el.canvasResultados.style.cursor = 'pointer';
      if (!estado.hoveredBarraResultados || estado.hoveredBarraResultados.index !== barraEncontrada.index) {
        estado.hoveredBarraResultados = barraEncontrada;
        atualizarGraficoResultadoCentral();
      }
    } else {
      el.canvasResultados.style.cursor = 'grab';
      if (estado.hoveredBarraResultados !== null) {
        estado.hoveredBarraResultados = null;
        atualizarGraficoResultadoCentral();
      }
    }
  });

  el.canvasResultados.addEventListener('mouseleave', () => {
    if (estado.hoveredBarraResultados !== null) {
      estado.hoveredBarraResultados = null;
      atualizarGraficoResultadoCentral();
    }
  });

  // Clique para fixar/desafixar tooltip de uma barra
  el.canvasResultados.addEventListener('click', (e) => {
    if (isDraggingRes) return;
    const rect = el.canvasResultados.getBoundingClientRect();
    const mx = (typeof e.offsetX === 'number' && !isNaN(e.offsetX)) ? e.offsetX : (e.clientX - rect.left);
    const my = (typeof e.offsetY === 'number' && !isNaN(e.offsetY)) ? e.offsetY : (e.clientY - rect.top);

    let barraEncontrada = null;
    if (renderer.activeDiagramRebars && renderer.activeDiagramRebars.length > 0) {
      for (const b of renderer.activeDiagramRebars) {
        if (Math.hypot(mx - b.x, my - b.y) <= Math.max(18, b.raio + 8)) {
          barraEncontrada = b;
          break;
        }
      }
    }

    if (barraEncontrada) {
      if (estado.selectedBarraResultados && estado.selectedBarraResultados.index === barraEncontrada.index) {
        estado.selectedBarraResultados = null;
      } else {
        estado.selectedBarraResultados = barraEncontrada;
      }
      atualizarGraficoResultadoCentral();
    } else if (estado.selectedBarraResultados) {
      estado.selectedBarraResultados = null;
      atualizarGraficoResultadoCentral();
    }
  });

  // Duplo clique redefine o zoom e pan para 100%
  el.canvasResultados.addEventListener('dblclick', () => {
    const t = getTransformRes();
    t.zoom = 1.0;
    t.panX = 0;
    t.panY = 0;
    atualizarGraficoResultadoCentral();
  });

  // Botões de zoom flutuantes do painel de resultados
  if (el.btnZoomIn) {
    el.btnZoomIn.addEventListener('click', () => {
      const t = getTransformRes();
      t.zoom = Math.min(15.0, t.zoom * 1.25);
      atualizarGraficoResultadoCentral();
    });
  }
  if (el.btnZoomOut) {
    el.btnZoomOut.addEventListener('click', () => {
      const t = getTransformRes();
      t.zoom = Math.max(0.25, t.zoom / 1.25);
      atualizarGraficoResultadoCentral();
    });
  }
  if (el.btnZoomReset) {
    el.btnZoomReset.addEventListener('click', () => {
      const t = getTransformRes();
      t.zoom = 1.0;
      t.panX = 0;
      t.panY = 0;
      atualizarGraficoResultadoCentral();
    });
  }

  // 2. CANVAS SEÇÃO TRANSVERSAL
  let isDraggingSec = false;
  let dragStartSec = { x: 0, y: 0 };

  el.canvasSecao.addEventListener('wheel', (e) => {
    e.preventDefault();
    const t = estado.zoomSecao;
    const rect = el.canvasSecao.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const oldZoom = t.zoom;
    const newZoom = Math.min(Math.max(0.25, oldZoom * zoomFactor), 15.0);

    const cx = rect.width / 2 + t.panX;
    const cy = rect.height / 2 + t.panY;

    t.panX = mouseX - rect.width / 2 - (mouseX - cx) * (newZoom / oldZoom);
    t.panY = mouseY - rect.height / 2 - (mouseY - cy) * (newZoom / oldZoom);
    t.zoom = newZoom;

    atualizarVisualizacaoSecaoTransversal();
  }, { passive: false });

  el.canvasSecao.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDraggingSec = true;
    dragStartSec = { x: e.clientX, y: e.clientY };
    el.canvasSecao.classList.add('grabbing');
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingSec) {
      const dx = e.clientX - dragStartSec.x;
      const dy = e.clientY - dragStartSec.y;
      dragStartSec = { x: e.clientX, y: e.clientY };
      estado.zoomSecao.panX += dx;
      estado.zoomSecao.panY += dy;
      atualizarVisualizacaoSecaoTransversal();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingSec) {
      isDraggingSec = false;
      el.canvasSecao.classList.remove('grabbing');
    }
  });

  el.canvasSecao.addEventListener('mousemove', (e) => {
    if (isDraggingSec) return;
    const rect = el.canvasSecao.getBoundingClientRect();
    const mx = (typeof e.offsetX === 'number' && !isNaN(e.offsetX)) ? e.offsetX : (e.clientX - rect.left);
    const my = (typeof e.offsetY === 'number' && !isNaN(e.offsetY)) ? e.offsetY : (e.clientY - rect.top);

    let barraEncontrada = null;
    if (renderer.secaoRebars && renderer.secaoRebars.length > 0) {
      for (const b of renderer.secaoRebars) {
        if (Math.hypot(mx - b.x, my - b.y) <= Math.max(18, b.raio + 8)) {
          barraEncontrada = b;
          break;
        }
      }
    }

    if (barraEncontrada) {
      el.canvasSecao.style.cursor = 'pointer';
      if (!estado.hoveredBarraSecao || estado.hoveredBarraSecao.index !== barraEncontrada.index) {
        estado.hoveredBarraSecao = barraEncontrada;
        atualizarVisualizacaoSecaoTransversal();
      }
    } else {
      el.canvasSecao.style.cursor = 'grab';
      if (estado.hoveredBarraSecao !== null) {
        estado.hoveredBarraSecao = null;
        atualizarVisualizacaoSecaoTransversal();
      }
    }
  });

  el.canvasSecao.addEventListener('mouseleave', () => {
    if (estado.hoveredBarraSecao !== null) {
      estado.hoveredBarraSecao = null;
      atualizarVisualizacaoSecaoTransversal();
    }
  });

  // Clique para fixar/desafixar tooltip de uma barra na seção
  el.canvasSecao.addEventListener('click', (e) => {
    if (isDraggingSec) return;
    const rect = el.canvasSecao.getBoundingClientRect();
    const mx = (typeof e.offsetX === 'number' && !isNaN(e.offsetX)) ? e.offsetX : (e.clientX - rect.left);
    const my = (typeof e.offsetY === 'number' && !isNaN(e.offsetY)) ? e.offsetY : (e.clientY - rect.top);

    let barraEncontrada = null;
    if (renderer.secaoRebars && renderer.secaoRebars.length > 0) {
      for (const b of renderer.secaoRebars) {
        if (Math.hypot(mx - b.x, my - b.y) <= Math.max(18, b.raio + 8)) {
          barraEncontrada = b;
          break;
        }
      }
    }

    if (barraEncontrada) {
      if (estado.selectedBarraSecao && estado.selectedBarraSecao.index === barraEncontrada.index) {
        estado.selectedBarraSecao = null;
      } else {
        estado.selectedBarraSecao = barraEncontrada;
      }
      atualizarVisualizacaoSecaoTransversal();
    } else if (estado.selectedBarraSecao) {
      estado.selectedBarraSecao = null;
      atualizarVisualizacaoSecaoTransversal();
    }
  });

  el.canvasSecao.addEventListener('dblclick', () => {
    estado.zoomSecao.zoom = 1.0;
    estado.zoomSecao.panX = 0;
    estado.zoomSecao.panY = 0;
    atualizarVisualizacaoSecaoTransversal();
  });

  if (el.btnSecaoZoomIn) {
    el.btnSecaoZoomIn.addEventListener('click', () => {
      estado.zoomSecao.zoom = Math.min(15.0, estado.zoomSecao.zoom * 1.25);
      atualizarVisualizacaoSecaoTransversal();
    });
  }
  if (el.btnSecaoZoomOut) {
    el.btnSecaoZoomOut.addEventListener('click', () => {
      estado.zoomSecao.zoom = Math.max(0.25, estado.zoomSecao.zoom / 1.25);
      atualizarVisualizacaoSecaoTransversal();
    });
  }
  if (el.btnSecaoZoomReset) {
    el.btnSecaoZoomReset.addEventListener('click', () => {
      estado.zoomSecao.zoom = 1.0;
      estado.zoomSecao.panX = 0;
      estado.zoomSecao.panY = 0;
      atualizarVisualizacaoSecaoTransversal();
    });
  }
}

if (typeof window !== 'undefined') {
  window.pcalcEngine = engine;
  window.pcalcRenderer = renderer;
  window.pcalcEstado = estado;
}

// Inicia aplicação assim que o DOM estiver carregado
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


  // Exportações no escopo global
  if (typeof window !== 'undefined') {
    window.PCalcEngine = PCalcEngine;
    window.PCalcRenderer = PCalcRenderer;
  }
})();
