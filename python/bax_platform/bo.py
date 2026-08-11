from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd

Goal = Literal["maximize", "minimize", "target"]
DEFAULT_BETA = 1.2
MAX_TRAINING_ROWS = 350


@dataclass(frozen=True)
class InputSpec:
    name: str
    minimum: float
    maximum: float
    step: float


@dataclass(frozen=True)
class ObjectiveSpec:
    name: str
    goal: Goal
    target: float | None = None


def axis_values(spec: InputSpec) -> np.ndarray:
    values = []
    current = spec.minimum
    while current <= spec.maximum + abs(spec.step) * 1e-9 and len(values) < 100000:
        values.append(float(f"{current:.12g}"))
        current += spec.step
    return np.array(values, dtype=float)


def make_grid(inputs: list[InputSpec]) -> pd.DataFrame:
    names = [spec.name for spec in inputs]
    mesh = np.meshgrid(*[axis_values(spec) for spec in inputs], indexing="ij")
    flat = np.column_stack([item.ravel() for item in mesh])
    return pd.DataFrame(flat, columns=names)


def load_experiment_csv(path: str | Path) -> tuple[pd.DataFrame, list[InputSpec], list[ObjectiveSpec]]:
    metadata_inputs: list[InputSpec] = []
    metadata_objectives: list[ObjectiveSpec] = []
    measurement_rows: list[list[str]] = []

    with Path(path).open(newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if not row or not any(cell.strip() for cell in row):
                continue
            kind = row[0].strip().removeprefix("#").strip().lower()
            if kind == "input":
                metadata_inputs.append(
                    InputSpec(
                        name=row[1].strip(),
                        minimum=float(row[2]),
                        maximum=float(row[3]),
                        step=float(row[4]),
                    )
                )
                continue
            if kind in {"objective", "output"}:
                goal = row[2].strip().lower()
                target = float(row[3]) if goal == "target" and len(row) > 3 and row[3].strip() else None
                metadata_objectives.append(ObjectiveSpec(name=row[1].strip(), goal=goal, target=target))
                continue
            if row[0].strip().startswith("#"):
                continue
            measurement_rows.append(row)

    if not measurement_rows:
        raise ValueError("No measurement table found in CSV.")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerows(measurement_rows)
    buffer.seek(0)
    data = pd.read_csv(buffer)
    return data, metadata_inputs, metadata_objectives


def synthetic_experiment(temperature: float, pressure: float) -> tuple[float, float]:
    """Deterministic validation surface used by the sample notebook."""
    yld = (
        82
        - 0.018 * (temperature - 255) ** 2
        - 0.055 * (pressure - 42) ** 2
        + 7 * np.sin((temperature - 200) / 28) * np.cos((pressure - 20) / 12)
    )
    med = (
        10
        + 0.045 * (temperature - 250)
        - 0.18 * (pressure - 40)
        + 0.9 * np.sin((temperature - 235) / 35)
        + 0.4 * np.cos((pressure - 38) / 9)
    )
    return float(yld), float(med)


def aggregate_measurements(df: pd.DataFrame, inputs: list[InputSpec], objectives: list[ObjectiveSpec]) -> pd.DataFrame:
    input_cols = [spec.name for spec in inputs]
    output_cols = [spec.name for spec in objectives]
    return df.groupby(input_cols, as_index=False, sort=False)[output_cols].mean()


def objective_utility(values: np.ndarray | float, objective: ObjectiveSpec, stats: dict[str, float]) -> np.ndarray | float:
    scale = max(stats["max"] - stats["min"], stats["std"], 1e-6)
    if objective.goal == "maximize":
        return (values - stats["min"]) / scale
    if objective.goal == "minimize":
        return (stats["max"] - values) / scale
    if objective.target is None:
        raise ValueError(f"Objective {objective.name!r} needs a target.")
    return 1 - np.abs(values - objective.target) / scale


def pareto_mask(utilities: np.ndarray) -> np.ndarray:
    utilities = np.asarray(utilities)
    keep = np.ones(len(utilities), dtype=bool)
    for i, candidate in enumerate(utilities):
        dominates = np.all(utilities >= candidate - 1e-10, axis=1) & np.any(utilities > candidate + 1e-10, axis=1)
        dominates[i] = False
        if np.any(dominates):
            keep[i] = False
    return keep


def _normalize_points(points: np.ndarray, inputs: list[InputSpec]) -> np.ndarray:
    minimum = np.array([spec.minimum for spec in inputs], dtype=float)
    maximum = np.array([spec.maximum for spec in inputs], dtype=float)
    span = maximum - minimum
    safe_span = np.where(span == 0, 1, span)
    normalized = (points - minimum) / safe_span
    normalized[:, span == 0] = 0.5
    return normalized


def _squared_distance(a: np.ndarray, b: np.ndarray) -> float:
    delta = a - b
    return float(np.sum(delta * delta))


def _median(values: list[float]) -> float | None:
    filtered = sorted(value for value in values if value > 1e-9)
    if not filtered:
        return None
    middle = len(filtered) // 2
    if len(filtered) % 2:
        return filtered[middle]
    return (filtered[middle - 1] + filtered[middle]) / 2


def _cholesky_solve(matrix: np.ndarray, vector: np.ndarray) -> np.ndarray:
    n = len(matrix)
    lower = np.zeros((n, n), dtype=float)

    for i in range(n):
        for j in range(i + 1):
            total = matrix[i, j]
            for k in range(j):
                total -= lower[i, k] * lower[j, k]
            if i == j:
                lower[i, j] = np.sqrt(max(total, 1e-12))
            else:
                lower[i, j] = total / lower[j, j]

    y = np.zeros(n, dtype=float)
    for i in range(n):
        total = vector[i]
        for k in range(i):
            total -= lower[i, k] * y[k]
        y[i] = total / lower[i, i]

    x = np.zeros(n, dtype=float)
    for i in range(n - 1, -1, -1):
        total = y[i]
        for k in range(i + 1, n):
            total -= lower[k, i] * x[k]
        x[i] = total / lower[i, i]
    return x


class _BrowserSurrogate:
    def __init__(self, x_train: np.ndarray, y_train: np.ndarray):
        self.mean = float(np.mean(y_train))
        variance = float(np.sum((y_train - self.mean) ** 2) / max(1, len(y_train) - 1))
        self.std = max(np.sqrt(variance), 1e-6)
        centered = (y_train - self.mean) / self.std

        pair_distances = []
        for i in range(len(x_train)):
            for j in range(i + 1, len(x_train)):
                pair_distances.append(float(np.sqrt(_squared_distance(x_train[i], x_train[j]))))
        self.length_scale = max(_median(pair_distances) or 0.35, 0.08)
        noise = 0.08 if len(x_train) < 5 else 0.025

        self.x_train = x_train
        self.matrix = np.array(
            [
                [self._kernel(a, b) + (noise * noise + 1e-8 if i == j else 0) for j, b in enumerate(x_train)]
                for i, a in enumerate(x_train)
            ],
            dtype=float,
        )
        self.alpha = _cholesky_solve(self.matrix, centered)

    def _kernel(self, a: np.ndarray, b: np.ndarray) -> float:
        return float(np.exp(-0.5 * _squared_distance(a, b) / (self.length_scale * self.length_scale)))

    def predict(self, point: np.ndarray) -> tuple[float, float]:
        k = np.array([self._kernel(point, train_point) for train_point in self.x_train], dtype=float)
        normalized_mean = float(np.sum(k * self.alpha))
        v = _cholesky_solve(self.matrix, k)
        variance_estimate = max(1 - float(np.sum(k * v)), 1e-6)
        return self.mean + normalized_mean * self.std, np.sqrt(variance_estimate) * self.std


def _stats(y_train: np.ndarray) -> list[dict[str, float]]:
    results = []
    for output_index in range(y_train.shape[1]):
        values = y_train[:, output_index]
        mean = float(np.mean(values))
        variance = float(np.sum((values - mean) ** 2) / max(1, len(values) - 1))
        results.append(
            {
                "min": float(np.min(values)),
                "max": float(np.max(values)),
                "mean": mean,
                "std": max(np.sqrt(variance), 1e-6),
            }
        )
    return results


def _nearest_measured_distance(point: np.ndarray, measured_points: np.ndarray) -> float:
    if len(measured_points) == 0:
        return 1
    distances = np.sqrt(np.sum((measured_points - point) ** 2, axis=1))
    return float(np.min(distances))


def _scalarize_prediction(
    means: np.ndarray,
    stds: np.ndarray,
    stats: list[dict[str, float]],
    objectives: list[ObjectiveSpec],
    beta: float,
) -> float:
    score = 0.0
    for output_index, objective in enumerate(objectives):
        uncertainty = stds[output_index] / max(stats[output_index]["std"], 1e-6)
        mean_utility = objective_utility(means[output_index], objective, stats[output_index])
        if objective.goal == "target":
            if objective.target is None:
                raise ValueError(f"Objective {objective.name!r} needs a target.")
            mean_utility = 1 - abs(means[output_index] - objective.target) / max(stats[output_index]["std"] * 2, 1e-6)
        score += float(mean_utility) + beta * 0.22 * float(uncertainty)
    return score / len(objectives)


def recommend_next(
    data: pd.DataFrame,
    inputs: list[InputSpec],
    objectives: list[ObjectiveSpec],
    beta: float = DEFAULT_BETA,
    random_state: int = 0,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    del random_state  # Kept for API stability; the browser-mirror optimizer is deterministic.
    input_cols = [spec.name for spec in inputs]
    output_cols = [spec.name for spec in objectives]
    missing = [name for name in input_cols + output_cols if name not in data.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    measured = aggregate_measurements(data, inputs, objectives)
    if len(measured) < 2:
        raise ValueError("At least two measured experiments are needed for BO.")

    grid = make_grid(inputs)
    measured_keys = {tuple(f"{value:.12g}" for value in row) for row in measured[input_cols].to_numpy(float)}
    candidate_mask = [tuple(f"{value:.12g}" for value in row) not in measured_keys for row in grid[input_cols].to_numpy(float)]
    candidates = grid.loc[candidate_mask].reset_index(drop=True)
    if candidates.empty:
        raise ValueError("Every grid point has already been measured.")

    trimmed_measured = measured.tail(MAX_TRAINING_ROWS)
    x_train = _normalize_points(trimmed_measured[input_cols].to_numpy(float), inputs)
    y_train = trimmed_measured[output_cols].to_numpy(float)
    all_stats = _stats(y_train)
    models = [_BrowserSurrogate(x_train, y_train[:, output_index]) for output_index in range(len(objectives))]
    x_candidates = _normalize_points(candidates[input_cols].to_numpy(float), inputs)

    rows = []
    predicted_utility_rows = []
    for row_index, normalized_point in enumerate(x_candidates):
        means = []
        stds = []
        for model in models:
            mean, std = model.predict(normalized_point)
            means.append(mean)
            stds.append(std)
        means = np.array(means, dtype=float)
        stds = np.array(stds, dtype=float)

        utilities = np.array(
            [objective_utility(means[j], objectives[j], all_stats[j]) for j in range(len(objectives))],
            dtype=float,
        )
        novelty = _nearest_measured_distance(normalized_point, x_train)
        acquisition = _scalarize_prediction(means, stds, all_stats, objectives, beta) + 0.08 * novelty

        item = {name: candidates.loc[row_index, name] for name in input_cols}
        for output_index, objective in enumerate(objectives):
            item[f"predicted_{objective.name}"] = means[output_index]
            item[f"uncertainty_{objective.name}"] = stds[output_index]
        item["acquisition_score"] = acquisition
        rows.append(item)
        predicted_utility_rows.append(utilities)

    ranked = pd.DataFrame(rows).sort_values("acquisition_score", ascending=False).reset_index(drop=True)

    measured_utilities = np.column_stack(
        [
            objective_utility(measured[objective.name].to_numpy(float), objective, all_stats[output_index])
            for output_index, objective in enumerate(objectives)
        ]
    )
    measured_front = measured.loc[pareto_mask(measured_utilities)].copy()
    return ranked, measured, measured_front
