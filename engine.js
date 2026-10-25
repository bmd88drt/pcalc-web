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

export function parametrosConcretoNBR(fck) {
  const etaC = fck <= 40 ? 1.0 : Math.pow(40 / fck, 1 / 3);
  const k = Math.pow(Math.max(0, 90 - fck) / 100, 4);
  const n = fck <= 50 ? 2.0 : 1.4 + 23.4 * k;
  const ec2 = fck <= 50 ? 2.0 : 2.0 + 0.085 * Math.pow(fck - 50, 0.53);
  const ecu = fck <= 50 ? 3.5 : 2.6 + 35 * k;
  return { etaC, n, ec2, ecu };
}

export class PCalcEngine {
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

    // Momento mínimo de 1ª ordem (NBR 6118, item 11.3.3.4.3) + envoltória mínima
    let mm = null;
    if (this.limMomentoMin && tipo !== undefined) {
      const msxMin = Math.abs(nsd * (0.015 + 0.03 * hy));
      const msyMin = Math.abs(nsd * (0.015 + 0.03 * hx));
      let sx = msxMin, sy = msyMin;
      const instavel = { x: false, y: false };
      const errosMm = [];
      if (tipo !== 0 && this.calcular2ord !== 3 && nsd < 0 && !r.erro2Ord) {
        const calc = (m, h, lamb, eixo) => {
          const e1 = eixo === 'x'
            ? Math.max(Math.abs(topoX), Math.abs(baseX)) / Math.abs(nsd)
            : Math.max(Math.abs(topoY), Math.abs(baseY)) / Math.abs(nsd);
          const l1 = Math.min(90, Math.max(35, (25 + 12.5 * e1 / h)));
          if (!(lamb > l1 || this.calcular2ord === 1)) return m;
          const met = this.metodoSegOrd;
          if (met === 1) return this._p1(nsd, h, m);
          if (met === 2) return this._p2(nsd, h, m);
          if (met === 3) {
            const v = this._p3(nsd, h, m, eixo, lamb);
            if (v === null) { instavel[eixo] = true; errosMm.push(`Direção ${eixo}: falha ao obter a rigidez EIsec sob o momento mínimo.`); return m; }
            return v;
          }
          if (met === 4 || met === 5) {
            const q = eixo === 'x'
              ? this._metodoGeral(nsd, m, -m, 0, 0, 'x', true, false)
              : this._metodoGeral(nsd, 0, 0, m, -m, 'y', false, true);
            if (q.erro) { instavel[eixo] = true; errosMm.push(`Direção ${eixo}: ${q.erro}`); return m; }
            return Math.max(...(eixo === 'x' ? q.mdX : q.mdY).map(Math.abs));
          }
          return m;
        };
        sx = calc(msxMin, hy, p.lambdaX, 'x');
        sy = calc(msyMin, hx, p.lambdaY, 'y');
      }
      if (errosMm.length) r.erro2OrdMmin = errosMm.join(' ');

      // Envoltória elíptica (Msx/Msx,mín)² + (Msy/Msy,mín)² = 1, com e sem 2ª ordem
      const nEnv = 100;
      const envoltoria1 = [], envoltoria2 = [];
      let fsMm = 1e10, ptCrit = null;
      for (let i = 0; i < nEnv; i++) {
        const ph = i * 2 * Math.PI / nEnv;
        const c = Math.cos(ph), s2 = Math.sin(ph);
        envoltoria1.push({ mx: msxMin * c, my: msyMin * s2 });
        const mx = sx * c, my = sy * s2;
        envoltoria2.push({ mx, my });
        const q = this.fatorSeguranca(mx, my, r.curvaMrd);
        if (q.fs < fsMm) { fsMm = q.fs; ptCrit = { mx, my, mrdX: q.mrdX, mrdY: q.mrdY, fs: q.fs }; }
      }
      // Sem equilíbrio de 2ª ordem sob o momento mínimo => instabilidade: pilar não verifica
      const algumInstavel = instavel.x || instavel.y;
      if (algumInstavel) fsMm = 0;
      mm = {
        msx: msxMin, msy: msyMin, msx2: sx, msy2: sy, fs: fsMm,
        instavelX: instavel.x, instavelY: instavel.y, instavel: algumInstavel,
        envoltoria1, envoltoria2, ptCrit
      };
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
