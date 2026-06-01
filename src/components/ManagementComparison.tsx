import { useState, useMemo, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig } from '../hooks/useAppConfig';
import { ArrowUp, ArrowDown, Activity, Droplets, Target, Wind, Factory, Clock } from 'lucide-react';
import { ProductionReport, ElaboracionReport } from '../types';
import { format, parseISO, getDay, addDays } from 'date-fns';
import { getLogicalDate } from '../utils';

interface MetricComparison {
  label: string;
  previous: number;
  current: number;
  unit: string;
  format?: 'number' | 'percent' | 'float';
  inverse?: boolean; // If true, lower is better
  hideDiff?: boolean;
}

export function ManagementComparison() {
  const { config, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [elaboraciones, setElaboraciones] = useState<ElaboracionReport[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [previousStartDate, setPreviousStartDate] = useState<string>('');
  const [currentEndDate, setCurrentEndDate] = useState<string>('');
  const [hasInitializedDates, setHasInitializedDates] = useState(false);

  // Acceso a la fecha de cambio de gestión
  const managementStartDate = config?.managementSettings?.managementStartDate || null;

  // Cargar valores iniciales desde la configuración remota una vez que esté cargada
  useEffect(() => {
    if (config && !hasInitializedDates) {
      if (config.managementSettings?.previousStartDate) {
        setPreviousStartDate(config.managementSettings.previousStartDate);
      }
      if (config.managementSettings?.currentEndDate) {
        setCurrentEndDate(config.managementSettings.currentEndDate);
      }
      setHasInitializedDates(true);
    }
  }, [config, hasInitializedDates]);

  const handleSavePreviousStartDate = async (date: string) => {
    setPreviousStartDate(date);
    try {
      const configRef = doc(db, 'config', 'production');
      await updateDoc(configRef, {
        'managementSettings.previousStartDate': date
      });
    } catch (err) {
      console.error("Error saving previousStartDate via updateDoc, trying setDoc fallback: ", err);
      try {
        const configRef = doc(db, 'config', 'production');
        await setDoc(configRef, {
          managementSettings: {
            previousStartDate: date
          }
        }, { merge: true });
      } catch (innerErr) {
        console.error("Fallback setDoc also failed: ", innerErr);
      }
    }
  };

  const handleSaveCurrentEndDate = async (date: string) => {
    setCurrentEndDate(date);
    try {
      const configRef = doc(db, 'config', 'production');
      await updateDoc(configRef, {
        'managementSettings.currentEndDate': date
      });
    } catch (err) {
      console.error("Error saving currentEndDate via updateDoc, trying setDoc fallback: ", err);
      try {
        const configRef = doc(db, 'config', 'production');
        await setDoc(configRef, {
          managementSettings: {
            currentEndDate: date
          }
        }, { merge: true });
      } catch (innerErr) {
        console.error("Fallback setDoc also failed: ", innerErr);
      }
    }
  };

  useEffect(() => {
    const q1 = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    const q2 = query(collection(db, 'elaboracion_reports'), orderBy('fecha', 'desc'));
    const q3 = query(collection(db, 'monthly_snapshots'));
    
    let loaded1 = false;
    let loaded2 = false;
    let loaded3 = false;

    const checkFinished = () => {
      if (loaded1 && loaded2 && loaded3) setLoading(false);
    };

    const unsub1 = onSnapshot(q1, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ProductionReport[];
      setReports(data);
      loaded1 = true;
      checkFinished();
    });

    const unsub2 = onSnapshot(q2, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ElaboracionReport[];
      setElaboraciones(data);
      loaded2 = true;
      checkFinished();
    });

    const unsub3 = onSnapshot(q3, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSnapshots(data);
      loaded3 = true;
      checkFinished();
    });

    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const { previousReports, currentReports, previousElab, currentElab } = useMemo(() => {
    if (!managementStartDate) return { previousReports: [], currentReports: [], previousElab: [], currentElab: [] };

    const validReports = reports.filter(r => shouldShowReport(r, true));
    
    return {
      previousReports: validReports.filter(r => {
        const logDate = getLogicalDate(r) || r.fecha;
        return logDate < managementStartDate && (!previousStartDate || logDate >= previousStartDate);
      }),
      currentReports: validReports.filter(r => {
        const logDate = getLogicalDate(r) || r.fecha;
        return logDate >= managementStartDate && (!currentEndDate || logDate <= currentEndDate);
      }),
      previousElab: elaboraciones.filter(r => {
        const logDate = getLogicalDate(r) || r.fecha;
        return logDate < managementStartDate && (!previousStartDate || logDate >= previousStartDate);
      }),
      currentElab: elaboraciones.filter(r => {
        const logDate = getLogicalDate(r) || r.fecha;
        return logDate >= managementStartDate && (!currentEndDate || logDate <= currentEndDate);
      })
    };
  }, [reports, elaboraciones, managementStartDate, previousStartDate, currentEndDate, shouldShowReport]);

  const calculateMetrics = (datasetRaw: ProductionReport[], elabDataset: ElaboracionReport[]) => {
    if (datasetRaw.length === 0) return null;

    let packs = 0;
    let botellas = 0;
    
    let totalBruta = 0;
    let totalNeta = 0;
    let totalParadasMec = 0;
    let totalParadasAjenas = 0;
    
    // Line/Calibre metrics
    const typeMetrics: Record<string, { count: number; effAcum: number }> = {};
    
    // Waste
    let desperdicioTapas = 0;
    
    // CO2 and Jarabe logic
    let co2Real = 0;
    let co2Teorico = 0;
    let jarabeReal = 0;
    let jarabeTeorico = 0;

    // Normalización de la planificación de turnos (shiftConfig) para el cálculo de horas extras
    const normalizePlan = (rawPlan: any) => {
      if (!rawPlan) return null;
      const normalizedMap: any = {};
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const daysEs = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      
      days.forEach((day, idx) => {
        const dayEs = daysEs[idx];
        const rawDayPlan = rawPlan[day] || 
                           rawPlan[day.charAt(0).toUpperCase() + day.slice(1)] ||
                           rawPlan[dayEs] ||
                           rawPlan[dayEs.charAt(0).toUpperCase() + dayEs.slice(1)] ||
                           {};
        
        normalizedMap[day] = {};
        ['Mañana', 'Tarde', 'Noche'].forEach(shift => {
          const shiftKeys = Object.keys(rawDayPlan);
          const targetKey = shiftKeys.find(k => 
            k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === 
            shift.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          );
          
          const val = targetKey ? rawDayPlan[targetKey] : null;

          if (Array.isArray(rawDayPlan) && rawDayPlan.some(s => s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === shift.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
            normalizedMap[day][shift] = { count: 3, duration: 480 };
          } else if (val && typeof val === 'object') {
            normalizedMap[day][shift] = {
              count: typeof val.count === 'number' ? val.count : 0,
              duration: typeof val.duration === 'number' ? val.duration : 480
            };
          } else {
            normalizedMap[day][shift] = { count: 0, duration: 480 };
          }
        });
      });
      return normalizedMap;
    };

    const getShiftConfigForDate = (dateStr: string) => {
      const [yearStr, monthStr] = dateStr.split('-');
      const year = parseInt(yearStr);
      const month = monthStr;
      const snapshot = snapshots.find(s => s.year === year && s.month === month);
      return (snapshot && snapshot.configAtTime?.shiftConfig) ? snapshot.configAtTime.shiftConfig : config?.shiftConfig;
    };

    const getDayPlanForDate = (dateStr: string, dayKey: string) => {
      const rawCfg = getShiftConfigForDate(dateStr);
      const normWeeklyPlan = normalizePlan(rawCfg?.weeklyPlan) || rawCfg?.weeklyPlan || {};
      const normPrevWeeklyPlan = rawCfg?.previousWeeklyPlan ? normalizePlan(rawCfg.previousWeeklyPlan) : null;
      const changeDate = rawCfg?.changeDate || '';

      if (normPrevWeeklyPlan && changeDate && dateStr < changeDate) {
        return normPrevWeeklyPlan[dayKey] || {};
      }
      return normWeeklyPlan[dayKey] || {};
    };

    const isDateHoliday = (dateStr: string) => {
      const rawCfg = getShiftConfigForDate(dateStr);
      return rawCfg?.holidays?.includes(dateStr) || false;
    };

    let holidayExtraHours = 0;
    let weekendExtraHours = 0;
    let weekdayExtraHours = 0;
    const reportsByDayAndShift: Record<string, Record<string, any[]>> = {};

    datasetRaw.forEach(r => {
      packs += Number(r.paquetes) || 0;
      botellas += Number(r.botellas) || 0;

      // Group/Overtime logic preparation & shift duration calculations
      const logicalDate = getLogicalDate(r);
      const entraParts = r.entraTurno?.split(':') || ['0', '0'];
      const saleParts = r.saleTurno?.split(':') || ['0', '0'];
      const start = parseInt(entraParts[0]) * 60 + parseInt(entraParts[1]);
      let end = parseInt(saleParts[0]) * 60 + parseInt(saleParts[1]);
      if (end < start) end += 1440; // Next day
      const duration = end - start;

      // Real or calculated duration in minutes
      let bruta = Number(r.tiempoTurno) || 0;
      if (bruta === 0 && r.entraTurno && r.saleTurno) {
        bruta = duration;
      }
      if (bruta === 0) {
        bruta = config?.shiftConfig?.standardShiftDuration || 480;
      }

      const neta = (r.botellas && r.velocidad) ? (r.botellas / r.velocidad) : 0;
      
      let paradaMec = 0;
      let paradasAjenas = 0;
      if (r.downtimes) {
        r.downtimes.forEach(dt => {
          const isExcluded = config?.efficiencyExcludedDowntimes?.some(excluded =>
            (dt.category?.toLowerCase() || '') === excluded.toLowerCase() ||
            (dt.reason?.toLowerCase() || '') === excluded.toLowerCase()
          );
          
          if (isExcluded) {
            paradasAjenas += (dt.totalMinutes || 0);
            return;
          }

          const mins = dt.totalMinutes || 0;
          if (dt.category === 'PARADAS DE LINEA' || dt.category === 'Paradas de Línea' || dt.category === 'Mecánica' || (dt.category === 'PARADAS LINEA')) {
            paradaMec += mins;
          }
        });
      }

      totalBruta += bruta;
      const brutaCalculo = Math.max(0, bruta - paradasAjenas);
      totalParadasAjenas += paradasAjenas;
      
      totalNeta += neta;
      totalParadasMec += paradaMec;
      desperdicioTapas += Number(r.desperdicioTapas) || 0;

      // Group EFF by Line-Calibre
      if (r.linea && r.tamano) {
        const key = `Línea ${r.linea} - ${r.tamano}ml`;
        const effOperativa = Math.min((brutaCalculo > 0 ? (neta / brutaCalculo) * 100 : 0), 100);
        
        if (!typeMetrics[key]) typeMetrics[key] = { count: 0, effAcum: 0 };
        typeMetrics[key].count += 1;
        typeMetrics[key].effAcum += effOperativa;
      }

      // En la planilla de producción ya vienen el jarabe y co2 calculados
      co2Teorico += r.co2 || 0;
      jarabeTeorico += r.jarabeConsumido || 0;

      if (!reportsByDayAndShift[logicalDate]) reportsByDayAndShift[logicalDate] = {};
      if (!reportsByDayAndShift[logicalDate][r.turno]) reportsByDayAndShift[logicalDate][r.turno] = [];
      reportsByDayAndShift[logicalDate][r.turno].push({ ...r, duration });
    });

    elabDataset.forEach(e => {
      // Sum real consumption
      co2Real += Number(e.co2Consumido) || 0;
      jarabeReal += Number(e.jarabeConsumido) || 0;
    });

    const shiftCount = datasetRaw.length;
    
    // Total Bruta Excluyendo Ajenas
    const totalBrutaCalculo = Math.max(0, totalBruta - totalParadasAjenas);

    // Operativa = Marcha Neta / (Bruta - Ajenas) * 100
    const efOperativa = totalBrutaCalculo > 0 ? (totalNeta / totalBrutaCalculo) * 100 : 0;
    
    // Mecánica = ((Marcha Bruta - Parada Mecánica - Ajenas) / (Marcha Bruta - Ajenas)) * 100
    const efMecanica = totalBrutaCalculo > 0 ? ((totalBruta - totalParadasMec - totalParadasAjenas) / totalBrutaCalculo) * 100 : 0;
    
    const lineEfficiencies = Object.entries(typeMetrics)
      .map(([key, val]) => ({ key, eff: val.effAcum / val.count }))
      .sort((a, b) => b.eff - a.eff)
      .slice(0, 5); // top 5 lines/sizes

    // Calcular las Horas de Producción (basado en tiempoTurno total reportado)
    const totalProductionHours = totalBruta / 60;

    // Calcular Horas Extras de todas las planificaciones/reportes procesados del dataset
    Object.keys(reportsByDayAndShift).forEach(dayStr => {
      const date = parseISO(dayStr);
      const dayOfWeek = getDay(date);
      const dayKey = format(date, 'eeee').toLowerCase();
      const dayPlan = getDayPlanForDate(dayStr, dayKey);
      const isHoliday = isDateHoliday(dayStr);
      const nextDayStr = format(addDays(date, 1), 'yyyy-MM-dd');
      const isNextDayHoliday = isDateHoliday(nextDayStr);

      Object.keys(reportsByDayAndShift[dayStr]).forEach(shift => {
        const reports = reportsByDayAndShift[dayStr][shift];
        const p = (dayPlan as any)[shift];
        
        // Determinar cantidad y duración planificadas
        let plannedCount = p?.count || 0;
        let plannedDuration = p?.duration || 480;
        
        // Ajustes por feriado
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
          
          // Regla fin de semana: Dom o Sáb después de las 13:00 hs
          const isWeekendExtra = (dayOfWeek === 0) || (dayOfWeek === 6 && (hour >= 13 || hour < 5));
          
          // Regla feriado
          const isHolidayExtra = (isHoliday && (shift === 'Mañana' || shift === 'Tarde')) ||
                                 (isNextDayHoliday && shift === 'Noche') ||
                                 (isHoliday && shift === 'Noche');

          const extraVal = extraMinutes / 60; // HORAS
          
          if (isHolidayExtra) holidayExtraHours += extraVal;
          else if (isWeekendExtra) weekendExtraHours += extraVal;
          else weekdayExtraHours += extraVal;
        }
      });
    });

    const totalExtraHours = holidayExtraHours + weekendExtraHours + weekdayExtraHours;

    return {
      packsPerShift: shiftCount > 0 ? packs / shiftCount : 0,
      totalPacks: packs,
      totalBotellas: botellas,
      efOperativa,
      efMecanica,
      lineEfficiencies,
      desperdicioTapas,
      scarcityCO2: co2Teorico > 0 && co2Real > 0 ? ((co2Real - co2Teorico) / co2Teorico) * 100 : 0,
      scarcityJarabe: jarabeTeorico > 0 && jarabeReal > 0 ? ((jarabeReal - jarabeTeorico) / jarabeTeorico) * 100 : 0,
      shiftCount,
      totalProductionHours,
      totalExtraHours
    };
  };

  const currentStats = useMemo(() => calculateMetrics(currentReports, currentElab), [currentReports, currentElab, snapshots, config]);
  const previousStats = useMemo(() => calculateMetrics(previousReports, previousElab), [previousReports, previousElab, snapshots, config]);

  if (!managementStartDate) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-gray-200">
        <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-700 mb-2">Comparación de Gestión no configurada</h2>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">
          Para ver esta comparación, debes definir la "Fecha de Inicio de Gestión Actual" en el Panel de Configuración {' > '} Corte de Gestión.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando datos...</div>;
  }

  const formatValue = (val: number, format: 'number' | 'percent' | 'float') => {
    if (format === 'percent') return `${val.toFixed(1)}%`;
    if (format === 'float') return val.toFixed(2);
    return Math.round(val).toLocaleString('es-AR');
  };

  const MetricRow = ({ comparison, highlight }: { comparison: MetricComparison, highlight?: boolean, key?: string | number }) => {
    const { label, previous, current, unit, format = 'number', inverse, hideDiff } = comparison;
    
    const diff = current - previous;
    const percentDiff = previous !== 0 ? (diff / Math.abs(previous)) * 100 : 0;
    
    let colorClass = 'text-gray-500';
    let bgClass = 'bg-gray-100';
    let Icon = ArrowUp; // Placeholder
    
    if (diff !== 0) {
      const isPositiveChange = diff > 0;
      const isGood = inverse ? !isPositiveChange : isPositiveChange;
      colorClass = isGood ? 'text-green-600' : 'text-red-600';
      bgClass = isGood ? 'bg-green-100' : 'bg-red-100';
      Icon = isPositiveChange ? ArrowUp : ArrowDown;
    }

    return (
      <div className={`grid grid-cols-4 items-center p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors last:border-0 ${highlight ? 'bg-blue-50/20' : ''}`}>
        <div className="col-span-1 text-sm font-semibold text-gray-700">
          {label}
        </div>
        <div className="text-center font-medium text-gray-600">
          {formatValue(previous, format)} <span className="text-[10px] text-gray-400 font-normal">{unit}</span>
        </div>
        <div className="text-center font-bold text-blue-900 bg-blue-50/50 py-2 rounded-lg border border-blue-50">
          {formatValue(current, format)} <span className="text-[10px] text-blue-400 font-normal">{unit}</span>
        </div>
        <div className="flex flex-col items-center justify-center">
          {hideDiff ? (
            <span className="text-gray-400 text-xs">-</span>
          ) : previous !== 0 ? (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${bgClass} ${colorClass} font-bold text-sm shadow-sm`}>
              <Icon className="w-4 h-4" />
              {Math.abs(percentDiff).toFixed(1)}%
            </div>
          ) : (
            <span className="text-gray-400 text-xs">-</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Comparativa de Gestión</h1>
          <p className="text-sm text-gray-500">Gestión Anterior vs Gestión Actual configurada en {managementStartDate.split('-').reverse().join('/')}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-200 p-4">
          <div className="text-left font-black text-gray-500 text-xs uppercase tracking-widest pl-2">Métrica de Performance</div>
          <div className="text-center font-black text-gray-500 text-xs uppercase tracking-widest flex flex-col items-center justify-center">
            Gestión Anterior<br/>
            <span className="font-normal text-[10px] text-gray-400 mb-1">({previousStats?.shiftCount || 0} turnos)</span>
            <input
              type="date"
              value={previousStartDate}
              onChange={(e) => handleSavePreviousStartDate(e.target.value)}
              max={managementStartDate}
              className="mt-1 text-xs px-2 py-1 border border-gray-300 rounded font-normal bg-white"
              title="Desde esta fecha"
            />
          </div>
          <div className="text-center font-black text-blue-600 text-xs uppercase tracking-widest flex flex-col items-center justify-center">
            Gestión Actual<br/>
            <span className="font-normal text-[10px] text-blue-400 mb-1">({currentStats?.shiftCount || 0} turnos)</span>
            <input
              type="date"
              value={currentEndDate}
              onChange={(e) => handleSaveCurrentEndDate(e.target.value)}
              min={managementStartDate}
              className="mt-1 text-xs px-2 py-1 border border-blue-200 rounded font-normal bg-blue-50 text-blue-800"
              title="Hasta esta fecha"
            />
          </div>
          <div className="text-center font-black text-gray-500 text-xs uppercase tracking-widest">Diferencia Relativa</div>
        </div>

        {/* Content */}
        {currentStats && previousStats ? (
          <div>
            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-4 h-4" /> Producción General
            </div>
            <MetricRow comparison={{ label: "Packs Totales Producidos", previous: previousStats.totalPacks, current: currentStats.totalPacks, unit: "packs", hideDiff: true }} />
            <MetricRow comparison={{ label: "Productividad Promedio", previous: previousStats.packsPerShift, current: currentStats.packsPerShift, unit: "packs/turno", format: "float" }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Clock className="w-4 h-4" /> Horas y Jornadas de Trabajo
            </div>
            <MetricRow comparison={{ label: "Horas de Producción", previous: previousStats.totalProductionHours, current: currentStats.totalProductionHours, unit: "hs", format: "float" }} />
            <MetricRow comparison={{ label: "Horas Extras Empleadas", previous: previousStats.totalExtraHours, current: currentStats.totalExtraHours, unit: "hs", format: "float", inverse: true }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Target className="w-4 h-4" /> Desempeño y Eficiencia Principal
            </div>
            <MetricRow comparison={{ label: "Eficiencia Operativa (OEE)", previous: previousStats.efOperativa, current: currentStats.efOperativa, unit: "%", format: "percent" }} />
            <MetricRow comparison={{ label: "Eficiencia Mecánica", previous: previousStats.efMecanica, current: currentStats.efMecanica, unit: "%", format: "percent" }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Droplets className="w-4 h-4" /> Mermas y Desperdicios Clave (Insumos)
            </div>
            <MetricRow comparison={{ label: "Desviación Jarabe (Real vs Teórico)", previous: previousStats.scarcityJarabe, current: currentStats.scarcityJarabe, unit: "%", format: "percent", inverse: true }} highlight={true} />
            <MetricRow comparison={{ label: "Desviación CO2", previous: previousStats.scarcityCO2, current: currentStats.scarcityCO2, unit: "%", format: "percent", inverse: true }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Factory className="w-4 h-4" /> Desglose: Eficiencia Operativa por Tipo (Línea + Calibre)
            </div>
            {currentStats.lineEfficiencies.map((eff, i) => {
              const previousEff = previousStats.lineEfficiencies.find(e => e.key === eff.key);
              return (
                <MetricRow key={eff.key} comparison={{ 
                  label: eff.key, 
                  previous: previousEff?.eff || 0, 
                  current: eff.eff, 
                  unit: "%", 
                  format: "percent" 
                }} />
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">No hay suficientes datos procesados.</div>
        )}
      </div>
    </div>
  );
}

