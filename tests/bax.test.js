import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BAX_ACQUISITIONS,
  BAX_ALGORITHMS,
  identifyLibrary,
  identifyMaxInBin,
  recommendNextBaxExperiment,
} from "../src/bax.js";
import { parseCsv } from "../src/csv.js";

const outputs = [{ name: "yield" }, { name: "median" }];

test("Max-in-Bin selects the largest first output in each second-output bin", () => {
  const values = [
    [55, 2],
    [58, 3],
    [70, 5],
    [65, 6],
  ];
  const selected = identifyMaxInBin(values, outputs, {
    maximizeOutput: "yield",
    binOutput: "median",
    bins: [
      { min: 1, max: 4 },
      { min: 4, max: 7 },
    ],
    pointsPerBin: 1,
    epsilon: 0,
  });
  assert.deepEqual(selected.sort((a, b) => a - b), [1, 2]);
});

test("bounded library requires every output to be inside its range", () => {
  const values = [
    [55, 2],
    [58, 3],
    [70, 2],
    [55, 6],
  ];
  const selected = identifyLibrary(values, outputs, {
    bounds: [
      { output: "yield", min: 50, max: 60 },
      { output: "median", min: 1, max: 4 },
    ],
  });
  assert.deepEqual(selected, [0, 1]);
});

test("BAX CSV metadata restores the method, algorithm, and parameters", async () => {
  const text = await readFile(new URL("../notebooks/sample_bax_max_in_bin.csv", import.meta.url), "utf8");
  const parsed = parseCsv(text);
  assert.equal(parsed.metadata.method, "bax");
  assert.equal(parsed.metadata.bax.algorithm, BAX_ALGORITHMS.MAX_IN_BIN);
  assert.equal(parsed.metadata.bax.acquisition, BAX_ACQUISITIONS.SWITCH);
  assert.equal(parsed.metadata.bax.maximizeOutput, "yield");
  assert.equal(parsed.metadata.bax.binOutput, "median");
  assert.deepEqual(parsed.metadata.bax.bins[0], { min: 8, max: 10 });
  assert.equal(parsed.data.length, 12);
});

test("MeanBAX recommends an unmeasured point from the sample grid", async () => {
  const text = await readFile(new URL("../notebooks/sample_bax_max_in_bin.csv", import.meta.url), "utf8");
  const parsed = parseCsv(text);
  const result = recommendNextBaxExperiment({
    inputs: parsed.metadata.inputs,
    outputs: parsed.metadata.outputs,
    baxConfig: parsed.metadata.bax,
    csvRows: parsed.data,
    csvHeaders: parsed.headers,
  });
  assert.equal(result.method, "bax");
  assert.equal(result.strategy, "SwitchBAX → MeanBAX");
  assert.equal(result.best.point.length, 3);
  assert.ok(Number.isFinite(result.best.acquisition));
  assert.ok(!result.measured.some((item) => item.x.every((value, index) => value === result.best.point[index])));
});

test("bounded-library CSV runs through the full recommendation path", async () => {
  const text = await readFile(new URL("../notebooks/sample_bax_library.csv", import.meta.url), "utf8");
  const parsed = parseCsv(text);
  assert.equal(parsed.metadata.bax.algorithm, BAX_ALGORITHMS.LIBRARY);
  assert.equal(parsed.metadata.bax.acquisition, BAX_ACQUISITIONS.INFO);
  assert.deepEqual(parsed.metadata.bax.bounds[0], { output: "yield", min: 50, max: 70 });

  const result = recommendNextBaxExperiment({
    inputs: parsed.metadata.inputs,
    outputs: parsed.metadata.outputs,
    baxConfig: parsed.metadata.bax,
    csvRows: parsed.data,
    csvHeaders: parsed.headers,
  });
  assert.equal(result.algorithm, BAX_ALGORITHMS.LIBRARY);
  assert.equal(result.strategy, "InfoBAX");
  assert.ok(Number.isFinite(result.best.acquisition));
});

test("SwitchBAX routes to InfoBAX when the posterior-mean target set is empty", () => {
  const result = recommendNextBaxExperiment({
    inputs: [{ name: "x", min: 0, max: 3, step: 1 }],
    outputs,
    baxConfig: {
      algorithm: BAX_ALGORITHMS.LIBRARY,
      acquisition: BAX_ACQUISITIONS.SWITCH,
      bounds: [
        { output: "yield", min: 100, max: 101 },
        { output: "median", min: 100, max: 101 },
      ],
    },
    csvRows: [
      { x: "0", yield: "1", median: "1" },
      { x: "1", yield: "2", median: "2" },
    ],
    csvHeaders: ["x", "yield", "median"],
  });
  assert.equal(result.strategy, "SwitchBAX → InfoBAX");
});
