import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ElaboracionReport } from '../types';
import { Beaker, Calendar, Clock, Activity, AlertCircle, Edit2, Filter, Trash2, Gauge, Droplets, ChevronDown, ChevronUp, PlusCircle } from 'lucide-react';
import { format, parseISO, isAfter, subHours } from 'date-fns';
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
  const [error, setError] = useState<string | null>(null);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  // Filters state
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedLinea, setSelectedLinea] = useState<string>('');
  const [selectedMarca, setSelectedMarca] = useState<string>('');
  const [selectedSabor, setSelectedSabor] = useState<string>('');

  useEffect(() => {
    const q = query(collection(db, 'elaboracion_reports'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData: ElaboracionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ElaboracionReport);
      });
      setReports(reportsData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching elaboration reports:", err);
      setError("No se pudieron cargar los datos de elaboración.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter options
  const months = useMemo(() => {
    const uniqueMonths = new Set<string>();
    reports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      if (logicalDate) {
        uniqueMonths.add(logicalDate.substring(0, 7)); // yyyy-MM
      }
    });
    return Array.from(uniqueMonths).sort().reverse();
  }, [reports]);

  // Apply filters
  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const logicalDate = getLogicalDate(r);
      if (selectedMonth && logicalDate && !logicalDate.startsWith(selectedMonth)) return false;
      if (selectedLinea && r.linea !== selectedLinea) return false;
      if (selectedMarca && r.marca !== selectedMarca) return false;
      if (selectedSabor && r.sabor !== selectedSabor) return false;
      return true;
    });
  }, [reports, selectedMonth, selectedLinea, selectedMarca, selectedSabor]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este reporte?')) return;
    try {
      await deleteDoc(doc(db, 'elaboracion_reports', id));
    } catch (err) {
      console.error("Error deleting report:", err);
      alert("Error al eliminar el reporte.");
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
              {filteredReports.map((report) => {
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
                          onClick={() => report.id && handleDelete(report.id)}
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
    </div>
  );
}
