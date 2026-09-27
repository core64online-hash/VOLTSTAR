/**
 * Мінімальний парсер CSV для імпорту каталогу: лапки, роздільники всередині лапок, переноси
 * рядків у клітинці, подвоєні лапки (`""`), CRLF і BOM від Excel. Роздільник визначається за
 * заголовком — українські локалі Excel і LibreOffice зберігають із `;`, а не з комою.
 *
 * Окремої залежності не тягнемо: формат фіксований (наш власний шаблон прайсу), а решта
 * дрібних утиліт у проєкті теж свої.
 */

/** Рядок таблиці з номером у файлі — щоб звіт про помилки вказував, де саме проблема. */
export interface CsvRow {
  /** Номер рядка у файлі, як його показує редактор (заголовок — 1). */
  line: number;
  record: Record<string, string>;
}

interface RawRow {
  line: number;
  cells: string[];
}

/** Роздільник — той, якого більше в заголовку поза лапками. */
function detectDelimiter(text: string): string {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (ch === ',') commas++;
    else if (ch === ';') semicolons++;
    else if (ch === '\n') break;
  }
  return semicolons > commas ? ';' : ',';
}

function tokenize(text: string, delimiter: string): RawRow[] {
  const rows: RawRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const endRow = (): void => {
    cells.push(cell);
    // Порожні рядки (зокрема останній перенос у файлі) пропускаємо.
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r') continue;
    else if (ch === '\n') {
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (inQuotes) throw new Error(`Незакриті лапки у файлі (рядок ${rowLine})`);
  if (cell !== '' || cells.length > 0) endRow();
  return rows;
}

/**
 * Розбирає CSV у записи «заголовок → значення». Кидає помилку, якщо кількість колонок у рядку
 * не збігається із заголовком: у прайсі це майже завжди зсув даних, і мовчки його «виправляти»
 * означало б завантажити ціну не тому товару.
 */
export function parseCsv(text: string): CsvRow[] {
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(clean);
  const rows = tokenize(clean, delimiter);
  if (rows.length === 0) return [];

  const [header, ...body] = rows;
  const columns = header.cells.map((c) => c.trim());
  if (columns.every((c) => c === ''))
    throw new Error('Перший рядок файлу має бути заголовком колонок');

  return body.map(({ line, cells }) => {
    if (cells.length !== columns.length) {
      throw new Error(
        `Рядок ${line}: колонок ${cells.length}, а в заголовку ${columns.length} — перевірте роздільники й лапки`,
      );
    }
    const record: Record<string, string> = {};
    columns.forEach((name, i) => {
      if (name !== '') record[name] = cells[i].trim();
    });
    return { line, record };
  });
}
