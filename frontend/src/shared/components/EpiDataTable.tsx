import { useRef } from 'react';
import { useReactTable, getCoreRowModel, flexRender } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { EmptyState } from './EmptyState';

interface EpiDataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
}

export function EpiDataTable<TData>({ data, columns }: EpiDataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 56, // estimated row height
    overscan: 5,
    initialRect: { width: 800, height: 600 },
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end 
    : 0;

  return (
    <div className="border border-[#e0e0e0] rounded-xl overflow-hidden bg-white">
      <div 
        ref={tableContainerRef}
        className="overflow-auto max-h-[560px] min-h-[300px]"
      >
        <Table>
          <TableHeader className="hidden md:table-header bg-[#f5f5f7]/80 sticky top-0 z-10 backdrop-blur-md shadow-[0_1px_0_#e0e0e0]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent border-b-0">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: header.getSize() !== 150 ? header.getSize() : undefined,
                      }}
                      className="whitespace-nowrap text-[12px] font-medium tracking-[0.02em] text-[#7a7a7a] h-[44px] px-4 border-b-0"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0 border-b-0">
                  <EmptyState className="border-0 rounded-none w-full" />
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paddingTop > 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
                  </TableRow>
                )}
                {virtualItems.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <TableRow
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      data-state={row.getIsSelected() && "selected"}
                      className="block md:table-row hover:bg-[#f5f5f7] transition-colors duration-200 border-b border-[#e0e0e0] md:border-[#e0e0e0]/50 last:border-b-0 p-4 md:p-0 relative bg-white md:bg-transparent mb-4 md:mb-0 rounded-xl md:rounded-none shadow-sm md:shadow-none"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className="flex md:table-cell py-2 md:py-3.5 px-0 md:px-4 text-[14px] text-[#1d1d1f] align-top tracking-[-0.224px] border-b border-[#f0f0f0] md:border-b-0 last:border-b-0 justify-between items-center md:justify-normal md:items-start"
                        >
                          <span className="md:hidden font-medium text-[#7a7a7a] text-[12px] mr-4">
                            {typeof cell.column.columnDef.header === 'string' 
                              ? cell.column.columnDef.header 
                              : cell.column.id}
                          </span>
                          <div className="text-right md:text-left">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#e0e0e0] bg-[#f5f5f7]">
          <span className="text-[13px] text-[#7a7a7a] tracking-[-0.08px]">
            แสดงทั้งหมด{' '}
            <span className="font-semibold text-[#1d1d1f]">{rows.length.toLocaleString()}</span> รายการ
          </span>
        </div>
      )}
    </div>
  );
}
