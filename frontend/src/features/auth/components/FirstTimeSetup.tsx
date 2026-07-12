import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { fetchApi } from '../../../shared/lib/api';

import { useAuth } from '../../../shared/contexts/AuthContext';

export function FirstTimeSetup() {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const googleData = location.state?.googleData;

  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedHoscode, setSelectedHoscode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!googleData) {
      navigate('/login', { replace: true });
      return;
    }

    const loadFacilities = async () => {
      try {
        const res = await fetchApi('getFacilities');
        if (res.data && Array.isArray(res.data)) {
          setFacilities(res.data);
        } else {
          console.error("Invalid facilities format:", res.data);
          setError("Failed to load facilities list. Please contact admin.");
        }
      } catch (err: any) {
        console.error("Failed to load facilities", err);
        setError(err.message || "Failed to connect to server.");
      }
    };
    loadFacilities();
  }, [googleData, navigate]);

  // Redirect if already logged in and not in setup phase
  if (!authLoading && user) {
    if (user.status === 'pending') return <Navigate to="/pending" replace />;
    if (user.status === 'approved') return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHoscode) {
      setError('Please select your facility.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const userData = {
        id: crypto.randomUUID(),
        google_id: googleData.sub,
        email: googleData.email,
        name: googleData.name,
        hoscode: selectedHoscode,
        role: 'user',
        status: 'pending',
        created_at: new Date().toISOString(),
        last_login: ''
      };

      const res = await fetchApi('createUser', { userData });
      if (res.data && res.data.success) {
        navigate('/pending', { replace: true });
      } else {
        throw new Error(res.data?.error || 'Failed to create account');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-2">Complete Profile</h1>
          <p className="text-slate-500 text-[15px]">Select your facility to finish setting up your account.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Facility (รพ.สต.)</label>
            <select 
              value={selectedHoscode}
              onChange={(e) => setSelectedHoscode(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              disabled={isLoading}
            >
              <option value="">-- Select Facility --</option>
              {facilities.map((f: any) => (
                <option key={f.hoscode} value={f.hoscode}>
                  [{f.hoscode}] {f.hosname}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading || !selectedHoscode}
            className="w-full bg-primary text-white py-3 rounded-full font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              'Submit Request'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
