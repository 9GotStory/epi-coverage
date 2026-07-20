import { useEffect, useState } from 'react';
import { fetchApi } from '../../../shared/lib/api';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { DataTable } from './data-table';
import { columns } from './columns';
import { FacilitiesTab } from './FacilitiesTab';
import { AuditLogsTab } from './AuditLogsTab';
import { VaccineRuleManager } from './VaccineRuleManager';
import type { User, UserRole, UserStatus } from '../../../shared/types';
import { Users, Building2, ScrollText, ShieldAlert, AlertCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/components/ui/tabs';
import { Button } from '../../../shared/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { SubNav } from '../../../widgets/layout/SubNav';
import { toast } from 'sonner';

export function AdminDashboard() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [facilities, setFacilities] = useState<{hoscode: string, hosname: string, is_active: boolean}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [isRuleManagerDirty, setIsRuleManagerDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  
  const queryClient = useQueryClient();

  const handleUpdateStatus = async (googleId: string, newStatus: UserStatus, newRole?: UserRole) => {
    setIsUpdating(googleId);
    try {
      const payload: any = { googleId, status: newStatus };
      if (newRole) payload.role = newRole;
      
      const res = await fetchApi('updateUserStatus', payload);
      if (res.data?.success) {
        toast.success(`อัปเดตสิทธิ์ผู้ใช้งานเรียบร้อยแล้ว`);
        loadUsers();
      } else {
        toast.error(res.data?.error || 'ไม่สามารถอัปเดตผู้ใช้งานได้');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการอัปเดต');
    } finally {
      setIsUpdating(null);
    }
  };

  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [usersRes, facRes] = await Promise.all([
        fetchApi('getAllUsers', {}),
        fetchApi('getFacilities', {})
      ]);
      
      if (usersRes.data) {
        setUsers(usersRes.data);
      }
      if (facRes.data) {
        setFacilities(facRes.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleUpdateFacility = async (googleId: string, newHoscode: string) => {
    setIsUpdating(googleId);
    try {
      const res = await fetchApi('updateUserFacility', { googleId, hoscode: newHoscode });
      if (res.data?.success) {
        toast.success(`ย้ายสังกัดผู้ใช้งานเรียบร้อยแล้ว`);
        loadUsers();
      } else {
        toast.error(res.data?.error || 'ไม่สามารถย้ายสังกัดผู้ใช้งานได้');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการย้ายสังกัด');
    } finally {
      setIsUpdating(null);
    }
  };

  return (
    <>
      <SubNav title="ระบบตั้งค่าและควบคุม (Admin Control Panel)" />
      
      <main className="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-8">
        
        <Tabs 
          value={activeTab} 
          onValueChange={(val) => {
            if (isRuleManagerDirty) {
              setPendingTab(val);
              return;
            }
            setActiveTab(val);
          }} 
          className="space-y-6"
        >
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="users" className="data-[state=active]:bg-slate-100 font-medium">
              <Users className="w-4 h-4 mr-2" />
              จัดการผู้ใช้งาน
            </TabsTrigger>
            <TabsTrigger value="facilities" className="data-[state=active]:bg-slate-100 font-medium">
              <Building2 className="w-4 h-4 mr-2" />
              สถานบริการ
            </TabsTrigger>
            <TabsTrigger value="audit-logs" className="data-[state=active]:bg-slate-100 font-medium">
              <ScrollText className="w-4 h-4 mr-2" />
              ประวัติการใช้งาน
            </TabsTrigger>
            <TabsTrigger value="vaccine-rules" className="data-[state=active]:bg-slate-100 font-medium">
              <ShieldAlert className="w-4 h-4 mr-2" />
              จัดการเกณฑ์วัคซีน
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-slate-400" />
                  รายชื่อผู้ใช้งานในระบบ
                </h2>
                <p className="text-sm text-slate-500 mt-1">อนุมัติและจัดการสิทธิ์การเข้าถึงข้อมูลของเจ้าหน้าที่แต่ละ รพ.สต.</p>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl mb-6 text-sm font-medium">
                {error}
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <DataTable 
                columns={columns}
                data={users} 
                isLoading={isLoading} 
                searchKey="name"
                searchPlaceholder="ค้นหาชื่อผู้ใช้งาน..."
                meta={{
                  currentUserId: currentUser?.google_id || '',
                  isUpdating,
                  handleUpdateStatus,
                  handleUpdateFacility,
                  facilities,
                }}
              />
            </div>
          </TabsContent>
          
          <TabsContent value="facilities" className="mt-6">
            <FacilitiesTab />
          </TabsContent>

          <TabsContent value="audit-logs" className="mt-6">
            <AuditLogsTab />
          </TabsContent>

          <TabsContent value="vaccine-rules" className="mt-6">
            <VaccineRuleManager onDirtyChange={setIsRuleManagerDirty} />
          </TabsContent>
        </Tabs>
        
        {/* Custom Confirmation Modal for Tab Switching */}
        {pendingTab && (
          <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl border border-red-100 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 mb-4 text-red-600">
                <AlertCircle className="w-7 h-7" />
                <h3 className="text-xl font-bold">ยังไม่ได้บันทึกข้อมูล!</h3>
              </div>
              <p className="text-slate-600 mb-6 text-base">
                คุณมีการเปลี่ยนแปลงฉบับร่างในแถบ <strong>จัดการเกณฑ์วัคซีน</strong> ที่ยังไม่ได้บันทึก<br/>
                หากเปลี่ยนแท็บตอนนี้ข้อมูลที่แก้ไว้จะหายไปทั้งหมด ต้องการดำเนินการต่อหรือไม่?
              </p>
              <div className="flex justify-end gap-3 mt-2">
                <Button variant="outline" size="lg" onClick={() => setPendingTab(null)} className="font-medium">
                  ยกเลิก (อยู่หน้านี้ต่อ)
                </Button>
                <Button size="lg" className="bg-red-600 hover:bg-red-700 text-white font-medium" onClick={() => {
                  queryClient.resetQueries({ queryKey: ['vaccineRules'] }); // Clear the optimistic cache
                  setIsRuleManagerDirty(false); // Reset the dirty flag
                  setActiveTab(pendingTab);     // Switch to the pending tab
                  setPendingTab(null);          // Close the modal
                }}>
                  ยืนยันที่จะทิ้งการเปลี่ยนแปลง
                </Button>
              </div>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
