import { parseCsv } from "./csv.js";
import { DEFAULT_BETA, getGridSize, gridValues, recommendNextExperiment, summarizeMeasurements } from "./optimizer.js";
import { escapeHtml, fmt, parseNumber } from "./utils.js";

const state = {
  inputs: [],
  outputs: [],
  csvRows: [],
  csvHeaders: [],
  beta: DEFAULT_BETA,
  latestResult: null,
};

const els = {
  inputRows: document.querySelector("#inputRows"),
  outputRows: document.querySelector("#outputRows"),
  csvInput: document.querySelector("#csvInput"),
  dropZone: document.querySelector("#dropZone"),
  fileName: document.querySelector("#fileName"),
  statusLine: document.querySelector("#statusLine"),
  gridSummary: document.querySelector("#gridSummary"),
  rowCount: document.querySelector("#rowCount"),
  measuredCount: document.querySelector("#measuredCount"),
  frontCount: document.querySelector("#frontCount"),
  csvPreview: document.querySelector("#csvPreview"),
  runOptimizer: document.querySelector("#runOptimizer"),
  nextRun: document.querySelector("#nextRun"),
  paretoCanvas: document.querySelector("#paretoCanvas"),
  candidateHead: document.querySelector("#candidateHead"),
  candidateRows: document.querySelector("#candidateRows"),
  downloadResults: document.querySelector("#downloadResults"),
  scriptStatus: document.querySelector("#scriptStatus"),
  stepLinks: document.querySelectorAll(".step-link"),
  advancedMode: document.querySelector("#advancedMode"),
  betaControl: document.querySelector("#betaControl"),
  betaSlider: document.querySelector("#betaSlider"),
  betaValue: document.querySelector("#betaValue"),
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

function renderOutputs() {
  if (!state.outputs.length) {
    els.outputRows.innerHTML = `
      <tr>
        <td colspan="4" class="empty-row">Add output objectives such as yield, selectivity, median, cost, or conversion.</td>
      </tr>
    `;
  } else {
    els.outputRows.innerHTML = state.outputs
      .map(
        (output, index) => `
        <tr>
          <td><input data-kind="output" data-index="${index}" data-field="name" value="${escapeHtml(output.name)}" aria-label="Output name" /></td>
          <td>
            <select data-kind="output" data-index="${index}" data-field="goal" aria-label="Goal">
              <option value="maximize" ${output.goal === "maximize" ? "selected" : ""}>Maximize</option>
              <option value="minimize" ${output.goal === "minimize" ? "selected" : ""}>Minimize</option>
              <option value="target" ${output.goal === "target" ? "selected" : ""}>Target</option>
            </select>
          </td>
          <td><input data-kind="output" data-index="${index}" data-field="target" type="number" step="any" value="${escapeHtml(output.target)}" ${output.goal === "target" ? "" : "disabled"} placeholder="${output.goal === "target" ? "Target value" : "Only for Target"}" aria-label="Target value" /></td>
          <td><button class="remove-button" data-remove-output="${index}" type="button" title="Remove output" aria-label="Remove output">&times;</button></td>
        </tr>
      `,
      )
      .join("");
  }
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
  if (loadedInputs.length) {
    state.inputs = loadedInputs;
    renderInputs();
  }
  if (loadedOutputs.length) {
    state.outputs = loadedOutputs;
    renderOutputs();
  }
  state.csvHeaders = parsed.headers;
  state.csvRows = parsed.data;
  els.fileName.textContent = file.name;
  resetResults();
  renderCsvPreview();
  const setupText = loadedInputs.length || loadedOutputs.length ? " and setup metadata" : "";
  setStatus(`Loaded ${parsed.data.length.toLocaleString()} CSV rows${setupText}.`);
}

function runOptimizer() {
  try {
    state.latestResult = recommendNextExperiment({
      inputs: state.inputs,
      outputs: state.outputs,
      csvRows: state.csvRows,
      csvHeaders: state.csvHeaders,
      beta: state.beta,
    });
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  renderResults();
  setStatus(`Recommended 1 next run from ${state.latestResult.candidates.length.toLocaleString()} ranked grid points.`);
}

function renderResults() {
  const result = state.latestResult;
  if (!result) return;
  els.frontCount.textContent = result.measuredFront.length.toLocaleString();
  els.measuredCount.textContent = result.measured.length.toLocaleString();
  els.downloadResults.disabled = false;

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

  els.nextRun.innerHTML = `
    <div class="run-title">
      <p class="eyebrow">Run this next</p>
      <strong>${state.inputs.map((input, index) => `${escapeHtml(input.name)} ${fmt(result.best.point[index])}`).join(" · ")}</strong>
    </div>
    <div class="run-values">${inputRows}</div>
    <p class="eyebrow prediction-heading">Predicted outputs</p>
    <div class="predictions">${predictionRows}</div>
    <p class="model-note">Score ${fmt(result.best.acquisition, 3)}. The ranking uses a Gaussian-process surrogate per output with a UCB exploration bonus.</p>
  `;

  renderCandidateTable(result.candidates);
  drawParetoChart(result);
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
  result.predictedFront.forEach((item) => {
    allX.push(item.predictions[ix].mean);
    allY.push(item.predictions[iy].mean);
  });
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const xScale = (value) => pad.left + ((value - minX) / spanX) * plotWidth;
  const yScale = (value) => pad.top + plotHeight - ((value - minY) / spanY) * plotHeight;

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
  result.predictedFront.forEach((item) => plotPoint(item.predictions[ix].mean, item.predictions[iy].mean, 4, "#d59c26", "#ffffff"));
  plotPoint(result.best.predictions[ix].mean, result.best.predictions[iy].mean, 7, "#b85050", "#ffffff");

  const legend = [
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
  link.download = "bo_next_experiments.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function wireEvents() {
  document.addEventListener("input", (event) => updateStateFromControl(event.target));
  document.addEventListener("change", (event) => updateStateFromControl(event.target));

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
    if (state.latestResult) drawParetoChart(state.latestResult);
  });
}

renderInputs();
renderOutputs();
renderCsvPreview();
wireEvents();
els.scriptStatus.textContent = "Interface ready.";
els.scriptStatus.classList.add("ready");
