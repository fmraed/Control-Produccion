import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, getDoc, addDoc, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionReport, MonthlySnapshot } from '../types';
import { BarChart3, Calendar, Users, Package, Droplets, Info, Edit2, Save, X, UserCircle2, Milk as BottleIcon, Clock, Lock, Unlock, RefreshCw } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';

export function ManagementSummary() {
  const { config, availableBrands, availableSizes, availableLines } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [snapshot, setSnapshot] = useState<MonthlySnapshot | null>(null);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);

  const isAdmin = auth.currentUser?.email === 'fraed.fordrinks@gmail.com';

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
    const q = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      setReports(reportsData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching reports:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const months = useMemo(() => {
    const uniqueMonths = new Set<string>();
    reports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      if (logicalDate) {
        const date = parseISO(logicalDate);
        uniqueMonths.add(format(date, 'yyyy-MM'));
      }
    });
    uniqueMonths.add(format(new Date(), 'yyyy-MM'));
    return Array.from(uniqueMonths).sort().reverse();
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [reports, selectedMonth]);

  const stats = useMemo(() => {
    // If we have a snapshot, use its stats instead of recalculating
    if (snapshot) {
      return snapshot.stats;
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

    // Normalize weeklyPlan if it's in the old format
    // Normalize shiftConfig to ensure all days and shifts exist
    if (shiftConfig.weeklyPlan) {
      const normalizedWeeklyPlan: any = {};
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const daysEs = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      
      days.forEach((day, idx) => {
        const dayEs = daysEs[idx];
        // Try to find the plan in English or Spanish, case-insensitive
        const rawDayPlan = (shiftConfig.weeklyPlan as any)[day] || 
                           (shiftConfig.weeklyPlan as any)[day.charAt(0).toUpperCase() + day.slice(1)] ||
                           (shiftConfig.weeklyPlan as any)[dayEs] ||
                           (shiftConfig.weeklyPlan as any)[dayEs.charAt(0).toUpperCase() + dayEs.slice(1)] ||
                           {};
        
        normalizedWeeklyPlan[day] = {};
        ['Mañana', 'Tarde', 'Noche'].forEach(shift => {
          // Find shift key case-insensitively and without tildes
          const shiftKeys = Object.keys(rawDayPlan);
          const targetKey = shiftKeys.find(k => 
            k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === 
            shift.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          );
          
          const val = targetKey ? rawDayPlan[targetKey] : null;

          if (Array.isArray(rawDayPlan) && rawDayPlan.some(s => s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === shift.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
            normalizedWeeklyPlan[day][shift] = { count: 3, duration: 480 };
          } else if (val && typeof val === 'object') {
            normalizedWeeklyPlan[day][shift] = {
              count: typeof val.count === 'number' ? val.count : 0,
              duration: typeof val.duration === 'number' ? val.duration : 480
            };
          } else {
            normalizedWeeklyPlan[day][shift] = { count: 0, duration: 480 };
          }
        });
      });
      shiftConfig = { ...shiftConfig, weeklyPlan: normalizedWeeklyPlan };
    }

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
    
    daysInMonth.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const nextDayStr = format(addDays(day, 1), 'yyyy-MM-dd');
      
      const isHoliday = shiftConfig.holidays?.includes(dateStr);
      const isNextDayHoliday = shiftConfig.holidays?.includes(nextDayStr);
      
      const dayKey = format(day, 'eeee').toLowerCase();
      const dayPlan = shiftConfig.weeklyPlan[dayKey] || {};
      let plannedMinutes = 0;
      
      // Mañana and Tarde are affected by the current day being a holiday
      if (!isHoliday) {
        const m = dayPlan['Mañana'];
        const t = dayPlan['Tarde'];
        plannedMinutes += (m?.count || 0) * (m?.duration || 480);
        plannedMinutes += (t?.count || 0) * (t?.duration || 480);
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
        plannedMinutes += (n?.count || 0) * dur;
      }
      
      const plannedShifts = plannedMinutes / 480;
      turnosOperativosPlanificados += plannedShifts;
      dailyPlan[dateStr] = plannedShifts;
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

    let totalLiters = 0;
    let totalBottles = 0;
    let totalPacks = 0;
    const producedProducts = new Set<string>();

    filteredReports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      const lDate = parseISO(logicalDate);
      const lDayOfWeek = getDay(lDate);
      const dayKey = format(lDate, 'eeee').toLowerCase();
      
      // Check for weekend overtime based on logical date
      // Sunday is always extra. Saturday is extra after 13:00.
      const timeParts = r.entraTurno?.split(':') || ['0', '0'];
      const hour = parseInt(timeParts[0]);
      
      // For Saturday, we check the calendar hour. 
      // If logical date is Saturday, and it's after 13:00 calendar time, it's extra.
      const isWeekendExtra = (lDayOfWeek === 0) || (lDayOfWeek === 6 && hour >= 13);
      
      // Use specific shift duration for this day/shift if available
      const dayPlan = shiftConfig.weeklyPlan[dayKey] || {};
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

      if (r.marca && r.sabor && r.tamano) {
        producedProducts.add(`${r.marca}|${r.sabor}|${r.tamano}`);
      }
    });

    // Calculate overtime without compensation (per shift/line)
    Object.keys(reportsByDayAndShift).forEach(dayStr => {
      const date = parseISO(dayStr);
      const dayOfWeek = getDay(date);
      const dayKey = format(date, 'eeee').toLowerCase();
      const dayPlan = shiftConfig.weeklyPlan[dayKey] || {};
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

        const totalActualMinutes = reports.reduce((sum, r) => sum + r.duration, 0);
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
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const currentMonthStr = format(new Date(), 'yyyy-MM');
    let pendingPlannedShifts = 0;
    
    if (selectedMonth === currentMonthStr) {
      Object.entries(dailyPlan).forEach(([date, planned]) => {
        if (date >= todayStr) {
          pendingPlannedShifts += Number(planned);
        }
      });
    }

    const avgPacksPerShift = turnosTrabajadosTotal > 0 ? totalPacks / turnosTrabajadosTotal : 0;
    const projectedPendingPacks = pendingPlannedShifts * avgPacksPerShift;
    const projectedTotalPacks = totalPacks + projectedPendingPacks;
    
    const cajasUnitarias = totalLiters / 5.67;
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
          // Use triple combination (Brand + Size) for flavors, fallback to brand-only
          const allowedFlavors = config.activeProducts?.[brand]?.[sizeStr] || config.brandFlavorCombinations[brand] || [];
          
          allowedFlavors.forEach(flavor => {
            // Must be enabled in global flavor list
            if (config.enabledFlavors?.[flavor] !== false) {
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
      projectedPendingPacks,
      projectedTotalPacks,
      cajasUnitarias,
      relacionLitrosBotellas,
      producedProductsCount: producedProducts.size,
      producedProducts: Array.from(producedProducts),
      totalActiveProducts: totalActiveProducts || 1,
      cajasUnitariasFisicasRatio: totalPacks > 0 ? cajasUnitarias / totalPacks : 0,
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
        avgPacksPerShift,
        projectedPendingPacks,
        projectedTotalPacks
      }
    };
  }, [filteredReports, selectedMonth, config, availableBrands, availableSizes, snapshot]);

  // Automatic snapshot saving for past months
  useEffect(() => {
    const currentMonth = format(new Date(), 'yyyy-MM');
    if (selectedMonth < currentMonth && !snapshot && !loading && !isSnapshotLoading && stats && Object.keys(stats).length > 0) {
      const saveSnapshot = async () => {
        try {
          const [year, month] = selectedMonth.split('-');
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
        }
      };
      saveSnapshot();
    }
  }, [selectedMonth, snapshot, stats, loading, isSnapshotLoading, config]);

  const handleRefreshSnapshot = async () => {
    if (!isAdmin) return;
    if (!window.confirm('¿Estás seguro de que quieres recalcular y actualizar el histórico de este mes? Esto sobrescribirá los datos guardados con la configuración actual.')) return;

    try {
      // Temporarily clear snapshot to force recalculation
      const oldSnapshot = snapshot;
      setSnapshot(null);
      
      // Wait for stats to recalculate (it happens on next render)
      setTimeout(async () => {
        if (oldSnapshot?.id) {
          const [year, month] = selectedMonth.split('-');
          const updatedSnapshot: Omit<MonthlySnapshot, 'id'> = {
            month,
            year: parseInt(year),
            stats, // This will be the recalculated stats
            configAtTime: config,
            isClosed: true,
            createdAt: oldSnapshot.createdAt,
            updatedAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'monthly_snapshots', oldSnapshot.id), updatedSnapshot);
          setSnapshot({ id: oldSnapshot.id, ...updatedSnapshot } as MonthlySnapshot);
          alert('Histórico actualizado correctamente.');
        }
      }, 500);
    } catch (error) {
      console.error("Error refreshing snapshot:", error);
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
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-700 font-medium">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold">Resumen Gerencial de Producción</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 min-w-[180px]"
            >
              {months.map(m => (
                <option key={m} value={m}>
                  {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>

          {snapshot && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-100 rounded-lg">
              <Lock className="w-3 h-3 text-green-600" />
              <span className="text-[10px] font-black text-green-700 uppercase tracking-widest">Histórico Cerrado</span>
              {isAdmin && (
                <button 
                  onClick={handleRefreshSnapshot}
                  className="ml-2 p-1 hover:bg-green-100 rounded transition-colors"
                  title="Recalcular y actualizar histórico"
                >
                  <RefreshCw className="w-3 h-3 text-green-600" />
                </button>
              )}
            </div>
          )}
          {!snapshot && selectedMonth < format(new Date(), 'yyyy-MM') && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-100 rounded-lg">
              <Unlock className="w-3 h-3 text-orange-600" />
              <span className="text-[10px] font-black text-orange-700 uppercase tracking-widest">Datos Dinámicos</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column - Turnos */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex gap-6">
            <div className="flex-1 bg-black text-white rounded-2xl overflow-hidden shadow-xl border border-gray-800">
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Capacidad Máxima (Turnos)</span>
                  <span className="text-3xl font-black">{stats.turnosTotales}</span>
                </div>
                <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Turnos Operativos Planificados</span>
                  <span className="text-3xl font-black">{stats.turnosOperativosPlanificados}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Promedio Turnos p/día</span>
                    <Info className="w-3 h-3 text-gray-500" title="Promedio de turnos en un día estándar (Lunes a Jueves)" />
                  </div>
                  <span className="text-3xl font-black">{stats.standardDailyShifts.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center justify-center px-4">
              <UserCircle2 className="w-24 h-24 text-gray-200" />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-gray-700 uppercase text-xs tracking-wider">Turnos Trabajados (Reales)</h3>
              </div>
              <span className="text-xl font-black text-blue-700">{stats.turnosTrabajadosTotal.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="divide-y divide-gray-100">
              <div className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-bold text-gray-600 uppercase tracking-tight">Turnos Línea 1</span>
                <span className="text-lg font-black text-gray-900">{stats.turnosPorLinea['1'].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-bold text-gray-600 uppercase tracking-tight">Turnos Línea 2</span>
                <span className="text-lg font-black text-gray-900">{stats.turnosPorLinea['2'].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-bold text-gray-600 uppercase tracking-tight">Turnos Línea 3</span>
                <span className="text-lg font-black text-gray-900">{stats.turnosPorLinea['3'].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="bg-orange-100 p-2 rounded-lg">
                  <Clock className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <span className="block text-[10px] font-black text-orange-400 uppercase tracking-widest">Horas Extras Totales</span>
                  <span className="text-xs font-bold text-orange-700">Excedentes y fines de semana</span>
                </div>
              </div>
              <span className="text-3xl font-black text-orange-600">{stats.extraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-sm">hs</span></span>
            </div>
            
            <div className="grid grid-cols-3 gap-4 pt-2 border-t border-orange-200/50">
              <div>
                <span className="block text-[9px] font-bold text-orange-400 uppercase tracking-tighter">Feriados</span>
                <span className="text-lg font-black text-orange-700">{stats.holidayExtraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs">hs</span></span>
              </div>
              <div>
                <span className="block text-[9px] font-bold text-orange-400 uppercase tracking-tighter">Fines de Semana</span>
                <span className="text-lg font-black text-orange-700">{stats.weekendExtraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs">hs</span></span>
              </div>
              <div>
                <span className="block text-[9px] font-bold text-orange-400 uppercase tracking-tighter">Excedentes Comunes</span>
                <span className="text-lg font-black text-orange-700">{stats.weekdayExtraHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs">hs</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Producción & Proyección */}
        <div className="lg:col-span-5 space-y-6">
          {/* Monthly Projection */}
          {selectedMonth === format(new Date(), 'yyyy-MM') && (
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-lg border border-blue-500 overflow-hidden text-white">
              <div className="p-4 border-b border-blue-400/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-blue-200" />
                  <h3 className="font-bold uppercase text-xs tracking-wider">Proyección Mensual</h3>
                </div>
                <span className="text-[10px] bg-blue-500/50 px-2 py-0.5 rounded font-bold">ESTIMADO</span>
              </div>
              <div className="p-6 space-y-5">
                <div className="space-y-3 border-b border-blue-400/20 pb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Días Laborales Pendientes:</span>
                    <span className="text-xl font-black">{(stats.pendingPlannedShifts / (stats.standardDailyShifts || 1)).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Turnos-Lineas Laborales Pendientes:</span>
                    <span className="text-xl font-black">{Math.round(stats.pendingPlannedShifts)}</span>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Producción Proyectada PENDIENTE:</span>
                      <span className="text-[9px] text-blue-300 font-bold opacity-80">Promedio {Math.round(stats.avgPacksPerShift)} paq/turno</span>
                    </div>
                    <span className="text-xl font-black text-blue-100">{Math.round(stats.projectedPendingPacks).toLocaleString('es-AR')} <span className="text-xs font-normal">paquetes</span></span>
                  </div>
                  
                  <div className="bg-white/10 p-4 rounded-xl border border-white/20 shadow-inner">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest">Producción Proyectada TOTAL:</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black">{Math.round(stats.projectedTotalPacks).toLocaleString('es-AR')}</span>
                        <span className="text-[10px] font-bold opacity-80 uppercase">Paquetes</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-gray-700 uppercase text-xs tracking-wider">Producción Paquetes</h3>
              </div>
              <span className="text-xl font-black text-indigo-700">{stats.totalPacks.toLocaleString('es-AR')}</span>
            </div>
            <div className="divide-y divide-gray-100">
              <div className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-bold text-gray-600 uppercase tracking-tight">Paq. Línea 1</span>
                <span className="text-lg font-black text-gray-900">{stats.packsPorLinea['1'].toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-bold text-gray-600 uppercase tracking-tight">Paq. Línea 2</span>
                <span className="text-lg font-black text-gray-900">{stats.packsPorLinea['2'].toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-bold text-gray-600 uppercase tracking-tight">Paq. Línea 3</span>
                <span className="text-lg font-black text-gray-900">{stats.packsPorLinea['3'].toLocaleString('es-AR')}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 p-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Droplets className="w-5 h-5 text-cyan-600" />
                  <h3 className="font-bold text-gray-700 uppercase text-xs tracking-wider">Eficiencia Volumen</h3>
                </div>
              </div>
              <div className="p-4 space-y-4">
                <div className="border-b border-gray-100 pb-3">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Cajas Unitarias</span>
                  <span className="text-2xl font-black text-cyan-700">{Math.round(stats.cajasUnitarias).toLocaleString('es-AR')}</span>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Rel. Litros/Bot</span>
                    <span className="text-lg font-black text-gray-800">{stats.relacionLitrosBotellas.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Prod. Activos</span>
                    <span className="text-lg font-black text-gray-800">{stats.producedProductsCount}/{stats.totalActiveProducts}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Unit/Físicas</span>
                    <span className="text-lg font-black text-gray-800">{stats.cajasUnitariasFisicasRatio.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden sm:flex items-end pb-6">
              <BottleIcon className="w-20 h-20 text-gray-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-500 mt-0.5" />
        <div className="text-[10px] text-blue-700 space-y-1 font-medium">
          <p><strong>Turnos Totales:</strong> 3 líneas × 3 turnos × días del mes.</p>
          <p><strong>Turnos Hábiles:</strong> Lunes a Viernes (3 turnos) y Sábado (1 turno mañana) por cada línea.</p>
          <p><strong>Turnos Trabajados:</strong> Minutos de Marcha Bruta / 480 min por turno estándar.</p>
          <p><strong>Cajas Unitarias:</strong> Litros totales producidos / 5.67 (factor estándar).</p>
          <p><strong>Proyección:</strong> Se calcula multiplicando los turnos restantes del mes (según planificación) por el promedio de paquetes por turno del mes actual.</p>
        </div>
      </div>

      {/* Calculation Breakdown for Transparency */}
      <div className="mt-12 border-t border-gray-200 pt-8">
        <details className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden group">
          <summary className="p-4 cursor-pointer hover:bg-gray-100 transition-colors flex items-center justify-between font-bold text-gray-600 text-sm uppercase tracking-wider">
            <span>Detalle Técnico de Cálculos (Revisión)</span>
            <span className="text-xs font-normal normal-case text-gray-400 group-open:hidden">Haga clic para ver el desglose</span>
          </summary>
          <div className="p-6 space-y-6 bg-white border-t border-gray-200">
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-start gap-3 mb-4">
              <Info className="w-4 h-4 text-amber-600 mt-0.5" />
              <div className="text-[10px] text-amber-800 space-y-1">
                <p className="font-bold uppercase">Reglas de Conversión y Jornada:</p>
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
                <h4 className="font-black text-blue-700 text-xs uppercase mb-3">1. Planificación y Feriados</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-gray-500">Días en el mes:</span>
                    <span className="font-bold">{stats.breakdown.daysInMonth}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-gray-500">Feriados detectados:</span>
                    <span className="font-bold">{stats.breakdown.holidays.length}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-gray-500">Duración Noche Feriado:</span>
                    <span className="font-bold text-orange-600">{stats.breakdown.holidayNightDuration} min</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-gray-500 font-bold text-blue-600">Promedio Lun-Jue (Config):</span>
                    <span className="font-black text-blue-600">{stats.breakdown.standardDailyShifts.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                  </div>
                  
                  {/* Debug Extras List */}
                  {stats.breakdown.extraShiftsDebug.length > 0 && (
                    <div className="mt-4">
                      <span className="text-[10px] text-gray-400 font-bold uppercase">Detalle de Excedentes ({stats.breakdown.extraShiftsDebug.length}):</span>
                      <div className="mt-1 max-h-40 overflow-y-auto border border-gray-100 rounded bg-gray-50/50">
                        <table className="min-w-full text-[9px]">
                          <thead className="bg-gray-100 sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-left">Fecha</th>
                              <th className="px-2 py-1 text-left">Turno</th>
                              <th className="px-2 py-1 text-center">Plan (min)</th>
                              <th className="px-2 py-1 text-center">Real (min)</th>
                              <th className="px-2 py-1 text-right">Extra (hs)</th>
                              <th className="px-2 py-1 text-center">Tipo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {stats.breakdown.extraShiftsDebug.map((ex, i) => (
                              <tr key={i} className="hover:bg-white">
                                <td className="px-2 py-1">{format(parseISO(ex.date), 'dd/MM')}</td>
                                <td className="px-2 py-1">{ex.shift}</td>
                                <td className="px-2 py-1 text-center text-gray-400">{ex.planned}</td>
                                <td className="px-2 py-1 text-center text-gray-400">{ex.duration}</td>
                                <td className="px-2 py-1 text-right font-bold">{ex.extra.toFixed(2)}</td>
                                <td className="px-2 py-1 text-center">
                                  <span className={`px-1 rounded ${
                                    ex.type === 'Feriado' ? 'bg-purple-100 text-purple-700' :
                                    ex.type === 'Finde' ? 'bg-orange-100 text-orange-700' : 
                                    'bg-blue-100 text-blue-700'
                                  }`}>
                                    {ex.type === 'Feriado' ? 'H' : (ex.type === 'Finde' ? 'F' : 'C')}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="mt-2">
                    <span className="text-[10px] text-gray-400 font-bold uppercase">Regla de Feriados:</span>
                    <p className="text-[10px] text-gray-600 italic">
                      * Planta cierra 22:00 víspera (Cancela Noche anterior).<br/>
                      * Planta retoma 00:00 día siguiente (Noche feriado se trabaja).
                    </p>
                  </div>
                  <div className="mt-2">
                    <span className="text-[10px] text-gray-400 font-bold uppercase">Fechas Feriados:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stats.breakdown.holidays.map(h => (
                        <span key={h} className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[10px] font-bold border border-red-100">{h}</span>
                      ))}
                      {stats.breakdown.holidays.length === 0 && <span className="text-gray-400 italic text-xs">Ninguno</span>}
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-black text-orange-700 text-xs uppercase mb-3">2. Horas Extras</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-gray-500">Fines de Semana:</span>
                    <span className="font-bold">{stats.breakdown.weekendExtraShifts}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-gray-500">Excedentes Plan:</span>
                    <span className="font-bold">{stats.breakdown.weekdayExtraShifts}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 italic">
                    * Fines de semana: Sábados {'>'} 13hs y Domingos.<br/>
                    * Excedentes: Reportes reales que superan la planificación del día.
                  </p>
                </div>
              </div>
            </div>

              <div className="md:col-span-2">
                <h4 className="font-black text-indigo-700 text-xs uppercase mb-3">Catálogo de Productos Activos ({stats.totalActiveProducts})</h4>
                <div className="max-h-[400px] overflow-y-auto border border-gray-100 rounded bg-gray-50/30 p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                    {[...(stats.breakdown.activeProductsList || [])].sort((a, b) => a.name.localeCompare(b.name)).map((prod, i) => {
                      const isProduced = (stats.producedProducts || []).includes(prod.key);
                      return (
                        <div key={i} className="text-[10px] py-1 border-b border-gray-100/50 flex justify-between items-center group">
                          <span className={`${isProduced ? 'text-gray-900 font-bold' : 'text-gray-500'} uppercase transition-colors`}>{prod.name}</span>
                          {isProduced ? 
                            <span className="text-[8px] bg-green-100 text-green-700 px-1 rounded font-black">PRODUCIDO</span> :
                            <span className="text-[8px] text-gray-300 font-medium">SIN MOV.</span>
                          }
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 bg-blue-50 border border-blue-100 p-3 rounded-lg text-[9px] text-blue-700 italic">
                  * La lista considera Marcas, Calibres y Sabores habilitados, cruzados con la disponibilidad de Calibres en las Líneas operativas configuradas.
                </div>
              </div>

            <div className="mt-6">
              <h4 className="font-black text-gray-700 text-xs uppercase mb-3">3. Desglose Diario: Reales (No Extra) vs Planificados</h4>
              <div className="grid grid-cols-4 sm:grid-cols-7 md:grid-cols-10 gap-2">
                {Object.entries(stats.breakdown.dailyPlan).map(([date, planned]) => {
                  const actualMinutes = stats.breakdown.minutesByDay[date] || 0;
                  const actualShifts = actualMinutes / 480; // Standard shift duration for display
                  const plannedCount = Number(planned) || 0;
                  const isExceeded = actualShifts > (plannedCount + 0.1); // Small buffer for rounding
                  return (
                    <div key={date} className={`p-2 rounded border text-center ${plannedCount === 0 && actualShifts === 0 ? 'bg-gray-50 border-gray-100 opacity-50' : plannedCount === 0 && actualShifts > 0 ? 'bg-orange-50 border-orange-200' : isExceeded ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                      <span className="block text-[9px] font-bold text-gray-400">{date.split('-')[2]}</span>
                      <div className="flex flex-col">
                        <span className={`text-sm font-black ${isExceeded ? 'text-blue-600' : 'text-gray-700'}`}>{actualShifts.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 3 })}</span>
                        <div className="w-full h-px bg-gray-100 my-1"></div>
                        <span className="text-[10px] font-bold text-gray-400">{plannedCount}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] text-gray-400 mt-3 italic">
                * Formato: [Turnos Reales (basado en minutos) / Planificados]. Los reales aquí incluyen todos los turnos trabajados en la jornada operativa.
              </p>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

