import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SARABUN_REGULAR_B64 } from './SarabunFont';

/**
 * Export data to Excel (.xlsx) file
 * @param data Array of flat objects representing rows
 * @param filename Name of the file without extension (e.g. 'report')
 * @param sheetName Name of the sheet inside excel
 */
export function exportToExcel(data: any[], filename: string, sheetName: string = 'Sheet1') {
  if (data.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }

  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Convert JSON to worksheet
  const ws = XLSX.utils.json_to_sheet(data);
  
  // Auto-fit column widths based on header names
  const headers = Object.keys(data[0]);
  const colWidths = headers.map(header => {
    if (header === 'สถานบริการ') return { wch: 25 }; // Increased width
    if (header === 'CID') return { wch: 18 };
    if (header === 'ชื่อ' || header === 'นามสกุล' || header.includes('ชื่อ-สกุล')) return { wch: 25 };
    if (header === 'วันเกิด') return { wch: 25 }; // Adjusted width for birthdate + age
    if (header.includes('ผลการประเมิน')) return { wch: 50 };
    return { wch: 20 };
  });
  ws['!cols'] = colWidths;
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // Save the file
  XLSX.writeFileXLSX(wb, `${filename}.xlsx`);
}

/**
 * Export data to PDF using jsPDF and jspdf-autotable with Thai font support
 * @param data Array of flat objects representing rows
 * @param filename Name of the file without extension
 * @param title Title of the document to appear at the top
 */
export function exportToPdf(data: any[], filename: string, title: string) {
  if (data.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }

  // Initialize jsPDF in landscape mode if there are many columns, portrait otherwise
  const doc = new jsPDF('landscape');

  // Inject TH Sarabun Font
  doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_B64);
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
  doc.setFont('Sarabun');

  // Title
  doc.setFontSize(16);
  doc.text(title, 14, 15);
  doc.setFontSize(10);
  doc.text(`วันที่ดึงข้อมูล: ${new Date().toLocaleString('th-TH')}`, 14, 22);

  // Extract headers from the first object
  const headers = Object.keys(data[0]);
  
  // Create dynamic column styles based on header name
  const columnStyles: { [key: number]: any } = {};
  headers.forEach((header, index) => {
    if (header === 'วันเกิด') {
      columnStyles[index] = { cellWidth: 35 }; // Wider width to fit the age string neatly
    } else if (header === 'สถานบริการ') {
      columnStyles[index] = { cellWidth: 40 }; // Increased width
    } else if (header === 'CID') {
      columnStyles[index] = { cellWidth: 35 };
    } else if (header.includes('ชื่อ-สกุล')) {
      columnStyles[index] = { cellWidth: 45 };
    } else if (header.includes('ผลการประเมิน')) {
      columnStyles[index] = { cellWidth: 'auto' }; // Let the evaluation result take up the rest of the space
    }
  });
  
  // Extract rows
  const rows = data.map(item => headers.map(header => item[header] || ''));

  // Generate Table
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 28,
    columnStyles: columnStyles,
    styles: {
      font: 'Sarabun',
      fontStyle: 'normal',
      fontSize: 10,
    },
    headStyles: {
      fillColor: [0, 102, 204], // Primary blue
      textColor: 255,
      fontStyle: 'normal', // Use normal to prevent fallback to Helvetica
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250], // light zinc
    }
  });

  // Save PDF
  doc.save(`${filename}.pdf`);
}
