import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../shared/contexts/AuthContext';

export function PendingScreen() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  if (user && user.status === 'approved') return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-center">
        <div className="mb-6">
          <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">
            ?
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-2">รอการอนุมัติ</h1>
          <p className="text-slate-500 text-[15px] leading-relaxed">
            บัญชีของคุณกำลังรอการอนุมัติ ต้องรออนุมัติจากผู้ดูแลระบบ (เจ้าหน้าที่ สสอ.สอง) ก่อนจึงจะสามารถเข้าใช้งานได้
          </p>
        </div>

        <button
          onClick={() => navigate('/login', { replace: true })}
          className="w-full bg-slate-100 text-slate-700 py-3 rounded-full font-medium hover:bg-slate-200 transition-colors"
        >
          Return to Login
        </button>
      </div>
    </div>
  );
}
