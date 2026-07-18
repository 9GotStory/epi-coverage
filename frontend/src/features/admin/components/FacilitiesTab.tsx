import { useState, useEffect } from 'react';
import { fetchApi } from '../../../shared/lib/api';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { DataTable } from './data-table';
import { facilityColumns } from './columns-facilities';
import { Button } from '../../../shared/components/ui/button';
import { Input } from '../../../shared/components/ui/input';
import { Label } from '../../../shared/components/ui/label';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../shared/components/ui/dialog';
import { Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Facility {
  hoscode: string;
  hosname: string;
  is_active: boolean;
}

export function FacilitiesTab() {
  const { user } = useAuth();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Dialog State
  const [isOpen, setIsOpen] = useState(false);
  const [newHoscode, setNewHoscode] = useState('');
  const [newHosname, setNewHosname] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadFacilities = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchApi('getFacilities', {});
      if (res.data) {
        setFacilities(res.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load facilities');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFacilities();
  }, []);

  const handleToggleActive = async (hoscode: string, currentActive: boolean) => {
    try {
      const res = await fetchApi('upsertFacility', {
        hoscode,
        isActive: !currentActive,
        adminEmail: user?.email
      });
      if (res.data?.success) {
        toast.success(`อัปเดตสถานะสถานบริการ ${hoscode} สำเร็จ`);
        loadFacilities();
      } else {
        toast.error(res.data?.error || 'ไม่สามารถอัปเดตสถานบริการได้');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานบริการ');
    }
  };

  const handleAddFacility = async () => {
    if (!newHoscode.trim() || !newHosname.trim()) {
      toast.warning('โปรดกรอกข้อมูลให้ครบทั้ง 2 ช่อง');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const res = await fetchApi('upsertFacility', {
        hoscode: newHoscode,
        hosname: newHosname,
        isActive: true,
        adminEmail: user?.email
      });
      if (res.data?.success) {
        toast.success(`เพิ่มสถานบริการใหม่เรียบร้อยแล้ว`);
        setIsOpen(false);
        setNewHoscode('');
        setNewHosname('');
        loadFacilities();
      } else {
        toast.error(res.data?.error || 'ไม่สามารถเพิ่มสถานบริการได้');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการเพิ่มสถานบริการ');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-400" />
            รายชื่อสถานบริการในเครือข่าย
          </h2>
          <p className="text-sm text-slate-500 mt-1">จัดการรายชื่อ รพ.สต. และเปิด/ปิดสถานะการทำงานเพื่อคำนวณเป้าหมาย</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-white">
              <Plus className="w-4 h-4 mr-2" />
              เพิ่มสถานบริการ
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>เพิ่มสถานบริการใหม่</DialogTitle>
              <DialogDescription>
                เพิ่มรายชื่อสถานบริการใหม่เข้าระบบ (รหัสสถานบริการต้องเป็นตัวเลข 5 หลัก)
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="hoscode">รหัสสถานบริการ (Hoscode 5 หลัก)</Label>
                <Input
                  id="hoscode"
                  placeholder="เช่น 06422"
                  value={newHoscode}
                  onChange={(e) => setNewHoscode(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hosname">ชื่อสถานบริการ</Label>
                <Input
                  id="hosname"
                  placeholder="เช่น รพ.สต.ทดสอบ"
                  value={newHosname}
                  onChange={(e) => setNewHosname(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button disabled={isSubmitting} onClick={handleAddFacility}>
                {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกสถานบริการ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <DataTable 
          columns={facilityColumns as any}
          data={facilities} 
          isLoading={isLoading} 
          searchKey="hosname"
          searchPlaceholder="ค้นหาชื่อสถานบริการ..."
          meta={{
            handleToggleActive
          }}
        />
      </div>
    </div>
  );
}
