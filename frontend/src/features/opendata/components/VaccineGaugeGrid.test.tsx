/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VaccineGaugeGrid, type VaccineCoverageData } from './VaccineGaugeGrid';

// Test real labels and states without tying assertions to Recharts internals.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RadialBarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RadialBar: () => null,
  PolarAngleAxis: () => null,
}));

afterEach(() => cleanup());

const vaccine: VaccineCoverageData = {
  vaccine: 'bcg', label: 'BCG (1 เข็ม)', target: 10, result: 8, coverage: 80,
};

describe('shared OpenData vaccine gauges — target and denominator states', () => {
  it('uses a vaccine-specific goal in preference to the view goal', () => {
    render(<VaccineGaugeGrid data={[{ ...vaccine, goal: 95 }]} goalTarget={90} />);
    expect(screen.getByText('เป้า 95%')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
  });

  it('never invents a 90% goal when both goal sources are absent', () => {
    render(<VaccineGaugeGrid data={[vaccine]} />);
    expect(screen.getByText('ยังไม่ได้กำหนดเป้าหมาย')).toBeTruthy();
    expect(screen.queryByText('เป้า 90%')).toBeNull();
    expect(screen.getByText('80%').className).toContain('text-zinc-500');
  });

  it('shows unavailable coverage rather than 0% for a zero denominator', () => {
    render(<VaccineGaugeGrid data={[{ ...vaccine, target: 0, result: 0, coverage: 0 }]} goalTarget={90} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('respects an explicitly configured goal of zero', () => {
    render(<VaccineGaugeGrid data={[{ ...vaccine, goal: 0 }]} goalTarget={90} />);
    expect(screen.getByText('เป้า 0%')).toBeTruthy();
  });
});
