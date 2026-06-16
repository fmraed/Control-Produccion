import { useState, useEffect, useMemo, Fragment } from 'react';
import { collection, query, where, onSnapshot, getDocs, setDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionReport, MonthlyGoal } from '../types';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addDays, subDays, addMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, Calendar, Search, Edit2, Save, X, RefreshCw, AlertCircle, TrendingUp, Package, ChevronRight, Calculator, Clock, XCircle } from 'lucide-react';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate } from '../utils';

const FLAVOR_PRIORITY: Record<string, number> = {
  'Naranja': 1,
  'Manzana': 2,
  'Lima Limon': 3,
  'Pomelo Blanco': 4,
  'Cola': 5,
  'Granadina': 6,
  'Citrus': 7,
  'Agua': 8,
  'Soda': 9
};

export function GoalFulfillment() {
  const { config, availableBrands, availableSizes, availableFlavors, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [isEditingGoals, setIsEditingGoals] = useState(false);
  const [editedGoals, setEditedGoals] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'details' | 'summary' | 'planning'>('details');

  const isAdmin = auth.currentUser?.email === 'fraed.fordrinks@gmail.com';

  useEffect(() => {
    const [year, month] = selectedMonth.split('-');
    const startDate = new Date(parseInt(year), parseInt(month) - 2, 28);
    const startStr = format(startDate, 'yyyy-MM-dd');
    const endDate = new Date(parseInt(year), parseInt(month), 5);
    const endStr = format(endDate, 'yyyy-MM-dd');

    const qReports = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', startStr),
      where('fecha', '<=', endStr)
    );

    const endMonthForm = format(addMonths(parseISO(`${selectedMonth}-01`), 6), 'yyyy-MM');
    const qGoals = query(
      collection(db, 'monthly_goals'),
      where('month', '>=', selectedMonth),
      where('month', '<', endMonthForm)
    );

    const unsubReports = onSnapshot(qReports, (snap) => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionReport)));
    });

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyGoal)));
      setLoading(false);
    });

    return () => {
      unsubReports();
      unsubGoals();
    };
  }, [selectedMonth]);

  const months = useMemo(() => {
    const current = new Date();
    const list = [];
    for (let i = 0; i < 12; i++) {
      const d = subDays(startOfMonth(current), i * 30);
      list.push(format(d, 'yyyy-MM'));
    }
    return Array.from(new Set(list)).sort().reverse();
  }, []);

  const planningMonths = useMemo(() => {
    const list = [];
    const start = parseISO(`${selectedMonth}-01`);
    for (let i = 0; i < 6; i++) {
      list.push(format(addMonths(start, i), 'yyyy-MM'));
    }
    return list;
  }, [selectedMonth]);

  const filteredReportsByMonth = useMemo(() => {
    return reports.filter(r => {
      if (!shouldShowReport(r)) return false;
      const lDate = getLogicalDate(r);
      return lDate && lDate.startsWith(selectedMonth);
    });
  }, [reports, selectedMonth, shouldShowReport]);

  const activeProducts = useMemo(() => {
    if (!config) return [];
    
    const productMap = new Map<string, { marca: string, sabor: string, tamano: number, key: string }>();
    
    availableBrands.forEach(brand => {
      availableSizes.forEach(size => {
        const sizeStr = size.toString();
        const brandActive = config.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const hasSizeConfig = brandActive && sizeStr in brandActive;

        const allowedFlavors = hasSizeConfig
          ? brandActive[sizeStr]
          : (hasBrandConfig ? [] : (config.brandFlavorCombinations[brand] || []));

        allowedFlavors.forEach(flavor => {
          if (config.enabledFlavors?.[flavor] !== false) {
            const key = `${brand}|${flavor}|${size}`;
            productMap.set(key, {
              marca: brand,
              sabor: flavor,
              tamano: Number(size),
              key
            });
          }
        });
      });
    });

    // We strictly use the configuration to define the active products list.
    // Combinations from reports or goals that are not in the current active configuration
    // will be ignored to respect the "only enabled combinations" requirement.
    
    return Array.from(productMap.values()).sort((a, b) => {
      const isExternalA = (config?.externalProducts?.[a.marca]?.[a.tamano.toString()] || []).includes(a.sabor);
      const isExternalB = (config?.externalProducts?.[b.marca]?.[b.tamano.toString()] || []).includes(b.sabor);
      
      if (isExternalA !== isExternalB) return isExternalA ? 1 : -1;
      if (a.marca !== b.marca) return a.marca.localeCompare(b.marca);
      if (a.tamano !== b.tamano) return b.tamano - a.tamano;
      const priorityA = FLAVOR_PRIORITY[a.sabor] || 999;
      const priorityB = FLAVOR_PRIORITY[b.sabor] || 999;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.sabor.localeCompare(b.sabor);
    });
  }, [config, availableBrands, availableSizes, filteredReportsByMonth, goals, selectedMonth]);

  const dataByProduct = useMemo(() => {
    const productsMap: Record<string, any> = {};
    const today = new Date();
    const isCurrentMonth = selectedMonth === format(today, 'yyyy-MM');
    
    // Days elapsed in month for average calculation
    let daysElapsed = 0;
    if (isCurrentMonth) {
      daysElapsed = today.getDate();
    } else {
      const monthDate = parseISO(`${selectedMonth}-01`);
      daysElapsed = endOfMonth(monthDate).getDate();
    }

    // Pre-calculate averages by size as fallback
    const calibreAverages: Record<number, number> = {};
    const calibreCounts: Record<number, { totalPaquetes: number, totalMinutes: number }> = {};
    
    filteredReportsByMonth.forEach(r => {
      if ((r.paquetes || 0) > 0 && r.tamano && (r.tiempoTurno || 0) > 0) {
        if (!calibreCounts[r.tamano]) calibreCounts[r.tamano] = { totalPaquetes: 0, totalMinutes: 0 };
        calibreCounts[r.tamano].totalPaquetes += r.paquetes || 0;
        calibreCounts[r.tamano].totalMinutes += r.tiempoTurno || 0;
      }
    });
    
    Object.keys(calibreCounts).forEach(size => {
      const s = Number(size);
      const packsPerMin = calibreCounts[s].totalPaquetes / calibreCounts[s].totalMinutes;
      calibreAverages[s] = packsPerMin * 480; // Standard 8h turn
    });

    activeProducts.forEach(p => {
      const productReports = filteredReportsByMonth.filter(r => 
        r.marca === p.marca && r.sabor === p.sabor && r.tamano === p.tamano
      );
      
      const totalProduced = productReports.reduce((sum, r) => sum + (r.paquetes || 0), 0);
      const goal = goals.find(g => g.marca === p.marca && g.sabor === p.sabor && g.tamano === p.tamano && g.month === selectedMonth)?.quantity || 0;
      
      // Prioritize explicit calibre defaults, then line defaults
      const standardShiftGoal = (p.tamano && config?.calibreDefaults?.[p.tamano]) 
        || (config?.schedulerDefaults 
          ? (Object.values(config.schedulerDefaults) as any[]).find(d => d.tamano === p.tamano)?.plannedPacks || 0 
          : 0);

      const actualAvgPacksPerTurn = p.tamano ? (calibreAverages[p.tamano] || 0) : 0;

      const dailyAvg = totalProduced / (daysElapsed || 1);
      const fulfillment = goal > 0 ? (totalProduced / goal) * 100 : 0;
      
      const remaining = Math.max(0, goal - totalProduced);
      
      const turnsNeededGoal = standardShiftGoal > 0 ? remaining / standardShiftGoal : 0;
      const turnsNeededAvg = actualAvgPacksPerTurn > 0 ? remaining / actualAvgPacksPerTurn : 0;

      productsMap[p.key] = {
        ...p,
        totalOrdered: goal,
        totalProduced,
        actualAvgPacksPerTurn,
        standardShiftGoal,
        turnsNeededGoal,
        turnsNeededAvg,
        dailyAvg,
        fulfillment
      };
    });

    return productsMap;
  }, [activeProducts, filteredReportsByMonth, goals, selectedMonth]);

  const { pendingMonthlyShifts, pendingMonthlyLineShifts } = useMemo(() => {
    if (!config || !config.shiftConfig) return { pendingMonthlyShifts: 0, pendingMonthlyLineShifts: 0 };
    
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const currentMonthStr = format(new Date(), 'yyyy-MM');
    
    if (selectedMonth !== currentMonthStr) return { pendingMonthlyShifts: 0, pendingMonthlyLineShifts: 0 };
    
    const startDate = startOfMonth(parseISO(`${selectedMonth}-01`));
    const endDate = endOfMonth(startDate);
    const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });
    
    const shiftConfig = config.shiftConfig;
    let shiftsCount = 0;
    let lineShiftsCount = 0;
    
    daysInMonth.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (dateStr < todayStr) return;
      
      const dayKey = format(day, 'eeee').toLowerCase();
      const isHoliday = shiftConfig.holidays?.includes(dateStr);
      const isNextDayHoliday = shiftConfig.holidays?.includes(format(addDays(day, 1), 'yyyy-MM-dd'));
      
      let dayPlan = shiftConfig.weeklyPlan?.[dayKey] || {};
      if (shiftConfig.previousWeeklyPlan && shiftConfig.changeDate && dateStr < shiftConfig.changeDate) {
        dayPlan = (shiftConfig.previousWeeklyPlan as any)[dayKey] || {};
      }
      
      // Calculate shifts for this day (representing general shifts: Mañana, Tarde, Noche)
      // Mañana/Tarde
      if (!isHoliday) {
        if ((dayPlan['Mañana']?.count || 0) > 0) {
          shiftsCount += 1;
        }
        if ((dayPlan['Tarde']?.count || 0) > 0) {
          shiftsCount += 1;
        }
        
        lineShiftsCount += ((dayPlan['Mañana']?.count || 0) * (dayPlan['Mañana']?.duration || 480)) / 480;
        lineShiftsCount += ((dayPlan['Tarde']?.count || 0) * (dayPlan['Tarde']?.duration || 480)) / 480;
      }
      
      // Noche (affected by next day holiday)
      if (!isNextDayHoliday) {
        const n = dayPlan['Noche'];
        if ((n?.count || 0) > 0) {
          shiftsCount += 1;
        }
      }
      
      const n = dayPlan['Noche'];
      let dur = n?.duration || 480;
      if (isHoliday) {
        const nextDay = addDays(day, 1);
        dur = (getDay(nextDay) === 6 ? 5 : 6) * 60;
      }
      lineShiftsCount += ((n?.count || 0) * dur) / 480;
    });
    
    return { pendingMonthlyShifts: shiftsCount, pendingMonthlyLineShifts: lineShiftsCount };
  }, [selectedMonth, config]);

  const calibreSummary = useMemo(() => {
    const summary: Record<number, { 
      tamano: number, 
      ordered: number, 
      produced: number, 
      turnsNeededGoal: number,
      turnsNeededAvg: number,
      actualAvg: number,
      standardGoal: number
    }> = {};

    Object.values(dataByProduct).forEach((p: any) => {
      const isExternal = (config?.externalProducts?.[p.marca]?.[p.tamano.toString()] || []).includes(p.sabor);
      if (isExternal) return;

      if (!summary[p.tamano]) {
        summary[p.tamano] = { 
          tamano: p.tamano, 
          ordered: 0, 
          produced: 0, 
          turnsNeededGoal: 0,
          turnsNeededAvg: 0,
          actualAvg: p.actualAvgPacksPerTurn,
          standardGoal: p.standardShiftGoal
        };
      }
      summary[p.tamano].ordered += p.totalOrdered;
      summary[p.tamano].produced += p.totalProduced;
      summary[p.tamano].turnsNeededGoal += p.turnsNeededGoal;
      summary[p.tamano].turnsNeededAvg += p.turnsNeededAvg;
    });

    return Object.values(summary).sort((a, b) => b.tamano - a.tamano);
  }, [dataByProduct, config]);

  const groupTotals = useMemo(() => {
    const groups: Record<string, {
      label: string;
      ordered: number;
      produced: number;
      avg: number;
      turnsNeededGoal: number;
      turnsNeededAvg: number;
      products: any[];
    }> = {};
    activeProducts.forEach(p => {
      const groupKey = `${p.marca} ${p.tamano}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          label: `Sub Total ${p.marca} ${p.tamano}`,
          ordered: 0,
          produced: 0,
          avg: 0,
          turnsNeededGoal: 0,
          turnsNeededAvg: 0,
          products: []
        };
      }
      const pData = dataByProduct[p.key];
      groups[groupKey].ordered += pData.totalOrdered;
      groups[groupKey].produced += pData.totalProduced;
      groups[groupKey].avg += pData.dailyAvg;
      groups[groupKey].turnsNeededGoal += pData.turnsNeededGoal;
      groups[groupKey].turnsNeededAvg += pData.turnsNeededAvg;
      groups[groupKey].products.push(pData);
    });
    return groups;
  }, [activeProducts, dataByProduct]);

  const overallStats = useMemo(() => {
    let totalOrdered = 0;
    let totalProduced = 0;
    Object.values(dataByProduct).forEach((p: any) => {
      const isExternal = (config?.externalProducts?.[p.marca]?.[p.tamano.toString()] || []).includes(p.sabor);
      if (!isExternal) {
        totalOrdered += p.totalOrdered;
        totalProduced += p.totalProduced;
      }
    });
    return {
      totalOrdered,
      totalProduced,
      fulfillment: totalOrdered > 0 ? (totalProduced / totalOrdered) * 100 : 0
    };
  }, [dataByProduct, config]);

  const handleStartEditing = () => {
    const initialValues: Record<string, number> = {};
    goals.forEach(g => {
      initialValues[`${g.marca}|${g.sabor}|${g.tamano}|${g.month}`] = g.quantity;
    });
    setEditedGoals(initialValues);
    setIsEditingGoals(true);
  };

  const handleSaveGoals = async () => {
    setIsSaving(true);
    try {
      for (const p of activeProducts) {
        for (const month of planningMonths) {
          const val = editedGoals[`${p.key}|${month}`] || 0;
          const existing = goals.find(g => g.marca === p.marca && g.sabor === p.sabor && g.tamano === p.tamano && g.month === month);
          
          if (existing) {
            if (existing.quantity !== val) {
              await setDoc(doc(db, 'monthly_goals', existing.id!), {
                quantity: val,
                updatedAt: new Date().toISOString()
              }, { merge: true });
            }
          } else if (val > 0) {
            await addDoc(collection(db, 'monthly_goals'), {
              month: month,
              marca: p.marca,
              sabor: p.sabor,
              tamano: p.tamano,
              quantity: val,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
        }
      }
      setIsEditingGoals(false);
    } catch (error) {
      console.error("Error saving goals:", error);
      alert("Error al guardar los objetivos");
    } finally {
      setIsSaving(false);
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
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-100">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight">Cumplimiento de Objetivos</h2>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-0.5">Seguimiento mensual de producción</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl border border-gray-200">
              <Calendar className="w-4 h-4 text-gray-400" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent border-none text-sm font-bold text-gray-700 outline-none focus:ring-0 min-w-[140px]"
              >
                {months.map(m => (
                  <option key={m} value={m}>
                    {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            {isAdmin && !isEditingGoals && (
              <button
                onClick={handleStartEditing}
                className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
              >
                <Edit2 className="w-4 h-4" />
                Establecer Objetivos
              </button>
            )}
            
            {isEditingGoals && (
              <div className="flex gap-2">
                <button
                  onClick={() => setIsEditingGoals(false)}
                  className="flex items-center gap-2 bg-gray-100 text-gray-600 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 transition-all"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </button>
                <button
                  onClick={handleSaveGoals}
                  disabled={isSaving}
                  className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg shadow-green-100 disabled:opacity-50"
                >
                  {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isSaving ? 'Guardando...' : 'Guardar Objetivos'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Stats Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Pedido Mes</span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-gray-900">{overallStats.totalOrdered.toLocaleString('es-AR')}</span>
            <span className="text-xs font-bold text-gray-500 uppercase">Paq</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Producido</span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-blue-600">{overallStats.totalProduced.toLocaleString('es-AR')}</span>
            <span className="text-xs font-bold text-gray-500 uppercase">Paq</span>
          </div>
        </div>
        <div className="bg-blue-600 rounded-2xl p-6 shadow-lg shadow-blue-100 relative overflow-hidden">
          <div className="relative z-10">
            <span className="block text-[10px] font-black text-blue-200 uppercase tracking-widest mb-1">Cumplimiento Objetivo</span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-white">{overallStats.fulfillment.toFixed(1)}%</span>
            </div>
          </div>
          <Calculator className="absolute -right-4 -bottom-4 w-32 h-32 text-white opacity-10" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl max-w-fit">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            activeTab === 'details' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Detalle por Producto
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            activeTab === 'summary' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Resumen por Calibre
        </button>
        <button
          onClick={() => setActiveTab('planning')}
          className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            activeTab === 'planning' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Planificación
        </button>
      </div>

      {activeTab === 'summary' ? (
        /* Summary Table */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">Carga de Trabajo Faltante por Calibre</h3>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mt-1">Total de turnos necesarios para completar los objetivos del mes</p>
            </div>
            {pendingMonthlyShifts > 0 && (
              <div className="bg-blue-600 px-4 py-2 rounded-xl text-white shadow-sm flex items-center gap-4">
                <Clock className="w-5 h-5 text-blue-200" />
                <div className="flex flex-col border-r border-blue-500 pr-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-100">Turnos Restantes</span>
                  <span className="text-xl font-black leading-none">{pendingMonthlyShifts.toFixed(0)} <span className="text-[10px] font-bold uppercase">Turnos</span></span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-100">Líneas Restantes</span>
                  <span className="text-xl font-black leading-none">{pendingMonthlyLineShifts.toFixed(1)} <span className="text-[10px] font-bold uppercase">Turno-Línea</span></span>
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100/80">
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Calibre (cc)</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Total Pedido</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Total Producido</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Objetivo x Turno (Planif.)</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Promedio Real (8h)</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200 bg-blue-50 text-blue-700">Turnos Faltantes (s/ Objetivo)</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest bg-orange-50 text-orange-700">Turnos Faltantes (s/ Promedio)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calibreSummary.map((item: any) => (
                  <tr key={item.tamano} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-5 text-lg font-black text-gray-900 border-r border-gray-100">{item.tamano} cc</td>
                    <td className="px-6 py-5 text-sm font-bold text-gray-600 border-r border-gray-100">{item.ordered.toLocaleString('es-AR')} paq</td>
                    <td className="px-6 py-5 text-sm font-bold text-gray-600 border-r border-gray-100">{item.produced.toLocaleString('es-AR')} paq</td>
                    <td className="px-6 py-5 text-sm font-bold text-gray-500 border-r border-gray-100">
                      {item.standardGoal > 0 ? `${item.standardGoal.toLocaleString('es-AR')} paq` : '–'}
                    </td>
                    <td className="px-6 py-5 text-sm font-bold text-gray-500 border-r border-gray-100">
                      {item.actualAvg.toLocaleString('es-AR', { maximumFractionDigits: 0 })} paq
                    </td>
                    <td className="px-6 py-5 border-r border-gray-100 bg-blue-50/10">
                      <span className={`text-xl font-mono font-black tracking-tight ${item.turnsNeededGoal > 0 ? 'text-blue-600' : 'text-green-600'}`}>
                        {item.turnsNeededGoal > 0 ? item.turnsNeededGoal.toFixed(1) : '–'}
                      </span>
                    </td>
                    <td className="px-6 py-5 bg-orange-50/30">
                      <span className={`text-xl font-mono font-black tracking-tight ${item.turnsNeededAvg > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        {item.turnsNeededAvg > 0 ? item.turnsNeededAvg.toFixed(1) : '–'}
                      </span>
                    </td>
                  </tr>
                ))}
                {calibreSummary.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm font-bold text-gray-400">No hay datos de producción disponibles para este mes</td>
                  </tr>
                )}
              </tbody>
              {calibreSummary.length > 0 && (
                <tfoot className="bg-gray-50 font-black">
                  <tr>
                    <td className="px-6 py-4 text-[10px] uppercase tracking-widest text-gray-500 border-r border-gray-200">TOTALES GENERALES</td>
                    <td className="px-6 py-4 text-sm text-gray-900 border-r border-gray-200">{calibreSummary.reduce((acc, i) => acc + i.ordered, 0).toLocaleString('es-AR')}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 border-r border-gray-200">{calibreSummary.reduce((acc, i) => acc + i.produced, 0).toLocaleString('es-AR')}</td>
                    <td className="px-6 py-4 border-r border-gray-200" colSpan={2}></td>
                    <td className="px-6 py-4 border-r border-gray-200 bg-blue-50/50">
                      <div className="flex flex-col">
                        <span className="text-xl font-mono font-black tracking-tight text-blue-700">{calibreSummary.reduce((acc, i) => acc + i.turnsNeededGoal, 0).toFixed(1)} <span className="text-xs font-sans uppercase">Turnos</span></span>
                        {pendingMonthlyLineShifts > 0 && calibreSummary.reduce((acc, i) => acc + i.turnsNeededGoal, 0) > pendingMonthlyLineShifts && (
                          <span className="text-[9px] text-red-500 flex items-center gap-1 font-bold mt-1">
                            <XCircle className="w-2.5 h-2.5" /> Supera capacidad restante
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 bg-orange-50/50">
                      <div className="flex flex-col">
                        <span className="text-xl font-mono font-black tracking-tight text-orange-700">{calibreSummary.reduce((acc, i) => acc + i.turnsNeededAvg, 0).toFixed(1)} <span className="text-xs font-sans uppercase">Turnos</span></span>
                        {pendingMonthlyLineShifts > 0 && calibreSummary.reduce((acc, i) => acc + i.turnsNeededAvg, 0) > pendingMonthlyLineShifts && (
                          <span className="text-[9px] text-red-500 flex items-center gap-1 font-bold mt-1">
                            <XCircle className="w-2.5 h-2.5" /> Supera capacidad restante
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : activeTab === 'planning' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100/80">
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Producto</th>
                  {planningMonths.map(m => (
                    <th key={m} className="px-6 py-4 text-[10px] font-black text-blue-700 uppercase tracking-widest border-r border-gray-200 text-center">
                      {format(parseISO(`${m}-01`), 'MMM yy', { locale: es }).toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeProducts.map(p => (
                  <tr key={p.key} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4 text-sm font-bold text-gray-900 border-r border-gray-100 whitespace-nowrap">
                      {p.marca} {p.sabor} <span className="text-gray-400 font-mono text-xs">{p.tamano}cc</span>
                    </td>
                    {planningMonths.map(month => {
                      const existingGoal = goals.find(g => g.marca === p.marca && g.sabor === p.sabor && g.tamano === p.tamano && g.month === month)?.quantity || 0;
                      return (
                        <td key={month} className="px-4 py-2 border-r border-gray-100 min-w-[120px] bg-gray-50/30">
                          {isEditingGoals ? (
                            <input
                              type="number"
                              value={editedGoals[`${p.key}|${month}`] || 0}
                              onChange={(e) => setEditedGoals({ ...editedGoals, [`${p.key}|${month}`]: parseInt(e.target.value) || 0 })}
                              className="w-full bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none text-center"
                            />
                          ) : (
                            <div className="text-center text-sm font-bold text-gray-700">
                              {existingGoal > 0 ? existingGoal.toLocaleString('es-AR') : '-'}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Main Table (Details) */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100/80">
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Marca</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Sabor</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Calibre</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200 bg-gray-200/50">Pedido Mes</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Prod Mes</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Salida Diaria</th>
                <th className="px-6 py-4 text-[10px] font-black text-blue-700 uppercase tracking-widest border-r border-gray-200 bg-blue-50/50">Turnos (Planif)</th>
                <th className="px-6 py-4 text-[10px] font-black text-orange-700 uppercase tracking-widest border-r border-gray-200 bg-orange-50/50">Turnos (Real)</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Días Cob.</th>
                <th className="px-6 py-4 text-[10px] font-black text-white uppercase tracking-widest bg-blue-600">% Objetivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(Object.entries(groupTotals) as [string, any][]).map(([groupKey, group]) => (
                <Fragment key={groupKey}>
                  {group.products.map((p: any) => (
                    <tr key={p.key} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-6 py-4 text-sm font-black text-gray-900 border-r border-gray-100 italic">{p.marca}</td>
                      <td className="px-6 py-4 text-sm font-bold text-gray-600 border-r border-gray-100 uppercase">
                        <div className="flex flex-col">
                          <span className="truncate">{p.sabor}</span>
                          {(config?.externalProducts?.[p.marca]?.[p.tamano.toString()] || []).includes(p.sabor) && (
                            <span className="text-[7px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded w-fit font-black mt-0.5 tracking-tighter">EXTERNO</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-mono font-bold text-gray-500 border-r border-gray-100">{p.tamano}</td>
                      <td className="px-6 py-4 border-r border-gray-100 bg-gray-50/50">
                        {isEditingGoals ? (
                          <input
                            type="number"
                            value={editedGoals[`${p.key}|${selectedMonth}`] || 0}
                            onChange={(e) => setEditedGoals({ ...editedGoals, [`${p.key}|${selectedMonth}`]: parseInt(e.target.value) || 0 })}
                            className="w-full bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        ) : (
                          <span className="text-sm font-black text-gray-700">{p.totalOrdered.toLocaleString('es-AR')}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-black text-gray-900 border-r border-gray-100">{p.totalProduced.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-4 text-sm font-black text-gray-600 border-r border-gray-100">{p.dailyAvg.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                      <td className="px-6 py-4 border-r border-gray-100 bg-blue-50/10">
                        <div className="flex flex-col">
                          <span className={`text-xl font-mono font-black tracking-tight ${p.turnsNeededGoal > 0 ? 'text-blue-600' : 'text-green-600'}`}>
                            {p.turnsNeededGoal > 0 ? p.turnsNeededGoal.toFixed(1) : '–'}
                          </span>
                          {p.standardShiftGoal > 0 && (
                            <span className="text-[10px] font-bold text-blue-400 mt-0.5">Usa: {p.standardShiftGoal.toLocaleString('es-AR')} paq/t</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 border-r border-gray-100 bg-orange-50/10">
                        <div className="flex flex-col">
                          <span className={`text-xl font-mono font-black tracking-tight ${p.turnsNeededAvg > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            {p.turnsNeededAvg > 0 ? p.turnsNeededAvg.toFixed(1) : '–'}
                          </span>
                          {p.actualAvgPacksPerTurn > 0 && (
                            <span className="text-[10px] font-bold text-orange-400 mt-0.5">Usa: {p.actualAvgPacksPerTurn.toFixed(0)} paq/t</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-black text-red-500 border-r border-gray-100 bg-red-50/30 text-center">-</td>
                      <td className="px-6 py-4 border-l-4 border-l-blue-600 bg-blue-50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black text-blue-700">{p.fulfillment.toFixed(0)}%</span>
                          <div className="w-16 h-1.5 bg-blue-200 rounded-full overflow-hidden hidden sm:block">
                            <div 
                              className="h-full bg-blue-600 transition-all duration-500" 
                              style={{ width: `${Math.min(100, p.fulfillment)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* Aggregated Row */}
                  <tr className="bg-cyan-500 text-white">
                    <td colSpan={3} className="px-6 py-3 text-xs font-black uppercase tracking-widest italic">{group.label}</td>
                    <td className="px-6 py-3 text-sm font-black border-r border-white/20">{group.ordered.toLocaleString('es-AR')}</td>
                    <td className="px-6 py-3 text-sm font-black border-r border-white/20">{group.produced.toLocaleString('es-AR')}</td>
                    <td className="px-6 py-3 text-sm font-black border-r border-white/20">{group.avg.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                    <td className="px-6 py-3 text-sm font-black border-r border-white/20">{group.turnsNeededGoal > 0 ? group.turnsNeededGoal.toFixed(1) : '–'}</td>
                    <td className="px-6 py-3 text-sm font-black border-r border-white/20">{group.turnsNeededAvg > 0 ? group.turnsNeededAvg.toFixed(1) : '–'}</td>
                    <td className="px-6 py-3 text-sm font-black border-r border-white/20 text-center">-</td>
                    <td className="px-6 py-3 text-sm font-black bg-cyan-600/50">
                      {group.ordered > 0 ? (group.produced / group.ordered * 100).toFixed(0) : 0}%
                    </td>
                  </tr>
                  {/* Divider */}
                  <tr className="h-4 bg-white"><td colSpan={10}></td></tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

      {/* Help info */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-start gap-4">
        <div className="bg-blue-50 p-2 rounded-xl">
          <AlertCircle className="w-5 h-5 text-blue-600" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-black text-gray-900 uppercase tracking-tight">Referencias de Cálculo</h4>
          <div className="text-[11px] text-gray-500 font-medium grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            <p><strong className="text-gray-700">Total Pedido Mes:</strong> Objetivo de ventas o producción seteado manualmente por administración.</p>
            <p><strong className="text-gray-700">Promedio Salida Diaria:</strong> Total Producido / Días transcurridos del mes actual.</p>
            <p><strong className="text-gray-700">Turnos (s/ Planif.):</strong> Proyectado usando el Objetivo por Turno del Planificador.</p>
            <p><strong className="text-gray-700">Turnos (s/ Promedio):</strong> Proyectado usando el Promedio Real por minuto escalado a 480 min (8h).</p>
            <p><strong className="text-gray-700">Promedio Real (8h):</strong> (Paquetes Totales / Minutos Totales del mes) * 480. Refleja la performance real observada para ese calibre.</p>
            <p><strong className="text-gray-700">Días Cobertura:</strong> Placeholder (próximamente integrado con stock real via SQL).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
