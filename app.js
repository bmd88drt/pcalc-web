/**
 * PCalc 1.4 Web - Controlador Principal da Aplicação
 * Atende plenamente à ABNT NBR 6118:2026 e aos recursos originais do software PCalc.
 */

import { PCalcEngine, parametrosConcretoNBR } from './engine.js';
import { PCalcRenderer } from './renderer.js';

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
