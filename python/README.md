# Python Optimization Package

This folder contains the reusable Python reference implementation for the BAX Platform optimizer.

The GitHub Pages app runs in the browser from `src/`, so it cannot import this package directly without a backend or a runtime such as Pyodide. The `recommend_next(...)` function intentionally mirrors the browser optimizer so notebooks can sanity-check the deployed platform.

Future BAX integration should add a new module beside `bo.py` and expose a similar `recommend_next(...)` style interface so the UI/backend boundary stays stable.
