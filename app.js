const MAX_GRID_POINTS = 25000;
const MAX_TRAINING_ROWS = 350;
const DEFAULT_BETA = 1.2;
const DEFAULT_INPUTS = [];
const DEFAULT_OUTPUTS = [];

function cloneConfig(items) {
  return items.map((item) => ({ ...item }));
}

const state = {
  inputs: cloneConfig(DEFAULT_INPUTS),
  outputs: cloneConfig(DEFAULT_OUTPUTS),
  csvRows: [],
  csvHeaders: [],
  kappa: DEFAULT_BETA,
  latestResult: null,
};

const els = {
  inputRows: document.querySelector("#inputRows"),
  outputRows: document.querySelector("#outputRows"),
  addInput: document.querySelector("#addInput"),
  addOutput: document.querySelector("#addOutput"),
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

function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toFixed(digits)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(String(value).trim());
  return Number.isFinite(number) ? number : NaN;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);

  if (!rows.length) return { headers: [], data: [] };
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  const data = rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] === undefined ? "" : values[index].trim();
    });
    return record;
  });
  return { headers, data };
}

function gridValues({ min, max, step }) {
  const low = Number(min);
  const high = Number(max);
  const stride = Number(step);
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(stride) || stride <= 0 || high < low) {
    return [];
  }

  const values = [];
  const maxIterations = 100000;
  let current = low;
  let count = 0;
  while (current <= high + Math.abs(stride) * 1e-9 && count < maxIterations) {
    values.push(Number(current.toPrecision(12)));
    current += stride;
    count += 1;
  }
  return values;
}

function getGridSize() {
  if (!state.inputs.length) return 0;
  return state.inputs.reduce((product, input) => product * Math.max(0, gridValues(input).length), 1);
}

function makeGrid(inputs) {
  const axes = inputs.map(gridValues);
  if (axes.some((axis) => axis.length === 0)) return [];
  const size = axes.reduce((product, axis) => product * axis.length, 1);
  if (size > MAX_GRID_POINTS) {
    throw new Error(`The grid has ${size.toLocaleString()} points. Keep it at ${MAX_GRID_POINTS.toLocaleString()} or fewer for this browser prototype.`);
  }

  const points = [];
  function visit(dim, current) {
    if (dim === axes.length) {
      points.push([...current]);
      return;
    }
    axes[dim].forEach((value) => {
      current.push(value);
      visit(dim + 1, current);
      current.pop();
    });
  }
  visit(0, []);
  return points;
}

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
  const gridSize = getGridSize();
  const capped = gridSize > MAX_GRID_POINTS;
  els.gridSummary.innerHTML = `${parts.join(" · ")} · <strong class="${capped ? "warning" : ""}">${gridSize.toLocaleString()} grid points</strong>`;
}

function updateStateFromControl(control) {
  if (!control || !control.dataset) return;
  const { kind, index, field } = control.dataset;
  if (!kind || index === undefined || !field) return;
  const collection = kind === "input" ? state.inputs : state.outputs;
  const target = collection[Number(index)];
  if (!target) return;
  target[field] = field === "name" || field === "goal" ? control.value : parseNumber(control.value);
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

function validateConfig() {
  const inputNames = state.inputs.map((input) => String(input.name || "").trim()).filter(Boolean);
  const outputNames = state.outputs.map((output) => String(output.name || "").trim()).filter(Boolean);
  const missing = [];

  if (!inputNames.length) missing.push("Add at least one input variable.");
  if (!outputNames.length) missing.push("Add at least one output objective.");
  if (new Set(inputNames).size !== inputNames.length) missing.push("Input names must be unique.");
  if (new Set(outputNames).size !== outputNames.length) missing.push("Output names must be unique.");

  state.inputs.forEach((input) => {
    if (!gridValues(input).length) missing.push(`${input.name || "An input"} needs a valid min, max, and positive step.`);
  });

  state.outputs.forEach((output) => {
    if (output.goal === "target" && !Number.isFinite(Number(output.target))) {
      missing.push(`${output.name || "A target objective"} needs a numeric target.`);
    }
  });

  const neededColumns = [...inputNames, ...outputNames];
  const absentColumns = neededColumns.filter((name) => !state.csvHeaders.includes(name));
  if (!state.csvRows.length) missing.push("Upload a CSV with measured experiments.");
  if (state.csvRows.length && absentColumns.length) {
    missing.push(`CSV is missing: ${absentColumns.join(", ")}.`);
  }

  return missing;
}

function rowToVectors(row) {
  const x = state.inputs.map((input) => parseNumber(row[input.name]));
  const y = state.outputs.map((output) => parseNumber(row[output.name]));
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return null;
  return { x, y, row };
}

function keyForPoint(point) {
  return point.map((value) => Number(value).toPrecision(12)).join("|");
}

function aggregateRows(rows) {
  const grouped = new Map();
  rows.forEach(({ x, y }) => {
    const key = keyForPoint(x);
    if (!grouped.has(key)) grouped.set(key, { x, sum: Array(y.length).fill(0), count: 0 });
    const item = grouped.get(key);
    y.forEach((value, index) => {
      item.sum[index] += value;
    });
    item.count += 1;
  });

  return [...grouped.values()].map((item) => ({
    x: item.x,
    y: item.sum.map((value) => value / item.count),
    count: item.count,
  }));
}

function choleskySolve(matrix, vector) {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        lower[i][j] = Math.sqrt(Math.max(sum, 1e-12));
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }

  const y = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = vector[i];
    for (let k = 0; k < i; k += 1) sum -= lower[i][k] * y[k];
    y[i] = sum / lower[i][i];
  }

  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i];
    for (let k = i + 1; k < n; k += 1) sum -= lower[k][i] * x[k];
    x[i] = sum / lower[i][i];
  }

  return x;
}

