export function encodeCsv(rows, columns) {
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${[columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(escape).join(","))
    .join("\n")}\n`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const [headers, ...data] = rows.filter((item) => item.some((value) => value !== ""));
  if (!headers?.length) throw new Error("CSV is empty");
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate headers");
  return data.map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${rowIndex + 2} has the wrong column count`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}
