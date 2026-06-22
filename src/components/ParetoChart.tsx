import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { ArrowLeft, BarChart2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { getLogicalDate } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface ParetoChartProps {
  linea: string;
  month: string;
  onBack: () => void;
}

export function ParetoChart({ linea, month, onBack }: ParetoChartProps) {
  const { shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFormat, setSelectedFormat] = useState<string>('all');

  useEffect(() => {
    const [year, monthStr] = month.split('-');
    
    const startDate = new Date(parseInt(year), parseInt(monthStr) - 2, 28);
    const startStr = format(startDate, 'yyyy-MM-dd');
    
    const endDate = new Date(parseInt(year), parseInt(monthStr), 5);
    const endStr = format(endDate, 'yyyy-MM-dd');

    const q = query(
      collection(db, 'production_reports'), 
      where('fecha', '>=', startStr),
      where('fecha', '<=', endStr),
      orderBy('fecha', 'desc')
    );
    
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
  }, [month]);

  // Filter reports by month and line first to get available formats
  const baseFilteredReports = useMemo(() => {
    return reports.filter(r => {
      if (!shouldShowReport(r)) return false;
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(month) && r.linea === linea;
    });
  }, [reports, month, linea, shouldShowReport]);

  // Get unique formats available in the current selection
  const availableFormats = useMemo(() => {
    const formats = new Set<number>();
    baseFilteredReports.forEach(r => {
      if (r.tamano) formats.add(r.tamano);
    });
    return Array.from(formats).sort((a, b) => b - a);
  }, [baseFilteredReports]);

  const chartData = useMemo(() => {
    // Further filter by selected format if needed
    const filteredReports = selectedFormat === 'all' 
      ? baseFilteredReports 
      : baseFilteredReports.filter(r => r.tamano?.toString() === selectedFormat);

    // Aggregate downtime minutes by reason
    const aggregatedData: Record<string, number> = {};
    let totalDowntime = 0;

    filteredReports.forEach(report => {
      report.downtimes?.forEach(dt => {
        let reason = dt.reason;
        
        // Map split reasons back to combined reasons for the report
        if (reason === 'REFRIGERIO' || reason === 'INICIO Y FIN DE TURNO') {
          reason = 'REFRIGERIO/ INICIO Y FIN DE TURNO';
        } else if (reason === 'CAMBIO DE SABOR' || reason === 'CAMBIO DE FORMATO') {
          reason = 'CAMBIO DE SABOR/ FORMATO';
        }

        const minutes = dt.totalMinutes || 0;
        
        if (minutes > 0) {
          aggregatedData[reason] = (aggregatedData[reason] || 0) + minutes;
          totalDowntime += minutes;
        }
      });
    });

    // Convert to array and sort descending by minutes
    const sortedData = Object.entries(aggregatedData)
      .map(([label, minutes]) => ({ label, minutes }))
      .sort((a, b) => b.minutes - a.minutes);

    // Calculate cumulative percentage
    let cumulativeMinutes = 0;
    const dataWithCumulative = sortedData.map(item => {
      cumulativeMinutes += item.minutes;
      const cumulativePercentage = totalDowntime > 0 ? (cumulativeMinutes / totalDowntime) * 100 : 0;
      return {
        ...item,
        cumulativePercentage: Number(cumulativePercentage.toFixed(2))
      };
    });

    return dataWithCumulative;
  }, [baseFilteredReports, selectedFormat]);

  const paretoCutoffLabel = useMemo(() => {
    const cutoffItem = chartData.find(item => item.cumulativePercentage >= 80);
    return cutoffItem ? cutoffItem.label : undefined;
  }, [chartData]);

  const monthName = useMemo(() => {
    if (!month) return '';
    return format(parseISO(`${month}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase());
  }, [month]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
            title="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-gray-800 font-bold">
            <BarChart2 className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl">Pareto Línea {linea} - Por Motivo</h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="format-filter" className="text-xs font-bold text-gray-500 uppercase">Filtrar Formato:</label>
            <select
              id="format-filter"
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
              className="text-sm font-bold border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-1.5 bg-white shadow-sm"
            >
              <option value="all">Todos los Formatos</option>
              {availableFormats.map(f => (
                <option key={f} value={f.toString()}>{f} cc</option>
              ))}
            </select>
          </div>
          <div className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg whitespace-nowrap">
            {monthName}
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {chartData.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No hay paradas registradas para la Línea {linea} en {monthName}.
          </div>
        ) : (
          <div className="h-[500px] w-full min-w-0 min-h-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <ComposedChart
                data={chartData}
                margin={{
                  top: 20,
                  right: 20,
                  bottom: 80, // Extra bottom margin for angled labels
                  left: 20,
                }}
              >
                <CartesianGrid stroke="#f5f5f5" strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="label" 
                  angle={-45} 
                  textAnchor="end" 
                  interval={0} 
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  height={80}
                />
                <YAxis 
                  yAxisId="left" 
                  orientation="left" 
                  stroke="#3b82f6"
                  label={{ value: 'Minutos', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#3b82f6' } }}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  stroke="#ef4444" 
                  domain={[0, 100]}
                  label={{ value: '% Acumulado', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#ef4444' } }}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip 
                  formatter={(value: number, name: string) => {
                    if (name === 'Minutos') return [`${value} min`, name];
                    if (name === '% Acumulado') return [`${value}%`, name];
                    return [value, name];
                  }}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Bar yAxisId="left" dataKey="minutes" name="Minutos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumulativePercentage" name="% Acumulado" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }} />
                <ReferenceLine yAxisId="right" y={80} stroke="#f97316" strokeDasharray="5 5" label={{ position: 'top', value: '80%', fill: '#f97316', fontSize: 12, fontWeight: 'bold' }} />
                {paretoCutoffLabel && (
                  <ReferenceLine x={paretoCutoffLabel} yAxisId="right" stroke="#f97316" strokeDasharray="5 5" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      
      {/* Data Table */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
              Detalle por Motivo {selectedFormat !== 'all' ? `(${selectedFormat} cc)` : '(Todos los Formatos)'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-3 text-left font-bold text-gray-600 border-r border-gray-200">
                    Motivo
                  </th>
                  <th className="px-6 py-3 text-center font-bold text-gray-600 border-r border-gray-200">Minutos</th>
                  <th className="px-6 py-3 text-center font-bold text-gray-600">% Acumulado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {chartData.map((item, index) => (
                  <tr key={item.label} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-800 border-r border-gray-200 font-medium">
                      {index + 1}. {item.label}
                    </td>
                    <td className="px-6 py-3 text-center text-blue-700 font-bold border-r border-gray-200">
                      {item.minutes}
                    </td>
                    <td className={`px-6 py-3 text-center font-bold ${item.cumulativePercentage <= 80 ? 'text-green-600' : 'text-orange-600'}`}>
                      {item.cumulativePercentage}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
