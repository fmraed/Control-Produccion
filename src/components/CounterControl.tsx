import React, { useState } from 'react';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { Search, AlertTriangle, CheckCircle2, ChevronRight, Hash, Calendar, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppConfig } from '../hooks/useAppConfig';

interface CoherenceError {
  reportId: string;
  nextReportId: string;
  date: string;
  line: string;
  planilla: string;
  nextPlanilla: string;
  finalCounter: number;
  expectedInitialCounter: number;
  actualInitialCounter: number;
  diff: number;
  turno: string;
  nextTurno: string;
}

export function CounterControl() {
  const { availableLines } = useAppConfig();
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedLine, setSelectedLine] = useState('');
  
  React.useEffect(() => {
    if (availableLines.length > 0 && !selectedLine) {
      setSelectedLine(availableLines[0]);
    }
  }, [availableLines, selectedLine]);

  const [results, setResults] = useState<CoherenceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkCoherence = async () => {
    setLoading(true);
    setHasSearched(false);
    setError(null);
    setResults([]);

    try {
      const reportsRef = collection(db, 'production_reports');
      // Simple query that only filters on date range (built-in single field index)
      const q = query(
        reportsRef,
        where('fecha', '>=', startDate),
        where('fecha', '<=', endDate)
      );

      const snap = await getDocs(q);
      const allReports = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionReport));

      // Filter by selected line in-memory
      const lineReports = allReports.filter(r => r.linea === selectedLine);

      // Sort in-memory chronologically
      // 1. By date ascending
      // 2. By Shift Order (Noche -> Mañana -> Tarde)
      // 3. By Planilla Code ascending
      // 4. By creation time (createdAt) ascending
      const shiftOrder: Record<string, number> = {
        'Noche': 1,
        'Mañana': 2,
        'Tarde': 3
      };

      const sortedReports = lineReports.sort((a, b) => {
        const dateCompare = a.fecha.localeCompare(b.fecha);
        if (dateCompare !== 0) return dateCompare;

        const shiftA = shiftOrder[a.turno] || 99;
        const shiftB = shiftOrder[b.turno] || 99;
        if (shiftA !== shiftB) {
          return shiftA - shiftB;
        }

        const planillaA = parseInt(a.planilla) || 0;
        const planillaB = parseInt(b.planilla) || 0;
        if (planillaA !== planillaB) {
          return planillaA - planillaB;
        }

        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
      
      const discrepancies: CoherenceError[] = [];

      for (let i = 0; i < sortedReports.length - 1; i++) {
        const current = sortedReports[i];
        const next = sortedReports[i + 1];

        // Ensure both final and initial counters are numbers before comparing
        const finalVal = current.contFinal || 0;
        const initialVal = next.contInicial || 0;

        if (finalVal !== initialVal) {
          discrepancies.push({
            reportId: current.id!,
            nextReportId: next.id!,
            date: current.fecha,
            line: current.linea,
            planilla: current.planilla,
            nextPlanilla: next.planilla,
            finalCounter: finalVal,
            expectedInitialCounter: finalVal,
            actualInitialCounter: initialVal,
            diff: initialVal - finalVal,
            turno: current.turno,
            nextTurno: next.turno
          });
        }
      }

      setResults(discrepancies);
      setHasSearched(true);
    } catch (err: any) {
      console.error("Error checking counter coherence:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-6">
          <Hash className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-900">Control de Coherencia de Contadores</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Fecha Desde
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Fecha Hasta
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Línea
            </label>
            <div className="relative">
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 appearance-none transition-all"
              >
                {availableLines.length === 0 && <option value="">Cargando...</option>}
                {availableLines.map(line => (
                  <option key={line} value={line}>{line}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={checkCoherence}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-2 px-6 rounded-lg transition-all shadow-sm"
          >
            {loading ? (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Chequear Coherencia
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-in fade-in duration-200">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-red-900">Error en la consulta de contadores</h4>
            <p className="text-xs text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {hasSearched && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {results.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-green-900 mb-1">¡Todo Coherente!</h3>
                <p className="text-green-700">No se encontraron saltos en los contadores para el periodo y línea seleccionados.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 bg-red-50 border-b border-red-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <h3 className="text-sm font-bold text-red-900">Se encontraron {results.length} discrepancias</h3>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Fecha / Turno</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Planilla A</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Planilla B</th>
                        <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Cont. Final A</th>
                        <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Cont. Inicial B</th>
                        <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Salto/Diferencia</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {results.map((err, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-bold text-gray-900">{format(parseISO(err.date), 'dd/MM/yyyy')}</div>
                            <div className="text-xs text-gray-500">{err.turno} → {err.nextTurno}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            #{err.planilla}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            #{err.nextPlanilla}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-mono font-bold text-gray-900">
                            {err.finalCounter.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-mono font-bold text-gray-900">
                            {err.actualInitialCounter.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-tighter ${
                              err.diff > 0 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {err.diff > 0 ? '+' : ''}{err.diff.toLocaleString()} bot.
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
