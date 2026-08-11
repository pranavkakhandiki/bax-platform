# BAX Platform

BAX Platform helps experimentalists choose the next experiment to run from a discrete grid of experimental conditions. Upload a CSV of completed experiments, define or load your inputs and objectives, and the app recommends the next unmeasured grid point using Bayesian optimization.

Use the website here: [BAX Platform](https://pranavkakhandiki.github.io/bax-platform/)

## What It Does

- Builds a grid from experimental input variables.
- Supports objectives to maximize, minimize, or target a specific value.
- Reads existing measurements from CSV.
- Shows the measured Pareto front.
- Recommends the next experiment with a UCB-style Bayesian optimization score.
- Exports ranked candidate experiments as CSV.

## Quick Start

1. Open the [website](https://pranavkakhandiki.github.io/bax-platform/).
2. Upload a self-describing CSV, such as `notebooks/sample_bo_starting_points.csv`.
3. Confirm the input variables and objectives loaded correctly.
4. Click `Recommend next experiment`.
5. Run the suggested experiment, add the result to your CSV, and upload the updated file again.

## CSV Format

The app accepts a normal measurement table, with optional setup rows at the top. Setup rows start with `#` and let the website recover the input bounds, step sizes, and objectives from the CSV itself.

```csv
# input,temperature,200,300,10
# input,pressure,20,60,4
# objective,yield,maximize,
# objective,median,target,10
temperature,pressure,yield,median
200,20,0.930,10.426
200,40,27.330,7.383
250,44,78.484,9.968
```

Input rows use:

```csv
# input,name,min,max,step
```

Objective rows use:

```csv
# objective,name,maximize,
# objective,name,minimize,
# objective,name,target,target_value
```

The measurement table columns must match the input and objective names exactly.

## Example Files

- `notebooks/sample_bo_starting_points.csv`: small temperature/pressure example.
- `notebooks/bo_validation_notebook.ipynb`: Python sanity check that mirrors the website recommendation.

## Local Development

Serve the site locally from the repo root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8000/
```

The deployed app is static and runs entirely in the browser, so it works on GitHub Pages without a backend.
