import React, { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useAppConfig } from '../hooks/useAppConfig';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc } from 'firebase/firestore';
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
  Database,
  Layers,
  Scale,
  ShoppingBag,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  Search,
  Filter,
  Layers3,
  CalendarDays,
  FileText
} from 'lucide-react';
import { startOfWeek, addDays, format, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BOTELLAS_POR_PACK, SABORES_SIN_JARABE, WASTE_WEIGHTS, PACKS_POR_PALETA } from '../constants';
import { ProductionPlan, MonthlyGoal } from '../types';
import * as XLSX from 'xlsx';

interface InsumoStock {
  codigo_articulo: string;
  nombre_articulo: string;
  stock_almacen: number;
  stock_piso: number;
  stock_final: number;
}

interface PhysicalInventoryRow {
  codigo: string;
  producto: string;
  tipo: string;
  saldoInicial: number;
  entradasAlmacen: number;
  entradasOtros: number;
  devolucionAlmacen: number;
  salidaOtros: number;
  salidaConsumo: number;
  ajustePositivo: number;
  ajusteNegativo: number;
  saldoTeoricoSinJust?: number;
  saldoFinalDeposito: number;
  desvio: number;
  porcentaje: number;
}

export function InsumosControlReport() {
  const { config, availableBrands, availableFlavors, availableSizes } = useAppConfig();
  const [activeTab, setActiveTab] = useState<string>('capacity');
  
  // SQL and Firebase data state
  const [stockData, setStockData] = useState<InsumoStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetasMappings, setEtiquetasMappings] = useState<Record<string, string>>({});
  const [lastUpdatedCached, setLastUpdatedCached] = useState<string | null>(null);

  // Excel Physical Inventory Upload States
  const [uploadedInventory, setUploadedInventory] = useState<PhysicalInventoryRow[]>([]);
  const [inventoryFileName, setInventoryFileName] = useState<string | null>(null);
  const [isSavingInventory, setIsSavingInventory] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [searchTermInventory, setSearchTermInventory] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('todos');
  
  // Weekly selection for calculations
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  // Sugar Tab States
  const [sugarManualUnitsByDay, setSugarManualUnitsByDay] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('sugar_manual_units_by_day');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [sugarIncomingBagsByDay, setSugarIncomingBagsByDay] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('sugar_incoming_bags_by_day');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [sugarBagsPerUnit, setSugarBagsPerUnit] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sugar_bags_per_unit');
      if (saved) return parseInt(saved) || 12;
    } catch (e) {}
    return 12;
  });

  useEffect(() => {
    localStorage.setItem('sugar_manual_units_by_day', JSON.stringify(sugarManualUnitsByDay));
  }, [sugarManualUnitsByDay]);

  useEffect(() => {
    localStorage.setItem('sugar_incoming_bags_by_day', JSON.stringify(sugarIncomingBagsByDay));
  }, [sugarIncomingBagsByDay]);

  useEffect(() => {
    localStorage.setItem('sugar_bags_per_unit', sugarBagsPerUnit.toString());
  }, [sugarBagsPerUnit]);

  // Filter
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedCalibre, setSelectedCalibre] = useState<string>('todos');
  const [excludeAzucar, setExcludeAzucar] = useState<boolean>(true);
  const [excludeJugoLimon, setExcludeJugoLimon] = useState<boolean>(true);

  // Simulation / Local Stock overrides State
  const [simulationMode, setSimulationMode] = useState(false);
  const [simulatedStocks, setSimulatedStocks] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('simulated_stocks_cache');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return {};
  });

  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('simulated_stocks_cache', JSON.stringify(simulatedStocks));
  }, [simulatedStocks]);

  const getFlavorsForBrand = (brand: string) => {
    if (!config) return [];
    return config.brandFlavorCombinations[brand] || [];
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(selectedWeek, i));
  }, [selectedWeek]);

  const sugarDays = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  const startDateStr = format(weekDays[0], 'yyyy-MM-dd');
  const endDateStr = format(weekDays[6], 'yyyy-MM-dd');

  // Filter plans to only those whose scheduled date falls in the selected week range
  const weeklyPlansOnly = useMemo(() => {
    return plans.filter(p => {
      const planDate = parseISO(p.date); // Assuming p.date is YYYY-MM-DD or similar parsable
      const start = parseISO(startDateStr);
      const end = parseISO(endDateStr);
      return planDate >= start && planDate <= end;
    });
  }, [plans, startDateStr, endDateStr]);

  const fetchMappings = async () => {
    try {
      const mappingRef = doc(db, 'config', 'sql_insumo_mappings');
      const docSnap = await getDoc(mappingRef);
      if (docSnap.exists()) {
        setInsumoMappings(docSnap.data() as Record<string, string>);
      }

      const etiquetasMappingRef = doc(db, 'config', 'sql_etiquetas_mappings');
      const etiquetasSnap = await getDoc(etiquetasMappingRef);
      if (etiquetasSnap.exists()) {
        setEtiquetasMappings(etiquetasSnap.data() as Record<string, string>);
      }
    } catch (err) {
      console.error("Error fetching mappings:", err);
    }
  };

  const fetchCachedStock = async () => {
    try {
      const cachedRef = doc(db, 'config', 'sql_last_insumos_stock');
      const docSnap = await getDoc(cachedRef);
      if (docSnap.exists()) {
        const cached = docSnap.data();
        if (cached && Array.isArray(cached.data)) {
          setStockData(cached.data);
          if (cached.updatedAt) {
            setLastUpdatedCached(cached.updatedAt);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching cached stock:", err);
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
      const fetchedData = result.data || [];
      setStockData(fetchedData);
      setSimulationMode(false);

      // Save to Firestore so they are stored as historical/defaults
      try {
        const nowStr = new Date().toISOString();
        await setDoc(doc(db, 'config', 'sql_last_insumos_stock'), {
          data: fetchedData,
          updatedAt: nowStr
        });
        setLastUpdatedCached(nowStr);
      } catch (saveErr) {
        console.error("Error saving cached stock to Firestore:", saveErr);
      }
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
      setSimulatedStocks(prev => {
        const nextState = { ...prev };
        let stateChanged = false;

        config.insumos.forEach((insumo: string) => {
          const mappedCode = insumoMappings[insumo];
          let foundSql = false;

          if (mappedCode) {
            const sqlMatch = stockData.find(s => {
              const dbCode = (s.codigo_articulo || '').toString().trim().toLowerCase();
              const mapCode = (mappedCode || '').toString().trim().toLowerCase();
              return dbCode === mapCode && mapCode !== '';
            });

            if (sqlMatch) {
              if (nextState[insumo] !== sqlMatch.stock_almacen) {
                nextState[insumo] = sqlMatch.stock_almacen;
                stateChanged = true;
              }
              foundSql = true;
            }
          }

          if (!foundSql && nextState[insumo] === undefined) {
            stateChanged = true;
            if (insumo.toLowerCase().includes('azúcar')) nextState[insumo] = 6500;
            else if (insumo.toLowerCase().includes('benzoato')) nextState[insumo] = 250;
            else if (insumo.toLowerCase().includes('sorbato')) nextState[insumo] = 180;
            else if (insumo.toLowerCase().includes('citrico') || insumo.toLowerCase().includes('cítrico')) nextState[insumo] = 400;
            else if (insumo.toLowerCase().includes('esencia') || insumo.toLowerCase().includes('emulsión')) nextState[insumo] = 150;
            else nextState[insumo] = 800; // General fallbacks
          }
        });

        return stateChanged ? nextState : prev;
      });
    }
  }, [config?.insumos, stockData, insumoMappings]);

  // Load Firestore production plans for the selected week and 14-day sugar projection (including preparation-shift margins)
  useEffect(() => {
    setPlansLoading(true);
    const today = new Date();
    const todayMinusOneStr = format(subDays(today, 1), 'yyyy-MM-dd');
    const todayPlusSixteenStr = format(addDays(today, 16), 'yyyy-MM-dd');
    const endPlusTwoStr = format(addDays(parseISO(endDateStr), 2), 'yyyy-MM-dd');

    const calcMinDate = startDateStr < todayMinusOneStr ? startDateStr : todayMinusOneStr;
    const calcMaxDate = endPlusTwoStr > todayPlusSixteenStr ? endPlusTwoStr : todayPlusSixteenStr;

    const qPlans = query(
      collection(db, 'production_plans'),
      where('date', '>=', calcMinDate),
      where('date', '<=', calcMaxDate)
    );

    const unsubscribePlans = onSnapshot(qPlans, (snap) => {
      const dbPlans = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionPlan));
      // Only use published plans unless user wants to cross Drafts also, let's include all to be secure, or just Published
      const publishedPlans = dbPlans.filter(p => p.status === 'Published');
      setPlans(publishedPlans);
      setPlansLoading(false);
    }, (err) => {
      console.error("Error fetching weekly plans:", err);
      setPlansLoading(false);
    });

    const currentMonth = format(new Date(), 'yyyy-MM');
    const qGoals = query(
      collection(db, 'monthly_goals'),
      where('month', '==', currentMonth)
    );
    
    const unsubscribeGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyGoal)));
    });

    return () => {
      unsubscribePlans();
      unsubscribeGoals();
    };
  }, [startDateStr, endDateStr]);

  // Load today's production plans
  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  useEffect(() => {
    fetchMappings()
      .then(() => fetchCachedStock())
      .then(() => fetchStock());
  }, []);

  const handleUpdateSimulatedStock = (insumoName: string, value: number) => {
    setSimulatedStocks(prev => ({
      ...prev,
      [insumoName]: Math.max(0, value)
    }));
  };

  // Process manual/Excel physical inventory loading
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInventoryFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        if (rawData.length === 0) {
          throw new Error('El archivo de Excel está vacío.');
        }
        
        // Find header row dynamically
        let headerRowIndex = 0;
        let headers: string[] = [];
        
        for (let i = 0; i < Math.min(25, rawData.length); i++) {
          const row = rawData[i] as any[];
          if (row && row.some(cell => typeof cell === 'string' && (
            cell.includes('SALDO_INICI') || 
            cell.includes('CO_COD') || 
            cell.includes('DESVIO') || 
            cell.includes('SALIDA_PORCONSUM')
          ))) {
            headerRowIndex = i;
            headers = row.map(h => (h || '').toString().trim());
            break;
          }
        }
        
        if (headers.length === 0 && rawData.length > 0) {
          headers = (rawData[0] as any[]).map(h => (h || '').toString().trim());
          headerRowIndex = 0;
        }
        
        // Map excel columns to our logical keys
        const colMap: Record<string, number> = {};
        headers.forEach((h, idx) => {
          const hUpper = h.toUpperCase();
          if (hUpper.startsWith('CO_COD') || hUpper === 'CODIGO' || hUpper === 'CÓDIGO') colMap['codigo'] = idx;
          else if (hUpper === 'PRODUCTO' || hUpper === 'DETALLE' || hUpper === 'NOMBRE' || hUpper === 'ARTICULO') colMap['producto'] = idx;
          else if (hUpper === 'TIPO' || hUpper === 'CATEGORIA' || hUpper === 'RUBRO') colMap['tipo'] = idx;
          else if (hUpper === 'SALDO_INICI' || hUpper === 'SALDO_INICIAL' || hUpper === 'INICIAL' || hUpper === 'SAN_INICI') colMap['saldoInicial'] = idx;
          else if (hUpper === 'ENTRADAS_DESDE_ALMACE' || hUpper.includes('DESDE_ALMACEN') || hUpper.includes('ENTRADA_ALMACEN')) colMap['entradasAlmacen'] = idx;
          else if (hUpper === 'ENTRADAS_OTROS_CONCEPTO' || hUpper.includes('ENTRADAS_OTROS') || hUpper.includes('OTROS_INGRESOS')) colMap['entradasOtros'] = idx;
          else if (hUpper === 'DEVOLUCION_A_ALMACENE' || hUpper.includes('DEVOLUCION_A_ALMACENES') || hUpper.includes('DEVOLUCION_ALMACEN')) colMap['devolucionAlmacen'] = idx;
          else if (hUpper === 'SALIDA_OTROS_CONCEPTO' || hUpper.includes('SALIDA_OTROS') || hUpper.includes('OTRAS_SALIDAS')) colMap['salidaOtros'] = idx;
          else if (hUpper === 'SALIDA_PORCONSUM' || hUpper.includes('SALIDA_POR_CONSUMO') || hUpper.includes('CONSUMO') || hUpper.includes('SALIDA_CONSUMO')) colMap['salidaConsumo'] = idx;
          else if (hUpper === 'AJUSTE_POSITIV' || hUpper.includes('AJUSTE_POSITIVO')) colMap['ajustePositivo'] = idx;
          else if (hUpper === 'AJUSTE_NEGATIV' || hUpper.includes('AJUSTE_NEGATIVO')) colMap['ajusteNegativo'] = idx;
          else if (hUpper === 'SALDOTEORICOSINJUST' || hUpper.includes('SALDO_TEORICO') || hUpper.includes('TEORICO')) colMap['saldoTeoricoSinJust'] = idx;
          else if (hUpper === 'SALDOFINALDEPOSIT' || hUpper.includes('SALDO_FINAL_DEPOSITO') || hUpper.includes('SALDO_FINAL') || hUpper === 'FINAL') colMap['saldoFinalDeposito'] = idx;
          else if (hUpper === 'DESVIO' || hUpper === 'CORRECCION') colMap['desvio'] = idx;
          else if (hUpper === 'PORCENTAJE' || hUpper === 'PORCENTAJEDESVI' || hUpper === 'PORCENTAJEDESVIO') colMap['porcentaje'] = idx;
        });
        
        const getIndex = (key: string, defaultIdx: number) => colMap[key] !== undefined ? colMap[key] : defaultIdx;
        
        const idxCodigo = getIndex('codigo', 0);
        const idxProducto = getIndex('producto', 1);
        const idxTipo = getIndex('tipo', 2);
        const idxSaldoInicial = getIndex('saldoInicial', 3);
        const idxEntradasAlm = getIndex('entradasAlmacen', 4);
        const idxEntradasOtros = getIndex('entradasOtros', 5);
        const idxDevoluciones = getIndex('devolucionAlmacen', 6);
        const idxSalidaOtros = getIndex('salidaOtros', 7);
        const idxSalidaConsumo = getIndex('salidaConsumo', 8);
        const idxAjustePositivo = getIndex('ajustePositivo', 9);
        const idxAjusteNegativo = getIndex('ajusteNegativo', 10);
        const idxTeorico = getIndex('saldoTeoricoSinJust', 11);
        const idxFinal = getIndex('saldoFinalDeposito', 12);
        
        const parsedRows: PhysicalInventoryRow[] = [];
        
        for (let r = headerRowIndex + 1; r < rawData.length; r++) {
          const row = rawData[r] as any[];
          if (!row || row.length === 0) continue;
          
          const codigo = (row[idxCodigo] || '').toString().trim();
          if (!codigo || codigo === '' || codigo.toLowerCase() === 'código' || codigo.toLowerCase() === 'codigo') continue;
          
          const producto = (row[idxProducto] || '').toString().trim() || 'Sin Nombre';
          const tipo = (row[idxTipo] || '').toString().trim() || 'S/D';
          
          const parseNum = (val: any): number => {
            if (val === undefined || val === null || val === '') return 0;
            if (typeof val === 'number') return val;
            const cleanStr = val.toString().replace(/\./g, '').replace(/,/g, '.').replace(/\s/g, '').trim();
            const parsed = parseFloat(cleanStr);
            return isNaN(parsed) ? 0 : parsed;
          };
          
          const saldoInicial = parseNum(row[idxSaldoInicial]);
          const entriesAlm = parseNum(row[idxEntradasAlm]);
          const entriesOtr = parseNum(row[idxEntradasOtros]);
          const devAlm = parseNum(row[idxDevoluciones]);
          const outOtr = parseNum(row[idxSalidaOtros]);
          const outConsumo = parseNum(row[idxSalidaConsumo]);
          const ajustePos = parseNum(row[idxAjustePositivo]);
          const ajusteNeg = parseNum(row[idxAjusteNegativo]);
          const saldoTeorico = parseNum(row[idxTeorico]);
          const saldoFinalDep = parseNum(row[idxFinal]);
          
          // Formula: Desvio = Saldo Inicial + Entradas Desde Almacen + Entradas Otros Conceptos + Devolución a Almacén + Salida Otros Conceptos + Salida por Consumo + Ajuste Positivo - Saldo Final Depósito
          const desvioCalculado = saldoInicial + entriesAlm + entriesOtr + devAlm + outOtr + outConsumo + ajustePos - saldoFinalDep;
          
          // Formula: Porcentaje = Desvio / -Salida por Consumo
          const porcentajeCalculado = outConsumo !== 0 ? (desvioCalculado / (-1 * outConsumo)) : 0;
          
          parsedRows.push({
            codigo,
            producto,
            tipo,
            saldoInicial,
            entradasAlmacen: entriesAlm,
            entradasOtros: entriesOtr,
            devolucionAlmacen: devAlm,
            salidaOtros: outOtr,
            salidaConsumo: outConsumo,
            ajustePositivo: ajustePos,
            ajusteNegativo: ajusteNeg,
            saldoTeoricoSinJust: saldoTeorico,
            saldoFinalDeposito: saldoFinalDep,
            desvio: desvioCalculado,
            porcentaje: porcentajeCalculado
          });
        }
        
        setUploadedInventory(parsedRows);
        setError(null);
      } catch (err: any) {
        console.error("Error parsing Inventory Excel:", err);
        setError('No se pudo procesar el archivo Excel. Verifique que contenga las cabeceras requeridas.');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Save parsed inventory to Firestore, overwriting sql_last_insumos_stock + simulatedStocks so both modes synchronize!
  const saveInventoryToSystem = async () => {
    if (uploadedInventory.length === 0) return;
    setIsSavingInventory(true);
    setError(null);
    try {
      const timestamp = new Date().toISOString();
      const invId = `inventory-${timestamp.substring(0, 10)}-${Date.now()}`;
      
      const newStockData = uploadedInventory.map(row => ({
        codigo_articulo: row.codigo,
        nombre_articulo: row.producto,
        stock_almacen: row.saldoFinalDeposito,
        stock_piso: 0,
        stock_final: row.saldoFinalDeposito
      }));

      // Overwrite the SQL Stock cache so non-simulation mode can see this data
      await setDoc(doc(db, 'config', 'sql_last_insumos_stock'), {
        data: newStockData,
        updatedAt: timestamp
      });

      // Maintain a historical trace of loaded inventories, deviations, and percentages
      await setDoc(doc(db, 'physical_inventories', invId), {
        id: invId,
        fileName: inventoryFileName || 'Inventario Manual',
        uploadedAt: timestamp,
        items: uploadedInventory
      });

      // Overwrite local stocks state
      setStockData(newStockData);
      setLastUpdatedCached(timestamp);

      // Also migrate these numbers to simulatedStocks override buffer
      const nextSimulated = { ...simulatedStocks };
      uploadedInventory.forEach(row => {
        // Search mapping for matches to assign simulated equivalents
        const matchedInsumo = Object.keys(insumoMappings).find(k => insumoMappings[k] === row.codigo);
        if (matchedInsumo) {
          nextSimulated[matchedInsumo] = row.saldoFinalDeposito;
        } else {
          // Also check packaging configurations
          if (config) {
            const pref = (config?.preformasConfig || []).find(p => p.sqlCode === row.codigo);
            if (pref) nextSimulated[pref.name] = row.saldoFinalDeposito;
            const tm = (config?.termoConfig || []).find(t => t.sqlCode === row.codigo);
            if (tm) nextSimulated[tm.name] = row.saldoFinalDeposito;
            const str = (config?.stretchConfig || []).find(s => s.sqlCode === row.codigo);
            if (str) nextSimulated[str.name] = row.saldoFinalDeposito;
            const tp = (config?.tapaConfig || []).find(t => t.sqlCode === row.codigo);
            if (tp) nextSimulated[tp.name] = row.saldoFinalDeposito;
          }
        }
      });
      
      setSimulatedStocks(nextSimulated);
      localStorage.setItem('simulated_stocks_cache', JSON.stringify(nextSimulated));

      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 4000);
    } catch (err: any) {
      console.error("Error saving inventory to Firestore:", err);
      setError('Error al guardar el inventario físico en Firestore: ' + (err.message || err));
    } finally {
      setIsSavingInventory(false);
    }
  };

  // Helper to read raw stock of an insumo (without equivalence)
  const getRawInsumoStock = useCallback((insumoName: string): number => {
    if (simulationMode) {
      return simulatedStocks[insumoName] || 0;
    }
    let sqlCode = insumoMappings[insumoName];
    if (!sqlCode && config) {
      if (insumoName.startsWith("Etiqueta ")) {
        const parts = insumoName.substring(9).split(" / ");
        if (parts.length >= 3) {
          const brand = parts[0];
          const flavor = parts[1];
          const size = parseInt(parts[2]);
          const key = `${brand}-${flavor}-${size}`;
          sqlCode = etiquetasMappings[key];
        }
      } else {
        // Seek in preformasConfig
        const pref = (config?.preformasConfig || []).find(p => p.name === insumoName);
        if (pref) sqlCode = pref.sqlCode;
        else {
          // Seek in termoConfig
          const tm = (config?.termoConfig || []).find(t => t.name === insumoName);
          if (tm) sqlCode = tm.sqlCode;
          else {
            // Seek in stretchConfig
            const str = (config?.stretchConfig || []).find(s => s.name === insumoName);
            if (str) sqlCode = str.sqlCode;
            else {
              const tapa = (config?.tapaConfig || []).find(t => t.name === insumoName);
              if (tapa) sqlCode = tapa.sqlCode;
            }
          }
        }
      }
    }
    if (sqlCode) {
      const match = stockData.find(s => {
        const dbCode = (s.codigo_articulo || '').toString().trim().toLowerCase();
        const mapCode = (sqlCode || '').toString().trim().toLowerCase();
        return dbCode === mapCode && mapCode !== '';
      });
      if (match) return match.stock_almacen;
    }
    return 0; // fallback if no code / no match
  }, [config, simulationMode, simulatedStocks, insumoMappings, etiquetasMappings, stockData]);

  // Helper to read effective stock considering equivalent groups
  const getEffectiveInsumoStock = useCallback((insumoName: string): number => {
    const rawStock = getRawInsumoStock(insumoName);
    
    // Check if it belongs to a compatible group (ingredients or packaging)
    const combinedGroups = [
      ...(config?.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
      ...(config?.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
    ] as string[][];

    const group = combinedGroups.find(g => g.includes(insumoName));
    if (group) {
      // Sum stock for all members in the group
      let total = 0;
      group.forEach((member: string) => {
        total += getRawInsumoStock(member);
      });
      return total;
    }
    return rawStock;
  }, [config?.compatibleInsumoGroups, config?.compatiblePackagingGroups, getRawInsumoStock]);

  const isEmpaqueItem = useCallback((insumoName: string) => {
    const lower = insumoName.toLowerCase();
    if (lower.includes('preforma') || lower.includes('tapa') || lower.includes('etiqueta') || lower.includes('termo') || lower.includes('stretch')) return true;
    
    // Also check if any part of the name refers to standard packaging types
    const partOfGroup = insumoName.split(' / ').some(part => {
      const pLower = part.toLowerCase();
      return pLower.includes('preforma') || pLower.includes('tapa') || pLower.includes('etiqueta') || pLower.includes('termo') || pLower.includes('stretch');
    });
    if (partOfGroup) return true;
    
    if (config?.preformasConfig?.some(p => p.name === insumoName)) return true;
    if (config?.termoConfig?.some(p => p.name === insumoName)) return true;
    if (config?.stretchConfig?.some(p => p.name === insumoName)) return true;
    if (config?.tapaConfig?.some(p => p.name === insumoName)) return true;
    
    if (config?.compatiblePackagingGroups) {
      if (Object.keys(config.compatiblePackagingGroups).some(k => insumoName.includes(k))) return true;
      if (Object.values(config.compatiblePackagingGroups).some(g => (g as string[]).some(item => insumoName.includes(item)))) return true;
    }
    return false;
  }, [config]);

  const getPackingCategory = useCallback((insumoName: string) => {
    const lower = insumoName.toLowerCase();
    if (lower.includes('preforma')) return 'Preformas';
    if (lower.includes('tapa')) return 'Tapas';
    if (lower.includes('termo')) return 'Termocontraíble';
    if (lower.includes('stretch')) return 'Film Stretch';
    if (lower.includes('etiqueta')) return 'Etiquetas';
    return 'Otros Empaques';
  }, []);

  // 1. Calculations for Tab 1: Capacity estimation
  const capacityResults = useMemo(() => {
    if (!config) return [];

    const monthlyInsumosRequiredSum: Record<string, number> = {};
    const processMonthlyData = (marca: string, sabor: string, tamano: number, packs: number) => {
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const beverageLiters = packs * botellasPorPack * (tamano / 1000); 
      const syrupLitersNeeded = beverageLiters / 6;
      const syrupLitersPerUnit = config.syrupFormulas?.[marca]?.[sabor]?.liters || 0;
      const unitsRequired = syrupLitersPerUnit > 0 ? (syrupLitersNeeded / syrupLitersPerUnit) : 0;
      const matrixObj = config.insumosMatrix?.[marca]?.[sabor] || {};

      Object.keys(matrixObj).forEach(insumoName => {
        const kgPerUnit = matrixObj[insumoName] || 0;
        if (kgPerUnit > 0) {
          monthlyInsumosRequiredSum[insumoName] = (monthlyInsumosRequiredSum[insumoName] || 0) + (unitsRequired * kgPerUnit);
        }
      });
    };

    goals.forEach(goal => {
      if (goal.quantity > 0) {
        processMonthlyData(goal.marca, goal.sabor, goal.tamano, goal.quantity);
      }
    });

    const monthlyGroupedRequirements: Record<string, number> = {};
    Object.keys(monthlyInsumosRequiredSum).forEach(insumo => {
      let groupKey = insumo;
      const combinedGroups = [
        ...(config?.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
        ...(config?.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
      ] as string[][];

      const groupMatch = combinedGroups.find(g => g.includes(insumo));
      if (groupMatch) {
        groupKey = groupMatch.join(' / ');
      }
      monthlyGroupedRequirements[groupKey] = (monthlyGroupedRequirements[groupKey] || 0) + monthlyInsumosRequiredSum[insumo];
    });

    const finalResults: any[] = [];

    config.brands.forEach(brand => {
      if (selectedBrand !== 'all' && selectedBrand !== brand) return;

      const brandFlavors = getFlavorsForBrand(brand);
      
      brandFlavors.forEach(sabor => {
        const matrixObj = config.insumosMatrix?.[brand]?.[sabor] || {};
        let requiredInsumos = Object.keys(matrixObj).filter(i => matrixObj[i] > 0);
        
        if (excludeAzucar) {
           requiredInsumos = requiredInsumos.filter(i => !i.toLowerCase().includes('azúcar') && !i.toLowerCase().includes('azucar'));
        }
        if (excludeJugoLimon) {
           requiredInsumos = requiredInsumos.filter(i => !i.toLowerCase().includes('jugo de limón') && !i.toLowerCase().includes('jugo de limon'));
        }

        if (requiredInsumos.length === 0) return; // Parameters not set up for this brand flavor

        let maxUnits = Infinity;
        let limitingInsumo = '';
        let stockOfLimiting = 0;
        let reqOfLimiting = 0;
        
        let evaluatedGroups = new Set<string>();

        requiredInsumos.forEach(insumoName => {
          let groupKey = insumoName;
          const combinedGroups = [
            ...(config?.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
            ...(config?.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
          ] as string[][];

          const groupMatch = combinedGroups.find(g => g.includes(insumoName));
          if (groupMatch) {
            groupKey = groupMatch.join(' / ');
          }
          if (evaluatedGroups.has(groupKey)) return; // Skip if we already evaluated this group
          evaluatedGroups.add(groupKey);

          const kgPerUnit = matrixObj[insumoName];
          const availableStock = getEffectiveInsumoStock(insumoName);

          const possibleUnits = Math.floor(availableStock / kgPerUnit);
          if (possibleUnits < maxUnits) {
            maxUnits = possibleUnits;
            limitingInsumo = groupKey;
            stockOfLimiting = availableStock;
            reqOfLimiting = kgPerUnit;
          } else if (possibleUnits === maxUnits && maxUnits < Infinity) {
            if (!limitingInsumo.includes(groupKey)) {
              limitingInsumo += ` / ${groupKey}`;
            }
          }
        });

        if (maxUnits === Infinity) maxUnits = 0;

        const litersPerUnit = config.syrupFormulas?.[brand]?.[sabor]?.liters || 0;
        const totalLitersSyrup = maxUnits * litersPerUnit;
        const totalLitersBeverage = litersPerUnit > 0 ? (totalLitersSyrup * 6) : (maxUnits * 1000); // 1 Unit fallback = 1000L finished beverage

        // Resolve months of stock. If multiple limiters, take the minimum month.
        let monthsOfStock = Infinity;
        if (limitingInsumo) {
          const limitantes = limitingInsumo.split(' / ');
          limitantes.forEach(lim => {
            const req = monthlyGroupedRequirements[lim] || 0;
            const stock = getEffectiveInsumoStock(lim);
            if (req > 0) {
              const months = stock / req;
              if (months < monthsOfStock) monthsOfStock = months;
            }
          });
        }

        finalResults.push({
          brand,
          flavor: sabor,
          maxUnits,
          limitingInsumo,
          stockOfLimiting,
          reqOfLimiting,
          totalLitersSyrup,
          totalLitersBeverage,
          monthsOfStock
        });
      });
    });

    return finalResults.sort((a, b) => b.totalLitersBeverage - a.totalLitersBeverage);
  }, [config, insumoMappings, stockData, selectedBrand, simulatedStocks, simulationMode, getEffectiveInsumoStock, excludeAzucar, excludeJugoLimon]);

  // 2. Calculations for Tab 2: Program Crossover Check
  const programCrossover = useMemo(() => {
    if (!config) return { requiredInsumosAgg: [], monthlyInsumosRequiredSum: {}, programSummary: [], statusOk: true };

    const insumosRequiredSum: Record<string, number> = {};
    const monthlyInsumosRequiredSum: Record<string, number> = {};
    const listProductsAnalyzed: any[] = [];

    // Helper functions to find custom configured packaging classes
    const findPreformaForProduct = (tam: number, lin: string, sabor: string) => {
      const list = config?.preformasConfig || [];
      const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
      
      // 1. Match by size, line, and flavor
      let matched = list.find(p => p.sizes.includes(tam) && p.line && p.line.toString() === lin.toString() && matchFlavor(p));
      // 2. Match by size and flavor (no line, or any line with flavor)
      if (!matched) {
        matched = list.find(p => p.sizes.includes(tam) && !p.line && matchFlavor(p));
      }
      if (!matched) {
        matched = list.find(p => p.sizes.includes(tam) && matchFlavor(p));
      }
      // 3. Generic matches (ignoring flavor constraint) if no flavor-specific matches found
      if (!matched) {
        matched = list.find(p => p.sizes.includes(tam) && p.line && p.line.toString() === lin.toString());
      }
      if (!matched) {
        matched = list.find(p => p.sizes.includes(tam) && !p.line);
      }
      if (!matched) {
        matched = list.find(p => p.sizes.includes(tam));
      }
      return matched;
    };

    const findTermoForProduct = (tam: number, sabor: string) => {
      const list = config?.termoConfig || [];
      const matchFlavor = (t: any) => !t.flavors || t.flavors.length === 0 || t.flavors.includes(sabor);
      let matched = list.find(t => t.sizes.includes(tam) && matchFlavor(t));
      if (!matched) {
        matched = list.find(t => t.sizes.includes(tam));
      }
      return matched;
    };

    const findStretchForProduct = (tam: number, sabor: string) => {
      const list = config?.stretchConfig || [];
      const matchFlavor = (s: any) => !s.flavors || s.flavors.length === 0 || s.flavors.includes(sabor);
      let matched = list.find(s => s.sizes.includes(tam) && matchFlavor(s));
      if (!matched) {
        matched = list.find(s => s.sizes.includes(tam));
      }
      return matched;
    };

    const findTapaForProduct = (tam: number, sabor: string) => {
      const list = config?.tapaConfig || [];
      let matched = list.find(t => t.sizes.includes(tam) && t.flavors && t.flavors.includes(sabor));
      if (!matched) {
        matched = list.find(t => t.sizes.includes(tam) && (!t.flavors || t.flavors.length === 0));
      }
      if (!matched) {
        matched = list.find(t => t.sizes.includes(tam));
      }
      return matched;
    };

    // Initialize required sums to 0 for all active config insumos so they appear in output
    config.insumos?.forEach((i: string) => {
      insumosRequiredSum[i] = 0;
      monthlyInsumosRequiredSum[i] = 0;
    });

    // Also initialize preformas, termo, and stretch configurations so they appear in output
    (config?.preformasConfig || []).forEach(p => {
      insumosRequiredSum[p.name] = 0;
      monthlyInsumosRequiredSum[p.name] = 0;
    });
    (config?.termoConfig || []).forEach(t => {
      insumosRequiredSum[t.name] = 0;
      monthlyInsumosRequiredSum[t.name] = 0;
    });
    (config?.stretchConfig || []).forEach(s => {
      insumosRequiredSum[s.name] = 0;
      monthlyInsumosRequiredSum[s.name] = 0;
    });
    (config?.tapaConfig || []).forEach(t => {
      insumosRequiredSum[t.name] = 0;
      monthlyInsumosRequiredSum[t.name] = 0;
    });

    // Helper function to extract requirements based on product details and required quantity(packs)
    const processCrossoverData = (marca: string, sabor: string, tamano: number, packs: number, targetSum: Record<string, number>) => {
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const bottlesTotal = packs * botellasPorPack;
      const beverageLiters = bottlesTotal * (tamano / 1000); 

      const syrupLitersNeeded = beverageLiters / 6;
      const syrupLitersPerUnit = config.syrupFormulas?.[marca]?.[sabor]?.liters || 0;
      const unitsRequired = syrupLitersPerUnit > 0 ? (syrupLitersNeeded / syrupLitersPerUnit) : (beverageLiters / 1000);

      const matrixObj = config.insumosMatrix?.[marca]?.[sabor] || {};

      Object.keys(matrixObj).forEach(insumoName => {
        const kgPerUnit = matrixObj[insumoName] || 0;
        if (kgPerUnit > 0) {
          const neededKg = unitsRequired * kgPerUnit;
          targetSum[insumoName] = (targetSum[insumoName] || 0) + neededKg;
        }
      });
      
      return { beverageLiters, syrupLitersNeeded };
    };

    // Weekly packaging aggregates
    const preformasAgg: Record<number, number> = {};
    const termoAgg: Record<number, number> = {};
    const stretchAgg: Record<number, number> = {};
    const tapasAgg: Record<string, number> = {};
    const etiquetasAgg: Record<string, number> = {};

    weeklyPlansOnly.forEach(plan => {
      // Ensure the plan is within the weekly range and not in the past
      const planDate = parseISO(plan.date);
      const start = parseISO(startDateStr);
      const end = parseISO(endDateStr);
      const today = parseISO(format(new Date(), 'yyyy-MM-dd'));
      if (planDate < start || planDate > end || planDate < today) return;
      
      const { marca, sabor, tamano, plannedPacks, linea } = plan;
      const { beverageLiters, syrupLitersNeeded } = processCrossoverData(marca, sabor, tamano, plannedPacks, insumosRequiredSum);
      
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const preformasNeeded = plannedPacks * botellasPorPack;
      
      const termoWeight = config?.wasteWeights?.[tamano.toString()]?.termo ?? WASTE_WEIGHTS[tamano]?.termo ?? 0;
      const termoNeededKg = plannedPacks * termoWeight;
      
      const packsPerPaleta = PACKS_POR_PALETA[tamano] || 80;
      const stretchNeededKg = (plannedPacks / packsPerPaleta) * 0.4;
      
      const tapasNeeded = preformasNeeded;
      const etiquetasNeeded = preformasNeeded;

      // Increment matching packaging materials in insumosRequiredSum
      const prefConf = findPreformaForProduct(tamano, linea?.toString() || '', sabor);
      if (prefConf) {
        insumosRequiredSum[prefConf.name] = (insumosRequiredSum[prefConf.name] || 0) + preformasNeeded;
      }

      const termoConf = findTermoForProduct(tamano, sabor);
      if (termoConf) {
        insumosRequiredSum[termoConf.name] = (insumosRequiredSum[termoConf.name] || 0) + termoNeededKg;
      }

      const stretchConf = findStretchForProduct(tamano, sabor);
      if (stretchConf) {
        insumosRequiredSum[stretchConf.name] = (insumosRequiredSum[stretchConf.name] || 0) + stretchNeededKg;
      }

      const tapaConf = findTapaForProduct(tamano, sabor);
      let localTapaKey = '';
      if (tapaConf) {
        insumosRequiredSum[tapaConf.name] = (insumosRequiredSum[tapaConf.name] || 0) + tapasNeeded;
        localTapaKey = tapaConf.name;
      }

      const labelKey = `Etiqueta ${marca} / ${sabor} / ${tamano}cc`;
      insumosRequiredSum[labelKey] = (insumosRequiredSum[labelKey] || 0) + etiquetasNeeded;

      // Aggregates
      preformasAgg[tamano] = (preformasAgg[tamano] || 0) + preformasNeeded;
      termoAgg[tamano] = (termoAgg[tamano] || 0) + termoNeededKg;
      stretchAgg[tamano] = (stretchAgg[tamano] || 0) + stretchNeededKg;
      
      if (localTapaKey) {
        tapasAgg[localTapaKey] = (tapasAgg[localTapaKey] || 0) + tapasNeeded;
      }

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
        preformasNeeded,
        termoNeededKg,
        stretchNeededKg,
        tapasNeeded,
        etiquetasNeeded
      });
    });

    // Populate etiquetasAgg dynamically from weekly insumosRequiredSum (only what has actual requirements based on formulas)
    Object.keys(insumosRequiredSum).forEach(name => {
      const lower = name.toLowerCase();
      if ((lower.includes('etiqueta') || lower.includes('label')) && insumosRequiredSum[name] > 0) {
        etiquetasAgg[name] = insumosRequiredSum[name];
      }
    });

    goals.forEach(goal => {
      const { marca, sabor, tamano, quantity } = goal;
      if (quantity > 0) {
        processCrossoverData(marca, sabor, tamano, quantity, monthlyInsumosRequiredSum);

        const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
        const preformasNeeded = quantity * botellasPorPack;
        
        const termoWeight = config?.wasteWeights?.[tamano.toString()]?.termo ?? WASTE_WEIGHTS[tamano]?.termo ?? 0;
        const termoNeededKg = quantity * termoWeight;
        
        const packsPerPaleta = PACKS_POR_PALETA[tamano] || 80;
        const stretchNeededKg = (quantity / packsPerPaleta) * 0.4;
        
        const tapasNeeded = preformasNeeded;

        // Increment matching packaging materials in monthlyInsumosRequiredSum
        const prefConf = findPreformaForProduct(tamano, '', sabor);
        if (prefConf) {
          monthlyInsumosRequiredSum[prefConf.name] = (monthlyInsumosRequiredSum[prefConf.name] || 0) + preformasNeeded;
        }

        const termoConf = findTermoForProduct(tamano, sabor);
        if (termoConf) {
          monthlyInsumosRequiredSum[termoConf.name] = (monthlyInsumosRequiredSum[termoConf.name] || 0) + termoNeededKg;
        }

        const stretchConf = findStretchForProduct(tamano, sabor);
        if (stretchConf) {
          monthlyInsumosRequiredSum[stretchConf.name] = (monthlyInsumosRequiredSum[stretchConf.name] || 0) + stretchNeededKg;
        }

        const tapaConf = findTapaForProduct(tamano, sabor);
        if (tapaConf) {
          monthlyInsumosRequiredSum[tapaConf.name] = (monthlyInsumosRequiredSum[tapaConf.name] || 0) + tapasNeeded;
        }

        const labelKey = `Etiqueta ${marca} / ${sabor} / ${tamano}cc`;
        monthlyInsumosRequiredSum[labelKey] = (monthlyInsumosRequiredSum[labelKey] || 0) + preformasNeeded;
      }
    });

    // Aggregate requirements by compatible groups to avoid double counting stock
    const groupedRequirements: Record<string, number> = {};
    const monthlyGroupedRequirements: Record<string, number> = {};
    const groupNameMap: Record<string, string> = {}; // Map original insumo -> Group Display Name

    Object.keys(insumosRequiredSum).forEach(insumo => {
      const required = insumosRequiredSum[insumo];
      const monthlyReq = monthlyInsumosRequiredSum[insumo] || 0;
      
      let groupKey = insumo;
      const combinedGroups = [
        ...(config?.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
        ...(config?.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
      ] as string[][];

      const groupMatch = combinedGroups.find(g => g.includes(insumo));
      if (groupMatch) {
        groupKey = groupMatch.join(' / ');
      }
      groupNameMap[insumo] = groupKey;
      groupedRequirements[groupKey] = (groupedRequirements[groupKey] || 0) + required;
      monthlyGroupedRequirements[groupKey] = (monthlyGroupedRequirements[groupKey] || 0) + monthlyReq;
    });

    // Cross-check requirements with stocks at the group level
    let statusOk = true;
    const itemsList = Object.keys(groupedRequirements).map(groupKey => {
      const required = groupedRequirements[groupKey];
      const monthlyRequired = monthlyGroupedRequirements[groupKey] || 0;
      
      // We can just query effective stock using the first member of the group (or the insumo itself if no group)
      const representativeInsumo = groupKey.split(' / ')[0];
      const stock = getEffectiveInsumoStock(representativeInsumo);
      
      const isMet = stock >= required;
      if (!isMet && required > 0) statusOk = false;

      const monthsOfStock = monthlyRequired > 0 ? (stock / monthlyRequired) : Infinity;

      return {
        insumoName: groupKey, // Show the group label
        requiredKg: required,
        monthlyRequiredKg: monthlyRequired,
        stockKg: stock,
        monthsOfStock,
        isMet,
        deficit: isMet ? 0 : (required - stock)
      };
    }).filter(item => {
      // Show always standard ingredients, or packaging items that actually are planned/required to avoid listing unused flavors
      const isIngredient = config.insumos?.includes(item.insumoName);
      const isConfiguredPackage = (config?.preformasConfig || []).some(p => p.name === item.insumoName) ||
                                  (config?.termoConfig || []).some(t => t.name === item.insumoName) ||
                                  (config?.stretchConfig || []).some(s => s.name === item.insumoName) ||
                                  (config?.tapaConfig || []).some(t => t.name === item.insumoName);
      const isTapaOrLabel = item.insumoName.startsWith('Tapa ') || item.insumoName.startsWith('Etiqueta ') || item.insumoName.startsWith('Tapas ');
      
      // Check for packaging items that are part of compatiblePackagingGroups
      const isPartOfCompatiblePackagingGroups = config?.compatiblePackagingGroups && Object.values(config.compatiblePackagingGroups as Record<string, string[]>).some(group => group.some(member => item.insumoName.includes(member)));

      return isIngredient || isConfiguredPackage || isPartOfCompatiblePackagingGroups || (isTapaOrLabel && item.requiredKg > 0);
    });

    return {
      requiredInsumosAgg: itemsList,
      programSummary: listProductsAnalyzed,
      statusOk,
      preformasAgg,
      termoAgg,
      stretchAgg,
      tapasAgg,
      etiquetasAgg
    };
  }, [config, weeklyPlansOnly, goals, insumoMappings, stockData, simulatedStocks, simulationMode, getEffectiveInsumoStock]);

  // Unified equivalent/compatible groups data aggregator for Excel Inventory tab
  const unifiedGroupAnalysis = useMemo(() => {
    if (!config || uploadedInventory.length === 0) return [];

    const planRequiredSum: Record<string, number> = {};
    const planMonthlyRequiredSum: Record<string, number> = {};

    const findPreformaForProduct = (tamano: number, marca: string, sabor: string) => {
      return (config?.preformasConfig || []).find(p => p.size === tamano);
    };
    const findTermoForProduct = (tamano: number, sabor: string) => {
      return (config?.termoConfig || []).find(t => t.size === tamano);
    };
    const findStretchForProduct = (tamano: number, sabor: string) => {
      return (config?.stretchConfig || []).find(s => s.size === tamano);
    };
    const findTapaForProduct = (tamano: number, sabor: string) => {
      return (config?.tapaConfig || []).find(t => t.size === tamano);
    };

    plans.forEach(plan => {
      const marca = plan.brand || '';
      const sabor = plan.flavor || '';
      const tamano = plan.size || 500;
      const quantity = plan.plannedQuantity || 0;
      
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const beverageLiters = quantity * botellasPorPack * (tamano / 1000);
      const syrupLitersNeeded = beverageLiters / 6;
      const syrupLitersPerUnit = config.syrupFormulas?.[marca]?.[sabor]?.liters || 0;
      const unitsRequired = syrupLitersPerUnit > 0 ? (syrupLitersNeeded / syrupLitersPerUnit) : 0;
      const matrixObj = config.insumosMatrix?.[marca]?.[sabor] || {};
      
      Object.keys(matrixObj).forEach(insName => {
        const kgPerUnit = matrixObj[insName] || 0;
        if (kgPerUnit > 0) {
          planRequiredSum[insName] = (planRequiredSum[insName] || 0) + (unitsRequired * kgPerUnit);
        }
      });

      const preformasNeeded = quantity * botellasPorPack;
      const packsPerPaleta = PACKS_POR_PALETA[tamano] || 80;
      const stretchNeededKg = (quantity / packsPerPaleta) * 0.4;
      const bagsWeight = WASTE_WEIGHTS[tamano]?.termo || 0.055;
      const termoNeededKg = quantity * bagsWeight;

      const pConf = findPreformaForProduct(tamano, marca, sabor);
      if (pConf) planRequiredSum[pConf.name] = (planRequiredSum[pConf.name] || 0) + preformasNeeded;

      const tConf = findTermoForProduct(tamano, sabor);
      if (tConf) planRequiredSum[tConf.name] = (planRequiredSum[tConf.name] || 0) + termoNeededKg;

      const sConf = findStretchForProduct(tamano, sabor);
      if (sConf) planRequiredSum[sConf.name] = (planRequiredSum[sConf.name] || 0) + stretchNeededKg;

      const tpConf = findTapaForProduct(tamano, sabor);
      if (tpConf) planRequiredSum[tpConf.name] = (planRequiredSum[tpConf.name] || 0) + preformasNeeded;

      const labelKey = `Etiqueta ${marca} / ${sabor} / ${tamano}cc`;
      planRequiredSum[labelKey] = (planRequiredSum[labelKey] || 0) + preformasNeeded;
    });

    goals.forEach(goal => {
      const marca = goal.marca || '';
      const sabor = goal.sabor || '';
      const tamano = goal.tamano || 500;
      const quantity = goal.quantity || 0;
      
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const beverageLiters = quantity * botellasPorPack * (tamano / 1000);
      const syrupLitersNeeded = beverageLiters / 6;
      const syrupLitersPerUnit = config.syrupFormulas?.[marca]?.[sabor]?.liters || 0;
      const unitsRequired = syrupLitersPerUnit > 0 ? (syrupLitersNeeded / syrupLitersPerUnit) : 0;
      const matrixObj = config.insumosMatrix?.[marca]?.[sabor] || {};
      
      Object.keys(matrixObj).forEach(insName => {
        const kgPerUnit = matrixObj[insName] || 0;
        if (kgPerUnit > 0) {
          planMonthlyRequiredSum[insName] = (planMonthlyRequiredSum[insName] || 0) + (unitsRequired * kgPerUnit);
        }
      });

      const preformasNeeded = quantity * botellasPorPack;
      const packsPerPaleta = PACKS_POR_PALETA[tamano] || 80;
      const stretchNeededKg = (quantity / packsPerPaleta) * 0.4;
      const bagsWeight = WASTE_WEIGHTS[tamano]?.termo || 0.055;
      const termoNeededKg = quantity * bagsWeight;

      const pConf = findPreformaForProduct(tamano, marca, sabor);
      if (pConf) planMonthlyRequiredSum[pConf.name] = (planMonthlyRequiredSum[pConf.name] || 0) + preformasNeeded;

      const tConf = findTermoForProduct(tamano, sabor);
      if (tConf) planMonthlyRequiredSum[tConf.name] = (planMonthlyRequiredSum[tConf.name] || 0) + termoNeededKg;

      const sConf = findStretchForProduct(tamano, sabor);
      if (sConf) planMonthlyRequiredSum[sConf.name] = (planMonthlyRequiredSum[sConf.name] || 0) + stretchNeededKg;

      const tpConf = findTapaForProduct(tamano, sabor);
      if (tpConf) planMonthlyRequiredSum[tpConf.name] = (planMonthlyRequiredSum[tpConf.name] || 0) + preformasNeeded;

      const labelKey = `Etiqueta ${marca} / ${sabor} / ${tamano}cc`;
      planMonthlyRequiredSum[labelKey] = (planMonthlyRequiredSum[labelKey] || 0) + preformasNeeded;
    });

    const formulaInsumos = [
      ...(config.insumos || []),
      ...(config.preformasConfig || []).map(p => p.name),
      ...(config.termoConfig || []).map(t => t.name),
      ...(config.stretchConfig || []).map(s => s.name),
      ...(config.tapaConfig || []).map(t => t.name)
    ];

    availableBrands.forEach(brand => {
      availableSizes.forEach(size => {
        const brandActive = config?.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const hasSizeConfig = brandActive && size.toString() in brandActive;
        const allowedFlavors = hasSizeConfig
          ? brandActive[size.toString()]
          : (hasBrandConfig ? [] : (config?.brandFlavorCombinations[brand] || []));
        allowedFlavors.forEach(flavor => {
          const key = `Etiqueta ${brand} / ${flavor} / ${size}cc`;
          if (!formulaInsumos.includes(key)) formulaInsumos.push(key);
        });
      });
    });

    const compatibleGroupsList = [
      ...(config.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
      ...(config.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
    ] as string[][];

    const processedGroups = new Set<string>();
    const results: any[] = [];

    formulaInsumos.forEach(insumoName => {
      const matchedGroup = compatibleGroupsList.find(g => g.includes(insumoName));
      const groupKey = matchedGroup ? matchedGroup.join(' / ') : insumoName;

      if (processedGroups.has(groupKey)) return;
      processedGroups.add(groupKey);

      const groupMembers = matchedGroup || [insumoName];
      let physicalStockSum = 0;
      let desvioSum = 0;
      let totalSalidaConsumo = 0;
      let matchedRowsCount = 0;
      let membersDetails: any[] = [];

      let planReqSum = 0;
      let planMonthlyReqSum = 0;

      groupMembers.forEach((member: string) => {
        planReqSum += planRequiredSum[member] || 0;
        planMonthlyReqSum += planMonthlyRequiredSum[member] || 0;

        let code = insumoMappings[member];
        if (!code && config) {
          const p = (config.preformasConfig || []).find(item => item.name === member);
          if (p) code = p.sqlCode;
          const t = (config.termoConfig || []).find(item => item.name === member);
          if (t) code = t.sqlCode;
          const s = (config.stretchConfig || []).find(item => item.name === member);
          if (s) code = s.sqlCode;
          const tp = (config.tapaConfig || []).find(item => item.name === member);
          if (tp) code = tp.sqlCode;
          
          if (!code && member.startsWith("Etiqueta ")) {
            const parts = member.substring(9).split(" / ");
            if (parts.length >= 3) {
              const brand = parts[0];
              const flavor = parts[1];
              const size = parseInt(parts[2]);
              const key = `${brand}-${flavor}-${size}`;
              code = etiquetasMappings[key];
            }
          }
        }

        if (code) {
          const rowMatch = uploadedInventory.find(row => row.codigo === code);
          if (rowMatch) {
            physicalStockSum += rowMatch.saldoFinalDeposito;
            desvioSum += rowMatch.desvio;
            totalSalidaConsumo += rowMatch.salidaConsumo;
            matchedRowsCount++;
            membersDetails.push({
              name: member,
              codigo: rowMatch.codigo,
              producto: rowMatch.producto,
              saldoFinalDeposito: rowMatch.saldoFinalDeposito,
              desvio: rowMatch.desvio,
              porcentaje: rowMatch.porcentaje
            });
          } else {
            membersDetails.push({
              name: member,
              codigo: code,
              producto: '(No encontrado en Excel)',
              saldoFinalDeposito: 0,
              desvio: 0,
              porcentaje: 0,
              noMatch: true
            });
          }
        } else {
          membersDetails.push({
            name: member,
            codigo: 'S/C',
            producto: '(Sin mapeo en sistema)',
            saldoFinalDeposito: 0,
            desvio: 0,
            porcentaje: 0,
            noMap: true
          });
        }
      });

      const avgPorcentaje = totalSalidaConsumo !== 0 ? (desvioSum / (-1 * totalSalidaConsumo)) : 0;
      const coverageMonths = planMonthlyReqSum > 0 ? (physicalStockSum / planMonthlyReqSum) : Infinity;

      results.push({
        groupName: groupKey,
        isGroup: groupMembers.length > 1,
        members: groupMembers,
        membersDetails,
        physicalStockSum,
        desvioSum,
        planReqSum,
        planMonthlyReqSum,
        avgPorcentaje,
        coverageMonths,
        matchedRowsCount
      });
    });

    return results;
  }, [config, uploadedInventory, plans, goals, insumoMappings, etiquetasMappings, availableBrands, availableSizes]);

  // Sugar Calculation Hooks
  const sugarInsumoName = useMemo(() => {
    if (!config?.insumos) return 'Azúcar';
    return config.insumos.find(i => i.toLowerCase().includes('azúcar') || i.toLowerCase().includes('azucar')) || 'Azúcar';
  }, [config?.insumos]);

  const sugarStockKg = useMemo(() => {
    return getEffectiveInsumoStock(sugarInsumoName);
  }, [sugarInsumoName, getEffectiveInsumoStock]);

  const sugarStockBags = useMemo(() => {
    return sugarStockKg / 50;
  }, [sugarStockKg]);

  const sugarDailyProjectionState = useMemo(() => {
    const getSyrupPrepDateTime = (dateStr: string, shiftStr: string): { dateStr: string; shift: 'Mañana' | 'Tarde' | 'Noche' } => {
      const date = parseISO(dateStr);
      let shift: 'Mañana' | 'Tarde' | 'Noche' = 'Mañana';
      if (shiftStr && (shiftStr.toLowerCase().includes('tarde') || shiftStr.toLowerCase().includes('afternoon'))) {
        shift = 'Tarde';
      } else if (shiftStr && (shiftStr.toLowerCase().includes('noche') || shiftStr.toLowerCase().includes('night'))) {
        shift = 'Noche';
      }
      
      const shiftOrder = ['Mañana', 'Tarde', 'Noche'] as const;
      const currentIdx = shiftOrder.indexOf(shift);
      
      if (currentIdx === 2) {
        // Noche on D is prepared 2 shifts before -> Mañana of same day D
        return { dateStr, shift: 'Mañana' };
      } else if (currentIdx === 1) {
        // Tarde on D is prepared 2 shifts before -> Noche of previous day D-1
        const prevDate = subDays(date, 1);
        return { dateStr: format(prevDate, 'yyyy-MM-dd'), shift: 'Noche' };
      } else {
        // Mañana on D is prepared 2 shifts before -> Tarde of previous day D-1
        const prevDate = subDays(date, 1);
        return { dateStr: format(prevDate, 'yyyy-MM-dd'), shift: 'Tarde' };
      }
    };

    const rawDays = sugarDays.map((d) => {
      const dateStr = format(d, 'yyyy-MM-dd');
      const manualValue = sugarManualUnitsByDay[dateStr];
      const hasManualOverride = manualValue !== undefined && manualValue > 0;
      const incomingBags = sugarIncomingBagsByDay[dateStr] || 0;
      const incomingKg = incomingBags * 50;
      
      let consumptionKg = 0;
      let usedUnits = 0;
      let source: 'manual' | 'plan' = 'plan';
      
      // Select plans whose syrup preparation falls on this day
      const dayPlans = plans.filter(p => {
        const prep = getSyrupPrepDateTime(p.date, p.shift);
        return prep.dateStr === dateStr;
      });
      
      if (hasManualOverride) {
        source = 'manual';
        usedUnits = manualValue;
        consumptionKg = manualValue * sugarBagsPerUnit * 50;
      } else {
        source = 'plan';
        dayPlans.forEach(p => {
          const botellasPorPack = config?.botellasPorPack?.[p.tamano] || BOTELLAS_POR_PACK[p.tamano] || 6;
          const bottlesTotal = p.plannedPacks * botellasPorPack;
          const beverageLiters = bottlesTotal * (p.tamano / 1000); 

          const syrupLitersNeeded = beverageLiters / 6;
          const syrupLitersPerUnit = config?.syrupFormulas?.[p.marca]?.[p.sabor]?.liters || 0;
          const unitsRequired = syrupLitersPerUnit > 0 ? (syrupLitersNeeded / syrupLitersPerUnit) : 0;
          usedUnits += unitsRequired;

          const matrixObj = config?.insumosMatrix?.[p.marca]?.[p.sabor] || {};
          let sugarKey = Object.keys(matrixObj).find(k => k.toLowerCase().includes('azúcar') || k.toLowerCase().includes('azucar'));
          const sugarKgPerUnit = sugarKey ? (matrixObj[sugarKey] || 0) : 0;
          const sugarNeededKg = unitsRequired * sugarKgPerUnit;
          consumptionKg += sugarNeededKg;
        });
      }
      
      return {
        date: d,
        dateStr,
        source,
        usedUnits,
        consumptionKg,
        consumptionBags: consumptionKg / 50,
        incomingBags,
        incomingKg,
        dayPlans,
        plansCount: dayPlans.length,
        hasPlans: dayPlans.length > 0,
        stockBeforeKg: 0,
        stockAfterKg: 0,
        stockAfterBags: 0
      };
    });

    // Compute cumulative stock dragging day-by-day starting from Day 0 (Today)
    if (rawDays.length > 0) {
      // Day 0: starting live stock is sugarStockKg, plus any incoming delivery for Today or manual entry
      rawDays[0].stockBeforeKg = sugarStockKg + rawDays[0].incomingKg;
      rawDays[0].stockAfterKg = rawDays[0].stockBeforeKg - rawDays[0].consumptionKg;
      rawDays[0].stockAfterBags = rawDays[0].stockAfterKg / 50;

      for (let i = 1; i < rawDays.length; i++) {
        // Stock before is previous day's leftovers, plus any new incoming delivery on this day
        rawDays[i].stockBeforeKg = rawDays[i - 1].stockAfterKg + rawDays[i].incomingKg;
        rawDays[i].stockAfterKg = rawDays[i].stockBeforeKg - rawDays[i].consumptionKg;
        rawDays[i].stockAfterBags = rawDays[i].stockAfterKg / 50;
      }
    }

    return rawDays;
  }, [sugarDays, plans, config, sugarStockKg, sugarManualUnitsByDay, sugarIncomingBagsByDay, sugarBagsPerUnit, BOTELLAS_POR_PACK]);


  if (!config || (loading && Object.keys(simulatedStocks).length === 0)) {
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
              <p className="text-sm text-gray-500 flex flex-wrap items-center gap-1.5 mt-0.5 font-medium">
                <Database className="w-4 h-4 text-gray-400" />
                <span>Módulo de cubicación industrial y proyección de requerimientos</span>
                {lastUpdatedCached && (
                  <span className="text-xs text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full font-bold ml-2">
                    Última sincronización SQL: {(() => {
                      try {
                        return format(new Date(lastUpdatedCached), "dd/MM/yyyy HH:mm:ss");
                      } catch (e) {
                        return lastUpdatedCached;
                      }
                    })()}
                  </span>
                )}
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
      <div className="flex bg-gray-100 p-1.5 rounded-xl gap-2 w-full md:w-auto">
        <button
          onClick={() => setActiveTab('capacity')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'capacity' 
              ? 'bg-white text-indigo-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Control por Sabor
        </button>
        <button
          onClick={() => setActiveTab('insumos')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'insumos' 
              ? 'bg-white text-indigo-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          Control por Insumo
        </button>
        <button
          onClick={() => setActiveTab('empaque')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'empaque' 
              ? 'bg-white text-orange-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          Empaque
        </button>
        <button
          onClick={() => setActiveTab('azucar')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'azucar' 
              ? 'bg-white text-indigo-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <Scale className="w-4 h-4" />
          Azúcar
        </button>
        <button
          onClick={() => setActiveTab('etiquetas')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === 'etiquetas' 
              ? 'bg-white text-indigo-700 shadow-sm' 
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <Database className="w-4 h-4" />
          Etiquetas
        </button>
        <button
          onClick={() => setActiveTab('program')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
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
              <div className="space-y-3 mb-4">
                <p className="text-[11px] text-amber-700 leading-relaxed bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                  Ajuste los valores de stock (Kg) en los campos a continuación para ver cómo se recalculan inmediatamente los limitantes y el programa.
                </p>
                <button
                  id="reset-simulation-btn"
                  onClick={() => {
                    const reseted: Record<string, number> = {};
                    config?.insumos?.forEach((insumo: string) => {
                      const mappedCode = insumoMappings[insumo];
                      let foundSql = false;
                      if (mappedCode) {
                        const sqlMatch = stockData.find(s => {
                          const dbCode = (s.codigo_articulo || '').toString().trim().toLowerCase();
                          const mapCode = (mappedCode || '').toString().trim().toLowerCase();
                          return dbCode === mapCode && mapCode !== '';
                        });
                        if (sqlMatch) {
                          reseted[insumo] = sqlMatch.stock_almacen;
                          foundSql = true;
                        }
                      }
                      if (!foundSql) {
                        if (insumo.toLowerCase().includes('azúcar')) reseted[insumo] = 6500;
                        else if (insumo.toLowerCase().includes('benzoato')) reseted[insumo] = 250;
                        else if (insumo.toLowerCase().includes('sorbato')) reseted[insumo] = 180;
                        else if (insumo.toLowerCase().includes('citrico') || insumo.toLowerCase().includes('cítrico')) reseted[insumo] = 400;
                        else if (insumo.toLowerCase().includes('esencia') || insumo.toLowerCase().includes('emulsión')) reseted[insumo] = 150;
                        else reseted[insumo] = 800;
                      }
                    });
                    setSimulatedStocks(reseted);
                  }}
                  className="w-full text-center px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 hover:text-gray-900 border border-gray-200 rounded-xl text-xs font-bold transition-all uppercase tracking-wider shadow-sm animate-fade-in"
                >
                  Restablecer a valores de SQL
                </button>
              </div>
            )}

            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {(() => {
                const allList: { name: string }[] = [];
                (config?.insumos || []).forEach((i: string) => allList.push({ name: i }));
                (config?.preformasConfig || []).forEach(p => {
                  if (!allList.some(x => x.name === p.name)) allList.push({ name: p.name });
                });
                (config?.termoConfig || []).forEach(t => {
                  if (!allList.some(x => x.name === t.name)) allList.push({ name: t.name });
                });
                (config?.stretchConfig || []).forEach(s => {
                  if (!allList.some(x => x.name === s.name)) allList.push({ name: s.name });
                });
                (config?.tapaConfig || []).forEach(t => {
                  if (!allList.some(x => x.name === t.name)) allList.push({ name: t.name });
                });
                programCrossover.requiredInsumosAgg?.forEach(item => {
                  const isTapaOrLabel = item.insumoName.startsWith('Tapa ') || item.insumoName.startsWith('Etiqueta ') || item.insumoName.startsWith('Tapas ');
                  if (isTapaOrLabel && !allList.some(x => x.name === item.insumoName)) {
                    allList.push({ name: item.insumoName });
                  }
                });

                return allList.map(({ name: insumo }) => {
                  const stockVal = getRawInsumoStock(insumo);
                  let sqlCode = insumoMappings[insumo] || '';
                  if (!sqlCode) {
                    const pref = (config?.preformasConfig || []).find(p => p.name === insumo);
                    if (pref) sqlCode = pref.sqlCode;
                    else {
                      const tm = (config?.termoConfig || []).find(t => t.name === insumo);
                      if (tm) sqlCode = tm.sqlCode;
                      else {
                        const str = (config?.stretchConfig || []).find(s => s.name === insumo);
                        if (str) sqlCode = str.sqlCode;
                      }
                    }
                  }
                  if (!sqlCode) sqlCode = 'S/M';

                  const lowerName = insumo.toLowerCase();
                  const isUnit = lowerName.includes('preforma') || lowerName.includes('tapa') || lowerName.includes('etiqueta');
                  const unitStr = isUnit ? 'U.' : 'Kg';
                  
                  return (
                    <div key={insumo} className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-2">
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-xs font-bold text-gray-800 leading-tight block truncate max-w-[155px]" title={insumo}>
                          {insumo}
                        </span>
                        <span className="text-[9px] font-mono text-gray-400 bg-white px-1.5 py-0.5 rounded border border-gray-200" title={`Código SQL para ${insumo}`}>
                          {sqlCode}
                        </span>
                      </div>

                      {simulationMode ? (
                        <div className="relative rounded-md shadow-sm">
                          <input
                            title={`Ver/Editar stock simulado de ${insumo}`}
                            type="number"
                            value={simulatedStocks[insumo] !== undefined ? simulatedStocks[insumo] : stockVal}
                            onChange={(e) => handleUpdateSimulatedStock(insumo, Number(e.target.value))}
                            className="w-full bg-white border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-xs text-right font-black focus:ring-2 focus:ring-amber-500 outline-none"
                            min="0"
                          />
                          <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[10px] font-black pointer-events-none text-gray-400 uppercase">
                            {unitStr}
                          </span>
                        </div>
                      ) : (
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-gray-400 font-bold uppercase">Stock Almacén:</span>
                          <span className="text-xs font-black text-indigo-700 font-mono">
                            {Intl.NumberFormat('es-AR').format(stockVal)} {unitStr.toLowerCase()}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              
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
                    <h3 className="text-lg font-bold text-gray-800">Control por Sabor</h3>
                    <p className="text-xs text-gray-500">Volumen máximo teórico de elaboración a partir de existencias e insumo limitante</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors shadow-sm">
                      <input 
                        type="checkbox" 
                        checked={excludeAzucar}
                        onChange={(e) => setExcludeAzucar(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-gray-700">Excluir Azúcar</span>
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors shadow-sm">
                      <input 
                        type="checkbox" 
                        checked={excludeJugoLimon}
                        onChange={(e) => setExcludeJugoLimon(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-gray-700">Excluir J. de Limón</span>
                    </label>
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
                      <tr className="bg-gray-50 text-gray-600 text-xs font-black uppercase tracking-wider">
                        <th className="px-5 py-4 text-left font-sans">Marca / Sabor</th>
                        <th className="px-4 py-4 text-right font-sans">Fórmula</th>
                        <th className="px-4 py-4 text-right font-sans">Unes. Máximas</th>
                        <th className="px-4 py-4 text-right text-indigo-700 font-sans">Litros Jarabe</th>
                        <th className="px-4 py-4 text-right text-emerald-700 bg-emerald-50/30 font-sans">Litros Bebida</th>
                        <th className="px-5 py-4 text-left text-orange-700 font-sans">Insumo Limitante</th>
                        <th className="px-4 py-4 text-right text-blue-700 rounded-tr-lg font-sans">Meses Disp.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white text-sm">
                      {capacityResults.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-12 text-center text-gray-500 font-medium">
                            No hay suficientes datos. Defina su matriz general de insumos y los litros de jarabe por unidad en el Admin Panel.
                          </td>
                        </tr>
                      ) : (
                        capacityResults.map((r, idx) => (
                          <tr key={`${r.brand}-${r.flavor}`} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-4 border-l-[3px] border-l-transparent hover:border-l-indigo-600">
                              <span className="text-xs font-black text-indigo-600 uppercase block tracking-wider leading-none mb-1">
                                {r.brand}
                              </span>
                              <span className="text-sm font-bold text-gray-900">{r.flavor}</span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className="text-xs text-gray-600 bg-gray-100 font-bold px-2.5 py-1.5 rounded">
                                {config.syrupFormulas?.[r.brand]?.[r.flavor]?.liters || 0} L/Un
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right font-black text-gray-800 text-base">
                              {Intl.NumberFormat('es-AR').format(r.maxUnits)}
                            </td>
                            <td className="px-4 py-4 text-right font-bold text-indigo-700">
                              {Intl.NumberFormat('es-AR').format(Math.round(r.totalLitersSyrup))} L
                            </td>
                            <td className="px-4 py-4 text-right font-black text-emerald-700 bg-emerald-50/10">
                              {Intl.NumberFormat('es-AR').format(Math.round(r.totalLitersBeverage))} L
                            </td>
                            <td className="px-5 py-4">
                              {r.limitingInsumo ? (
                                <div className="space-y-1">
                                  <div className="font-semibold text-sm text-orange-700 flex items-center gap-1.5">
                                    <TrendingDown className="w-4 h-4" />
                                    <span>{r.limitingInsumo}</span>
                                  </div>
                                  <div className="text-xs text-gray-500 font-medium tracking-wide">
                                    Stock: <strong className="text-gray-700">{Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(r.stockOfLimiting)} kg</strong> | 
                                    Consumo: <strong className="text-gray-700">{r.reqOfLimiting} kg/Un</strong>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-emerald-600 italic text-sm font-medium">Sin restricciones</span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-right">
                              {r.limitingInsumo && r.monthsOfStock !== Infinity ? (
                                <span className={`font-sans font-bold px-2.5 py-1.5 rounded text-[13px] tracking-wide ${r.monthsOfStock < 0.5 ? 'bg-red-100 text-red-800' : r.monthsOfStock < 1 ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                                  {Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r.monthsOfStock)} m
                                </span>
                              ) : (
                                <span className="text-xs font-bold text-gray-400">Sin req.</span>
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

          {/* TAPA DE AZUCAR */}
          {activeTab === 'azucar' && (
            <div className="space-y-6">
              
              {/* Resumen De Stock Cabecera */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Caja 1: Stock Actual */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3 w-full">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                      <Scale className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <span className="text-[11px] font-black text-gray-400 uppercase tracking-wider block">Existencias de Azúcar</span>
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-2xl font-black text-gray-900">
                          {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(sugarStockKg)}
                        </span>
                        <span className="text-xs font-bold text-gray-500">kg</span>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full mt-1 inline-block">
                        {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(sugarStockBags)} bolsas
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                       {simulationMode ? 'Simulado' : 'SQL Real'}
                    </span>
                  </div>
                </div>

                {/* Caja 2: Total Planificado en la Semana */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                      <ShoppingBag className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[11px] font-black text-gray-400 uppercase tracking-wider block">Consumo Total 14 Días</span>
                      {(() => {
                        const totalPlKg = sugarDailyProjectionState.reduce((acc, current) => acc + current.consumptionKg, 0);
                        return (
                          <>
                            <div className="flex items-baseline gap-1.5 mt-1">
                              <span className="text-2xl font-black text-gray-900">
                                {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(totalPlKg)}
                              </span>
                              <span className="text-xs font-bold text-gray-500">kg</span>
                            </div>
                            <span className="text-[11px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full mt-1 inline-block">
                              {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(totalPlKg / 50)} bolsas
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Caja 3: Configuración de Dosificaciones */}
                <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5 space-y-2">
                  <div className="flex items-center justify-between border-b border-gray-50 pb-1.5">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700 block">Dosificación Manual</span>
                    <span className="text-[9px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Config</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={sugarBagsPerUnit}
                      onChange={(e) => setSugarBagsPerUnit(Math.max(1, parseInt(e.target.value) || 12))}
                      className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm font-black text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="text-[11px] text-gray-500 leading-tight">
                      <strong className="text-gray-900 block font-bold">Bolsas / Unidad</strong>
                      equivale a {sugarBagsPerUnit * 50} kg por item.
                    </div>
                  </div>
                </div>

              </div>

              {/* Contenedor Principal de la Proyección Diaria */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Proyección de Stock y Consumo de Azúcar</h3>
                    <p className="text-xs text-gray-500">
                      Monitoree de forma acumulativa y día por día las necesidades de azúcar en base al programa semanal o simulaciones manuales directas
                    </p>
                  </div>
                  
                  {/* Rolling 14-days indicator badge */}
                  <div className="bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl text-indigo-800 text-xs font-black uppercase flex items-center gap-2 shadow-sm self-start">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <span>Desde {format(sugarDailyProjectionState[0].date, "dd/MM/yyyy")} al {format(sugarDailyProjectionState[sugarDailyProjectionState.length - 1].date, "dd/MM/yyyy")} ({sugarDailyProjectionState.length} Días)</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 text-[11px] font-black uppercase tracking-wider">
                        <th className="px-4 py-4 text-left font-sans w-[15%]">Día / Fecha</th>
                        <th className="px-4 py-4 text-center font-sans w-[22%]">Unidades a Producir</th>
                        <th className="px-4 py-4 text-center font-sans w-[10%]">Origen</th>
                        <th className="px-4 py-4 text-center font-sans w-[18%] text-emerald-800 font-extrabold bg-emerald-50/50">+ Cargar Ingreso (Bolsas)</th>
                        <th className="px-4 py-4 text-right font-sans w-[15%]">Consumo Previsto</th>
                        <th className="px-4 py-4 text-right font-sans rounded-tr-lg w-[20%]">Stock que Quedaría</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white text-sm">
                      {sugarDailyProjectionState.map((row) => {
                        const isToday = row.dateStr === todayStr;
                        const isOverridden = row.source === 'manual';
                        const isDeficient = row.stockAfterKg < 0;

                        return (
                          <tr 
                            key={row.dateStr} 
                            className={`transition-colors hover:bg-gray-50/50 relative ${
                              isToday ? 'bg-indigo-50/10 font-medium' : ''
                            }`}
                          >
                            {/* Día y Fecha */}
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {isToday && (
                                  <span className="w-1 h-10 bg-indigo-600 rounded-r absolute left-0" />
                                )}
                                <div>
                                  <span className="text-gray-900 font-bold block capitalize text-sm">
                                    {format(row.date, "EEEE", { locale: es })}
                                  </span>
                                  <span className="text-xs font-semibold text-gray-400 block tracking-tight">
                                    {format(row.date, "dd 'de' MMM", { locale: es })}
                                  </span>
                                  {isToday && (
                                    <span className="inline-block mt-1 bg-indigo-100 text-indigo-800 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full">
                                      Hoy
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Unidades a producir */}
                            <td className="px-4 py-4 text-center">
                              <div className="flex flex-col items-center justify-center max-w-[170px] mx-auto space-y-1">
                                <div className="relative w-full">
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder={
                                      row.hasPlans 
                                        ? `Plan: ${row.usedUnits.toFixed(1)} u`
                                        : "0"
                                    }
                                    value={sugarManualUnitsByDay[row.dateStr] || ''}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0);
                                      setSugarManualUnitsByDay(prev => ({
                                        ...prev,
                                        [row.dateStr]: val
                                      }));
                                    }}
                                    className={`w-full text-center px-3 py-1.5 text-xs font-bold rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${
                                      isOverridden 
                                        ? 'bg-amber-50 border-amber-300 text-amber-900 focus:ring-amber-500' 
                                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 placeholder-gray-400'
                                    }`}
                                  />
                                  {isOverridden && (
                                    <button
                                      title="Borrar simulación manual"
                                      onClick={() => {
                                        setSugarManualUnitsByDay(prev => {
                                          const copy = { ...prev };
                                          delete copy[row.dateStr];
                                          return copy;
                                        });
                                      }}
                                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-amber-500 hover:text-amber-700 text-lg font-black p-0.5 rounded leading-none"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                                <span className="text-[10px] font-semibold text-gray-400">
                                  {isOverridden ? 'Editado manualmente' : 'Equivalente tanques'}
                                </span>
                              </div>
                            </td>

                            {/* Origen */}
                            <td className="px-4 py-4 whitespace-nowrap text-center">
                              {isOverridden ? (
                                <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] uppercase font-black px-2.5 py-1 rounded-lg">
                                  Manual
                                </span>
                              ) : row.hasPlans ? (
                                <span 
                                  title={row.dayPlans.map(p => `Prep para: ${p.marca} ${p.sabor} (${p.plannedPacks} pack) - Producción: ${p.date} (${p.shift})`).join('\n')}
                                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-[10px] uppercase font-black px-2.5 py-1 rounded-lg cursor-help hover:bg-blue-100 transition-colors"
                                >
                                  Programa ({row.plansCount})
                                </span>
                              ) : (
                                <span className="inline-flex bg-gray-100 text-gray-400 text-[10px] uppercase font-black px-2.5 py-1 rounded-lg">
                                  Sin Plan
                                </span>
                              )}
                            </td>

                            {/* Cargar Ingreso (Bolsas) */}
                            <td className="px-4 py-4 text-center">
                              <div className="flex items-center justify-center max-w-[130px] mx-auto">
                                <div className="relative w-full">
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={sugarIncomingBagsByDay[row.dateStr] || ''}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                                      setSugarIncomingBagsByDay(prev => {
                                        const copy = { ...prev };
                                        if (val === 0) {
                                          delete copy[row.dateStr];
                                        } else {
                                          copy[row.dateStr] = val;
                                        }
                                        return copy;
                                      });
                                    }}
                                    className={`w-full text-center px-3 py-1.5 text-xs font-black rounded-xl border focus:outline-none focus:ring-2 transition-all ${
                                      row.incomingBags > 0
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-950 focus:ring-emerald-500'
                                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 placeholder-gray-400 focus:ring-indigo-500'
                                    }`}
                                  />
                                  {row.incomingBags > 0 && (
                                    <button
                                      title="Borrar ingreso manual"
                                      onClick={() => {
                                        setSugarIncomingBagsByDay(prev => {
                                          const copy = { ...prev };
                                          delete copy[row.dateStr];
                                          return copy;
                                        });
                                      }}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-700 text-lg font-black p-0.5 rounded leading-none"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Consumo Previsto */}
                            <td className="px-4 py-4 text-right whitespace-nowrap">
                              <div className="font-mono">
                                <span className="text-gray-900 font-extrabold text-sm block">
                                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.consumptionKg)} kg
                                </span>
                                <span className="text-gray-400 font-bold text-xs block">
                                  ({Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.consumptionBags)} bols)
                                </span>
                              </div>
                            </td>

                            {/* Stock que quedará */}
                            <td className="px-4 py-4 text-right whitespace-nowrap">
                              <div className="flex flex-col items-end">
                                <div className={`inline-flex flex-col items-end px-3 py-1.5 rounded-xl border ${
                                  isDeficient 
                                    ? 'bg-red-50 border-red-200 text-red-800' 
                                    : row.stockAfterBags < 10 
                                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                                      : 'bg-emerald-50 border-emerald-100 text-emerald-800'
                                }`}>
                                  <span className="font-mono font-black text-sm block">
                                    {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.stockAfterKg)} kg
                                  </span>
                                  <span className="font-sans font-bold text-[10px] block opacity-80">
                                    {isDeficient ? 'Déficit:' : 'Equiv:'} {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.stockAfterBags)} bols
                                  </span>
                                </div>
                                {isDeficient && (
                                  <span className="text-[10px] font-black text-red-600 mt-1 flex items-center gap-1 animate-pulse">
                                    <AlertTriangle className="w-3" /> Quiebre de stock
                                  </span>
                                )}
                              </div>
                            </td>

                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Info footer */}
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="text-xs text-gray-500 max-w-2xl">
                    <p className="font-bold text-gray-700">💡 Instrucciones de simulación:</p>
                    <p className="mt-1 leading-relaxed">
                      El sistema calcula automáticamente el consumo de azúcar previsto en base a las fórmulas de jarabe de los productos planificados. Si desea simular o registrar un plan distinto para un día en particular, simplemente ingrese el número estimado de "Unidades a Producir" en la columna correspondiente; el sistema dejará de usar el programa para ese día y computará la dosificación configurada (<span className="font-extrabold">{sugarBagsPerUnit}</span> bolsas por lote). Para revertir, borre el valor ingresado. También puede registrar ingresos de azúcar cargados en bolsas para prever aumentos del stock disponible.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSugarManualUnitsByDay({});
                      setSugarIncomingBagsByDay({});
                    }}
                    disabled={Object.keys(sugarManualUnitsByDay).length === 0 && Object.keys(sugarIncomingBagsByDay).length === 0}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-bold text-xs uppercase tracking-wide rounded-xl shadow-sm transition-all flex-shrink-0"
                  >
                    Restablecer Todo
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* CONTROL POR INSUMO TAB */}
          {activeTab === 'insumos' && (
            <div className="space-y-6">
              {/* Ingredientes */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Materias Primas e Ingredientes</h3>
                    <p className="text-xs text-gray-500">Analice sus existencias agrupadas calculando su duración según ritmo mensual</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 text-xs font-black uppercase tracking-wider">
                        <th className="px-5 py-4 text-left font-sans">Insumo / Grupo</th>
                        <th className="px-4 py-4 text-right font-sans">Stock</th>
                        <th className="px-4 py-4 text-right text-indigo-700 font-sans">Consumo Mensual</th>
                        <th className="px-4 py-4 text-right text-blue-700 rounded-tr-lg font-sans">Meses Disp.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white text-sm">
                      {(() => {
                        const items = [...programCrossover.requiredInsumosAgg].filter(item => !isEmpaqueItem(item.insumoName)).sort((a, b) => a.monthsOfStock - b.monthsOfStock);
                        
                        const grouped: Record<string, typeof items> = {};
                        items.forEach(item => {
                          let category = 'Otras Materias Primas';
                          const parts = item.insumoName.split(' / ');
                          for (const p of parts) {
                            if (config?.insumosCategories?.[p]) {
                              category = config.insumosCategories[p];
                              break;
                            }
                          }
                          if (!grouped[category]) grouped[category] = [];
                          grouped[category].push(item);
                        });

                        // Sort categories based on custom insumosCategoriesOrder
                        const sortedCategories = Object.keys(grouped).sort((a, b) => {
                          const idxA = (config?.insumosCategoriesOrder || []).indexOf(a);
                          const idxB = (config?.insumosCategoriesOrder || []).indexOf(b);
                          if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                          if (idxA === -1) return 1;
                          if (idxB === -1) return -1;
                          return idxA - idxB;
                        });

                        return sortedCategories.flatMap(category => [
                          <tr key={`group-${category}`} className="bg-indigo-50/50">
                            <td colSpan={4} className="px-5 py-3 font-black text-indigo-900 text-xs uppercase tracking-wider">
                              {category}
                            </td>
                          </tr>,
                          ...grouped[category].map(item => {
                            const lowerName = item.insumoName.toLowerCase();
                            const isUnit = lowerName.includes('preforma') || lowerName.includes('tapa') || lowerName.includes('etiqueta');
                            const unitStr = isUnit ? ' u.' : ' kg';
                            return (
                              <tr key={item.insumoName} className="hover:bg-gray-50 transition-colors">
                                <td className="px-5 py-4 font-bold text-gray-900 border-l-[3px] border-l-transparent hover:border-l-indigo-600">
                                  {item.insumoName}
                                </td>
                                <td className="px-4 py-4 text-right font-medium text-gray-800">
                                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.stockKg)}{unitStr}
                                </td>
                                <td className="px-4 py-4 text-right font-bold text-indigo-700 bg-indigo-50/30">
                                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.monthlyRequiredKg)}{unitStr}
                                </td>
                                <td className="px-4 py-4 text-right">
                                  {item.monthsOfStock === Infinity ? (
                                    <span className="text-xs font-bold text-gray-400">0 Consumo</span>
                                  ) : (
                                    <span className={`font-sans font-bold px-2.5 py-1.5 rounded text-[13px] tracking-wide ${item.monthsOfStock < 0.5 ? 'bg-red-100 text-red-800' : item.monthsOfStock < 1 ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                                      {Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.monthsOfStock)} m
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ]);
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB ETIQUETAS */}
          {activeTab === 'etiquetas' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Control de Etiquetas</h3>
                    <p className="text-xs text-gray-500">
                      Verifique el stock disponible de etiquetas según la base de datos de SQL y sus mapeos definidos.
                    </p>
                  </div>
                  <div>
                    <select
                      title="Filtrar por calibre"
                      value={selectedCalibre}
                      onChange={(e) => setSelectedCalibre(e.target.value)}
                      className="pl-3 pr-8 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none text-gray-700 shadow-sm"
                    >
                      <option value="todos">Todos los Calibres</option>
                      {availableSizes.map((size) => (
                        <option key={size} value={size.toString()}>{size} cc</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                      <tr className="bg-indigo-50/50 text-indigo-900 border-t border-indigo-100 text-xs font-black uppercase tracking-wider">
                        <th className="px-4 py-4 text-left font-sans rounded-tl-lg">Marca</th>
                        <th className="px-4 py-4 text-left font-sans">Sabor</th>
                        <th className="px-4 py-4 text-center font-sans">Calibre</th>
                        <th className="px-4 py-4 text-right font-sans">Req. Mensual</th>
                        <th className="px-4 py-4 text-right font-sans text-indigo-700">Stock (u.)</th>
                        <th className="px-4 py-4 text-right font-sans text-indigo-700 rounded-tr-lg">Cobertura (meses)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white text-sm">
                      {(() => {
                        const items: any[] = [];
                        availableBrands.forEach(brand => {
                          availableSizes.forEach(size => {
                            const sizeStr = size.toString();
                            const brandActive = config?.activeProducts?.[brand];
                            const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
                            const hasSizeConfig = brandActive && sizeStr in brandActive;
                            
                            const allowedFlavors = hasSizeConfig
                              ? brandActive[sizeStr]
                              : (hasBrandConfig ? [] : (config?.brandFlavorCombinations[brand] || []));

                            allowedFlavors.forEach(flavor => {
                              const isExternal = (config?.externalProducts?.[brand]?.[sizeStr] || []).includes(flavor);
                              if (!isExternal && config?.enabledFlavors?.[flavor] !== false) {
                                const key = `${brand}-${flavor}-${size}`;
                                const mappedCode = etiquetasMappings[key] || '';
                                let stock = 0;
                                if (mappedCode) {
                                  const match = stockData.find(s => (s.codigo_articulo || '').toString().trim().toLowerCase() === mappedCode.toString().toLowerCase().trim());
                                  if (match) stock = match.stock_almacen;
                                }

                                const botellasPorPack = config?.botellasPorPack?.[size] || BOTELLAS_POR_PACK[size] || 6;
                                const goal = goals.find(g => g.marca === brand && g.sabor === flavor && g.tamano === size && g.quantity > 0);
                                const monthlyRequirement = goal ? goal.quantity * botellasPorPack : 0;
                                const cobertura = monthlyRequirement > 0 ? stock / monthlyRequirement : (stock > 0 ? Infinity : 0);

                                items.push({
                                  brand,
                                  flavor,
                                  size,
                                  key,
                                  mappedCode,
                                  stock,
                                  monthlyRequirement,
                                  cobertura
                                });
                              }
                            });
                          });
                        });
                        // Sort sizes descending, then brand, then flavor
                        items.sort((a,b) => {
                          if(b.size !== a.size) return b.size - a.size;
                          if(a.brand !== b.brand) return a.brand.localeCompare(b.brand);
                          return a.flavor.localeCompare(b.flavor);
                        });

                        // Filter items by selectedCalibre
                        const filteredItems = selectedCalibre === 'todos'
                          ? items
                          : items.filter(item => item.size.toString() === selectedCalibre);

                        const groupedBySize: Record<string, typeof items> = {};
                        filteredItems.forEach(item => {
                          const s = item.size.toString();
                          if (!groupedBySize[s]) groupedBySize[s] = [];
                          groupedBySize[s].push(item);
                        });

                        return Object.keys(groupedBySize)
                          .sort((a, b) => Number(b) - Number(a))
                          .flatMap((sizeStr) => [
                            <tr key={`group-${sizeStr}`} className="bg-indigo-100/50">
                              <td colSpan={6} className="px-4 py-2 font-black text-indigo-900 text-xs uppercase tracking-wider">
                                Calibre {sizeStr} cc
                              </td>
                            </tr>,
                            ...groupedBySize[sizeStr].map(item => (
                              <tr key={item.key} className="hover:bg-indigo-50/30 transition-colors">
                                <td className="px-4 py-4 font-bold text-gray-900 border-l-[3px] border-l-transparent hover:border-l-indigo-500 whitespace-nowrap">
                                  {item.brand}
                                </td>
                                <td className="px-4 py-4 font-semibold text-gray-700 whitespace-nowrap">
                                  {item.flavor}
                                </td>
                                <td className="px-4 py-4 text-center font-bold text-indigo-600 bg-indigo-50/30 whitespace-nowrap">
                                  {item.size}
                                </td>
                                <td className="px-4 py-4 text-right font-bold text-gray-700 whitespace-nowrap">
                                  {item.monthlyRequirement > 0 ? Intl.NumberFormat('es-AR').format(item.monthlyRequirement) : '-'}
                                </td>
                                <td className="px-4 py-4 text-right font-bold text-gray-900 whitespace-nowrap">
                                  {item.mappedCode ? Intl.NumberFormat('es-AR').format(item.stock) : (
                                    <span className="text-gray-300 italic text-xs font-normal">Sin cód. SQl</span>
                                  )}
                                </td>
                                <td className="px-4 py-4 text-right font-bold whitespace-nowrap">
                                  {item.cobertura === Infinity ? (
                                    <span className="text-gray-500 font-medium text-xs">Sin obj. mensual</span>
                                  ) : item.monthlyRequirement > 0 ? (
                                    <span className={item.cobertura >= 1.5 ? 'text-green-600' : item.cobertura >= 0.5 ? 'text-orange-600' : 'text-red-600'}>
                                      {item.cobertura.toFixed(1)}
                                    </span>
                                  ) : '-'}
                                </td>
                              </tr>
                            ))
                          ]);
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* CONTROL POR EMPAQUE TAB */}
          {activeTab === 'empaque' && (
            <div className="space-y-6">
              {/* Empaque Grupos */}
              {(() => {
                const items = [...programCrossover.requiredInsumosAgg].filter(item => isEmpaqueItem(item.insumoName) && getPackingCategory(item.insumoName) !== 'Etiquetas');
                const groups: Record<string, typeof items> = {};
                items.forEach(item => {
                  const cat = getPackingCategory(item.insumoName);
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(item);
                });
                
                return Object.keys(groups).sort().map(cat => (
                  <div key={cat} className="bg-white rounded-2xl shadow-sm border border-orange-100 p-6">
                    <div className="mb-6">
                       <h3 className="text-lg font-bold text-orange-900">{cat}</h3>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead>
                          <tr className="bg-orange-50 text-orange-900 border-t border-orange-100 text-xs font-black uppercase tracking-wider">
                            <th className="px-5 py-4 text-left font-sans">Material</th>
                            <th className="px-4 py-4 text-right font-sans">Stock</th>
                            <th className="px-4 py-4 text-right text-orange-700 font-sans">Consumo Mensual</th>
                            <th className="px-4 py-4 text-right text-orange-700 rounded-tr-lg font-sans">Meses Disp.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white text-sm">
                          {groups[cat].sort((a,b) => a.monthsOfStock - b.monthsOfStock).map(item => {
                            const lowerName = item.insumoName.toLowerCase();
                            const isUnit = lowerName.includes('preforma') || lowerName.includes('tapa') || lowerName.includes('etiqueta');
                            const unitStr = isUnit ? ' u.' : ' kg';
                            return (
                              <tr key={item.insumoName} className="hover:bg-orange-50/30 transition-colors">
                                <td className="px-5 py-4 font-bold text-gray-900 border-l-[3px] border-l-transparent hover:border-l-orange-500">
                                  {item.insumoName}
                                </td>
                                <td className="px-4 py-4 text-right font-medium text-gray-800">
                                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.stockKg)}{unitStr}
                                </td>
                                <td className="px-4 py-4 text-right font-bold text-orange-700 bg-orange-50/50">
                                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.monthlyRequiredKg)}{unitStr}
                                </td>
                                <td className="px-4 py-4 text-right">
                                  {item.monthsOfStock === Infinity ? (
                                    <span className="text-xs font-bold text-gray-400">0 Consumo</span>
                                  ) : (
                                    <span className={`font-sans font-bold px-2.5 py-1.5 rounded text-[13px] tracking-wide ${item.monthsOfStock < 0.5 ? 'bg-red-100 text-red-800' : item.monthsOfStock < 1 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                      {Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.monthsOfStock)} m
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ));
              })()}
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
                      {/* Ingredientes */}
                      <div className="bg-white rounded-xl border border-gray-100 p-4">
                        <h4 className="font-bold text-xs text-gray-700 uppercase tracking-widest block">Materias Primas e Ingredientes para el Plan</h4>
                        <div className="overflow-x-auto mt-4">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500 font-bold uppercase text-xs tracking-wide">
                                <th className="px-4 py-3 text-left">Insumo</th>
                                <th className="px-4 py-3 text-right text-indigo-700">Req. Semanal</th>
                                <th className="px-4 py-3 text-right">Stock (kg)</th>
                                <th className="px-4 py-3 text-center">Estado (Semanal)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white text-sm">
                              {programCrossover.requiredInsumosAgg.filter(item => !isEmpaqueItem(item.insumoName)).map(item => {
                                const lowerName = item.insumoName.toLowerCase();
                                const isUnit = lowerName.includes('preforma') || lowerName.includes('tapa') || lowerName.includes('etiqueta');
                                const unitStr = isUnit ? ' u.' : ' kg';
                                
                                return (
                                  <tr key={item.insumoName} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3">
                                      <span className="font-bold text-gray-900 block" title={item.insumoName}>
                                        {item.insumoName}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <span className="font-semibold text-indigo-700">
                                        {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.requiredKg)}{unitStr}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium text-gray-800">
                                      {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.stockKg)}{unitStr}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                      {item.requiredKg === 0 ? (
                                        <span className="bg-gray-200 text-gray-600 text-[10px] font-black uppercase px-2 py-1 rounded">
                                          Sin programar
                                        </span>
                                      ) : item.isMet ? (
                                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1">
                                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> OK
                                        </span>
                                      ) : (
                                        <span className="bg-red-100 text-red-800 text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1 leading-tight">
                                          <TrendingDown className="w-3 h-3 text-red-600" /> Falta {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.deficit)}{unitStr}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Empaque Grupos */}
                      {(() => {
                        const items = [...programCrossover.requiredInsumosAgg].filter(item => isEmpaqueItem(item.insumoName) && getPackingCategory(item.insumoName) !== 'Etiquetas');
                        const groups: Record<string, typeof items> = {};
                        items.forEach(item => {
                          const cat = getPackingCategory(item.insumoName);
                          if (!groups[cat]) groups[cat] = [];
                          groups[cat].push(item);
                        });
                        
                        return Object.keys(groups).sort().map(cat => (
                          <div key={cat} className="mt-6">
                            <h4 className="font-bold text-xs text-orange-900 uppercase tracking-widest block mb-4">{cat}</h4>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead>
                                  <tr className="bg-orange-50/50 text-orange-800 font-bold uppercase text-xs tracking-wide">
                                    <th className="px-4 py-3 text-left">Insumo</th>
                                    <th className="px-4 py-3 text-right text-orange-700">Req. Semanal</th>
                                    <th className="px-4 py-3 text-right">Stock</th>
                                    <th className="px-4 py-3 text-center">Estado (Semanal)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white text-sm">
                                  {groups[cat].map(item => {
                                    const lowerName = item.insumoName.toLowerCase();
                                    const isUnit = lowerName.includes('preforma') || lowerName.includes('tapa') || lowerName.includes('etiqueta');
                                    const unitStr = isUnit ? ' u.' : ' kg';
                                    
                                    return (
                                      <tr key={item.insumoName} className="hover:bg-orange-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <span className="font-bold text-gray-900 block break-words whitespace-normal" title={item.insumoName}>
                                            {item.insumoName}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                          <span className="font-semibold text-orange-700">
                                            {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.requiredKg)}{unitStr}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-gray-800">
                                          {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.stockKg)}{unitStr}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                          {item.requiredKg === 0 ? (
                                            <span className="bg-gray-200 text-gray-600 text-[10px] font-black uppercase px-2 py-1 rounded">
                                              Sin programar
                                            </span>
                                          ) : item.isMet ? (
                                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1">
                                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> OK
                                            </span>
                                          ) : (
                                            <span className="bg-red-100 text-red-800 text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1 leading-tight">
                                              <TrendingDown className="w-3 h-3 text-red-600" /> Falta {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.deficit)}{unitStr}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ));
                      })()}

                      {/* Etiquetas Grupo (Solo consumidas en el plan) */}
                      {(() => {
                        const items = [...programCrossover.requiredInsumosAgg].filter(item => getPackingCategory(item.insumoName) === 'Etiquetas' && item.requiredKg > 0);
                        if (items.length === 0) return null;
                        
                        return (
                          <div className="mt-6">
                            <h4 className="font-bold text-xs text-indigo-900 uppercase tracking-widest block mb-4">Etiquetas</h4>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead>
                                  <tr className="bg-indigo-50/50 text-indigo-800 font-bold uppercase text-xs tracking-wide">
                                    <th className="px-4 py-3 text-left">Insumo</th>
                                    <th className="px-4 py-3 text-right text-indigo-700">Req. Semanal</th>
                                    <th className="px-4 py-3 text-right">Stock</th>
                                    <th className="px-4 py-3 text-center">Estado (Semanal)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white text-sm">
                                  {items.map(item => {
                                    return (
                                      <tr key={item.insumoName} className="hover:bg-indigo-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <span className="font-bold text-gray-900 block break-words whitespace-normal" title={item.insumoName}>
                                            {item.insumoName}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                          <span className="font-semibold text-indigo-700">
                                            {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.requiredKg)} u.
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-gray-800">
                                          {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.stockKg)} u.
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                          {item.requiredKg === 0 ? (
                                            <span className="bg-gray-200 text-gray-600 text-[10px] font-black uppercase px-2 py-1 rounded">
                                              Sin programar
                                            </span>
                                          ) : item.isMet ? (
                                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1">
                                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> OK
                                            </span>
                                          ) : (
                                            <span className="bg-red-100 text-red-800 text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1 leading-tight">
                                              <TrendingDown className="w-3 h-3 text-red-600" /> Falta {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(item.deficit)} u.
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                    </div>

                    {/* Weekly Production Supplies Summary (Preformas, Termo, Stretch, Tapas, Etiquetas) */}
                    <div className="space-y-4 pt-4 border-t">
                      <div>
                        <h4 className="font-bold text-xs text-sidebar uppercase tracking-widest block">Resumen Semanal de Otros Insumos</h4>
                        <p className="text-xs text-gray-500 mt-1">Suma total de materiales de producción requeridos para cumplir todo el plan publicado</p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        {/* Preformas */}
                        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-teal-850 bg-teal-100/60 px-2.5 py-1 rounded-md">Preformas</span>
                            <div className="text-xl font-black text-teal-950 mt-2 font-mono">
                              {Intl.NumberFormat('es-AR').format(
                                (Object.values(programCrossover.preformasAgg || {}) as number[]).reduce((a, b) => a + b, 0)
                              )} <span className="text-xs font-semibold text-teal-700">u.</span>
                            </div>
                          </div>
                          <div className="mt-3 border-t border-slate-200/60 pt-2 space-y-1">
                            {Object.entries(programCrossover.preformasAgg || {}).map(([size, value]) => (
                              <div key={size} className="flex justify-between items-center text-[11px] font-medium text-slate-700">
                                <span className="font-bold">{size} cc</span>
                                <span className="font-bold font-mono text-teal-900 bg-teal-50 px-1.5 py-0.5 rounded">{Intl.NumberFormat('es-AR').format(value as number)} u.</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Termocontraible */}
                        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-amber-850 bg-amber-100/60 px-2.5 py-1 rounded-md">Termocontraible</span>
                            <div className="text-xl font-black text-amber-950 mt-2 font-mono">
                              {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(
                                (Object.values(programCrossover.termoAgg || {}) as number[]).reduce((a, b) => a + b, 0)
                              )} <span className="text-xs font-semibold text-amber-700">kg</span>
                            </div>
                          </div>
                          <div className="mt-3 border-t border-slate-200/60 pt-2 space-y-1">
                            {Object.entries(programCrossover.termoAgg || {}).map(([size, value]) => (
                              <div key={size} className="flex justify-between items-center text-[11px] font-medium text-slate-700">
                                <span className="font-bold">{size} cc</span>
                                <span className="font-bold font-mono text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded">{(value as number).toFixed(1)} kg</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Film Stretch */}
                        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-purple-850 bg-purple-100/60 px-2.5 py-1 rounded-md">Film Stretch</span>
                            <div className="text-xl font-black text-purple-950 mt-2 font-mono">
                              {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(
                                (Object.values(programCrossover.stretchAgg || {}) as number[]).reduce((a, b) => a + b, 0)
                              )} <span className="text-xs font-semibold text-purple-700">kg</span>
                            </div>
                          </div>
                          <div className="mt-3 border-t border-slate-200/60 pt-2 space-y-1">
                            {Object.entries(programCrossover.stretchAgg || {}).map(([size, value]) => (
                              <div key={size} className="flex justify-between items-center text-[11px] font-medium text-slate-700">
                                <span className="font-bold">{size} cc</span>
                                <span className="font-bold font-mono text-purple-900 bg-purple-50 px-1.5 py-0.5 rounded">{(value as number).toFixed(1)} kg</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Tapas */}
                        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-blue-800 bg-blue-100/60 px-2.5 py-1 rounded-md">Tapas</span>
                            <div className="text-xl font-black text-blue-950 mt-2 font-mono">
                              {Intl.NumberFormat('es-AR').format(
                                (Object.values(programCrossover.tapasAgg || {}) as number[]).reduce((a, b) => a + b, 0)
                              )} <span className="text-xs font-semibold text-blue-700">u.</span>
                            </div>
                          </div>
                          <div className="mt-3 border-t border-slate-200/60 pt-2 max-h-[120px] overflow-y-auto space-y-1.5 scrollbar-thin">
                            {Object.entries(programCrossover.tapasAgg || {}).map(([key, value]) => (
                              <div key={key} className="flex justify-between items-center text-[11px] font-medium text-slate-700">
                                <span className="font-semibold text-left break-words max-w-[120px]" title={key}>{key}</span>
                                <span className="font-bold font-mono text-blue-900 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap">{Intl.NumberFormat('es-AR').format(value as number)} u.</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Etiquetas */}
                        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-rose-800 bg-rose-100/60 px-2.5 py-1 rounded-md">Etiquetas</span>
                            <div className="text-xl font-black text-rose-950 mt-2 font-mono">
                              {Intl.NumberFormat('es-AR').format(
                                (Object.values(programCrossover.etiquetasAgg || {}) as number[]).reduce((a, b) => a + b, 0)
                              )} <span className="text-xs font-semibold text-rose-700">u.</span>
                            </div>
                          </div>
                          <div className="mt-3 border-t border-slate-200/60 pt-2 max-h-[120px] overflow-y-auto space-y-1.5 scrollbar-thin">
                            {Object.entries(programCrossover.etiquetasAgg || {}).map(([key, value]) => (
                              <div key={key} className="flex justify-between items-center text-[11px] font-medium text-slate-700">
                                <span className="font-semibold text-left break-words max-w-[120px]" title={key}>{key}</span>
                                <span className="font-bold font-mono text-rose-950 bg-rose-50 px-1.5 py-0.5 rounded whitespace-nowrap">{Intl.NumberFormat('es-AR').format(value as number)} u.</span>
                              </div>
                            ))}
                          </div>
                        </div>
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
                              <th className="px-3 py-2 text-right">Packs</th>
                              <th className="px-3 py-2 text-right text-emerald-700 font-bold">Bebida (L)</th>
                              <th className="px-3 py-2 text-right text-indigo-700 font-bold">Jarabe (L)</th>
                              <th className="px-3 py-2 text-right text-teal-700 font-bold">Preformas</th>
                              <th className="px-3 py-2 text-right text-amber-700 font-bold">Termo</th>
                              <th className="px-3 py-2 text-right text-purple-700 font-bold">Stretch</th>
                              <th className="px-3 py-2 text-right text-blue-700 font-bold">Tapas</th>
                              <th className="px-3 py-2 text-right text-rose-700 font-bold">Etiquetas</th>
                              <th className="px-3 py-2 text-center text-gray-700 font-bold">Info</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {programCrossover.programSummary
                                .filter((p) => p.date >= format(new Date(), 'yyyy-MM-dd'))
                                .map((planSummary) => {
                              const uniqueId = planSummary.id || `${planSummary.date}-${planSummary.linea}-${planSummary.shift}`;
                              const isExpanded = expandedPlanId === uniqueId;

                              return (
                                <Fragment key={uniqueId}>
                                  <tr 
                                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-indigo-50/20' : ''}`}
                                    onClick={() => setExpandedPlanId(isExpanded ? null : uniqueId)}
                                  >
                                    <td className="px-3 py-2.5 font-medium text-gray-900">
                                      <div className="font-bold capitalize">{format(parseISO(planSummary.date), "dd/MM - EE", { locale: es })}</div>
                                      <div className="text-[10px] text-gray-500 font-semibold">{planSummary.shift} (L{planSummary.linea})</div>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <span className="text-[10px] font-black text-indigo-750 uppercase block tracking-wide">{planSummary.brand}</span>
                                      <span className="font-bold text-gray-800">{planSummary.flavor}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-semibold text-gray-650">
                                      {Intl.NumberFormat('es-AR').format(planSummary.size)} ml
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-black text-gray-900 font-mono">
                                      {Intl.NumberFormat('es-AR').format(planSummary.packs)} pks
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-emerald-600 font-mono">
                                      {Intl.NumberFormat('es-AR').format(Math.round(planSummary.beverageLiters))} L
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-indigo-600 font-mono">
                                      {Intl.NumberFormat('es-AR').format(Math.round(planSummary.syrupLitersNeeded))} L
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-teal-650 font-mono">
                                      {Intl.NumberFormat('es-AR').format(planSummary.preformasNeeded)} u.
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-amber-650 font-mono">
                                      {planSummary.termoNeededKg.toFixed(2)} kg
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-purple-650 font-mono">
                                      {planSummary.stretchNeededKg.toFixed(2)} kg
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-blue-650 font-mono">
                                      {Intl.NumberFormat('es-AR').format(planSummary.tapasNeeded)} u.
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-rose-650 font-mono">
                                      {Intl.NumberFormat('es-AR').format(planSummary.etiquetasNeeded)} u.
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      <button 
                                        type="button"
                                        className="text-[10px] font-black text-slate-500 hover:text-indigo-600 px-1.5 py-0.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
                                      >
                                        {isExpanded ? "▲" : "▼"}
                                      </button>
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr className="bg-slate-50/50">
                                      <td colSpan={12} className="px-4 py-3 border-y border-slate-200/80">
                                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-1">
                                          {/* Preformas Detail */}
                                          <div className="bg-white p-2.5 rounded-lg border border-teal-100 shadow-xs">
                                            <span className="text-[10px] font-black uppercase text-teal-850 tracking-wider">Preformas</span>
                                            <div className="text-sm font-bold text-teal-950 mt-1 font-mono">
                                              {Intl.NumberFormat('es-AR').format(planSummary.preformasNeeded)} u.
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-semibold mt-1">
                                              Calibre: <strong className="text-slate-700">{planSummary.size}cc</strong>
                                            </div>
                                          </div>

                                          {/* Termocontraible Detail */}
                                          <div className="bg-white p-2.5 rounded-lg border border-amber-100 shadow-xs">
                                            <span className="text-[10px] font-black uppercase text-amber-850 tracking-wider">Termocontraible</span>
                                            <div className="text-sm font-bold text-amber-950 mt-1 font-mono">
                                              {planSummary.termoNeededKg.toFixed(2)} kg
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-semibold mt-1">
                                              Calibre: <strong className="text-slate-700">{planSummary.size}cc</strong>
                                            </div>
                                          </div>

                                          {/* Stretch Detail */}
                                          <div className="bg-white p-2.5 rounded-lg border border-purple-100 shadow-xs">
                                            <span className="text-[10px] font-black uppercase text-purple-850 tracking-wider">Film Stretch</span>
                                            <div className="text-sm font-bold text-purple-950 mt-1 font-mono">
                                              {planSummary.stretchNeededKg.toFixed(2)} kg
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-semibold mt-1">
                                              Packs: <strong className="text-slate-700">{planSummary.packs} pks</strong>
                                            </div>
                                          </div>

                                          {/* Tapas Detail */}
                                          <div className="bg-white p-2.5 rounded-lg border border-blue-105 shadow-xs">
                                            <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider">Tapas</span>
                                            <div className="text-sm font-bold text-blue-950 mt-1 font-mono">
                                              {Intl.NumberFormat('es-AR').format(planSummary.tapasNeeded)} u.
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-semibold mt-1">
                                              Tapa <strong className="text-slate-700">{planSummary.size}cc - {planSummary.flavor}</strong>
                                            </div>
                                          </div>

                                          {/* Etiquetas Detail */}
                                          <div className="bg-white p-2.5 rounded-lg border border-rose-100 shadow-xs">
                                            <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider">Etiquetas</span>
                                            <div className="text-sm font-bold text-rose-950 mt-1 font-mono">
                                              {Intl.NumberFormat('es-AR').format(planSummary.etiquetasNeeded)} u.
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-semibold mt-1">
                                              Etiqueta <strong className="text-slate-700">{planSummary.flavor} ({planSummary.size}cc)</strong>
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
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
