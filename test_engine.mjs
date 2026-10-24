import { PCalcEngine } from './engine.js';

const e = new PCalcEngine();
e.secao = { tipo: 'Retangular', hx: 20, hy: 40, hx2: 0, hy2: 0, l: 300, tipoVinculacao: 1 };
e.fck = 30;
e.configurarArmacaoRapida(2, 3, 12.5, 3.5);
e.esforcos = [
  { id: 1, nsd: -500, msxdTopo: 35, msxdBase: -20, msydTopo: 10, msydBase: -5 },
  { id: 2, nsd: -300, msxdTopo: 20, msxdBase: 20, msydTopo: 5, msydBase: 5 },
];
for (const m of [1, 2, 3, 4, 5]) {
  e.metodoSegOrd = m;
  const t = Date.now();
  const a = e.executarAnaliseCompleta();
  console.log('método', m, 'ms', Date.now() - t);
  for (const r of a.resultados) {
    console.log(' comb', r.combId, 'erro', r.erroNrd, r.erro2Ord, 'fs', r.fsMin, 'mm', r.mmin && r.mmin.fs.toFixed(2));
    if (r.secoes) console.log('  m2x', r.secoes.m2x.map(v => v.toFixed(1)).join(' '), '\n  fs', r.secoes.fs.join(' '));
  }
}
