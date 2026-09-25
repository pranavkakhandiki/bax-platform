function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);

  return rows;
}

function cleanCell(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function metadataKind(row) {
  return cleanCell(row[0]).replace(/^#\s*/, "").toLowerCase();
}

function parseNumber(value) {
  const number = Number(cleanCell(value));
  return Number.isFinite(number) ? number : "";
}

function parseMetadataRow(row, metadata) {
  const kind = metadataKind(row);
  if (kind === "method") {
    const method = cleanCell(row[1]).toLowerCase();
    metadata.method = ["bo", "bax"].includes(method) ? method : "";
    return true;
  }

  if (kind === "input") {
    const name = cleanCell(row[1]);
    if (!name) return true;
    metadata.inputs.push({
      name,
      min: parseNumber(row[2]),
      max: parseNumber(row[3]),
      step: parseNumber(row[4]),
    });
    return true;
  }

  if (kind === "objective" || kind === "output") {
    const name = cleanCell(row[1]);
    if (!name) return true;
    const goal = cleanCell(row[2]).toLowerCase() || "maximize";
    metadata.outputs.push({
      name,
      goal: ["maximize", "minimize", "target"].includes(goal) ? goal : "maximize",
      target: goal === "target" ? parseNumber(row[3]) : "",
    });
    return true;
  }

  if (kind === "bax_algorithm") {
    metadata.bax.algorithm = cleanCell(row[1]).toLowerCase();
    return true;
  }

  if (kind === "bax_acquisition") {
    metadata.bax.acquisition = cleanCell(row[1]).toLowerCase();
    return true;
  }

  if (kind === "bax_maximize") {
    metadata.bax.maximizeOutput = cleanCell(row[1]);
    return true;
  }

  if (kind === "bax_bin_output") {
    metadata.bax.binOutput = cleanCell(row[1]);
    return true;
  }

  if (kind === "bax_bin") {
    metadata.bax.bins.push({ min: parseNumber(row[1]), max: parseNumber(row[2]) });
    return true;
  }

  if (kind === "bax_points_per_bin") {
    metadata.bax.pointsPerBin = parseNumber(row[1]);
    return true;
  }

  if (kind === "bax_epsilon") {
    metadata.bax.epsilon = parseNumber(row[1]);
    return true;
  }

  if (kind === "bax_bound") {
    metadata.bax.bounds.push({
      output: cleanCell(row[1]),
      min: parseNumber(row[2]),
      max: parseNumber(row[3]),
    });
    return true;
  }

  return cleanCell(row[0]).startsWith("#");
}

export function parseCsv(text) {
  const rows = parseCsvRows(text);
  const metadata = {
    method: "",
    inputs: [],
    outputs: [],
    bax: {
      algorithm: "",
      acquisition: "",
      maximizeOutput: "",
      binOutput: "",
      bins: [],
      pointsPerBin: "",
      epsilon: "",
      bounds: [],
    },
  };
  let headerIndex = 0;

  while (headerIndex < rows.length && parseMetadataRow(rows[headerIndex], metadata)) {
    headerIndex += 1;
  }

  if (headerIndex >= rows.length) return { headers: [], data: [], metadata };
  const headers = rows[headerIndex].map((header) => cleanCell(header));
  const data = rows.slice(headerIndex + 1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] === undefined ? "" : cleanCell(values[index]);
    });
    return record;
  });
  return { headers, data, metadata };
}
