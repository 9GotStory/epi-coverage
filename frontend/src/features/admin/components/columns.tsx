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
import { MoreHorizontal, CheckCircle2, XCircle, ShieldAlert, Building2 } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/components/ui/select';

// We extend the TableMeta interface in a global declaration to have strong typing for our custom meta
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    currentUserId?: string;
    isUpdating?: string | null;
    handleUpdateStatus?: (googleId: string, newStatus: UserStatus, newRole?: UserRole) => Promise<void>;
    handleUpdateFacility?: (googleId: string, newHoscode: string) => Promise<void>;
    facilities?: {hoscode: string, hosname: string, is_active: boolean}[];
    handleToggleActive?: (hoscode: string, currentActive: boolean) => Promise<void>;
  }
}

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: 'name',
    header: 'ชื่อ-สกุล',
    cell: ({ row }) => <span className="font-medium text-slate-900">{row.getValue('name')}</span>,
  },
  {
    accessorKey: 'email',
    header: 'อีเมล',
    cell: ({ row }) => <span className="text-slate-500">{row.getValue('email')}</span>,
  },
  {
    accessorKey: 'hoscode',
    header: 'รหัสสถานบริการ',
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-xs">
        {row.getValue('hoscode')}
      </Badge>
    ),
  },
  {
    accessorKey: 'role',
    header: 'สิทธิ์ (Role)',
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
    header: 'สถานะ',
    cell: ({ row }) => {
      const status = row.getValue('status') as UserStatus;
      if (status === 'approved') return <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-0">อนุญาต</Badge>;
      if (status === 'pending') return <Badge className="bg-amber-50 text-amber-600 hover:bg-amber-100 border-0">รออนุมัติ</Badge>;
      return <Badge className="bg-red-50 text-red-600 hover:bg-red-100 border-0">ระงับสิทธิ์</Badge>;
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
  
  const [isFacilityDialogOpen, setIsFacilityDialogOpen] = useState(false);
  const [selectedHoscode, setSelectedHoscode] = useState<string>(user.hoscode || '');

  const handleConfirm = () => {
    if (alertType === 'approve') meta?.handleUpdateStatus?.(user.google_id, 'approved');
    if (alertType === 'reject') meta?.handleUpdateStatus?.(user.google_id, 'rejected');
    if (alertType === 'promote') meta?.handleUpdateStatus?.(user.google_id, user.status, 'admin');
    setIsAlertOpen(false);
  };

  const handleUpdateFacility = () => {
    if (selectedHoscode && selectedHoscode !== user.hoscode) {
      meta?.handleUpdateFacility?.(user.google_id, selectedHoscode);
    }
    setIsFacilityDialogOpen(false);
  };

  const getAlertContent = () => {
    switch (alertType) {
      case 'approve': return { title: 'ยืนยันการอนุมัติสิทธิ์', desc: `คุณต้องการอนุมัติสิทธิ์การเข้าใช้งานให้ ${user.email} ใช่หรือไม่?`, confirm: 'อนุมัติ' };
      case 'reject': return { title: 'ระงับสิทธิ์ผู้ใช้งาน', desc: `คุณแน่ใจหรือไม่ที่จะระงับสิทธิ์ของ ${user.email}? บัญชีนี้จะไม่สามารถเข้าถึงข้อมูลในระบบได้อีก`, confirm: 'ระงับสิทธิ์', destructive: true };
      case 'promote': return { title: 'ปรับสิทธิ์เป็น Admin', desc: `คุณต้องการปรับสิทธิ์ให้ ${user.email} เป็น Admin ใช่หรือไม่? พวกเขาจะสามารถจัดการผู้ใช้และสถานบริการได้ทั้งหมด`, confirm: 'ยืนยันปรับสิทธิ์' };
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
          <DropdownMenuLabel>การจัดการ</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {user.status !== 'approved' && (
            <DropdownMenuItem onClick={() => { setAlertType('approve'); setIsAlertOpen(true); }} className="text-emerald-600 focus:text-emerald-700 cursor-pointer">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              อนุมัติสิทธิ์เข้าใช้งาน
            </DropdownMenuItem>
          )}
          
          {user.status !== 'rejected' && (
            <DropdownMenuItem onClick={() => { setAlertType('reject'); setIsAlertOpen(true); }} className="text-red-600 focus:text-red-700 cursor-pointer">
              <XCircle className="mr-2 h-4 w-4" />
              ระงับสิทธิ์ / ปฏิเสธ
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={() => setIsFacilityDialogOpen(true)} className="cursor-pointer">
            <Building2 className="mr-2 h-4 w-4" />
            ย้ายสังกัด / เปลี่ยน รพ.สต.
          </DropdownMenuItem>

          {user.role === 'user' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setAlertType('promote'); setIsAlertOpen(true); }} className="cursor-pointer">
                <ShieldAlert className="mr-2 h-4 w-4" />
                ตั้งเป็น Admin
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
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className={alertContent.destructive ? 'bg-red-600 hover:bg-red-700' : ''}>
              {alertContent.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isFacilityDialogOpen} onOpenChange={setIsFacilityDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>ย้ายสังกัดสถานบริการ</DialogTitle>
            <DialogDescription>
              เลือกสถานบริการใหม่สำหรับผู้ใช้งาน <strong>{user.email}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="facility" className="text-sm font-medium leading-none">
                สถานบริการ
              </label>
              <Select value={selectedHoscode} onValueChange={setSelectedHoscode}>
                <SelectTrigger id="facility" className="w-full">
                  <SelectValue placeholder="เลือกสถานบริการ" />
                </SelectTrigger>
                <SelectContent>
                  {meta?.facilities?.filter((f: any) => f.is_active).map((fac: any) => (
                    <SelectItem key={fac.hoscode} value={fac.hoscode}>
                      [{fac.hoscode}] {fac.hosname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFacilityDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleUpdateFacility} disabled={!selectedHoscode || selectedHoscode === user.hoscode}>
              บันทึกการเปลี่ยนแปลง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
