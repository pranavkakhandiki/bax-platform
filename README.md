# BAX Platform

Static browser prototype for Bayesian experiment planning. It lets an experimentalist:

- define a gridded search space for input variables,
- define output objectives as maximize, minimize, or target value,
- upload a CSV of measured experiments,
- get a ranked list of unmeasured grid points to run next.

Open `index.html` directly, serve this folder with a static server, or publish the folder with GitHub Pages.

## Notes

The current optimizer is a lightweight client-side multi-objective Bayesian optimization prototype. It fits an independent Gaussian-process surrogate for each output, converts outputs into objective utilities, calculates the measured Pareto front, and ranks unmeasured grid points with a confidence-bound acquisition score.

The CSV must use column names that exactly match the configured input and output variable names.
