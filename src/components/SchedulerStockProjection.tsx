import { useState, useEffect, useMemo, Fragment } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionPlan, MonthlyGoal } from '../types';
import { format, addDays, parseISO, subDays } from 'date-fns';
import { TrendingUp, Package, RefreshCw, AlertCircle } from 'lucide-react';
import { SQL_PRODUCT_MAPPING } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { es } from 'date-fns/locale';

interface SchedulerStockProjectionProps {
  selectedWeek?: Date;
  weekDays?: Date[];
}

export function SchedulerStockProjection({
  selectedWeek = new Date(),
  weekDays = Array.from({ length: 7 }, (_, i) => addDays(selectedWeek, i))
}: SchedulerStockProjectionProps) {
  const { config, availableBrands, availableSizes } = useAppConfig();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [sqlStock, setSqlStock] = useState<any[]>([]);
  const [sqlPending, setSqlPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sqlMappings, setSqlMappings] = useState<Record<string, string>>(SQL_PRODUCT_MAPPING);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const currentMonthStr = format(today, 'yyyy-MM');
  const selectedMonthStr = format(selectedWeek, 'yyyy-MM');

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

  const weekStartStr = format(weekDays[0], 'yyyy-MM-dd');

  useEffect(() => {
    fetchMappings();

    // Fetch goals for relevant month (fallback to current if needed)
    const qGoals = query(
      collection(db, 'monthly_goals'),
      where('month', '==', selectedMonthStr)
    );

    // Fetch plans from the minimum of today and selected week start
    const minDateStr = todayStr < weekStartStr ? todayStr : weekStartStr;

    const qPlans = query(
      collection(db, 'production_plans'),
      where('date', '>=', minDateStr)
    );

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyGoal)));
    });

    const unsubPlans = onSnapshot(qPlans, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionPlan));
      setPlans(list);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching plans for scheduler:", err);
      setLoading(false);
    });

    fetchSqlStock();

    return () => {
      unsubGoals();
      unsubPlans();
    };
  }, [selectedMonthStr, weekStartStr]);

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
      if (a.tamano !== b.tamano) return b.tamano - a.tamano;
      if (a.marca !== b.marca) return a.marca.localeCompare(b.marca);
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

      // Simulate day-by-day projection
      const daysCoverage: Record<string, number> = {};
      const daysStock: Record<string, number> = {};
      const daysPlanned: Record<string, number> = {};

      let runningStock = currentStockWithPending;

      // Projection simulation starts from the minimum of today and selected week start
      const startSimDate = new Date(todayStr < format(weekDays[0], 'yyyy-MM-dd') ? today : weekDays[0]);
      startSimDate.setHours(0,0,0,0);
      
      const endSimDate = new Date(weekDays[6]);
      endSimDate.setHours(0,0,0,0);

      let currentSimDate = new Date(startSimDate);
      let iterations = 0;
      
      while (currentSimDate <= endSimDate && iterations < 100) {
        iterations++;
        const dateStr = format(currentSimDate, 'yyyy-MM-dd');
        const dayOfWeek = currentSimDate.getDay();
        const isHoliday = config?.shiftConfig?.holidays?.includes(dateStr);
        
        let exitFactor = 1.0;
        if (dayOfWeek === 6) exitFactor = 0.5; // Saturday
        if (dayOfWeek === 0 || isHoliday) exitFactor = 0.0; // Sunday or Holiday (no exit)

        // Only subtract exit and add plans from today onwards
        const dateStrIsTodayOrFuture = dateStr >= todayStr;
        
        if (dateStrIsTodayOrFuture) {
          runningStock -= (avgDailyExit * exitFactor);
          
          // Add plans of old planner (type ProductionPlan)
          const plannedForDay = plans
            .filter(plan => plan.date === dateStr && plan.marca === p.marca && plan.sabor === p.sabor && plan.tamano === p.tamano)
            .reduce((sum, plan) => sum + Number(plan.plannedPacks || 0), 0);
          
          runningStock += plannedForDay;
          daysPlanned[dateStr] = plannedForDay;
        } else {
          daysPlanned[dateStr] = 0;
        }

        daysStock[dateStr] = runningStock;
        daysCoverage[dateStr] = avgDailyExit > 0 ? (runningStock / avgDailyExit) : 0;

        currentSimDate = addDays(currentSimDate, 1);
      }

      productsMap[p.key] = {
        ...p,
        totalOrdered: goal,
        avgDailyExit,
        currentStockWithPending,
        initialStock: sqlData.stock_inicial,
        daysCoverage,
        daysStock,
        daysPlanned
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
      let groupLabel = `Sub Total ${p.tamano} ${p.marca}`;
      let groupKey = `${p.tamano}-${p.marca}`;
      
      if (p.sabor === 'Sifon') {
        groupLabel = `Sub Total ${p.tamano} ${p.marca} Sifon`;
        groupKey = `${p.tamano}-${p.marca}-Sifon`;
      } else if (p.tamano === 1500) {
        groupLabel = `Sub Total 1500 Torasso + Axis`;
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
      if (pData) {
        groups[groupKey].ordered += pData.totalOrdered;
        groups[groupKey].stock += pData.currentStockWithPending;
        groups[groupKey].avgExit += pData.avgDailyExit;
        groups[groupKey].products.push(pData);

        gOrdered += pData.totalOrdered;
        gInitialStock += pData.initialStock;
      }
    });

    return { groups: Object.values(groups), grandOrdered: gOrdered, grandInitialStock: gInitialStock };
  }, [activeProducts, goals, sqlStock, sqlPending, plans, weekDays, todayStr, config]);

  if (loading) {
     return <div className="p-8 text-center text-slate-500">Cargando datos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            Proyección de Cobertura de Stock (Días)
          </h2>
          <p className="text-xs text-slate-500">
            Días de cobertura estimados basados en stock de SQL, salida promedio diaria y producción programada en el Programa Semanal.
          </p>
        </div>
        <button
          onClick={fetchSqlStock}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          title="Actualizar Stock"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="text-xs font-bold uppercase">Sincronizar Stock</span>
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 text-rose-700 p-4 rounded-xl flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-bold">{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-300 overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 border-y border-slate-300">
              <th className="px-3 py-3 font-black text-slate-600 uppercase text-xs border border-slate-300">Calibre</th>
              <th className="px-3 py-3 font-black text-slate-600 uppercase text-xs border border-slate-300">Marca</th>
              <th className="px-3 py-3 font-black text-slate-600 uppercase text-xs border border-slate-300">Sabor</th>
              <th className="px-3 py-3 font-black text-slate-600 uppercase text-xs border border-slate-300 bg-slate-200/50">Stock Actual</th>
              <th className="px-3 py-3 font-black text-slate-600 uppercase text-xs border border-slate-300 bg-slate-200/50">Salida Diaria</th>
              {weekDays.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const isHoliday = config?.shiftConfig?.holidays?.includes(dateStr);
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                const isDayToday = dateStr === todayStr;
                return (
                  <th 
                    key={day.toISOString()} 
                    className={`px-2 py-2 text-xs font-black uppercase text-center border border-slate-300 min-w-[100px] ${
                      isDayToday 
                        ? 'bg-indigo-500 text-white' 
                        : (isHoliday 
                            ? 'bg-rose-100 text-rose-800 border-rose-300' 
                            : (isWeekend ? 'bg-yellow-50 text-yellow-800' : 'text-slate-700 bg-slate-200'))
                    }`}
                  >
                    <div className="flex flex-col items-center">
                      <span>{format(day, "eeee", { locale: es }).substring(0, 3)}</span>
                      <span>{format(day, "dd/MM")}</span>
                      {isHoliday && (
                        <span className="text-[7.5px] font-black tracking-widest text-rose-700 bg-rose-200/60 px-1 py-0.5 rounded uppercase mt-0.5 border border-rose-300">
                          Feriado
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {groups.map((group, idx) => {
              return (
                <Fragment key={idx}>
                  {group.products.map(p => (
                    <tr key={p.key} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-bold text-slate-500 border border-slate-300">{p.tamano}cc</td>
                      <td className="px-3 py-2 font-bold text-slate-700 border border-slate-300">{p.marca}</td>
                      <td className="px-3 py-2 font-bold text-slate-700 border border-slate-300">{p.sabor}</td>
                      <td className="px-3 py-2 font-black text-indigo-700 border border-slate-300 bg-slate-50/50 text-right text-base">
                        {p.currentStockWithPending.toLocaleString('es-AR')}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-600 border border-slate-300 bg-slate-50/50 text-right">
                        {p.avgDailyExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </td>
                      {weekDays.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const cov = p.daysCoverage[dateStr] || 0;
                        const planned = p.daysPlanned[dateStr] || 0;
                        
                        let bgColor = 'bg-white';
                        let textColor = 'text-slate-800';
                        if (cov < 1) { bgColor = 'bg-rose-200'; textColor = 'text-rose-900'; }
                        else if (cov < 3) { bgColor = 'bg-orange-200'; textColor = 'text-orange-900'; }
                        else if (cov < 5) { bgColor = 'bg-yellow-200'; textColor = 'text-yellow-900'; }
                        else { bgColor = 'bg-slate-50'; }

                        return (
                          <td key={dateStr} className={`px-2 py-2 font-mono text-sm tracking-tight font-black text-center border border-slate-300 ${bgColor} ${textColor}`}>
                            <div className="flex flex-col items-center justify-center min-h-[36px]">
                              <span>{cov.toFixed(1)}</span>
                              {planned > 0 && (
                                <span className="text-[9px] font-black tracking-tighter text-indigo-700 bg-white border border-indigo-200 px-1 rounded mt-1 shadow-sm whitespace-nowrap">
                                  +{planned.toLocaleString('es-AR')}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 border-t-2 border-slate-200">
                    <td colSpan={3} className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-500 text-right">{group.label}</td>
                    <td className="px-3 py-1.5 font-black text-slate-800 border-l border-r border-slate-200 text-right">{group.stock.toLocaleString('es-AR')}</td>
                    <td className="px-3 py-1.5 font-black text-slate-800 border-r border-slate-200 text-right">{group.avgExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                    <td colSpan={weekDays.length} className="bg-slate-100"></td>
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
