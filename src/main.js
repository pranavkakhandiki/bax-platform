import { parseCsv } from "./csv.js";
import { BAX_ACQUISITIONS, BAX_ALGORITHMS, recommendNextBaxExperiment } from "./bax.js";
import { DEFAULT_BETA, getGridSize, gridValues, recommendNextExperiment, summarizeMeasurements } from "./optimizer.js";
import { escapeHtml, fmt, parseNumber } from "./utils.js";

function defaultBaxConfig() {
  return {
    algorithm: BAX_ALGORITHMS.MAX_IN_BIN,
    acquisition: BAX_ACQUISITIONS.SWITCH,
    maximizeOutput: "",
    binOutput: "",
    bins: [{ min: "", max: "" }],
    pointsPerBin: 1,
    epsilon: 0,
    bounds: [],
  };
}

const state = {
  method: "bo",
  inputs: [],
  outputs: [],
  baxConfig: defaultBaxConfig(),
  csvRows: [],
  csvHeaders: [],
  beta: DEFAULT_BETA,
  latestResult: null,
};

const els = {
  methodInputs: document.querySelectorAll('input[name="method"]'),
  baxSettings: document.querySelector("#baxSettings"),
  baxAlgorithm: document.querySelector("#baxAlgorithm"),
  baxAcquisition: document.querySelector("#baxAcquisition"),
  baxParameters: document.querySelector("#baxParameters"),
  inputRows: document.querySelector("#inputRows"),
  outputHeader: document.querySelector("#outputHeader"),
  outputRows: document.querySelector("#outputRows"),
  csvInput: document.querySelector("#csvInput"),
  dropZone: document.querySelector("#dropZone"),
  fileName: document.querySelector("#fileName"),
  statusLine: document.querySelector("#statusLine"),
  gridSummary: document.querySelector("#gridSummary"),
  rowCount: document.querySelector("#rowCount"),
  measuredCount: document.querySelector("#measuredCount"),
  frontCount: document.querySelector("#frontCount"),
  frontMetricLabel: document.querySelector("#frontMetricLabel"),
  csvPreview: document.querySelector("#csvPreview"),
  runOptimizer: document.querySelector("#runOptimizer"),
  nextRun: document.querySelector("#nextRun"),
  paretoCanvas: document.querySelector("#paretoCanvas"),
  gpCanvas: document.querySelector("#gpCanvas"),
  baxGpPanel: document.querySelector("#baxGpPanel"),
  observedChartTitle: document.querySelector("#observedChartTitle"),
  observedChartNote: document.querySelector("#observedChartNote"),
  candidateHead: document.querySelector("#candidateHead"),
  candidateRows: document.querySelector("#candidateRows"),
  downloadResults: document.querySelector("#downloadResults"),
  scriptStatus: document.querySelector("#scriptStatus"),
  stepLinks: document.querySelectorAll(".step-link"),
  advancedMode: document.querySelector("#advancedMode"),
  betaControl: document.querySelector("#betaControl"),
  betaSlider: document.querySelector("#betaSlider"),
  betaValue: document.querySelector("#betaValue"),
  recommendationEyebrow: document.querySelector("#recommendationEyebrow"),
  boAcquisitionControls: document.querySelector("#boAcquisitionControls"),
  baxAcquisitionLabel: document.querySelector("#baxAcquisitionLabel"),
};

