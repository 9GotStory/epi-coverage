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

export function AdminDashboard() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
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
        loadUsers();
      } else {
        alert(res.data?.error || 'Failed to update user');
      }
    } catch (err: any) {
      alert(err.message || 'Error updating user');
    } finally {
      setIsUpdating(null);
    }
  };

  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchApi('getAllUsers', {});
      if (res.data) {
        setUsers(res.data);
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

  return (
    <>
      <SubNav title="Admin Control Panel" />
      
      <main className="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-8">
        
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="users" className="data-[state=active]:bg-slate-100">
              <Users className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="facilities" className="data-[state=active]:bg-slate-100">
              <Building2 className="w-4 h-4 mr-2" />
              Facilities
            </TabsTrigger>
            <TabsTrigger value="audit-logs" className="data-[state=active]:bg-slate-100">
              <ScrollText className="w-4 h-4 mr-2" />
              Audit Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-slate-400" />
                  Registered Users
                </h2>
                <p className="text-sm text-slate-500 mt-1">Review and approve accounts before they can access the dashboard.</p>
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
                searchPlaceholder="Search users by name..."
                meta={{
                  currentUserId: currentUser?.google_id || '',
                  isUpdating,
                  handleUpdateStatus,
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
