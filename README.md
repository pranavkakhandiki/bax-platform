# BAX Platform

BAX Platform helps experimentalists choose the next experiment from a discrete grid of conditions. It supports standard Bayesian optimization (BO) and goal-directed Bayesian algorithm execution (BAX).

Open the tool: [BAX Platform](https://pranavkakhandiki.github.io/bax-platform/)

## Quick Start

1. Open the website and choose BO or BAX.
2. Upload a self-describing CSV from the examples below, or enter the setup manually.
3. Confirm the input grid, outputs, and algorithm settings.
4. Select **Recommend next experiment**.
5. Run the recommendation, append the measurements to the CSV, and upload it again.

All calculations run locally in the browser. Uploaded measurements are not sent to a server.

## Available Methods

BO supports multiple outputs that can each be maximized, minimized, or brought close to a target value. Its standard acquisition balances predicted performance and uncertainty, with an optional UCB beta control.

BAX currently supports:

- **Max-in-Bin:** find the highest value of one output in each interval of another output. For example, maximize yield in several median particle-size bins.
- **Bounded Library:** find conditions whose predicted outputs all lie inside specified ranges. For example, median between 1 and 4 and yield between 50 and 60.

The BAX acquisition follows the `multibax-sklearn` MeanBAX procedure used by BAXstics: execute the user algorithm on GP posterior means, then measure the most uncertain unmeasured member of the predicted target set. If that set is empty or already measured, it falls back to uncertainty sampling. The subset algorithms are browser-native ports of [multibax-sklearn](https://github.com/src47/multibax-sklearn), allowing the static GitHub Pages deployment to run without a Python server.

## CSV Format

Setup rows begin with `#` and appear before the measurement table. They allow one upload to restore the method, grid, outputs, BAX algorithm, and algorithm parameters.

Every file starts with a method and input definitions:

```csv
# method,bo
# input,temperature,200,300,10
# input,pressure,20,60,4
```

BO output objectives use:

```csv
# objective,yield,maximize,
# objective,cost,minimize,
# objective,median,target,10
```

A Max-in-Bin BAX setup uses:

```csv
# method,bax
# bax_algorithm,max_in_bin
# bax_maximize,yield
# bax_bin_output,median
# bax_bin,8,10
# bax_bin,10,12
# bax_points_per_bin,1
# bax_epsilon,0
# output,yield
# output,median
```

A bounded-library BAX setup uses one bound per output:

```csv
# method,bax
# bax_algorithm,library
# bax_bound,yield,50,60
# bax_bound,median,1,4
# output,yield
# output,median
```

The final measurement table must use column names that exactly match the declared inputs and outputs.

## Examples

- [`notebooks/sample_bo_starting_points.csv`](notebooks/sample_bo_starting_points.csv): BO with temperature, pressure, yield, and a median target.
- [`notebooks/sample_bax_max_in_bin.csv`](notebooks/sample_bax_max_in_bin.csv): BAX maximizing yield across median bins.
- [`notebooks/sample_bax_library.csv`](notebooks/sample_bax_library.csv): BAX searching for a bounded yield/median library.
- [`notebooks/bo_validation_notebook.ipynb`](notebooks/bo_validation_notebook.ipynb): Python validation of the BO recommendation.

## Local Development

From the repository root, run:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/`.

Run the browser optimizer tests with:

```bash
npm test
```