function renderInputs() {
  if (!state.inputs.length) {
    els.inputRows.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">Add input variables such as temperature, pressure, time, concentration, or flow rate.</td>
      </tr>
    `;
  } else {
    els.inputRows.innerHTML = state.inputs
      .map(
        (input, index) => `
        <tr>
          <td><input data-kind="input" data-index="${index}" data-field="name" value="${escapeHtml(input.name)}" aria-label="Input name" /></td>
          <td><input data-kind="input" data-index="${index}" data-field="min" type="number" step="any" value="${escapeHtml(input.min)}" aria-label="Minimum" /></td>
          <td><input data-kind="input" data-index="${index}" data-field="max" type="number" step="any" value="${escapeHtml(input.max)}" aria-label="Maximum" /></td>
          <td><input data-kind="input" data-index="${index}" data-field="step" type="number" step="any" value="${escapeHtml(input.step)}" aria-label="Step size" /></td>
          <td><button class="remove-button" data-remove-input="${index}" type="button" title="Remove input" aria-label="Remove input">&times;</button></td>
        </tr>
      `,
      )
      .join("");
  }
  updateGridSummary();
}

function syncBaxConfigWithOutputs() {
  const names = state.outputs.map((output) => output.name.trim()).filter(Boolean);
  if (!names.includes(state.baxConfig.maximizeOutput)) {
    state.baxConfig.maximizeOutput = names[0] || "";
  }
  if (!names.includes(state.baxConfig.binOutput) || state.baxConfig.binOutput === state.baxConfig.maximizeOutput) {
    state.baxConfig.binOutput = names.find((name) => name !== state.baxConfig.maximizeOutput) || "";
  }

  const previousBounds = new Map(state.baxConfig.bounds.map((bound) => [bound.output, bound]));
  state.baxConfig.bounds = names.map((name) => previousBounds.get(name) || { output: name, min: "", max: "" });
}

function outputOptions(selected) {
  const names = state.outputs.map((output) => output.name.trim()).filter(Boolean);
  if (!names.length) return '<option value="">Add output variables first</option>';
  return names
    .map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
}

function renderBaxParameters() {
  syncBaxConfigWithOutputs();
  els.baxAlgorithm.value = state.baxConfig.algorithm;
  els.baxAcquisition.value = state.baxConfig.acquisition;

  if (state.baxConfig.algorithm === BAX_ALGORITHMS.LIBRARY) {
    els.baxParameters.innerHTML = `
      <p class="parameter-label">Required output ranges</p>
      <div class="table-wrap">
        <table class="parameter-table">
          <thead><tr><th>Output</th><th>Lower bound</th><th>Upper bound</th></tr></thead>
          <tbody>
            ${
              state.baxConfig.bounds.length
                ? state.baxConfig.bounds
                    .map(
                      (bound, index) => `
                        <tr>
                          <td><strong>${escapeHtml(bound.output)}</strong></td>
                          <td><input data-bax-bound-index="${index}" data-bax-bound-field="min" type="number" step="any" value="${escapeHtml(bound.min)}" aria-label="${escapeHtml(bound.output)} lower bound" /></td>
                          <td><input data-bax-bound-index="${index}" data-bax-bound-field="max" type="number" step="any" value="${escapeHtml(bound.max)}" aria-label="${escapeHtml(bound.output)} upper bound" /></td>
                        </tr>
                      `,
                    )
                    .join("")
                : '<tr><td colspan="3" class="empty-row">Add output variables to define the library region.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  els.baxParameters.innerHTML = `
    <div class="parameter-grid">
      <div class="field-group">
        <label for="baxMaximizeOutput">Output to maximize</label>
        <select id="baxMaximizeOutput" data-bax-field="maximizeOutput">${outputOptions(state.baxConfig.maximizeOutput)}</select>
      </div>
      <div class="field-group">
        <label for="baxBinOutput">Output used for bins</label>
        <select id="baxBinOutput" data-bax-field="binOutput">${outputOptions(state.baxConfig.binOutput)}</select>
      </div>
      <div class="field-group">
        <label for="baxPointsPerBin">Points per bin</label>
        <input id="baxPointsPerBin" data-bax-field="pointsPerBin" type="number" min="1" step="1" value="${escapeHtml(state.baxConfig.pointsPerBin)}" />
      </div>
      <div class="field-group">
        <label for="baxEpsilon">Bin tolerance</label>
        <input id="baxEpsilon" data-bax-field="epsilon" type="number" min="0" step="any" value="${escapeHtml(state.baxConfig.epsilon)}" />
      </div>
    </div>
    <div class="bin-heading">
      <p class="parameter-label">Bins for ${escapeHtml(state.baxConfig.binOutput || "the binning output")}</p>
      <button id="addBaxBin" class="compact-action" type="button">Add bin</button>
    </div>
    <div class="table-wrap">
      <table class="parameter-table">
        <thead><tr><th>Lower bound</th><th>Upper bound</th><th></th></tr></thead>
        <tbody>
          ${state.baxConfig.bins
            .map(
              (bin, index) => `
                <tr>
                  <td><input data-bax-bin-index="${index}" data-bax-bin-field="min" type="number" step="any" value="${escapeHtml(bin.min)}" aria-label="Bin ${index + 1} lower bound" /></td>
                  <td><input data-bax-bin-index="${index}" data-bax-bin-field="max" type="number" step="any" value="${escapeHtml(bin.max)}" aria-label="Bin ${index + 1} upper bound" /></td>
                  <td><button class="remove-button" data-remove-bax-bin="${index}" type="button" title="Remove bin" aria-label="Remove bin">&times;</button></td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMethod() {
  els.methodInputs.forEach((input) => {
    input.checked = input.value === state.method;
  });
  const isBax = state.method === "bax";
  els.baxSettings.hidden = !isBax;
  els.boAcquisitionControls.hidden = isBax;
  els.baxAcquisitionLabel.hidden = !isBax;
  els.recommendationEyebrow.textContent = isBax ? "Bayesian algorithm execution" : "Bayesian optimization";
  els.frontMetricLabel.textContent = isBax ? "measured target" : "Pareto front";
  els.observedChartTitle.textContent = isBax ? "Measured Output Space" : "Measured and Predicted Fronts";
  els.observedChartNote.textContent = isBax
    ? "Measured outputs, measured target hits, and the next predicted point."
    : "Measured outputs, Pareto fronts, and the next predicted point.";
  els.baxGpPanel.hidden = !isBax || !state.latestResult;
  renderBaxParameters();
  if (!state.latestResult && isBax) {
    els.baxAcquisitionLabel.textContent = els.baxAcquisition.selectedOptions[0]?.textContent || "BAX";
  }
}

function renderOutputs() {
  const isBax = state.method === "bax";
  els.outputHeader.innerHTML = isBax
    ? "<th>Name</th><th></th>"
    : "<th>Name</th><th>Goal</th><th>Target</th><th></th>";
  if (!state.outputs.length) {
    els.outputRows.innerHTML = `
      <tr>
        <td colspan="${isBax ? 2 : 4}" class="empty-row">Add output variables such as yield, selectivity, median, cost, or conversion.</td>
      </tr>
    `;
  } else {
    els.outputRows.innerHTML = state.outputs
      .map(
        (output, index) => `
        <tr>
          <td><input data-kind="output" data-index="${index}" data-field="name" value="${escapeHtml(output.name)}" aria-label="Output name" /></td>
          ${
            isBax
              ? ""
              : `<td>
                  <select data-kind="output" data-index="${index}" data-field="goal" aria-label="Goal">
                    <option value="maximize" ${output.goal === "maximize" ? "selected" : ""}>Maximize</option>
                    <option value="minimize" ${output.goal === "minimize" ? "selected" : ""}>Minimize</option>
                    <option value="target" ${output.goal === "target" ? "selected" : ""}>Target</option>
                  </select>
                </td>
                <td><input data-kind="output" data-index="${index}" data-field="target" type="number" step="any" value="${escapeHtml(output.target)}" ${output.goal === "target" ? "" : "disabled"} placeholder="${output.goal === "target" ? "Target value" : "Only for Target"}" aria-label="Target value" /></td>`
          }
          <td><button class="remove-button" data-remove-output="${index}" type="button" title="Remove output" aria-label="Remove output">&times;</button></td>
        </tr>
      `,
      )
      .join("");
  }
  renderBaxParameters();
}

function updateGridSummary() {
  if (!state.inputs.length) {
    els.gridSummary.textContent = "No input variables yet.";
    return;
  }
  const parts = state.inputs.map((input) => `${escapeHtml(input.name || "Unnamed")}: ${gridValues(input).length} levels`);
  const gridSize = getGridSize(state.inputs);
  const capped = gridSize > 25000;
  els.gridSummary.innerHTML = `${parts.join(" · ")} · <strong class="${capped ? "warning" : ""}">${gridSize.toLocaleString()} grid points</strong>`;
}

function updateStateFromControl(control) {
  if (!control || !control.dataset) return;
  if (control.dataset.baxField) {
    const field = control.dataset.baxField;
    state.baxConfig[field] = ["maximizeOutput", "binOutput"].includes(field) ? control.value : parseNumber(control.value);
    resetResults();
    return;
  }
  if (control.dataset.baxBinIndex !== undefined) {
    const bin = state.baxConfig.bins[Number(control.dataset.baxBinIndex)];
    if (bin) bin[control.dataset.baxBinField] = control.value === "" ? "" : parseNumber(control.value);
    resetResults();
    return;
  }
  if (control.dataset.baxBoundIndex !== undefined) {
    const bound = state.baxConfig.bounds[Number(control.dataset.baxBoundIndex)];
    if (bound) bound[control.dataset.baxBoundField] = control.value === "" ? "" : parseNumber(control.value);
    resetResults();
    return;
  }
  const { kind, index, field } = control.dataset;
  if (!kind || index === undefined || !field) return;
  const collection = kind === "input" ? state.inputs : state.outputs;
  const target = collection[Number(index)];
  if (!target) return;

  if (field === "name" || field === "goal") {
    target[field] = control.value;
  } else if (field === "target" && control.value === "") {
    target[field] = "";
  } else {
    target[field] = parseNumber(control.value);
  }

  if (field === "goal" && target.goal !== "target") target.target = "";
  if (kind === "output" && field === "goal") renderOutputs();
  updateGridSummary();
  resetResults();
}

function resetResults() {
  state.latestResult = null;
  els.nextRun.innerHTML = `
    <div class="empty-state">
      <span>∴</span>
      <p>Configure variables, upload data, then run the optimizer.</p>
    </div>
  `;
  els.candidateHead.innerHTML = "";
  els.candidateRows.innerHTML = "";
  els.downloadResults.disabled = true;
  els.frontCount.textContent = "0";
  els.baxAcquisitionLabel.textContent = els.baxAcquisition.selectedOptions[0]?.textContent || "BAX";
  const context = els.paretoCanvas.getContext("2d");
  if (context) context.clearRect(0, 0, els.paretoCanvas.width, els.paretoCanvas.height);
  const gpContext = els.gpCanvas.getContext("2d");
  if (gpContext) gpContext.clearRect(0, 0, els.gpCanvas.width, els.gpCanvas.height);
  els.baxGpPanel.hidden = true;
}

function setStatus(message, isError = false) {
  els.statusLine.textContent = message;
  els.statusLine.style.color = isError ? "#ffc0bc" : "#c6d2dc";
}

function renderCsvPreview() {
  const summary = summarizeMeasurements(state.csvRows, state.inputs, state.outputs);
  els.rowCount.textContent = summary.usableRows.toLocaleString();
  els.measuredCount.textContent = summary.measuredRows.toLocaleString();
  els.frontCount.textContent = "0";

  if (!state.csvRows.length) {
    els.csvPreview.innerHTML = "";
    return;
  }

  const headers = state.csvHeaders.slice(0, 8);
  const rows = state.csvRows.slice(0, 4);
  els.csvPreview.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] === undefined ? "" : row[header])}</td>`).join("")}</tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadCsvFile(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = parseCsv(text);
  const loadedInputs = parsed.metadata?.inputs || [];
  const loadedOutputs = parsed.metadata?.outputs || [];
  if (parsed.metadata?.method) state.method = parsed.metadata.method;
  if (parsed.metadata?.bax) {
    const loadedBax = parsed.metadata.bax;
    const defaults = defaultBaxConfig();
    state.baxConfig = {
      ...defaults,
      algorithm: loadedBax.algorithm || defaults.algorithm,
      acquisition: loadedBax.acquisition || defaults.acquisition,
      maximizeOutput: loadedBax.maximizeOutput || "",
      binOutput: loadedBax.binOutput || "",
      bins: loadedBax.bins.length ? loadedBax.bins : defaults.bins,
      pointsPerBin: loadedBax.pointsPerBin === "" ? defaults.pointsPerBin : loadedBax.pointsPerBin,
      epsilon: loadedBax.epsilon === "" ? defaults.epsilon : loadedBax.epsilon,
      bounds: loadedBax.bounds,
    };
  }
  if (loadedInputs.length) {
    state.inputs = loadedInputs;
    renderInputs();
  }
  if (loadedOutputs.length) {
    state.outputs = loadedOutputs;
    renderOutputs();
  }
  renderMethod();
  state.csvHeaders = parsed.headers;
  state.csvRows = parsed.data;
  els.fileName.textContent = file.name;
  resetResults();
  renderCsvPreview();
  const setupText = loadedInputs.length || loadedOutputs.length || parsed.metadata?.method ? " and setup metadata" : "";
  setStatus(`Loaded ${parsed.data.length.toLocaleString()} CSV rows${setupText}.`);
}

function runOptimizer() {
  try {
    const problem = {
      inputs: state.inputs,
      outputs: state.outputs,
      csvRows: state.csvRows,
      csvHeaders: state.csvHeaders,
    };
    state.latestResult =
      state.method === "bax"
        ? recommendNextBaxExperiment({ ...problem, baxConfig: state.baxConfig })
        : recommendNextExperiment({ ...problem, beta: state.beta });
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  renderResults();
  const methodName = state.method === "bax" ? "BAX" : "BO";
  setStatus(`${methodName} recommended the next run from the unmeasured grid points.`);
}

function renderResults() {
  const result = state.latestResult;
  if (!result) return;
  els.frontCount.textContent = result.measuredFront.length.toLocaleString();
  els.measuredCount.textContent = result.measured.length.toLocaleString();
  els.downloadResults.disabled = false;
  if (state.method === "bax") els.baxAcquisitionLabel.textContent = result.strategy;
  els.baxGpPanel.hidden = state.method !== "bax";
  if (state.method === "bax") {
    els.observedChartNote.textContent =
      state.baxConfig.algorithm === BAX_ALGORITHMS.MAX_IN_BIN
        ? "Shaded bands are configured bins; green points are measured bin winners."
        : "The shaded box is the requested library region; green points are measured hits.";
  }

  const inputRows = state.inputs
    .map(
      (input, index) => `
      <div class="value-row">
        <span>${escapeHtml(input.name)}</span>
        <span>${fmt(result.best.point[index])}</span>
      </div>
    `,
    )
    .join("");

  const predictionRows = state.outputs
    .map((output, index) => {
      const prediction = result.best.predictions[index];
      return `
        <div class="value-row">
          <span>${escapeHtml(output.name)}</span>
          <span>${fmt(prediction.mean)} ± ${fmt(prediction.std)}</span>
        </div>
      `;
    })
    .join("");

  const baxExplanation = result.strategy.includes("InfoBAX")
    ? `${escapeHtml(result.strategy)} selected the point with the greatest expected information about the algorithm-defined target set.`
    : result.strategy.includes("fallback")
      ? `${escapeHtml(result.strategy)} selected the most uncertain unmeasured grid point because the predicted target set is empty or exhausted.`
      : `${escapeHtml(result.strategy)} selected the most uncertain unmeasured member of the predicted target set.`;

  els.nextRun.innerHTML = `
    <div class="run-title">
      <p class="eyebrow">Run this next</p>
      <strong>${state.inputs.map((input, index) => `${escapeHtml(input.name)} ${fmt(result.best.point[index])}`).join(" · ")}</strong>
    </div>
    <div class="run-values">${inputRows}</div>
    <p class="eyebrow prediction-heading">Predicted outputs</p>
    <div class="predictions">${predictionRows}</div>
    <p class="model-note">${
      state.method === "bax"
        ? `Score ${fmt(result.best.acquisition, 3)}. ${baxExplanation}`
        : `Score ${fmt(result.best.acquisition, 3)}. The ranking uses a Gaussian-process surrogate per output with a UCB exploration bonus.`
    }</p>
  `;

  renderCandidateTable(result.candidates);
  drawParetoChart(result);
  if (state.method === "bax") drawGpChart(result);
}

function renderCandidateTable(candidates) {
  els.candidateHead.innerHTML = `
    <tr>
      <th>Rank</th>
      ${state.inputs.map((input) => `<th>${escapeHtml(input.name)}</th>`).join("")}
      ${state.outputs.map((output) => `<th>${escapeHtml(output.name)}</th>`).join("")}
      <th>Score</th>
    </tr>
  `;
  els.candidateRows.innerHTML = candidates
    .map(
      (candidate, index) => `
        <tr>
          <td><span class="pill">#${index + 1}</span></td>
          ${candidate.point.map((value) => `<td>${fmt(value)}</td>`).join("")}
          ${candidate.predictions.map((prediction) => `<td>${fmt(prediction.mean)} ± ${fmt(prediction.std)}</td>`).join("")}
          <td>${fmt(candidate.acquisition, 3)}</td>
        </tr>
      `,
    )
    .join("");
}

function baxRangesForOutput(outputName) {
  if (state.baxConfig.algorithm === BAX_ALGORITHMS.LIBRARY) {
    const bound = state.baxConfig.bounds.find((item) => item.output === outputName);
    return bound ? [{ min: Number(bound.min), max: Number(bound.max) }] : [];
  }
  if (state.baxConfig.binOutput !== outputName) return [];
  const epsilon = Number(state.baxConfig.epsilon) || 0;
  return state.baxConfig.bins.map((bin) => ({ min: Number(bin.min) - epsilon, max: Number(bin.max) + epsilon }));
}

function addBaxGuideDomain(xValues, yValues, outputX, outputY) {
  baxRangesForOutput(outputX.name).forEach((range) => xValues.push(range.min, range.max));
  baxRangesForOutput(outputY.name).forEach((range) => yValues.push(range.min, range.max));
}

function drawBaxGuides(ctx, frame, outputX, outputY) {
  if (state.method !== "bax") return;
  const xRanges = baxRangesForOutput(outputX.name).filter((range) => Number.isFinite(range.min) && Number.isFinite(range.max));
  const yRanges = baxRangesForOutput(outputY.name).filter((range) => Number.isFinite(range.min) && Number.isFinite(range.max));
  const { pad, plotWidth, plotHeight, xScale, yScale } = frame;

  ctx.save();
  ctx.fillStyle = state.baxConfig.algorithm === BAX_ALGORITHMS.LIBRARY ? "rgba(36, 132, 93, 0.10)" : "rgba(29, 139, 168, 0.08)";
  ctx.strokeStyle = state.baxConfig.algorithm === BAX_ALGORITHMS.LIBRARY ? "rgba(36, 132, 93, 0.55)" : "rgba(29, 139, 168, 0.45)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);

  if (state.baxConfig.algorithm === BAX_ALGORITHMS.LIBRARY && xRanges[0] && yRanges[0]) {
    const left = xScale(xRanges[0].min);
    const right = xScale(xRanges[0].max);
    const top = yScale(yRanges[0].max);
    const bottom = yScale(yRanges[0].min);
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.strokeRect(left, top, right - left, bottom - top);
  } else {
    xRanges.forEach((range) => {
      const left = xScale(range.min);
      const right = xScale(range.max);
      ctx.fillRect(left, pad.top, right - left, plotHeight);
      ctx.strokeRect(left, pad.top, right - left, plotHeight);
    });
    yRanges.forEach((range) => {
      const top = yScale(range.max);
      const bottom = yScale(range.min);
      ctx.fillRect(pad.left, top, plotWidth, bottom - top);
      ctx.strokeRect(pad.left, top, plotWidth, bottom - top);
    });
  }
  ctx.restore();
}

function drawParetoChart(result) {
  const canvas = els.paretoCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx || !state.outputs.length) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(500, Math.floor(rect.width * ratio));
  canvas.height = Math.max(320, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);

  const pad = { left: 76, right: 24, top: 28, bottom: 64 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const outputX = state.outputs[0];
  const outputY = state.outputs[1] || state.outputs[0];
  const ix = 0;
  const iy = state.outputs[1] ? 1 : 0;

  const allX = result.measured.map((item) => item.y[ix]);
  const allY = result.measured.map((item) => item.y[iy]);
  if (state.method !== "bax") {
    result.predictedFront.forEach((item) => {
      allX.push(item.predictions[ix].mean);
      allY.push(item.predictions[iy].mean);
    });
  } else {
    addBaxGuideDomain(allX, allY, outputX, outputY);
  }
  allX.push(result.best.predictions[ix].mean);
  allY.push(result.best.predictions[iy].mean);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const xScale = (value) => pad.left + ((value - minX) / spanX) * plotWidth;
  const yScale = (value) => pad.top + plotHeight - ((value - minY) / spanY) * plotHeight;
  const frame = { pad, plotWidth, plotHeight, xScale, yScale };

  const formatTick = (value, span) => {
    const magnitude = Math.max(Math.abs(value), Math.abs(span));
    if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-3)) {
      return value.toExponential(2);
    }
    const tickStep = Math.abs(span) / 4;
    const digits = tickStep >= 1 ? 2 : Math.min(5, Math.max(2, Math.ceil(-Math.log10(tickStep)) + 1));
    return fmt(value, digits);
  };

  ctx.strokeStyle = "#d8dee7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.left + (plotWidth * i) / 4;
    const y = pad.top + (plotHeight * i) / 4;
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotHeight);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotWidth, y);
  }
  ctx.stroke();

  ctx.fillStyle = "#65717f";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.left + (plotWidth * i) / 4;
    const y = pad.top + (plotHeight * i) / 4;
    const xValue = minX + (spanX * i) / 4;
    const yValue = maxY - (spanY * i) / 4;

    ctx.textAlign = "center";
    ctx.fillText(formatTick(xValue, spanX), x, pad.top + plotHeight + 8);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(yValue, spanY), pad.left - 10, y);
    ctx.textBaseline = "top";
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(outputX.name, pad.left + plotWidth / 2, height - 8);
  ctx.save();
  ctx.translate(14, pad.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(outputY.name, 0, 0);
  ctx.restore();

  drawBaxGuides(ctx, frame, outputX, outputY);

  const plotPoint = (x, y, radius, color, stroke) => {
    ctx.beginPath();
    ctx.arc(xScale(x), yScale(y), radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  result.measured.forEach((item) => plotPoint(item.y[ix], item.y[iy], 4, "#8f9ba7"));
  result.measuredFront.forEach((item) => plotPoint(item.y[ix], item.y[iy], 6, "#24845d", "#ffffff"));
  if (state.method !== "bax") {
    result.predictedFront.forEach((item) => plotPoint(item.predictions[ix].mean, item.predictions[iy].mean, 4, "#d59c26", "#ffffff"));
  }
  plotPoint(result.best.predictions[ix].mean, result.best.predictions[iy].mean, 7, "#b85050", "#ffffff");

  const legend =
    state.method === "bax"
      ? [
          ["Measured", "#8f9ba7"],
          ["Measured target", "#24845d"],
          ["Next", "#b85050"],
        ]
      : [
          ["Measured", "#8f9ba7"],
          ["Measured front", "#24845d"],
          ["Predicted front", "#d59c26"],
          ["Next", "#b85050"],
        ];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  legend.forEach(([label, color], index) => {
    const x = pad.left + index * 122;
    const y = 18;
    ctx.beginPath();
    ctx.arc(x, y - 4, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#4d5966";
    ctx.fillText(label, x + 10, y);
  });
}

function drawGpChart(result) {
  const canvas = els.gpCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx || !result.gridItems?.length || !state.outputs.length) return;

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(500, Math.floor(rect.width * ratio));
  canvas.height = Math.max(360, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);

  const pad = { left: 76, right: 24, top: 32, bottom: 64 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const outputX = state.outputs[0];
  const outputY = state.outputs[1] || state.outputs[0];
  const ix = 0;
  const iy = state.outputs[1] ? 1 : 0;
  const xValues = result.gridItems.map((item) => item.predictions[ix].mean);
  const yValues = result.gridItems.map((item) => item.predictions[iy].mean);
  addBaxGuideDomain(xValues, yValues, outputX, outputY);

  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const xScale = (value) => pad.left + ((value - minX) / spanX) * plotWidth;
  const yScale = (value) => pad.top + plotHeight - ((value - minY) / spanY) * plotHeight;
  const frame = { pad, plotWidth, plotHeight, xScale, yScale };

  ctx.strokeStyle = "#d8dee7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.left + (plotWidth * i) / 4;
    const y = pad.top + (plotHeight * i) / 4;
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotHeight);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotWidth, y);
  }
  ctx.stroke();

  const formatTick = (value, span) => {
    const magnitude = Math.max(Math.abs(value), Math.abs(span));
    if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-3)) return value.toExponential(2);
    const tickStep = Math.abs(span) / 4;
    const digits = tickStep >= 1 ? 2 : Math.min(5, Math.max(2, Math.ceil(-Math.log10(tickStep)) + 1));
    return fmt(value, digits);
  };

  ctx.fillStyle = "#65717f";
  ctx.font = "12px Inter, system-ui, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.left + (plotWidth * i) / 4;
    const y = pad.top + (plotHeight * i) / 4;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTick(minX + (spanX * i) / 4, spanX), x, pad.top + plotHeight + 8);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(maxY - (spanY * i) / 4, spanY), pad.left - 10, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(outputX.name, pad.left + plotWidth / 2, height - 8);
  ctx.save();
  ctx.translate(14, pad.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(outputY.name, 0, 0);
  ctx.restore();

  drawBaxGuides(ctx, frame, outputX, outputY);

  const uncertainties = result.gridItems.map((item) => item.uncertainty);
  const minUncertainty = Math.min(...uncertainties);
  const maxUncertainty = Math.max(...uncertainties);
  const uncertaintySpan = Math.max(maxUncertainty - minUncertainty, 1e-9);
  const uncertaintyColor = (value) => {
    const amount = (value - minUncertainty) / uncertaintySpan;
    const red = Math.round(178 + (29 - 178) * amount);
    const green = Math.round(188 + (139 - 188) * amount);
    const blue = Math.round(198 + (168 - 198) * amount);
    return `rgb(${red}, ${green}, ${blue})`;
  };

  [...result.gridItems]
    .sort((a, b) => a.uncertainty - b.uncertainty)
    .forEach((item) => {
      ctx.beginPath();
      ctx.arc(xScale(item.predictions[ix].mean), yScale(item.predictions[iy].mean), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = uncertaintyColor(item.uncertainty);
      ctx.globalAlpha = 0.72;
      ctx.fill();
    });
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(xScale(result.best.predictions[ix].mean), yScale(result.best.predictions[iy].mean), 7, 0, Math.PI * 2);
  ctx.fillStyle = "#b85050";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const legend = [
    ["Lower uncertainty", uncertaintyColor(minUncertainty)],
    ["Higher uncertainty", uncertaintyColor(maxUncertainty)],
    ["Next", "#b85050"],
  ];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  legend.forEach(([label, color], index) => {
    const x = pad.left + index * 150;
    const y = 21;
    ctx.beginPath();
    ctx.arc(x, y - 4, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#4d5966";
    ctx.fillText(label, x + 10, y);
  });
}

function downloadLatestResults() {
  if (!state.latestResult) return;
  const headers = [
    "rank",
    ...state.inputs.map((input) => input.name),
    ...state.outputs.reduce((items, output) => items.concat([`predicted_${output.name}`, `uncertainty_${output.name}`]), []),
    "acquisition_score",
  ];
  const lines = [headers.join(",")];
  state.latestResult.candidates.forEach((candidate, index) => {
    const row = [
      index + 1,
      ...candidate.point,
      ...candidate.predictions.reduce((items, prediction) => items.concat([prediction.mean, prediction.std]), []),
      candidate.acquisition,
    ];
    lines.push(row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.method}_next_experiments.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function wireEvents() {
  document.addEventListener("input", (event) => updateStateFromControl(event.target));
  document.addEventListener("change", (event) => {
    updateStateFromControl(event.target);
    if (event.target.dataset?.kind === "output" && event.target.dataset.field === "name") {
      renderBaxParameters();
    }
    if (["maximizeOutput", "binOutput"].includes(event.target.dataset?.baxField)) {
      renderBaxParameters();
    }
  });

  document.addEventListener("click", (event) => {
    const clicked = event.target.closest("button");
    if (!clicked) return;

    if (clicked.id === "addInput") {
      state.inputs.push({ name: "", min: 0, max: 10, step: 1 });
      renderInputs();
      resetResults();
      return;
    }

    if (clicked.id === "addOutput") {
      state.outputs.push({ name: "", goal: "maximize", target: "" });
      renderOutputs();
      resetResults();
      return;
    }

    if (clicked.id === "addBaxBin") {
      state.baxConfig.bins.push({ min: "", max: "" });
      renderBaxParameters();
      resetResults();
      return;
    }

    const baxBinIndex = clicked.dataset.removeBaxBin;
    if (baxBinIndex !== undefined) {
      state.baxConfig.bins.splice(Number(baxBinIndex), 1);
      renderBaxParameters();
      resetResults();
      return;
    }

    const inputIndex = clicked.dataset.removeInput;
    const outputIndex = clicked.dataset.removeOutput;
    if (inputIndex !== undefined) {
      state.inputs.splice(Number(inputIndex), 1);
      renderInputs();
      resetResults();
      return;
    }
    if (outputIndex !== undefined) {
      state.outputs.splice(Number(outputIndex), 1);
      renderOutputs();
      resetResults();
    }
  });

  els.csvInput.addEventListener("change", (event) => loadCsvFile(event.target.files[0]));

  ["dragenter", "dragover"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });
  els.dropZone.addEventListener("drop", (event) => loadCsvFile(event.dataTransfer.files[0]));

  els.runOptimizer.addEventListener("click", runOptimizer);
  els.downloadResults.addEventListener("click", downloadLatestResults);

  els.methodInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.method = input.value;
      renderMethod();
      renderOutputs();
      resetResults();
    });
  });

  els.baxAlgorithm.addEventListener("change", () => {
    state.baxConfig.algorithm = els.baxAlgorithm.value;
    renderBaxParameters();
    resetResults();
  });

  els.baxAcquisition.addEventListener("change", () => {
    state.baxConfig.acquisition = els.baxAcquisition.value;
    resetResults();
  });

  els.advancedMode.addEventListener("change", () => {
    els.betaControl.hidden = !els.advancedMode.checked;
    state.beta = els.advancedMode.checked ? Number(els.betaSlider.value) : DEFAULT_BETA;
    if (state.latestResult) runOptimizer();
  });

  els.betaSlider.addEventListener("input", () => {
    els.betaValue.textContent = Number(els.betaSlider.value).toFixed(2);
    if (els.advancedMode.checked) {
      state.beta = Number(els.betaSlider.value);
      if (state.latestResult) runOptimizer();
    }
  });

  els.stepLinks.forEach((button) => {
    button.addEventListener("click", () => {
      const section = document.getElementById(button.dataset.section);
      if (section) {
        const top = section.getBoundingClientRect().top + window.pageYOffset - 16;
        window.scrollTo({ top, behavior: "smooth" });
      }
      els.stepLinks.forEach((link) => link.classList.toggle("active", link === button));
    });
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          els.stepLinks.forEach((link) => link.classList.toggle("active", link.dataset.section === entry.target.id));
        });
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    document.querySelectorAll(".band").forEach((section) => observer.observe(section));
  }
  window.addEventListener("resize", () => {
    if (state.latestResult) {
      drawParetoChart(state.latestResult);
      if (state.method === "bax") drawGpChart(state.latestResult);
    }
  });
}

renderInputs();
renderMethod();
renderOutputs();
renderCsvPreview();
wireEvents();
els.scriptStatus.textContent = "Interface ready.";
els.scriptStatus.classList.add("ready");
