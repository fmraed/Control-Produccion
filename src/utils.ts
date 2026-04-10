import { parseISO, subDays, format } from 'date-fns';
import { ProductionReport, ElaboracionReport } from './types';

/**
 * Returns the logical date for a report.
 * If a shift starts at or after 22:00, the report's date is the next day.
 * This function returns the actual start date (the day before).
 */
export function getLogicalDate(report: ProductionReport | ElaboracionReport): string {
  if (!report.fecha) return '';
  
  const startTime = 'entraTurno' in report 
    ? (report as ProductionReport).entraTurno 
    : (report as ElaboracionReport).horaInicio;
  
  if (!startTime) return report.fecha;
  
  // Si el turno empieza entre las 00:00 y las 05:59, pertenece al día operativo anterior
  if (startTime < '06:00') {
    const date = parseISO(report.fecha);
    const prevDay = subDays(date, 1);
    return format(prevDay, 'yyyy-MM-dd');
  }
  
  return report.fecha;
}

export function getShiftHours(turno: string, fecha: string): string[] {
  if (!fecha || !turno) return [];
  
  const [year, month, day] = fecha.split('-').map(Number);
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
