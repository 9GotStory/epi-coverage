import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '../../../shared/components/ui/badge';
import type { AuditLog } from '../../../shared/types';

export const auditColumns: ColumnDef<AuditLog>[] = [
  {
    accessorKey: 'timestamp',
    header: 'วัน-เวลา',
    cell: ({ row }) => (
      <span className="text-xs text-slate-500 whitespace-nowrap">
        {new Date(row.getValue('timestamp')).toLocaleString('th-TH')}
      </span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'ผู้ดำเนินการ',
    cell: ({ row }) => <span className="font-medium text-slate-900 text-sm">{row.getValue('email')}</span>,
  },
  {
    accessorKey: 'action',
    header: 'การกระทำ',
    cell: ({ row }) => (
      <Badge variant="secondary" className="font-mono text-[10px]">
        {row.getValue('action')}
      </Badge>
    ),
  },
  {
    accessorKey: 'details',
    header: 'รายละเอียดเพิ่มเติม',
    cell: ({ row }) => <span className="text-sm text-slate-600">{row.getValue('details')}</span>,
  },
];
