import { Injectable } from '@nestjs/common';
import type { LoadItem, PowerCalculation, SelectorInput } from '@voltstar/types';

/** Коефіцієнти пускового струму за типом навантаження. */
const STARTUP_COEFFICIENT: Record<LoadItem['loadType'], number> = {
  RESISTIVE: 1.0, // ТЕНи, лампи розжарювання — без стрибка
  ELECTRONIC: 1.5, // імпульсні БЖ, ПК
  INDUCTIVE: 3.0, // холодильники, насоси, кондиціонери
  MOTOR: 4.0, // двигуни з прямим пуском, компресори
};

/** Додатковий запас потужності залежно від режиму використання. */
const MODE_RESERVE: Record<SelectorInput['usageMode'], number> = {
  BACKUP: 0,
  PRIME: 0.1, // основне джерело — більший запас на тривалу роботу
  MOBILE: 0.05,
};

const POWER_FACTOR = 0.8; // cosφ для перерахунку кВт → кВА

/** Те з розрахунку, від чого залежить добір товарів. */
export type PowerNeeds = Pick<PowerCalculation, 'runningW' | 'peakW' | 'recommendedW' | 'phase'>;

/** Мінімум полів товару, потрібний для добору (підходить і Prisma-рядок, і публічний DTO). */
export interface Candidate {
  ratedPowerW: number;
  maxPowerW: number;
  phase: string;
}

@Injectable()
export class SelectorService {
  /**
   * Розрахунок потрібної потужності генератора під перелік споживачів.
   * Логіка: сумарна робоча потужність + пусковий стрибок + запас.
   */
  calculatePower(input: SelectorInput): PowerCalculation {
    let runningW = 0;
    let simultaneousExtraW = 0;
    let maxSequentialExtraW = 0;

    for (const item of input.items) {
      const itemRunningW = item.powerW * item.quantity;
      runningW += itemRunningW;

      const coeff = STARTUP_COEFFICIENT[item.loadType];
      const startupExtraW = itemRunningW * (coeff - 1);

      if (item.simultaneousStart) {
        // Усі одночасні стартери додаються разом.
        simultaneousExtraW += startupExtraW;
      } else {
        // Серед послідовних стартерів рахуємо лише найбільший стрибок.
        maxSequentialExtraW = Math.max(maxSequentialExtraW, startupExtraW);
      }
    }

    const peakW = Math.round(runningW + simultaneousExtraW + maxSequentialExtraW);

    const reserve = input.reserveFactor + MODE_RESERVE[input.usageMode];
    // Рекомендована номінальна потужність має покривати і робочу з запасом, і пік.
    const recommendedW = Math.round(Math.max(runningW * (1 + reserve), peakW));
    const recommendedKva = Number((recommendedW / 1000 / POWER_FACTOR).toFixed(2));

    return {
      runningW: Math.round(runningW),
      peakW,
      recommendedW,
      recommendedKva,
      phase: input.phase,
    };
  }

  /**
   * Ранжування кандидатів каталогу за відповідністю розрахунку: генератор має покривати
   * і рекомендовану потужність із запасом, і піковий стрибок.
   */
  rankCandidates<T extends Candidate>(candidates: T[], calc: PowerNeeds): T[] {
    return candidates
      .filter((c) => c.ratedPowerW >= calc.recommendedW && c.maxPowerW >= calc.peakW)
      .filter((c) => c.phase === calc.phase)
      .sort((a, b) => a.ratedPowerW - b.ratedPowerW); // найближчий за потужністю — першим
  }

  /**
   * Дві групи кандидатів для сторінки підбору.
   *
   * `exact` — те саме, що `rankCandidates`: повністю покриває розрахунок.
   * `close` — потягне навантаження (`ratedPowerW >= runningW`) і витримає пусковий стрибок
   * (`maxPowerW >= peakW`), але запас менший за той, що задав клієнт. Показувати такі варто:
   * запас — це побажання, а не фізична межа. Сортуються за спаданням, щоб найближчий знизу
   * був першим.
   *
   * Фазність в обох групах збігається точно й ніколи не послаблюється: однофазному будинку
   * трифазний генератор не підходить, і навпаки.
   */
  matchCandidates<T extends Candidate>(
    candidates: T[],
    calc: PowerNeeds,
  ): { exact: T[]; close: T[] } {
    const exact = this.rankCandidates(candidates, calc);
    const inExact = new Set<T>(exact);
    const close = candidates
      .filter((c) => !inExact.has(c))
      .filter((c) => c.phase === calc.phase)
      .filter((c) => c.maxPowerW >= calc.peakW && c.ratedPowerW >= calc.runningW)
      .sort((a, b) => b.ratedPowerW - a.ratedPowerW);
    return { exact, close };
  }
}
