# Python Optimization Package

This folder contains the reusable Python reference implementation for the BAX Platform optimizer.

The GitHub Pages app runs in the browser from `src/`, so it cannot import this package directly without a backend or a runtime such as Pyodide. Keep Python logic here for notebooks, validation, and future BAX integration.

Future BAX integration should add a new module beside `bo.py` and expose a similar `recommend_next(...)` style interface so the UI/backend boundary stays stable.
