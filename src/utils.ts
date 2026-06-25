import { parseISO, subDays, format } from 'date-fns';
import { ProductionReport, ElaboracionReport } from './types';

/**
 * Returns the logical date for a report.
 * According to the user's rule:
 * 1. The input date changes at 22:00 (anything from 22:00 onwards is entered as the next day).
 * 2. This means a 'Noche' shift (starting at 22:00) is ALWAYS entered with the date of the next day.
 * 3. For analysis (Industrial Day), we want the date the shift started.
 * So, if it's 'Noche', we subtract 1 day from the entered date.
 */
export function getLogicalDate(report: ProductionReport | ElaboracionReport): string {
  if (!report.fecha) return '';
  
  if (report.turno === 'Noche') {
    try {
      const date = parseISO(report.fecha);
      if (isNaN(date.getTime())) return report.fecha;
      return format(subDays(date, 1), 'yyyy-MM-dd');
    } catch(e) {
      return report.fecha;
    }
  }                

  return report.fecha;
}

/**
 * Returns the default date for the input form based on the 22:00 rule.
 */
export function getDefaultInputDate(): string {
  const now = new Date();
  const hours = now.getHours();
  
  // Si son las 22:00 o más, la fecha por defecto es mañana
  if (hours >= 22) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  return now.toISOString().split('T')[0];
}

export function getShiftHours(turno: string, fecha: string): string[] {
  if (!fecha || !turno) return [];
  
  // Extract date component
  const dateStr = fecha.split('T')[0];
  
  let year, month, day;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/').map(Number);
    if (parts[2] > 1000) { // DD/MM/YYYY
      [day, month, year] = parts;
    } else { // YYYY/MM/DD
      [year, month, day] = parts;
    }
  } else {
    // defaults to YYYY-MM-DD
    const parts = dateStr.split('-').map(Number);
    if (parts[0] > 1000) {
      [year, month, day] = parts;
    } else {
      [day, month, year] = parts; // edge case: DD-MM-YYYY
    }
  }
  
  const date = new Date(year, month - 1, day);
  const isSaturday = date.getDay() === 6;
  
  let horas: string[] = [];
  if (isSaturday) {
    if (turno === 'Mañana') horas = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'];
    else if (turno === 'Tarde') horas = ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    else horas = ['23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00'];
  } else {
    if (turno === 'Mañana') horas = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
    else if (turno === 'Tarde') horas = ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    else horas = ['23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00'];
  }
  return horas;
}

export function getHistoricalMonths(startDateStr: string = '2023-01-01'): string[] {
  const months: string[] = [];
  const start = new Date(startDateStr);
  const end = new Date();
  
  for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
    const startMonth = year === start.getFullYear() ? start.getMonth() + 1 : 1;
    const endMonth = year === end.getFullYear() ? end.getMonth() + 1 : 12;
    
    for (let month = startMonth; month <= endMonth; month++) {
      months.push(`${year}-${month.toString().padStart(2, '0')}`);
    }
  }
  return months.sort().reverse();
}
