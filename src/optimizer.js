import { parseNumber } from "./utils.js";

export const MAX_GRID_POINTS = 25000;
export const MAX_TRAINING_ROWS = 350;
export const DEFAULT_BETA = 1.2;

export function gridValues({ min, max, step }) {
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

export function getGridSize(inputs) {
  if (!inputs.length) return 0;
  return inputs.reduce((product, input) => product * Math.max(0, gridValues(input).length), 1);
}

export function makeGrid(inputs) {
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

export function validateProblem({ inputs, outputs, csvRows, csvHeaders, validateObjectives = true }) {
  const inputNames = inputs.map((input) => String(input.name || "").trim()).filter(Boolean);
  const outputNames = outputs.map((output) => String(output.name || "").trim()).filter(Boolean);
  const missing = [];

  if (!inputNames.length) missing.push("Add at least one input variable.");
  if (!outputNames.length) missing.push("Add at least one output objective.");
  if (new Set(inputNames).size !== inputNames.length) missing.push("Input names must be unique.");
  if (new Set(outputNames).size !== outputNames.length) missing.push("Output names must be unique.");

  inputs.forEach((input) => {
    if (!gridValues(input).length) missing.push(`${input.name || "An input"} needs a valid min, max, and positive step.`);
  });

  if (validateObjectives) {
    outputs.forEach((output) => {
      if (output.goal === "target" && !Number.isFinite(Number(output.target))) {
        missing.push(`${output.name || "A target objective"} needs a numeric target.`);
      }
    });
  }

  const neededColumns = [...inputNames, ...outputNames];
  const absentColumns = neededColumns.filter((name) => !csvHeaders.includes(name));
  if (!csvRows.length) missing.push("Upload a CSV with measured experiments.");
  if (csvRows.length && absentColumns.length) missing.push(`CSV is missing: ${absentColumns.join(", ")}.`);
  return missing;
}

export function rowToVectors(row, inputs, outputs) {
  const x = inputs.map((input) => parseNumber(row[input.name]));
  const y = outputs.map((output) => parseNumber(row[output.name]));
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return null;
  return { x, y, row };
}

export function parseMeasurementRows(csvRows, inputs, outputs) {
  return csvRows.map((row) => rowToVectors(row, inputs, outputs)).filter(Boolean);
}

export function keyForPoint(point) {
  return point.map((value) => Number(value).toPrecision(12)).join("|");
}

export function aggregateRows(rows) {
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

export function summarizeMeasurements(csvRows, inputs, outputs) {
  const parsedRows = parseMeasurementRows(csvRows, inputs, outputs);
  return {
    usableRows: parsedRows.length,
    measuredRows: aggregateRows(parsedRows).length,
  };
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

export function normalizePoints(points, bounds) {
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

export function fitSurrogate(xTrain, yTrain, outputIndex) {
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

  const kernel = (a, b) => Math.exp(-0.5 * squaredDistance(a, b) / (lengthScale * lengthScale));
  const matrix = xTrain.map((a, i) => xTrain.map((b, j) => kernel(a, b) + (i === j ? noise * noise + 1e-8 : 0)));
  const alpha = choleskySolve(matrix, centered);

  return {
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

export function objectiveUtility(value, output, stats) {
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

export function paretoFront(items, utilityKey = "utilities") {
  return items.filter((item, index) => !items.some((other, otherIndex) => otherIndex !== index && isDominated(item[utilityKey], other[utilityKey])));
}

export function computeStats(yTrain, outputs) {
  return outputs.map((_, outputIndex) => {
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

function scalarizePrediction(predictions, stats, outputs, beta) {
  let score = 0;
  predictions.forEach((prediction, outputIndex) => {
    const output = outputs[outputIndex];
    const uncertainty = prediction.std / Math.max(stats[outputIndex].std, 1e-6);
    let meanUtility = objectiveUtility(prediction.mean, output, stats[outputIndex]);
    if (output.goal === "target") {
      meanUtility = 1 - Math.abs(prediction.mean - Number(output.target)) / Math.max(stats[outputIndex].std * 2, 1e-6);
    }
    score += meanUtility + beta * 0.22 * uncertainty;
  });
  return score / predictions.length;
}

function nearestMeasuredDistance(point, measuredPoints) {
  if (!measuredPoints.length) return 1;
  return Math.min(...measuredPoints.map((measured) => Math.sqrt(squaredDistance(point, measured))));
}

export function recommendNextExperiment({ inputs, outputs, csvRows, csvHeaders, beta = DEFAULT_BETA }) {
  const errors = validateProblem({ inputs, outputs, csvRows, csvHeaders });
  if (errors.length) throw new Error(errors[0]);

  const grid = makeGrid(inputs);
  const parsedRows = parseMeasurementRows(csvRows, inputs, outputs);
  const measured = aggregateRows(parsedRows);
  if (measured.length < 2) throw new Error("At least two usable measured experiments are needed for BO.");

  const trimmedMeasured = measured.slice(-MAX_TRAINING_ROWS);
  const bounds = {
    min: inputs.map((input) => Number(input.min)),
    max: inputs.map((input) => Number(input.max)),
  };
  const xTrain = normalizePoints(trimmedMeasured.map((item) => item.x), bounds);
  const yTrain = trimmedMeasured.map((item) => item.y);
  const stats = computeStats(yTrain, outputs);
  const models = outputs.map((_, index) => fitSurrogate(xTrain, yTrain, index));
  const measuredKeys = new Set(measured.map((item) => keyForPoint(item.x)));
  const normalizedGrid = normalizePoints(grid, bounds);
  const candidates = [];

  normalizedGrid.forEach((normalizedPoint, index) => {
    const point = grid[index];
    if (measuredKeys.has(keyForPoint(point))) return;
    const predictions = models.map((model) => model.predict(normalizedPoint));
    const predictedUtilities = predictions.map((prediction, outputIndex) => objectiveUtility(prediction.mean, outputs[outputIndex], stats[outputIndex]));
    const novelty = nearestMeasuredDistance(normalizedPoint, xTrain);
    const acquisition = scalarizePrediction(predictions, stats, outputs, beta) + 0.08 * novelty;
    candidates.push({
      point,
      predictions,
      utilities: predictedUtilities,
      novelty,
      acquisition,
    });
  });

  if (!candidates.length) throw new Error("Every grid point appears to have been measured.");
  candidates.sort((a, b) => b.acquisition - a.acquisition);

  const measuredWithUtilities = measured.map((item) => ({
    ...item,
    utilities: item.y.map((value, outputIndex) => objectiveUtility(value, outputs[outputIndex], stats[outputIndex])),
  }));

  return {
    best: candidates[0],
    candidates: candidates.slice(0, 20),
    measured,
    measuredFront: paretoFront(measuredWithUtilities),
    predictedFront: paretoFront(candidates.slice(0, Math.min(1500, candidates.length))).slice(0, 80),
    stats,
  };
}
