import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function encode(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function writeCsv(path, rows, columns) {
  await mkdir(dirname(path), { recursive: true });
  const lines = [
    columns.map(encode).join(","),
    ...rows.map((row) => columns.map((column) => encode(row[column])).join(",")),
  ];
  await writeFile(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

function parse(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/u, ""));
    records.push(record);
  }
  return records;
}

export async function readCsv(path) {
  const records = parse(await readFile(path, "utf8"));
  const [headers = [], ...rows] = records.filter(
    (record) => !(record.length === 1 && record[0] === ""),
  );
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}