function normalizePoints(points, bounds) {
  return points.map((point) =>
    point.map((value, index) => {
      const span = bounds.max[index] - bounds.min[index];
      return span === 0 ? 0.5 : (value - bounds.min[index]) / span;
    }),
  );
}

function squaredDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i] - b[i];
    total += delta * delta;
  }
  return total;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fitSurrogate(xTrain, yTrain, outputIndex) {
  const ys = yTrain.map((row) => row[outputIndex]);
  const mean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const variance = ys.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, ys.length - 1);
  const std = Math.max(Math.sqrt(variance), 1e-6);
  const centered = ys.map((value) => (value - mean) / std);

  const pairDistances = [];
  for (let i = 0; i < xTrain.length; i += 1) {
    for (let j = i + 1; j < xTrain.length; j += 1) {
      pairDistances.push(Math.sqrt(squaredDistance(xTrain[i], xTrain[j])));
    }
  }
  const lengthScale = Math.max(median(pairDistances.filter((value) => value > 1e-9)) || 0.35, 0.08);
  const noise = xTrain.length < 5 ? 0.08 : 0.025;

  const kernel = (a, b) => {
    const r2 = squaredDistance(a, b);
    return Math.exp(-0.5 * r2 / (lengthScale * lengthScale));
  };

  const matrix = xTrain.map((a, i) =>
    xTrain.map((b, j) => kernel(a, b) + (i === j ? noise * noise + 1e-8 : 0)),
  );
  const alpha = choleskySolve(matrix, centered);

  return {
    mean,
    std,
    predict(point) {
      const k = xTrain.map((trainPoint) => kernel(point, trainPoint));
      const normalizedMean = k.reduce((sum, value, index) => sum + value * alpha[index], 0);
      const v = choleskySolve(matrix, k);
      const varianceEstimate = Math.max(1 - k.reduce((sum, value, index) => sum + value * v[index], 0), 1e-6);
      return {
        mean: mean + normalizedMean * std,
        std: Math.sqrt(varianceEstimate) * std,
      };
    },
  };
}

function objectiveUtility(value, output, stats) {
  const scale = Math.max(stats.max - stats.min, stats.std, 1e-6);
  if (output.goal === "maximize") return (value - stats.min) / scale;
  if (output.goal === "minimize") return (stats.max - value) / scale;
  return 1 - Math.abs(value - Number(output.target)) / scale;
}

function isDominated(candidate, other) {
  const noWorse = other.every((value, index) => value >= candidate[index] - 1e-10);
  const strictlyBetter = other.some((value, index) => value > candidate[index] + 1e-10);
  return noWorse && strictlyBetter;
}

function paretoFront(items, utilityKey = "utilities") {
  return items.filter((item, index) => {
    return !items.some((other, otherIndex) => otherIndex !== index && isDominated(item[utilityKey], other[utilityKey]));
  });
}

function computeStats(yTrain) {
  return state.outputs.map((_, outputIndex) => {
    const values = yTrain.map((row) => row[outputIndex]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      std: Math.max(Math.sqrt(variance), 1e-6),
    };
  });
}

function scalarizePrediction(predictions, stats) {
  let score = 0;
  predictions.forEach((prediction, outputIndex) => {
    const output = state.outputs[outputIndex];
    const uncertainty = prediction.std / Math.max(stats[outputIndex].std, 1e-6);
    let meanUtility = objectiveUtility(prediction.mean, output, stats[outputIndex]);
    if (output.goal === "target") {
      meanUtility = 1 - Math.abs(prediction.mean - Number(output.target)) / Math.max(stats[outputIndex].std * 2, 1e-6);
    }
    score += meanUtility + state.kappa * 0.22 * uncertainty;
  });
  return score / predictions.length;
}

function nearestMeasuredDistance(point, measuredPoints) {
  if (!measuredPoints.length) return 1;
  return Math.min(...measuredPoints.map((measured) => Math.sqrt(squaredDistance(point, measured))));
}

