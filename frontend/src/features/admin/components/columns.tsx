import type { ColumnDef } from '@tanstack/react-table';
import type { User, UserRole, UserStatus } from '../../../shared/types';
import { Badge } from '../../../shared/components/ui/badge';
import { Button } from '../../../shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/components/ui/dropdown-menu';
import { MoreHorizontal, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
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

// We extend the TableMeta interface in a global declaration to have strong typing for our custom meta
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    currentUserId?: string;
    isUpdating?: string | null;
    handleUpdateStatus?: (googleId: string, newStatus: UserStatus, newRole?: UserRole) => Promise<void>;
    handleToggleActive?: (hoscode: string, currentActive: boolean) => Promise<void>;
  }
}

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => <span className="font-medium text-slate-900">{row.getValue('name')}</span>,
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => <span className="text-slate-500">{row.getValue('email')}</span>,
  },
  {
    accessorKey: 'hoscode',
    header: 'Facility (Hoscode)',
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-xs">
        {row.getValue('hoscode')}
      </Badge>
    ),
  },
  {
    accessorKey: 'role',
    header: 'Role',
    cell: ({ row }) => {
      const role = row.getValue('role') as UserRole;
      return (
        <Badge variant={role === 'admin' || role === 'superadmin' ? 'default' : 'secondary'}>
          {role}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.getValue('status') as UserStatus;
      if (status === 'approved') return <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-0">Approved</Badge>;
      if (status === 'pending') return <Badge className="bg-amber-50 text-amber-600 hover:bg-amber-100 border-0">Pending</Badge>;
      return <Badge className="bg-red-50 text-red-600 hover:bg-red-100 border-0">Rejected</Badge>;
    },
  },
  {
    id: 'actions',
    cell: ({ row, table }) => {
      const user = row.original;
      const meta = table.options.meta;
      
      const isSelf = user.google_id === meta?.currentUserId;
      const disabled = meta?.isUpdating === user.google_id || isSelf;

      return <UserCellActions user={user} meta={meta as any} disabled={disabled} />;
    },
  },
];

const UserCellActions = ({ user, meta, disabled }: { user: User; meta: any; disabled: boolean }) => {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertType, setAlertType] = useState<'approve' | 'reject' | 'promote' | null>(null);

  const handleConfirm = () => {
    if (alertType === 'approve') meta?.handleUpdateStatus?.(user.google_id, 'approved');
    if (alertType === 'reject') meta?.handleUpdateStatus?.(user.google_id, 'rejected');
    if (alertType === 'promote') meta?.handleUpdateStatus?.(user.google_id, user.status, 'admin');
    setIsAlertOpen(false);
  };

  const getAlertContent = () => {
    switch (alertType) {
      case 'approve': return { title: 'Approve User', desc: `Are you sure you want to approve access for ${user.email}?`, confirm: 'Approve' };
      case 'reject': return { title: 'Reject / Suspend User', desc: `Are you sure you want to reject or suspend access for ${user.email}? They will no longer be able to log in.`, confirm: 'Reject', destructive: true };
      case 'promote': return { title: 'Promote to Admin', desc: `Are you sure you want to promote ${user.email} to Admin? They will have full access to manage users and facilities.`, confirm: 'Promote' };
      default: return { title: '', desc: '', confirm: '' };
    }
  };

  const alertContent = getAlertContent();

  return (
    <div className="text-right">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0" disabled={disabled}>
            <span className="sr-only">Open menu</span>
            {meta?.isUpdating === user.google_id ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {user.status !== 'approved' && (
            <DropdownMenuItem onClick={() => { setAlertType('approve'); setIsAlertOpen(true); }} className="text-emerald-600 focus:text-emerald-700 cursor-pointer">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve Access
            </DropdownMenuItem>
          )}
          
          {user.status !== 'rejected' && (
            <DropdownMenuItem onClick={() => { setAlertType('reject'); setIsAlertOpen(true); }} className="text-red-600 focus:text-red-700 cursor-pointer">
              <XCircle className="mr-2 h-4 w-4" />
              Reject / Suspend
            </DropdownMenuItem>
          )}

          {user.role === 'user' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setAlertType('promote'); setIsAlertOpen(true); }} className="cursor-pointer">
                <ShieldAlert className="mr-2 h-4 w-4" />
                Promote to Admin
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertContent.title}</AlertDialogTitle>
            <AlertDialogDescription>{alertContent.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className={alertContent.destructive ? 'bg-red-600 hover:bg-red-700' : ''}>
              {alertContent.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
