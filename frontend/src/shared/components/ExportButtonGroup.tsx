import { FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';

interface ExportButtonGroupProps {
  onExportExcel: () => void;
  onExportPdf: () => void;
}

export function ExportButtonGroup({ onExportExcel, onExportPdf }: ExportButtonGroupProps) {
  return (
    <div className='flex bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden shrink-0'>
      <button 
        onClick={onExportExcel}
        className='flex items-center gap-1.5 px-3 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors border-r border-zinc-200 focus:outline-none'
        title='Export to Excel'
      >
        <FileSpreadsheetIcon className='w-4 h-4' />
        <span className='hidden md:inline font-medium'>Excel</span>
      </button>
      <button 
        onClick={onExportPdf}
        className='flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors focus:outline-none'
        title='Export to PDF'
      >
        <FileTextIcon className='w-4 h-4' />
        <span className='hidden md:inline font-medium'>PDF</span>
      </button>
    </div>
  );
}