function runOptimizer() {
  const errors = validateConfig();
  if (errors.length) {
    setStatus(errors[0], true);
    return;
  }

  let grid;
  try {
    grid = makeGrid(state.inputs);
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  const parsedRows = state.csvRows.map(rowToVectors).filter(Boolean);
  const measured = aggregateRows(parsedRows);
  if (measured.length < 2) {
    setStatus("At least two usable measured experiments are needed for BO.", true);
    return;
  }

  const trimmedMeasured = measured.slice(-MAX_TRAINING_ROWS);
  const bounds = {
    min: state.inputs.map((input) => Number(input.min)),
    max: state.inputs.map((input) => Number(input.max)),
  };
  const xTrain = normalizePoints(trimmedMeasured.map((item) => item.x), bounds);
  const yTrain = trimmedMeasured.map((item) => item.y);
  const stats = computeStats(yTrain);
  const models = state.outputs.map((_, index) => fitSurrogate(xTrain, yTrain, index));
  const measuredKeys = new Set(measured.map((item) => keyForPoint(item.x)));
  const normalizedGrid = normalizePoints(grid, bounds);
  const candidates = [];

  normalizedGrid.forEach((normalizedPoint, index) => {
    const point = grid[index];
    if (measuredKeys.has(keyForPoint(point))) return;
    const predictions = models.map((model) => model.predict(normalizedPoint));
    const predictedUtilities = predictions.map((prediction, outputIndex) =>
      objectiveUtility(prediction.mean, state.outputs[outputIndex], stats[outputIndex]),
    );
    const novelty = nearestMeasuredDistance(normalizedPoint, xTrain);
    const acquisition = scalarizePrediction(predictions, stats) + 0.08 * novelty;
    candidates.push({
      point,
      predictions,
      utilities: predictedUtilities,
      novelty,
      acquisition,
    });
  });

  if (!candidates.length) {
    setStatus("Every grid point appears to have been measured.", true);
    return;
  }

  candidates.sort((a, b) => b.acquisition - a.acquisition);

  const measuredWithUtilities = measured.map((item) => ({
    ...item,
    utilities: item.y.map((value, outputIndex) => objectiveUtility(value, state.outputs[outputIndex], stats[outputIndex])),
  }));
  const measuredFront = paretoFront(measuredWithUtilities);
  const predictedFront = paretoFront(candidates.slice(0, Math.min(1500, candidates.length))).slice(0, 80);

  state.latestResult = {
    best: candidates[0],
    candidates: candidates.slice(0, 20),
    measured,
    measuredFront,
    predictedFront,
    stats,
  };

  renderResults();
  setStatus(`Recommended 1 next run from ${candidates.length.toLocaleString()} unmeasured grid points.`);
}

function renderResults() {
  const result = state.latestResult;
  if (!result) return;
  els.frontCount.textContent = result.measuredFront.length.toLocaleString();
  els.measuredCount.textContent = result.measured.length.toLocaleString();
  els.downloadResults.disabled = false;

  const inputRows = state.inputs
    .map((input, index) => `
      <div class="value-row">
        <span>${escapeHtml(input.name)}</span>
        <span>${fmt(result.best.point[index])}</span>
      </div>
    `)
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
    <p class="model-note">Score ${fmt(result.best.acquisition, 3)}. The ranking uses a Gaussian-process surrogate per output with a tunable upper-confidence exploration bonus.</p>
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

  const pad = { left: 54, right: 24, top: 24, bottom: 48 };
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
  ctx.textAlign = "center";
  ctx.fillText(outputX.name, pad.left + plotWidth / 2, height - 14);
  ctx.save();
  ctx.translate(16, pad.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
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

  if (state.outputs.length === 1) {
    ctx.fillStyle = "#65717f";
    ctx.textAlign = "right";
    ctx.fillText("Single-output view mirrors the same objective on both axes.", width - 24, height - 18);
  }
}

function renderCsvPreview() {
  const parsedRows = state.csvRows.map(rowToVectors).filter(Boolean);
  els.rowCount.textContent = parsedRows.length.toLocaleString();
  els.measuredCount.textContent = aggregateRows(parsedRows).length.toLocaleString();
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

function setStatus(message, isError = false) {
  els.statusLine.textContent = message;
  els.statusLine.style.color = isError ? "#ffc0bc" : "#c6d2dc";
}

async function loadCsvFile(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = parseCsv(text);
  state.csvHeaders = parsed.headers;
  state.csvRows = parsed.data;
  state.latestResult = null;
  els.fileName.textContent = file.name;
  els.nextRun.innerHTML = `
    <div class="empty-state">
      <span>∴</span>
      <p>CSV loaded. Run the optimizer when the variable names line up.</p>
    </div>
  `;
  els.candidateHead.innerHTML = "";
  els.candidateRows.innerHTML = "";
  els.downloadResults.disabled = true;
  renderCsvPreview();
  setStatus(`Loaded ${parsed.data.length.toLocaleString()} CSV rows.`);
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
    state.kappa = els.advancedMode.checked ? Number(els.betaSlider.value) : DEFAULT_BETA;
    if (state.latestResult) runOptimizer();
  });

  els.betaSlider.addEventListener("input", () => {
    els.betaValue.textContent = Number(els.betaSlider.value).toFixed(2);
    if (els.advancedMode.checked) {
      state.kappa = Number(els.betaSlider.value);
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
