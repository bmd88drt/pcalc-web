# PCalc 1.4 Web - Dimensionamento de Pilares de Concreto Armado (NBR 6118)

Software web profissional para análise e dimensionamento de seções de concreto armado sob flexão composta oblíqua e efeitos de 2ª ordem local, conforme as diretrizes da norma técnica brasileira **ABNT NBR 6118:2014 / Revisão 2026**.

---

## 🚀 Acesso Online
O aplicativo está hospedado via **GitHub Pages**:
- **Link do App:** `https://<seu-usuario>.github.io/<nome-do-repositorio>/`

---

## 🛠️ Principais Recursos
- **Flexão Composta Oblíqua (FCO):** Cálculo rigoroso da superfície de ruína adimensional / dimensional $N_{Rd} \times M_{x,Rd} \times M_{y,Rd}$.
- **Seções Suportadas:** Seções poligonais arbitrárias, retangulares, circulares e em forma de L, T ou I.
- **Armaduras:** Posicionamento rápido por faces, perímetro ou coordenadas livres (x, y) com diâmetros e classes de aço configuráveis (CA-50, CA-60, CA-25).
- **Efeitos de 2ª Ordem Local:**
  - Pilar-Padrão com curvatura aproximada;
  - Pilar-Padrão com rigidez $\kappa$ aproximada;
  - Método Geral com subdivisões ao longo da altura do pilar (direções desacopladas e acopladas).
- **Diagramas Interativos:**
  - Seção transversal e linha neutra com diagrama de deformações;
  - Curvas de Interação $M_{x} \times M_{y}$ e $N \times M$;
  - Relação Momento-Curvatura ($M \times 1/r$).
- **Exportação & Relatórios:** Memória de cálculo detalhada em texto (.txt) e exportação direta para **PDF** formatado com cabeçalho e croquis.
- **Persistência:** Suporte para salvar e abrir arquivos de projeto no formato `.pcalc` / `.json`.

---

## 💻 Como Rodar Localmente

Como a aplicação é 100% estática e processada no navegador:

1. Clone o repositório:
   ```bash
   git clone https://github.com/<seu-usuario>/pcalc-web.git
   cd pcalc-web
   ```

2. Basta abrir o arquivo `index.html` em qualquer navegador moderno (Chrome, Edge, Firefox, Safari) ou rodar com um servidor local:
   ```bash
   npx serve .
   ```

---

## ⚙️ Build do Pacote
Para atualizar o arquivo bundle unificado após alterar `engine.js`, `renderer.js` ou `app.js`:
```bash
node build.js
```
