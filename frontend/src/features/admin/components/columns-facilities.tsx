import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '../../../shared/components/ui/badge';
import { Switch } from '../../../shared/components/ui/switch';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../shared/components/ui/alert-dialog';

interface Facility {
  hoscode: string;
  hosname: string;
  is_active: boolean;
}

export const facilityColumns: ColumnDef<Facility>[] = [
  {
    accessorKey: 'hoscode',
    header: 'Hoscode',
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-xs">
        {row.getValue('hoscode')}
      </Badge>
    ),
  },
  {
    accessorKey: 'hosname',
    header: 'Facility Name',
    cell: ({ row }) => <span className="font-medium text-slate-900">{row.getValue('hosname')}</span>,
  },
  {
    accessorKey: 'is_active',
    header: 'Status',
    cell: ({ row }) => {
      const isActive = String(row.getValue('is_active')).toUpperCase() === 'TRUE';
      return isActive ? (
        <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-0">Active</Badge>
      ) : (
        <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200 border-0">Inactive</Badge>
      );
    },
  },
  {
    id: 'actions',
    header: () => <div className="text-right">Toggle Active</div>,
    cell: ({ row, table }) => {
      const fac = row.original;
      const meta = table.options.meta;
      return <FacilityCellActions fac={fac} meta={meta as any} />;
    },
  },
];

const FacilityCellActions = ({ fac, meta }: { fac: Facility; meta: any }) => {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const isActive = String(fac.is_active).toUpperCase() === 'TRUE';

  const handleToggleAttempt = () => {
    setIsAlertOpen(true);
  };

  const handleConfirm = () => {
    meta?.handleToggleActive?.(fac.hoscode, isActive);
    setIsAlertOpen(false);
  };

  return (
    <div className="flex justify-end pr-2">
      <Switch 
        checked={isActive}
        onCheckedChange={handleToggleAttempt}
      />

      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Facility Status</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {isActive ? 'deactivate' : 'activate'} <strong>{fac.hosname}</strong>?
              {!isActive && ' They will regain access to the system.'}
              {isActive && ' They will no longer be able to log in or submit data.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className={isActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}>
              Yes, {isActive ? 'Deactivate' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
