import { useState, useEffect, useMemo, Fragment } from 'react';
import { collection, query, where, onSnapshot, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionReport, MonthlyGoal } from '../types';
import { format, parseISO, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, Database, Search, RefreshCw, AlertCircle, TrendingUp, Package, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate } from '../utils';
import { SQL_PRODUCT_MAPPING } from '../constants';

const FLAVOR_PRIORITY: Record<string, number> = {
  'Naranja': 1,
  'Manzana': 2,
  'Lima Limon': 3,
  'Pomelo Blanco': 4,
  'Cola': 5,
  'Granadina': 6,
  'Citrus': 7,
  'Agua': 8,
  'Soda': 9
};

export function StockControl() {
  const { config, availableBrands, availableSizes } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [sqlStock, setSqlStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [sqlMappings, setSqlMappings] = useState<Record<string, string>>(SQL_PRODUCT_MAPPING);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = auth.currentUser?.email === 'fraed.fordrinks@gmail.com';

  const fetchMappings = async () => {
    try {
      const mappingRef = doc(db, 'config', 'sql_mappings');
      const docSnap = await getDoc(mappingRef);
      if (docSnap.exists()) {
        setSqlMappings(docSnap.data() as Record<string, string>);
      }
    } catch (err) {
      console.error("Error fetching mappings:", err);
    }
  };

  const fetchSqlStock = async (month: string) => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/sql/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month })
      });
      const result = await response.json();
      if (result.success) {
        setSqlStock(result.data);
      } else {
        setError(result.details ? `${result.error}: ${result.details}` : result.error || "Error al conectar con SQL Server");
      }
    } catch (err) {
      console.error("Error fetching SQL stock:", err);
      setError("Error de red al consultar SQL");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMappings();
    
    const qReports = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', `${selectedMonth}-01`),
      where('fecha', '<=', `${selectedMonth}-31`)
    );

    const qGoals = query(
      collection(db, 'monthly_goals'),
      where('month', '==', selectedMonth)
    );

    const unsubReports = onSnapshot(qReports, (snap) => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionReport)));
    });

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyGoal)));
      setLoading(false);
    });

    fetchSqlStock(selectedMonth);

    return () => {
      unsubReports();
      unsubGoals();
    };
  }, [selectedMonth]);

  const activeProducts = useMemo(() => {
    if (!config) return [];
    const products: { marca: string, sabor: string, tamano: number, key: string }[] = [];
    
    availableBrands.forEach(brand => {
      availableSizes.forEach(size => {
        const allowedFlavors = config.activeProducts?.[brand]?.[size.toString()] || config.brandFlavorCombinations[brand] || [];
        allowedFlavors.forEach(flavor => {
          if (config.enabledFlavors?.[flavor] !== false) {
            products.push({
              marca: brand,
              sabor: flavor,
              tamano: Number(size),
              key: `${brand}|${flavor}|${size}`
            });
          }
        });
      });
    });

    return products.sort((a, b) => {
      if (a.marca !== b.marca) return a.marca.localeCompare(b.marca);
      if (a.tamano !== b.tamano) return b.tamano - a.tamano;
      const priorityA = FLAVOR_PRIORITY[a.sabor] || 999;
      const priorityB = FLAVOR_PRIORITY[b.sabor] || 999;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.sabor.localeCompare(b.sabor);
    });
  }, [config, availableBrands, availableSizes]);

  const dataByProduct = useMemo(() => {
    const productsMap: Record<string, any> = {};
    const today = new Date();
    const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd');
    const isCurrentMonth = selectedMonth === format(today, 'yyyy-MM');
    
    let daysElapsed = 0;
    if (isCurrentMonth) {
      daysElapsed = today.getDate();
    } else {
      const monthDate = parseISO(`${selectedMonth}-01`);
      daysElapsed = endOfMonth(monthDate).getDate();
    }

    activeProducts.forEach(p => {
      const productReports = reports.filter(r => 
        r.marca === p.marca && r.sabor === p.sabor && r.tamano === p.tamano
      );
      
      const totalProducedMonth = productReports.reduce((sum, r) => sum + (r.paquetes || 0), 0);
      const producedYesterday = productReports
        .filter(r => r.fecha === yesterdayStr)
        .reduce((sum, r) => sum + (r.paquetes || 0), 0);

      const goal = goals.find(g => g.marca === p.marca && g.sabor === p.sabor && g.tamano === p.tamano)?.quantity || 0;
      
      const mappingKey = `${p.sabor}-${p.tamano}`;
      const sqlCode = sqlMappings[mappingKey];
      const sqlData = sqlStock.find(s => s.codigo === sqlCode) || { stock_actual: 0, salida_acumulada: 0, stock_inicial: 0 };

      // Salida calculada = Stock Inicial + Producción Mensual - Stock Actual
      const accumulatedExit = Math.max(0, sqlData.stock_inicial + totalProducedMonth - sqlData.stock_actual);

      // Promedio salida diaria = Total Pedido Mes / 21 (días hábiles típicos)
      const avgDailyExit = goal / 21;
      
      // Días de cobertura = Stock Actual / Promedio salida diaria
      const coverageDays = avgDailyExit > 0 ? Math.floor(sqlData.stock_actual / avgDailyExit) : 0;

      const fulfillment = goal > 0 ? (accumulatedExit / goal) * 100 : 0;

      productsMap[p.key] = {
        ...p,
        totalOrdered: goal,
        currentStock: sqlData.stock_actual,
        producedYesterday,
        avgDailyExit,
        coverageDays,
        fulfillment,
        initialStock: sqlData.stock_inicial,
        accumulatedExit,
        totalProducedMonth,
        pending: 0,
        income: 0
      };
    });

    return productsMap;
  }, [activeProducts, reports, goals, sqlStock, sqlMappings, selectedMonth]);

  const groupTotals = useMemo(() => {
    interface GroupData {
      label: string;
      ordered: number;
      stock: number;
      yesterday: number;
      avgExit: number;
      fulfillment: number;
      initialStock: number;
      accumulatedExit: number;
      products: any[];
    }
    const groups: Record<string, GroupData> = {};

    activeProducts.forEach(p => {
      // Custom grouping based on image
      let groupLabel = `Sub Total ${p.marca} ${p.tamano}`;
      let groupKey = `${p.marca}-${p.tamano}`;
      
      if (p.sabor === 'Sifon') {
        groupLabel = `Sub Total ${p.marca} ${p.tamano} Sifon`;
        groupKey = `${p.marca}-${p.tamano}-Sifon`;
      } else if (p.tamano === 1500) {
        groupLabel = `Sub Total Torasso + Axis 1500`;
        groupKey = `1500-Mixed`;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          label: groupLabel,
          ordered: 0,
          stock: 0,
          yesterday: 0,
          avgExit: 0,
          fulfillment: 0,
          initialStock: 0,
          accumulatedExit: 0,
          products: []
        };
      }
      const pData = dataByProduct[p.key];
      groups[groupKey].ordered += pData.totalOrdered;
      groups[groupKey].stock += pData.currentStock;
      groups[groupKey].yesterday += pData.producedYesterday;
      groups[groupKey].avgExit += pData.avgDailyExit;
      groups[groupKey].initialStock += pData.initialStock;
      groups[groupKey].accumulatedExit += pData.accumulatedExit;
      groups[groupKey].products.push(pData);
    });

    // Calculate group fulfillment after sums
    Object.values(groups).forEach(g => {
      g.fulfillment = g.ordered > 0 ? (g.accumulatedExit / g.ordered) * 100 : 0;
    });

    return groups;
  }, [activeProducts, dataByProduct]);

  const groupValues = Object.values(groupTotals) as any[];

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div>
          <h2 className="text-xl font-black text-gray-900 uppercase tracking-tighter flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-600" />
            Control de Stock y Salidas
          </h2>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">Sincronizado con SQL Server</p>
        </div>
        
        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-xl border-gray-200 text-sm font-bold focus:ring-blue-500 focus:border-blue-500 p-2 pl-3 pr-10 bg-gray-50 border transition-all"
          >
            {Array.from({ length: 12 }, (_, i) => {
              const d = subDays(new Date(), i * 30);
              return format(d, 'yyyy-MM');
            }).map(m => (
              <option key={m} value={m}>
                {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).toUpperCase()}
              </option>
            ))}
          </select>

          <button
            onClick={() => fetchSqlStock(selectedMonth)}
            disabled={refreshing}
            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-100 disabled:opacity-50"
            title="Actualizar Stock desde SQL"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100/80 border-b border-gray-200">
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Marca</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Sabor</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Calibre</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200 bg-gray-200/30">Total Pedido Mes</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200 bg-blue-50/50">Stock {format(new Date(), 'dd/MM/yyyy')}</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Prod. Mensual</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Promedio Salida Diaria</th>
                <th className="px-6 py-3 text-xs font-black text-blue-900 uppercase tracking-widest border-r border-gray-300 bg-blue-50">Días Cover.</th>
                <th className="px-3 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-r border-gray-200 bg-gray-50">% Objet. Mes</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-200">Stock Inicial</th>
                <th className="px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest">Salida Acumulada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groupValues.map((group, index) => (
                <Fragment key={index}>
                  {group.products.map((p: any) => (
                    <tr key={p.key} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-4 py-3 text-xs font-black text-gray-900 border-r border-gray-100 italic">{p.marca}</td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-600 border-r border-gray-100">{p.sabor}</td>
                      <td className="px-4 py-3 text-xs font-mono font-bold text-gray-500 border-r border-gray-100">{p.tamano}</td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-600 border-r border-gray-100 bg-gray-50/30">
                        {p.totalOrdered.toLocaleString('es-AR')}
                      </td>
                      <td className="px-4 py-3 text-sm font-black text-blue-700 border-r border-gray-100 bg-blue-50/20">
                        {p.currentStock.toLocaleString('es-AR')}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-600 border-r border-gray-100">
                        {p.totalProducedMonth.toLocaleString('es-AR')}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-600 border-r border-gray-100">
                        {p.avgDailyExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-6 py-3 border-r border-gray-200 text-center ${
                        p.coverageDays < 5 ? 'bg-red-500 shadow-inner' :
                        p.coverageDays < 10 ? 'bg-yellow-400 shadow-inner' :
                        'bg-green-500 shadow-inner'
                      }`}>
                        <div className="flex flex-col items-center">
                          <span className="text-lg font-black text-white drop-shadow-sm leading-none">
                            {p.coverageDays}
                          </span>
                          <span className="text-[8px] font-black text-white/90 uppercase tracking-tighter">
                            Días
                          </span>
                        </div>
                      </td>
                      <td className={`px-3 py-3 text-xs font-bold border-r border-gray-100 text-center ${
                        p.fulfillment >= 100 ? 'text-green-700 bg-green-50/30' : 
                        p.fulfillment >= 80 ? 'text-blue-700 bg-blue-50/30' : 
                        p.fulfillment >= 50 ? 'text-orange-700 bg-orange-50/30' : 'text-red-700 bg-red-50/30'
                      }`}>
                        {p.fulfillment.toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-500 border-r border-gray-100 italic">
                        {p.initialStock.toLocaleString('es-AR')}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-900 bg-gray-50/50">
                        {p.accumulatedExit.toLocaleString('es-AR')}
                      </td>
                    </tr>
                  ))}
                  {/* SUbtotal Row */}
                  <tr className="bg-cyan-500 text-white font-black">
                    <td colSpan={3} className="px-4 py-2 text-[10px] uppercase tracking-widest">{group.label}</td>
                    <td className="px-4 py-2 text-sm">{group.ordered.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2 text-sm">{group.stock.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2 text-sm">{group.products.reduce((sum, p) => sum + p.totalProducedMonth, 0).toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2 text-sm">{group.avgExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 border-r border-cyan-400 bg-cyan-600 text-center">
                      {/* Subtotal coverage can be an average or just blank, we'll keep it simple */}
                    </td>
                    <td className="px-4 py-2 text-sm text-cyan-100 border-r border-cyan-400 text-center">{group.fulfillment.toFixed(0)}%</td>
                    <td className="px-4 py-2 text-sm italic opacity-80 border-r border-cyan-400">{group.initialStock.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2 text-sm bg-gray-800/20">{group.accumulatedExit.toLocaleString('es-AR')}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            {/* Grand Total Footer */}
            <tfoot className="bg-blue-900 text-white font-black">
              <tr>
                <td colSpan={3} className="px-4 py-4 text-xs uppercase tracking-widest">Total General</td>
                <td className="px-4 py-4 text-base">
                  {groupValues.reduce((sum, g) => sum + g.ordered, 0).toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-4 text-base">
                  {groupValues.reduce((sum, g) => sum + g.stock, 0).toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-4 text-base">
                  {groupValues.reduce((sum, g) => sum + g.products.reduce((s, p) => s + p.totalProducedMonth, 0), 0).toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-4 text-base">
                  {groupValues.reduce((sum, g) => sum + g.avgExit, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </td>
                <td className="px-6 py-4 bg-blue-800"></td>
                <td className="px-4 py-4 text-base bg-blue-950 text-center text-blue-200">
                  {(() => {
                    const totalOrdered = groupValues.reduce((sum, g) => sum + g.ordered, 0);
                    const totalExit = groupValues.reduce((sum, g) => sum + g.accumulatedExit, 0);
                    return totalOrdered > 0 ? ((totalExit / totalOrdered) * 100).toFixed(0) : '0';
                  })()}%
                </td>
                <td className="px-4 py-4 text-base italic opacity-80 border-l border-blue-950">
                  {groupValues.reduce((sum, g) => sum + g.initialStock, 0).toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-4 text-base bg-gray-900/40">
                  {groupValues.reduce((sum, g) => sum + g.accumulatedExit, 0).toLocaleString('es-AR')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
