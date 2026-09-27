import { describe, expect, it, beforeEach } from 'vitest';
import type { SelectorInput } from '@voltstar/types';
import { SelectorService } from './selector.service';

describe('SelectorService.calculatePower', () => {
  let service: SelectorService;

  beforeEach(() => {
    service = new SelectorService();
  });

  it('резистивне навантаження: пік = робочій потужності, застосовується запас', () => {
    const input: SelectorInput = {
      items: [
        {
          label: 'Обігрівач',
          powerW: 2000,
          quantity: 1,
          loadType: 'RESISTIVE',
          simultaneousStart: false,
        },
      ],
      phase: 'SINGLE',
      reserveFactor: 0.2,
      usageMode: 'BACKUP',
    };
    const r = service.calculatePower(input);
    expect(r.runningW).toBe(2000);
    expect(r.peakW).toBe(2000);
    expect(r.recommendedW).toBe(2400); // 2000 * 1.2
    expect(r.recommendedKva).toBeCloseTo(3.0, 2);
  });

  it('індуктивне (послідовний старт): додається лише найбільший пусковий стрибок', () => {
    const input: SelectorInput = {
      items: [
        {
          label: 'Холодильник',
          powerW: 200,
          quantity: 1,
          loadType: 'INDUCTIVE',
          simultaneousStart: false,
        },
        {
          label: 'Обігрівач',
          powerW: 1500,
          quantity: 1,
          loadType: 'RESISTIVE',
          simultaneousStart: false,
        },
      ],
      phase: 'SINGLE',
      reserveFactor: 0.2,
      usageMode: 'BACKUP',
    };
    const r = service.calculatePower(input);
    expect(r.runningW).toBe(1700);
    expect(r.peakW).toBe(2100); // 1700 + 200*(3-1)
    expect(r.recommendedW).toBe(2100); // max(1700*1.2=2040, 2100)
  });

  it('двигун з одночасним пуском: враховується повний пусковий струм', () => {
    const input: SelectorInput = {
      items: [
        {
          label: 'Компресор',
          powerW: 1000,
          quantity: 1,
          loadType: 'MOTOR',
          simultaneousStart: true,
        },
      ],
      phase: 'THREE',
      reserveFactor: 0.2,
      usageMode: 'BACKUP',
    };
    const r = service.calculatePower(input);
    expect(r.runningW).toBe(1000);
    expect(r.peakW).toBe(4000); // 1000 + 1000*(4-1)
    expect(r.recommendedW).toBe(4000);
    expect(r.phase).toBe('THREE');
  });

  it('режим PRIME збільшує запас потужності', () => {
    const base: SelectorInput = {
      items: [
        {
          label: 'ТЕН',
          powerW: 1000,
          quantity: 1,
          loadType: 'RESISTIVE',
          simultaneousStart: false,
        },
      ],
      phase: 'SINGLE',
      reserveFactor: 0.2,
      usageMode: 'PRIME',
    };
    const r = service.calculatePower(base);
    expect(r.recommendedW).toBe(1300); // 1000 * (1 + 0.2 + 0.1)
  });
});

describe('SelectorService.rankCandidates', () => {
  it('фільтрує за потужністю і фазою та сортує від найближчого', () => {
    const service = new SelectorService();
    const calc = {
      runningW: 1700,
      peakW: 2100,
      recommendedW: 2100,
      recommendedKva: 2.63,
      phase: 'SINGLE' as const,
    };
    const candidates = [
      { ratedPowerW: 3000, maxPowerW: 3300, phase: 'SINGLE' },
      { ratedPowerW: 2200, maxPowerW: 2500, phase: 'SINGLE' },
      { ratedPowerW: 2200, maxPowerW: 2500, phase: 'THREE' }, // інша фаза — відсіється
      { ratedPowerW: 1500, maxPowerW: 1600, phase: 'SINGLE' }, // замало — відсіється
    ];
    const ranked = service.rankCandidates(candidates, calc);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].ratedPowerW).toBe(2200);
    expect(ranked[1].ratedPowerW).toBe(3000);
  });
});

describe('SelectorService.matchCandidates', () => {
  const service = new SelectorService();
  // Треба 4 кВт роботи, 5 кВт піку, 5 кВт із запасом 20 %.
  const calc = { runningW: 4000, peakW: 5000, recommendedW: 5000, phase: 'SINGLE' as const };
  const p = (ratedPowerW: number, maxPowerW: number, phase = 'SINGLE') => ({
    ratedPowerW,
    maxPowerW,
    phase,
  });

  it('точні збіги — від найближчого вгору, близькі — від найближчого вниз', () => {
    const { exact, close } = service.matchCandidates(
      [p(8000, 9000), p(5500, 6000), p(4200, 5200), p(4800, 5300)],
      calc,
    );
    expect(exact.map((c) => c.ratedPowerW)).toEqual([5500, 8000]);
    expect(close.map((c) => c.ratedPowerW)).toEqual([4800, 4200]);
  });

  it('у «близькі» не потрапляє те, що не витримає пуск або не потягне роботу', () => {
    const { close } = service.matchCandidates(
      [
        p(4500, 4800), // пік нижчий за 5000 — не витримає стрибок
        p(3500, 6000), // не тягне робочі 4000
        p(4600, 5100), // підходить
      ],
      calc,
    );
    expect(close.map((c) => c.ratedPowerW)).toEqual([4600]);
  });

  it('фазність не послаблюється в жодній із груп', () => {
    const { exact, close } = service.matchCandidates(
      [p(6000, 7000, 'THREE'), p(4500, 5200, 'THREE')],
      calc,
    );
    expect(exact).toEqual([]);
    expect(close).toEqual([]);

    const three = service.matchCandidates([p(6000, 7000, 'THREE')], { ...calc, phase: 'THREE' });
    expect(three.exact).toHaveLength(1);
  });

  it('групи не перетинаються: те, що потрапило в точні, не дублюється в близьких', () => {
    const { exact, close } = service.matchCandidates([p(5000, 5000)], calc);
    expect(exact).toHaveLength(1);
    expect(close).toEqual([]);
  });

  it('порожній каталог — обидві групи порожні', () => {
    expect(service.matchCandidates([], calc)).toEqual({ exact: [], close: [] });
  });
});
