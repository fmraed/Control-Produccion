import { useState, useEffect, useMemo } from 'react';
import { useAppConfig } from '../hooks/useAppConfig';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  RefreshCw, 
  AlertCircle, 
  TrendingDown, 
  FlaskConical, 
  Calendar, 
  CheckCircle2, 
  XCircle, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  AlertTriangle,
  FileCheck,
  TrendingUp,
  Sliders,
  Database
} from 'lucide-react';
import { startOfWeek, addDays, format, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BOTELLAS_POR_PACK, SABORES_SIN_JARABE } from '../constants';
import { ProductionPlan } from '../types';

interface InsumoStock {
  codigo_articulo: string;
  nombre_articulo: string;
  stock_almacen: number;
  stock_piso: number;
  stock_final: number;
}

export function InsumosControlReport() {
  const { config } = useAppConfig();
  const [activeTab, setActiveTab] = useState<'capacity' | 'program'>('capacity');
  
  // SQL and Firebase data state
  const [stockData, setStockData] = useState<InsumoStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  
  // Weekly selection for calculations
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  // Filter
  const [selectedBrand, setSelectedBrand] = useState<string>('all');

  // Simulation / Local Stock overrides State
  const [simulationMode, setSimulationMode] = useState(false);
  const [simulatedStocks, setSimulatedStocks] = useState<Record<string, number>>({});

  const getFlavorsForBrand = (brand: string) => {
    if (!config) return [];
    return config.brandFlavorCombinations[brand] || [];
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(selectedWeek, i));
  }, [selectedWeek]);

  const startDateStr = format(weekDays[0], 'yyyy-MM-dd');
  const endDateStr = format(weekDays[6], 'yyyy-MM-dd');

  const fetchMappings = async () => {
    try {
      const mappingRef = doc(db, 'config', 'sql_insumo_mappings');
      const docSnap = await getDoc(mappingRef);
      if (docSnap.exists()) {
        setInsumoMappings(docSnap.data() as Record<string, string>);
      }
    } catch (err) {
      console.error("Error fetching insumo mappings:", err);
    }
  };

  const fetchStock = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/sql/insumosStock');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || "Error de red al consultar SQL");
      }
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || result.details || "Error desconocido");
      }
      setStockData(result.data || []);
    } catch (err: any) {
      console.error("Fetch stock error:", err);
      // If there's a connection error, suggest simulation mode
      setError(err.message || 'Error al conectar con el servidor SQL');
      if (Object.keys(simulatedStocks).length === 0) {
        setSimulationMode(true); // Auto-enable simulation so the UI shows calculations immediately
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  // Prepopulate simulated stock values with realistic defaults if they are empty
  useEffect(() => {
    if (config?.insumos) {
      const initialSims: Record<string, number> = {};
      config.insumos.forEach((insumo: string) => {
        // Find existing simulated or pre-calculated SQL stock if present
        const mappedCode = insumoMappings[insumo];
        const sqlMatch = stockData.find(s => (s.codigo_articulo || '').toString().trim() === (mappedCode || '').toString().trim());
        
        if (sqlMatch) {
          initialSims[insumo] = sqlMatch.stock_almacen;
        } else {
          // Defaults:
          if (insumo.toLowerCase().includes('azúcar')) initialSims[insumo] = 6500;
          else if (insumo.toLowerCase().includes('benzoato')) initialSims[insumo] = 250;
          else if (insumo.toLowerCase().includes('sorbato')) initialSims[insumo] = 180;
          else if (insumo.toLowerCase().includes('citrico') || insumo.toLowerCase().includes('cítrico')) initialSims[insumo] = 400;
          else if (insumo.toLowerCase().includes('esencia') || insumo.toLowerCase().includes('emulsión')) initialSims[insumo] = 150;
          else initialSims[insumo] = 800; // General fallbacks
        }
      });
      setSimulatedStocks(prev => {
        const merged = { ...initialSims, ...prev };
        return merged;
      });
    }
  }, [config?.insumos, stockData, insumoMappings]);

  // Load Firestore production plans for the selected week
  useEffect(() => {
    setPlansLoading(true);
    const qPlans = query(
      collection(db, 'production_plans'),
      where('date', '>=', startDateStr),
      where('date', '<=', endDateStr)
    );

    const unsubscribe = onSnapshot(qPlans, (snap) => {
      const dbPlans = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionPlan));
      // Only use published plans unless user wants to cross Drafts also, let's include all to be secure, or just Published
      const publishedPlans = dbPlans.filter(p => p.status === 'Published');
      setPlans(publishedPlans);
      setPlansLoading(false);
    }, (err) => {
      console.error("Error fetching weekly plans:", err);
      setPlansLoading(false);
    });

    return () => unsubscribe();
  }, [startDateStr, endDateStr]);

  useEffect(() => {
    fetchMappings().then(() => fetchStock());
  }, []);

  const handleUpdateSimulatedStock = (insumoName: string, value: number) => {
    setSimulatedStocks(prev => ({
      ...prev,
      [insumoName]: Math.max(0, value)
    }));
  };

  // Helper to read stock of an insumo
  const getInsumoStock = (insumoName: string): number => {
    if (simulationMode) {
      return simulatedStocks[insumoName] || 0;
    }
    const sqlCode = insumoMappings[insumoName];
    if (sqlCode) {
      const match = stockData.find(s => (s.codigo_articulo || '').toString().trim() === sqlCode.toString().trim());
      if (match) return match.stock_almacen;
    }
    return 0; // fallback if no code / no match
  };

  // 1. Calculations for Tab 1: Capacity estimation
  const capacityResults = useMemo(() => {
    if (!config) return [];

    const finalResults: any[] = [];

    config.brands.forEach(brand => {
      if (selectedBrand !== 'all' && selectedBrand !== brand) return;

      const brandFlavors = getFlavorsForBrand(brand).filter(sabor => !(config.saboresSinJarabe || SABORES_SIN_JARABE).includes(sabor));
      
      brandFlavors.forEach(sabor => {
        const matrixObj = config.insumosMatrix?.[brand]?.[sabor] || {};
        const requiredInsumos = Object.keys(matrixObj).filter(i => matrixObj[i] > 0);
        
        if (requiredInsumos.length === 0) return; // Parameters not set up for this brand flavor

        let maxUnits = Infinity;
        let limitingInsumo = '';
        let stockOfLimiting = 0;
        let reqOfLimiting = 0;

        requiredInsumos.forEach(insumoName => {
          const kgPerUnit = matrixObj[insumoName];
          const availableStock = getInsumoStock(insumoName);

          const possibleUnits = Math.floor(availableStock / kgPerUnit);
          if (possibleUnits < maxUnits) {
            maxUnits = possibleUnits;
            limitingInsumo = insumoName;
            stockOfLimiting = availableStock;
            reqOfLimiting = kgPerUnit;
          }
        });

        if (maxUnits === Infinity) maxUnits = 0;

        const litersPerUnit = config.syrupFormulas?.[brand]?.[sabor]?.liters || 0;
        const totalLitersSyrup = maxUnits * litersPerUnit;
        const totalLitersBeverage = totalLitersSyrup * 6; // Formula given: liters syrup * 6

        finalResults.push({
          brand,
          flavor: sabor,
          maxUnits,
          limitingInsumo,
          stockOfLimiting,
          reqOfLimiting,
          totalLitersSyrup,
          totalLitersBeverage
        });
      });
    });

    return finalResults.sort((a, b) => b.totalLitersBeverage - a.totalLitersBeverage);
  }, [config, insumoMappings, stockData, selectedBrand, simulatedStocks, simulationMode]);

  // 2. Calculations for Tab 2: Program Crossover Check
  const programCrossover = useMemo(() => {
    if (!config) return { requiredInsumosAgg: {}, programSummary: [], statusOk: true };

    const insumosRequiredSum: Record<string, number> = {};
    const listProductsAnalyzed: any[] = [];

    // Initialize required sums to 0 for all active config insumos so they appear in output
    config.insumos?.forEach((i: string) => {
      insumosRequiredSum[i] = 0;
    });

    plans.forEach(plan => {
      const { marca, sabor, tamano, plannedPacks } = plan;
      
      // Calculate beverage volume
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const bottlesTotal = plannedPacks * botellasPorPack;
      const beverageLiters = bottlesTotal * (tamano / 1000); // tamano is in mL, so we divide by 1000

      // Calculate required syrup liters (liters beverage = liters syrup * 6)
      const syrupLitersNeeded = beverageLiters / 6;

      // Calculate required syrup units based on liters per unit formula
      const syrupLitersPerUnit = config.syrupFormulas?.[marca]?.[sabor]?.liters || 0;
      const unitsRequired = syrupLitersPerUnit > 0 ? (syrupLitersNeeded / syrupLitersPerUnit) : 0;

      // Extract required ingredients for these units
      const matrixObj = config.insumosMatrix?.[marca]?.[sabor] || {};
      const productInsumoList: { name: string; kg: number }[] = [];

      Object.keys(matrixObj).forEach(insumoName => {
        const kgPerUnit = matrixObj[insumoName] || 0;
        if (kgPerUnit > 0) {
          const neededKg = unitsRequired * kgPerUnit;
          insumosRequiredSum[insumoName] = (insumosRequiredSum[insumoName] || 0) + neededKg;
          productInsumoList.push({ name: insumoName, kg: neededKg });
        }
      });

      listProductsAnalyzed.push({
        id: plan.id,
        date: plan.date,
        linea: plan.linea,
        shift: plan.shift,
        brand: marca,
        flavor: sabor,
        size: tamano,
        packs: plannedPacks,
        beverageLiters,
        syrupLitersNeeded,
        unitsRequired,
        productInsumoList
      });
    });

    // Cross-check requirements with stocks
    let statusOk = true;
    const itemsList = Object.keys(insumosRequiredSum).map(insumo => {
      const required = insumosRequiredSum[insumo];
      const stock = getInsumoStock(insumo);
      const isMet = stock >= required;
      if (!isMet && required > 0) statusOk = false;

      return {
        insumoName: insumo,
        requiredKg: required,
        stockKg: stock,
        isMet,
        deficit: isMet ? 0 : (required - stock)
      };
    });

    return {
      requiredInsumosAgg: itemsList,
      programSummary: listProductsAnalyzed,
      statusOk
    };
  }, [config, plans, insumoMappings, stockData, simulatedStocks, simulationMode]);


  if (loading && Object.keys(simulatedStocks).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl shadow-sm border border-gray-200">
        <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium">Buscando datos de stock y fórmulas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title & Stats Ribbon */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-tr from-indigo-500 to-indigo-600 p-3.5 rounded-2xl text-white shadow-md shadow-indigo-100">
              <FlaskConical className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">Control de Insumos</h2>
              <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5 font-medium">
                <Database className="w-4 h-4 text-gray-400" />
                Módulo de cubicación industrial y proyección de requerimientos
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Simulation Mode Switch */}
            <button
              id="sim-mode-toggle"
              onClick={() => setSimulationMode(!simulationMode)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-xs transition-all uppercase tracking-wider ${
                simulationMode 
                  ? 'bg-amber-500 border-amber-500 text-white shadow-sm' 
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Sliders className="w-4 h-4" />
              {simulationMode ? 'Modo Simulación: ACTIVADO' : 'Activar Simulación'}
            </button>

            <button
              id="refresh-stock-btn"
              onClick={fetchStock}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Buscando...' : 'Re-conectar SQL'}
            </button>
          </div>
        </div>

        {/* Dynamic connection alert helper if we fail to reach private local network on Cloud Run */}
        {error && !simulationMode && (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600 animate-pulse" />
            <div className="space-y-1">
              <h3 className="font-bold text-sm">Servidor SQL Local Inaccesible (Esperable en servidor remoto)</h3>
              <p className="text-xs leading-relaxed text-amber-700">
                La base de datos <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900">ARGENTINA</code> es de red interna y no es resuelta por DNS públicos. Hemos activado automáticamente el <strong>Modo Simulación</strong> para que puedas editar existencias manualmente y probar todo el flujo de cálculos sin bloqueos.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Tab Navigators */}
      <div className="flex bg-gray-100 p-1.5 rounded-xl gap-2 max-w-md">
        <button
          onClick={() => setActiveTab('capacity')}
          className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'capacity' 
              ? 'bg-white text-indigo-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Proyección de Capacidad
        </button>
        <button
          onClick={() => setActiveTab('program')}
          className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'program' 
              ? 'bg-white text-indigo-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          Cruce con Plan
        </button>
      </div>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Simulation Sandbox / Stock Panel */}
        <div className="xl:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm uppercase tracking-wide">
                <Sliders className="w-4 h-4 text-indigo-500" />
                Existencias Almacén
              </h3>
              {simulationMode ? (
                <span className="bg-amber-100 text-amber-800 text-[10px] uppercase font-black px-2 py-0.5 rounded">
                  Editando
                </span>
              ) : (
                <span className="bg-indigo-100 text-indigo-800 text-[10px] uppercase font-black px-2 py-0.5 rounded">
                  SQL Base
                </span>
              )}
            </div>

            {simulationMode && (
              <p className="text-[11px] text-amber-700 leading-relaxed mb-4 bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                Ajuste los valores de stock (Kg) en los campos a continuación para ver cómo se recalculan inmediatamente los limitantes y el programa.
              </p>
            )}

            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {config?.insumos?.map((insumo: string) => {
                const stockVal = getInsumoStock(insumo);
                const sqlCode = insumoMappings[insumo] || 'S/M';
                
                return (
                  <div key={insumo} className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-2">
                    <div className="flex justify-between items-start gap-1">
                      <span className="text-xs font-bold text-gray-800 leading-tight block truncate max-w-[155px]" title={insumo}>
                        {insumo}
                      </span>
                      <span className="text-[9px] font-mono text-gray-400 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                        {sqlCode}
                      </span>
                    </div>

                    {simulationMode ? (
                      <div className="relative rounded-md shadow-sm">
                        <input
                          title={`Ver/Editar stock de ${insumo}`}
                          type="number"
                          value={simulatedStocks[insumo] !== undefined ? simulatedStocks[insumo] : stockVal}
                          onChange={(e) => handleUpdateSimulatedStock(insumo, Number(e.target.value))}
                          className="w-full bg-white border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-xs text-right font-black focus:ring-2 focus:ring-amber-500 outline-none"
                          min="0"
                        />
                        <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[10px] font-black pointer-events-none text-gray-400">
                          Kg
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-gray-400 font-bold uppercase">Stock Almacén:</span>
                        <span className="text-xs font-black text-indigo-700 font-mono">
                          {Intl.NumberFormat('es-AR').format(stockVal)} kg
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              
              {(!config?.insumos || config.insumos.length === 0) && (
                <p className="text-xs text-gray-400 italic text-center py-4">
                  No hay insumos creados. Agréguelos desde la pestaña Admin &gt; Panel de Fórmulas.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Calculated Views Content based on active TAB */}
        <div className="xl:col-span-3 space-y-6">

          {/* CAPACITY TAB */}
          {activeTab === 'capacity' && (
            <div className="space-y-6">
              
              {/* Header inside report panel */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Proyección de Capacidad por Sabor</h3>
                    <p className="text-xs text-gray-500">Volumen máximo teorico de elaboración a parter de existencias e insumo limitante</p>
                  </div>
                  <div>
                    <select
                      title="Filtrar sabores por marca"
                      value={selectedBrand}
                      onChange={(e) => setSelectedBrand(e.target.value)}
                      className="pl-3 pr-8 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none text-gray-700 shadow-sm"
                    >
                      <option value="all">Todas las Marcas</option>
                      {config?.brands?.map((b: string) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-[11px] font-black uppercase tracking-wider">
                        <th className="px-5 py-3 text-left">Marca / Sabor</th>
                        <th className="px-4 py-3 text-right">Fórmula</th>
                        <th className="px-4 py-3 text-right">Unes. Máximas</th>
                        <th className="px-4 py-3 text-right text-indigo-700">Litros Jarabe</th>
                        <th className="px-4 py-3 text-right text-emerald-700 bg-emerald-50/30">Litros Bebida</th>
                        <th className="px-5 py-3 text-left text-orange-700 rounded-tr-lg">Insumo Limitante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {capacityResults.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                            No hay suficientes datos. Defina su matriz general de insumos y los litros de jarabe por unidad en el Admin Panel.
                          </td>
                        </tr>
                      ) : (
                        capacityResults.map((r, idx) => (
                          <tr key={`${r.brand}-${r.flavor}`} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-4 border-l-[3px] border-l-transparent hover:border-l-indigo-600">
                              <span className="text-[10px] font-black text-indigo-600 uppercase block tracking-wider leading-none mb-1">
                                {r.brand}
                              </span>
                              <span className="text-xs font-bold text-gray-900">{r.flavor}</span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className="text-[11px] text-gray-500 bg-gray-100 font-bold font-mono px-2 py-1 rounded">
                                {config.syrupFormulas?.[r.brand]?.[r.flavor]?.liters || 0} L/Un
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right font-black text-gray-800">
                              {Intl.NumberFormat('es-AR').format(r.maxUnits)}
                            </td>
                            <td className="px-4 py-4 text-right font-bold text-indigo-600 font-mono">
                              {Intl.NumberFormat('es-AR').format(Math.round(r.totalLitersSyrup))} L
                            </td>
                            <td className="px-4 py-4 text-right font-black text-emerald-600 font-mono bg-emerald-50/10">
                              {Intl.NumberFormat('es-AR').format(Math.round(r.totalLitersBeverage))} L
                            </td>
                            <td className="px-5 py-4">
                              {r.limitingInsumo ? (
                                <div className="space-y-1">
                                  <div className="font-semibold text-xs text-orange-700 flex items-center gap-1">
                                    <TrendingDown className="w-3.5 h-3.5" />
                                    <span>{r.limitingInsumo}</span>
                                  </div>
                                  <div className="text-[10px] text-gray-400 font-medium">
                                    Stock: <strong>{Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(r.stockOfLimiting)} kg</strong> | 
                                    Consumo: <strong>{r.reqOfLimiting} kg/Un</strong>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-emerald-600 italic text-xs font-bold">Sin restricciones (no requiere jarabe)</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE PROGRAM CROSS-OVER CHECK */}
          {activeTab === 'program' && (
            <div className="space-y-6">
              
              {/* Program Week Selector & Summary Banner */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Cruce de Insumos con Plan Semanal</h3>
                    <p className="text-xs text-gray-500">Verifique de inmediato si el stock del almacén cubre la planificación agregada</p>
                  </div>

                  {/* Calendar controller */}
                  <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200 shadow-sm self-start">
                    <button
                      title="Siguiente semana"
                      onClick={() => setSelectedWeek(prev => subDays(prev, 7))}
                      className="p-2 hover:bg-white text-gray-600 rounded-lg transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="px-3 text-center min-w-[210px]">
                      <span className="text-xs font-black block text-gray-800 uppercase tracking-tight">
                        {format(selectedWeek, "dd 'de' MMMM", { locale: es })}
                      </span>
                      <span className="text-[10px] font-bold text-gray-400">
                        al {format(addDays(selectedWeek, 6), "dd 'de' MMMM, yyyy", { locale: es })}
                      </span>
                    </div>
                    <button
                      title="Siguiente semana"
                      onClick={() => setSelectedWeek(prev => addDays(prev, 7))}
                      className="p-2 hover:bg-white text-gray-600 rounded-lg transition-all"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Status Dashboard Summary */}
                {plansLoading ? (
                  <div className="flex justify-center py-6">
                    <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : plans.length === 0 ? (
                  <div className="bg-gray-50 rounded-xl p-8 border border-dashed border-gray-300 text-center space-y-2">
                    <Calendar className="w-10 h-10 text-gray-400 mx-auto" />
                    <h4 className="font-bold text-gray-800">No hay planificación cargada</h4>
                    <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                      No existen planes de producción publicados para esta semana en la base de datos. Vaya a <strong>Planificación</strong> para cargar y publicar el cronograma.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Verdict Banner */}
                    {programCrossover.statusOk ? (
                      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-5 rounded-xl text-white shadow-md shadow-emerald-50 flex items-center gap-4">
                        <CheckCircle2 className="w-10 h-10 flex-shrink-0" />
                        <div>
                          <h4 className="font-black text-base tracking-tight uppercase">¡Todo OK para Producir!</h4>
                          <p className="text-xs opacity-90 leading-tight">
                            El stock disponible de todos los insumos satisface la planificación para la semana seleccionada. ({plans.length} planes analizados).
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gradient-to-r from-red-500 to-orange-600 p-5 rounded-xl text-white shadow-md shadow-red-50 flex items-center gap-4">
                        <XCircle className="w-10 h-10 flex-shrink-0" />
                        <div>
                          <h4 className="font-black text-base tracking-tight uppercase">Alerta: Insumos Insuficientes</h4>
                          <p className="text-xs opacity-90 leading-tight">
                            Se detectan faltantes en el almacén para cubrir las necesidades planteadas en los {plans.length} planes semanales. Revise los detalles abajo.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Program Requirements Crossed Matrix */}
                    <div className="space-y-4">
                      <h4 className="font-bold text-xs text-gray-700 uppercase tracking-widest block">Análisis de Ingredientes para el Plan</h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {programCrossover.requiredInsumosAgg.map(item => {
                          const percentCovered = item.requiredKg > 0 ? (item.stockKg / item.requiredKg) * 100 : 100;
                          
                          return (
                            <div key={item.insumoName} className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                              <div className="flex justify-between items-start gap-1 mb-2">
                                <div>
                                  <span className="font-bold text-xs text-gray-800 block truncate max-w-[200px]" title={item.insumoName}>
                                    {item.insumoName}
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    Requerido: <strong>{Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.requiredKg)} kg</strong>
                                  </span>
                                </div>

                                <div className="text-right">
                                  {item.requiredKg === 0 ? (
                                    <span className="bg-gray-200 text-gray-600 text-[9px] font-black uppercase px-2 py-0.5 rounded">
                                      Sin programar
                                    </span>
                                  ) : item.isMet ? (
                                    <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase px-2 py-0.5 rounded flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> OK
                                    </span>
                                  ) : (
                                    <span className="bg-red-100 text-red-800 text-[9px] font-black uppercase px-2 py-0.5 rounded flex items-center gap-1">
                                      <TrendingDown className="w-3 h-3 text-red-600 animate-pulse" /> FALTAN {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.deficit)} kg
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-medium text-gray-500">
                                  <span>Stock: {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.stockKg)} kg</span>
                                  {item.requiredKg > 0 && (
                                    <span>
                                      {Math.min(100, Math.round(percentCovered))}%
                                    </span>
                                  )}
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      item.requiredKg === 0 
                                        ? 'bg-gray-400' 
                                        : item.isMet 
                                          ? 'bg-emerald-500' 
                                          : 'bg-red-500'
                                    }`} 
                                    style={{ width: `${Math.min(100, percentCovered)}%` }} 
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Selected Week's Plans Breakdown */}
                    <div className="space-y-3 pt-4 border-t">
                      <h4 className="font-bold text-xs text-sidebar uppercase tracking-widest block">Desglose por Plan Cargado ({plans.length})</h4>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px] tracking-wider">
                              <th className="px-3 py-2 text-left">Día / Turno</th>
                              <th className="px-3 py-2 text-left">Marca &amp; Sabor</th>
                              <th className="px-3 py-2 text-right">Tamaño</th>
                              <th className="px-3 py-2 text-right">Cantidad de Packs</th>
                              <th className="px-3 py-2 text-right text-emerald-600">Beverage L</th>
                              <th className="px-3 py-2 text-right text-indigo-700">Syrup L</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {programCrossover.programSummary.map((planSummary) => {
                              return (
                                <tr key={planSummary.id || `${planSummary.date}-${planSummary.linea}-${planSummary.shift}`} className="hover:bg-gray-50/55">
                                  <td className="px-3 py-3 font-medium text-gray-900">
                                    <div className="font-bold capitalize">{format(parseISO(planSummary.date), "dd/MM - EE", { locale: es })}</div>
                                    <div className="text-[10px] text-gray-500">{planSummary.shift} (L{planSummary.linea})</div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <span className="text-[10px] font-bold text-indigo-600 uppercase block tracking-wide">{planSummary.brand}</span>
                                    <span className="font-semibold text-gray-800">{planSummary.flavor}</span>
                                  </td>
                                  <td className="px-3 py-3 text-right text-gray-600">
                                    {Intl.NumberFormat('es-AR').format(planSummary.size)} ml
                                  </td>
                                  <td className="px-3 py-3 text-right font-black text-gray-900 font-mono">
                                    {Intl.NumberFormat('es-AR').format(planSummary.packs)} pks
                                  </td>
                                  <td className="px-3 py-3 text-right font-bold text-emerald-600 font-mono">
                                    {Intl.NumberFormat('es-AR').format(Math.round(planSummary.beverageLiters))} L
                                  </td>
                                  <td className="px-3 py-3 text-right font-bold text-indigo-600 font-mono">
                                    {Intl.NumberFormat('es-AR').format(Math.round(planSummary.syrupLitersNeeded))} L
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
