import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, getDoc, addDoc, deleteDoc, where, getDocs, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionReport, MonthlySnapshot, AttendanceRecord, ScheduleAuditLog, ProductionPlan } from '../types';
import { BarChart3, Calendar, Users, Package, Droplets, Info, Edit2, Save, X, UserCircle2, Milk as BottleIcon, Clock, Lock, Unlock, RefreshCw, AlertTriangle, ListChecks, History as HistoryIcon, Trash2 } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addDays, subDays, differenceInHours, differenceInMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate, getHistoricalMonths } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';

export function ManagementSummary() {
  const { config, availableBrands, availableSizes, availableLines, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<ScheduleAuditLog[]>([]);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [selectedGestion, setSelectedGestion] = useState<'all' | 'current' | 'previous'>('all');
  const [snapshot, setSnapshot] = useState<MonthlySnapshot | null>(null);

  // Acceder a la config de gestión
  const managementStartDate = config?.managementSettings?.managementStartDate || null;

  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);

  const isAdmin = auth.currentUser?.email === 'fraed.fordrinks@gmail.com';

  const handleToggleCanje = async (dateStr: string, shiftStr: string) => {
    try {
      const matchingReports = reports.filter(r => getLogicalDate(r) === dateStr && r.turno === shiftStr);
      const isCurrentlyCanje = matchingReports.length > 0 
        ? matchingReports.every(r => r.esCanjeHoras || r.esRecuperacionHoras)
        : false;
      const newStatus = !isCurrentlyCanje;

      for (const r of matchingReports) {
        if (r.id) {
          await updateDoc(doc(db, 'production_reports', r.id), {
            esCanjeHoras: newStatus,
            esRecuperacionHoras: newStatus
          });
        }
      }

      const configRef = doc(db, 'config', 'production');
      const configSnap = await getDoc(configRef);
      if (configSnap.exists()) {
        const configData = configSnap.data();
        const currentShiftCfg = configData.shiftConfig || {};
        const currentExchanges: { date: string; shift: string; note?: string }[] = currentShiftCfg.exchangeShifts || [];
        
        let updatedExchanges = [...currentExchanges];
        if (newStatus) {
          if (!updatedExchanges.some(ex => ex.date === dateStr && (ex.shift === shiftStr || ex.shift === 'Todos'))) {
            updatedExchanges.push({ date: dateStr, shift: shiftStr, note: 'Marcado desde Tablero Gerencial' });
          }
        } else {
          updatedExchanges = updatedExchanges.filter(ex => !(ex.date === dateStr && (ex.shift === shiftStr || ex.shift === 'Todos')));
        }

        await setDoc(configRef, {
          shiftConfig: {
            ...currentShiftCfg,
            exchangeShifts: updatedExchanges
          }
        }, { merge: true });
      }
    } catch (err) {
      console.error("Error toggling canje de horas:", err);
    }
  };

  useEffect(() => {
    const fetchSnapshot = async () => {
      setIsSnapshotLoading(true);
      try {
        const [year, month] = selectedMonth.split('-');
        const q = query(
          collection(db, 'monthly_snapshots'), 
          where('year', '==', parseInt(year)),
          where('month', '==', month)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setSnapshot({ id: snap.docs[0].id, ...snap.docs[0].data() } as MonthlySnapshot);
        } else {
          setSnapshot(null);
        }
      } catch (error) {
        console.error("Error fetching snapshot:", error);
      } finally {
        setIsSnapshotLoading(false);
      }
    };

    fetchSnapshot();
  }, [selectedMonth]);

  useEffect(() => {
    setLoading(true);
    const [year, month] = selectedMonth.split('-');
    
    // We want reports from the selected month. However, because of the "22:00 rule", 
    // a report for logical month X might have a raw 'fecha' in the first day of month X+1. 
    // And a report in logical month X could have a raw 'fecha' in the last day of month X-1.
    // To be safe, we query from the last day of prev month to the first day of next month.
    
    const startDate = new Date(parseInt(year), parseInt(month) - 2, 28);
    const startStr = format(startDate, 'yyyy-MM-dd');
    
    const endDate = new Date(parseInt(year), parseInt(month), 5);
    const endStr = format(endDate, 'yyyy-MM-dd');

    const qReports = query(
      collection(db, 'production_reports'), 
      where('fecha', '>=', startStr),
      where('fecha', '<=', endStr),
      orderBy('fecha', 'desc')
    );
    
    // Also filter attendance to avoid massive reads
    const qAttendance = query(
      collection(db, 'attendance_records'), 
      where('date', '>=', startStr),
      where('date', '<=', endStr),
      orderBy('date', 'desc')
    );
    
    let reportsLoaded = false;
    let attendanceLoaded = false;

    const checkLoading = () => {
      if (reportsLoaded && attendanceLoaded) {
        setLoading(false);
      }
    };

    const unsubscribeReports = onSnapshot(qReports, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      setReports(reportsData);
      reportsLoaded = true;
      checkLoading();
    }, (err) => {
      console.error("Error fetching reports:", err);
      reportsLoaded = true;
      checkLoading();
    });

    const unsubscribeAttendance = onSnapshot(qAttendance, (snapshot) => {
      const attendanceData: AttendanceRecord[] = [];
      snapshot.forEach((doc) => {
        attendanceData.push({ id: doc.id, ...doc.data() } as AttendanceRecord);
      });
      setAttendance(attendanceData);
      attendanceLoaded = true;
      checkLoading();
    }, (err) => {
      console.error("Error fetching attendance:", err);
      attendanceLoaded = true;
      checkLoading();
    });

    const qAudit = query(collection(db, 'schedule_audit_logs'), orderBy('timestamp', 'desc'));
    const unsubscribeAudit = onSnapshot(qAudit, (snapshot) => {
      const auditData: ScheduleAuditLog[] = [];
      snapshot.forEach((doc) => {
        auditData.push({ id: doc.id, ...doc.data() } as ScheduleAuditLog);
      });
      setAuditLogs(auditData);
    });

    const qPlans = query(collection(db, 'production_plans'), where('status', '==', 'Published'));
    const unsubscribePlans = onSnapshot(qPlans, (snapshot) => {
      const plansData: ProductionPlan[] = [];
      snapshot.forEach((doc) => {
        plansData.push({ id: doc.id, ...doc.data() } as ProductionPlan);
      });
      setPlans(plansData);
    });

    return () => {
      unsubscribeReports();
      unsubscribeAttendance();
      unsubscribeAudit();
      unsubscribePlans();
    };
  }, [selectedMonth]);

  const months = useMemo(() => {
    return getHistoricalMonths();
  }, []);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      if (!shouldShowReport(r)) return false;

      // Management Cutoff Filter
      if (selectedGestion !== 'all' && managementStartDate) {
        if (selectedGestion === 'current' && r.fecha < managementStartDate) return false;
        if (selectedGestion === 'previous' && r.fecha >= managementStartDate) return false;
      }

      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [reports, selectedMonth, selectedGestion, managementStartDate, shouldShowReport]);

  const filteredAttendance = useMemo(() => {
    return attendance.filter(a => {
      // Attendance records follow the 22:00 rule: Noche shifts are logged on the calendar day they END.
      // To filter correctly by logical start month, we must determine the logical date first.
      const logicalDate = a.shift === 'Noche' ? format(subDays(parseISO(a.date), 1), 'yyyy-MM-dd') : a.date;
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [attendance, selectedMonth]);

  const stats = useMemo(() => {
    // If we have a snapshot, use its stats instead of recalculating
    if (snapshot) {
      return {
        turnosTotales: 0,
        turnosOperativosPlanificados: 0,
        turnosTrabajadosTotal: 0,
        turnosPorLinea: { '1': 0, '2': 0, '3': 0 },
        packsPorLinea: { '1': 0, '2': 0, '3': 0 },
        totalPacks: 0,
        extraHours: 0,
        holidayExtraHours: 0,
        weekendExtraHours: 0,
        weekdayExtraHours: 0,
        cajasUnitarias: 0,
        cajasUnitariasFromPacks: 0,
        relacionLitrosBotellas: 0,
        producedProductsCount: 0,
        producedProducts: [],
        cajasUnitariasFisicasRatio: 0,
        standardDailyShifts: 1,
        pendingPlannedShifts: 0,
        avgPacksPerShift: 0,
        projectedPendingPacks: 0,
        projectedTotalPacks: 0,
        transformations: snapshot.stats?.transformations || {
          consecutive: 0,
          nonConsecutive: 0,
          total: 0,
          flavorChanges: 0,
          flavorChangesByLine: {},
          consecutiveByLine: {},
          nonConsecutiveByLine: {}
        },
        ...snapshot.stats,
        breakdown: {
          daysInMonth: 0,
          holidays: [],
          holidayNightDuration: 360,
          standardDailyShifts: 0,
          extraShiftsDebug: [],
          weekendExtraHours: 0,
          weekdayExtraHours: 0,
          dailyPlan: {},
          minutesByDay: {},
          activeProductsList: [],
          ...(snapshot.stats.breakdown || {})
        },
        stability: {
          index: 100,
          totalScheduledItems: 0,
          modifications: 0,
          deletions: 0,
          criticalChanges: 0,
          criticalLogs: [],
          ...(snapshot.stats.stability || {})
        },
        fulfillment: {
          index: 100,
          fulfilledItems: 0,
          partialItems: 0,
          deviationItems: 0,
          missedItems: 0,
          isPartial: false,
          ...(snapshot.stats.fulfillment || {})
        },
        operatorsCrossOver: snapshot.stats.operatorsCrossOver || [],
        totalActiveProducts: snapshot.stats.totalActiveProducts || 1
      };
    }

    const startDate = startOfMonth(parseISO(`${selectedMonth}-01`));
    const endDate = endOfMonth(startDate);
    const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });

    const rawShiftConfig = config?.shiftConfig;
    let shiftConfig = {
      standardShiftDuration: rawShiftConfig?.standardShiftDuration || 480,
      shiftDurations: rawShiftConfig?.shiftDurations || { Mañana: 480, Tarde: 480, Noche: 480 },
      weeklyPlan: rawShiftConfig?.weeklyPlan || {
        monday: { Mañana: { count: 3, duration: 480 }, Tarde: { count: 3, duration: 480 }, Noche: { count: 3, duration: 480 } },
        tuesday: { Mañana: { count: 3, duration: 480 }, Tarde: { count: 3, duration: 480 }, Noche: { count: 3, duration: 480 } },
        wednesday: { Mañana: { count: 3, duration: 480 }, Tarde: { count: 3, duration: 480 }, Noche: { count: 3, duration: 480 } },
        thursday: { Mañana: { count: 3, duration: 480 }, Tarde: { count: 3, duration: 480 }, Noche: { count: 3, duration: 480 } },
        friday: { Mañana: { count: 3, duration: 480 }, Tarde: { count: 3, duration: 480 }, Noche: { count: 3, duration: 420 } },
        saturday: { Mañana: { count: 3, duration: 480 }, Tarde: { count: 0, duration: 480 }, Noche: { count: 0, duration: 480 } },
        sunday: { Mañana: { count: 0, duration: 480 }, Tarde: { count: 0, duration: 480 }, Noche: { count: 3, duration: 360 } }
      },
      holidays: rawShiftConfig?.holidays || [],
      holidayNightDuration: rawShiftConfig?.holidayNightDuration || 360
    };

    console.log("Current Shift Config being used:", shiftConfig);

    // Normalize weeklyPlan and previousWeeklyPlan
    const normalizePlan = (rawPlan: any) => {
      if (!rawPlan) return null;
      const normalizedPlan: any = {};
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const daysEs = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      
      days.forEach((day, idx) => {
        const dayEs = daysEs[idx];
        const rawDayPlan = (rawPlan as any)[day] || 
                           (rawPlan as any)[day.charAt(0).toUpperCase() + day.slice(1)] ||
                           (rawPlan as any)[dayEs] ||
                           (rawPlan as any)[dayEs.charAt(0).toUpperCase() + dayEs.slice(1)] ||
                           {};
        
        normalizedPlan[day] = {};
        ['Mañana', 'Tarde', 'Noche'].forEach(shift => {
          const shiftKeys = Object.keys(rawDayPlan);
          const targetKey = shiftKeys.find(k => 
            k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === 
            shift.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          );
          
          const val = targetKey ? rawDayPlan[targetKey] : null;

          if (Array.isArray(rawDayPlan) && rawDayPlan.some(s => s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === shift.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
            normalizedPlan[day][shift] = { count: 3, duration: 480 };
          } else if (val && typeof val === 'object') {
            normalizedPlan[day][shift] = {
              count: typeof val.count === 'number' ? val.count : 0,
              duration: typeof val.duration === 'number' ? val.duration : 480
            };
          } else {
            normalizedPlan[day][shift] = { count: 0, duration: 480 };
          }
        });
      });
      return normalizedPlan;
    };

    const normalizedWeeklyPlan = normalizePlan(shiftConfig.weeklyPlan) || shiftConfig.weeklyPlan;
    const normalizedPreviousWeeklyPlan = rawShiftConfig?.previousWeeklyPlan ? normalizePlan(rawShiftConfig.previousWeeklyPlan) : null;
    const shiftChangeDate = rawShiftConfig?.changeDate || '';

    const getDayPlanForDate = (dateStr: string, dayKey: string) => {
      if (normalizedPreviousWeeklyPlan && shiftChangeDate && dateStr < shiftChangeDate) {
        return normalizedPreviousWeeklyPlan[dayKey] || {};
      }
      return normalizedWeeklyPlan[dayKey] || {};
    };

    shiftConfig = { 
      ...shiftConfig, 
      weeklyPlan: normalizedWeeklyPlan
    };

    if (!shiftConfig.holidays) {
      shiftConfig = { ...shiftConfig, holidays: [] };
    }

    const enabledLinesCount = config?.lines.filter(l => config.enabledLines?.[l] !== false).length || 3;

    // 1. Turnos Totales (Capacidad Máxima): 3 lines * 3 shifts * days in month
    const turnosTotales = enabledLinesCount * 3 * daysInMonth.length;

    // 2. Turnos Operativos Planificados (según configuración)
    let turnosOperativosPlanificados = 0;
    const dailyPlan: Record<string, number> = {};
    
    // Calculate standard daily shifts (average of Mon-Thu)
    let standardDailyShifts = 0;
    const standardDays = ['monday', 'tuesday', 'wednesday', 'thursday'];
    let standardDaysSum = 0;
    standardDays.forEach(day => {
      const dayPlan = shiftConfig.weeklyPlan[day] || {};
      ['Mañana', 'Tarde', 'Noche'].forEach(shift => {
        standardDaysSum += (dayPlan[shift]?.count || 0);
      });
    });
    standardDailyShifts = standardDaysSum / standardDays.length;
    
    const plannedShiftsList: { date: string, shift: string, shiftOrder: number, count: number, totalDayShifts: number }[] = [];

    daysInMonth.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const nextDayStr = format(addDays(day, 1), 'yyyy-MM-dd');
      
      const isHoliday = shiftConfig.holidays?.includes(dateStr);
      const isNextDayHoliday = shiftConfig.holidays?.includes(nextDayStr);
      
      const dayKey = format(day, 'eeee').toLowerCase();
      const dayPlan = getDayPlanForDate(dateStr, dayKey);
      let plannedMinutes = 0;
      
      let countM = 0;
      let countT = 0;
      let countN = 0;

      // Mañana and Tarde are affected by the current day being a holiday
      if (!isHoliday) {
        const m = dayPlan['Mañana'];
        const t = dayPlan['Tarde'];
        countM = ((m?.count || 0) * (m?.duration || 480)) / 480;
        countT = ((t?.count || 0) * (t?.duration || 480)) / 480;
        plannedMinutes += countM * 480;
        plannedMinutes += countT * 480;
      }
      
      // Noche is affected by the NEXT day being a holiday (starts at 00:00 of the next day)
      // ALSO: If today is a holiday, the Noche shift (starting at 00:00 of tomorrow) IS worked
      if (!isNextDayHoliday) {
        const n = dayPlan['Noche'];
        let dur = n?.duration || 480;
        if (isHoliday) {
          // If TODAY is a holiday, the Noche shift starts at 00:00 of the NEXT day
          const nextDay = addDays(day, 1);
          const nextDayOfWeek = getDay(nextDay);
          const boundary = (nextDayOfWeek === 6) ? 5 : 6;
          dur = boundary * 60; // 300 for Sat, 360 for others
        }
        countN = ((n?.count || 0) * dur) / 480;
        plannedMinutes += countN * 480;
      }
      
      const plannedShifts = plannedMinutes / 480;
      turnosOperativosPlanificados += plannedShifts;
      dailyPlan[dateStr] = plannedShifts;

      const totalDayShifts = countM + countT + countN;
      plannedShiftsList.push({ date: dateStr, shift: 'Mañana', shiftOrder: 1, count: countM, totalDayShifts });
      plannedShiftsList.push({ date: dateStr, shift: 'Tarde', shiftOrder: 2, count: countT, totalDayShifts });
      plannedShiftsList.push({ date: dateStr, shift: 'Noche', shiftOrder: 3, count: countN, totalDayShifts });
    });

    const averagePlannedShiftsPerDay = turnosOperativosPlanificados / daysInMonth.length;

    // 3. Horas Extras y Turnos Trabajados (Expresado en HORAS)
    let holidayExtraHours = 0;
    let weekendExtraHours = 0;
    let weekdayExtraHours = 0;
    const minutesByDay: Record<string, number> = {};
    const reportsByDayAndShift: Record<string, Record<string, any[]>> = {};
    const extraShiftsDebug: { date: string, shift: string, duration: number, planned: number, extra: number, type: string }[] = [];
    
    let totalGrossMinutes = 0;
    const turnosPorLinea: Record<string, number> = {};
    config?.lines.forEach(l => turnosPorLinea[l] = 0);
    
    const packsPorLinea: Record<string, number> = {};
    config?.lines.forEach(l => packsPorLinea[l] = 0);

    const shiftCrossoverMap: Record<string, {
      date: string;
      shift: string;
      activeLines: Set<string>;
      presentOperators: number;
      reports: any[];
    }> = {};

    let totalLiters = 0;
    let totalLitersFromPacks = 0;
    let totalBottles = 0;
    let totalPacks = 0;
    const producedProducts = new Set<string>();

    let totalScrapSoplado = 0;
    let totalScrapEtiquetado = 0;
    let totalScrapLlenado = 0;
    let totalScrapHorno = 0;
    let totalDesperdicioEtiquetas = 0;
    let totalDesperdicioTapas = 0;
    let totalDesperdicioSifones = 0;
    let totalDesperdicioTermo = 0;
    let totalBotellasRotas = 0;

    filteredReports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      const lDate = parseISO(logicalDate);
      const lDayOfWeek = getDay(lDate);
      const dayKey = format(lDate, 'eeee').toLowerCase();
      
      // Accummulate scrap and waste
      totalScrapSoplado += r.scrapSoplado || 0;
      totalScrapEtiquetado += r.scrapEtiquetado || 0;
      totalScrapLlenado += r.scrapLlenado || 0;
      totalScrapHorno += r.scrapHorno || 0;
      totalDesperdicioEtiquetas += r.desperdicioEtiquetas || 0;
      totalDesperdicioTapas += r.desperdicioTapas || 0;
      totalDesperdicioSifones += r.desperdicioSifones || 0;
      totalDesperdicioTermo += r.desperdicioTermo || 0;
      totalBotellasRotas += r.botRotas || 0;
      
      // Check for weekend overtime based on logical date
      // Sunday is always extra. Saturday is extra after 13:00.
      const timeParts = r.entraTurno?.split(':') || ['0', '0'];
      const hour = parseInt(timeParts[0]);
      
      // For Saturday, we check the calendar hour. 
      // If logical date is Saturday, and it's after 13:00 calendar time, it's extra.
      const isWeekendExtra = (lDayOfWeek === 0) || (lDayOfWeek === 6 && hour >= 13);
      
      const crossoverKey = `${logicalDate}_${r.turno}`;
      if (!shiftCrossoverMap[crossoverKey]) {
        shiftCrossoverMap[crossoverKey] = {
          date: logicalDate,
          shift: r.turno,
          activeLines: new Set<string>(),
          presentOperators: 0,
          reports: []
        };
      }
      shiftCrossoverMap[crossoverKey].activeLines.add(r.linea);
      shiftCrossoverMap[crossoverKey].reports.push(r);
      
      // Use specific shift duration for this day/shift if available
      const dayPlan = getDayPlanForDate(logicalDate, dayKey);
      const shiftData = (dayPlan as any)[r.turno];
      let shiftDur = (shiftData && shiftData.duration) || shiftConfig.shiftDurations[r.turno as keyof typeof shiftConfig.shiftDurations] || shiftConfig.standardShiftDuration;
      
      // Special case: Holiday Night shift duration (starts at 00:00 of the next day)
      // If logical date is a holiday, the Noche shift starts at 00:00 and its duration
      // depends on the boundary of the calendar day it's being worked on.
      if (r.turno === 'Noche' && shiftConfig.holidays?.includes(logicalDate)) {
        const calendarDate = parseISO(r.fecha);
        const calendarDayOfWeek = getDay(calendarDate);
        const boundary = (calendarDayOfWeek === 6) ? 5 : 6;
        shiftDur = boundary * 60; // 300 for Sat (0.625), 360 for others (0.75)
      }

      // Gross minutes calculation
      const entraParts = r.entraTurno?.split(':') || ['0', '0'];
      const saleParts = r.saleTurno?.split(':') || ['0', '0'];
      const start = parseInt(entraParts[0]) * 60 + parseInt(entraParts[1]);
      let end = parseInt(saleParts[0]) * 60 + parseInt(saleParts[1]);
      if (end < start) end += 1440; // Next day
      const duration = end - start;

      // Store for UI display (all days)
      minutesByDay[logicalDate] = (minutesByDay[logicalDate] || 0) + duration;
      
      // Store for granular overtime calculation
      if (!reportsByDayAndShift[logicalDate]) reportsByDayAndShift[logicalDate] = {};
      if (!reportsByDayAndShift[logicalDate][r.turno]) reportsByDayAndShift[logicalDate][r.turno] = [];
      reportsByDayAndShift[logicalDate][r.turno].push({ ...r, duration });

      totalGrossMinutes += duration;
      
      if (turnosPorLinea[r.linea] !== undefined) {
        turnosPorLinea[r.linea] += duration / 480;
        packsPorLinea[r.linea] += r.paquetes || 0;
      }

      totalPacks += r.paquetes || 0;
      totalBottles += r.botellas || 0;
      
      const liters = (r.botellas || 0) * (r.tamano || 0) / 1000;
      totalLiters += liters;
      
      const botellasDePacks = (r.paquetes || 0) * (config?.botellasPorPack?.[r.tamano || 0] || 6);
      const litersDePacks = botellasDePacks * (r.tamano || 0) / 1000;
      totalLitersFromPacks += litersDePacks;

      if (r.marca && r.sabor && r.tamano) {
        producedProducts.add(`${r.marca}|${r.sabor}|${r.tamano}`);
      }
    });

    // Calculate overtime without compensation (per shift/line)
    Object.keys(reportsByDayAndShift).forEach(dayStr => {
      const date = parseISO(dayStr);
      const dayOfWeek = getDay(date);
      const dayKey = format(date, 'eeee').toLowerCase();
      const dayPlan = getDayPlanForDate(dayStr, dayKey);
      const isHoliday = shiftConfig.holidays?.includes(dayStr);
      const nextDayStr = format(addDays(date, 1), 'yyyy-MM-dd');
      const isNextDayHoliday = shiftConfig.holidays?.includes(nextDayStr);

      Object.keys(reportsByDayAndShift[dayStr]).forEach(shift => {
        const reports = reportsByDayAndShift[dayStr][shift];
        const p = (dayPlan as any)[shift];
        
        // Determine planned count and duration for this shift
        let plannedCount = p?.count || 0;
        let plannedDuration = p?.duration || 480;
        
        // Holiday adjustments
        if (isHoliday && (shift === 'Mañana' || shift === 'Tarde')) {
          plannedCount = 0;
        }
        if (isHoliday && shift === 'Noche') {
          const nextDay = addDays(date, 1);
          const boundary = (getDay(nextDay) === 6) ? 5 : 6;
          plannedDuration = boundary * 60;
        }
        if (shift === 'Noche' && isNextDayHoliday) {
          plannedCount = 0;
        }

        const exchangeShifts = (shiftConfig as any).exchangeShifts || [];
        const isShiftConfiguredAsExchange = exchangeShifts.some(
          (ex: any) => ex.date === dayStr && (ex.shift === 'Todos' || ex.shift === shift)
        );

        const nonCanjeReports = isShiftConfiguredAsExchange 
          ? [] 
          : reports.filter(r => !r.esCanjeHoras && !r.esRecuperacionHoras);
        const totalActualMinutes = nonCanjeReports.reduce((sum, r) => sum + r.duration, 0);
        const totalPlannedMinutes = plannedCount * plannedDuration;
        const extraMinutes = Math.max(0, totalActualMinutes - totalPlannedMinutes);

        if (extraMinutes > 0) {
          const firstReport = reports[0];
          const timeParts = firstReport.entraTurno?.split(':') || ['0', '0'];
          const hour = parseInt(timeParts[0]);
          
          // Weekend rule: Sunday or Saturday after 13:00
          const isWeekendExtra = (dayOfWeek === 0) || (dayOfWeek === 6 && (hour >= 13 || hour < 5));
          
          // Holiday rule: 
          // 1. Morning/Afternoon on Holiday
          // 2. Night shift of day BEFORE holiday (covers 00-06 of holiday)
          // 3. Night shift of holiday (covers 22-00 of holiday)
          const isHolidayExtra = (isHoliday && (shift === 'Mañana' || shift === 'Tarde')) ||
                                 (isNextDayHoliday && shift === 'Noche') ||
                                 (isHoliday && shift === 'Noche');

          const extraVal = extraMinutes / 60; // EXPRESSED IN HOURS
          
          if (isHolidayExtra) holidayExtraHours += extraVal;
          else if (isWeekendExtra) weekendExtraHours += extraVal;
          else weekdayExtraHours += extraVal;

          extraShiftsDebug.push({
            date: dayStr,
            shift: shift,
            duration: totalActualMinutes,
            planned: totalPlannedMinutes,
            extra: extraVal,
            type: isHolidayExtra ? 'Feriado' : (isWeekendExtra ? 'Finde' : 'Común')
          });
        }
      });
    });

    const totalExtraHours = holidayExtraHours + weekendExtraHours + weekdayExtraHours;

    // Total worked shifts is the sum of worked shifts per line (which already used specific durations)
    const turnosTrabajadosTotal = Object.values(turnosPorLinea).reduce((a, b) => a + b, 0);
    
    // Monthly Projection Calculation
    const currentMonthStr = format(new Date(), 'yyyy-MM');
    let pendingPlannedShifts = 0;
    let pendingPlannedDays = 0;
    
    if (selectedMonth === currentMonthStr) {
      let lastReportDate = '';
      let lastReportShiftOrder = 0;
      const shiftOrders: Record<string, number> = { 'Mañana': 1, 'Tarde': 2, 'Noche': 3 };

      filteredReports.forEach(r => {
        const logicalDate = getLogicalDate(r);
        const shiftNum = shiftOrders[r.turno] || 0;
        if (logicalDate > lastReportDate || (logicalDate === lastReportDate && shiftNum > lastReportShiftOrder)) {
          lastReportDate = logicalDate;
          lastReportShiftOrder = shiftNum;
        }
      });

      if (!lastReportDate) {
        lastReportDate = format(new Date(), 'yyyy-MM-dd');
        lastReportShiftOrder = 0; // If nothing loaded, treat anything today as pending
      }

      plannedShiftsList.forEach(ps => {
        if (ps.date > lastReportDate || (ps.date === lastReportDate && ps.shiftOrder > lastReportShiftOrder)) {
          pendingPlannedShifts += ps.count;
          if (ps.totalDayShifts > 0) {
            pendingPlannedDays += (ps.count / ps.totalDayShifts);
          }
        }
      });
    }

    const avgPacksPerShift = turnosTrabajadosTotal > 0 ? totalPacks / turnosTrabajadosTotal : 0;
    const projectedPendingPacks = pendingPlannedShifts * avgPacksPerShift;
    const projectedTotalPacks = totalPacks + projectedPendingPacks;
    
    // Stability Index Calculation
    const monthlyAuditLogs = auditLogs.filter(log => log.datePlan.startsWith(selectedMonth));
    const monthlyPlans = plans.filter(p => p.date.startsWith(selectedMonth));
    
    // Fulfillment Index Calculation (Cruzado: Planes vs Reportes Reales) - BASADA EN MINUTOS
    let fulfilledItems = 0;
    let deviationItems = 0;
    let missedItems = 0;
    let partialItems = 0;
    const planFulfillments: number[] = [];

    const isTodayMonth = selectedMonth === currentMonthStr;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    
    // Para el cálculo de cumplimiento, solo evaluamos planes cuya fecha sea <= hoy
    const plansForFulfillment = monthlyPlans.filter(p => !isTodayMonth || p.date <= todayStr);

    plansForFulfillment.forEach(plan => {
      // Todos los reportes para este turno/línea (Normalizando nombres de línea)
      const reportsInShift = filteredReports.filter(r => 
        getLogicalDate(r) === plan.date && 
        r.turno === plan.shift && 
        String(r.linea).replace(/\D/g, '') === String(plan.linea).replace(/\D/g, '')
      );

      const calculateDuration = (r: ProductionReport) => {
        const entra = r.entraTurno?.split(':') || ['0', '0'];
        const sale = r.saleTurno?.split(':') || ['0', '0'];
        let start = parseInt(entra[0]) * 60 + parseInt(entra[1]);
        let end = parseInt(sale[0]) * 60 + parseInt(sale[1]);
        if (start === 0 && end === 0 && r.tiempoTurno) return r.tiempoTurno * 60;
        if (end < start) end += 1440;
        return Math.max(0, end - start);
      };

      const totalShiftMinutes = reportsInShift.reduce((sum, r) => sum + calculateDuration(r), 0);

      if (totalShiftMinutes === 0) {
        missedItems++;
        planFulfillments.push(0);
      } else {
        const matchedMinutes = reportsInShift.filter(r => {
           // Normalización extrema para comparación de productos
           const s1 = String(r.sabor || r.marca || '').trim().toLowerCase();
           const s2 = String(plan.sabor || plan.marca || '').trim().toLowerCase();
           const m1 = String(r.marca || '').trim().toLowerCase();
           const m2 = String(plan.marca || '').trim().toLowerCase();
           const t1 = Math.round(Number(r.tamano || 0));
           const t2 = Math.round(Number(plan.tamano || 0));
           
           // Si el sabor contiene al otro o son iguales (flexibilidad para "Triple Cola" vs "Cola")
           const flavorMatch = s1 === s2 || (s1 && s2 && (s1.includes(s2) || s2.includes(s1)));
           
           return flavorMatch && (t1 === t2 || !t1 || !t2);
        }).reduce((sum, r) => sum + calculateDuration(r), 0);

        const ratio = Math.min(1, matchedMinutes / totalShiftMinutes);
        planFulfillments.push(ratio);

        if (ratio >= 0.98) fulfilledItems++;
        else if (ratio <= 0.02) deviationItems++;
        else partialItems++;
      }
    });

    const totalFulfillmentItems = plansForFulfillment.length;
    const fulfillmentIndex = totalFulfillmentItems > 0 
      ? (planFulfillments.reduce((a, b) => a + b, 0) / totalFulfillmentItems) * 100 
      : 0;

    const modifications = monthlyAuditLogs.filter(log => log.action === 'update');
    const deletions = monthlyAuditLogs.filter(log => log.action === 'delete');
    const totalEvents = modifications.length + deletions.length;
    
    let criticalChangesCount = 0;
    const criticalLogs: ScheduleAuditLog[] = [];

    monthlyAuditLogs.forEach(log => {
      if (log.action === 'update' || log.action === 'delete') {
         // Check "Red Zone": less than 24h notice
         // log.timestamp vs log.datePlan (assuming plan starts at 06:00 of that day)
         const planDate = parseISO(`${log.datePlan}T06:00:00`);
         const changeDate = parseISO(log.timestamp);
         const hoursDifference = differenceInHours(planDate, changeDate);
         if (hoursDifference < 24) {
           criticalChangesCount++;
           criticalLogs.push(log);
         }
      }
    });

    const totalScheduledItems = monthlyPlans.length;
    const stabilityIndex = totalScheduledItems > 0 
      ? Math.max(0, 100 - ((totalEvents + criticalChangesCount) / (totalScheduledItems + totalEvents)) * 100) 
      : 100;
    
    // Process attendance to count present operators per shift
    filteredAttendance.forEach(a => {
      if (a.status === 'Presente') {
        // Apply logical date rule to attendance as well: Noche shift is associated with previous day
        const logicalDate = a.shift === 'Noche' ? format(subDays(parseISO(a.date), 1), 'yyyy-MM-dd') : a.date;
        const crossoverKey = `${logicalDate}_${a.shift}`;
        if (!shiftCrossoverMap[crossoverKey]) {
           shiftCrossoverMap[crossoverKey] = {
             date: logicalDate,
             shift: a.shift,
             activeLines: new Set<string>(),
             presentOperators: 0,
             reports: []
           };
        }
        shiftCrossoverMap[crossoverKey].presentOperators += 1;
      }
    });

    const getShiftWeight = (s: string) => {
      const norm = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (norm === 'noche') return 0;
      if (norm === 'tarde') return 1;
      if (norm === 'manana') return 2;
      return 99;
    };

    const shiftCrossoverArray = Object.values(shiftCrossoverMap).map(cross => {
      let maxSimultaneousLines = 0;
      let maxRequiredOperators = 0;
      let activeLinesAtPeak = new Set<string>();
      
      const events: { time: number, type: 'start' | 'end', line: string, req: number }[] = [];
      
      cross.reports.forEach(r => {
        const entra = r.entraTurno?.split(':') || ['0', '0'];
        const sale = r.saleTurno?.split(':') || ['0', '0'];
        let start = parseInt(entra[0]) * 60 + parseInt(entra[1]);
        let end = parseInt(sale[0]) * 60 + parseInt(sale[1]);
        
        if (isNaN(start)) start = 0;
        if (isNaN(end)) end = 0;

        if (end < start) end += 1440; // Next day
        
        const req = config?.lineOperators?.[r.linea] || 0;
        events.push({ time: start, type: 'start', line: r.linea, req });
        events.push({ time: end, type: 'end', line: r.linea, req });
      });
      
      // Sort: if times are equal, processes ends before starts to not over-count
      events.sort((a, b) => {
         if (a.time === b.time) return a.type === 'end' ? -1 : 1;
         return a.time - b.time;
      });

      let currentLines = new Set<string>();
      
      events.forEach(ev => {
         if (ev.type === 'start') {
            currentLines.add(ev.line);
         } else {
            currentLines.delete(ev.line);
         }
         
         const currentLineCount = currentLines.size;
         // Required is the SUM of requirements of all lines active simultaneously
         let currentSumReq = 0;
         currentLines.forEach(l => {
            currentSumReq += config?.lineOperators?.[l] || 0;
         });
         
         if (currentLineCount > maxSimultaneousLines) {
            maxSimultaneousLines = currentLineCount;
         }
         
         if (currentSumReq > maxRequiredOperators) {
            maxRequiredOperators = currentSumReq;
            activeLinesAtPeak = new Set(currentLines);
         }
      });
      
      const activeArr = Array.from(activeLinesAtPeak.size > 0 ? activeLinesAtPeak : cross.activeLines).sort();
      const inactiveArr = (config?.lines || [])
        .filter(l => config?.enabledLines?.[l] !== false && !cross.activeLines.has(l))
        .sort();
      
      return {
        date: cross.date,
        shift: cross.shift,
        activeLinesCount: maxSimultaneousLines || (cross.activeLines.size > 0 ? 1 : 0),
        activeLines: activeArr,
        inactiveLines: inactiveArr,
        required: maxRequiredOperators,
        present: cross.presentOperators
      };
    }).sort((a, b) => {
      // Sort by date DESC, then by shift ASC (chronological)
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      
      const weightA = getShiftWeight(a.shift);
      const weightB = getShiftWeight(b.shift);
      return weightA - weightB;
    });
    
    const cajasUnitarias = totalLiters / 5.67;
    const cajasUnitariasFromPacks = totalLitersFromPacks / 5.67;
    const relacionLitrosBotellas = totalBottles > 0 ? totalLiters / totalBottles : 0;
    
    let totalActiveProducts = 0;
    const activeProductsList: { name: string, key: string }[] = [];

    if (config) {
      // Get all sizes supportable by at least one enabled line
      const supportableSizes = new Set<number>();
      availableLines.forEach(l => {
        const sizes = config.lineSizeCombinations?.[l] || [];
        sizes.forEach(s => supportableSizes.add(Number(s)));
      });

        availableBrands.forEach(brand => {
          availableSizes.forEach(size => {
            // Only count if the size can be produced on at least one enabled line
            if (!supportableSizes.has(Number(size))) return;

            const sizeStr = size.toString();
            const brandActive = config.activeProducts?.[brand];
            const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
            const hasSizeConfig = brandActive && sizeStr in brandActive;
            
            // Use triple combination (Brand + Size) for flavors, fallback to brand-only ONLY if NO activeProducts exist for this brand
            const allowedFlavors = hasSizeConfig
              ? brandActive[sizeStr]
              : (hasBrandConfig ? [] : (config.brandFlavorCombinations[brand] || []));
            
            allowedFlavors.forEach(flavor => {
            // Must be enabled in global flavor list and NOT be an external product
            const isExternal = (config.externalProducts?.[brand]?.[sizeStr] || []).includes(flavor);
            if (config.enabledFlavors?.[flavor] !== false && !isExternal) {
              totalActiveProducts++;
              activeProductsList.push({ 
                name: `${brand} ${flavor} ${size}cc`,
                key: `${brand}|${flavor}|${size}`
              });
            }
          });
        });
      });
    }

    // ---- NUEVAS MÉTRICAS: TRANSFORMACIONES DE LÍNEA Y CAMBIO DE SABOR ----
    const lineReports: Record<string, ProductionReport[]> = {};
    
    // Normalize line identifier helpers
    const getNormalizedLine = (line: any): string => {
      if (!line) return '';
      const s = String(line).trim().toLowerCase();
      const numMatch = s.match(/\d+/);
      if (numMatch) {
        return numMatch[0]; // e.g. "1" from "Línea 1"
      }
      return s;
    };

    const getReportStartAndEnd = (r: ProductionReport) => {
      const entraStr = r.entraTurno || '00:00';
      const saleStr = r.saleTurno || '00:00';
      
      let start = parseISO(`${r.fecha}T${entraStr}`);
      let end = parseISO(`${r.fecha}T${saleStr}`);

      if (entraStr >= '22:00') {
        start = subDays(start, 1);
        if (saleStr >= '22:00') {
          end = subDays(end, 1);
        }
      } else if (saleStr < entraStr) {
        end = addDays(end, 1);
      }
      return { start, end };
    };

    const normalizedAvailableLines = new Set(
      availableLines.map(l => getNormalizedLine(l)).filter(Boolean)
    );

    // Group reports by robustly normalized line
    filteredReports.forEach(r => {
      const normLine = getNormalizedLine(r.linea);
      if (!normLine) return; // Ignore reports without a line
      if (!normalizedAvailableLines.has(normLine)) return; // Ignore if line is not enabled/available

      if (!lineReports[normLine]) lineReports[normLine] = [];
      lineReports[normLine].push(r);
    });

    let transformacionesConsecutivas = 0;
    let transformacionesNoConsecutivas = 0;
    let cambiosSabor = 0;

    const transformacionesConsecutivasByLine: Record<string, number> = {};
    const transformacionesNoConsecutivasByLine: Record<string, number> = {};
    const cambiosSaborByLine: Record<string, number> = {};

    const arranquesPorLinea: Record<string, number> = {};
    let totalArranquesLinea = 0;
    const allReportsWithTimes: Array<{ report: ProductionReport; times: { start: Date; end: Date }; line: string }> = [];

    Object.keys(lineReports).forEach(lKey => {
      transformacionesConsecutivasByLine[lKey] = 0;
      transformacionesNoConsecutivasByLine[lKey] = 0;
      cambiosSaborByLine[lKey] = 0;

      // Keep only valid production reports with positive sizes and populated brands/flavors
      const validLineSorted = lineReports[lKey].filter(r => {
        const size = r.tamano || 0;
        const sabor = (r.sabor || '').trim();
        const marca = (r.marca || '').trim();
        return size > 0 && sabor.length > 0 && marca.length > 0;
      });

      // Map each report to its absolute start and end times
      const withTimes = validLineSorted.map(r => ({
        report: r,
        times: getReportStartAndEnd(r)
      }));

      // Sort reports for this line chronologically using their physical start time
      withTimes.sort((a, b) => {
        const timeDiff = a.times.start.getTime() - b.times.start.getTime();
        if (timeDiff !== 0) return timeDiff;
        const crA = a.report.createdAt || '';
        const crB = b.report.createdAt || '';
        if (crA !== crB) return crA.localeCompare(crB);
        return (a.report.id || '').localeCompare(b.report.id || '');
      });

      // Add to merged list for factory calculations
      withTimes.forEach(item => {
        allReportsWithTimes.push({
          report: item.report,
          times: item.times,
          line: lKey
        });
      });

      // Calculate line startups
      let lineStartups = 0;
      if (withTimes.length > 0) {
        lineStartups = 1; // El primer reporte del período cuenta como arranque de la línea
        for (let j = 1; j < withTimes.length; j++) {
          const prev = withTimes[j - 1];
          const curr = withTimes[j];
          const gap = differenceInMinutes(curr.times.start, prev.times.end);
          if (gap > 60) { // Parado por más de 1 hora
            lineStartups++;
          }
        }
      }
      arranquesPorLinea[lKey] = lineStartups;
      totalArranquesLinea += lineStartups;

      for (let i = 1; i < withTimes.length; i++) {
        const prev = withTimes[i - 1];
        const curr = withTimes[i];

        const prevSize = prev.report.tamano!;
        const currSize = curr.report.tamano!;
        const prevSabor = prev.report.sabor!.trim().toLowerCase();
        const currSabor = curr.report.sabor!.trim().toLowerCase();

        // Gap in minutes from end of prev to start of curr
        const gap = differenceInMinutes(curr.times.start, prev.times.end);

        // Even with small differences back-to-back, allow up to 60 minutes for handovers/overlapping
        const isConsecutive = gap >= -60 && gap <= 60;

        const hasSizeChange = prevSize !== currSize;

        if (hasSizeChange) {
          if (isConsecutive) {
            transformacionesConsecutivas++;
            transformacionesConsecutivasByLine[lKey]++;
          } else {
            transformacionesNoConsecutivas++;
            transformacionesNoConsecutivasByLine[lKey]++;
          }
        } else {
          const hasFlavorChange = prevSabor !== currSabor;
          if (hasFlavorChange && isConsecutive) {
            cambiosSabor++;
            cambiosSaborByLine[lKey]++;
          }
        }
      }
    });

    // Calculate overall factory startups
    allReportsWithTimes.sort((a, b) => {
      const timeDiff = a.times.start.getTime() - b.times.start.getTime();
      if (timeDiff !== 0) return timeDiff;
      const crA = a.report.createdAt || '';
      const crB = b.report.createdAt || '';
      if (crA !== crB) return crA.localeCompare(crB);
      return (a.report.id || '').localeCompare(b.report.id || '');
    });

    let arranquesFabrica = 0;
    if (allReportsWithTimes.length > 0) {
      arranquesFabrica = 1; // Empezar el lote inicial de reportes cuenta como arranque de fábrica
      let maxEndTime = allReportsWithTimes[0].times.end;

      for (let i = 1; i < allReportsWithTimes.length; i++) {
        const curr = allReportsWithTimes[i];
        const gap = differenceInMinutes(curr.times.start, maxEndTime);
        if (gap > 720) { // Más de 12 horas de inactividad de toda la fábrica (ej. fin de semana)
          arranquesFabrica++;
        }
        if (curr.times.end.getTime() > maxEndTime.getTime()) {
          maxEndTime = curr.times.end;
        }
      }
    }

    const totalTransformaciones = transformacionesConsecutivas + transformacionesNoConsecutivas;

    return {
      turnosTotales,
      turnosOperativosPlanificados,
      standardDailyShifts,
      averagePlannedShiftsPerDay,
      extraHours: totalExtraHours,
      holidayExtraHours,
      weekendExtraHours,
      weekdayExtraHours,
      turnosTrabajadosTotal,
      turnosPorLinea,
      packsPorLinea,
      totalPacks,
      avgPacksPerShift,
      pendingPlannedShifts,
      pendingPlannedDays,
      projectedPendingPacks,
      projectedTotalPacks,
      cajasUnitarias,
      cajasUnitariasFromPacks,
      relacionLitrosBotellas,
      transformations: {
        consecutive: transformacionesConsecutivas,
        nonConsecutive: transformacionesNoConsecutivas,
        total: totalTransformaciones,
        flavorChanges: cambiosSabor,
        flavorChangesByLine: cambiosSaborByLine,
        consecutiveByLine: transformacionesConsecutivasByLine,
        nonConsecutiveByLine: transformacionesNoConsecutivasByLine,
        factoryStartups: arranquesFabrica,
        lineStartupsTotal: totalArranquesLinea,
        lineStartupsBreakdown: arranquesPorLinea
      },
      waste: {
        totalScrapSoplado,
        totalScrapEtiquetado,
        totalScrapLlenado,
        totalScrapHorno,
        totalDesperdicioEtiquetas,
        totalDesperdicioTapas,
        totalDesperdicioSifones,
        totalDesperdicioTermo,
        totalBotellasRotas
      },
      producedProductsCount: producedProducts.size,
      producedProducts: Array.from(producedProducts),
      totalActiveProducts: totalActiveProducts || 1,
      cajasUnitariasFisicasRatio: totalPacks > 0 ? cajasUnitarias / totalPacks : 0,
      operatorsCrossOver: shiftCrossoverArray,
      stability: {
        index: Math.round(stabilityIndex),
        totalEvents,
        modifications: modifications.length,
        deletions: deletions.length,
        criticalChanges: criticalChangesCount,
        criticalLogs: criticalLogs.slice(0, 5), // Keep top 5 latest critical for display
        totalScheduledItems
      },
      fulfillment: {
        index: Math.round(fulfillmentIndex),
        fulfilledItems,
        deviationItems,
        missedItems,
        partialItems,
        totalPlans: totalFulfillmentItems,
        isPartial: isTodayMonth
      },
      breakdown: {
        extraShiftsDebug,
        daysInMonth: daysInMonth.length,
        holidays: shiftConfig.holidays || [],
        holidayNightDuration: shiftConfig.holidayNightDuration || 360,
        dailyPlan,
        standardDailyShifts,
        averagePlannedShiftsPerDay,
        holidayExtraHours,
        weekendExtraHours,
        weekdayExtraHours,
        minutesByDay,
        turnosPorLinea,
        activeProductsList,
        pendingPlannedShifts,
        pendingPlannedDays,
        avgPacksPerShift,
        projectedPendingPacks,
        projectedTotalPacks
      }
    };
  }, [filteredReports, filteredAttendance, selectedMonth, config, availableBrands, availableSizes, snapshot, auditLogs, plans]);

  // Automatic snapshot saving for past months
  useEffect(() => {
    const currentMonth = format(new Date(), 'yyyy-MM');
    if (selectedMonth < currentMonth && !loading && !isSnapshotLoading && !isSavingSnapshot && !snapshot && stats && Object.keys(stats).length > 0) {
      // Extra safety check: if we are still loading something, don't save
      if (loading) return;

      const saveSnapshot = async () => {
        setIsSavingSnapshot(true);
        try {
          // Double check snapshot hasn't been created in the meantime
          const [year, month] = selectedMonth.split('-');
          const q = query(
            collection(db, 'monthly_snapshots'), 
            where('year', '==', parseInt(year)),
            where('month', '==', month)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
             setSnapshot({ id: snap.docs[0].id, ...snap.docs[0].data() } as MonthlySnapshot);
             setIsSavingSnapshot(false);
             return;
          }

          const newSnapshot: Omit<MonthlySnapshot, 'id'> = {
            month,
            year: parseInt(year),
            stats,
            configAtTime: config,
            isClosed: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          const docRef = await addDoc(collection(db, 'monthly_snapshots'), newSnapshot);
          setSnapshot({ id: docRef.id, ...newSnapshot } as MonthlySnapshot);
          console.log("Automatic snapshot saved for", selectedMonth);
        } catch (error) {
          console.error("Error saving automatic snapshot:", error);
        } finally {
          setIsSavingSnapshot(false);
        }
      };
      saveSnapshot();
    }
  }, [selectedMonth, snapshot, stats, loading, isSnapshotLoading, isSavingSnapshot, config]);

  const handleRefreshSnapshot = async () => {
    if (!isAdmin) return;

    try {
      if (snapshot?.id) {
        setIsSavingSnapshot(true);
        // Delete the existing snapshot from Firestore
        await deleteDoc(doc(db, 'monthly_snapshots', snapshot.id));
        
        // Clear local state to force recalculation
        setSnapshot(null);
        setIsSavingSnapshot(false);
        alert('Histórico eliminado. Se recalculará automáticamente según los datos actuales.');
      }
    } catch (error) {
      console.error("Error refreshing snapshot:", error);
      setIsSavingSnapshot(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-sans antialiased text-gray-800">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-900 font-medium">
          <BarChart3 className="w-5.5 h-5.5 text-blue-600" />
          <h2 className="text-xl font-display font-extrabold tracking-tight">Resumen Gerencial de Producción</h2>
        </div>
        <div className="flex items-center gap-4">
          {managementStartDate && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gestión:</label>
              <select
                value={selectedGestion}
                onChange={(e) => setSelectedGestion(e.target.value as any)}
                className="rounded-xl border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs border p-2 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <option value="all">Todas</option>
                <option value="current">Actual</option>
                <option value="previous">Anterior</option>
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-xl border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs font-semibold border p-2 min-w-[180px] bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              {months.map(m => (
                <option key={m} value={m}>
                  {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>

          {snapshot && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-100 rounded-xl">
              <Lock className="w-3.5 h-3.5 text-green-600" />
              <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Histórico Cerrado</span>
              {isAdmin && (
                <button 
                  onClick={handleRefreshSnapshot}
                  className="ml-2 p-1 hover:bg-green-100 rounded-lg transition-colors border border-green-200"
                  title="Recalcular y actualizar histórico"
                >
                  <RefreshCw className="w-3 h-3 text-green-600" />
                </button>
              )}
            </div>
          )}
          {!snapshot && selectedMonth < format(new Date(), 'yyyy-MM') && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-100 rounded-xl">
              <Unlock className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Datos Dinámicos</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column - Turnos */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex gap-6">
            <div className="flex-1 bg-slate-900 text-white rounded-2xl overflow-hidden shadow-xl border border-slate-800">
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Capacidad Máxima (Turnos)</span>
                  <span className="text-3xl font-display font-extrabold text-white">{stats.turnosTotales}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Turnos Operativos Planificados</span>
                  <span className="text-3xl font-display font-extrabold text-white">{stats.turnosOperativosPlanificados}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Promedio Turnos p/día</span>
                    <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" title="Promedio de turnos en un día estándar (Lunes a Jueves)" />
                  </div>
                  <span className="text-3xl font-display font-extrabold text-white">{stats.standardDailyShifts.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center justify-center px-4">
              <UserCircle2 className="w-24 h-24 text-gray-250 opacity-40" />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h3 className="font-display font-bold text-gray-800 text-sm tracking-tight">Turnos Trabajados (Reales)</h3>
              </div>
              <span className="text-2xl font-display font-bold text-blue-750">{stats.turnosTrabajadosTotal.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="divide-y divide-gray-150">
              <div className="flex justify-between items-center px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <span className="text-sm font-medium text-gray-600">Turnos Línea 1</span>
                <span className="text-lg font-display font-bold text-gray-900">{stats.turnosPorLinea['1'].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <span className="text-sm font-medium text-gray-600">Turnos Línea 2</span>
                <span className="text-lg font-display font-bold text-gray-900">{stats.turnosPorLinea['2'].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <span className="text-sm font-medium text-gray-600">Turnos Línea 3</span>
                <span className="text-lg font-display font-bold text-gray-900">{stats.turnosPorLinea['3'].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="bg-orange-50/60 rounded-2xl p-5 border border-orange-100 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="bg-orange-100 p-2.5 rounded-xl border border-orange-200">
                  <Clock className="w-5.5 h-5.5 text-orange-600" />
                </div>
                <div>
                  <span className="block text-xs font-semibold text-orange-850 uppercase tracking-wider">Horas Extras Totales</span>
                  <span className="text-xs text-orange-700/80 font-medium">Excedentes y fines de semana</span>
                </div>
              </div>
              <span className="text-3xl font-display font-extrabold text-orange-850">{stats.extraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-sm font-medium">hs</span></span>
            </div>
            
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-orange-200/50">
              <div>
                <span className="block text-[10px] font-semibold text-orange-700 uppercase tracking-wider">Feriados</span>
                <span className="text-xl font-display font-bold text-orange-900">{stats.holidayExtraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs font-medium">hs</span></span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold text-orange-700 uppercase tracking-wider">Fines de Semana</span>
                <span className="text-xl font-display font-bold text-orange-900">{stats.weekendExtraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs font-medium">hs</span></span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold text-orange-700 uppercase tracking-wider">Excedentes Comunes</span>
                <span className="text-xl font-display font-bold text-orange-900">{stats.weekdayExtraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs font-medium">hs</span></span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="bg-slate-55 p-6 border-b border-gray-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200">
                    <ListChecks className="w-5.5 h-5.5 text-slate-700" />
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-bold text-slate-800 tracking-tight">Estabilidad del Programa</h3>
                    <p className="text-xs text-slate-500 font-medium">Cumplimiento y cambios en los programas publicados</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Índice de Estabilidad</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-4xl font-display font-extrabold ${
                        stats.stability.index > 90 ? 'text-emerald-600' : 
                        stats.stability.index > 75 ? 'text-amber-600' : 'text-red-650'
                      }`}>{stats.stability.index}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-55 p-4 rounded-xl border border-slate-200">
                <span className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Items Planificados</span>
                <span className="text-2xl font-display font-bold text-slate-800">{stats.stability.totalScheduledItems}</span>
              </div>
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200">
                <div className="flex justify-between items-start">
                  <span className="block text-xs font-semibold text-amber-805 uppercase tracking-wider mb-1">Modificaciones</span>
                  <Edit2 className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <span className="text-2xl font-display font-bold text-amber-900">{stats.stability.modifications}</span>
              </div>
              <div className="bg-rose-50/50 p-4 rounded-xl border border-rose-200">
                 <div className="flex justify-between items-start">
                  <span className="block text-xs font-semibold text-rose-805 uppercase tracking-wider mb-1">Eliminaciones</span>
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                </div>
                <span className="text-2xl font-display font-bold text-rose-900">{stats.stability.deletions}</span>
              </div>
              <div className="bg-red-50 p-4 rounded-xl border border-red-200">
                <div className="flex justify-between items-start">
                  <span className="block text-xs font-semibold text-red-800 uppercase tracking-wider mb-1">Zona Roja (&lt;24h)</span>
                  <AlertTriangle className="w-4 h-4 text-red-600 animate-pulse" />
                </div>
                <span className="text-2xl font-display font-bold text-red-900">{stats.stability.criticalChanges}</span>
              </div>
            </div>

            {stats.stability.criticalLogs.length > 0 && (
              <div className="px-6 pb-6">
                <div className="bg-red-50 rounded-xl border border-red-100 overflow-hidden">
                  <div className="bg-red-100/40 px-4 py-2.5 flex items-center gap-2">
                    <HistoryIcon className="w-3.5 h-3.5 text-red-600" />
                    <span className="text-xs font-semibold text-red-800 uppercase tracking-wider">Últimos Cambios Críticos</span>
                  </div>
                  <div className="divide-y divide-red-100">
                    {stats.stability.criticalLogs.map((log: any, i: number) => (
                      <div key={i} className="p-3 flex items-center justify-between text-xs">
                        <div className="flex flex-col">
                          <span className="font-bold text-red-900">
                            Cambio para el {format(parseISO(log.datePlan), 'dd/MM')}
                          </span>
                          <span className="text-red-605 font-medium text-[11px]">
                            Realizado el {format(parseISO(log.timestamp), 'dd/MM HH:mm')}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          {log.changes?.map((c: any, ci: number) => (
                            <span key={ci} className="text-red-850 italic font-medium">
                              {c.field}: {c.oldValue} → {c.newValue}
                            </span>
                          ))}
                          {log.action === 'delete' && <span className="text-red-850 font-bold uppercase text-[10px]">Eliminado</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="bg-indigo-50/70 p-6 border-b border-indigo-150">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2.5 rounded-xl border border-indigo-200">
                    <Calendar className="w-5.5 h-5.5 text-indigo-700" />
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-bold text-indigo-900 tracking-tight">Cumplimiento del Programa</h3>
                    <p className="text-xs text-indigo-600/80 font-medium">Ejecución real vs planificación publicada (Sabor/Línea)</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="block text-xs font-semibold text-indigo-700 uppercase tracking-wider">
                      Índice de Cumplimiento {stats.fulfillment.isPartial ? '(Al día)' : ''}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-4xl font-display font-extrabold ${
                        stats.fulfillment.index > 90 ? 'text-emerald-600' : 
                        stats.fulfillment.index > 75 ? 'text-amber-600' : 'text-red-650'
                      }`}>{stats.fulfillment.index}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-150 flex flex-col items-center text-center">
                <span className="block text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-1">Totalmente Cumplidos</span>
                <span className="text-2xl font-display font-bold text-emerald-950">{stats.fulfillment.fulfilledItems}</span>
                <span className="text-[10.5px] text-emerald-700 font-medium mt-1">Sabor y Línea 100%</span>
              </div>
              <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-150 flex flex-col items-center text-center">
                <span className="block text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">Parciales</span>
                <span className="text-2xl font-display font-bold text-blue-950">{stats.fulfillment.partialItems}</span>
                <span className="text-[10.5px] text-blue-700 font-medium mt-1">Cambio de sabor en el turno</span>
              </div>
              <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-150 flex flex-col items-center text-center">
                <span className="block text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">Desvíos Totales</span>
                <span className="text-2xl font-display font-bold text-amber-950">{stats.fulfillment.deviationItems}</span>
                <span className="text-[10.5px] text-amber-700 font-medium mt-1">Se produjo otro sabor</span>
              </div>
              <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-150 flex flex-col items-center text-center">
                <span className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">No Ejecutados</span>
                <span className="text-2xl font-display font-bold text-slate-850">{stats.fulfillment.missedItems}</span>
                <span className="text-[10.5px] text-slate-600 font-medium mt-1">Sin reporte en el turno</span>
              </div>
            </div>
            
            <div className="px-6 pb-6 text-center">
              <p className="text-[10px] text-gray-400 italic">
                * El cálculo cruza cada item publicado en el programa con los partes de producción cargados para esa misma fecha, turno y línea.
                {stats.fulfillment.isPartial && " Para el mes en curso, solo se consideran los planes hasta la fecha de hoy."}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <h3 className="font-display font-bold text-gray-800 text-sm tracking-tight">Cruce: Operarios vs Líneas Activas</h3>
              </div>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              <div className="space-y-2.5">
                {stats.operatorsCrossOver.map((cross: any, idx: number) => {
                  const isUnderstaffed = cross.present < cross.required;
                  const isOverstaffed = cross.present > cross.required;
                  return (
                    <div key={idx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 rounded-xl border border-gray-150 bg-gray-50/50 hover:bg-gray-50 transition-colors gap-2">
                      <div className="flex flex-col">
                         <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{format(parseISO(cross.date), 'dd/MM/yyyy')} — {cross.shift}</span>
                         <span className="text-[11px] text-emerald-700 font-semibold mt-1">Líneas Simultáneas: {cross.activeLinesCount} ({cross.activeLines.length > 0 ? cross.activeLines.join(', ') : 'Ninguna'})</span>
                         {cross.inactiveLines.length > 0 && (
                             <span className="text-[11px] text-gray-500 font-medium">Líneas Abajo: {cross.inactiveLines.join(', ')}</span>
                          )}
                      </div>
                      <div className="flex gap-4 items-center sm:self-center">
                        <div className="flex flex-col items-end">
                           <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Presentes</span>
                           <span className={`text-lg font-display font-bold ${isUnderstaffed ? 'text-red-650 font-extrabold' : isOverstaffed ? 'text-amber-600' : 'text-green-600'}`}>
                             {cross.present}
                           </span>
                        </div>
                        <div className="flex flex-col items-end">
                           <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Requeridos (Máx)</span>
                           <span className="text-lg font-display font-medium text-gray-800">
                             {cross.required}
                           </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {stats.operatorsCrossOver.length === 0 && (
                   <div className="text-center text-sm text-gray-500 py-4 italic font-medium">No hay datos de cruce para el mes seleccionado.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Producción & Proyección */}
        <div className="lg:col-span-5 space-y-6">
          {/* Monthly Projection */}
          {selectedMonth === format(new Date(), 'yyyy-MM') && (
            <div className="bg-slate-950 rounded-2xl shadow-xl border border-slate-800 overflow-hidden text-white">
              <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-display font-bold uppercase text-xs tracking-wider text-slate-200">Proyección Mensual</h3>
                </div>
                <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded-lg border border-amber-500/20 font-bold uppercase tracking-wider">ESTIMADO</span>
              </div>
              <div className="p-5 space-y-5 bg-slate-950">
                <div className="space-y-2.5 border-b border-slate-800 pb-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-350 text-slate-300">Días Laborales Pendientes:</span>
                    <span className="font-display font-black text-lg text-white">{(stats.pendingPlannedDays || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-350 text-slate-300">Turnos-Líneas Laborales Pendientes:</span>
                    <span className="font-display font-black text-lg text-white">{(stats.pendingPlannedShifts || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}</span>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Plan Proyectado PENDIENTE</span>
                      <span className="text-[10.5px] text-slate-450 text-slate-300 font-bold font-mono mt-0.5">Promedio {Math.round(stats.avgPacksPerShift)} paq/turno</span>
                    </div>
                    <span className="text-2xl font-display font-black text-sky-400">{Math.round(stats.projectedPendingPacks).toLocaleString('es-AR')} <span className="text-xs font-normal text-slate-300">paq</span></span>
                  </div>
                  
                  <div className="bg-slate-900 px-4 py-3.5 border border-slate-800 rounded-xl shadow-inner">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-indigo-300 uppercase tracking-wider">Proyección Total ESTIMADA:</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-display font-black text-emerald-400">{Math.round(stats.projectedTotalPacks).toLocaleString('es-AR')}</span>
                        <span className="text-[10px] font-black text-emerald-350 text-emerald-300 uppercase tracking-wide">Paquetes</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-600" />
                <h3 className="font-display font-bold text-gray-800 text-sm tracking-tight">Producción Paquetes</h3>
              </div>
              <span className="text-2xl font-display font-bold text-indigo-750">{stats.totalPacks.toLocaleString('es-AR')}</span>
            </div>
            <div className="divide-y divide-gray-150">
              <div className="flex justify-between items-center px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <span className="text-sm font-medium text-gray-600">Paq. Línea 1</span>
                <span className="text-lg font-display font-bold text-gray-900">{stats.packsPorLinea['1'].toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <span className="text-sm font-medium text-gray-600">Paq. Línea 2</span>
                <span className="text-lg font-display font-bold text-gray-900">{stats.packsPorLinea['2'].toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <span className="text-sm font-medium text-gray-600">Paq. Línea 3</span>
                <span className="text-lg font-display font-bold text-gray-900">{stats.packsPorLinea['3'].toLocaleString('es-AR')}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-5 py-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Droplets className="w-5 h-5 text-cyan-600" />
                  <h3 className="font-display font-bold text-gray-800 text-sm tracking-tight">Eficiencia Volumen</h3>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="border-b border-gray-150 pb-3">
                  <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Cajas Unitarias</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-display font-bold text-cyan-705">{Math.round(stats.cajasUnitarias).toLocaleString('es-AR')}</span>
                    {(stats as any).cajasUnitariasFromPacks !== undefined && (
                      <span className="text-sm font-semibold text-gray-400">
                        ({Math.round((stats as any).cajasUnitariasFromPacks).toLocaleString('es-AR')})
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3.5">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rel. Litros/Bot</span>
                    <span className="text-base font-display font-semibold text-gray-850">{stats.relacionLitrosBotellas.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Prod. Activos</span>
                    <span className="text-base font-display font-semibold text-gray-850">{stats.producedProductsCount}/{stats.totalActiveProducts}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit/Físicas</span>
                    <span className="text-base font-display font-semibold text-gray-850">{stats.cajasUnitariasFisicasRatio.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden sm:flex items-end pb-6">
              <BottleIcon className="w-20 h-20 text-gray-250 opacity-40" />
            </div>
          </div>

          {/* Card: Transformaciones y Cambios de Sabor */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50/50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                <h3 className="font-display font-bold text-gray-855 text-sm tracking-tight">Cambios y Transformaciones</h3>
              </div>
              <span className="text-[10px] font-bold bg-blue-100 text-blue-750 px-2.5 py-0.5 rounded-lg tracking-wider uppercase">KPIs de Setups</span>
            </div>
            
            <div className="p-5 space-y-5">
              {/* Transformaciones de Línea */}
              <div className="pb-4 border-b border-gray-150 border-dashed">
                <div className="flex justify-between items-baseline mb-1">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-650 uppercase tracking-wider">Transformaciones de Línea</span>
                    <span className="text-xs text-slate-500 font-medium">Cambios de calibre (tamaño) en la línea</span>
                  </div>
                  <span className="text-3xl font-display font-bold text-slate-800">
                    {stats.transformations?.total ?? 0}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Con Personal (Consecutivas)</span>
                    <span className="text-lg font-display font-bold text-slate-800 mt-1 block">{stats.transformations?.consecutive ?? 0}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Sin Personal (Faltantes)</span>
                    <span className="text-lg font-display font-bold text-slate-800 mt-1 block">{stats.transformations?.nonConsecutive ?? 0}</span>
                  </div>
                </div>
                
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-150 mt-3">
                  <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Por Línea (Total)</span>
                  <div className="grid grid-cols-3 gap-2">
                    {availableLines.map(line => {
                      const normLine = line.replace(/\D/g, '') || line.toLowerCase().trim();
                      const c = stats.transformations?.consecutiveByLine?.[normLine] ?? 0;
                      const nc = stats.transformations?.nonConsecutiveByLine?.[normLine] ?? 0;
                      const total = c + nc;
                      return (
                        <div key={line} className="bg-white p-2 rounded-lg border border-gray-150 flex flex-col pl-3 justify-center shadow-sm">
                          <span className="text-[10px] font-bold text-gray-600 mb-0.5">{line}</span>
                          <span className="text-base font-display font-bold text-gray-900 leading-none">{total}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cambios de Sabor */}
              <div className="pb-4 border-b border-gray-150 border-dashed">
                <div className="flex justify-between items-baseline mb-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-655 uppercase tracking-wider">Cambios de Sabor</span>
                    <span className="text-xs text-slate-500 font-medium">Misma línea y calibre, consecutivas</span>
                  </div>
                  <span className="text-3xl font-display font-bold text-blue-600">
                    {stats.transformations?.flavorChanges ?? 0}
                  </span>
                </div>

                <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100">
                  <span className="block text-[10px] font-semibold text-blue-800 uppercase tracking-wider mb-2">Por Línea</span>
                  <div className="grid grid-cols-3 gap-2">
                    {availableLines.map(line => {
                      const normLine = line.replace(/\D/g, '') || line.toLowerCase().trim();
                      const count = stats.transformations?.flavorChangesByLine?.[normLine] ?? 0;
                      return (
                        <div key={line} className="bg-white p-2 rounded-lg border border-blue-150 flex flex-col pl-3 justify-center shadow-sm">
                          <span className="text-[10px] font-bold text-blue-700 mb-0.5">{line}</span>
                          <span className="text-base font-display font-bold text-blue-900 leading-none">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Arranques de Línea */}
              <div>
                <div className="flex justify-between items-baseline mb-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-655 uppercase tracking-wider">Arranques de línea y planta</span>
                    <span className="text-xs text-slate-500 font-medium">Puestas en marcha de líneas de producción</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-amber-50/50 p-2.5 rounded-xl border border-amber-100 shadow-sm">
                    <span className="block text-[10px] font-semibold text-amber-800 uppercase tracking-wider">Arranque de Fábrica</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-display font-bold text-amber-900">{stats.transformations?.factoryStartups ?? 0}</span>
                      <span className="text-[10px] text-amber-600 font-semibold uppercase tracking-wider">Planta</span>
                    </div>
                  </div>
                  <div className="bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100 shadow-sm">
                    <span className="block text-[10px] font-semibold text-indigo-800 uppercase tracking-wider">Arranques de Línea</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-display font-bold text-indigo-900">{stats.transformations?.lineStartupsTotal ?? 0}</span>
                      <span className="text-[10px] text-indigo-600 font-semibold uppercase tracking-wider">Totales</span>
                    </div>
                  </div>
                </div>

                {/* Desglose de Arranques por Línea */}
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-150 space-y-2">
                  <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Desglose de Arranques</span>
                  <div className="grid grid-cols-3 gap-2">
                    {availableLines.map(line => {
                      const normLine = line.replace(/\D/g, '') || line.toLowerCase().trim();
                      const count = stats.transformations?.lineStartupsBreakdown?.[normLine] ?? 0;
                      return (
                        <div key={line} className="bg-white p-2 rounded-lg border border-gray-150 flex flex-col items-center justify-center shadow-sm">
                          <span className="text-[10px] font-bold text-gray-600">{line}</span>
                          <span className="text-sm font-display font-bold text-gray-900 mt-1">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50/60 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-550 mt-0.5" />
        <div className="text-xs text-blue-800 space-y-1.5 font-medium leading-relaxed">
          <p><strong>Turnos Totales:</strong> 3 líneas × 3 turnos × días del mes.</p>
          <p><strong>Turnos Hábiles:</strong> Lunes a Viernes (3 turnos) y Sábado (1 turno mañana) por cada línea.</p>
          <p><strong>Turnos Trabajados:</strong> Minutos de Marcha Bruta / 480 min por turno estándar.</p>
          <p><strong>Cajas Unitarias:</strong> Litros totales producidos / 5.67 (factor estándar).</p>
          <p><strong>Proyección:</strong> Se calcula multiplicando los turnos restantes del mes (según planificación) por el promedio de paquetes por turno del mes actual.</p>
        </div>
      </div>

      {/* Calculation Breakdown for Transparency */}
      <div className="mt-12 border-t border-gray-205 pt-8">
        <details className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden group">
          <summary className="p-4 cursor-pointer hover:bg-gray-100 transition-colors flex items-center justify-between font-display font-semibold text-gray-700 text-sm tracking-tight select-none">
            <span>Detalle Técnico de Cálculos (Revisión)</span>
            <span className="text-xs font-normal text-gray-400 group-open:hidden">Haga clic para ver el desglose</span>
          </summary>
          <div className="p-6 space-y-6 bg-white border-t border-gray-150">
            <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl flex items-start gap-3 mb-4">
              <Info className="w-4 h-4 text-amber-600 mt-0.5" />
              <div className="text-[11px] text-amber-900 space-y-1 font-medium leading-relaxed">
                <p className="font-bold uppercase tracking-wide">Reglas de Conversión y Jornada:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><strong>Unidad Estándar:</strong> 1 Turno = 480 minutos.</li>
                  <li><strong>Turnos Reducidos:</strong> 360 min = 0.75 turnos. 300 min (Sábados) = 0.625 turnos.</li>
                  <li><strong>Día Operativo:</strong> Inicia a las 06:00 hs (excepto Sábado que inicia a las 05:00 hs).</li>
                  <li><strong>Cierre Viernes:</strong> La jornada del viernes termina el Sábado a las 05:00 hs.</li>
                </ul>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h4 className="font-display font-bold text-blue-900 text-xs uppercase tracking-wide mb-3">1. Planificación y Feriados</h4>
                <div className="space-y-2 text-sm font-medium">
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 text-gray-600">
                    <span>Días en el mes:</span>
                    <span className="font-bold text-gray-900">{stats.breakdown.daysInMonth}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 text-gray-600">
                    <span>Feriados detectados:</span>
                    <span className="font-bold text-gray-900">{stats.breakdown.holidays.length}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 text-gray-600">
                    <span>Duración Noche Feriado:</span>
                    <span className="font-bold text-orange-650">{stats.breakdown.holidayNightDuration} min</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 text-blue-700">
                    <span>Promedio Lun-Jue (Config):</span>
                    <span className="font-display font-bold">{stats.breakdown.standardDailyShifts.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                  </div>
                  
                  {/* Debug Extras List */}
                  {stats.breakdown.extraShiftsDebug.length > 0 && (
                    <div className="mt-4">
                      <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Detalle de Excedentes ({stats.breakdown.extraShiftsDebug.length}):</span>
                      <div className="mt-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-xl bg-gray-50/50">
                        <table className="min-w-full text-[11px] font-medium text-gray-700">
                          <thead className="bg-gray-100 sticky top-0 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                            <tr>
                              <th className="px-3 py-1.5 text-left">Fecha</th>
                              <th className="px-3 py-1.5 text-left">Turno</th>
                              <th className="px-3 py-1.5 text-center">Plan (m)</th>
                              <th className="px-3 py-1.5 text-center">Real (m)</th>
                              <th className="px-3 py-1.5 text-right">Extra (hs)</th>
                              <th className="px-3 py-1.5 text-center">Tipo</th>
                              <th className="px-3 py-1.5 text-center">Acción</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-150">
                            {stats.breakdown.extraShiftsDebug.map((ex, i) => (
                              <tr key={i} className="hover:bg-white transition-colors">
                                <td className="px-3 py-1.5">{format(parseISO(ex.date), 'dd/MM')}</td>
                                <td className="px-3 py-1.5">{ex.shift}</td>
                                <td className="px-3 py-1.5 text-center text-gray-400">{ex.planned}</td>
                                <td className="px-3 py-1.5 text-center text-gray-400">{ex.duration}</td>
                                <td className="px-3 py-1.5 text-right font-display font-bold text-gray-900">{ex.extra.toFixed(2)}</td>
                                <td className="px-3 py-1.5 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                                    ex.type === 'Feriado' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                                    ex.type === 'Finde' ? 'bg-orange-100 text-orange-700 border border-orange-200' : 
                                    'bg-blue-100 text-blue-700 border border-blue-200'
                                  }`}>
                                    {ex.type === 'Feriado' ? 'H' : (ex.type === 'Finde' ? 'F' : 'C')}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCanje(ex.date, ex.shift)}
                                    className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 transition-colors cursor-pointer"
                                    title="Marcar este turno como Canje / Recuperación de Horas para que no compute como Extra"
                                  >
                                    Canje
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 leading-relaxed">
                    <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Regla de Feriados:</span>
                    <p className="text-[11px] text-gray-500 italic mt-0.5">
                      * Planta cierra 22:00 víspera (Cancela Noche anterior).<br/>
                      * Planta retoma 00:00 día siguiente (Noche feriado se trabaja).
                    </p>
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Fechas Feriados:</span>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {stats.breakdown.holidays.map(h => (
                        <span key={h} className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[10px] font-semibold border border-red-100">{h}</span>
                      ))}
                      {stats.breakdown.holidays.length === 0 && <span className="text-gray-450 italic text-xs">Ninguno</span>}
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-display font-bold text-orange-900 text-xs uppercase tracking-wide mb-3">2. Horas Extras</h4>
                <div className="space-y-2 text-sm font-medium">
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 text-gray-600">
                    <span>Fines de Semana:</span>
                    <span className="font-bold text-gray-900">{stats.breakdown.weekendExtraHours?.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) || '0'} hs</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 text-gray-600">
                    <span>Excedentes Plan:</span>
                    <span className="font-bold text-gray-900">{stats.breakdown.weekdayExtraHours?.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) || '0'} hs</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-3 leading-relaxed italic">
                    * Fines de semana: Sábados {'>'} 13hs y Domingos.<br/>
                    * Excedentes: Reportes reales que superan la planificación del día.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-150">
              <h4 className="font-display font-bold text-indigo-900 text-xs uppercase tracking-wide mb-3">Catálogo de Productos Activos ({stats.totalActiveProducts})</h4>
              <div className="max-h-[300px] overflow-y-auto border border-gray-200 rounded-xl bg-gray-50/20 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                  {[...(stats.breakdown.activeProductsList || [])].sort((a, b) => a.name.localeCompare(b.name)).map((prod, i) => {
                    const isProduced = (stats.producedProducts || []).includes(prod.key);
                    return (
                      <div key={i} className="text-[11px] py-1 border-b border-gray-100 flex justify-between items-center group font-medium text-gray-700">
                        <span className={`${isProduced ? 'text-gray-950 font-bold' : 'text-gray-400'} uppercase transition-colors`}>{prod.name}</span>
                        {isProduced ? 
                          <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-semibold border border-green-200">PRODUCIDO</span> :
                          <span className="text-[9px] text-gray-300 font-medium">SIN MOV.</span>
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 bg-blue-50/50 border border-blue-100 p-3 rounded-xl text-[10px] text-blue-800 leading-relaxed italic">
                * La lista considera Marcas, Calibres y Sabores habilitados, cruzados con la disponibilidad de Calibres en las Líneas operativas configuradas.
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-150">
              <h4 className="font-display font-bold text-gray-800 text-xs uppercase tracking-wider mb-3">3. Desglose Diario: Reales (No Extra) vs Planificados</h4>
              <div className="grid grid-cols-4 sm:grid-cols-7 md:grid-cols-10 gap-2">
                {Object.entries(stats.breakdown.dailyPlan).map(([date, planned]) => {
                  const actualMinutes = stats.breakdown.minutesByDay[date] || 0;
                  const actualShifts = actualMinutes / 480; // Standard shift duration for display
                  const plannedCount = Number(planned) || 0;
                  const isExceeded = actualShifts > (plannedCount + 0.1); // Small buffer for rounding
                  return (
                    <div key={date} className={`p-2 rounded-xl border text-center transition-all ${plannedCount === 0 && actualShifts === 0 ? 'bg-gray-50 border-gray-100 opacity-40' : plannedCount === 0 && actualShifts > 0 ? 'bg-orange-50/60 border-orange-200' : isExceeded ? 'bg-blue-50/60 border-blue-200 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                      <span className="block text-[10px] font-bold text-gray-450">{date.split('-')[2]}</span>
                      <div className="flex flex-col mt-0.5">
                        <span className={`text-sm font-display font-bold ${isExceeded ? 'text-blue-600' : 'text-gray-700'}`}>{actualShifts.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                        <div className="w-full h-px bg-gray-100 my-1"></div>
                        <span className="text-[10px] font-semibold text-gray-400">{plannedCount}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-450 mt-3 italic leading-relaxed">
                * Formato: [Turnos Reales (basado en minutos) / Planificados]. Los reales aquí incluyen todos los turnos trabajados en la jornada operativa.
              </p>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

