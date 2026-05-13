import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport, ElaboracionReport } from '../types';
import { Beaker, Calendar, BarChart3, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { SABORES, SABORES_SIN_JARABE, FLAVOR_COLORS } from '../constants';
import { getLogicalDate } from '../utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { useAppConfig } from '../hooks/useAppConfig';

export function SyrupReport() {
  const { config, shouldShowReport } = useAppConfig();
  const [productionReports, setProductionReports] = useState<ProductionReport[]>([]);
  const [elaboracionReports, setElaboracionReports] = useState<ElaboracionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [initialStocks, setInitialStocks] = useState<Record<string, number>>({});
  const [savingInitial, setSavingInitial] = useState<string | null>(null);

  useEffect(() => {
    // Fetch initial stocks for the selected month
    const docRef = doc(db, 'config', `syrup_initials_${selectedMonth}`);
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setInitialStocks(docSnap.data() as Record<string, number>);
      } else {
        setInitialStocks({});
      }
    });
    return () => unsub();
  }, [selectedMonth]);

  useEffect(() => {
    const qProd = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    const qElab = query(collection(db, 'elaboracion_reports'), orderBy('fecha', 'desc'));
    
    const unsubProd = onSnapshot(qProd, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      setProductionReports(reportsData);
    });

    const unsubElab = onSnapshot(qElab, (snapshot) => {
      const elabData: ElaboracionReport[] = [];
      snapshot.forEach((doc) => {
        elabData.push({ id: doc.id, ...doc.data() } as ElaboracionReport);
      });
      setElaboracionReports(elabData);
      setLoading(false);
    });

    return () => {
      unsubProd();
      unsubElab();
    };
  }, []);

  const months = useMemo(() => {
    const uniqueMonths = new Set<string>();
    const addMonth = (r: ProductionReport | ElaboracionReport) => {
      if ('origin' in r && !shouldShowReport(r as ProductionReport)) return;

      const logicalDate = getLogicalDate(r);
      if (logicalDate) {
        const date = parseISO(logicalDate);
        uniqueMonths.add(format(date, 'yyyy-MM'));
      }
    };
    productionReports.forEach(addMonth);
    elaboracionReports.forEach(addMonth);
    uniqueMonths.add(format(new Date(), 'yyyy-MM'));
    return Array.from(uniqueMonths).sort().reverse();
  }, [productionReports, elaboracionReports, shouldShowReport]);

  const filteredProd = useMemo(() => {
    return productionReports.filter(r => {
      if (!shouldShowReport(r)) return false;
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [productionReports, selectedMonth, shouldShowReport]);

  const filteredElab = useMemo(() => {
    return elaboracionReports.filter(r => {
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [elaboracionReports, selectedMonth]);

  const syrupStats = useMemo(() => {
    const stats: Record<string, { sabor: string, initial: number, real: number, teorico: number }> = {};
    const saboresSinJarabeCfg = config?.saboresSinJarabe || SABORES_SIN_JARABE;
    
    // Initialize flavors that normally use syrup
    SABORES.filter(s => !saboresSinJarabeCfg.includes(s)).forEach(sabor => {
      stats[sabor] = { sabor, initial: initialStocks[sabor] || 0, real: 0, teorico: 0 };
    });

    // 1. Calculate REAL from Elaboration Reports
    filteredElab.forEach(r => {
      if (saboresSinJarabeCfg.includes(r.sabor)) return;
      if (!stats[r.sabor]) {
        stats[r.sabor] = { sabor: r.sabor, initial: initialStocks[r.sabor] || 0, real: 0, teorico: 0 };
      }
      stats[r.sabor].real += (r.jarabeConsumido || 0);
    });

    // 2. Calculate THEORETICAL from Production Reports
    // Formula: (bottles * size) / 6000
    filteredProd.forEach(r => {
      if (!r.sabor || saboresSinJarabeCfg.includes(r.sabor)) return;
      if (!stats[r.sabor]) {
        stats[r.sabor] = { sabor: r.sabor, initial: initialStocks[r.sabor] || 0, real: 0, teorico: 0 };
      }
      
      const botellas = r.botellas || 0;
      const tamano = r.tamano || 0;
      const t = (botellas * tamano) / 6000;
      stats[r.sabor].teorico += t;
    });

    return Object.values(stats).map(s => {
      const available = s.initial + s.real;
      const desperdicio = s.real - s.teorico; 
      const stockFinal = available - s.teorico;
      return {
        ...s,
        available,
        desperdicio,
        stockFinal,
        porcentaje: s.teorico > 0 ? (desperdicio / s.teorico) * 100 : 0
      };
    })
    .filter(s => s.real > 0 || s.teorico > 0 || s.initial > 0)
    .sort((a, b) => b.real - a.real);
  }, [filteredProd, filteredElab, initialStocks]);

  const totals = useMemo(() => {
    return syrupStats.reduce((acc, s) => ({
      initial: acc.initial + s.initial,
      real: acc.real + s.real,
      teorico: acc.teorico + s.teorico,
      available: acc.available + s.available,
      stockFinal: acc.stockFinal + s.stockFinal,
      desperdicio: acc.desperdicio + s.desperdicio
    }), { initial: 0, real: 0, teorico: 0, available: 0, stockFinal: 0, desperdicio: 0 });
  }, [syrupStats]);

  const totalPorcentaje = totals.teorico > 0 ? (totals.desperdicio / totals.teorico) * 100 : 0;

  const handleUpdateInitial = async (sabor: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    try {
      setSavingInitial(sabor);
      const docRef = doc(db, 'config', `syrup_initials_${selectedMonth}`);
      await setDoc(docRef, { [sabor]: numValue }, { merge: true });
    } catch (error) {
      console.error("Error updating initial stock:", error);
    } finally {
      setSavingInitial(null);
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
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-700 font-medium">
          <Beaker className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg">Balance de Jarabes por Sabor</h2>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 min-w-[200px]"
          >
            {months.map(m => (
              <option key={m} value={m}>
                {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-500 font-bold uppercase mb-1">Arraste (Stock Inicial)</p>
          <p className="text-2xl font-black text-gray-900">{totals.initial.toLocaleString('es-AR', { maximumFractionDigits: 1 })} L</p>
          <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
            <Calendar className="w-3 h-3" />
            <span>Balance del mes anterior</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-500 font-bold uppercase mb-1">Consumo Real (Elab.)</p>
          <p className="text-2xl font-black text-indigo-900">{totals.real.toLocaleString('es-AR', { maximumFractionDigits: 1 })} L</p>
          <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
            <Beaker className="w-3 h-3" />
            <span>Suma de lotes elaborados</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-500 font-bold uppercase mb-1">Consumo Teórico (Prod.)</p>
          <p className="text-2xl font-black text-blue-900">{totals.teorico.toLocaleString('es-AR', { maximumFractionDigits: 1 })} L</p>
          <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
            <BarChart3 className="w-3 h-3" />
            <span>Botellas x Calibre / 6</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-500 font-bold uppercase mb-1">Stock Final Teórico</p>
          <div className="flex items-baseline gap-2">
            <p className={`text-2xl font-black ${totals.stockFinal < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {totals.stockFinal.toLocaleString('es-AR', { maximumFractionDigits: 1 })} L
            </p>
            {totals.stockFinal < 0 ? <TrendingDown className="w-4 h-4 text-red-500" /> : <TrendingUp className="w-4 h-4 text-emerald-500" />}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Estimado: Inicial + Real - Teórico</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-500 font-bold uppercase mb-1">% Desperdicio Global</p>
          <p className={`text-2xl font-black ${totalPorcentaje > 5 ? 'text-red-600' : 'text-indigo-600'}`}>
            {totalPorcentaje.toFixed(2)}%
          </p>
          <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-full transition-all ${totalPorcentaje > 5 ? 'bg-red-500' : 'bg-indigo-500'}`} 
              style={{ width: `${Math.min(100, Math.max(0, totalPorcentaje))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-bold text-gray-700 uppercase mb-6 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Comparativa Real vs Teórico por Sabor (Litros)
        </h3>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={syrupStats} layout="vertical" margin={{ left: 40, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
              <XAxis type="number" hide />
              <YAxis 
                dataKey="sabor" 
                type="category" 
                tick={{ fontSize: 10, fontWeight: 700, fill: '#475569' }} 
                width={120}
              />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-3 border border-gray-200 shadow-xl rounded-lg">
                        <p className="font-bold text-gray-900 border-b border-gray-100 pb-1 mb-2">{data.sabor}</p>
                        <div className="space-y-1">
                          <p className="text-xs flex justify-between gap-4">
                            <span className="text-gray-500">Real:</span>
                            <span className="font-bold text-indigo-600">{data.real.toLocaleString()} L</span>
                          </p>
                          <p className="text-xs flex justify-between gap-4">
                            <span className="text-gray-500">Teorico:</span>
                            <span className="font-bold text-blue-600">{data.teorico.toLocaleString()} L</span>
                          </p>
                          <p className="text-xs flex justify-between gap-4 border-t border-gray-50 pt-1">
                            <span className="text-gray-500">Desperdicio:</span>
                            <span className={`font-bold ${data.desperdicio > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {data.desperdicio.toLocaleString()} L ({data.porcentaje.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend verticalAlign="top" align="right" />
              <Bar dataKey="real" name="Real (Elab.)" radius={[0, 4, 4, 0]} barSize={20}>
                {syrupStats.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={FLAVOR_COLORS[entry.sabor] || '#6366f1'} opacity={0.8} />
                ))}
              </Bar>
              <Bar dataKey="teorico" name="Teórico (Prod.)" fill="#cbd5e1" radius={[0, 4, 4, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Detalle por Sabor</h3>
          <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
            Mes Seleccionado
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-4 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-100">Sabor</th>
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-100">Arraste (Inicial L)</th>
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-100">Jarabe Real (L)</th>
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-100">Stock Disponible (L)</th>
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-100">Jarabe Teórico (L)</th>
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-100">Stock Final Teórico (L)</th>
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-600 uppercase">% Desp. Prod.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {syrupStats.map((s, i) => (
                <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-4 border-r border-gray-100">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-2 h-6 rounded-full" 
                        style={{ backgroundColor: FLAVOR_COLORS[s.sabor] || '#cbd5e1' }}
                      />
                      <span className="font-bold text-gray-900">{s.sabor}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 border-r border-gray-100 text-center">
                    <div className="relative group">
                      <input 
                        type="number"
                        className={`w-20 px-2 py-1 text-center rounded border ${savingInitial === s.sabor ? 'border-blue-400 bg-blue-50' : 'border-gray-200 group-hover:border-blue-300'} focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all font-mono text-xs`}
                        value={s.initial || ''}
                        disabled={!!savingInitial}
                        onChange={(e) => handleUpdateInitial(s.sabor, e.target.value)}
                        placeholder="0"
                      />
                      {savingInitial === s.sabor && (
                        <div className="absolute -top-1 -right-1">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center border-r border-gray-100 font-medium">
                    {s.real.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-4 text-center border-r border-gray-100 text-gray-900 font-bold bg-indigo-50/30">
                    {s.available.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-4 text-center border-r border-gray-100 text-gray-600">
                    {s.teorico.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                  </td>
                  <td className={`px-4 py-4 text-center border-r border-gray-100 font-black ${s.stockFinal < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {s.stockFinal.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-2">
                       <span className={`text-sm font-black ${s.porcentaje > 5 ? 'text-red-700' : 'text-gray-900'}`}>
                         {s.porcentaje.toFixed(1)}%
                       </span>
                       {s.porcentaje > 7 && <AlertTriangle className="w-3 h-3 text-red-500" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 font-black text-gray-900">
              <tr>
                <td className="px-4 py-4 border-r border-gray-200">TOTAL MENSUAL</td>
                <td className="px-4 py-4 text-center border-r border-gray-200 bg-gray-50">
                  {totals.initial.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                </td>
                <td className="px-4 py-4 text-center border-r border-gray-200 text-indigo-700">
                  {totals.real.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                </td>
                <td className="px-4 py-4 text-center border-r border-gray-200 font-black text-indigo-800">
                  {totals.available.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                </td>
                <td className="px-4 py-4 text-center border-r border-gray-200">
                  {totals.teorico.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                </td>
                <td className={`px-4 py-4 text-center border-r border-gray-200 ${totals.stockFinal < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {totals.stockFinal.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                </td>
                <td className="px-4 py-4 text-center bg-gray-200">
                  {totalPorcentaje.toFixed(2)}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
