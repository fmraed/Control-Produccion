import { useState, useEffect, useMemo, Fragment } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionPlanV2, MonthlyGoal } from '../types';
import { format, addDays, parseISO, subDays } from 'date-fns';
import { TrendingUp, Package, RefreshCw, AlertCircle } from 'lucide-react';
import { SQL_PRODUCT_MAPPING } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';

import { es } from 'date-fns/locale';

export function SchedulerStockProjection() {
  const { config, availableBrands, availableSizes } = useAppConfig();
  const [plans, setPlans] = useState<ProductionPlanV2[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [sqlStock, setSqlStock] = useState<any[]>([]);
  const [sqlPending, setSqlPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sqlMappings, setSqlMappings] = useState<Record<string, string>>(SQL_PRODUCT_MAPPING);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  // We project for 10 days starting today
  const projectedDays = Array.from({ length: 11 }, (_, i) => addDays(today, i));

  // Current month string for goals and stock
  const currentMonthStr = format(today, 'yyyy-MM');

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

  const fetchSqlStock = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/sql/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: currentMonthStr })
      });
      const result = await response.json();
      if (result.success) {
        setSqlStock(result.data);
        setSqlPending(result.pendingData || []);
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

    // Fetch goals for daily exit
    const qGoals = query(
      collection(db, 'monthly_goals'),
      where('month', '==', currentMonthStr)
    );

    // Fetch plans starting from today (to accumulate planned production)
    const todayStr = format(today, 'yyyy-MM-dd');
    const qPlans = query(
      collection(db, 'production_plans_v2'),
      where('date', '>=', todayStr)
    );

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyGoal)));
    });

    const unsubPlans = onSnapshot(qPlans, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionPlanV2));
      setPlans(list);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });

    fetchSqlStock();

    return () => {
      unsubGoals();
      unsubPlans();
    };
  }, []);

  // Filter Active Products exactly like StockControl
  const activeProducts = useMemo(() => {
    if (!config) return [];
    const products: { marca: string, sabor: string, tamano: number, key: string, isExternal: boolean }[] = [];
    
    availableBrands.forEach(brand => {
      availableSizes.forEach(size => {
        const sizeStr = size.toString();
        const brandActive = config.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const hasSizeConfig = brandActive && sizeStr in brandActive;
        
        const allowedFlavors = hasSizeConfig
          ? brandActive[sizeStr]
          : (hasBrandConfig ? [] : (config.brandFlavorCombinations[brand] || []));

        allowedFlavors.forEach(flavor => {
          if (config.enabledFlavors?.[flavor] !== false) {
            const isExternal = (config.externalProducts?.[brand]?.[sizeStr] || []).includes(flavor);
            if (!isExternal) {
              products.push({
                marca: brand,
                sabor: flavor,
                tamano: Number(size),
                key: `${brand}|${flavor}|${size}`,
                isExternal: false
              });
            }
          }
        });
      });
    });

    return products.sort((a, b) => {
      if (a.isExternal !== b.isExternal) return a.isExternal ? 1 : -1;
      if (a.marca !== b.marca) return a.marca.localeCompare(b.marca);
      if (a.tamano !== b.tamano) return b.tamano - a.tamano;
      return a.sabor.localeCompare(b.sabor);
    });
  }, [config, availableBrands, availableSizes]);

  // Compute daily numbers for projection
  const { groups, grandOrdered, grandInitialStock } = useMemo(() => {
    const productsMap: Record<string, any> = {};

    activeProducts.forEach(p => {
      // Find Daily Exit (Avg)
      const goal = goals.find(g => g.marca === p.marca && g.sabor === p.sabor && g.tamano === p.tamano)?.quantity || 0;
      const avgDailyExit = goal / 21; // 21 working days

      // Find current stock (SQL stock)
      const mappingKey = `${p.marca}-${p.sabor}-${p.tamano}`;
      const legacyKey = `${p.sabor}-${p.tamano}`;
      const sqlCode = sqlMappings[mappingKey] || sqlMappings[legacyKey];
      const sqlData = sqlStock.find(s => (s.codigo || '').toString().trim() === (sqlCode || '').toString().trim()) || { stock_actual: 0, stock_inicial: 0 };
      
      const requiresQC = (config?.qualityControlFlavors || ['Agua']).some(f => f.trim() === p.sabor.trim());
      const pendingData = requiresQC 
        ? sqlPending.find(s => (s.codigo || '').toString().trim() === (sqlCode || '').toString().trim()) 
        : undefined;
      const pendingQuantity = pendingData?.nu_Cantidad || 0;
      
      const currentStockWithPending = sqlData.stock_actual + pendingQuantity;

      // Map production per projected day
      const dailyProduction: Record<string, number> = {};
      projectedDays.forEach(day => dailyProduction[format(day, 'yyyy-MM-dd')] = 0);

      // Distribute planned production into days
      plans.forEach(plan => {
        if (plan.type !== 'production') return;
        if (plan.marca === p.marca && plan.sabor === p.sabor && plan.tamano === p.tamano) {
          if (plan.date && dailyProduction[plan.date] !== undefined) {
             dailyProduction[plan.date] += Number(plan.plannedPacks || 0);
          }
        }
      });

      // Calculate Day by Day coverage
      const daysCoverage: Record<string, number> = {};
      let runningStock = currentStockWithPending;

      projectedDays.forEach((day, index) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        // Subtract daily exit based on day of week
        // Monday=1, ..., Saturday=6, Sunday=0
        const dayOfWeek = day.getDay();
        let exitFactor = 1.0;
        if (dayOfWeek === 6) exitFactor = 0.5; // Saturday
        if (dayOfWeek === 0) exitFactor = 0.0; // Sunday

        // First day (index 0) we might subtract or not, but generally yes, we subtract if it's the end of day.
        // Or if 'stock' is from today morning, by today evening we have generated exit.
        runningStock -= (avgDailyExit * exitFactor);
        
        // Add planned production for that day
        runningStock += dailyProduction[dateStr];

        daysCoverage[dateStr] = avgDailyExit > 0 ? (runningStock / avgDailyExit) : 0;
      });

      productsMap[p.key] = {
        ...p,
        totalOrdered: goal,
        avgDailyExit,
        currentStockWithPending,
        initialStock: sqlData.stock_inicial,
        daysCoverage
      };
    });

    const groups: Record<string, {
      label: string;
      ordered: number;
      stock: number;
      avgExit: number;
      products: any[];
    }> = {};

    let gOrdered = 0;
    let gInitialStock = 0;

    activeProducts.forEach(p => {
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
          avgExit: 0,
          products: []
        };
      }
      const pData = productsMap[p.key];
      groups[groupKey].ordered += pData.totalOrdered;
      groups[groupKey].stock += pData.currentStockWithPending;
      groups[groupKey].avgExit += pData.avgDailyExit;
      groups[groupKey].products.push(pData);

      gOrdered += pData.totalOrdered;
      gInitialStock += pData.initialStock; // Or currentStock
    });

    return { groups: Object.values(groups), grandOrdered: gOrdered, grandInitialStock: gInitialStock };
  }, [activeProducts, goals, sqlStock, sqlPending, plans, projectedDays]);

  if (loading) {
     return <div className="p-8 text-center text-slate-500">Cargando datos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            Proyección de Cobertura (Días)
          </h2>
          <p className="text-xs text-slate-500">
            Días de cobertura estimados basados en stock de SQL, salida promedio diaria y producción programada en el Gantt.
          </p>
        </div>
        <button
          onClick={fetchSqlStock}
          disabled={refreshing}
          className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          title="Actualizar Stock"
        >
          <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 text-rose-700 p-4 rounded-xl flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-bold">{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="px-3 py-2 font-black text-slate-500 uppercase">Marca</th>
              <th className="px-3 py-2 font-black text-slate-500 uppercase">Sabor</th>
              <th className="px-3 py-2 font-black text-slate-500 uppercase">Calibre</th>
              <th className="px-3 py-2 font-black text-slate-500 uppercase border-l border-r border-slate-200 bg-slate-200/50">Stock Actual</th>
              <th className="px-3 py-2 font-black text-slate-500 uppercase border-r border-slate-200 bg-slate-200/50">Salida Diaria</th>
              {projectedDays.map((day) => {
                const dayStr = format(day, "eeee dd/MM", { locale: es });
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <th key={day.toISOString()} className={`px-2 py-2 text-[10px] font-black uppercase text-center border-r border-slate-200 ${isWeekend ? 'bg-yellow-100/50 text-yellow-800' : 'text-slate-600'}`}>
                    {dayStr}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((group, idx) => {
              const isExternalGroup = group.products.every(p => p.isExternal);
              return (
                <Fragment key={idx}>
                  {group.products.map(p => (
                    <tr key={p.key} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-700">{p.marca}</td>
                      <td className="px-3 py-2 font-bold text-slate-700">{p.sabor}</td>
                      <td className="px-3 py-2 font-bold text-slate-500">{p.tamano}</td>
                      <td className="px-3 py-2 font-black text-indigo-700 border-l border-r border-slate-100 bg-slate-50/50 text-right">
                        {p.currentStockWithPending.toLocaleString('es-AR')}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-600 border-r border-slate-100 bg-slate-50/50 text-right">
                        {p.avgDailyExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </td>
                      {projectedDays.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const cov = p.daysCoverage[dateStr];
                        
                        let bgColor = 'bg-white';
                        let textColor = 'text-slate-700';
                        if (cov < 1) { bgColor = 'bg-rose-100'; textColor = 'text-rose-700'; }
                        else if (cov < 3) { bgColor = 'bg-orange-100'; textColor = 'text-orange-700'; }
                        else if (cov < 5) { bgColor = 'bg-yellow-100'; textColor = 'text-yellow-800'; }
                        else { bgColor = 'bg-white'; }

                        return (
                          <td key={dateStr} className={`px-2 py-2 font-mono text-[10px] font-bold text-center border-r border-slate-100 ${bgColor} ${textColor}`}>
                            {cov.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 border-t-2 border-slate-200">
                    <td colSpan={3} className="px-3 py-1 text-[9px] font-black uppercase text-slate-500 text-right">{group.label}</td>
                    <td className="px-3 py-1 font-black text-slate-800 border-l border-r border-slate-200 text-right">{group.stock.toLocaleString('es-AR')}</td>
                    <td className="px-3 py-1 font-black text-slate-800 border-r border-slate-200 text-right">{group.avgExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                    <td colSpan={projectedDays.length} className="bg-slate-100"></td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
