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
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end 
    : 0;

  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div 
        ref={tableContainerRef}
        className="overflow-auto max-h-[560px]"
      >
        <Table>
          <TableHeader className="bg-zinc-50/80 sticky top-0 z-10 backdrop-blur-sm shadow-[0_1px_0_rgba(0,0,0,0.05)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: header.getSize() !== 150 ? header.getSize() : undefined,
                      }}
                      className="whitespace-nowrap text-[11px] font-semibold tracking-wider text-zinc-500 uppercase h-11 px-4 border-b border-zinc-200"
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
                <TableCell colSpan={columns.length} className="h-48 text-center">
                  <div className="flex flex-col items-center justify-center text-zinc-400">
                    <svg className="w-10 h-10 mb-3 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-sm font-medium text-zinc-500">ไม่มีข้อมูลแสดงผล</p>
                  </div>
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
                      className="hover:bg-blue-50/40 transition-colors duration-200"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className="py-3 px-4 text-[13.5px] align-top"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 bg-zinc-50/50">
          <span className="text-xs text-zinc-500">
            แสดงทั้งหมด{' '}
            <span className="font-semibold text-zinc-700">{rows.length.toLocaleString()}</span> รายการ
          </span>
        </div>
      )}
    </div>
  );
}
