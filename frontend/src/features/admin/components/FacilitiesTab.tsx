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
        loadFacilities();
      } else {
        alert(res.data?.error || 'Failed to update facility');
      }
    } catch (err: any) {
      alert(err.message || 'Error updating facility');
    }
  };

  const handleAddFacility = async () => {
    if (!newHoscode.trim() || !newHosname.trim()) {
      alert('Please fill in both fields.');
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
        setIsOpen(false);
        setNewHoscode('');
        setNewHosname('');
        loadFacilities();
      } else {
        alert(res.data?.error || 'Failed to add facility');
      }
    } catch (err: any) {
      alert(err.message || 'Error adding facility');
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
            Facilities Management
          </h2>
          <p className="text-sm text-slate-500 mt-1">Manage health facilities and their active status.</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Facility
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Facility</DialogTitle>
              <DialogDescription>
                Add a new health center to the system. Hoscode must be exactly 5 digits.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="hoscode">Facility Code (Hoscode)</Label>
                <Input
                  id="hoscode"
                  placeholder="e.g. 06422"
                  value={newHoscode}
                  onChange={(e) => setNewHoscode(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hosname">Facility Name</Label>
                <Input
                  id="hosname"
                  placeholder="e.g. รพ.สต.บ้านร้องกวาง"
                  value={newHosname}
                  onChange={(e) => setNewHosname(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button disabled={isSubmitting} onClick={handleAddFacility}>
                {isSubmitting ? 'Saving...' : 'Save Facility'}
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
          searchPlaceholder="Search facilities by name..."
          meta={{
            handleToggleActive
          }}
        />
      </div>
    </div>
  );
}
