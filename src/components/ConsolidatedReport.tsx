import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { FileText, Calendar, Filter, BarChart3, ChevronDown, ChevronUp, Clock, ArrowRight } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, subDays, addDays, isValid, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { SABORES, TAMANOS } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate, getHistoricalMonths } from '../utils';

export type ConsolidatedPeriodMode = 'range' | 'month' | 'year' | 'all';

export function ConsolidatedReport() {
  const { config, getFilteredFlavors, getFilteredSizes, availableBrands, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Period mode and dates
  const [periodMode, setPeriodMode] = useState<ConsolidatedPeriodMode>('range');
  const [startDate, setStartDate] = useState<string>(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedMonth, setSelectedMonth] = useState<string>(() => format(new Date(), 'yyyy-MM'));
  const [selectedYear, setSelectedYear] = useState<string>(() => format(new Date(), 'yyyy'));
  const [selectedGestion, setSelectedGestion] = useState<'all' | 'current' | 'previous'>('all');

  // Acceder a la config de gestión
  const managementStartDate = config?.managementSettings?.managementStartDate || null;

  useEffect(() => {
    let q;
    
    if (periodMode === 'all') {
      q = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    } else if (periodMode === 'range') {
      try {
        const s = parseISO(startDate);
        const e = parseISO(endDate);
        const minDate = isValid(s) && isValid(e) ? (s <= e ? s : e) : new Date();
        const maxDate = isValid(s) && isValid(e) ? (s <= e ? e : s) : new Date();
        // Shift 'Noche' offset buffer: 1 day before minDate and 2 days after maxDate
        const startStr = format(subDays(minDate, 1), 'yyyy-MM-dd');
        const endStr = format(addDays(maxDate, 2), 'yyyy-MM-dd');

        q = query(
          collection(db, 'production_reports'),
          where('fecha', '>=', startStr),
          where('fecha', '<=', endStr),
          orderBy('fecha', 'desc')
        );
      } catch (err) {
        console.error("Error setting up range query:", err);
        q = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
      }
    } else if (periodMode === 'year') {
      const year = parseInt(selectedYear, 10);
      const startD = new Date(year - 1, 11, 28); // Dec 28 prev year
      const startStr = format(startD, 'yyyy-MM-dd');
      const endD = new Date(year + 1, 0, 5); // Jan 5 next year
      const endStr = format(endD, 'yyyy-MM-dd');
      
      q = query(
        collection(db, 'production_reports'), 
        where('fecha', '>=', startStr),
        where('fecha', '<=', endStr),
        orderBy('fecha', 'desc')
      );
    } else {
      // 'month'
      const [year, month] = selectedMonth.split('-');
      const startD = new Date(parseInt(year), parseInt(month) - 2, 28);
      const startStr = format(startD, 'yyyy-MM-dd');
      const endD = new Date(parseInt(year), parseInt(month), 5);
      const endStr = format(endD, 'yyyy-MM-dd');
      
      q = query(
        collection(db, 'production_reports'), 
        where('fecha', '>=', startStr),
        where('fecha', '<=', endStr),
        orderBy('fecha', 'desc')
      );
    }
    
    setLoading(true);
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
  }, [periodMode, startDate, endDate, selectedMonth, selectedYear]);

  const years = useMemo(() => {
    const historicalMonths = getHistoricalMonths();
    const uniqueYears = new Set(historicalMonths.map(m => m.split('-')[0]));
    return Array.from(uniqueYears).sort().reverse();
  }, []);

  const months = useMemo(() => {
    return getHistoricalMonths();
  }, []);

  const filteredReports = useMemo(() => {
    let result = reports.filter(r => shouldShowReport(r));
    
    // Management Cutoff Filter
    if (selectedGestion !== 'all' && managementStartDate) {
      result = result.filter(r => {
        if (selectedGestion === 'current' && r.fecha < managementStartDate) return false;
        if (selectedGestion === 'previous' && r.fecha >= managementStartDate) return false;
        return true;
      });
    }

    if (periodMode === 'all') return result;

    if (periodMode === 'range') {
      const minDateStr = startDate <= endDate ? startDate : endDate;
      const maxDateStr = startDate <= endDate ? endDate : startDate;
      return result.filter(r => {
        const logicalDate = getLogicalDate(r);
        if (!logicalDate) return false;
        return logicalDate >= minDateStr && logicalDate <= maxDateStr;
      });
    }
    
    if (periodMode === 'year') {
      return result.filter(r => {
        const logicalDate = getLogicalDate(r);
        return logicalDate && logicalDate.startsWith(selectedYear);
      });
    }

    return result.filter(r => {
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [reports, periodMode, startDate, endDate, selectedMonth, selectedYear, selectedGestion, managementStartDate, shouldShowReport]);

  // Consolidated data structure
  // { [marca|sabor]: { [tamano]: { packs: number, extraBot: number } } }
  const consolidatedData = useMemo(() => {
    const data: Record<string, Record<number, { packs: number, extraBot: number }>> = {};
    const totalsBySize: Record<number, number> = {};
    let grandTotalPacks = 0;
    let grandTotalExtraBot = 0;
    const uniqueCombinations = new Set<string>();
    const sizesWithData = new Set<number>();

    const enabledSizes = getFilteredSizes();
    const enabledBrands = availableBrands;

    // 1. Collect sizes and combinations from reports in the selected month
    filteredReports.forEach(report => {
      const tamano = Number(report.tamano);
      const botellas = Number(report.botellas || 0);
      
      if (!isNaN(tamano) && botellas > 0) {
        sizesWithData.add(tamano);
      }
      
      if (report.marca && report.sabor && botellas > 0) {
        uniqueCombinations.add(`${report.marca}|${report.sabor}`);
      }
    });

    // 2. Add enabled (active) items
    // Sizes and Combinations filtered by local production
    enabledBrands.forEach(marca => {
      const brandActive = config?.activeProducts?.[marca];
      const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
      const brandCombos = config?.brandFlavorCombinations?.[marca] || [];

      enabledSizes.forEach(size => {
        const sizeStr = size.toString();
        const hasSizeConfig = brandActive && sizeStr in brandActive;
        const flavors = hasSizeConfig ? (brandActive as any)[sizeStr] : (hasBrandConfig ? [] : brandCombos);
        
        const externalForSize = config?.externalProducts?.[marca]?.[sizeStr] || [];
        
        flavors.forEach((sabor: string) => {
          if (config?.enabledFlavors?.[sabor] !== false && !externalForSize.includes(sabor)) {
            uniqueCombinations.add(`${marca}|${sabor}`);
            sizesWithData.add(size);
          }
        });
      });
    });

    const finalSizes = Array.from(sizesWithData).sort((a, b) => b - a);

    // Initialize totals
    finalSizes.forEach(tamano => {
      totalsBySize[tamano] = 0;
    });

    const sortedCombinations = Array.from(uniqueCombinations).sort((a, b) => {
      const [marcaA, saborA] = a.split('|');
      const [marcaB, saborB] = b.split('|');
      if (marcaA !== marcaB) return marcaA.localeCompare(marcaB);
      return saborA.localeCompare(saborB);
    });

    // Initialize data for all combinations
    sortedCombinations.forEach(key => {
      data[key] = {};
      finalSizes.forEach(tamano => {
        data[key][tamano] = { packs: 0, extraBot: 0 };
      });
    });

    filteredReports.forEach(report => {
      const key = `${report.marca || 'Torasso'}|${report.sabor}`;
      const tamano = Number(report.tamano);
      
      // Double check it's not an external product (though it shouldn't be reported anyway)
      const isExternal = (config?.externalProducts?.[report.marca]?.[tamano.toString()] || []).includes(report.sabor);
      
      if (tamano && data[key] && data[key][tamano] && !isExternal) {
        const packs = Number(report.paquetes) || 0;
        const botellas = Number(report.botellas) || 0;
        const botellasPorPack = config?.botellasPorPack?.[tamano] || 1;
        const extra = Math.max(0, botellas - (packs * botellasPorPack));

        data[key][tamano].packs += packs;
        data[key][tamano].extraBot += extra;
        totalsBySize[tamano] += packs;
        grandTotalPacks += packs;
        grandTotalExtraBot += extra;
      }
    });

    return { data, totalsBySize, sortedCombinations, filteredSizes: finalSizes, grandTotalPacks, grandTotalExtraBot };
  }, [filteredReports, getFilteredFlavors, getFilteredSizes, availableBrands]);

  const periodDescription = useMemo(() => {
    if (periodMode === 'range') {
      const minDateStr = startDate <= endDate ? startDate : endDate;
      const maxDateStr = startDate <= endDate ? endDate : startDate;
      try {
        const sFormatted = format(parseISO(minDateStr), "dd/MM/yyyy");
        const eFormatted = format(parseISO(maxDateStr), "dd/MM/yyyy");
        const days = Math.abs(differenceInCalendarDays(parseISO(maxDateStr), parseISO(minDateStr))) + 1;
        return `Del ${sFormatted} al ${eFormatted} (${days} ${days === 1 ? 'día' : 'días'} · ${filteredReports.length} ${filteredReports.length === 1 ? 'parte' : 'partes'})`;
      } catch {
        return `Rango personalizado (${filteredReports.length} partes)`;
      }
    }
    if (periodMode === 'month') {
      try {
        const formatted = format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy', { locale: es });
        return `Mes de ${formatted.charAt(0).toUpperCase() + formatted.slice(1)} (${filteredReports.length} ${filteredReports.length === 1 ? 'parte' : 'partes'})`;
      } catch {
        return `Mes ${selectedMonth} (${filteredReports.length} partes)`;
      }
    }
    if (periodMode === 'year') {
      return `Año ${selectedYear} (${filteredReports.length} ${filteredReports.length === 1 ? 'parte' : 'partes'})`;
    }
    return `Todo el historial (${filteredReports.length} ${filteredReports.length === 1 ? 'parte' : 'partes'})`;
  }, [periodMode, startDate, endDate, selectedMonth, selectedYear, filteredReports.length]);

  return (
    <div className="space-y-6">
      {/* Header & Filter Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
        {/* Top bar: Title, Management & Mode Switcher */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-2 text-gray-700 font-medium">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">Consolidado de Producción</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {managementStartDate && (
              <div className="flex items-center gap-2 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Gestión:</label>
                <select
                  value={selectedGestion}
                  onChange={(e) => setSelectedGestion(e.target.value as any)}
                  className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs border p-1 bg-white font-medium"
                >
                  <option value="all">Todas</option>
                  <option value="current">Actual</option>
                  <option value="previous">Anterior</option>
                </select>
              </div>
            )}

            {/* Mode Switcher Tabs */}
            <div className="inline-flex p-1 bg-gray-100 rounded-lg border border-gray-200 text-xs font-medium">
              <button
                type="button"
                onClick={() => setPeriodMode('range')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  periodMode === 'range'
                    ? 'bg-white text-blue-700 shadow-xs font-bold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Entre Fechas
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('month')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  periodMode === 'month'
                    ? 'bg-white text-blue-700 shadow-xs font-bold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Por Mes
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('year')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  periodMode === 'year'
                    ? 'bg-white text-blue-700 shadow-xs font-bold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Por Año
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('all')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  periodMode === 'all'
                    ? 'bg-white text-blue-700 shadow-xs font-bold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Todo
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Controls based on selected Mode */}
        {periodMode === 'range' && (
          <div className="bg-blue-50/60 p-3.5 rounded-lg border border-blue-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Desde:</span>
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStartDate(val);
                    if (endDate && val > endDate) {
                      setEndDate(val);
                    }
                  }}
                  className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-2.5 py-1.5 bg-white font-medium text-gray-800"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Hasta:</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEndDate(val);
                    if (startDate && val < startDate) {
                      setStartDate(val);
                    }
                  }}
                  className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-2.5 py-1.5 bg-white font-medium text-gray-800"
                />
              </div>
            </div>

            {/* Quick shortcuts */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mr-1">Atajos:</span>
              <button
                type="button"
                onClick={() => {
                  const today = format(new Date(), 'yyyy-MM-dd');
                  setStartDate(today);
                  setEndDate(today);
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => {
                  const y = format(subDays(new Date(), 1), 'yyyy-MM-dd');
                  setStartDate(y);
                  setEndDate(y);
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                Ayer
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartDate(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
                  setEndDate(format(new Date(), 'yyyy-MM-dd'));
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                7 días
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartDate(format(subDays(new Date(), 15), 'yyyy-MM-dd'));
                  setEndDate(format(new Date(), 'yyyy-MM-dd'));
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                15 días
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartDate(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
                  setEndDate(format(new Date(), 'yyyy-MM-dd'));
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                30 días
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartDate(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
                  setEndDate(format(new Date(), 'yyyy-MM-dd'));
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                Este Mes
              </button>
              <button
                type="button"
                onClick={() => {
                  const prevMonthEnd = subDays(startOfMonth(new Date()), 1);
                  setStartDate(format(startOfMonth(prevMonthEnd), 'yyyy-MM-dd'));
                  setEndDate(format(endOfMonth(prevMonthEnd), 'yyyy-MM-dd'));
                }}
                className="px-2 py-1 text-xs font-medium bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 shadow-xs transition-colors"
              >
                Mes Anterior
              </button>
            </div>
          </div>
        )}

        {periodMode === 'month' && (
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 flex items-center gap-3">
            <Calendar className="w-4 h-4 text-blue-600" />
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Seleccionar Mes:</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-3 py-1.5 bg-white font-medium min-w-[220px]"
            >
              {months.map(m => (
                <option key={`month_${m}`} value={m}>
                  {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
        )}

        {periodMode === 'year' && (
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 flex items-center gap-3">
            <Calendar className="w-4 h-4 text-blue-600" />
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Seleccionar Año:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-3 py-1.5 bg-white font-medium min-w-[160px]"
            >
              {years.map(y => (
                <option key={`year_${y}`} value={y}>
                  Año {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Active evaluation status banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
          <div className="flex items-center gap-2 text-gray-600">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              {periodMode === 'range' && '📅 Rango Libre'}
              {periodMode === 'month' && '📆 Mensual'}
              {periodMode === 'year' && '🗓️ Anual'}
              {periodMode === 'all' && '🌐 Historial Completo'}
            </span>
            <span className="font-medium text-gray-700">{periodDescription}</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-blue-600 font-medium">
                <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                Actualizando...
              </span>
            ) : (
              <span className="text-gray-400 font-medium">
                Total evaluado: <strong className="text-gray-700">{consolidatedData.grandTotalPacks.toLocaleString('es-AR')}</strong> packs
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200 sticky left-0 bg-gray-50 z-10">
                  Sabor
                </th>
                <th className="px-2 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200">
                  Paquetes x
                </th>
                <th className="px-2 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200">
                  Bot
                </th>
                {consolidatedData.filteredSizes.map(tamano => (
                  <th key={tamano} colSpan={3} className="px-2 py-2 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200">
                    <div className="border-b border-gray-200 pb-1 mb-1">{tamano.toString()} cc</div>
                    <div className="grid grid-cols-3 gap-1 text-[10px]">
                      <span>Packs</span>
                      <span>Bot +</span>
                      <span>%</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {consolidatedData.sortedCombinations.map((key) => {
                const [marca, sabor] = key.split('|');
                const hasProduction = consolidatedData.filteredSizes.some(t => consolidatedData.data[key][t].packs > 0);
                
                return (
                   <tr key={key} className={`hover:bg-blue-50/30 transition-colors ${!hasProduction ? 'opacity-40' : ''}`}>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900 border-r border-gray-200 sticky left-0 bg-white z-10">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase font-bold">{marca}</span>
                        <span>{sabor}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-xs text-gray-500 border-r border-gray-200 italic">
                      paquetes x
                    </td>
                    <td className="px-2 py-2 text-center text-sm font-semibold text-gray-700 border-r border-gray-200">
                      {/* We take the bottles per pack for the first size that has production, or default to 6 */}
                      {(() => {
                        const firstSizeWithProd = consolidatedData.filteredSizes.find(t => consolidatedData.data[key][t].packs > 0);
                        return config?.botellasPorPack?.[firstSizeWithProd || 3000] || 6;
                      })()}
                    </td>
                    {consolidatedData.filteredSizes.map(tamano => {
                      const cell = consolidatedData.data[key][tamano];
                      const totalForSize = consolidatedData.totalsBySize[tamano] || 0;
                      const percentage = totalForSize > 0 ? (cell.packs / totalForSize) * 100 : 0;
                      const isCurrentlyActive = getFilteredFlavors(marca, tamano, false).includes(sabor);
                      const hasData = cell.packs > 0 || cell.extraBot > 0;
                      const isActive = isCurrentlyActive || hasData;

                      return (
                        <td key={tamano} colSpan={3} className={`px-0 py-0 border-r border-gray-300 ${isActive ? '' : 'bg-gray-300/80 relative'}`}>
                          {!isActive && (
                            <div className="absolute inset-0 opacity-[0.1] pointer-events-none bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,#000_10px,#000_20px)]"></div>
                          )}
                          <div className={`grid grid-cols-3 h-full items-center text-center divide-x divide-gray-200 ${isActive ? '' : 'opacity-30'}`}>
                            <span className={`py-2 text-sm ${cell.packs > 0 ? 'font-bold text-blue-700' : (isActive ? 'text-gray-200' : 'text-gray-800 font-black')}`}>
                              {cell.packs > 0 ? cell.packs.toLocaleString('es-AR') : '-'}
                            </span>
                            <span className={`py-2 text-xs ${cell.extraBot > 0 ? 'text-orange-600 font-medium' : 'text-transparent'}`}>
                              {cell.extraBot > 0 ? cell.extraBot : ''}
                            </span>
                            <span className={`py-2 text-[10px] ${percentage > 0 ? 'text-green-600 font-medium' : 'text-transparent'}`}>
                              {percentage > 0 ? `${Math.round(percentage)}%` : ''}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 sticky left-0 bg-gray-100 z-10">
                  TOTALES
                </td>
                <td className="border-r border-gray-200"></td>
                <td className="border-r border-gray-200"></td>
                {consolidatedData.filteredSizes.map(tamano => (
                  <td key={tamano} colSpan={3} className="px-2 py-3 text-center text-sm text-blue-800 border-r border-gray-200">
                    {consolidatedData.totalsBySize[tamano].toLocaleString('es-AR')}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Grand Total Section */}
      <div className="bg-blue-50 rounded-xl shadow-sm border border-blue-200 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-blue-900">Total General de Producción</h3>
          <p className="text-sm text-blue-700">Suma de todos los sabores y calibres &bull; <span className="font-semibold text-blue-900">{periodDescription}</span></p>
        </div>
        <div className="flex items-center gap-6 bg-white px-6 py-4 rounded-lg shadow-sm border border-blue-100">
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Packs Totales</div>
            <div className="text-4xl font-black text-blue-700">{consolidatedData.grandTotalPacks.toLocaleString('es-AR')}</div>
          </div>
          <div className="w-px h-12 bg-gray-200"></div>
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Botellas Sueltas</div>
            <div className="text-3xl font-bold text-orange-600">{consolidatedData.grandTotalExtraBot.toLocaleString('es-AR')}</div>
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-400 italic">
        * Los porcentajes (%) se calculan sobre el total de paquetes producidos para cada calibre en el periodo seleccionado.
      </div>
    </div>
  );
}
