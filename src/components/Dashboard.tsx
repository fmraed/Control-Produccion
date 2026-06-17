import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, orderBy, limit, getDocs, startAfter, doc, deleteDoc, QueryDocumentSnapshot, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { FileText, Calendar, Clock, Activity, AlertCircle, Edit2, Filter, ChevronDown, ChevronUp, Trash2, Settings2, Info, Printer, RefreshCw, Droplets } from 'lucide-react';
import { format, parseISO, isAfter, subHours, subMonths, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate } from '../utils';
import { printProductionReport, printInternalReport } from '../utils/printReport';
import { useAppConfig } from '../hooks/useAppConfig';
import { ClipboardCheck } from 'lucide-react';

interface DashboardProps {
  onNewReport: () => void;
  onEditReport: (report: ProductionReport) => void;
  isAdmin?: boolean;
  filters: {
    selectedMonth: string;
    selectedGestion: string;
    selectedLinea: string;
    selectedSupervisor: string;
    selectedTamano: string;
    selectedSabor: string;
    selectedMarca: string;
    sortField: 'fechaTurno' | 'planilla' | 'marca' | 'sabor';
    sortDirection: 'asc' | 'desc';
  };
  onFiltersChange: (filters: any) => void;
}

export function Dashboard({ onNewReport, onEditReport, isAdmin, filters, onFiltersChange }: DashboardProps) {
  const { 
    config,
    availableFlavors, 
    availableSizes, 
    availableLines, 
    availableSupervisors,
    availableBrands,
    shouldShowReport
  } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const PAGE_SIZE = 100;
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);

  const {
    selectedMonth,
    selectedGestion,
    selectedLinea,
    selectedSupervisor,
    selectedTamano,
    selectedSabor,
    selectedMarca,
    sortField,
    sortDirection
  } = filters;

  const setFilter = (field: string, value: any) => {
    onFiltersChange((prev: any) => ({ ...prev, [field]: value }));
  };

  const fetchReports = useCallback(async (isNextPage = false) => {
    if (isNextPage) setLoadingMore(true);
    else setLoading(true);

    try {
      const reportsRef = collection(db, 'production_reports');
      let q;

      if (filters.selectedMonth) {
        const [year, month] = filters.selectedMonth.split('-');
        const startDate = new Date(parseInt(year), parseInt(month) - 2, 28);
        const startStr = format(startDate, 'yyyy-MM-dd');
        const endDate = new Date(parseInt(year), parseInt(month), 5);
        const endStr = format(endDate, 'yyyy-MM-dd');

        q = query(
          reportsRef,
          where('fecha', '>=', startStr),
          where('fecha', '<=', endStr),
          orderBy('fecha', 'desc'),
          orderBy('createdAt', 'desc'),
          limit(PAGE_SIZE)
        );
        
        if (isNextPage && lastDoc) {
          q = query(
            reportsRef,
            where('fecha', '>=', startStr),
            where('fecha', '<=', endStr),
            orderBy('fecha', 'desc'),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          );
        }
      } else {
        q = query(reportsRef, orderBy('fecha', 'desc'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE));

        if (isNextPage && lastDoc) {
          q = query(reportsRef, orderBy('fecha', 'desc'), orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
        }
      }

      const snapshot = await getDocs(q);
      console.log(`Fetched ${snapshot.docs.length} reports for Dashboard`);
      
      const newReports = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as any)
      } as ProductionReport));

      if (isNextPage) {
        setReports(prev => {
          // Avoid duplicates
          const uniqueIds = new Set(prev.map(r => r.id));
          const toAdd = newReports.filter(r => !uniqueIds.has(r.id));
          return [...prev, ...toAdd];
        });
      } else {
        setReports(newReports);
      }

      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setError(null);
    } catch (err) {
      console.error("Error fetching reports:", err);
      setError("No se pudieron cargar los partes de producción.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [lastDoc, filters.selectedMonth]);

  // Reset pagination when selected month changes
  useEffect(() => {
    setLastDoc(null);
    setHasMore(true);
    fetchReports(false);
  }, [filters.selectedMonth]);

  useEffect(() => {
    // Initial fetch handled by the reset effect above
  }, []);

  // Filter options
  const months = useMemo(() => {
    const monthsList = [];
    const now = new Date();
    // Generate last 24 months for the filter
    for (let i = 0; i < 24; i++) {
      const date = subMonths(startOfMonth(now), i);
      monthsList.push(format(date, 'yyyy-MM'));
    }
    return monthsList;
  }, []);

  const lineas = availableLines;
  const supervisores = availableSupervisors;
  const tamanos = availableSizes;
  const sabores = availableFlavors;

  // Acceder a la config de gestión
  const managementStartDate = config?.managementSettings?.managementStartDate || null;

  // Apply filters
  const sortedReports = useMemo(() => {
    const filtered = reports.filter(r => {
      // First check historical visibility
      if (!shouldShowReport(r)) return false;

      const logicalDate = getLogicalDate(r);
      if (selectedMonth && logicalDate && !logicalDate.startsWith(selectedMonth)) return false;
      
      // Management Cutoff Filter
      if (selectedGestion !== 'all' && managementStartDate) {
        if (selectedGestion === 'current' && r.fecha < managementStartDate) return false;
        if (selectedGestion === 'previous' && r.fecha >= managementStartDate) return false;
      }
      
      if (selectedLinea && r.linea !== selectedLinea) return false;
      if (selectedSupervisor && r.supervisor !== selectedSupervisor) return false;
      if (selectedTamano && r.tamano?.toString() !== selectedTamano) return false;
      if (selectedSabor && r.sabor !== selectedSabor) return false;
      if (selectedMarca && r.marca !== selectedMarca) return false;
      return true;
    });

    return filtered.sort((a, b) => {
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
  }, [reports, selectedMonth, selectedGestion, selectedLinea, selectedSupervisor, selectedTamano, selectedSabor, selectedMarca, sortField, sortDirection, shouldShowReport, managementStartDate]);

  // Auto-fetch more if active filters reduce the visible list too much
  useEffect(() => {
    if (sortedReports.length < 15 && hasMore && !loading && !loadingMore) {
      // Pequeno timeout para no saturar firebase
      const timer = setTimeout(() => {
        fetchReports(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sortedReports.length, hasMore, loading, loadingMore, fetchReports]);

  const handleDelete = async () => {
    if (!reportToDelete) return;
    try {
      await deleteDoc(doc(db, 'production_reports', reportToDelete));
      setReports(prev => prev.filter(r => r.id !== reportToDelete));
      setReportToDelete(null);
    } catch (err: any) {
      console.error("Error deleting report:", err);
      setError(`Error al eliminar el reporte: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-start gap-3">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p>{error}</p>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-gray-100 p-4 rounded-full">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No hay partes de producción</h3>
        <p className="text-gray-500 mb-6 max-w-sm mx-auto">
          Aún no se ha registrado ningún parte de producción. Comienza creando el primero.
        </p>
        <button
          onClick={onNewReport}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Crear Parte de Producción
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-4 text-gray-700 font-medium">
          <Filter className="w-5 h-5" />
          <h2>Filtros</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
          {managementStartDate && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Gestión</label>
              <select
                value={selectedGestion || 'all'}
                onChange={(e) => setFilter('selectedGestion', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              >
                <option value="all">Todas</option>
                <option value="current">Actual</option>
                <option value="previous">Anterior</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select
              value={selectedMonth}
              onChange={(e) => setFilter('selectedMonth', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todos los meses</option>
              {months.map(m => (
                <option key={m} value={m}>
                  {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Línea</label>
            <select
              value={selectedLinea}
              onChange={(e) => setFilter('selectedLinea', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todas las líneas</option>
              {lineas.map(l => <option key={l} value={l}>Línea {l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Supervisor</label>
            <select
              value={selectedSupervisor}
              onChange={(e) => setFilter('selectedSupervisor', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todos</option>
              {supervisores.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Calibre</label>
            <select
              value={selectedTamano}
              onChange={(e) => setFilter('selectedTamano', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todos</option>
              {tamanos.map(t => <option key={t} value={t}>{t}ml</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sabor</label>
            <select
              value={selectedSabor}
              onChange={(e) => setFilter('selectedSabor', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todos</option>
              {sabores.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
            <select
              value={selectedMarca}
              onChange={(e) => setFilter('selectedMarca', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todas</option>
              {availableBrands.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ordenar por</label>
            <select
              value={sortField}
              onChange={(e) => setFilter('sortField', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="fechaTurno">Fecha / Turno</option>
              <option value="planilla">Planilla</option>
              <option value="marca">Marca</option>
              <option value="sabor">Sabor</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Orden</label>
            <select
              value={sortDirection}
              onChange={(e) => setFilter('sortDirection', e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Planilla</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha / Turno</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supervisor</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Línea / Producto</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producción</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Insumos</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paletizado</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eficiencia</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paradas</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Observaciones</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedReports.map((report) => {
                const totalDowntime = report.downtimes?.reduce((sum, dt) => sum + (dt.totalMinutes || 0), 0) || 0;
                const topDowntime = report.downtimes?.sort((a, b) => (b.totalMinutes || 0) - (a.totalMinutes || 0))[0];
                
                // Helper to get previous marcador for hourly production calculation
                const getPrevMarcador = (hourlyData: any[], hIndex: number, contInicial: number) => {
                  for (let i = hIndex - 1; i >= 0; i--) {
                    if (hourlyData[i]?.marcador > 0) {
                      return hourlyData[i].marcador;
                    }
                  }
                  return contInicial || 0;
                };

                // Check if report was created in the last 24 hours OR if user is admin
                const isEditable = (report.createdAt ? isAfter(parseISO(report.createdAt), subHours(new Date(), 24)) : false) || isAdmin;
                const logicalDate = getLogicalDate(report);
                const showLogicalDate = logicalDate && logicalDate !== report.fecha;
                const isExpanded = expandedReport === report.id;

                return (
                <React.Fragment key={report.id}>
                <tr className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                    {report.planilla}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 flex items-center gap-1" title={showLogicalDate ? `Fecha real de inicio: ${logicalDate}` : ''}>
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    {report.fecha}
                    {showLogicalDate && (
                      <span className="text-[10px] text-orange-500 font-medium ml-1" title="Turno noche (inició el día anterior)">
                        ({format(parseISO(logicalDate), 'dd/MM')})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    {report.entraTurno} - {report.saleTurno}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{report.supervisor}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-semibold text-gray-900">Línea {report.linea}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {report.sabor || 'Sin sabor'} {report.tamano ? `${report.tamano}ml` : ''}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-semibold text-gray-900">
                    {report.paquetes?.toLocaleString() || 0} <span className="text-xs font-normal text-gray-500">pks</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {report.botellas?.toLocaleString() || 0} bot
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    <span className="font-medium">Jarabe:</span> {report.jarabeConsumido || 0} L
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    <span className="font-medium">CO2:</span> {report.co2 ? `${report.co2} kg` : 'N/A'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-semibold text-gray-900">
                    {report.tickets || 0} <span className="text-xs font-normal text-gray-500">paletas</span>
                  </div>
                  {report.parcialActual ? (
                    <div className="text-xs text-gray-500 mt-1">
                      +{report.parcialActual} pks sueltos
                    </div>
                  ) : null}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                    <Activity className="w-3.5 h-3.5" />
                    {Math.round(report.eficBruta || 0)}%
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    <span className="font-medium">{Math.round(totalDowntime)} min</span>
                  </div>
                  {topDowntime && topDowntime.totalMinutes > 0 && (
                    <div className="text-xs text-gray-500 mt-1 truncate max-w-[150px]" title={topDowntime.reason}>
                      {topDowntime.reason} ({Math.round(topDowntime.totalMinutes)}m)
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="text-xs text-gray-500 line-clamp-2 max-w-[150px]" title={report.observaciones}>
                    {report.observaciones || <span className="text-gray-300 italic">Sin observaciones</span>}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setExpandedReport(isExpanded ? null : (report.id || null))}
                      className={`p-2 rounded-md transition-colors ${isExpanded ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      title={isExpanded ? "Ocultar detalle" : "Ver detalle completo"}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => printProductionReport(report)}
                      className="text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 p-2 rounded-md transition-colors"
                      title="Imprimir para Expedición (Resumido)"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => printInternalReport(report)}
                      className="text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 p-2 rounded-md transition-colors"
                      title="Imprimir Parte Interno (Detallado)"
                    >
                      <ClipboardCheck className="w-4 h-4" />
                    </button>
                    {isEditable && (
                      <button
                        onClick={() => onEditReport(report)}
                        className="text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 p-2 rounded-md transition-colors"
                        title="Editar parte"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => report.id && setReportToDelete(report.id)}
                      className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-2 rounded-md transition-colors"
                      title="Eliminar parte"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
              {isExpanded && (
                <tr>
                  <td colSpan={11} className="px-6 py-6 bg-gray-50 border-t border-b border-gray-100">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Hourly Production Detail */}
                      <div className="space-y-4">
                        <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-blue-600" />
                          Producción Horaria Detallada
                        </h4>
                        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Hora</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Marcador</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Producción</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Minutos Prod.</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {report.hourlyProduction?.filter(h => (h.marcador || 0) > 0).map((hour, idx) => {
                                const prevMarcador = getPrevMarcador(report.hourlyProduction || [], idx, report.contInicial || 0);
                                const produccion = hour.botMin || (hour.marcador > 0 ? Math.max(0, hour.marcador - prevMarcador) : 0);
                                const minProd = hour.minProd || (report.velocidad ? Math.round((produccion / report.velocidad) * 60) : 0);
                                
                                return (
                                  <tr key={idx} className="text-xs hover:bg-gray-50">
                                    <td className="px-4 py-2 font-bold text-blue-700">{hour.hora}hs</td>
                                    <td className="px-4 py-2 font-mono">{hour.marcador?.toLocaleString()}</td>
                                    <td className="px-4 py-2 font-bold">{produccion.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-gray-500">{minProd} min</td>
                                  </tr>
                                );
                              })}
                              {(!report.hourlyProduction || report.hourlyProduction.length === 0) && (
                                <tr>
                                  <td colSpan={4} className="px-4 py-4 text-center text-gray-400 italic">No hay datos horarios registrados</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Downtime Detail */}
                      <div className="space-y-4">
                        <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-orange-600" />
                          Registro de Paradas y Averías
                        </h4>
                        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Categoría</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Motivo</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Tiempo</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {report.downtimes?.filter(d => (d.totalMinutes || 0) > 0).map((dt, idx) => (
                                <tr key={idx} className="text-xs hover:bg-gray-50">
                                  <td className="px-4 py-2">
                                    <span className="font-bold block">{dt.category}</span>
                                  </td>
                                  <td className="px-4 py-2 text-gray-600">{dt.reason}</td>
                                  <td className="px-4 py-2">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">
                                      {Math.round(dt.totalMinutes || 0)} min
                                    </span>
                                    {dt.minutes && dt.minutes.some(m => Number(m) > 0) && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {dt.minutes.map((m, mIdx) => {
                                          const val = Number(m);
                                          if (val <= 0) return null;
                                          const hStr = report.hourlyProduction?.[mIdx]?.hora || '';
                                          return (
                                            <span key={mIdx} className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded border border-gray-200">
                                              {hStr}hs: {val}m
                                            </span>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {(!report.downtimes || report.downtimes.length === 0 || report.downtimes.every(d => (d.totalMinutes || 0) === 0)) && (
                                <tr>
                                  <td colSpan={4} className="px-4 py-4 text-center text-gray-400 italic">No hay paradas registradas</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Additional Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                              <Settings2 className="w-4 h-4 text-blue-500" />
                              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Control de Insumos</span>
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-500">Contador Inicial:</span>
                                <span className="font-mono font-bold">{report.contInicial?.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-500">Contador Final:</span>
                                <span className="font-mono font-bold">{report.contFinal?.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between text-sm py-1">
                                <span className="text-gray-500">Botellas Rotas:</span>
                                <span className="font-bold text-red-600">{report.botRotas?.toLocaleString()} u.</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                              <Droplets className="w-4 h-4 text-indigo-500" />
                              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Balance de Jarabe</span>
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-500">Jarabe Inicial:</span>
                                <span className="font-bold">{report.jarabeInicial || 0} L</span>
                              </div>
                              <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-500">Jarabe Final:</span>
                                <span className="font-bold">{report.jarabeFinal || 0} L</span>
                              </div>
                              <div className="flex justify-between text-sm pt-2 mt-1 border-t border-indigo-100 bg-indigo-50/30 px-2 -mx-2 rounded-b-lg">
                                <span className="text-indigo-700 font-bold">Consumo Total:</span>
                                <span className="font-bold text-indigo-900">{report.jarabeConsumido || 0} L</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                              <Trash2 className="w-4 h-4 text-red-500" />
                              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Desperdicio de Materiales</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                              <div className="text-[10px] space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Soplado:</span>
                                  <span className="font-bold text-gray-700">{report.scrapSoplado || 0} u.</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Etiquetado:</span>
                                  <span className="font-bold text-gray-700">{report.scrapEtiquetado || 0} u.</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Llenado:</span>
                                  <span className="font-bold text-gray-700">{report.scrapLlenado || 0} u.</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Horno:</span>
                                  <span className="font-bold text-gray-700">{report.scrapHorno || 0} u.</span>
                                </div>
                              </div>
                              <div className="text-[10px] space-y-1 border-l border-gray-100 pl-4">
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Etiquetas:</span>
                                  <span className="font-bold text-gray-700">{report.desperdicioEtiquetas || 0} kg</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Tapas:</span>
                                  <span className="font-bold text-gray-700">{report.desperdicioTapas || 0} kg</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Film:</span>
                                  <span className="font-bold text-gray-700">{report.desperdicioTermo || 0} kg</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Sifones:</span>
                                  <span className="font-bold text-gray-700">{report.desperdicioSifones || 0} u.</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchReports(true)}
            disabled={loadingMore}
            className="flex items-center gap-2 px-6 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                Cargando...
              </>
            ) : (
              'Cargar más reportes'
            )}
          </button>
        </div>
      )}
    </div>

    {/* Confirmation Modal */}
    {reportToDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
          <div className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-red-100 p-3 rounded-full">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">¿Eliminar este parte?</h3>
                <p className="text-sm text-gray-500">Esta acción no se puede deshacer. El reporte se borrará permanentemente de la base de datos.</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-4 flex flex-col sm:flex-row-reverse gap-3">
            <button
              onClick={handleDelete}
              className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-sm active:scale-95"
            >
              Sí, eliminar permanentemente
            </button>
            <button
              onClick={() => setReportToDelete(null)}
              className="w-full sm:w-auto bg-white hover:bg-gray-100 text-gray-700 font-bold py-2.5 px-6 rounded-xl border border-gray-200 transition-all active:scale-95"
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
