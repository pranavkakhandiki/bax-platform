# BAX Platform

BAX Platform is a static GitHub Pages app for planning catalyst experiments with Bayesian optimization. Experimentalists define a gridded search space, add one or more objectives, upload measured data, and receive the next recommended experiment.

## Project Layout

```text
.
├── index.html                  # GitHub Pages entry point
├── assets/
│   └── styles.css              # App styling
├── src/                        # Browser app and client-side optimizer
│   ├── main.js                 # UI state, rendering, and events
│   ├── optimizer.js            # Dependency-free BO implementation for GitHub Pages
│   ├── csv.js                  # CSV parser
│   └── utils.js                # Formatting and parsing helpers
├── python/
│   └── bax_platform/           # Python reference optimizer and future BAX home
└── notebooks/
    ├── bo_validation_notebook.ipynb
    ├── sample_bo_starting_points.csv
    └── karime.csv
```

## Why JavaScript And Python?

The deployed website is static, so the optimizer in `src/optimizer.js` runs directly in the browser without a backend. The Python package mirrors the workflow for validation notebooks and future BAX integration. When a Python backend or Pyodide runtime is added, the UI can call into the Python/BAX layer without changing the experimentalist-facing workflow.

## Local Development

Serve the folder locally:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/`.

## Data Format

The CSV must use column names that exactly match the configured input and output variable names. See `notebooks/sample_bo_starting_points.csv` for a minimal example with `temperature`, `pressure`, `yield`, and `median`.

## Current Optimizer

The current browser optimizer fits an independent lightweight Gaussian-process surrogate for each output, converts objectives into utility scores, calculates the measured Pareto front, and ranks unmeasured grid points with a UCB-style acquisition score.
