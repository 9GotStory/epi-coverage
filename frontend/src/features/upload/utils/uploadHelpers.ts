// Date parser helper
export const parseDate = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}$/)) return val;
  
  // If it's a serial number from Excel
  if (typeof val === 'number') {
    // Excel dates are days since Dec 30, 1899
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    // When using UTC offsets, we should just extract UTC date because the math above produces UTC time
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // Attempt to parse JS Date (from SheetJS cellDates)
  try {
    if (val instanceof Date || typeof val === 'string') {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }
  } catch {
    // Ignore parse error
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

export const getAgeGroupFromTable = (table: string): string => {
  switch (table) {
    case 'Epi_1_Year': return '1yr';
    case 'Epi_2_Year': return '2yr';
    case 'Epi_3_Year': return '3yr';
    case 'Epi_5_Year': return '5yr';
    default: return '1yr';
  }
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
