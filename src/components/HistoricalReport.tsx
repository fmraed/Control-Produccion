import { useMemo, useState, useEffect } from 'react';
import { collection, query, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { HISTORICAL_PRODUCTION_DATA, HistoricalEntry } from '../historicalData';
import { History, TrendingUp, Download, Calendar, Search, Filter, Database, Table, ArrowLeftCircle, ChevronRight, LayoutGrid, Trash2 } from 'lucide-react';
import { format, parseISO, isSameMonth, isBefore, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';

export function HistoricalReport() {
  const { shouldShowReport, availableFlavors, availableSizes, availableLines, availableBrands } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'explorer'>('summary');
  const [isDeleting, setIsDeleting] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!reportToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'production_reports', reportToDelete));
      setReportToDelete(null);
    } catch (err: any) {
      console.error("Error al eliminar el reporte histórico:", err);
      alert(`Error al eliminar: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Explorer filters
  const [filterYear, setFilterYear] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [filterLinea, setFilterLinea] = useState<string>('');
  const [filterMarca, setFilterMarca] = useState<string>('');
  const [filterSabor, setFilterSabor] = useState<string>('');
  const [filterTamano, setFilterTamano] = useState<string>('');

  const [sortField, setSortField] = useState<'fechaTurno' | 'planilla' | 'marca' | 'sabor'>('fechaTurno');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  useEffect(() => {
    // We only need the amount of bottles produced to calculate packs
    const q = query(collection(db, 'production_reports'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      console.log('Total reports:', reportsData.length);
      console.log('Sample report:', reportsData[0]);
      setReports(reportsData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching reports:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const tableData = useMemo(() => {
    const data: HistoricalEntry[] = JSON.parse(JSON.stringify(HISTORICAL_PRODUCTION_DATA));
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth();

    // Group reports by year and month to replace hardcoded values
    const replacementData: Record<number, Record<number, number>> = {};
    const hasDataMark: Record<number, Record<number, boolean>> = {};

    reports.forEach(report => {
      const logicalDateStr = getLogicalDate(report);
      if (!logicalDateStr) return;
      
      const date = parseISO(logicalDateStr);
      const year = date.getFullYear();
      const monthIdx = date.getMonth();

      if (!replacementData[year]) replacementData[year] = {};
      if (!replacementData[year][monthIdx]) replacementData[year][monthIdx] = 0;
      
      if (!hasDataMark[year]) hasDataMark[year] = {};
      hasDataMark[year][monthIdx] = true;

      let paquetes = report.paquetes;
      if (typeof paquetes !== 'number') {
        const botellas = report.botellas || 0;
        const tamano = Number(report.tamano);
        const botellasPorPack = tamano === 500 ? 12 : 6; 
        paquetes = botellas / botellasPorPack;
      }
      replacementData[year][monthIdx] += paquetes;
    });

    Object.entries(replacementData).forEach(([yearStr, monthsData]) => {
      const year = parseInt(yearStr);
      let entry = data.find(d => d.year === year);
      
      if (!entry) {
        entry = { year, months: Array(12).fill(null) };
        data.push(entry);
      }

      Object.entries(monthsData).forEach(([mIdxStr, totalPacks]) => {
        const mIdx = parseInt(mIdxStr);
        if (totalPacks > 0) {
          entry!.months[mIdx] = Math.round(totalPacks);
        }
      });
    });

    // Sort by year ascending
    data.sort((a, b) => a.year - b.year);

    // Calculate top row (averages per month)
    const monthAverages = monthNames.map((_, mIdx) => {
      let sum = 0;
      let count = 0;
      data.forEach(entry => {
        const val = entry.months[mIdx];
        if (val !== null && val > 0) {
          const isFinished = entry.year < currentYear || mIdx < currentMonthIdx;
          if (isFinished) {
            sum += val;
            count++;
          }
        }
      });
      return count > 0 ? sum / count : 0;
    });

    const processedData = data.map(entry => {
      const yearlyTotal = entry.months.reduce((sum, m) => sum + (m || 0), 0);
      const monthsWithData = entry.months.filter(m => m !== null && m > 0).length;
      const yearlyAvg = monthsWithData > 0 ? yearlyTotal / monthsWithData : 0;
      
      return {
        ...entry,
        yearlyTotal,
        yearlyAvg,
        monthsMark: hasDataMark[entry.year] || {}
      };
    });

    const totalHistoricalAvg = monthAverages.reduce((sum, a) => sum + a, 0);
    const overallAvg = totalHistoricalAvg / 12;

    return {
      rows: processedData,
      monthAverages,
      overallAvg,
      totalHistoricalAvg
    };
  }, [reports, shouldShowReport]);

  const explorerData = useMemo(() => {
    return reports
      .filter(r => {
        const dateStr = getLogicalDate(r) || '';
        if (filterYear && !dateStr.startsWith(filterYear)) return false;
        if (filterMonth && dateStr.split('-')[1] !== filterMonth) return false;
        if (filterLinea && r.linea !== filterLinea) return false;
        if (filterMarca && r.marca !== filterMarca) return false;
        if (filterSabor && r.sabor !== filterSabor) return false;
        if (filterTamano && String(r.tamano) !== filterTamano) return false;
        
        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortField === 'fechaTurno') {
           const dateA = getLogicalDate(a);
           const dateB = getLogicalDate(b);
           if (dateA !== dateB) comparison = dateA.localeCompare(dateB);
           else {
              const turnoOrder = { 'Mañana': 1, 'Tarde': 2, 'Noche': 3 };
              const tA = turnoOrder[a.turno as keyof typeof turnoOrder] || 0;
              const tB = turnoOrder[b.turno as keyof typeof turnoOrder] || 0;
              comparison = tA - tB;
           }
        } else if (sortField === 'planilla') {
           comparison = String(a.planilla || '').localeCompare(String(b.planilla || ''));
        } else if (sortField === 'marca') {
           comparison = String(a.marca || '').localeCompare(String(b.marca || ''));
        } else if (sortField === 'sabor') {
           comparison = String(a.sabor || '').localeCompare(String(b.sabor || ''));
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [reports, filterYear, filterMonth, filterLinea, filterMarca, filterSabor, filterTamano, sortField, sortDirection]);

  const uniqueFilterValues = useMemo(() => {
    const validReports = reports;
    return {
      years: Array.from(new Set(validReports.map(r => getLogicalDate(r)?.split('-')[0]))).filter(Boolean).sort().reverse(),
      lines: Array.from(new Set(validReports.map(r => r.linea))).filter(Boolean).sort(),
      brands: Array.from(new Set(validReports.map(r => r.marca))).filter(Boolean).sort(),
      flavors: Array.from(new Set(validReports.map(r => r.sabor))).filter(Boolean).sort(),
      sizes: Array.from(new Set(validReports.map(r => String(r.tamano)))).filter(Boolean).sort((a, b) => Number(a) - Number(b))
    };
  }, [reports, shouldShowReport]);

  const formatNumber = (num: number) => {
    if (!num) return '-';
    return Math.round(num).toLocaleString('es-AR');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
        <p className="text-gray-500 font-medium">Cargando historial de producción...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-xl">
              <History className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">Datos Históricos</h2>
              <p className="text-sm text-gray-500 font-medium">Análisis comparativo y explorador de producción histórica</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl shadow-inner">
            <button
              onClick={() => setActiveTab('summary')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-black transition-all ${
                activeTab === 'summary' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Resumen Anual
            </button>
            <button
              onClick={() => setActiveTab('explorer')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-black transition-all ${
                activeTab === 'explorer' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Search className="w-4 h-4" />
              Explorador
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'summary' ? (
        <>
          {/* Main Table Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-3 flex items-center justify-between">
              <h3 className="text-xs font-black text-indigo-700 uppercase tracking-widest">Producción, histórica en paquetes</h3>
              <div className="flex items-center gap-4 text-[10px] text-indigo-500 font-bold uppercase">
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-gray-400"></div> Dato Manual (Hardcoded)</span>
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Dato Cargado (Prioritario)</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  {/* Top Monthly Average Row */}
                  <tr className="bg-indigo-50/50">
                    <th className="px-4 py-3 border-r border-indigo-100 text-left font-black text-indigo-900 sticky left-0 bg-indigo-50/50 z-10 w-24">
                      PROMEDIO
                    </th>
                    {tableData.monthAverages.map((avg, i) => (
                      <th key={i} className="px-2 py-3 border-r border-indigo-100 text-center font-black text-indigo-900 min-w-[90px]">
                        {formatNumber(avg)}
                      </th>
                    ))}
                    <th className="px-4 py-3 border-r border-indigo-100 text-center font-black text-indigo-900 w-32">
                      {formatNumber(tableData.totalHistoricalAvg)}
                    </th>
                    <th className="px-4 py-3 text-center font-black text-indigo-900 w-24">
                      {/* Overall Avg */}
                    </th>
                  </tr>

                  {/* Month Header Labels */}
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2 border-r border-gray-200 text-left font-bold text-gray-400 uppercase tracking-tighter sticky left-0 bg-gray-50 z-10">
                      MESES
                    </th>
                    {monthNames.map((m, i) => (
                      <th key={i} className="px-2 py-2 border-r border-gray-200 text-center font-bold text-gray-400 uppercase tracking-tighter">
                        {m}
                      </th>
                    ))}
                    <th className="px-2 py-2 border-r border-gray-200 text-center font-bold text-gray-400 uppercase tracking-tighter">
                      PROD. POR AÑO
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-gray-400 uppercase tracking-tighter">
                      PROMEDIO
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tableData.rows.map((row) => (
                    <tr key={row.year} className="hover:bg-indigo-50/20 transition-colors group">
                      <td className="px-4 py-3 border-r border-gray-200 font-black text-gray-700 bg-white group-hover:bg-indigo-50/50 sticky left-0 z-10">
                        {row.year}
                      </td>
                      {row.months.map((val, mIdx) => {
                        const hasLoadedData = (row as any).monthsMark?.[mIdx];
                        const isCurrentMonth = row.year === new Date().getFullYear() && mIdx === new Date().getMonth();
                        
                        return (
                          <td 
                            key={mIdx} 
                            className={`px-2 py-3 border-r border-gray-100 text-center font-medium
                              ${hasLoadedData ? 'text-emerald-700 bg-emerald-50/20 font-bold' : 'text-gray-600'}
                              ${isCurrentMonth ? 'ring-2 ring-indigo-500 ring-inset bg-indigo-50/30' : ''}
                            `}
                          >
                            {formatNumber(val || 0)}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 border-r border-gray-200 text-center font-black text-gray-900 bg-gray-50/30">
                        {formatNumber(row.yearlyTotal)}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-gray-500 italic bg-gray-50/30">
                        {formatNumber(row.yearlyAvg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend & Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-5 rounded-2xl border border-gray-200 flex items-start gap-4 shadow-sm">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h4 className="text-xs font-black text-emerald-700 uppercase tracking-wider mb-1">Prioridad de Datos</h4>
                <p className="text-[10px] text-gray-500 leading-relaxed font-medium">
                  Si existen partes de producción cargados para un mes, el valor se calcula sumando las botellas registradas (convertidas a packs) en lugar de usar el valor manual.
                </p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 flex items-start gap-4 shadow-sm">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Calendar className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h4 className="text-xs font-black text-indigo-700 uppercase tracking-wider mb-1">Cálculo de Promedios</h4>
                <p className="text-[10px] text-gray-500 leading-relaxed font-medium">
                  Los promedios mensuales (fila superior) NO incluyen el mes en curso hasta que este finaliza, garantizando estadísticas históricas fiables.
                </p>
              </div>
            </div>

            <div className="bg-indigo-600 p-5 rounded-2xl border border-indigo-500 flex items-center justify-between shadow-lg shadow-indigo-200">
               <div>
                 <h4 className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">Promedio Histórico Total</h4>
                 <div className="text-2xl font-black text-white">{formatNumber(tableData.overallAvg)}</div>
               </div>
               <History className="w-10 h-10 text-indigo-400/30" />
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col min-h-[600px]">
          {/* Explorer Filters Header */}
          <div className="p-4 bg-gray-50 border-b border-gray-200 grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Año</label>
               <select 
                 value={filterYear}
                 onChange={(e) => setFilterYear(e.target.value)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="">Todos</option>
                 {uniqueFilterValues.years.map(y => (
                   <option key={y} value={y}>{y}</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Mes</label>
               <select 
                 value={filterMonth}
                 onChange={(e) => setFilterMonth(e.target.value)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="">Todos</option>
                 {monthNames.map((m, i) => (
                   <option key={i} value={String(i + 1).padStart(2, '0')}>{m.toUpperCase()}</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Línea</label>
               <select 
                 value={filterLinea}
                 onChange={(e) => setFilterLinea(e.target.value)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="">Todas</option>
                 {uniqueFilterValues.lines.map(l => (
                   <option key={l} value={l}>Línea {l}</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Marca</label>
               <select 
                 value={filterMarca}
                 onChange={(e) => setFilterMarca(e.target.value)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="">Todas</option>
                 {uniqueFilterValues.brands.map(b => (
                   <option key={b} value={b}>{b}</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Sabor</label>
               <select 
                 value={filterSabor}
                 onChange={(e) => setFilterSabor(e.target.value)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="">Todos</option>
                 {uniqueFilterValues.flavors.map(f => (
                   <option key={f} value={f}>{f}</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Tamaño</label>
               <select 
                 value={filterTamano}
                 onChange={(e) => setFilterTamano(e.target.value)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="">Todos</option>
                 {uniqueFilterValues.sizes.map(s => (
                   <option key={s} value={s}>{s}cc</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Ordenar por</label>
               <select 
                 value={sortField}
                 onChange={(e) => setSortField(e.target.value as any)}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="fechaTurno">Fecha / Turno</option>
                 <option value="planilla">Planilla</option>
                 <option value="marca">Marca</option>
                 <option value="sabor">Sabor</option>
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Orden</label>
               <select 
                 value={sortDirection}
                 onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}
                 className="w-full text-xs font-bold border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
               >
                 <option value="desc">Descendente</option>
                 <option value="asc">Ascendente</option>
               </select>
             </div>
          </div>

          {/* Explorer Results Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-white sticky top-0 z-10 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Fecha</th>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Línea</th>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Planilla</th>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Producto</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Botellas</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Paquetes</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Eficiencia</th>
                  <th className="px-4 py-3 w-16 text-center font-black text-gray-400 uppercase tracking-widest">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {explorerData.length > 0 ? (
                  explorerData.map((r) => (
                    <tr key={r.id} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-4 py-3 font-bold border-r border-gray-50">{r.fecha}</td>
                      <td className="px-4 py-3 font-bold border-r border-gray-50 text-indigo-600">L{r.linea}</td>
                      <td className="px-4 py-3 border-r border-gray-50 text-gray-500">#{r.planilla}</td>
                      <td className="px-4 py-3 border-r border-gray-50">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-900">{r.marca} {r.sabor}</span>
                          <span className="text-[10px] text-gray-400">{r.tamano}cc</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium border-r border-gray-50">{(r.botellas || 0).toLocaleString('es-AR')}</td>
                      <td className="px-4 py-3 text-right font-black text-indigo-700 border-r border-gray-50">{(r.paquetes || 0).toLocaleString('es-AR')}</td>
                      <td className="px-4 py-3 text-right border-r border-gray-50">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                          Math.round(r.eficBruta || 0) >= 85 ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                          Math.round(r.eficBruta || 0) >= 70 ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                          'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {Math.round(r.eficBruta || 0)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => r.id && setReportToDelete(r.id)}
                          disabled={isDeleting}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 disabled:opacity-50"
                          title="Eliminar Reporte"
                        >
                          <Trash2 className="w-4 h-4 mx-auto" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2 opacity-30">
                        <Search className="w-12 h-12" />
                        <span className="font-bold">No hay datos que coincidan con los filtros</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          <div className="p-3 bg-gray-50 border-t border-gray-200 flex justify-between items-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
             <span>Resultados: {explorerData.length} reportes</span>
             <div className="flex items-center gap-2">
               <Database className="w-3 h-3" />
               <span>Fuente: producción_reports</span>
             </div>
          </div>
        </div>
      )}

      <div className="text-[10px] text-gray-400 font-medium italic text-center py-4">
        * Nota: Los datos anteriores a Abril 2026 provienen mayoritariamente del archivo histórico manual, a menos que se hayan importado partes específicos.
      </div>
      {/* Delete Confirmation Modal */}
      {reportToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="bg-red-100 p-3 rounded-full">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">¿Eliminar este reporte?</h3>
                  <p className="text-sm text-gray-500">Esta acción no se puede deshacer. El reporte se borrará permanentemente de la base de datos.</p>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex flex-col sm:flex-row-reverse gap-3">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-sm active:scale-95"
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
              <button
                onClick={() => setReportToDelete(null)}
                disabled={isDeleting}
                className="w-full sm:w-auto bg-white hover:bg-gray-100 disabled:opacity-50 text-gray-700 font-bold py-2.5 px-6 rounded-xl border border-gray-200 transition-all active:scale-95"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
