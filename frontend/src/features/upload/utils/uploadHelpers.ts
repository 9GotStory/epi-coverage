// Date parser helper
export const parseDate = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}$/)) return val;
  
  // Attempt to parse Excel date serial number or JS Date
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch {
    // Ignore parse error
  }
  
  // If it's a serial number from Excel
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  return String(val); // Fallback
};

export const cleanData = (data: any[]): any[] => {
  return data.map(row => {
    const cleanRow: any = {};
    Object.keys(row).forEach(key => {
      let val = row[key];
      if (val === '<NA>' || val === 'NA' || val === '' || val === undefined) {
        val = null;
      }
      
      // Force string and pad for specific columns
      if (val !== null && ['hoscode', 'pid', 'cid', 'check_vhid'].includes(key.toLowerCase())) {
        val = String(val).trim();
        
        // Preserve leading zeros in case Excel parsed them as pure numbers
        if (key.toLowerCase() === 'hoscode' || key.toLowerCase() === 'hosp') {
          val = val.padStart(5, '0');
        } else if (key.toLowerCase() === 'cid') {
          val = val.padStart(13, '0');
        }
      }
      
      // Parse dates
      if (val !== null && (key.toLowerCase().includes('date') || key.toLowerCase() === 'birth')) {
        val = parseDate(val);
      }
      
      cleanRow[key.toLowerCase()] = val;
    });
    return cleanRow;
  });
};

export const getAgeString = (birthDateString: string): string => {
  if (!birthDateString) return '';
  const birth = new Date(birthDateString);
  if (isNaN(birth.getTime())) return '';
  const now = new Date();
  
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) {
    months--;
  }
  
  if (months < 0) return '0 เดือน';
  
  const y = Math.floor(months / 12);
  const m = months % 12;
  
  if (y > 0 && m > 0) return `${y} ปี ${m} เดือน`;
  if (y > 0) return `${y} ปี`;
  return `${m} เดือน`;
};
