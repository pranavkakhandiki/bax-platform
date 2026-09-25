# Python Optimization Package

This folder contains the reusable Python reference implementation for the BAX Platform BO optimizer.

The GitHub Pages app runs in the browser from `src/`, so it cannot import this package directly without a backend or a runtime such as Pyodide. The `recommend_next(...)` function intentionally mirrors the browser optimizer so notebooks can sanity-check the deployed platform.

The GitHub Pages BAX implementation lives in `src/bax.js`. It ports the Max-in-Bin, multiband-intersection, and MeanBAX behavior used by `multibax-sklearn`; see the project README and third-party notice for details.
