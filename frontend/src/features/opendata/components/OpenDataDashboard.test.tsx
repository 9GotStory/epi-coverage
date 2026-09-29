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
  {
    id: 'd1fe173d08e959397adf34b1d77e88d7', hospcode: '06413', areacode: '54060101',
    target10: 10, result10: 3,
  },
  {
    id: 'f033ab37c30201f73f142449d037028d', hospcode: '06413', areacode: '54060101',
    target10: 10, result10: 4,
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
  s_epi3: [
    { hospcode: '06413', areacode: '54060101', target10: 10, je3_10: 9 },
  ],
  s_epi5: [
    { hospcode: '06413', areacode: '54060101', target10: 10, dtp5_10: 8, opv5_10: 7 },
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

function openFullyImmunized(targetTable: 's_epi1' | 's_epi2' | 's_epi3' | 's_epi5' = 's_epi1') {
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

  it('keeps age-three FI independent of the only age-three reported vaccine', () => {
    openFullyImmunized('s_epi3');

    expect(document.body.textContent).toContain('30.00%'); // FI = 3 / 10
    const gauges = screen.getByTestId('shared-vaccine-gauges');
    expect(gauges.textContent).toContain('je3:9/10:goal90');
    expect(gauges.textContent).not.toContain('dtp5:');
  });

  it('uses the two reported age-five vaccines while keeping FI separate', () => {
    openFullyImmunized('s_epi5');

    expect(document.body.textContent).toContain('40.00%'); // FI = 4 / 10
    const gauges = screen.getByTestId('shared-vaccine-gauges');
    expect(gauges.textContent).toContain('dtp5:8/10:goal90');
    expect(gauges.textContent).toContain('opv5:7/10:goal90');
    expect(gauges.textContent).not.toContain('je3:');
  });

  it('applies the selected facility to both FI and vaccine gauges', () => {
    const original = useOpenDataMock.getMockImplementation()!;
    useOpenDataMock.mockImplementation((payload: { tableName: string }, enabled?: boolean) => {
      const response = original(payload, enabled);
      const secondFacility = {
        hospcode: '06414', areacode: '54060102', target10: 10, bcg_10: 10,
        hbv4_10: 10, dtp_hb3_10: 10, hib3_10: 10, opv3_10: 10, ipv_10: 10,
        rota_10: 10, mmr_10: 10,
      };
      if (payload.tableName === 's_epi1') {
        return { ...response, data: [...response.data, secondFacility] };
      }
      if (payload.tableName === 's_epi_complete') {
        return {
          ...response,
          data: [...response.data, {
            id: '28dd2c7955ce926456240b2ff0100bde',
            hospcode: '06414', areacode: '54060102', target10: 10, result10: 10,
          }],
        };
      }
      return response;
    });
    openFullyImmunized('s_epi1');
    expect(document.body.textContent).toContain('80.00%'); // both facilities, 16/20

    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: '06413' } });
    expect(document.body.textContent).toContain('60.00%'); // selected facility 6/10
    const gauges = screen.getByTestId('shared-vaccine-gauges');
    expect(gauges.textContent).toContain('bcg:8/10:goal95'); // not 18/20
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
