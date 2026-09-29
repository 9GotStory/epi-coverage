/** @vitest-environment jsdom */
/**
 * OpenData View 3: independent FI and age-matched vaccine gauge contracts.
 * Synthetic aggregate rows only; no network calls or individual records.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpenDataDashboard } from './OpenDataDashboard';

const { useOpenDataMock, fixtureOptions } = vi.hoisted(() => ({
  useOpenDataMock: vi.fn(),
  fixtureOptions: { vaccineError: false, vaccineEmpty: false },
}));

vi.mock('../hooks/useOpenData', () => ({ useOpenData: useOpenDataMock }));
vi.mock('../../../shared/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', hoscode: '00588' } }),
}));
vi.mock('../../../shared/hooks/useFacilities', () => ({
  useFacilities: () => ({ data: [] }),
}));
vi.mock('../../../shared/hooks/useTargetSettings', () => ({
  useTargetSettings: () => ({
    getTarget: (_q: unknown, view: number, key?: string) =>
      view === 2 ? 80 : (key === 'bcg' ? 95 : 90),
  }),
}));
vi.mock('../../../shared/hooks/useAvailableYears', () => ({
  useAvailableYears: () => ({ years: [2569, 2570] }),
}));
vi.mock('./VaccineGaugeGrid', () => ({
  VaccineGaugeGrid: ({ data }: { data: Array<{ vaccine: string; result: number; target: number; goal?: number }> }) => (
    <div data-testid="shared-vaccine-gauges">
      {data.map(row => <span key={row.vaccine}>{row.vaccine + ':' + row.result + '/' + row.target + ':goal' + row.goal}</span>)}
    </div>
  ),
}));
vi.mock('./VaccineRadarChart', () => ({ VaccineRadarChart: () => null }));
vi.mock('./CumulativeCoverageChart', () => ({ CumulativeCoverageChart: () => null }));
vi.mock('../../../shared/components/ExportButtonGroup', () => ({ ExportButtonGroup: () => null }));
vi.mock('../../../shared/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }));
vi.mock('../api/openDataApi', () => ({ forceSyncOpenData: vi.fn() }));

const completeRows = [
  {
    id: '28dd2c7955ce926456240b2ff0100bde', hospcode: '06413', areacode: '54060101',
    target10: 10, result10: 6,
  },
  {
    id: '35f4a8d465e6e1edc05f3d8ab658c551', hospcode: '06413', areacode: '54060101',
    target10: 10, result10: 9,
  },
];

const reports: Record<string, Array<Record<string, string | number>>> = {
  s_epi1: [
    {
      hospcode: '06413', areacode: '54060101', target10: 10,
      bcg_10: 8, hbv4_10: 9, dtp_hb3_10: 8, hib3_10: 8,
      opv3_10: 8, ipv_10: 8, rota_10: 7, mmr_10: 8,
    },
  ],
  s_epi2: [
    {
      hospcode: '06413', areacode: '54060101', target10: 10,
      je2_10: 8, dtp4_10: 7, opv4_10: 9, mmr1_10: 8, mmr2_10: 9,
    },
  ],
  s_epi_complete: completeRows,
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  fixtureOptions.vaccineError = false;
  fixtureOptions.vaccineEmpty = false;
  useOpenDataMock.mockImplementation((payload: { tableName: string }, enabled?: boolean) => {
    const companion = payload.tableName !== 's_epi_complete' && enabled === true;
    const failed = companion && fixtureOptions.vaccineError;
    return {
      data: failed ? undefined : (companion && fixtureOptions.vaccineEmpty ? [] : (reports[payload.tableName] ?? [])),
      isLoading: false,
      isError: failed,
      error: failed ? new Error('synthetic companion failure') : null,
      refetch: vi.fn(),
    };
  });
});

function openFullyImmunized(targetTable: 's_epi1' | 's_epi2' = 's_epi1') {
  render(<OpenDataDashboard targetTable={targetTable} />);
  fireEvent.click(screen.getByRole('button', { name: 'รับวัคซีนครบชุด (View 2)' }));
}

describe('OpenData View 3 — shared vaccine gauges in Fully Immunized', () => {
  it('keeps FI from s_epi_complete and shows age-one gauges from s_epi1 with View 1 goals', () => {
    openFullyImmunized();

    expect(document.body.textContent).toContain('60.00%'); // FI = 6 / 10, not vaccine coverage
    const gauges = screen.getByTestId('shared-vaccine-gauges');
    expect(gauges.textContent).toContain('bcg:8/10:goal95');
    expect(gauges.textContent).toContain('rota:7/10:goal90');
    expect(useOpenDataMock).toHaveBeenCalledWith(expect.objectContaining({ tableName: 's_epi_complete' }));
    expect(useOpenDataMock).toHaveBeenCalledWith(expect.objectContaining({ tableName: 's_epi1' }), true);
    expect(document.body.textContent).toContain('แยกจากผล Fully Immunized');
  });

  it('selects the matching two-year vaccine report without mixing age-one FI records', () => {
    openFullyImmunized('s_epi2');

    expect(document.body.textContent).toContain('90.00%'); // FI 2yr = 9 / 10
    const gauges = screen.getByTestId('shared-vaccine-gauges');
    expect(gauges.textContent).toContain('dtp4:7/10:goal90');
    expect(gauges.textContent).not.toContain('bcg:');
    expect(useOpenDataMock).toHaveBeenCalledWith(expect.objectContaining({ tableName: 's_epi2' }), true);
  });

  it('shows companion fetch failure instead of zero vaccine gauges or changing FI results', () => {
    fixtureOptions.vaccineError = true;
    openFullyImmunized();

    expect(document.body.textContent).toContain('60.00%');
    expect(screen.getByRole('alert').textContent).toContain('synthetic companion failure');
    expect(screen.queryByTestId('shared-vaccine-gauges')).toBeNull();
  });

  it('shows an explicit no-data state when the age-matched vaccine report is empty', () => {
    fixtureOptions.vaccineEmpty = true;
    openFullyImmunized();

    expect(document.body.textContent).toContain('60.00%');
    expect(document.body.textContent).toContain('ไม่พบข้อมูลรายวัคซีน');
    expect(screen.queryByTestId('shared-vaccine-gauges')).toBeNull();
  });
});
