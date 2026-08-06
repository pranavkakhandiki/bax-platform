from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
import warnings

import numpy as np
import pandas as pd
from sklearn.exceptions import ConvergenceWarning
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel
from sklearn.preprocessing import MinMaxScaler

Goal = Literal["maximize", "minimize", "target"]
DEFAULT_BETA = 1.2


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
    return np.arange(spec.minimum, spec.maximum + spec.step * 0.5, spec.step, dtype=float)


def make_grid(inputs: list[InputSpec]) -> pd.DataFrame:
    names = [spec.name for spec in inputs]
    mesh = np.meshgrid(*[axis_values(spec) for spec in inputs], indexing="ij")
    flat = np.column_stack([item.ravel() for item in mesh])
    return pd.DataFrame(flat, columns=names)


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
    return df.groupby(input_cols, as_index=False)[output_cols].mean()


def _stats(values: np.ndarray) -> dict[str, float]:
    return {
        "min": float(np.min(values)),
        "max": float(np.max(values)),
        "std": float(max(np.std(values, ddof=1), 1e-9)),
    }


def objective_utility(values: np.ndarray, objective: ObjectiveSpec, stats: dict[str, float]) -> np.ndarray:
    scale = max(stats["max"] - stats["min"], stats["std"], 1e-9)
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


def nearest_distance(points: np.ndarray, measured: np.ndarray) -> np.ndarray:
    delta = points[:, None, :] - measured[None, :, :]
    return np.sqrt(np.sum(delta**2, axis=2)).min(axis=1)


def _fit_gp_models(
    measured: pd.DataFrame,
    candidates: pd.DataFrame,
    inputs: list[InputSpec],
    objectives: list[ObjectiveSpec],
    random_state: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, dict[str, float]]]:
    input_cols = [spec.name for spec in inputs]
    x_scaler = MinMaxScaler()
    x_train = x_scaler.fit_transform(measured[input_cols])
    x_candidates = x_scaler.transform(candidates[input_cols])

    means = []
    stds = []
    all_stats = {}
    for objective in objectives:
        y = measured[objective.name].to_numpy(float)
        all_stats[objective.name] = _stats(y)
        kernel = (
            ConstantKernel(1.0, (0.1, 10.0))
            * Matern(length_scale=np.ones(len(input_cols)), nu=2.5)
            + WhiteKernel(noise_level=1e-3)
        )
        model = GaussianProcessRegressor(
            kernel=kernel,
            normalize_y=True,
            n_restarts_optimizer=5,
            random_state=random_state,
        )
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=ConvergenceWarning)
            model.fit(x_train, y)
        mu, sigma = model.predict(x_candidates, return_std=True)
        means.append(mu)
        stds.append(sigma)

    return np.column_stack(means), np.column_stack(stds), all_stats


def recommend_next(
    data: pd.DataFrame,
    inputs: list[InputSpec],
    objectives: list[ObjectiveSpec],
    beta: float = DEFAULT_BETA,
    random_state: int = 0,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    input_cols = [spec.name for spec in inputs]
    output_cols = [spec.name for spec in objectives]
    missing = [name for name in input_cols + output_cols if name not in data.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    measured = aggregate_measurements(data, inputs, objectives)
    if len(measured) < 2:
        raise ValueError("At least two measured experiments are needed for BO.")

    grid = make_grid(inputs)
    measured_keys = set(map(tuple, measured[input_cols].to_numpy()))
    candidate_mask = [tuple(row) not in measured_keys for row in grid[input_cols].to_numpy()]
    candidates = grid.loc[candidate_mask].reset_index(drop=True)
    if candidates.empty:
        raise ValueError("Every grid point has already been measured.")

    means, stds, all_stats = _fit_gp_models(measured, candidates, inputs, objectives, random_state)
    acquisition_parts = []
    for j, objective in enumerate(objectives):
        stats = all_stats[objective.name]
        utility = objective_utility(means[:, j], objective, stats)
        if objective.goal == "target":
            if objective.target is None:
                raise ValueError(f"Objective {objective.name!r} needs a target.")
            utility = 1 - np.abs(means[:, j] - objective.target) / max(stats["std"] * 2, 1e-9)
        uncertainty = stds[:, j] / max(stats["std"], 1e-9)
        acquisition_parts.append(utility + beta * 0.22 * uncertainty)

    x_scaler = MinMaxScaler().fit(measured[input_cols])
    novelty = nearest_distance(x_scaler.transform(candidates[input_cols]), x_scaler.transform(measured[input_cols]))
    acquisition = np.mean(np.column_stack(acquisition_parts), axis=1) + 0.08 * novelty

    ranked = candidates.copy()
    for j, objective in enumerate(objectives):
        ranked[f"predicted_{objective.name}"] = means[:, j]
        ranked[f"uncertainty_{objective.name}"] = stds[:, j]
    ranked["acquisition_score"] = acquisition
    ranked = ranked.sort_values("acquisition_score", ascending=False).reset_index(drop=True)

    measured_utilities = np.column_stack(
        [objective_utility(measured[objective.name].to_numpy(float), objective, all_stats[objective.name]) for objective in objectives]
    )
    measured_front = measured.loc[pareto_mask(measured_utilities)].copy()
    return ranked, measured, measured_front
