import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppConfig } from '../hooks/useAppConfig';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  AlertTriangle,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  Search,
  Filter,
  Layers,
  History,
  Trash2,
  Calendar,
  Clock,
  ArrowUpDown,
  SearchX,
  FileText
} from 'lucide-react';
import { startOfWeek, addDays, format, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BOTELLAS_POR_PACK, WASTE_WEIGHTS, PACKS_POR_PALETA } from '../constants';
import { ProductionPlan, MonthlyGoal } from '../types';
import * as XLSX from 'xlsx';

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
}

interface HistoricalInventoryHeader {
  id: string;
  fileName: string;
  uploadedAt: string;
  itemsCount: number;
}

export function PhysicalInventoryReport() {
  const { config, availableBrands, availableFlavors, availableSizes } = useAppConfig();
  
  // Database State
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetasMappings, setEtiquetasMappings] = useState<Record<string, string>>({});
  const [historicalLoads, setHistoricalLoads] = useState<HistoricalInventoryHeader[]>([]);
  
  // Local Upload State
  const [uploadedInventory, setUploadedInventory] = useState<PhysicalInventoryRow[]>([]);
  const [inventoryFileName, setInventoryFileName] = useState<string | null>(null);
  const [inventoryDate, setInventoryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [isSavingInventory, setIsSavingInventory] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sorting and Filtering
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [sortField, setSortField] = useState<keyof PhysicalInventoryRow>('codigo');
  const [sortAsc, setSortAsc] = useState(true);

  // File drag state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Excel Mapping & Configurations
  useEffect(() => {
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

    fetchMappings();
  }, []);

  // Subscribe to past loaded inventories
  useEffect(() => {
    const qInventories = query(
      collection(db, 'physical_inventories')
    );

    const unsubscribeInventories = onSnapshot(qInventories, (snap) => {
      const loads = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          fileName: data.fileName || 'Inventario',
          uploadedAt: data.uploadedAt || '',
          itemsCount: Array.isArray(data.items) ? data.items.length : 0
        };
      });
      // Sort newest upload first
      loads.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      setHistoricalLoads(loads);
    });

    return () => {
      unsubscribeInventories();
    };
  }, []);

  // Set up Excel drag-and-drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processExcelFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processExcelFile(file);
    }
  };

  // Main Excel processing logic
  const processExcelFile = (file: File) => {
    setInventoryFileName(file.name);
    setError(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        if (rawData.length === 0) {
          throw new Error('El archivo de Excel se encuentra vacío.');
        }

        // Search header row dynamically
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

        // Map excel columns to logical keys
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
        const idxFinal = getIndex('saldoFinalDeposito', 13);

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
            saldoFinalDeposito: saldoFinalDep
          });
        }

        if (parsedRows.length === 0) {
          throw new Error('No se encontraron artículos importables con los formatos requeridos.');
        }

        setUploadedInventory(parsedRows);
        setError(null);
      } catch (err: any) {
        console.error("Error parsing Inventory Excel:", err);
        setError('No se pudo procesar el archivo Excel. Verifique que contenga las columnas e identificadores de stock correctos.');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Sincronizar el inventario físico con Firestore
  const saveInventoryToSystem = async () => {
    if (uploadedInventory.length === 0) return;
    setIsSavingInventory(true);
    setError(null);
    try {
      const timestamp = new Date().toISOString();
      const invId = `inventory-${timestamp.substring(0, 10)}-${Date.now()}`;

      // Overwrite the SQL Stock Cache document so all modules view and load these final warehouse numbers
      const newStockData = uploadedInventory.map(row => ({
        codigo_articulo: row.codigo,
        nombre_articulo: row.producto,
        stock_almacen: row.saldoFinalDeposito,
        stock_piso: 0,
        stock_final: row.saldoFinalDeposito
      }));

      await setDoc(doc(db, 'config', 'sql_last_insumos_stock'), {
        data: newStockData,
        updatedAt: timestamp
      });

      // Maintain a historical upload trace
      await setDoc(doc(db, 'physical_inventories', invId), {
        id: invId,
        fileName: inventoryFileName || 'Inventario Manual',
        inventoryDate: inventoryDate,
        uploadedAt: timestamp,
        items: uploadedInventory
      });

      // Merge and Override simulated_stocks_cache in localStorage so Simulation Mode matches these numbers
      try {
        const cachedSimStr = localStorage.getItem('simulated_stocks_cache');
        const nextSimulated = cachedSimStr ? JSON.parse(cachedSimStr) : {};

        uploadedInventory.forEach(row => {
          // Search mappings
          const matchedInsumo = Object.keys(insumoMappings).find(k => insumoMappings[k] === row.codigo);
          if (matchedInsumo) {
            nextSimulated[matchedInsumo] = row.saldoFinalDeposito;
          } else {
            // Check packages configurations
            if (config) {
              const pref = (config.preformasConfig || []).find(p => p.sqlCode === row.codigo);
              if (pref) nextSimulated[pref.name] = row.saldoFinalDeposito;
              const tm = (config.termoConfig || []).find(t => t.sqlCode === row.codigo);
              if (tm) nextSimulated[tm.name] = row.saldoFinalDeposito;
              const str = (config.stretchConfig || []).find(s => s.sqlCode === row.codigo);
              if (str) nextSimulated[str.name] = row.saldoFinalDeposito;
              const tp = (config.tapaConfig || []).find(t => t.sqlCode === row.codigo);
              if (tp) nextSimulated[tp.name] = row.saldoFinalDeposito;
            }
          }
        });
        localStorage.setItem('simulated_stocks_cache', JSON.stringify(nextSimulated));
      } catch (e) {
        console.error("Local simulated stock cache update failed", e);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      console.error("Error saving inventory to Firestore:", err);
      setError('Error al resguardar inventario físico en base de datos: ' + (err.message || err));
    } finally {
      setIsSavingInventory(false);
    }
  };

  // Restore previous historical inventory upload
  const loadHistoricalInventory = async (id: string) => {
    try {
      const docSnap = await getDoc(doc(db, 'physical_inventories', id));
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.items)) {
          setUploadedInventory(data.items);
          setInventoryFileName(data.fileName || 'Inventario Restaurado');
          setHistoryOpen(false);
          setError(null);
        }
      }
    } catch (e: any) {
      setError("No se pudo recuperar el inventario histórico seleccionado.");
    }
  };

  // Remove trace from historical lists safely
  const deleteHistoricalInventory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('¿Está seguro de eliminar de forma permanente este registro histórico?')) return;
    try {
      await deleteDoc(doc(db, 'physical_inventories', id));
    } catch (e: any) {
      console.error("Deletion failed", e);
    }
  };

  // Equivalent analysis matching system insumos to Excel values
  const systemEquivalences = useMemo(() => {
    if (!config || uploadedInventory.length === 0) return [];

    const formulaInsumos = [
      ...(config.insumos || []),
      ...(config.preformasConfig || []).map(p => p.name),
      ...(config.termoConfig || []).map(t => t.name),
      ...(config.stretchConfig || []).map(s => s.name),
      ...(config.tapaConfig || []).map(t => t.name)
    ];

    availableBrands.forEach(brand => {
      availableSizes.forEach(size => {
        const brandActive = config.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const hasSizeConfig = brandActive && size.toString() in brandActive;
        const allowedFlavors = hasSizeConfig
          ? brandActive[size.toString()]
          : (hasBrandConfig ? [] : (config.brandFlavorCombinations[brand] || []));
        allowedFlavors.forEach(flavor => {
          const key = `Etiqueta ${brand} / ${flavor} / ${size}cc`;
          if (!formulaInsumos.includes(key)) formulaInsumos.push(key);
        });
      });
    });

    const results: any[] = [];

    formulaInsumos.forEach(insumoName => {
      let code = insumoMappings[insumoName];
      if (!code && config) {
        const p = (config.preformasConfig || []).find(item => item.name === insumoName);
        if (p) code = p.sqlCode;
        const t = (config.termoConfig || []).find(item => item.name === insumoName);
        if (t) code = t.sqlCode;
        const s = (config.stretchConfig || []).find(item => item.name === insumoName);
        if (s) code = s.sqlCode;
        const tp = (config.tapaConfig || []).find(item => item.name === insumoName);
        if (tp) code = tp.sqlCode;
        
        if (!code && insumoName.startsWith("Etiqueta ")) {
          const parts = insumoName.substring(9).split(" / ");
          if (parts.length >= 3) {
            const brand = parts[0];
            const flavor = parts[1];
            const size = parseInt(parts[2]);
            const key = `${brand}-${flavor}-${size}`;
            code = etiquetasMappings[key];
          }
        }
      }

      const rowMatch = code ? uploadedInventory.find(row => row.codigo === code) : null;

      results.push({
        insumoName,
        code: code || 'S/C',
        excelName: rowMatch ? rowMatch.producto : '(No encontrado en Excel)',
        tipo: rowMatch ? rowMatch.tipo : 'S/D',
        saldoFinalDeposito: rowMatch ? rowMatch.saldoFinalDeposito : 0,
        matched: !!rowMatch
      });
    });

    // Sort to show matched items first, then alphabetical
    return results.sort((a, b) => {
      if (a.matched && !b.matched) return -1;
      if (!a.matched && b.matched) return 1;
      return a.insumoName.localeCompare(b.insumoName);
    });
  }, [config, uploadedInventory, insumoMappings, etiquetasMappings, availableBrands, availableSizes]);

  // Handle Sort Toggle
  const requestSort = (field: keyof PhysicalInventoryRow) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Process rows after sorting / filtering
  const processedTableRows = useMemo(() => {
    let list = [...uploadedInventory];

    // Term search
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      list = list.filter(r => 
        r.codigo.toLowerCase().includes(term) || 
        r.producto.toLowerCase().includes(term) ||
        r.tipo.toLowerCase().includes(term)
      );
    }

    // Category Filter
    if (typeFilter !== 'todos') {
      list = list.filter(r => r.tipo.toLowerCase() === typeFilter.toLowerCase());
    }

    // Sort items
    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortAsc 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        const numA = (valA as number) || 0;
        const numB = (valB as number) || 0;
        return sortAsc 
          ? numA - numB 
          : numB - numA;
      }
    });

    return list;
  }, [uploadedInventory, searchTerm, typeFilter, sortField, sortAsc]);

  // Available parsed categories
  const parsedCategories = useMemo(() => {
    const cats = new Set<string>();
    uploadedInventory.forEach(row => {
      if (row.tipo) cats.add(row.tipo);
    });
    return Array.from(cats).sort();
  }, [uploadedInventory]);

  // Totalized Metrics
  const summaryMetrics = useMemo(() => {
    let totSaldoInicial = 0;
    let totEntradas = 0;
    let totSalidas = 0;
    let totFinal = 0;

    uploadedInventory.forEach(row => {
      totSaldoInicial += row.saldoInicial;
      totEntradas += (row.entradasAlmacen + row.entradasOtros + row.ajustePositivo);
      totSalidas += (row.salidaOtros + row.salidaConsumo + row.ajusteNegativo);
      totFinal += row.saldoFinalDeposito;
    });

    return {
      totSaldoInicial,
      totEntradas,
      totSalidas,
      totFinal,
      totItems: uploadedInventory.length
    };
  }, [uploadedInventory]);

  return (
    <div className="space-y-6 container mx-auto px-4 py-6" id="physical-inventory-container">
      
      {/* Header Widget */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <FileSpreadsheet className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900 tracking-tight">Conciliación de Inventario Físico</h1>
              <p className="text-xs text-gray-400 mt-0.5">Suba sus planillas Excel diarias/mensuales de existencias para analizar desvíos, auditar consumos y proyectar coberturas</p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <input 
            type="date"
            value={inventoryDate}
            onChange={(e) => setInventoryDate(e.target.value)}
            className="px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-black text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="px-4 py-2.5 bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all shadow-sm"
          >
            <History className="w-4 h-4 text-indigo-600" />
            Ver Historial ({historicalLoads.length})
          </button>
          
          {uploadedInventory.length > 0 && (
            <button
              onClick={saveInventoryToSystem}
              disabled={isSavingInventory}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all shadow-sm ${
                isSavingInventory 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow-emerald-200'
              }`}
            >
              {isSavingInventory ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {isSavingInventory ? 'Guardando...' : 'Aplicar Inventario en Sistema'}
            </button>
          )}
        </div>
      </div>

      {/* Upload Info Alerts */}
      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="text-xs font-bold">
            ¡Inventario consolidado correctamente en el sistema! Los datos de control de insumos y simuladores se han sincronizado con éxito.
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
          <XCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="text-xs font-bold">{error}</div>
        </div>
      )}

      {/* Historical Side Panel overlay drawer */}
      {historyOpen && (
        <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-md shadow-indigo-50/50 transition-all">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <h3 className="text-sm font-black text-indigo-900 uppercase tracking-widest flex items-center gap-2">
              <History className="w-4 h-4" />
              Histórico de Cargas Guardadas
            </h3>
            <button 
              onClick={() => setHistoryOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-700 font-bold"
            >
              Cerrar (✕)
            </button>
          </div>

          {historicalLoads.length === 0 ? (
            <p className="text-gray-400 text-xs py-4 text-center">No hay registros de inventarios cargados anteriormente.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {historicalLoads.map((load) => (
                <div 
                  key={load.id}
                  onClick={() => loadHistoricalInventory(load.id)}
                  className="bg-gray-50 hover:bg-indigo-50/40 border border-gray-100 hover:border-indigo-200 rounded-xl p-4 cursor-pointer transition-all flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-gray-900 line-clamp-1 block" title={load.fileName}>{load.fileName}</span>
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-indigo-400" />
                      {new Date(load.uploadedAt).toLocaleString('es-AR')}
                    </span>
                    <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full inline-block">
                      {load.itemsCount} Artículos
                    </span>
                  </div>
                  <button
                    onClick={(e) => deleteHistoricalInventory(e, load.id)}
                    className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors border border-transparent hover:border-red-100"
                    title="Eliminar registro"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Drag & Drop Section if no data uploaded yet */}
      {uploadedInventory.length === 0 ? (
        <div 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-3 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[360px] bg-white ${
            isDragging 
              ? 'border-emerald-500 bg-emerald-50/30' 
              : 'border-slate-200 hover:border-indigo-400'
          }`}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xlsx,.xls"
            className="hidden"
          />
          <div className="p-5 bg-gradient-to-tr from-emerald-50 to-emerald-100 rounded-2xl text-emerald-600 mb-4 shadow-sm hover:scale-105 transition-transform duration-200">
            <Upload className="w-10 h-10" />
          </div>
          <h3 className="text-lg font-bold text-gray-800">Cargar Inventario Físico de Depósito</h3>
          <p className="text-xs text-gray-400 max-w-md mt-2 leading-relaxed">
            Arrastre su archivo Excel de existencias aquí o haga clic para examinarlo desde su dispositivo.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-[11px] font-bold text-gray-500 bg-slate-50 border border-slate-100 px-4 py-2.5 rounded-xl px-4">
            <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-emerald-500" /> Auto-mapeo de Columnas</span>
            <span className="text-gray-300">|</span>
            <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-emerald-500" /> Cálculo Atómico de Desvíos</span>
          </div>
        </div>
      ) : (
        /* Data is uploaded: Render metrics, groups analyzed, and table filters */
        <div className="space-y-6">
          
          {/* File state & reset banner */}
          <div className="bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest block">Archivo Seleccionado</span>
                <span className="text-sm font-extrabold text-slate-850">{inventoryFileName || 'Inventario cargado'}</span>
              </div>
            </div>
            
            <button
              onClick={() => {
                setUploadedInventory([]);
                setInventoryFileName(null);
                setError(null);
              }}
              className="px-4 py-2 text-slate-600 hover:text-red-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors border border-dashed border-slate-300 hover:border-red-300 bg-white"
            >
              Reiniciar / Limpiar Datos
            </button>
          </div>

          {/* Quick Metrics Header Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Total Artículos</span>
                <span className="text-xl font-black text-slate-800 mt-1 block">
                  {summaryMetrics.totItems}
                </span>
                <span className="text-[9px] text-gray-400 block mt-0.5">leídos desde planilla</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block font-sans">Stock Físico Sumado</span>
                <span className="text-xl font-black text-emerald-700 mt-1 block">
                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(summaryMetrics.totFinal)}
                </span>
                <span className="text-[9px] text-emerald-600 font-bold block mt-0.5">unidades en depósito</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center justify-between font-sans">
              <div>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Total Entradas</span>
                <span className="text-xl font-black text-slate-800 mt-1 block">
                  {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(summaryMetrics.totEntradas)}
                </span>
                <span className="text-[9px] text-gray-400 block mt-0.5">sumatoria movimientos +</span>
              </div>
            </div>

          </div>

          {/* Equivalent / Mapped Database Groups Table (Coverage Indicators Removed) */}
          <div className="bg-white rounded-2xl border border-gray-150 p-6 shadow-sm">
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-md font-bold text-gray-900 flex items-center gap-1.5 font-sans">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  Mapeo de Equivalencias de Insumos Activos
                </h3>
                <p className="text-xs text-gray-400 mt-1">Conexión directa entre los insumos vigentes del sistema y los registros leídos del Excel</p>
              </div>
            </div>

            {systemEquivalences.length === 0 ? (
              <p className="text-center py-6 text-xs text-gray-400">Verifique las configuraciones y mappings de códigos en Administración.</p>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-gray-500 uppercase tracking-wider font-black text-left text-[10px]">
                      <th className="px-4 py-3 font-sans">Insumo del Sistema</th>
                      <th className="px-4 py-3 font-sans">Código Mapeado</th>
                      <th className="px-4 py-3 font-sans">Descripción en Excel</th>
                      <th className="px-4 py-3 font-sans">Categoría</th>
                      <th className="px-4 py-3 text-right font-sans">Existencia Física (Excel)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150">
                    {systemEquivalences.map((res: any, idx: number) => (
                      <tr key={idx} className={`hover:bg-slate-50/70 transition-colors ${!res.matched ? 'bg-gray-50/30' : ''}`}>
                        <td className="px-4 py-3.5">
                          <span className="font-extrabold text-slate-800 block text-[11px] leading-snug">{res.insumoName}</span>
                        </td>
                        <td className="px-4 py-3.5 font-mono font-bold text-gray-500">{res.code}</td>
                        <td className={`px-4 py-3.5 text-slate-700 italic font-medium ${!res.matched ? 'text-gray-400 font-normal' : ''}`}>
                          {res.excelName}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-600 font-extrabold uppercase">
                            {res.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-extrabold text-indigo-900 bg-indigo-50/5">
                          {res.matched ? Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(res.saldoFinalDeposito) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Filtering and Detailed Table Tab */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            
            {/* Table Control Filters */}
            <div className="flex flex-col lg:flex-row gap-4 items-center justify-between border-b pb-4">
              <div>
                <h4 className="text-sm font-black text-gray-800 uppercase tracking-widest">Listado de Artículos Conciliados</h4>
                <p className="text-[11px] text-gray-400 mt-0.5">Audite línea por línea los balances de saldo inicial, consumos calculados y diferencias físicas</p>
              </div>

              {/* Advanced Filter options */}
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                
                {/* Search Term input */}
                <div className="relative flex-1 lg:w-60 min-w-[190px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar código o descripción..."
                    className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50"
                  />
                </div>

                {/* Categories Filter Selector */}
                <select
                  title="Filtrar Categoría"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl focus:outline-none text-gray-700 font-bold"
                >
                  <option value="todos">Todas las categorías</option>
                  {parsedCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>

                {/* Deviation Only Toggle */}
                {/* Removed Dev Filter */}

              </div>
            </div>

            {/* Main Responsive Table */}
            {processedTableRows.length === 0 ? (
              <div className="text-center py-12 flex flex-col items-center justify-center">
                <SearchX className="w-10 h-10 text-gray-350" />
                <p className="text-xs text-gray-400 font-bold mt-2">No se encontraron artículos con los filtros aplicados.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="min-w-full divide-y divide-gray-150 text-xs text-left">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase font-black tracking-wider text-[10px]">
                      <th className="px-4 py-3 cursor-pointer select-none font-sans" onClick={() => requestSort('codigo')}>
                        <div className="flex items-center gap-1">Código <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 cursor-pointer select-none font-sans" onClick={() => requestSort('producto')}>
                        <div className="flex items-center gap-1">Producto / Artículo <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 cursor-pointer select-none font-sans" onClick={() => requestSort('tipo')}>
                        <div className="flex items-center gap-1">Categoría <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-right cursor-pointer select-none font-sans" onClick={() => requestSort('saldoInicial')}>
                        <div className="flex items-center justify-end gap-1">Saldo Inicial <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-right font-sans">Movs (+ / -)</th>
                      <th className="px-4 py-3 text-right cursor-pointer select-none text-indigo-850 font-sans" onClick={() => requestSort('saldoFinalDeposito')}>
                        <div className="flex items-center justify-end gap-1">Stock Físico <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {processedTableRows.map((row, idx) => {
                      const calculatedIn = (row.entradasAlmacen + row.entradasOtros + row.ajustePositivo);
                      const calculatedOut = (row.devolucionAlmacen + row.salidaOtros + row.salidaConsumo + row.ajusteNegativo);
                      const isDesv = Math.abs(row.desvio) > 0.01;
                      
                      return (
                        <tr key={idx} className={`hover:bg-slate-50 border-l-3 transition-colors ${
                          isDesv ? 'border-l-amber-300' : 'border-l-transparent'
                        }`}>
                          <td className="px-4 py-3 font-mono font-bold text-gray-500">{row.codigo}</td>
                          <td className="px-4 py-3 font-bold text-slate-800 line-clamp-2 max-w-[260px]" title={row.producto}>{row.producto}</td>
                          <td className="px-4 py-3">
                            <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-600 font-extrabold uppercase">{row.tipo}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.saldoInicial)}
                          </td>
                          <td className="px-4 py-3 text-right flex flex-col justify-center">
                            <span className="text-[10px] text-emerald-600 block font-bold">+{Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(calculatedIn)}</span>
                            <span className="text-[10px] text-red-500 block font-bold">-{Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.abs(calculatedOut))}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-extrabold text-indigo-900 bg-indigo-50/15">
                            {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.saldoFinalDeposito)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
}
