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

import { parametrosConcretoNBR } from './engine.js';

export class PCalcRenderer {
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
