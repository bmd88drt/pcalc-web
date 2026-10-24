import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const enginePath = path.join(__dirname, 'engine.js');
const rendererPath = path.join(__dirname, 'renderer.js');
const appPath = path.join(__dirname, 'app.js');
const bundlePath = path.join(__dirname, 'pcalc.bundle.js');

let engineCode = fs.readFileSync(enginePath, 'utf8');
let rendererCode = fs.readFileSync(rendererPath, 'utf8');
let appCode = fs.readFileSync(appPath, 'utf8');

// Strip ES module syntax from engine
engineCode = engineCode.replace(/export\s+function\s+/g, 'function ');
engineCode = engineCode.replace(/export\s+class\s+/g, 'class ');
engineCode = engineCode.replace(/export\s*\{[^}]*\};?/g, '');

// Strip ES module syntax from renderer
rendererCode = rendererCode.replace(/import\s+[^;]+;\r?\n?/g, '');
rendererCode = rendererCode.replace(/export\s+class\s+/g, 'class ');
rendererCode = rendererCode.replace(/export\s*\{[^}]*\};?/g, '');

// Strip ES module syntax from app
appCode = appCode.replace(/import\s+[^;]+;\r?\n?/g, '');

const bundleContent = `/**
 * PCalc 1.4 Web - Bundle Unificado
 * Permite execução direta via duplo clique (file:///) e em qualquer servidor web sem problemas de CORS.
 */
(function() {
  'use strict';

  // ==========================================
  // PARTE 1: NÚCLEO DE ENGENHARIA (engine.js)
  // ==========================================
  ${engineCode}

  // ==========================================
  // PARTE 2: RENDERIZADOR GRÁFICO (renderer.js)
  // ==========================================
  ${rendererCode}

  // ==========================================
  // PARTE 3: CONTROLADOR DA INTERFACE (app.js)
  // ==========================================
  ${appCode}

  // Exportações no escopo global
  if (typeof window !== 'undefined') {
    window.PCalcEngine = PCalcEngine;
    window.PCalcRenderer = PCalcRenderer;
  }
})();
`;

fs.writeFileSync(bundlePath, bundleContent, 'utf8');
console.log('pcalc.bundle.js gerado com sucesso! Tamanho:', bundleContent.length, 'bytes');
