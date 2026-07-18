import { useState, useEffect } from 'react';
import { fetchApi } from '../../../shared/lib/api';
import { DataTable } from './data-table';
import { auditColumns } from './columns-audit';
import { ScrollText } from 'lucide-react';
import type { AuditLog } from '../../../shared/types';

export function AuditLogsTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchApi('getAuditLogs', {});
      if (res.data) {
        setLogs(res.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-slate-400" />
            ประวัติการทำงานของระบบ (Audit Logs)
          </h2>
          <p className="text-sm text-slate-500 mt-1">ตรวจสอบประวัติการแก้ไขข้อมูลและการกระทำของแอดมิน</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <DataTable 
          columns={auditColumns}
          data={logs} 
          isLoading={isLoading} 
          searchKey="email"
          searchPlaceholder="ค้นหาประวัติจากอีเมล..."
          meta={{}}
        />
      </div>
    </div>
  );
}
