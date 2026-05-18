import React, { useState } from 'react';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { Search, AlertTriangle, CheckCircle2, ChevronRight, Hash, Calendar, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedLine, setSelectedLine] = useState('L1');
  const [results, setResults] = useState<CoherenceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const checkCoherence = async () => {
    setLoading(true);
    setHasSearched(true);
    setResults([]);

    try {
      const reportsRef = collection(db, 'production_reports');
      const q = query(
        reportsRef,
        where('linea', '==', selectedLine),
        where('fecha', '>=', startDate),
        where('fecha', '<=', endDate),
        orderBy('fecha', 'asc'),
        orderBy('planilla', 'asc') // Secondary sort to help chronological order
      );

      const snap = await getDocs(q);
      const reports = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionReport));

      // Re-sort in memory more robustly if needed, but Firestore handles most of it.
      // Sometimes planilla numbers don't perfectly match time, but usually they do.
      // We rely on fecha + createdAt if planilla isn't enough, but usually fecha + turno/planilla works.
      
      const discrepancies: CoherenceError[] = [];

      for (let i = 0; i < reports.length - 1; i++) {
        const current = reports[i];
        const next = reports[i + 1];

        if (current.contFinal !== next.contInicial) {
          discrepancies.push({
            reportId: current.id!,
            nextReportId: next.id!,
            date: current.fecha,
            line: current.linea,
            planilla: current.planilla,
            nextPlanilla: next.planilla,
            finalCounter: current.contFinal || 0,
            expectedInitialCounter: current.contFinal || 0,
            actualInitialCounter: next.contInicial || 0,
            diff: (next.contInicial || 0) - (current.contFinal || 0),
            turno: current.turno,
            nextTurno: next.turno
          });
        }
      }

      setResults(discrepancies);
    } catch (error) {
      console.error("Error checking counter coherence:", error);
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
                <option value="L1">Línea 1</option>
                <option value="L2">Línea 2</option>
                <option value="L3">Línea 3</option>
                <option value="L4">Línea 4</option>
                <option value="L5">Línea 5</option>
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
