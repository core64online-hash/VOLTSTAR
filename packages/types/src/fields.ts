import { z } from 'zod';

/**
 * Поля, спільні для схем каталогу (адмін-панель і масовий імпорт). Тримаємо в одному місці,
 * щоб обмеження не розʼїхалися: імпорт не має бути єдиним шляхом, яким у БД потрапляє те,
 * чого адмінка не пропустила б.
 */

/** Машинна назва в адресі: лише латиниця в нижньому регістрі, цифри й дефіси. */
export const slugField = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Лише латиниця в нижньому регістрі, цифри й дефіси');

/** Лише http(s)-адреси: `z.string().url()` сам по собі пропускає `javascript:` тощо. */
export const imageUrlField = z
  .string()
  .trim()
  .url()
  .regex(/^https?:\/\//i, 'Адреса зображення має починатися з http(s)://');

/** Бортова напруга, В: 6/12/24/28 і подібні, зі стелею проти помилки на порядок. */
export const voltageField = z.number().int().positive().max(120);

/** Потужність стартера, кВт: до 30 кВт вистачає і найважчій техніці. */
export const powerKwField = z.number().positive().max(30);

/** Струм віддачі генератора, А. */
export const amperageField = z.number().int().positive().max(500);

/** Кількість зубів на шестерні бендикса. */
export const teethField = z.number().int().positive().max(30);
