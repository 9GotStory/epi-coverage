import { useEffect, useState } from 'react';
import { fetchApi } from '../../../shared/lib/api';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { DataTable } from './data-table';
import { columns } from './columns';
import { FacilitiesTab } from './FacilitiesTab';
import { AuditLogsTab } from './AuditLogsTab';
import type { User, UserRole, UserStatus } from '../../../shared/types';
import { Users, Building2, ScrollText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/components/ui/tabs';
import { SubNav } from '../../../widgets/layout/SubNav';
import { toast } from 'sonner';

export function AdminDashboard() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [facilities, setFacilities] = useState<{hoscode: string, hosname: string, is_active: boolean}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

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
        
        <Tabs defaultValue="users" className="space-y-6">
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
          
          <TabsContent value="facilities">
            <FacilitiesTab />
          </TabsContent>
          
          <TabsContent value="audit-logs">
            <AuditLogsTab />
          </TabsContent>
        </Tabs>
        
      </main>
    </>
  );
}
