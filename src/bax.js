import {
  MAX_TRAINING_ROWS,
  aggregateRows,
  computeStats,
  fitSurrogate,
  keyForPoint,
  makeGrid,
  normalizePoints,
  parseMeasurementRows,
  validateProblem,
} from "./optimizer.js";

// Browser port of TopKBinAlgorithm, MultibandIntersection, and MeanBAX from multibax-sklearn.

export const BAX_ALGORITHMS = {
  MAX_IN_BIN: "max_in_bin",
  LIBRARY: "library",
};

function meanNormalizedUncertainty(predictions, stats) {
  return (
    predictions.reduce(
      (sum, prediction, index) => sum + prediction.std / Math.max(stats[index].std, 1e-6),
      0,
    ) / predictions.length
  );
}

function outputIndex(outputs, name) {
  return outputs.findIndex((output) => output.name === name);
}

export function identifyMaxInBin(values, outputs, config) {
  const maximizeIndex = outputIndex(outputs, config.maximizeOutput);
  const binIndex = outputIndex(outputs, config.binOutput);
  if (maximizeIndex < 0 || binIndex < 0) return [];

  const epsilon = Number(config.epsilon) || 0;
  const pointsPerBin = Math.max(1, Math.floor(Number(config.pointsPerBin) || 1));
  const selected = new Set();

  config.bins.forEach((bin) => {
    const minimum = Number(bin.min);
    const maximum = Number(bin.max);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) return;

    values
      .map((row, index) => ({ index, maximize: row[maximizeIndex], binValue: row[binIndex] }))
      .filter((item) => item.binValue >= minimum - epsilon && item.binValue <= maximum + epsilon)
      .sort((a, b) => b.maximize - a.maximize)
      .slice(0, pointsPerBin)
      .forEach((item) => selected.add(item.index));
  });

  return [...selected];
}

export function identifyLibrary(values, outputs, config) {
  const boundsByOutput = new Map(config.bounds.map((bound) => [bound.output, bound]));
  return values
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      outputs.every((output, index) => {
        const bound = boundsByOutput.get(output.name);
        if (!bound) return false;
        const minimum = Number(bound.min);
        const maximum = Number(bound.max);
        return Number.isFinite(minimum) && Number.isFinite(maximum) && row[index] >= minimum && row[index] <= maximum;
      }),
    )
    .map(({ index }) => index);
}

export function identifyBaxTarget(values, outputs, config) {
  if (config.algorithm === BAX_ALGORITHMS.LIBRARY) {
    return identifyLibrary(values, outputs, config);
  }
  return identifyMaxInBin(values, outputs, config);
}

export function validateBaxConfiguration(outputs, config) {
  const errors = [];
  if (config.algorithm === BAX_ALGORITHMS.MAX_IN_BIN) {
    if (outputs.length < 2) errors.push("Max-in-Bin needs at least two output variables.");
    if (!outputs.some((output) => output.name === config.maximizeOutput)) {
      errors.push("Choose the output to maximize.");
    }
    if (!outputs.some((output) => output.name === config.binOutput)) {
      errors.push("Choose the output used to define bins.");
    }
    if (config.maximizeOutput && config.maximizeOutput === config.binOutput) {
      errors.push("The maximized output and binning output must be different.");
    }
    if (!config.bins.length) errors.push("Add at least one Max-in-Bin interval.");
    config.bins.forEach((bin, index) => {
      const minimum = Number(bin.min);
      const maximum = Number(bin.max);
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
        errors.push(`Bin ${index + 1} needs valid lower and upper bounds.`);
      }
    });
    if (!Number.isFinite(Number(config.pointsPerBin)) || Number(config.pointsPerBin) < 1) {
      errors.push("Points per bin must be at least 1.");
    }
    if (!Number.isFinite(Number(config.epsilon)) || Number(config.epsilon) < 0) {
      errors.push("Bin tolerance must be zero or greater.");
    }
  } else if (config.algorithm === BAX_ALGORITHMS.LIBRARY) {
    if (!outputs.length) errors.push("Library search needs at least one output variable.");
    outputs.forEach((output) => {
      const bound = config.bounds.find((item) => item.output === output.name);
      const minimum = Number(bound?.min);
      const maximum = Number(bound?.max);
      if (!bound || !Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
        errors.push(`${output.name || "Each output"} needs valid library bounds.`);
      }
    });
  } else {
    errors.push("Choose a supported BAX algorithm.");
  }
  return errors;
}

export function recommendNextBaxExperiment({ inputs, outputs, baxConfig, csvRows, csvHeaders }) {
  const errors = [
    ...validateProblem({ inputs, outputs, csvRows, csvHeaders, validateObjectives: false }),
    ...validateBaxConfiguration(outputs, baxConfig),
  ];
  if (errors.length) throw new Error(errors[0]);

  const grid = makeGrid(inputs);
  const parsedRows = parseMeasurementRows(csvRows, inputs, outputs);
  const measured = aggregateRows(parsedRows);
  if (measured.length < 2) throw new Error("At least two usable measured experiments are needed for BAX.");

  const trimmedMeasured = measured.slice(-MAX_TRAINING_ROWS);
  const bounds = {
    min: inputs.map((input) => Number(input.min)),
    max: inputs.map((input) => Number(input.max)),
  };
  const xTrain = normalizePoints(trimmedMeasured.map((item) => item.x), bounds);
  const yTrain = trimmedMeasured.map((item) => item.y);
  const stats = computeStats(yTrain, outputs);
  const models = outputs.map((_, index) => fitSurrogate(xTrain, yTrain, index));
  const normalizedGrid = normalizePoints(grid, bounds);
  const measuredKeys = new Set(measured.map((item) => keyForPoint(item.x)));

  const gridItems = normalizedGrid.map((normalizedPoint, index) => {
    const predictions = models.map((model) => model.predict(normalizedPoint));
    return {
      point: grid[index],
      predictions,
      predictedValues: predictions.map((prediction) => prediction.mean),
      uncertainty: meanNormalizedUncertainty(predictions, stats),
      measured: measuredKeys.has(keyForPoint(grid[index])),
    };
  });

  const predictedTargetIndices = identifyBaxTarget(
    gridItems.map((item) => item.predictedValues),
    outputs,
    baxConfig,
  );
  const predictedTargetSet = new Set(predictedTargetIndices);
  const unmeasuredTargetExists = predictedTargetIndices.some((index) => !gridItems[index].measured);
  const strategy = unmeasuredTargetExists ? "MeanBAX" : "uncertainty fallback";

  const candidates = gridItems
    .map((item, index) => ({
      ...item,
      acquisition: unmeasuredTargetExists ? (predictedTargetSet.has(index) ? item.uncertainty : 0) : item.uncertainty,
    }))
    .filter((item) => !item.measured)
    .sort((a, b) => b.acquisition - a.acquisition);

  if (!candidates.length) throw new Error("Every grid point appears to have been measured.");

  const measuredTargetIndices = identifyBaxTarget(
    measured.map((item) => item.y),
    outputs,
    baxConfig,
  );

  return {
    method: "bax",
    algorithm: baxConfig.algorithm,
    strategy,
    best: candidates[0],
    candidates: candidates.slice(0, 20),
    measured,
    measuredFront: measuredTargetIndices.map((index) => measured[index]),
    predictedFront: predictedTargetIndices.map((index) => gridItems[index]).slice(0, 200),
    stats,
  };
}
