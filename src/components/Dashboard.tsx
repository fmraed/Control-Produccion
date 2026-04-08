import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { FileText, Calendar, Clock, Activity, AlertCircle, Edit2, Filter, ChevronDown, ChevronUp, Trash2, Settings2, Info } from 'lucide-react';
import { format, parseISO, isAfter, subHours } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';
import { doc, deleteDoc } from 'firebase/firestore';

interface DashboardProps {
  onNewReport: () => void;
  onEditReport: (report: ProductionReport) => void;
}

export function Dashboard({ onNewReport, onEditReport }: DashboardProps) {
  const { 
    availableFlavors, 
    availableSizes, 
    availableLines, 
    availableSupervisors 
  } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  // Filters state
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedLinea, setSelectedLinea] = useState<string>('');
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>('');
  const [selectedTamano, setSelectedTamano] = useState<string>('');
  const [selectedSabor, setSelectedSabor] = useState<string>('');

  useEffect(() => {
    const q = query(collection(db, 'production_reports'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      setReports(reportsData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching reports:", err);
      setError("No se pudieron cargar los partes de producción. Verifica tu conexión o permisos.");
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
        const date = parseISO(logicalDate);
        uniqueMonths.add(format(date, 'yyyy-MM'));
      }
    });
    return Array.from(uniqueMonths).sort().reverse();
  }, [reports]);

  const lineas = availableLines;
  const supervisores = availableSupervisors;
  const tamanos = availableSizes;
  const sabores = availableFlavors;

  // Apply filters
  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const logicalDate = getLogicalDate(r);
      if (selectedMonth && logicalDate && !logicalDate.startsWith(selectedMonth)) return false;
      if (selectedLinea && r.linea !== selectedLinea) return false;
      if (selectedSupervisor && r.supervisor !== selectedSupervisor) return false;
      if (selectedTamano && r.tamano?.toString() !== selectedTamano) return false;
      if (selectedSabor && r.sabor !== selectedSabor) return false;
      return true;
    });
  }, [reports, selectedMonth, selectedLinea, selectedSupervisor, selectedTamano, selectedSabor]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este reporte de producción?')) return;
    try {
      await deleteDoc(doc(db, 'production_reports', id));
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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
              {lineas.map(l => <option key={l} value={l}>Línea {l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Supervisor</label>
            <select
              value={selectedSupervisor}
              onChange={(e) => setSelectedSupervisor(e.target.value)}
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
              onChange={(e) => setSelectedTamano(e.target.value)}
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
              onChange={(e) => setSelectedSabor(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            >
              <option value="">Todos</option>
              {sabores.map(s => <option key={s} value={s}>{s}</option>)}
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
              {filteredReports.map((report) => {
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

                // Check if report was created in the last 24 hours
                const isEditable = report.createdAt ? isAfter(parseISO(report.createdAt), subHours(new Date(), 24)) : false;
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
                    {report.eficBruta || 0}%
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
                      onClick={() => report.id && handleDelete(report.id)}
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
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Velocidad</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Observaciones</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {report.hourlyProduction?.filter(h => (h.marcador || 0) > 0 || h.observaciones).map((hour, idx) => {
                                const prevMarcador = getPrevMarcador(report.hourlyProduction || [], idx, report.contInicial || 0);
                                const produccion = hour.botMin || (hour.marcador > 0 ? Math.max(0, hour.marcador - prevMarcador) : 0);
                                const velocidad = report.velocidad || 0;
                                
                                return (
                                  <tr key={idx} className="text-xs hover:bg-gray-50">
                                    <td className="px-4 py-2 font-bold text-blue-700">{hour.hora}hs</td>
                                    <td className="px-4 py-2 font-mono">{hour.marcador?.toLocaleString()}</td>
                                    <td className="px-4 py-2 font-bold">{produccion.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-gray-500">{velocidad} b/m</td>
                                    <td className="px-4 py-2 text-gray-500 italic">{hour.observaciones || '-'}</td>
                                  </tr>
                                );
                              })}
                              {(!report.hourlyProduction || report.hourlyProduction.length === 0) && (
                                <tr>
                                  <td colSpan={5} className="px-4 py-4 text-center text-gray-400 italic">No hay datos horarios registrados</td>
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
                        <div className="grid grid-cols-2 gap-4 mt-4">
                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <Settings2 className="w-4 h-4 text-gray-400" />
                              <span className="text-xs font-bold text-gray-500 uppercase">Control de Insumos</span>
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Contador Inicial:</span>
                                <span className="font-mono font-bold">{report.contInicial?.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Contador Final:</span>
                                <span className="font-mono font-bold">{report.contFinal?.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Botellas Rotas:</span>
                                <span className="font-bold text-red-600">{report.botRotas?.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <Info className="w-4 h-4 text-gray-400" />
                              <span className="text-xs font-bold text-gray-500 uppercase">Resumen de Jarabe</span>
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Jarabe Inicial:</span>
                                <span className="font-bold">{report.jarabeInicial || 0} L</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Jarabe Final:</span>
                                <span className="font-bold">{report.jarabeFinal || 0} L</span>
                              </div>
                              <div className="flex justify-between text-sm pt-1 border-t border-gray-100">
                                <span className="text-gray-600 font-bold">Consumo Total:</span>
                                <span className="font-bold text-blue-600">{report.jarabeConsumido || 0} L</span>
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
    </div>
    </div>
  );
}
