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
  FileText,
  Percent,
  TrendingUp
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
  desvio: number;
  porcentaje: number;
}

interface HistoricalInventoryHeader {
  id: string;
  fileName: string;
  uploadedAt: string;
  inventoryDate?: string;
  itemsCount: number;
}

export function PhysicalInventoryReport() {
  const { config, availableBrands, availableFlavors, availableSizes } = useAppConfig();
  
  // Database State
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetasMappings, setEtiquetasMappings] = useState<Record<string, string>>({});
  const [historicalLoads, setHistoricalLoads] = useState<HistoricalInventoryHeader[]>([]);
  const [fullHistoricalDocs, setFullHistoricalDocs] = useState<any[]>([]);
  
  // Local Upload State
  const [uploadedInventory, setUploadedInventory] = useState<PhysicalInventoryRow[]>([]);
  const [inventoryFileName, setInventoryFileName] = useState<string | null>(null);
  const [inventoryDate, setInventoryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [isSavingInventory, setIsSavingInventory] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Tabs and view structures
  const [activeMainTab, setActiveMainTab] = useState<'historial' | 'carga'>('historial');
  const [historyTab, setHistoryTab] = useState<'desvios' | 'mensual'>('desvios');
  const [analysisPeriod, setAnalysisPeriod] = useState<string>('all');
  const [analysisSearch, setAnalysisSearch] = useState<string>('');
  const [analysisCategoryFilter, setAnalysisCategoryFilter] = useState<string>('all');
  const [mensualFilterType, setMensualFilterType] = useState<'articulo' | 'categoria' | 'grupo'>('articulo');
  const [mensualSearch, setMensualSearch] = useState<string>('');
  const [percentBase, setPercentBase] = useState<'consumo' | 'teorico' | 'fisico'>('consumo');
  const [prefFont, setPrefFont] = useState<'sans' | 'display' | 'mono'>('sans');
  const [desviosViewGrouped, setDesviosViewGrouped] = useState<'articulo' | 'grupo'>('articulo');

  // Advanced Sorting states
  const [sortCatField, setSortCatField] = useState<'tipo' | 'conteoReportes' | 'desvioAcumulado' | 'porcentajeDesvio'>('tipo');
  const [sortCatAsc, setSortCatAsc] = useState<boolean>(true);

  const [sortArtField, setSortArtField] = useState<'producto' | 'codigo' | 'tipo' | 'conteoReportes' | 'desvioAcumulado' | 'porcentajeDesvio' | 'desvioAbsolutoAcumulado'>('desvioAbsolutoAcumulado');
  const [sortArtAsc, setSortArtAsc] = useState<boolean>(false);

  const [sortMonthlyField, setSortMonthlyField] = useState<string>('elemento');
  const [sortMonthlyAsc, setSortMonthlyAsc] = useState<boolean>(true);

  const handleSortCat = (field: typeof sortCatField) => {
    if (sortCatField === field) {
      setSortCatAsc(!sortCatAsc);
    } else {
      setSortCatField(field);
      setSortCatAsc(true);
    }
  };

  const handleSortArt = (field: typeof sortArtField) => {
    if (sortArtField === field) {
      setSortArtAsc(!sortArtAsc);
    } else {
      setSortArtField(field);
      setSortArtAsc(true);
    }
  };

  const handleSortMonthly = (field: string) => {
    if (sortMonthlyField === field) {
      setSortMonthlyAsc(!sortMonthlyAsc);
    } else {
      setSortMonthlyField(field);
      setSortMonthlyAsc(true);
    }
  };

  const deleteHistoricalInventory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("¿Está seguro de que desea eliminar permanentemente esta planilla histórica del sistema?")) return;
    try {
      await deleteDoc(doc(db, 'physical_inventories', id));
      setError(null);
    } catch (err: any) {
      console.error("Error deleting historical inventory document:", err);
      setError("No se pudo eliminar el registro histórico.");
    }
  };

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
      const docsList: any[] = [];
      const loads = snap.docs.map(d => {
        const data = d.data();
        docsList.push({
          id: d.id,
          fileName: data.fileName || 'Inventario',
          uploadedAt: data.uploadedAt || '',
          inventoryDate: data.inventoryDate || '',
          items: data.items || []
        });
        return {
          id: d.id,
          fileName: data.fileName || 'Inventario',
          uploadedAt: data.uploadedAt || '',
          inventoryDate: data.inventoryDate || '',
          itemsCount: Array.isArray(data.items) ? data.items.length : 0
        };
      });
      // Sort newest upload first
      loads.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      setHistoricalLoads(loads);
      setFullHistoricalDocs(docsList);
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
        const idxDesvio = getIndex('desvio', -1);
        const idxPorcentaje = getIndex('porcentaje', -1);

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
          const rawConsumo = parseNum(row[idxSalidaConsumo]);
          const devAlm = Math.abs(parseNum(row[idxDevoluciones]));
          const outOtr = Math.abs(parseNum(row[idxSalidaOtros]));
          const outConsumo = Math.abs(rawConsumo);
          
          const ajustePos = parseNum(row[idxAjustePositivo]);
          const ajusteNeg = Math.abs(parseNum(row[idxAjusteNegativo]));
          const saldoTeorico = parseNum(row[idxTeorico]);
          const saldoFinalDep = parseNum(row[idxFinal]);

          // Stock teórico = Saldo inicial + movimientos (sin ajustes)
          const calcIn = entriesAlm + entriesOtr;
          const calcOut = devAlm + outOtr + outConsumo;
          const expectedTeorico = saldoInicial + calcIn - calcOut;
          
          let desvio = 0;
          let porcentaje = 0;

          if (idxDesvio !== -1) {
             desvio = parseNum(row[idxDesvio]);
          } else {
             desvio = saldoFinalDep - expectedTeorico;
          }

          // Porcentaje = desvio / magnitud del consumo (siempre positiva)
          porcentaje = outConsumo !== 0 ? (desvio / Math.abs(outConsumo)) * 100 : 0;

          parsedRows.push({
            codigo,
            producto,
            tipo,
            saldoInicial,
            entradasAlmacen: entriesAlm,
            entradasOtros: entriesOtr,
            devolucionAlmacen: devAlm,
            salidaOtros: outOtr,
            salidaConsumo: outConsumo, // guardamos en abs (positivo) para la vista o logic
            ajustePositivo: ajustePos,
            ajusteNegativo: ajusteNeg,
            saldoTeoricoSinJust: expectedTeorico, // Sobrescribimos con el calculado
            saldoFinalDeposito: saldoFinalDep,
            desvio,
            porcentaje
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
      // Use the selected inventoryDate to generate the ID prefix so it is correctly categorized by its reporting date
      const invId = `inventory-${inventoryDate}-${Date.now()}`;

      // Maintain a historical upload trace
      await setDoc(doc(db, 'physical_inventories', invId), {
        id: invId,
        fileName: inventoryFileName || 'Inventario Manual',
        inventoryDate: inventoryDate,
        uploadedAt: timestamp,
        items: uploadedInventory
      });

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
          if (data.inventoryDate) {
            setInventoryDate(data.inventoryDate);
          }
          setActiveMainTab('carga');
          setError(null);
        }
      }
    } catch (e: any) {
      setError("No se pudo recuperar el inventario histórico seleccionado.");
    }
  };



  // Helper to check if a date falls in the selected period
  const isWithinPeriod = useCallback((docDateStr: string, period: string) => {
    if (period === 'all') return true;
    const docDate = new Date(docDateStr + 'T00:00:00');
    const cutoff = new Date();
    if (period === 'year') {
      cutoff.setFullYear(cutoff.getFullYear() - 1);
    } else if (period === '6months') {
      cutoff.setMonth(cutoff.getMonth() - 6);
    } else if (period === '3months') {
      cutoff.setMonth(cutoff.getMonth() - 3);
    } else if (period === '1month') {
      cutoff.setMonth(cutoff.getMonth() - 1);
    }
    // Set hours to 0 to compare cleanly
    cutoff.setHours(0, 0, 0, 0);
    return docDate >= cutoff;
  }, []);

  // Compute aggregated analytical data
  const desviosAnalysis = useMemo(() => {
    const matchedDocs = fullHistoricalDocs.filter(docVal => {
      const dateVal = docVal.inventoryDate || docVal.uploadedAt?.substring(0, 10);
      if (!dateVal) return false;
      return isWithinPeriod(dateVal, analysisPeriod);
    });

    const articlesMap: Record<string, {
      codigo: string;
      producto: string;
      tipo: string;
      desvioAcumulado: number;
      desvioAbsolutoAcumulado: number;
      consumoAcumulado: number;
      teoricoAcumulado: number;
      fisicoAcumulado: number;
      conteoReportes: number;
    }> = {};

    const categoriesMap: Record<string, {
      tipo: string;
      desvioAcumulado: number;
      desvioAbsolutoAcumulado: number;
      consumoAcumulado: number;
      teoricoAcumulado: number;
      fisicoAcumulado: number;
      conteoReportes: number;
    }> = {};

    matchedDocs.forEach(itemDoc => {
      if (Array.isArray(itemDoc.items)) {
        itemDoc.items.forEach((item: any) => {
          const code = item.codigo || 'S/C';
          const name = item.producto || 'Desconocido';
          const type = item.tipo || 'Insumo';
          const devVal = item.desvio || 0;
          const consVal = item.salidaConsumo || 0;
          const teoricoVal = item.saldoTeoricoSinJust || 0;
          const fisicoVal = item.saldoFinalDeposito || 0;

          // Article aggregate
          if (!articlesMap[code]) {
            articlesMap[code] = {
              codigo: code,
              producto: name,
              tipo: type,
              desvioAcumulado: 0,
              desvioAbsolutoAcumulado: 0,
              consumoAcumulado: 0,
              teoricoAcumulado: 0,
              fisicoAcumulado: 0,
              conteoReportes: 0
            };
          }
          articlesMap[code].desvioAcumulado += devVal;
          articlesMap[code].desvioAbsolutoAcumulado += Math.abs(devVal);
          articlesMap[code].consumoAcumulado += Math.abs(consVal);
          articlesMap[code].teoricoAcumulado += Math.abs(teoricoVal);
          articlesMap[code].fisicoAcumulado += Math.abs(fisicoVal);
          articlesMap[code].conteoReportes += 1;

          // Category aggregate
          if (!categoriesMap[type]) {
            categoriesMap[type] = {
              tipo: type,
              desvioAcumulado: 0,
              desvioAbsolutoAcumulado: 0,
              consumoAcumulado: 0,
              teoricoAcumulado: 0,
              fisicoAcumulado: 0,
              conteoReportes: 0
            };
          }
          categoriesMap[type].desvioAcumulado += devVal;
          categoriesMap[type].desvioAbsolutoAcumulado += Math.abs(devVal);
          categoriesMap[type].consumoAcumulado += Math.abs(consVal);
          categoriesMap[type].teoricoAcumulado += Math.abs(teoricoVal);
          categoriesMap[type].fisicoAcumulado += Math.abs(fisicoVal);
          categoriesMap[type].conteoReportes += 1;
        });
      }
    });

    const finalArticles = Object.values(articlesMap).map(art => {
      let denom = art.consumoAcumulado;
      if (percentBase === 'teorico') denom = art.teoricoAcumulado;
      else if (percentBase === 'fisico') denom = art.fisicoAcumulado;

      return {
        ...art,
        porcentajeDesvio: denom !== 0 ? (art.desvioAcumulado / denom) * 100 : 0
      };
    });

    const finalCategories = Object.values(categoriesMap).map(cat => {
      let denom = cat.consumoAcumulado;
      if (percentBase === 'teorico') denom = cat.teoricoAcumulado;
      else if (percentBase === 'fisico') denom = cat.fisicoAcumulado;

      return {
        ...cat,
        porcentajeDesvio: denom !== 0 ? (cat.desvioAcumulado / denom) * 100 : 0
      };
    });

    finalCategories.sort((a, b) => {
      let valA = a[sortCatField];
      let valB = b[sortCatField];

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortCatAsc 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        const numA = (valA as number) || 0;
        const numB = (valB as number) || 0;
        return sortCatAsc 
          ? numA - numB 
          : numB - numA;
      }
    });

    return {
      documentsCount: matchedDocs.length,
      articles: finalArticles,
      categories: finalCategories
    };
  }, [fullHistoricalDocs, analysisPeriod, percentBase, isWithinPeriod, sortCatField, sortCatAsc]);

  // Unique list of category names in the analytical dataset
  const availableCategories = useMemo(() => {
    return desviosAnalysis.categories.map(c => c.tipo);
  }, [desviosAnalysis.categories]);

  // Filtered list of analytical articles by user search query and category filter
  const filteredAnalysisArticles = useMemo(() => {
    let list = desviosAnalysis.articles;

    if (desviosViewGrouped === 'grupo') {
      // Build Reverse Map for Consolidated Groups
      const sqlToInsumoMap: Record<string, string> = {};
      Object.entries(insumoMappings || {}).forEach(([insName, idStr]) => {
        if (idStr) sqlToInsumoMap[idStr as string] = insName;
      });

      if (config) {
        (config.preformasConfig || []).forEach(p => { if (p.sqlCode) sqlToInsumoMap[p.sqlCode] = p.name; });
        (config.termoConfig || []).forEach(t => { if (t.sqlCode) sqlToInsumoMap[t.sqlCode] = t.name; });
        (config.stretchConfig || []).forEach(s => { if (s.sqlCode) sqlToInsumoMap[s.sqlCode] = s.name; });
        (config.tapaConfig || []).forEach(tp => { if (tp.sqlCode) sqlToInsumoMap[tp.sqlCode] = tp.name; });
      }

      const combinedGroups = config ? [
        ...(config.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
        ...(config.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
      ] as string[][] : [];

      const groupedMap: Record<string, {
        codigo: string;
        producto: string;
        tipo: string;
        desvioAcumulado: number;
        desvioAbsolutoAcumulado: number;
        consumoAcumulado: number;
        teoricoAcumulado: number;
        fisicoAcumulado: number;
        conteoReportes: number;
        porcentajeDesvio: number;
      }> = {};

      list.forEach(art => {
        const insName = sqlToInsumoMap[art.codigo];
        let groupKey: string | null = null;
        if (insName) {
          const group = combinedGroups.find(g => g.includes(insName));
          if (group) {
            groupKey = `Grupo Consolidado: ${group.join(' / ')}`;
          }
        }

        const targetKey = groupKey || art.producto;
        const targetCode = groupKey ? 'G-' + art.codigo : art.codigo;

        if (!groupedMap[targetKey]) {
          groupedMap[targetKey] = {
            codigo: targetCode,
            producto: targetKey,
            tipo: art.tipo || 'Insumo',
            desvioAcumulado: 0,
            desvioAbsolutoAcumulado: 0,
            consumoAcumulado: 0,
            teoricoAcumulado: 0,
            fisicoAcumulado: 0,
            conteoReportes: 0,
            porcentajeDesvio: 0
          };
        }

        groupedMap[targetKey].desvioAcumulado += art.desvioAcumulado;
        groupedMap[targetKey].desvioAbsolutoAcumulado += art.desvioAbsolutoAcumulado;
        groupedMap[targetKey].consumoAcumulado += art.consumoAcumulado;
        groupedMap[targetKey].teoricoAcumulado += art.teoricoAcumulado;
        groupedMap[targetKey].fisicoAcumulado += art.fisicoAcumulado;
        groupedMap[targetKey].conteoReportes = Math.max(groupedMap[targetKey].conteoReportes, art.conteoReportes);
      });

      list = Object.values(groupedMap).map(g => {
        let denom = g.consumoAcumulado;
        if (percentBase === 'teorico') denom = g.teoricoAcumulado;
        else if (percentBase === 'fisico') denom = g.fisicoAcumulado;
        return {
          ...g,
          porcentajeDesvio: denom !== 0 ? (g.desvioAcumulado / denom) * 100 : 0
        };
      });
    }

    if (analysisCategoryFilter !== 'all') {
      list = list.filter(item => item.tipo === analysisCategoryFilter);
    }
    if (analysisSearch.trim() !== '') {
      const q = analysisSearch.toLowerCase();
      list = list.filter(item => 
        item.codigo.toLowerCase().includes(q) ||
        item.producto.toLowerCase().includes(q)
      );
    }
    // Sort articles
    return [...list].sort((a, b) => {
      let valA = a[sortArtField];
      let valB = b[sortArtField];

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortArtAsc 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        const numA = (valA as number) || 0;
        const numB = (valB as number) || 0;
        return sortArtAsc 
          ? numA - numB 
          : numB - numA;
      }
    });
  }, [desviosAnalysis.articles, analysisSearch, analysisCategoryFilter, desviosViewGrouped, config, insumoMappings, percentBase, sortArtField, sortArtAsc]);

  // Compute monthly evolution data for articles and categories for any month on record
  const monthlyEvolutionAnalysis = useMemo(() => {
    const monthKeysSet = new Set<string>();
    fullHistoricalDocs.forEach(docVal => {
      const dateVal = docVal.inventoryDate || docVal.uploadedAt?.substring(0, 10);
      if (dateVal && dateVal.length >= 7) {
        monthKeysSet.add(dateVal.substring(0, 7)); // YYYY-MM
      }
    });

    const sortedMonths = Array.from(monthKeysSet).sort((a, b) => b.localeCompare(a)); // Newest first

    const formatMonthAbbr = (ym: string) => {
      const [year, month] = ym.split('-');
      const monthsSpan = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const monthIdx = parseInt(month, 10) - 1;
      return `${monthsSpan[monthIdx] || month} ${year}`;
    };

    const monthlyArticlesMap: Record<string, {
      codigo: string;
      producto: string;
      tipo: string;
      months: Record<string, { desvio: number; consumo: number; teorico: number; fisico: number }>;
    }> = {};

    const monthlyCategoriesMap: Record<string, {
      tipo: string;
      months: Record<string, { desvio: number; consumo: number; teorico: number; fisico: number }>;
    }> = {};

    fullHistoricalDocs.forEach(itemDoc => {
      const dateVal = itemDoc.inventoryDate || itemDoc.uploadedAt?.substring(0, 10);
      if (!dateVal || dateVal.length < 7) return;
      const monthKey = dateVal.substring(0, 7);

      if (Array.isArray(itemDoc.items)) {
        itemDoc.items.forEach((item: any) => {
          const code = item.codigo || 'S/C';
          const name = item.producto || 'Desconocido';
          const type = item.tipo || 'Insumo';
          const devVal = item.desvio || 0;
          const consVal = item.salidaConsumo || 0;
          const teoricoVal = item.saldoTeoricoSinJust || 0;
          const fisicoVal = item.saldoFinalDeposito || 0;

          // Article Monthly setup
          if (!monthlyArticlesMap[code]) {
            monthlyArticlesMap[code] = {
              codigo: code,
              producto: name,
              tipo: type,
              months: {}
            };
          }
          if (!monthlyArticlesMap[code].months[monthKey]) {
            monthlyArticlesMap[code].months[monthKey] = { desvio: 0, consumo: 0, teorico: 0, fisico: 0 };
          }
          const artMonth = monthlyArticlesMap[code].months[monthKey];
          artMonth.desvio += devVal;
          artMonth.consumo += Math.abs(consVal);
          artMonth.teorico += Math.abs(teoricoVal);
          artMonth.fisico += Math.abs(fisicoVal);

          // Category Monthly setup
          if (!monthlyCategoriesMap[type]) {
            monthlyCategoriesMap[type] = {
              tipo: type,
              months: {}
            };
          }
          if (!monthlyCategoriesMap[type].months[monthKey]) {
            monthlyCategoriesMap[type].months[monthKey] = { desvio: 0, consumo: 0, teorico: 0, fisico: 0 };
          }
          const catMonth = monthlyCategoriesMap[type].months[monthKey];
          catMonth.desvio += devVal;
          catMonth.consumo += Math.abs(consVal);
          catMonth.teorico += Math.abs(teoricoVal);
          catMonth.fisico += Math.abs(fisicoVal);
        });
      }
    });

    // Build Reverse Map for Consolidated Groups
    const sqlToInsumoMap: Record<string, string> = {};
    Object.entries(insumoMappings || {}).forEach(([insName, idStr]) => {
      if (idStr) sqlToInsumoMap[idStr as string] = insName;
    });

    if (config) {
      (config.preformasConfig || []).forEach(p => { if (p.sqlCode) sqlToInsumoMap[p.sqlCode] = p.name; });
      (config.termoConfig || []).forEach(t => { if (t.sqlCode) sqlToInsumoMap[t.sqlCode] = t.name; });
      (config.stretchConfig || []).forEach(s => { if (s.sqlCode) sqlToInsumoMap[s.sqlCode] = s.name; });
      (config.tapaConfig || []).forEach(tp => { if (tp.sqlCode) sqlToInsumoMap[tp.sqlCode] = tp.name; });
    }

    const combinedGroups = config ? [
      ...(config.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
      ...(config.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
    ] as string[][] : [];

    // Group articles by consolidated groups
    const monthlyGroupsMap: Record<string, {
      codigo: string;
      producto: string;
      tipo: string;
      months: Record<string, { desvio: number; consumo: number; teorico: number; fisico: number }>;
    }> = {};

    Object.values(monthlyArticlesMap).forEach(art => {
      const insName = sqlToInsumoMap[art.codigo];
      let groupKey: string | null = null;
      if (insName) {
        const group = combinedGroups.find(g => g.includes(insName));
        if (group) {
          groupKey = `Grupo Consolidado: ${group.join(' / ')}`;
        }
      }

      const targetKey = groupKey || art.producto;
      const targetCode = groupKey ? 'G-' + art.codigo : art.codigo;

      if (!monthlyGroupsMap[targetKey]) {
        monthlyGroupsMap[targetKey] = {
          codigo: targetCode,
          producto: targetKey,
          tipo: art.tipo || 'Insumo',
          months: {}
        };
      }

      Object.entries(art.months).forEach(([monthKey, mData]) => {
        if (!monthlyGroupsMap[targetKey].months[monthKey]) {
          monthlyGroupsMap[targetKey].months[monthKey] = { desvio: 0, consumo: 0, teorico: 0, fisico: 0 };
        }
        const groupMonth = monthlyGroupsMap[targetKey].months[monthKey];
        groupMonth.desvio += mData.desvio;
        groupMonth.consumo += mData.consumo;
        groupMonth.teorico += mData.teorico;
        groupMonth.fisico += mData.fisico;
      });
    });

    const getPorcentaje = (mData: { desvio: number; consumo: number; teorico: number; fisico: number }) => {
      let denom = mData.consumo;
      if (percentBase === 'teorico') denom = mData.teorico;
      else if (percentBase === 'fisico') denom = mData.fisico;
      return denom !== 0 ? (mData.desvio / denom) * 100 : 0;
    };

    const articlesList = Object.values(monthlyArticlesMap).map(art => {
      const monthsData: Record<string, { desvio: number; consumo: number; teorico: number; fisico: number; porcentaje: number }> = {};
      sortedMonths.forEach(mKey => {
        const mData = art.months[mKey];
        if (mData) {
          monthsData[mKey] = {
            ...mData,
            porcentaje: getPorcentaje(mData)
          };
        }
      });
      return {
        ...art,
        monthsList: monthsData
      };
    });

    const categoriesList = Object.values(monthlyCategoriesMap).map(cat => {
      const monthsData: Record<string, { desvio: number; consumo: number; teorico: number; fisico: number; porcentaje: number }> = {};
      sortedMonths.forEach(mKey => {
        const mData = cat.months[mKey];
        if (mData) {
          monthsData[mKey] = {
            ...mData,
            porcentaje: getPorcentaje(mData)
          };
        }
      });
      return {
        ...cat,
        monthsList: monthsData
      };
    });

    const groupsList = Object.values(monthlyGroupsMap).map(grp => {
      const monthsData: Record<string, { desvio: number; consumo: number; teorico: number; fisico: number; porcentaje: number }> = {};
      sortedMonths.forEach(mKey => {
        const mData = grp.months[mKey];
        if (mData) {
          monthsData[mKey] = {
            ...mData,
            porcentaje: getPorcentaje(mData)
          };
        }
      });
      return {
        ...grp,
        monthsList: monthsData
      };
    });

    return {
      sortedMonths,
      formattedMonths: sortedMonths.map(m => ({ key: m, label: formatMonthAbbr(m) })),
      articles: articlesList,
      categories: categoriesList,
      groups: groupsList
    };
  }, [fullHistoricalDocs, insumoMappings, config, percentBase]);

  // Filtered list of monthly evolution articles
  const filteredMonthlyArticles = useMemo(() => {
    let list = monthlyEvolutionAnalysis.articles;
    if (analysisCategoryFilter !== 'all') {
      list = list.filter(item => item.tipo === analysisCategoryFilter);
    }
    if (mensualSearch.trim() !== '') {
      const q = mensualSearch.toLowerCase();
      list = list.filter(item => 
        item.codigo.toLowerCase().includes(q) ||
        item.producto.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let result = 0;
      if (sortMonthlyField === 'elemento') {
        result = a.producto.localeCompare(b.producto);
      } else if (sortMonthlyField === 'categoria') {
        result = a.tipo.localeCompare(b.tipo);
      } else {
        const valA = a.monthsList[sortMonthlyField]?.porcentaje;
        const valB = b.monthsList[sortMonthlyField]?.porcentaje;
        if (valA === undefined && valB === undefined) result = 0;
        else if (valA === undefined) result = 1;
        else if (valB === undefined) result = -1;
        else result = valA - valB;
      }
      return sortMonthlyAsc ? result : -result;
    });
  }, [monthlyEvolutionAnalysis.articles, mensualSearch, analysisCategoryFilter, sortMonthlyField, sortMonthlyAsc]);

  // Filtered list of monthly evolution categories
  const filteredMonthlyCategories = useMemo(() => {
    let list = monthlyEvolutionAnalysis.categories;
    if (mensualSearch.trim() !== '') {
      const q = mensualSearch.toLowerCase();
      list = list.filter(item => 
        item.tipo.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let result = 0;
      if (sortMonthlyField === 'elemento' || sortMonthlyField === 'categoria') {
        result = a.tipo.localeCompare(b.tipo);
      } else {
        const valA = a.monthsList[sortMonthlyField]?.porcentaje;
        const valB = b.monthsList[sortMonthlyField]?.porcentaje;
        if (valA === undefined && valB === undefined) result = 0;
        else if (valA === undefined) result = 1;
        else if (valB === undefined) result = -1;
        else result = valA - valB;
      }
      return sortMonthlyAsc ? result : -result;
    });
  }, [monthlyEvolutionAnalysis.categories, mensualSearch, sortMonthlyField, sortMonthlyAsc]);

  // Filtered list of monthly evolution groups
  const filteredMonthlyGroups = useMemo(() => {
    let list = monthlyEvolutionAnalysis.groups;
    if (analysisCategoryFilter !== 'all') {
      list = list.filter(item => item.tipo === analysisCategoryFilter);
    }
    if (mensualSearch.trim() !== '') {
      const q = mensualSearch.toLowerCase();
      list = list.filter(item => 
        item.codigo.toLowerCase().includes(q) ||
        item.producto.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let result = 0;
      if (sortMonthlyField === 'elemento') {
        result = a.producto.localeCompare(b.producto);
      } else if (sortMonthlyField === 'categoria') {
        result = a.tipo.localeCompare(b.tipo);
      } else {
        const valA = a.monthsList[sortMonthlyField]?.porcentaje;
        const valB = b.monthsList[sortMonthlyField]?.porcentaje;
        if (valA === undefined && valB === undefined) result = 0;
        else if (valA === undefined) result = 1;
        else if (valB === undefined) result = -1;
        else result = valA - valB;
      }
      return sortMonthlyAsc ? result : -result;
    });
  }, [monthlyEvolutionAnalysis.groups, mensualSearch, analysisCategoryFilter, sortMonthlyField, sortMonthlyAsc]);

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

    if (config) {
      const combinedGroups = [
        ...(config.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
        ...(config.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
      ] as string[][];

      const sqlToInsumoMap: Record<string, string> = {};
      systemEquivalences.forEach(eq => {
         if (eq.matched && eq.code !== 'S/C') {
            sqlToInsumoMap[eq.code] = eq.insumoName;
         }
      });

      const groupedConfigList: PhysicalInventoryRow[] = [];
      const usedIds = new Set<string>();

      list.forEach(row => {
         if (usedIds.has(row.codigo)) return;
         
         const insumoName = sqlToInsumoMap[row.codigo];
         if (insumoName) {
            const group = combinedGroups.find(g => g.includes(insumoName));
            if (group) {
                const groupRows = list.filter(r => {
                   const rName = sqlToInsumoMap[r.codigo];
                   return rName && group.includes(rName);
                });

                if (groupRows.length > 1) {
                   const merged: PhysicalInventoryRow = {
                       codigo: 'G-' + groupRows[0].codigo,
                       producto: `Grupo Consolidado: ${group.join(' / ')}`,
                       tipo: groupRows[0].tipo,
                       saldoInicial: 0,
                       entradasAlmacen: 0,
                       entradasOtros: 0,
                       devolucionAlmacen: 0,
                       salidaOtros: 0,
                       salidaConsumo: 0,
                       ajustePositivo: 0,
                       ajusteNegativo: 0,
                       saldoTeoricoSinJust: 0,
                       saldoFinalDeposito: 0,
                       desvio: 0,
                       porcentaje: 0
                   };
                   groupRows.forEach(gr => {
                      merged.saldoInicial += gr.saldoInicial;
                      merged.entradasAlmacen += gr.entradasAlmacen;
                      merged.entradasOtros += gr.entradasOtros;
                      merged.devolucionAlmacen += gr.devolucionAlmacen;
                      merged.salidaOtros += gr.salidaOtros;
                      merged.salidaConsumo += gr.salidaConsumo;
                      merged.ajustePositivo += gr.ajustePositivo;
                      merged.ajusteNegativo += gr.ajusteNegativo;
                      merged.saldoTeoricoSinJust = (merged.saldoTeoricoSinJust || 0) + (gr.saldoTeoricoSinJust || 0);
                      merged.saldoFinalDeposito += gr.saldoFinalDeposito;
                      merged.desvio += gr.desvio;
                   });
                   
                   // desvio is summed directly inside the loop above
                   merged.porcentaje = merged.salidaConsumo !== 0 ? (merged.desvio / Math.abs(merged.salidaConsumo)) * 100 : 0;
                   
                   groupedConfigList.push(merged);
                   groupRows.forEach(gr => usedIds.add(gr.codigo));
                   return;
                }
            }
         }
         
         groupedConfigList.push(row);
         usedIds.add(row.codigo);
      });
      list = groupedConfigList;
    }

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
  }, [uploadedInventory, searchTerm, typeFilter, sortField, sortAsc, config, systemEquivalences]);

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
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <FileSpreadsheet className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900 tracking-tight">Conciliación de Inventario Físico</h1>
              <p className="text-xs text-gray-400 mt-0.5">Suba sus planillas Excel de existencias para analizar desvíos históricos, auditar consumos y proyectar desvíos con exactitud</p>
            </div>
          </div>
        </div>

        {/* Universal Web Font Style Configuration */}
        <div className="flex items-center gap-2 self-start md:self-auto bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-1.5 shrink-0 shadow-xs">
          <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Tipografía / Letra:</span>
          <select
            value={prefFont}
            onChange={(e) => setPrefFont(e.target.value as any)}
            className="bg-white border border-slate-200 rounded-lg text-xs font-extrabold text-gray-700 py-1 px-2.5 h-7 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="sans">Interfaz Limpia (Inter Web)</option>
            <option value="display">Moderna (Outfit Display)</option>
            <option value="mono">Técnica (JetBrains Mono)</option>
          </select>
        </div>
      </div>

      {/* Main Dual Tab Controller */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveMainTab('historial')}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-black uppercase tracking-wider border-b-2 transition-all duration-200 select-none ${
            activeMainTab === 'historial'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/20 font-black'
              : 'border-transparent text-gray-400 hover:text-gray-650 hover:bg-slate-50 font-bold'
          }`}
        >
          <History className="w-4 h-4 text-indigo-505" />
          Historial y Auditoría de Desvíos
        </button>
        <button
          onClick={() => setActiveMainTab('carga')}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-black uppercase tracking-wider border-b-2 transition-all duration-200 select-none ${
            activeMainTab === 'carga'
              ? 'border-indigo-605 text-indigo-600 bg-indigo-50/20 font-black'
              : 'border-transparent text-gray-405 text-gray-400 hover:text-gray-650 hover:bg-slate-50 font-bold'
          }`}
        >
          <Upload className="w-4 h-4 text-emerald-505" />
          Importar / Planilla Activa {uploadedInventory.length > 0 && `(${uploadedInventory.length})`}
        </button>
      </div>

      {/* Upload Info Alerts */}
      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="text-xs font-bold">
            ¡Planilla de inventario consolidada en base de datos correctamente! Desvíos agregados con éxito al Historial de Auditoría.
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
          <XCircle className="w-5 h-5 text-red-650 shrink-0" />
          <div className="text-xs font-bold">{error}</div>
        </div>
      )}
      {activeMainTab === 'historial' && (
        <div className="space-y-6" id="historical-panel-container">
          
          {/* Historical Saved Planillas Horizontal Scroll Deck */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-black text-indigo-900 uppercase tracking-widest flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              Lotes de Planillas Guardadas ({historicalLoads.length})
            </h3>
            <p className="text-[11px] text-gray-400">Haga clic en cualquier tarjeta de planilla guardada para visualizarla en la pestaña de simulación/auditoría línea por línea</p>
            
            {historicalLoads.length === 0 ? (
              <div className="bg-slate-50 text-gray-400 text-xs py-6 text-center rounded-xl border border-dashed border-slate-200">
                Aún no hay planillas importadas en el sistema. Vaya a la pestaña "Importar / Planilla Activa" para subir su archivo Excel.
              </div>
            ) : (
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {historicalLoads.map((load) => (
                  <div 
                    key={load.id}
                    onClick={() => loadHistoricalInventory(load.id)}
                    className="bg-slate-50 hover:bg-indigo-50/20 border border-slate-200 hover:border-indigo-200 rounded-xl p-3 shadow-xs space-y-2 cursor-pointer transition-all duration-200 min-w-[240px] max-w-[250px] flex-shrink-0 group relative"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 truncate">
                        <span className="font-mono text-[9px] font-black text-indigo-600 block truncate">{load.inventoryDate}</span>
                        <h5 className="text-xs font-extrabold text-gray-800 truncate group-hover:text-indigo-900" title={load.fileName}>{load.fileName}</h5>
                      </div>
                      
                      <button
                        onClick={(e) => deleteHistoricalInventory(load.id, e)}
                        className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-md transition-colors"
                        title="Eliminar este lote de inventario"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold bg-white group-hover:bg-indigo-50/40 p-1.5 rounded-lg border border-slate-100 font-sans">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-slate-400" /> {load.uploadedAt.substring(11, 16)}hs</span>
                      <span className="text-indigo-600">{load.itemsCount} artículos</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-indigo-50 p-6 shadow-sm space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-black text-indigo-900 uppercase tracking-widest flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-600" />
                Historial y Análisis Acumulado d​e Desvíos
              </h3>
            </div>

          {/* Tab Selection & Universal Web Font Style Configuration */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setHistoryTab('desvios')}
                className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                  historyTab === 'desvios'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                Análisis de Desvíos Acumulados
              </button>
              <button
                onClick={() => setHistoryTab('mensual')}
                className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                  historyTab === 'mensual'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                Evolución Mensual %
              </button>
            </div>

            {/* Typography Configuration for enhanced readability */}
            <div className="flex items-center gap-2 self-start md:self-auto bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-1.5 shrink-0 shadow-xs">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Tipografía / Letra:</span>
              <select
                value={prefFont}
                onChange={(e) => setPrefFont(e.target.value as any)}
                className="bg-white border border-slate-200 rounded-lg text-xs font-extrabold text-gray-700 py-1 px-2.5 h-7 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="sans">Interfaz Limpia (Inter Web)</option>
                <option value="display">Moderna (Outfit Display)</option>
                <option value="mono">Técnica (JetBrains Mono)</option>
              </select>
            </div>
          </div>

          {/* Tab contents */}
          {historyTab === 'desvios' && (
            /* ANALYTICS TAB */
            <div className="space-y-6 animate-fadeIn">
              {/* Controls and quick metrics */}
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                {/* Left controls column */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-wrap">
                  {/* Period Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Periodo de Análisis</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { id: '1month', label: 'Último Mes' },
                        { id: '3months', label: 'Últimos 3 Meses' },
                        { id: '6months', label: 'Últimos 6 Meses' },
                        { id: 'year', label: 'Último Año' },
                        { id: 'all', label: 'Histórico Completo' }
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setAnalysisPeriod(p.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            analysisPeriod === p.id
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white hover:bg-slate-100 border border-slate-200 text-gray-600'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Group Mode Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Visualización</label>
                    <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setDesviosViewGrouped('articulo')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                          desviosViewGrouped === 'articulo'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Artículos
                      </button>
                      <button
                        type="button"
                        onClick={() => setDesviosViewGrouped('grupo')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                          desviosViewGrouped === 'grupo'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Grupo Consolidado
                      </button>
                    </div>
                  </div>

                  {/* Percent Base Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Base de Cálculo Desvío % (Origen)</label>
                    <select
                      value={percentBase}
                      onChange={(e) => setPercentBase(e.target.value as any)}
                      className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-gray-700 py-1.5 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 h-8"
                    >
                      <option value="consumo">Consumo Neto (Salidas)</option>
                      <option value="teorico">Stock Teórico (Saldos)</option>
                      <option value="fisico">Saldo Físico (Inventario)</option>
                    </select>
                  </div>
                </div>

                {/* Quick Statistics */}
                <div className="flex gap-4 shrink-0 sm:self-end">
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm min-w-[125px]">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Inventarios</span>
                    <span className="text-lg font-black text-indigo-700">{desviosAnalysis.documentsCount}</span>
                    <span className="text-[9px] text-gray-400 block mt-0.5">procesados</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm min-w-[140px]">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Artículos Controlados</span>
                    <span className="text-lg font-black text-indigo-700">{desviosAnalysis.articles.length}</span>
                    <span className="text-[9px] text-gray-400 block mt-0.5">bajo auditoría</span>
                  </div>
                </div>
              </div>

              {/* Stacking layout vertically to avoid horizontal space constraints for Articles and Categories */}
              <div className="space-y-6">
                
                {/* Categories Aggregated Table */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-xs font-black uppercase text-gray-800 tracking-wider">Desvío acumulado por Categoría</h4>
                  </div>

                  {desviosAnalysis.categories.length === 0 ? (
                    <p className="text-gray-400 text-xs py-4 text-center">Sin desvíos registrados en este periodo.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className={`w-full text-left border-collapse ${
                        prefFont === 'sans' ? 'font-sans' : prefFont === 'display' ? 'font-display tracking-[0.015em]' : 'font-mono'
                      }`}>
                        <thead>
                          <tr className="border-b border-gray-100 text-[11px] font-black uppercase text-slate-400 select-none">
                            <th className="py-2.5 cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortCat('tipo')}>
                              <div className="flex items-center gap-1.5">
                                Categoría
                                {sortCatField === 'tipo' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortCat('conteoReportes')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Controles
                                {sortCatField === 'conteoReportes' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortCat('desvioAcumulado')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Desvío Neto
                                {sortCatField === 'desvioAcumulado' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortCat('porcentajeDesvio')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Desvío %
                                {sortCatField === 'porcentajeDesvio' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-xs font-semibold text-gray-700 tabular-nums">
                          {desviosAnalysis.categories.map((cat) => (
                            <tr key={cat.tipo} className="hover:bg-slate-50/50">
                              <td className="py-2.5">
                                <span className="font-extrabold text-gray-900">{cat.tipo}</span>
                              </td>
                              <td className="py-2.5 text-right text-gray-500 font-medium">{cat.conteoReportes}</td>
                              <td className="py-2.5 text-right font-black">
                                <span className={
                                  cat.desmioAcumulado < 0 || cat.desvioAcumulado < 0
                                    ? 'text-red-650 text-red-600' 
                                    : cat.desvioAcumulado > 0 
                                      ? 'text-emerald-600 font-extrabold' 
                                      : 'text-gray-500'
                                }>
                                  {cat.desvioAcumulado > 0 ? `+${cat.desvioAcumulado.toLocaleString('es-AR')}` : cat.desvioAcumulado.toLocaleString('es-AR')}
                                </span>
                              </td>
                              <td className="py-2.5 text-right font-black">
                                <span className={
                                  cat.porcentajeDesvio < 0 
                                    ? 'text-red-600 font-bold' 
                                    : cat.porcentajeDesvio > 0 
                                      ? 'text-emerald-605 text-emerald-600 font-bold' 
                                      : 'text-gray-500'
                                }>
                                  {cat.porcentajeDesvio > 0 ? `+${cat.porcentajeDesvio.toFixed(1)}%` : `${cat.porcentajeDesvio.toFixed(1)}%`}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Articles Aggregated Table */}
                <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
                  {/* Title and filters */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      <h4 className="text-xs font-black uppercase text-gray-800 tracking-wider">Desvíos por Artículo (Ordenable)</h4>
                    </div>
                    
                    {/* Select Dropdown & Search Inside Analysis */}
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={analysisCategoryFilter}
                        onChange={(e) => setAnalysisCategoryFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-gray-700 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 h-8"
                      >
                        <option value="all">Todas las Categorías</option>
                        {availableCategories.map(catType => (
                          <option key={catType} value={catType}>{catType}</option>
                        ))}
                      </select>

                      <div className="relative max-w-xs shadow-xs">
                        <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Buscar por código o producto..."
                          value={analysisSearch}
                          onChange={(e) => setAnalysisSearch(e.target.value)}
                          className="pl-8 pr-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs placeholder:text-gray-400 text-gray-700 font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 h-8 text-[11px]"
                        />
                      </div>
                    </div>
                  </div>

                  {filteredAnalysisArticles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-center">
                      <Search className="w-8 h-8 text-gray-300 mb-2" />
                      <p className="text-gray-400 text-xs">No se encontraron artículos con desvíos en este rango.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto w-full">
                      <table className={`w-full text-left border-collapse table-auto min-w-[500px] ${
                        prefFont === 'sans' ? 'font-sans' : prefFont === 'display' ? 'font-display tracking-[0.015em]' : 'font-mono'
                      }`}>
                        <thead>
                          <tr className="sticky top-0 bg-white border-b border-gray-100 text-[11px] font-black uppercase text-slate-400 z-10 select-none">
                            <th className="py-2.5 cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortArt('producto')}>
                              <div className="flex items-center gap-1.5">
                                Artículo
                                {sortArtField === 'producto' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortArt('tipo')}>
                              <div className="flex items-center gap-1.5">
                                Categoría
                                {sortArtField === 'tipo' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortArt('conteoReportes')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Controles
                                {sortArtField === 'conteoReportes' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortArt('desvioAcumulado')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Desvío Acumulado
                                {sortArtField === 'desvioAcumulado' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortArt('porcentajeDesvio')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Desvío %
                                {sortArtField === 'porcentajeDesvio' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                            <th className="py-2.5 text-right cursor-pointer hover:text-slate-700 transition-colors" onClick={() => handleSortArt('desvioAbsolutoAcumulado')}>
                              <div className="flex items-center justify-end gap-1.5">
                                Magnitud Absoluta
                                {sortArtField === 'desvioAbsolutoAcumulado' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-xs font-semibold text-gray-700 tabular-nums">
                          {filteredAnalysisArticles.map((art) => (
                            <tr key={art.codigo} className="hover:bg-slate-50">
                              <td className="py-2.5">
                                <div className="font-extrabold text-gray-905 text-gray-900 line-clamp-1 truncate max-w-[280px]" title={art.producto}>{art.producto}</div>
                                <span className="font-mono text-[9px] text-gray-405 text-gray-400 font-bold block">{art.codigo}</span>
                              </td>
                              <td className="py-2.5">
                                <span className="px-2 py-0.5 text-[9px] font-black uppercase text-slate-700 bg-slate-100 rounded-md">
                                  {art.tipo}
                                </span>
                              </td>
                              <td className="py-2.5 text-right text-gray-500 font-medium">
                                {art.conteoReportes}
                              </td>
                              <td className="py-2.5 text-right font-black">
                                <span className={
                                  art.desvioAcumulado < 0 
                                    ? 'text-red-650 text-red-600 font-bold' 
                                    : art.desvioAcumulado > 0 
                                      ? 'text-emerald-600 font-extrabold' 
                                      : 'text-gray-500'
                                }>
                                  {art.desvioAcumulado > 0 ? `+${art.desvioAcumulado.toLocaleString('es-AR')}` : art.desvioAcumulado.toLocaleString('es-AR')}
                                </span>
                              </td>
                              <td className="py-2.5 text-right font-black">
                                <span className={
                                  art.porcentajeDesvio < 0 
                                    ? 'text-red-600 font-bold' 
                                    : art.porcentajeDesvio > 0 
                                      ? 'text-emerald-605 text-emerald-600 font-bold' 
                                      : 'text-gray-500'
                                }>
                                  {art.porcentajeDesvio > 0 ? `+${art.porcentajeDesvio.toFixed(1)}%` : `${art.porcentajeDesvio.toFixed(1)}%`}
                                </span>
                              </td>
                              <td className="py-2.5 text-right font-black text-slate-800">
                                {art.desvioAbsolutoAcumulado.toLocaleString('es-AR')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

          {historyTab === 'mensual' && (
            <div className="space-y-6 animate-fadeIn">
              {/* Controls */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex flex-wrap items-center gap-4">
                  {/* View mode toggle */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Visualizar por</span>
                    <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setMensualFilterType('articulo')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                          mensualFilterType === 'articulo'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Artículos
                      </button>
                      <button
                        type="button"
                        onClick={() => setMensualFilterType('categoria')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                          mensualFilterType === 'categoria'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Categorías
                      </button>
                      <button
                        type="button"
                        onClick={() => setMensualFilterType('grupo')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                          mensualFilterType === 'grupo'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Grupos Consolidados
                      </button>
                    </div>
                  </div>

                  {/* Base de Cálculo Selector */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Fuente de Datos (Desvío %)</span>
                    <select
                      value={percentBase}
                      onChange={(e) => setPercentBase(e.target.value as any)}
                      className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-gray-700 py-1 px-2.5 h-8 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="consumo">Consumo Neto (Salidas)</option>
                      <option value="teorico">Stock Teórico (Saldos)</option>
                      <option value="fisico">Saldo Físico (Inventario)</option>
                    </select>
                  </div>

                  {/* Category Filter for Articles & Groups */}
                  {(mensualFilterType === 'articulo' || mensualFilterType === 'grupo') && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Filtrar Categoría</span>
                      <select
                        value={analysisCategoryFilter}
                        onChange={(e) => setAnalysisCategoryFilter(e.target.value)}
                        className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-gray-700 py-1 px-2.5 h-8 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="all">Todas las Categorías</option>
                        {availableCategories.map(catType => (
                          <option key={catType} value={catType}>{catType}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Monthly Search */}
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Búsqueda</span>
                  <div className="relative max-w-xs shadow-xs">
                    <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={mensualSearch}
                      onChange={(e) => setMensualSearch(e.target.value)}
                      className="pl-8 pr-3 py-1 w-full bg-white border border-slate-200 rounded-lg text-xs placeholder:text-gray-400 text-gray-700 font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 h-8"
                    />
                  </div>
                </div>
              </div>

              {/* Monthly percentage Table */}
              <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-xs font-black uppercase text-gray-800 tracking-wider">
                      Desvíos Porcentuales Históricos Mes a Mes
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 hidden sm:inline">
                    *Porcentaje calculado sobre {percentBase === 'consumo' ? 'consumo' : percentBase === 'teorico' ? 'stock teórico' : 'saldo físico'}. Pase el cursor para ver detalles de volumen.
                  </span>
                </div>

                {monthlyEvolutionAnalysis.sortedMonths.length === 0 ? (
                  <p className="text-gray-400 text-xs py-12 text-center">No se encontraron datos históricos de inventario para desplegar la evolución mensual.</p>
                ) : (
                  <div className="overflow-x-auto w-full">
                    <table className={`w-full text-left border-collapse table-fixed min-w-[750px] ${
                      prefFont === 'sans' ? 'font-sans' : prefFont === 'display' ? 'font-display tracking-[0.015em]' : 'font-mono'
                    }`}>
                      <thead>
                        <tr className="border-b border-gray-100 text-xs md:text-sm font-black uppercase text-indigo-950 select-none">
                          <th className="py-3 w-[220px] px-3 bg-slate-50/50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSortMonthly('elemento')}>
                            <div className="flex items-center gap-1.5">
                              Elemento
                              {sortMonthlyField === 'elemento' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                            </div>
                          </th>
                          {(mensualFilterType === 'articulo' || mensualFilterType === 'grupo') && (
                            <th className="py-3 w-[110px] px-2 bg-slate-50/50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSortMonthly('categoria')}>
                              <div className="flex items-center gap-1.5">
                                Categoría
                                {sortMonthlyField === 'categoria' && <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                          )}
                          {monthlyEvolutionAnalysis.formattedMonths.map(m => (
                            <th 
                              key={m.key} 
                              onClick={() => handleSortMonthly(m.key)}
                              className="py-3 text-center text-xs font-black text-indigo-950 bg-indigo-50/55 hover:bg-indigo-100/60 px-2 truncate min-w-[75px] cursor-pointer transition-colors"
                            >
                              <div className="flex items-center justify-center gap-1">
                                {m.label}
                                {sortMonthlyField === m.key && <ArrowUpDown className="w-3 h-3 text-indigo-600 shrink-0" />}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs md:text-sm font-bold text-gray-700 tabular-nums">
                        {mensualFilterType === 'articulo' ? (
                          filteredMonthlyArticles.length === 0 ? (
                            <tr>
                              <td colSpan={monthlyEvolutionAnalysis.sortedMonths.length + 2} className="py-8 text-center text-gray-400 text-sm">
                                No se encontraron artículos coincidentes.
                              </td>
                            </tr>
                          ) : (
                            filteredMonthlyArticles.map(art => (
                              <tr key={art.codigo} className="hover:bg-slate-50/50">
                                <td className="py-3.5 px-2 pr-2 truncate" title={art.producto}>
                                  <div className="font-extrabold text-xs md:text-sm text-gray-900 truncate max-w-[200px]" title={art.producto}>{art.producto}</div>
                                  <span className="font-mono text-[10px] md:text-xs text-slate-500 block font-semibold">{art.codigo}</span>
                                </td>
                                <td className="py-3.5 px-2">
                                  <span className="px-2 py-1 text-[10px] md:text-xs font-black uppercase text-slate-705 text-slate-700 bg-slate-100 rounded-md">
                                    {art.tipo}
                                  </span>
                                </td>
                                {monthlyEvolutionAnalysis.sortedMonths.map(monthKey => {
                                  const mData = art.monthsList[monthKey];
                                  if (!mData) {
                                    return (
                                      <td key={monthKey} className="py-3.5 text-center text-gray-300 font-normal text-xs md:text-sm">
                                        -
                                      </td>
                                    );
                                  }
                                  const labelStr = mData.porcentaje > 0 ? `+${mData.porcentaje.toFixed(1)}%` : `${mData.porcentaje.toFixed(1)}%`;
                                  return (
                                    <td key={monthKey} className="py-3.5 px-1.5 text-center font-mono">
                                      <span 
                                        className={`inline-block w-full py-1.5 px-2 rounded-md text-xs md:text-[13px] font-black tracking-wide ${
                                          mData.porcentaje < 0 
                                            ? 'text-red-800 bg-red-100/90 text-red-900' 
                                            : mData.porcentaje > 0 
                                              ? 'text-emerald-800 bg-emerald-100/90 text-emerald-900' 
                                              : 'text-gray-600 bg-gray-100/80 font-bold'
                                        }`}
                                        title={`Desvío: ${mData.desvio > 0 ? '+' : ''}${mData.desvio.toLocaleString('es-AR')} | Base: ${
                                          percentBase === 'consumo' 
                                            ? mData.consumo.toLocaleString('es-AR') 
                                            : percentBase === 'teorico' 
                                              ? mData.teorico.toLocaleString('es-AR') 
                                              : mData.fisico.toLocaleString('es-AR')
                                        }`}
                                      >
                                        {labelStr}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )
                        ) : mensualFilterType === 'categoria' ? (
                          filteredMonthlyCategories.length === 0 ? (
                            <tr>
                              <td colSpan={monthlyEvolutionAnalysis.sortedMonths.length + 1} className="py-8 text-center text-gray-400 text-sm">
                                No se encontraron categorías coincidentes.
                              </td>
                            </tr>
                          ) : (
                            filteredMonthlyCategories.map(cat => (
                              <tr key={cat.tipo} className="hover:bg-slate-50/50">
                                <td className="py-4 px-2 font-black text-xs md:text-sm text-gray-900">
                                  {cat.tipo}
                                </td>
                                {monthlyEvolutionAnalysis.sortedMonths.map(monthKey => {
                                  const mData = cat.monthsList[monthKey];
                                  if (!mData) {
                                    return (
                                      <td key={monthKey} className="py-4 text-center text-gray-300 font-normal text-xs md:text-sm">
                                        -
                                      </td>
                                    );
                                  }
                                  const labelStr = mData.porcentaje > 0 ? `+${mData.porcentaje.toFixed(1)}%` : `${mData.porcentaje.toFixed(1)}%`;
                                  return (
                                    <td key={monthKey} className="py-4 px-1.5 text-center font-mono">
                                      <span 
                                        className={`inline-block w-full py-1.5 px-2 rounded-md text-xs md:text-[13px] font-black tracking-wide ${
                                          mData.porcentaje < 0 
                                            ? 'text-red-800 bg-red-100/90 text-red-900' 
                                            : mData.porcentaje > 0 
                                              ? 'text-emerald-800 bg-emerald-100/90 text-emerald-900' 
                                              : 'text-gray-600 bg-gray-100/80 font-bold'
                                        }`}
                                        title={`Desvío: ${mData.desvio > 0 ? '+' : ''}${mData.desvio.toLocaleString('es-AR')} | Base: ${
                                          percentBase === 'consumo' 
                                            ? mData.consumo.toLocaleString('es-AR') 
                                            : percentBase === 'teorico' 
                                              ? mData.teorico.toLocaleString('es-AR') 
                                              : mData.fisico.toLocaleString('es-AR')
                                        }`}
                                      >
                                        {labelStr}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )
                        ) : (
                          /* GRUPO CONSOLIDADO MODE */
                          filteredMonthlyGroups.length === 0 ? (
                            <tr>
                              <td colSpan={monthlyEvolutionAnalysis.sortedMonths.length + 2} className="py-8 text-center text-gray-400 text-sm">
                                No se encontraron grupos consolidados.
                              </td>
                            </tr>
                          ) : (
                            filteredMonthlyGroups.map(grp => (
                              <tr key={grp.producto} className="hover:bg-slate-50/50">
                                <td className="py-3.5 px-2 pr-2 truncate">
                                  <div className="font-extrabold text-xs md:text-sm text-gray-900 truncate max-w-[200px]" title={grp.producto}>{grp.producto}</div>
                                  <span className="font-mono text-[10px] md:text-xs text-indigo-505 text-indigo-500 block font-semibold">Consolidado</span>
                                </td>
                                <td className="py-3.5 px-2">
                                  <span className="px-2 py-1 text-[10px] md:text-xs font-black uppercase text-indigo-650 text-indigo-600 bg-indigo-50 rounded-md">
                                    {grp.tipo}
                                  </span>
                                </td>
                                {monthlyEvolutionAnalysis.sortedMonths.map(monthKey => {
                                  const mData = grp.monthsList[monthKey];
                                  if (!mData) {
                                    return (
                                      <td key={monthKey} className="py-3.5 text-center text-gray-300 font-normal text-xs md:text-sm">
                                        -
                                      </td>
                                    );
                                  }
                                  const labelStr = mData.porcentaje > 0 ? `+${mData.porcentaje.toFixed(1)}%` : `${mData.porcentaje.toFixed(1)}%`;
                                  return (
                                    <td key={monthKey} className="py-3.5 px-1.5 text-center font-mono">
                                      <span 
                                        className={`inline-block w-full py-1.5 px-2 rounded-md text-xs md:text-[13px] font-black tracking-wide ${
                                          mData.porcentaje < 0 
                                            ? 'text-red-800 bg-red-100/90 text-red-900' 
                                            : mData.porcentaje > 0 
                                              ? 'text-emerald-800 bg-emerald-100/90 text-emerald-900' 
                                              : 'text-gray-600 bg-gray-100/80'
                                        }`}
                                        title={`Desvío: ${mData.desvio > 0 ? '+' : ''}${mData.desvio.toLocaleString('es-AR')} | Base: ${
                                          percentBase === 'consumo' 
                                            ? mData.consumo.toLocaleString('es-AR') 
                                            : percentBase === 'teorico' 
                                              ? mData.teorico.toLocaleString('es-AR') 
                                              : mData.fisico.toLocaleString('es-AR')
                                        }`}
                                      >
                                        {labelStr}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
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
          
          {/* File state & save controls panel */}
          <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5">
            {/* Left: File metadata / reset */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div className="space-y-1 min-w-0">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Archivo Seleccionado</span>
                <h4 className="text-sm font-extrabold text-slate-800 leading-tight truncate max-w-full" title={inventoryFileName || 'Inventario cargado'}>
                  {inventoryFileName || 'Inventario cargado'}
                </h4>
                <div>
                  <button
                    onClick={() => {
                      setUploadedInventory([]);
                      setInventoryFileName(null);
                      setError(null);
                    }}
                    className="text-[11px] font-bold text-red-500 hover:text-red-700 transition-colors inline-flex items-center gap-1 hover:underline"
                  >
                    Reiniciar / Limpiar Datos e Importar Otro
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Date selection & Save action controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 bg-slate-50 border border-slate-200/60 rounded-xl p-3 shrink-0">
              {/* Date Input */}
              <div className="flex flex-col justify-center">
                <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-1 flex items-center gap-1 select-none">
                  <Calendar className="w-3.5 h-3.5 text-indigo-500" /> Fecha del Inventario:
                </label>
                <input 
                  type="date"
                  value={inventoryDate}
                  onChange={(e) => setInventoryDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-extrabold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer h-9"
                />
              </div>

              {/* Action Button: Save to Database / History */}
              <div className="flex items-end h-full">
                <button
                  onClick={saveInventoryToSystem}
                  disabled={isSavingInventory}
                  className={`w-full sm:w-auto h-[36px] px-5 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xs ${
                    isSavingInventory 
                      ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-indigo-100 active:scale-95 cursor-pointer'
                  }`}
                >
                  {isSavingInventory ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {isSavingInventory ? 'Guardando...' : 'Guardar y Subir al Historial'}
                </button>
              </div>
            </div>
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
                      <th className="px-4 py-3 text-right cursor-pointer select-none font-sans" onClick={() => requestSort('saldoTeoricoSinJust')}>
                        <div className="flex items-center justify-end gap-1">Stock Teórico <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-right cursor-pointer select-none text-indigo-850 font-sans" onClick={() => requestSort('saldoFinalDeposito')}>
                        <div className="flex items-center justify-end gap-1">Stock Físico <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-right cursor-pointer select-none font-sans" onClick={() => requestSort('desvio')}>
                        <div className="flex items-center justify-end gap-1">Desvío <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-right cursor-pointer select-none font-sans" onClick={() => requestSort('porcentaje')}>
                        <div className="flex items-center justify-end gap-1">Desvío % <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {processedTableRows.map((row, idx) => {
                      const calculatedIn = (row.entradasAlmacen + row.entradasOtros);
                      const calculatedOut = (row.devolucionAlmacen + row.salidaOtros + row.salidaConsumo);
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
                          <td className="px-4 py-3 text-right font-bold text-gray-800 bg-gray-50">
                            {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.saldoTeoricoSinJust || 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-extrabold text-indigo-900 bg-indigo-50/15">
                            {Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.saldoFinalDeposito)}
                          </td>
                          <td className={`px-4 py-3 text-right font-bold ${row.desvio < 0 ? 'text-red-600' : row.desvio > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                            {row.desvio > 0 ? '+' : ''}{Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(row.desvio)}
                          </td>
                          <td className={`px-4 py-3 text-right font-bold ${row.porcentaje < -5 ? 'text-red-700 bg-red-50' : row.porcentaje > 5 ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500'}`}>
                            {row.porcentaje > 0 ? '+' : ''}{Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(row.porcentaje)}%
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
