import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, orderBy, limit, getDocs, startAfter, doc, deleteDoc, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ElaboracionReport } from '../types';
import { Beaker, Calendar, Clock, Activity, AlertCircle, Edit2, Filter, Trash2, Gauge, Droplets, ChevronDown, ChevronUp, PlusCircle, RefreshCw } from 'lucide-react';
import { format, parseISO, isAfter, subHours, subMonths, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';

interface ElaboracionHistoryProps {
  onEditReport: (report: ElaboracionReport) => void;
  onNewReport: () => void;
}

export function ElaboracionHistory({ onEditReport, onNewReport, isAdmin }: ElaboracionHistoryProps & { isAdmin?: boolean }) {
  const { 
    availableFlavors, 
    availableSizes, 
    availableLines, 
    availableBrands 
  } = useAppConfig();
  const [reports, setReports] = useState<ElaboracionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const PAGE_SIZE = 25;
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  // Filters state
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedLinea, setSelectedLinea] = useState<string>('');
  const [selectedMarca, setSelectedMarca] = useState<string>('');
  const [selectedSabor, setSelectedSabor] = useState<string>('');
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sort state
  const [sortField, setSortField] = useState<'fechaTurno' | 'planilla' | 'marca' | 'sabor'>('fechaTurno');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const fetchReports = useCallback(async (isNextPage = false) => {
    if (isNextPage) setLoadingMore(true);
    else setLoading(true);

    try {
      const reportsRef = collection(db, 'elaboracion_reports');
      let q = query(reportsRef, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));

      if (isNextPage && lastDoc) {
        q = query(reportsRef, orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
      }

      const snapshot = await getDocs(q);
      
      const newReports = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ElaboracionReport));

      if (isNextPage) {
        setReports(prev => [...prev, ...newReports]);
      } else {
        setReports(newReports);
      }

      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setError(null);
    } catch (err) {
      console.error("Error fetching elaboration reports:", err);
      setError("No se pudieron cargar los datos de elaboración.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [lastDoc]);

  useEffect(() => {
    fetchReports();
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

  // Apply filters
  const sortedReports = useMemo(() => {
    const filtered = reports.filter(r => {
      const logicalDate = getLogicalDate(r);
      if (selectedMonth && logicalDate && !logicalDate.startsWith(selectedMonth)) return false;
      if (selectedLinea && r.linea !== selectedLinea) return false;
      if (selectedMarca && r.marca !== selectedMarca) return false;
      if (selectedSabor && r.sabor !== selectedSabor) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'fechaTurno') {
         const dateA = a.fecha || '';
         const dateB = b.fecha || '';
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
  }, [reports, selectedMonth, selectedLinea, selectedMarca, selectedSabor, sortField, sortDirection]);

  const handleDelete = async () => {
    if (!reportToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'elaboracion_reports', reportToDelete));
      setReportToDelete(null);
    } catch (err: any) {
      console.error("Error deleting report:", err);
      setError(`Error al eliminar el reporte: ${err.message}`);
    } finally {
      setIsDeleting(false);
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

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Beaker className="w-6 h-6 text-blue-600" />
          Historial de Elaboración
        </h2>
        <button
          onClick={onNewReport}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md"
        >
          <PlusCircle className="w-5 h-5" />
          Nuevo Parte Elab.
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-4 text-gray-700 font-medium">
          <Filter className="w-5 h-5" />
          <h2>Filtros de Elaboración</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
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
              onChange={(e) => setSelectedLinea(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todas las líneas</option>
              {availableLines.map(l => <option key={l} value={l}>Línea {l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
            <select
              value={selectedMarca}
              onChange={(e) => setSelectedMarca(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todas</option>
              {availableBrands.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sabor</label>
            <select
              value={selectedSabor}
              onChange={(e) => setSelectedSabor(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todos</option>
              {availableFlavors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ordenar por</label>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as any)}
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
              onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Planilla</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha / Turno</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Químico</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jarabe (Real/Teo/%)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CO2 (Consumo)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Botellas</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedReports.map((report) => {
                const isEditable = (report.createdAt ? isAfter(parseISO(report.createdAt), subHours(new Date(), 24)) : false) || isAdmin;
                const isExpanded = expandedReport === report.id;
                const logicalDate = getLogicalDate(report);
                const showLogicalDate = logicalDate && logicalDate !== report.fecha;
                
                return (
                  <React.Fragment key={report.id}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-800">
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
                        {report.turno} {report.horaInicio && `(${report.horaInicio} - ${report.horaFin})`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{report.quimico}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">Línea {report.linea}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {report.marca} {report.sabor} {report.tamano}cc
                      </div>
                      <div className="text-[10px] text-gray-400">Lote: {report.lote}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <span className="font-medium">{report.jarabeConsumido || 0}L</span> / {report.jarabeTeorico || 0}L
                      </div>
                      <div className={`text-xs font-bold mt-1 ${
                        (report.jarabeDesperdicioPorcentaje || 0) > 5 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {report.jarabeDesperdicioPorcentaje || 0}% desp.
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 flex items-center gap-1">
                        <Gauge className="w-3.5 h-3.5 text-gray-400" />
                        {report.co2Consumido || 0} Kg
                      </div>
                      <div className="text-[10px] text-gray-400">
                        In: {report.co2Inicial || 0} / Rec: {report.co2Recarga || 0} / Fin: {report.co2Final || 0}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">
                        {report.botellasProduccion?.toLocaleString() || 0}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {report.contInicial} - {report.contFinal}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setExpandedReport(isExpanded ? null : (report.id || null))}
                          className={`p-2 rounded-md transition-colors ${isExpanded ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          title={isExpanded ? "Ocultar detalle" : "Ver detalle"}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {isEditable && (
                          <button
                            onClick={() => onEditReport(report)}
                            className="text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 p-2 rounded-md transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => report.id && setReportToDelete(report.id)}
                          className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-2 rounded-md transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={8} className="px-6 py-4 bg-gray-50 border-t border-b border-gray-100">
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Detalle Horario
                          </h4>
                          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Hora</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Lote Elab.</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Tanque</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Carbonatación (V)</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Brix (Bot/Pat/Diff)</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">pH / Acid / Jar</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Checks</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {report.hourlyData.filter(h => h.loteElaboracion || h.tanque).map((hour, idx) => (
                                  <tr key={idx} className="text-xs">
                                    <td className="px-3 py-2 font-bold">{hour.hora}hs</td>
                                    <td className="px-3 py-2">{hour.loteElaboracion}</td>
                                    <td className="px-3 py-2">{hour.tanque}</td>
                                    <td className="px-3 py-2">
                                      {hour.volBotCorregido || hour.volBot || '-'} V
                                      <span className="text-[10px] text-gray-400 block">P: {hour.presion} / T: {hour.temp}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                      {hour.brixBot} / {hour.brixPatron}
                                      <span className={`block font-bold ${Math.abs(hour.brixBotCorregido || 0) > 0.2 ? 'text-red-600' : 'text-green-600'}`}>
                                        Diff: {hour.brixBotCorregido}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">
                                      pH: {hour.phBebida} / Ac: {hour.acidezPatron} / Jar: {hour.brixJarabe}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex gap-1">
                                        <span className={`px-1 rounded text-[8px] font-bold ${hour.cloro === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>CL</span>
                                        <span className={`px-1 rounded text-[8px] font-bold ${hour.codif === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>COD</span>
                                        <span className={`px-1 rounded text-[8px] font-bold ${hour.organoleptico === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>ORG</span>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
