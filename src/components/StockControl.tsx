import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { motion } from 'motion/react';
import { collection, query, where, onSnapshot, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionReport, MonthlyGoal } from '../types';
import { format, parseISO, startOfMonth, endOfMonth, subDays, addDays, getDate, getDaysInMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, Database, Search, RefreshCw, AlertCircle, TrendingUp, Package, Clock, AlertTriangle, CheckCircle2, Calendar, Save, Sparkles, Info } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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
  const [activeTab, setActiveTab] = useState<'grid' | 'evolution'>('grid');
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [sqlStock, setSqlStock] = useState<any[]>([]);
  const [sqlPending, setSqlPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [sqlMappings, setSqlMappings] = useState<Record<string, string>>(SQL_PRODUCT_MAPPING);
  const [initialStockOverrides, setInitialStockOverrides] = useState<Record<string, number>>({});
  const [initialStockLoaded, setInitialStockLoaded] = useState(false);
  const [editingStockKey, setEditingStockKey] = useState<string | null>(null);
  const [editingStockValue, setEditingStockValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [viewingLiveSql, setViewingLiveSql] = useState(false);

  // Auto-save ref
  const hasAttemptedAutoSave = useRef(false);

  // Daily stock states
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [dailyStocksList, setDailyStocksList] = useState<any[]>([]);
  const [savedDailyStocks, setSavedDailyStocks] = useState<Record<string, number>>({});
  const [dailyStocksLoaded, setDailyStocksLoaded] = useState(false);
  const [dailyStocksInfo, setDailyStocksInfo] = useState<any>(null);
  const [savingDailySnapshot, setSavingDailySnapshot] = useState(false);

  // Selector for the line chart
  const [selectedChartProduct, setSelectedChartProduct] = useState<string>('');
  const [selectedChartPeriod, setSelectedChartPeriod] = useState<'week' | 'month' | 'all'>('week');

  // Daily stock inline editing states
  const [editingDailyKey, setEditingDailyKey] = useState<string | null>(null);
  const [editingDailyValue, setEditingDailyValue] = useState<string>('');

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

  const handleSaveInitialStock = async (key: string) => {
    if (!isAdmin) return;
    const numValue = parseInt(editingStockValue, 10);
    if (isNaN(numValue)) return;
    
    try {
      await setDoc(doc(db, 'monthly_stock_init', selectedMonth), {
        [key]: numValue
      }, { merge: true });
      setEditingStockKey(null);
    } catch (err) {
      console.error(err);
      setError("Error al guardar stock inicial.");
    }
  };

  const handleSaveDailySnapshot = async () => {
    setSavingDailySnapshot(true);
    setError(null);
    try {
      const stocksToSave: Record<string, number> = {};
      activeProducts.forEach(p => {
        const pData = dataByProduct[p.key];
        stocksToSave[p.key] = pData ? pData.currentStock : 0;
      });

      await setDoc(doc(db, 'daily_stocks', selectedDate), {
        date: selectedDate,
        stocks: stocksToSave,
        savedAt: new Date().toISOString(),
        savedBy: auth.currentUser?.email || 'Sistema'
      });
    } catch (err) {
      console.error("Error saving daily snapshot:", err);
      setError("Error al guardar el historial diario.");
    } finally {
      setSavingDailySnapshot(false);
    }
  };

  const handleSaveDailyStockItem = async (key: string) => {
    const numValue = parseInt(editingDailyValue, 10);
    if (isNaN(numValue)) return;

    try {
      const updatedStocks = { ...savedDailyStocks, [key]: numValue };
      // If no saved list exists yet for this date, pre-populate other items using latest stock values
      if (Object.keys(savedDailyStocks).length === 0) {
        activeProducts.forEach(p => {
          if (p.key !== key) {
            const legacyKey = `${p.sabor}-${p.tamano}`;
            const mappingKey = `${p.marca}-${p.sabor}-${p.tamano}`;
            const sqlCode = sqlMappings[mappingKey] || sqlMappings[legacyKey];
            const sqlData = sqlStock.find(s => (s.codigo || '').toString().trim() === (sqlCode || '').toString().trim());
            updatedStocks[p.key] = sqlData?.stock_actual || 0;
          }
        });
      }

      await setDoc(doc(db, 'daily_stocks', selectedDate), {
        date: selectedDate,
        stocks: updatedStocks,
        savedAt: new Date().toISOString(),
        savedBy: auth.currentUser?.email || 'Sistema'
      });
      setEditingDailyKey(null);
    } catch (err) {
      console.error("Error saving single daily stock:", err);
      setError("Error al actualizar stock.");
    }
  };

  const fetchSqlStock = async (month: string, isManual = false) => {
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
        setSqlPending(result.pendingData || []);
        if (isManual) {
          setViewingLiveSql(true);
        }
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

  // Synchronize selectedMonth when selectedDate changes
  useEffect(() => {
    hasAttemptedAutoSave.current = false;
    const computedMonth = selectedDate.substring(0, 7);
    if (computedMonth !== selectedMonth) {
      setSelectedMonth(computedMonth);
    }
  }, [selectedDate, selectedMonth]);

  // Listen to single selected date daily stocks snapshot
  useEffect(() => {
    setDailyStocksLoaded(false);
    const unsubDaily = onSnapshot(doc(db, 'daily_stocks', selectedDate), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSavedDailyStocks(data.stocks || {});
        setDailyStocksInfo(data);
      } else {
        setSavedDailyStocks({});
        setDailyStocksInfo(null);
      }
      setDailyStocksLoaded(true);
    });

    return unsubDaily;
  }, [selectedDate]);

  // Listen to all daily stocks list for plotting trends
  useEffect(() => {
    const unsubAllDaily = onSnapshot(collection(db, 'daily_stocks'), (snap) => {
      const list = snap.docs.map(d => ({
        date: d.id,
        stocks: d.data().stocks || {},
        savedBy: d.data().savedBy,
        savedAt: d.data().savedAt
      }));
      list.sort((a, b) => a.date.localeCompare(b.date));
      setDailyStocksList(list);
    });

    return unsubAllDaily;
  }, []);

  useEffect(() => {
    fetchMappings();
    
    // Fetch a slightly wider date range to account for logical shifts that cross month boundaries
    const [year, month] = selectedMonth.split('-');
    const startDateObj = subDays(parseISO(`${selectedMonth}-01`), 2);
    const endDateObj = addDays(new Date(parseInt(year), parseInt(month), 0), 2);
    
    const qReports = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', format(startDateObj, 'yyyy-MM-dd')),
      where('fecha', '<=', format(endDateObj, 'yyyy-MM-dd'))
    );

    const qGoals = query(
      collection(db, 'monthly_goals'),
      where('month', '==', selectedMonth)
    );

    const unsubReports = onSnapshot(qReports, (snap) => {
      const allReports = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionReport));
      const filteredByLogical = allReports.filter(r => getLogicalDate(r).startsWith(selectedMonth));
      setReports(filteredByLogical);
    });

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyGoal)));
      setLoading(false);
    });

    const initStockRef = doc(db, 'monthly_stock_init', selectedMonth);
    const unsubInitStock = onSnapshot(initStockRef, (docSnap) => {
      if (docSnap.exists()) {
        setInitialStockOverrides(docSnap.data() as Record<string, number>);
      } else {
        setInitialStockOverrides({});
      }
      setInitialStockLoaded(true);
    });

    fetchSqlStock(selectedMonth);

    return () => {
      unsubReports();
      unsubGoals();
      unsubInitStock();
    };
  }, [selectedMonth]);

  const activeProducts = useMemo(() => {
    if (!config) return [];
    const products: { marca: string, sabor: string, tamano: number, key: string, isExternal: boolean }[] = [];
    
    availableBrands.forEach(brand => {
      availableSizes.forEach(size => {
        const sizeStr = size.toString();
        const brandActive = config.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const hasSizeConfig = brandActive && sizeStr in brandActive;
        
        // If the brand has ANY specific product configuration, only use that.
        // Do not fall back to brandFlavorCombinations if they've started defining active products.
        const allowedFlavors = hasSizeConfig
          ? brandActive[sizeStr]
          : (hasBrandConfig ? [] : (config.brandFlavorCombinations[brand] || []));

        allowedFlavors.forEach(flavor => {
          if (config.enabledFlavors?.[flavor] !== false) {
            const isExternal = (config.externalProducts?.[brand]?.[sizeStr] || []).includes(flavor);
            products.push({
              marca: brand,
              sabor: flavor,
              tamano: Number(size),
              key: `${brand}|${flavor}|${size}`,
              isExternal
            });
          }
        });
      });
    });

    return products.sort((a, b) => {
      if (a.isExternal !== b.isExternal) return a.isExternal ? 1 : -1;
      if (a.marca !== b.marca) return a.marca.localeCompare(b.marca);
      if (a.tamano !== b.tamano) return b.tamano - a.tamano;
      const priorityA = FLAVOR_PRIORITY[a.sabor] || 999;
      const priorityB = FLAVOR_PRIORITY[b.sabor] || 999;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.sabor.localeCompare(b.sabor);
    });
  }, [config, availableBrands, availableSizes]);

  // Default chart selection to general local
  useEffect(() => {
    if (activeProducts.length > 0 && !selectedChartProduct) {
      setSelectedChartProduct('GENERAL_LOCAL');
    }
  }, [activeProducts, selectedChartProduct]);

  useEffect(() => {
    if (initialStockLoaded && sqlStock.length > 0 && activeProducts.length > 0) {
      const toSave: Record<string, number> = {};
      let needsSave = false;

      activeProducts.forEach(p => {
        if (initialStockOverrides[p.key] === undefined) {
          const mappingKey = `${p.marca}-${p.sabor}-${p.tamano}`;
          const legacyKey = `${p.sabor}-${p.tamano}`;
          const sqlCode = sqlMappings[mappingKey] || sqlMappings[legacyKey];
          const sqlData = sqlStock.find((s: any) => (s.codigo || '').toString().trim() === (sqlCode || '').toString().trim());
          if (sqlData) {
            toSave[p.key] = sqlData.stock_actual;
            needsSave = true;
          } else {
            toSave[p.key] = 0;
            needsSave = true;
          }
        }
      });

      if (needsSave) {
        setDoc(doc(db, 'monthly_stock_init', selectedMonth), toSave, { merge: true })
          .catch(err => console.error("Error auto-saving initial stocks:", err));
      }
    }
  }, [initialStockLoaded, sqlStock, activeProducts, selectedMonth, initialStockOverrides, sqlMappings]);

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

    const hasSavedStock = Object.keys(savedDailyStocks).length > 0;

    activeProducts.forEach(p => {
      const productReports = reports.filter(r => 
        r.marca === p.marca && r.sabor === p.sabor && r.tamano === p.tamano
      );
      
      const totalProducedMonth = productReports.reduce((sum, r) => sum + (r.paquetes || 0), 0);
      const producedYesterday = productReports
        .filter(r => getLogicalDate(r) === yesterdayStr)
        .reduce((sum, r) => sum + (r.paquetes || 0), 0);

      const goal = goals.find(g => g.marca === p.marca && g.sabor === p.sabor && g.tamano === p.tamano)?.quantity || 0;
      
      const mappingKey = `${p.marca}-${p.sabor}-${p.tamano}`;
      const legacyKey = `${p.sabor}-${p.tamano}`;
      const sqlCode = sqlMappings[mappingKey] || sqlMappings[legacyKey];
      
      const sqlData = sqlStock.find(s => (s.codigo || '').toString().trim() === (sqlCode || '').toString().trim()) || { stock_actual: 0, salida_acumulada: 0, stock_inicial: 0 };
      
      const requiresQC = (config.qualityControlFlavors || ['Agua']).some(f => f.trim() === p.sabor.trim());
      const isExternal = (config.externalProducts?.[p.marca]?.[p.tamano.toString()] || []).includes(p.sabor);
      
      const pendingData = requiresQC 
        ? sqlPending.find(s => (s.codigo || '').toString().trim() === (sqlCode || '').toString().trim()) 
        : undefined;

      let pendingQuantity = 0;
      if (pendingData) {
        if (pendingData.nu_cantidadPendiente || pendingData.nu_CantidadPendiente) {
          const val = pendingData.nu_cantidadPendiente || pendingData.nu_CantidadPendiente;
          pendingQuantity = val !== 0 ? val : (pendingData.nu_cantidad || pendingData.nu_Cantidad || 0);
        } else {
          pendingQuantity = pendingData.nu_cantidad || pendingData.nu_Cantidad || 0;
        }
      }

      const initialStock = initialStockOverrides[p.key] !== undefined ? initialStockOverrides[p.key] : (sqlData.stock_inicial + pendingQuantity);
      
      // For external products, we use income instead of production if available
      const income = 0; 

      // If daily snapshot was locked/saved, use it; otherwise fallback to the current live SQL stock value
      const currentStockInstance = hasSavedStock && !viewingLiveSql
        ? (savedDailyStocks[p.key] !== undefined ? savedDailyStocks[p.key] : 0)
        : sqlData.stock_actual;

      // Salida calculada = Stock Inicial + Producción/Ingresos - Stock Actual (Instancia)
      const accumulatedExit = Math.max(0, initialStock + totalProducedMonth + income - currentStockInstance);

      // Promedio salida diaria = Total Pedido Mes / 21 (días hábiles típicos)
      const avgDailyExit = goal / 21;
      
      // Días de cobertura = (Stock Actual + Por Liberar) / Promedio salida diaria
      const coverageDays = avgDailyExit > 0 ? Math.floor((currentStockInstance + pendingQuantity) / avgDailyExit) : 0;

      const packsPorPaleta = config.packsPorPaleta?.[p.tamano] || 1;
      const totalPalettes = (currentStockInstance + pendingQuantity) / packsPorPaleta;
      const isStackable = config.stackableFlavors?.includes(p.sabor) ?? true;
      const positionsUsed = isStackable ? Math.ceil(totalPalettes / 2) : Math.ceil(totalPalettes);

      const fulfillment = goal > 0 ? (accumulatedExit / goal) * 100 : 0;
      const prodFulfillment = goal > 0 ? (totalProducedMonth / goal) * 100 : 0;

      productsMap[p.key] = {
        ...p,
        totalOrdered: goal,
        currentStock: currentStockInstance,
        producedYesterday,
        avgDailyExit,
        coverageDays,
        fulfillment,
        prodFulfillment,
        initialStock: initialStock,
        accumulatedExit,
        totalProducedMonth,
        pending: pendingQuantity,
        positionsUsed,
        income: 0
      };
    });

    return productsMap;
  }, [activeProducts, reports, goals, sqlStock, sqlPending, sqlMappings, selectedMonth, savedDailyStocks, initialStockOverrides, config, viewingLiveSql]);

  // Auto-save the daily snapshot if it is today, has not been saved yet, SQL data is populated, and we haven't already attempted to save it
  useEffect(() => {
    const isToday = selectedDate === format(new Date(), 'yyyy-MM-dd');
    const hasData = activeProducts.length > 0 && Object.keys(dataByProduct).length > 0 && sqlStock.length > 0;
    const isNotSavedYet = Object.keys(savedDailyStocks).length === 0;

    if (
      isToday &&
      dailyStocksLoaded &&
      hasData &&
      isNotSavedYet &&
      !savingDailySnapshot &&
      !hasAttemptedAutoSave.current
    ) {
      hasAttemptedAutoSave.current = true;
      console.log('Automated saving of daily stock snapshot...');
      handleSaveDailySnapshot();
    }
  }, [
    selectedDate,
    dailyStocksLoaded,
    activeProducts.length,
    dataByProduct,
    sqlStock.length,
    savedDailyStocks,
    savingDailySnapshot
  ]);

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
      pending: number;
      positionsUsed: number;
      prodFulfillment: number;
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
          prodFulfillment: 0,
          initialStock: 0,
          accumulatedExit: 0,
          pending: 0,
          positionsUsed: 0,
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
      groups[groupKey].pending += pData.pending;
      groups[groupKey].positionsUsed += pData.positionsUsed;
      groups[groupKey].products.push(pData);
    });

    // Calculate group fulfillment after sums
    Object.values(groups).forEach(g => {
      g.fulfillment = g.ordered > 0 ? (g.accumulatedExit / g.ordered) * 100 : 0;
      const totalProduced = g.products.reduce((s, p) => s + p.totalProducedMonth, 0);
      g.prodFulfillment = g.ordered > 0 ? (totalProduced / g.ordered) * 100 : 0;
    });

    return groups;
  }, [activeProducts, dataByProduct]);

  const groupValues = Object.values(groupTotals) as any[];

  const storageOccupancy = useMemo(() => {
    if (!config?.warehousePositions) return { used: 0, total: 2300, percentage: 0 };
    const used = groupValues.reduce((sum, g) => sum + g.positionsUsed, 0);
    const total = config.warehousePositions;
    return {
      used,
      total,
      percentage: (used / total) * 100
    };
  }, [groupValues, config?.warehousePositions]);

  const overallFulfillment = useMemo(() => {
    const totalOrdered = groupValues.reduce((sum, g) => sum + g.ordered, 0);
    const totalExit = groupValues.reduce((sum, g) => sum + g.accumulatedExit, 0);
    return totalOrdered > 0 ? (totalExit / totalOrdered) * 100 : 0;
  }, [groupValues]);

  const monthProgress = useMemo(() => {
    const daysInMonth = getDaysInMonth(parseISO(selectedMonth + '-01'));
    const currentMonthStr = format(new Date(), 'yyyy-MM');
    let currentDay = 0;
    if (selectedMonth === currentMonthStr) {
      currentDay = getDate(new Date());
    } else if (selectedMonth < currentMonthStr) {
      currentDay = daysInMonth;
    }
    return {
      days: daysInMonth,
      current: currentDay,
      percentage: (currentDay / daysInMonth) * 100
    };
  }, [selectedMonth]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div>
          <h2 className="text-xl font-black text-gray-900 uppercase tracking-tighter flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-600" />
            Control de Stock y Salidas
          </h2>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">
            Visualizador Temporal de Stock por Día
          </p>
        </div>

        {/* Date and Month selectors inside header */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Day selection */}
          <div className="flex flex-col">
            <span className="text-[9px] font-black tracking-widest uppercase text-gray-400 mb-1">FECHA STOCK</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-xl border-gray-200 text-sm font-bold focus:ring-blue-500 focus:border-blue-500 p-2 bg-gray-50 border transition-all"
              />
            </div>
          </div>

          {/* Month forecast reference */}
          <div className="flex flex-col">
            <span className="text-[9px] font-black tracking-widest uppercase text-gray-400 mb-1">MES PRONÓSTICO</span>
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
          </div>

          <button
            onClick={() => fetchSqlStock(selectedMonth, true)}
            disabled={refreshing}
            className="self-end p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-105 disabled:opacity-50"
            title="Sincronizar SQL de nuevo"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Daily Freeze status banner & save button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 p-4 rounded-xl">
        <div className="flex flex-wrap items-center gap-3">
          {Object.keys(savedDailyStocks).length > 0 ? (
            <>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black border ${viewingLiveSql ? 'bg-amber-100 border-amber-200 text-amber-800' : 'bg-green-100 border-green-200 text-green-800'}`}>
                {viewingLiveSql ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                )}
                <div>
                  <p className="leading-tight">{viewingLiveSql ? 'VIENDO TIEMPO REAL (IGNORANDO CONGELADO)' : 'VIENDO HISTORIAL GUARDADO (CONGELADO)'}</p>
                  <p className={`text-[9px] font-bold normal-case ${viewingLiveSql ? 'text-amber-600' : 'text-green-600'}`}>
                    {viewingLiveSql 
                      ? 'Datos sincronizados con SQL Server' 
                      : `Editado por ${dailyStocksInfo?.savedBy || 'Sistema'} (${format(parseISO(dailyStocksInfo?.savedAt || new Date().toISOString()), 'dd/MM/yyyy HH:mm')})`
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingLiveSql(!viewingLiveSql)}
                className="text-xs font-bold px-3 py-1.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 flex items-center gap-1.5 text-gray-700"
              >
                {viewingLiveSql ? 'Ver Congelado' : 'Ver Tiempo Real SQL'}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 bg-amber-100 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-xl text-xs font-black">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <p className="leading-tight">TIEMPO REAL (SIN CONGELAR EN HISTORIAL)</p>
                <p className="text-[9px] text-amber-600 font-bold normal-case">
                  Sincronizado con SQL Server actual
                </p>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 font-medium max-w-sm hidden md:block">
            Haz clic en las celdas de stock para editar manualmente si quieres fijar un stock específico para este día y guardarlo.
          </p>
        </div>

        <button
          onClick={handleSaveDailySnapshot}
          disabled={savingDailySnapshot}
          className="flex items-center justify-center gap-2 bg-slate-900 border border-slate-800 text-white rounded-xl py-2 px-4 text-xs font-bold hover:bg-slate-800 active:scale-95 transition-all shadow"
        >
          <Save className="w-4 h-4 shrink-0" />
          {savingDailySnapshot ? 'Guardando...' : Object.keys(savedDailyStocks).length > 0 ? 'Sobrescribir Registro Diario' : 'Congelar Stock en Historial'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}

      {/* Tabs Layout */}
      <div className="flex border-b border-gray-200 gap-6 mt-4">
        <button
          onClick={() => setActiveTab('grid')}
          className={`pb-4 text-sm font-bold transition-all relative ${
            activeTab === 'grid' ? 'text-blue-600 font-extrabold' : 'text-gray-400 hover:text-gray-600 font-medium'
          }`}
        >
          <div className="flex items-center gap-2 px-1">
            <Database className="w-4 h-4" />
            Planilla de Stock y Salidas
          </div>
          {activeTab === 'grid' && (
            <motion.div 
              layoutId="stock-tab-underline" 
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" 
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('evolution')}
          className={`pb-4 text-sm font-bold transition-all relative ${
            activeTab === 'evolution' ? 'text-blue-600 font-extrabold' : 'text-gray-400 hover:text-gray-600 font-medium'
          }`}
        >
          <div className="flex items-center gap-2 px-1">
            <TrendingUp className="w-4 h-4" />
            Evolución de Stock
          </div>
          {activeTab === 'evolution' && (
            <motion.div 
              layoutId="stock-tab-underline" 
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" 
            />
          )}
        </button>
      </div>

      {activeTab === 'grid' ? (
        <div className="space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="sm:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-500" />
                  Ocupación de Almacenamiento
                </h3>
                <span className={`text-lg font-black ${storageOccupancy.percentage > 90 ? 'text-red-600' : storageOccupancy.percentage > 75 ? 'text-orange-600' : 'text-blue-600'}`}>
                  {storageOccupancy.percentage.toFixed(1)}%
                </span>
              </div>
              
              <div className="relative w-full h-4 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div 
                  className={`h-full transition-all duration-1000 ease-out rounded-full ${
                    storageOccupancy.percentage > 90 ? 'bg-red-500' : 
                    storageOccupancy.percentage > 75 ? 'bg-orange-500' : 
                    'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, storageOccupancy.percentage)}%` }}
                />
              </div>
              
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-gray-500">
                <span>{storageOccupancy.used.toLocaleString('es-AR')} POSICIONES OCUPADAS</span>
                <span>CAPACIDAD: {storageOccupancy.total.toLocaleString('es-AR')} POS</span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-2xl shadow-lg border border-blue-500 flex flex-col justify-center text-white">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-white/10 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-blue-100" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-100">Posiciones Disponibles</span>
              </div>
              <div className="text-3xl font-black">
                {(storageOccupancy.total - storageOccupancy.used).toLocaleString('es-AR')}
              </div>
              <p className="text-[10px] font-medium text-blue-200 mt-1 uppercase mb-3">Libres para nuevos ingresos</p>

              <div className="mt-auto border-t border-white/10 pt-2 flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-[9px] font-bold text-blue-200 uppercase tracking-widest">
                  <span>Mes transcurrido</span>
                  <span>{monthProgress.percentage.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-black/20 rounded-full h-1 overflow-hidden">
                  <div 
                    className="bg-cyan-300 h-1 rounded-full transition-all duration-500"
                    style={{ width: `${monthProgress.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[9px] font-bold text-blue-200 uppercase tracking-widest mt-1">
                  <span>Despachado vs Objetivo</span>
                  <span>{overallFulfillment.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-black/20 rounded-full h-1 overflow-hidden">
                  <div 
                    className={`${overallFulfillment >= monthProgress.percentage ? 'bg-green-400' : 'bg-orange-400'} h-1 rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, overallFulfillment)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Active product spreadsheet table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100/80 border-y border-gray-300">
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Marca</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Sabor</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Calibre</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300 bg-gray-200/30">Total Pedido Mes</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-700 uppercase tracking-widest border border-gray-300 bg-blue-100/50 text-blue-900">
                      Stock {selectedDate ? format(parseISO(selectedDate), 'dd/MM/yyyy') : ''}
                    </th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300 bg-orange-50/50">Por Liberar</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Ingresos / Prod.</th>
                    <th className="px-3 py-3 text-xs font-bold text-gray-600 uppercase tracking-widest border border-gray-300 bg-gray-50">% Obj. Prod.</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Promedio Salida Diaria</th>
                    <th className="px-6 py-3 text-sm font-black text-blue-900 uppercase tracking-widest border border-gray-300 bg-blue-100">Días Cover.</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Stock Inicial</th>
                    <th className="px-4 py-3 text-xs font-black text-gray-600 uppercase tracking-widest border border-gray-300">Salida Acumulada</th>
                    <th className="px-3 py-3 text-xs font-bold text-gray-600 uppercase tracking-widest border border-gray-300 bg-gray-50">% Obj. Salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {groupValues.map((group, index) => {
                    const isExternalGroup = group.products.every((p: any) => p.isExternal);
                    return (
                      <Fragment key={index}>
                        {index === 0 && !group.products[0].isExternal && (
                          <tr className="bg-blue-50/50">
                            <td colSpan={13} className="px-4 py-2 text-[10px] font-black text-blue-800 uppercase tracking-widest text-center border-b border-blue-100">PRODUCCIÓN LOCAL (TUCUMÁN)</td>
                          </tr>
                        )}
                        {group.products[0].isExternal && (index === 0 || !groupValues[index-1].products[0].isExternal) && (
                          <tr className="bg-purple-50/50">
                            <td colSpan={13} className="px-4 py-2 text-[10px] font-black text-purple-800 uppercase tracking-widest text-center border-b border-purple-100">PRODUCTOS EXTERNOS (OTRAS PLANTAS)</td>
                          </tr>
                        )}
                        {group.products.map((p: any) => {
                          const isSelectedChartProductNode = selectedChartProduct === p.key;
                          return (
                            <tr 
                              key={p.key} 
                              onClick={() => {
                                setSelectedChartProduct(p.key);
                                setActiveTab('evolution');
                              }}
                              className={`hover:bg-gray-50 transition-all group cursor-pointer ${
                                isSelectedChartProductNode ? 'bg-blue-50/80 border-l-4 border-l-blue-600 shadow-sm' : ''
                              }`}
                            >
                              <td className="px-4 py-3 text-sm font-black text-gray-900 border border-gray-200 italic">{p.marca}</td>
                              <td className="px-4 py-3 text-sm font-bold text-gray-700 border border-gray-200 uppercase">
                                <div className="flex flex-col">
                                  <span className="truncate">{p.sabor}</span>
                                  {p.isExternal && (
                                    <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded w-fit font-black mt-0.5 tracking-tighter">EXTERNO</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm font-sans font-bold text-gray-600 border border-gray-200">{p.tamano}</td>
                              <td className="px-4 py-3 text-sm font-bold text-gray-700 border border-gray-200 bg-gray-50/30">
                                {p.totalOrdered.toLocaleString('es-AR')}
                              </td>
                              {/* Stock Column, inline editable! */}
                              <td 
                                className="px-4 py-3 text-base font-black text-blue-900 border border-gray-200 bg-blue-50/20 cursor-pointer hover:bg-blue-100/50 transition-all"
                                onClick={(e) => {
                                  setEditingDailyKey(p.key);
                                  setEditingDailyValue(p.currentStock.toString());
                                  e.stopPropagation();
                                }}
                              >
                                {editingDailyKey === p.key ? (
                                  <input
                                    type="number"
                                    autoFocus
                                    value={editingDailyValue}
                                    onChange={(e) => setEditingDailyValue(e.target.value)}
                                    onBlur={() => handleSaveDailyStockItem(p.key)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveDailyStockItem(p.key);
                                      if (e.key === 'Escape') setEditingDailyKey(null);
                                    }}
                                    className="w-[90px] p-1 border border-blue-400 rounded text-right ml-auto block focus:ring focus:ring-blue-200 outline-none"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <div className="flex items-center justify-between">
                                    <span>{p.currentStock.toLocaleString('es-AR')}</span>
                                    <span className="text-[10px] text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1">✎</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-base font-black text-orange-700 border border-gray-200 bg-orange-50/10">
                                {p.pending > 0 ? p.pending.toLocaleString('es-AR') : '-'}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-gray-700 border border-gray-200 italic">
                                {p.isExternal ? (
                                  <div className="flex flex-col">
                                    <span className="text-gray-400 line-through text-xs">{p.totalProducedMonth.toLocaleString('es-AR')}</span>
                                    <span className="text-[9px] text-purple-500 font-black">EXTERNO</span>
                                  </div>
                                ) : p.totalProducedMonth.toLocaleString('es-AR')}
                              </td>
                              <td className={`px-3 py-3 text-sm font-bold border border-gray-200 text-center ${
                                p.prodFulfillment >= 100 ? 'text-green-800 bg-green-50/50' : 
                                p.prodFulfillment >= 80 ? 'text-blue-800 bg-blue-50/50' : 
                                p.prodFulfillment >= 50 ? 'text-orange-805 bg-orange-50/50' : 'text-red-800 bg-red-50/50'
                              }`}>
                                {p.prodFulfillment.toFixed(0)}%
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-gray-700 border border-gray-200 italic">
                                {p.avgDailyExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                              </td>
                              <td className={`px-6 py-3 border border-gray-200 text-center ${
                                p.coverageDays < 5 ? 'bg-red-500 shadow-inner' :
                                p.coverageDays < 10 ? 'bg-yellow-400 shadow-inner' :
                                'bg-green-500 shadow-inner'
                              }`}>
                                <div className="flex flex-col items-center">
                                  <span className="text-lg font-black text-white drop-shadow-sm leading-none">
                                    {p.coverageDays}
                                  </span>
                                  <span className="text-[10px] font-black text-white/90 uppercase tracking-tighter">
                                    Días
                                  </span>
                                </div>
                              </td>
                              {/* Stock Inicial editable */}
                              <td 
                                className="px-4 py-3 text-sm font-bold text-gray-700 border border-gray-200 italic cursor-pointer hover:bg-gray-100 transition-colors"
                                onClick={(e) => {
                                  if (isAdmin) {
                                    setEditingStockKey(p.key);
                                    setEditingStockValue(p.initialStock.toString());
                                    e.stopPropagation();
                                  }
                                }}
                              >
                                {editingStockKey === p.key ? (
                                  <input
                                    type="number"
                                    autoFocus
                                    value={editingStockValue}
                                    onChange={(e) => setEditingStockValue(e.target.value)}
                                    onBlur={() => handleSaveInitialStock(p.key)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveInitialStock(p.key);
                                      if (e.key === 'Escape') setEditingStockKey(null);
                                    }}
                                    className="w-[80px] p-1 border border-blue-400 rounded text-right ml-auto block focus:ring focus:ring-blue-200 outline-none"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <div className="text-right w-[80px] ml-auto border-b border-dashed border-gray-300 pb-0.5">
                                    {p.initialStock.toLocaleString('es-AR')}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-base font-black text-gray-900 border border-gray-200 bg-gray-50/50">
                                {p.accumulatedExit.toLocaleString('es-AR')}
                              </td>
                              <td className={`px-3 py-3 text-sm font-bold border border-gray-200 text-center ${
                                p.fulfillment >= 100 ? 'text-green-800 bg-green-50/50' : 
                                p.fulfillment >= 80 ? 'text-blue-800 bg-blue-50/50' : 
                                p.fulfillment >= 50 ? 'text-orange-800 bg-orange-50/50' : 'text-red-800 bg-red-50/50'
                              }`}>
                                {p.fulfillment.toFixed(0)}%
                              </td>
                            </tr>
                          );
                        })}
                        {/* SUbtotal Row */}
                        <tr className={`${isExternalGroup ? 'bg-purple-600' : 'bg-cyan-500'} text-white font-black`}>
                          <td colSpan={3} className="px-4 py-2 text-[10px] uppercase tracking-widest">{group.label}</td>
                          <td className="px-4 py-2 text-sm">{group.ordered.toLocaleString('es-AR')}</td>
                          <td className="px-4 py-2 text-sm">{group.stock.toLocaleString('es-AR')}</td>
                          <td className="px-4 py-2 text-sm">{group.pending > 0 ? group.pending.toLocaleString('es-AR') : '-'}</td>
                          <td className="px-4 py-2 text-sm">
                            {isExternalGroup ? (
                               <span className="opacity-50 line-through">{group.products.reduce((sum: number, p: any) => sum + p.totalProducedMonth, 0).toLocaleString('es-AR')}</span>
                            ) : group.products.reduce((sum: number, p: any) => sum + p.totalProducedMonth, 0).toLocaleString('es-AR')}
                          </td>
                          <td className={`px-4 py-2 text-sm border-r text-center ${isExternalGroup ? 'text-purple-100 border-purple-500' : 'text-cyan-100 border-cyan-400'}`}>{group.prodFulfillment.toFixed(0)}%</td>
                          <td className="px-4 py-2 text-sm opacity-80">{group.avgExit.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                          <td className={`px-4 py-2 border-r ${isExternalGroup ? 'border-purple-500 bg-purple-700' : 'border-cyan-400 bg-cyan-600'} text-center`}></td>
                          <td className={`px-4 py-2 text-sm italic opacity-80 border-r ${isExternalGroup ? 'border-purple-500' : 'border-cyan-400'}`}>{group.initialStock.toLocaleString('es-AR')}</td>
                          <td className={`px-4 py-2 text-sm ${isExternalGroup ? 'bg-black/10' : 'bg-gray-800/20'}`}>{group.accumulatedExit.toLocaleString('es-AR')}</td>
                          <td className={`px-4 py-2 text-sm text-center ${isExternalGroup ? 'text-purple-100 border-purple-500' : 'text-cyan-100'}`}>{group.fulfillment.toFixed(0)}%</td>
                        </tr>
                      </Fragment>
                    );
                  })}
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
                    <td className="px-4 py-4 text-base text-orange-200">
                      {groupValues.reduce((sum, g) => sum + g.pending, 0).toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-4 text-base">
                      {groupValues.reduce((sum, g) => sum + g.products.reduce((s, p) => s + p.totalProducedMonth, 0), 0).toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-4 text-base bg-blue-950 text-center text-blue-200 border-r border-blue-900">
                      {(() => {
                        const totalOrdered = groupValues.reduce((sum, g) => sum + g.ordered, 0);
                        const totalProduced = groupValues.reduce((sum, g) => sum + g.products.reduce((s, p) => s + p.totalProducedMonth, 0), 0);
                        return totalOrdered > 0 ? ((totalProduced / totalOrdered) * 100).toFixed(0) : '0';
                      })()}%
                    </td>
                    <td className="px-4 py-4 text-base border-r border-blue-900">
                      {groupValues.reduce((sum, g) => sum + g.avgExit, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-6 py-4 bg-blue-800 border-r border-blue-900 font-bold"></td>
                    <td className="px-4 py-4 text-base italic opacity-80 border-r border-blue-950">
                      {groupValues.reduce((sum, g) => sum + g.initialStock, 0).toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-4 text-base bg-gray-900/40">
                      {groupValues.reduce((sum, g) => sum + g.accumulatedExit, 0).toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-4 text-base bg-blue-950 text-center text-blue-200">
                      {(() => {
                        const totalOrdered = groupValues.reduce((sum, g) => sum + g.ordered, 0);
                        const totalExit = groupValues.reduce((sum, g) => sum + g.accumulatedExit, 0);
                        return totalOrdered > 0 ? ((totalExit / totalOrdered) * 105).toFixed(0) : '0';
                      })()}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Wide majestic evolution tab */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Product Information and Controls (1 column) */}
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600 shrink-0" />
                  Evolución de Stock
                </h3>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                  Historial de stock diario
                </p>
              </div>

              {/* Selected Product summary display */}
              {selectedChartProduct && (() => {
                if (selectedChartProduct === 'GENERAL_LOCAL') {
                  const currentStockData = activeProducts
                    .filter(p => !p.isExternal)
                    .reduce((sum, p) => sum + (dataByProduct[p.key]?.currentStock ?? 0), 0);
                  
                  return (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-blue-600 block tracking-wider">GENERAL</span>
                        <span className="text-base font-extrabold text-slate-800 block">Todos (Locales)</span>
                        <span className="text-xs text-slate-400 font-bold font-mono">Total Prod. Local</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">STOCK ACTUAL</span>
                        <span className="text-2xl font-black text-slate-900 block font-mono">{currentStockData.toLocaleString('es-AR')}</span>
                      </div>
                    </div>
                  );
                }

                const [brand, flavor, size] = selectedChartProduct.split('|');
                const currentStockData = dataByProduct[selectedChartProduct]?.currentStock ?? 0;
                const unitSize = size ? `${size}cc` : '';
                return (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-blue-600 block tracking-wider">{brand}</span>
                      <span className="text-base font-extrabold text-slate-800 block">{flavor}</span>
                      <span className="text-xs text-slate-400 font-bold font-mono">{unitSize}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">STOCK SELECC.</span>
                      <span className="text-2xl font-black text-slate-900 block font-mono">{currentStockData.toLocaleString('es-AR')}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Dropdown in case user wants to change manually */}
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-slate-400 block tracking-wider mb-1.5">Seleccionar Producto:</span>
                  <select
                    value={selectedChartProduct}
                    onChange={(e) => setSelectedChartProduct(e.target.value)}
                    className="w-full rounded-xl border-gray-200 text-sm font-bold bg-slate-50 border p-3 text-slate-700 focus:ring-blue-500 focus:ring focus:border-blue-500 cursor-pointer focus:outline-none"
                  >
                    <option value="GENERAL_LOCAL">TODOS LOS PRODUCTOS (LOCALES)</option>
                    {activeProducts.map(p => (
                      <option key={p.key} value={p.key}>
                        {p.marca} {p.sabor} {p.tamano}cc
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-slate-400 block tracking-wider mb-1.5">Período:</span>
                  <select
                    value={selectedChartPeriod}
                    onChange={(e) => setSelectedChartPeriod(e.target.value as any)}
                    className="w-full rounded-xl border-gray-200 text-sm font-bold bg-slate-50 border p-3 text-slate-700 focus:ring-blue-500 focus:ring focus:border-blue-500 cursor-pointer focus:outline-none"
                  >
                    <option value="week">Última Semana</option>
                    <option value="month">Último Mes</option>
                    <option value="all">Todo el Historial</option>
                  </select>
                </div>
              </div>

              {/* stats summary of the trend */}
              {(() => {
                const chartData = dailyStocksList
                  .filter(item => {
                    if (selectedChartProduct !== 'GENERAL_LOCAL' && item.stocks[selectedChartProduct] === undefined) return false;
                    if (selectedChartProduct === 'GENERAL_LOCAL' && (!item.stocks || Object.keys(item.stocks).length === 0)) return false;
                    if (selectedChartPeriod === 'all') return true;
                    try {
                      const itemDate = parseISO(item.date);
                      const cutoffDate = selectedChartPeriod === 'week' ? subDays(new Date(), 7) : subDays(new Date(), 30);
                      return itemDate >= cutoffDate;
                    } catch (e) {
                      return true;
                    }
                  });
                if (chartData.length === 0) return null;
                const stocks = chartData.map(item => {
                  if (selectedChartProduct === 'GENERAL_LOCAL') {
                     return activeProducts
                        .filter(p => !p.isExternal)
                        .reduce((sum, p) => sum + (item.stocks[p.key] || 0), 0);
                  }
                  return item.stocks[selectedChartProduct] || 0;
                });
                const maxStock = Math.max(...stocks);
                const minStock = Math.min(...stocks);
                const avgStock = stocks.reduce((sum, val) => sum + val, 0) / stocks.length;
                return (
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 block tracking-wider">Métricas del Período</span>
                    <div className="grid grid-cols-3 gap-3 text-center uppercase tracking-widest text-[9px] font-bold">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                        <span className="block mb-1 text-slate-400 font-bold">MÍNIMO</span>
                        <span className="text-sm font-black text-slate-800 font-mono leading-none">{minStock.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                        <span className="block mb-1 text-slate-400 font-bold">PROMEDIO</span>
                        <span className="text-sm font-black text-slate-800 font-mono leading-none">{avgStock.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                        <span className="block mb-1 text-slate-400 font-bold">MÁXIMO</span>
                        <span className="text-sm font-black text-slate-800 font-mono leading-none">{maxStock.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <p className="text-xs text-gray-500 font-medium leading-relaxed bg-blue-50/50 p-4 rounded-xl border border-blue-100/30">
                💡 <span className="font-bold text-blue-800">Consejo:</span> Puedes volver a la pestaña de "Planilla de Stock" y hacer clic en cualquier fila para abrir automáticamente su gráfico aquí.
              </p>
            </div>

            {/* Chart container (2 columns) */}
            <div className="lg:col-span-2 flex flex-col justify-center min-h-[400px]">
              {(() => {
                const chartData = dailyStocksList
                  .filter(item => {
                    if (selectedChartProduct !== 'GENERAL_LOCAL' && item.stocks[selectedChartProduct] === undefined) return false;
                    if (selectedChartProduct === 'GENERAL_LOCAL' && (!item.stocks || Object.keys(item.stocks).length === 0)) return false;
                    if (selectedChartPeriod === 'all') return true;
                    try {
                      const itemDate = parseISO(item.date);
                      const cutoffDate = selectedChartPeriod === 'week' ? subDays(new Date(), 7) : subDays(new Date(), 30);
                      return itemDate >= cutoffDate;
                    } catch (e) {
                      return true;
                    }
                  })
                  .map(item => {
                    let displayDate = item.date;
                    try {
                      displayDate = format(parseISO(item.date), 'd/MM');
                    } catch (e) {
                      // ignore
                    }
                    
                    let stock = 0;
                    if (selectedChartProduct === 'GENERAL_LOCAL') {
                      stock = activeProducts
                        .filter(p => !p.isExternal)
                        .reduce((sum, p) => sum + (item.stocks[p.key] || 0), 0);
                    } else {
                      stock = item.stocks[selectedChartProduct] || 0;
                    }

                    return {
                      rawDate: item.date,
                      date: displayDate,
                      stock: stock
                    };
                  });

                if (chartData.length === 0) {
                  return (
                    <div className="bg-slate-50 border border-dashed border-slate-200 p-8 rounded-2xl text-center flex flex-col items-center justify-center space-y-3 py-16">
                      <Clock className="w-12 h-12 text-slate-300" />
                      <p className="text-sm font-black text-slate-500 leading-snug">
                        Faltan Datos Registrados en el Historial
                      </p>
                      <p className="text-xs text-slate-400 font-medium max-w-sm">
                        Haz clic en el botón "Congelar Stock en Historial" de la pestaña anterior para empezar a guardar registros diarios y visualizar tu gráfico aquí.
                      </p>
                    </div>
                  );
                }

                const CustomTooltip = ({ active, payload }: any) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-slate-900 border border-slate-800 text-white p-3 px-4 rounded-xl shadow-2xl text-xs font-sans">
                        <p className="font-bold text-slate-400 mb-1">{payload[0].payload.rawDate}</p>
                        <p className="font-extrabold text-base">
                          Stock: <span className="text-cyan-400">{payload[0].value.toLocaleString('es-AR')} un.</span>
                        </p>
                      </div>
                    );
                  }
                  return null;
                };

                return (
                  <div className="h-96 w-full pr-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 20, right: 10, left: -22, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis 
                          dataKey="date" 
                          tick={{ fontSize: 10, fontWeight: 'bold', fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                          dy={10}
                        />
                        <YAxis 
                          tick={{ fontSize: 10, fontWeight: 'bold', fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                          dx={-10}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line 
                          type="monotone" 
                          dataKey="stock" 
                          stroke="#2563eb" 
                          strokeWidth={4}
                          dot={{ r: 5, stroke: '#2563eb', strokeWidth: 2, fill: '#fff' }}
                          activeDot={{ r: 7, stroke: '#2563eb', strokeWidth: 3, fill: '#fff' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
