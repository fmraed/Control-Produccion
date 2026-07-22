import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, addDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { MonthlyGoal, InsumosTransit } from '../types';
import { BOTELLAS_POR_PACK, PACKS_POR_PALETA, WASTE_WEIGHTS } from '../constants';
import { format, parseISO, addMonths, startOfMonth, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  ShoppingCart, 
  Database, 
  FileSpreadsheet, 
  Plus, 
  Trash2, 
  Edit2, 
  X, 
  Save, 
  Sparkles, 
  RefreshCw, 
  AlertTriangle, 
  CalendarDays, 
  ClipboardList, 
  Search,
  CheckCircle,
  Truck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAppConfig } from '../hooks/useAppConfig';

interface InsumosGrouped {
  name: string;
  originalNames: string[];
  category: string;
  monthlyReq: Record<string, number>; 
}

export function MotorCompras() {
  const { config } = useAppConfig();
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [stockData, setStockData] = useState<any[]>([]);
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetasMappings, setEtiquetasMappings] = useState<Record<string, string>>({});
  const [separatedSupplies, setSeparatedSupplies] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<'sugerencias' | 'transitos'>('sugerencias');
  const [comprasSubTab, setComprasSubTab] = useState<'Materia Prima y Otros' | 'Preformas' | 'Etiquetas' | 'Envases y Plásticos'>('Materia Prima y Otros');
  const [projectionDays, setProjectionDays] = useState<number>(60);

  // Transits State
  const [transits, setTransits] = useState<InsumosTransit[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTransitQuery, setSearchTransitQuery] = useState('');
  const [sortTransitField, setSortTransitField] = useState<keyof InsumosTransit | ''>('');
  const [sortTransitDir, setSortTransitDir] = useState<'asc' | 'desc'>('asc');
  const [transitToDelete, setTransitToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<InsumosTransit>>({
    requisitionNumber: '',
    needDate: '',
    issueDate: '',
    code: '',
    description: '',
    specification: '',
    unit: '',
    status: '',
    requestedQuantity: 0,
    arrivedQuantity: 0
  });

  // Planning Months Setup (6 months)
  const planningMonths = useMemo(() => {
    const list = [];
    const baseDate = new Date();
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    for (let i = 0; i < 6; i++) {
        list.push(format(addMonths(start, i), 'yyyy-MM'));
    }
    return list;
  }, []);

  // Helpers
  const getCalibreFromInsumoName = useCallback((name: string): number => {
    if (!name) return 0;
    const ccMatch = name.match(/(\d+)\s*(?:cc|ml)/i);
    if (ccMatch) return parseInt(ccMatch[1], 10);
    const lMatch = name.match(/(\d+(?:\.\d+)?)\s*l\b/i);
    if (lMatch) {
      const liters = parseFloat(lMatch[1]);
      if (liters > 0) return Math.round(liters * 1000);
    }
    const parts = name.split(/[\/\s_-]+/);
    for (const part of parts) {
      const num = parseInt(part.replace(/\D/g, ''), 10);
      if (!isNaN(num) && (num === 250 || num === 500 || num === 600 || num === 1000 || num === 1250 || num === 1500 || num === 1750 || num === 2000 || num === 2250 || num === 3000)) {
        return num;
      }
    }
    return 0;
  }, []);

  const getPackingCategory = useCallback((insumoName: string) => {
    if (config?.insumosCategories?.[insumoName]) {
      return config.insumosCategories[insumoName];
    }
    const lower = insumoName.toLowerCase();
    if (lower.includes('preforma')) return 'Preformas';
    if (lower.includes('tapa')) return 'Tapas';
    if (lower.includes('cabezal')) return 'Cabezales Sifón';
    if (lower.includes('termo')) return 'Termocontraíble';
    if (lower.includes('stretch')) return 'Film Stretch';
    if (lower.includes('etiqueta')) return 'Etiquetas';
    if (lower.includes('azúcar') || lower.includes('azucar')) return 'Materia Prima';
    return 'Otros Insumos';
  }, [config?.insumosCategories]);

  const findPreformaForProduct = useCallback((tam: number, lin: string, sabor: string) => {
    const list = config?.preformasConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => (p.sizes || []).includes(tam) && p.line && p.line.toString() === lin.toString() && matchFlavor(p)) ||
           list.find(p => (p.sizes || []).includes(tam) && !p.line && matchFlavor(p)) ||
           list.find(p => (p.sizes || []).includes(tam) && matchFlavor(p)) ||
           list.find(p => (p.sizes || []).includes(tam) && p.line && p.line.toString() === lin.toString()) ||
           list.find(p => (p.sizes || []).includes(tam));
  }, [config]);

  const findTermoForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.termoConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => (p.sizes || []).includes(tam) && matchFlavor(p)) || list.find(p => (p.sizes || []).includes(tam));
  }, [config]);

  const findStretchForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.stretchConfig || [];
    return list.find(p => (p.sizes || []).includes(tam)) || list[0];
  }, [config]);

  const findTapaForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.tapaConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => (p.sizes || []).includes(tam) && matchFlavor(p)) || list.find(p => (p.sizes || []).includes(tam));
  }, [config]);

  const getConsumoProyectadoYDiario = useCallback((item: InsumosGrouped) => {
    let remainingDays = projectionDays;
    let totalReq = 0;
    
    for (let i = 0; i < planningMonths.length && remainingDays > 0; i++) {
      const monthStr = planningMonths[i];
      const monthReq = item.monthlyReq[monthStr] || 0;
      
      const [year, month] = monthStr.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      
      const daysFromThisMonth = Math.min(daysInMonth, remainingDays);
      const proportion = daysFromThisMonth / daysInMonth;
      
      totalReq += monthReq * proportion;
      remainingDays -= daysFromThisMonth;
    }
    
    const dailyRate = projectionDays > 0 ? totalReq / projectionDays : 0;
    return {
      consumoProyectado: totalReq,
      consumoDiario: dailyRate
    };
  }, [projectionDays, planningMonths]);

  // Load Database Data
  const fetchData = useCallback(() => {
    setRefreshing(true);
    const startMonth = planningMonths[0];
    const endMonth = format(addMonths(parseISO(`${startMonth}-01`), 6), 'yyyy-MM');
    const qGoals = query(collection(db, 'monthly_goals'), where('month', '>=', startMonth), where('month', '<', endMonth));

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MonthlyGoal)));
    });

    const unsubInsumos = onSnapshot(doc(db, 'config', 'sql_insumo_mappings'), (docSnap) => {                
        if (docSnap.exists()) setInsumoMappings(docSnap.data() as Record<string, string>);
    });

    const unsubEtiquetas = onSnapshot(doc(db, 'config', 'sql_etiquetas_mappings'), (docSnap) => {
        if (docSnap.exists()) setEtiquetasMappings(docSnap.data() as Record<string, string>);
    });

    const unsubSeparated = onSnapshot(doc(db, 'config', 'separated_supplies'), (docSnap) => {
        if (docSnap.exists()) {
            setSeparatedSupplies(docSnap.data() as Record<string, number>);
        } else {
            setSeparatedSupplies({});
        }
    });

    const unsubTransits = onSnapshot(query(collection(db, 'insumos_transits')), (snap) => {
      setTransits(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsumosTransit)));
    });

    fetch('/api/sql/insumosStock')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const mappedStock = data.data.map((item: any) => ({
            insumo: item.nombre_articulo,
            codigo: item.codigo_articulo || '',
            amount: item.stock_almacen || 0
          }));
          setStockData(mappedStock);
        }
        setLoading(false);
        setRefreshing(false);
      })
      .catch(err => {
        console.error('Error fetching insumos stock', err);
        setLoading(false);
        setRefreshing(false);
      });

    return () => { unsubGoals(); unsubInsumos(); unsubEtiquetas(); unsubSeparated(); unsubTransits(); };
  }, [planningMonths]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const renderSortableHeader = (field: keyof InsumosTransit, label: string, className = "px-4 py-4") => {
    return (
      <th 
        className={`${className} cursor-pointer hover:bg-gray-100 transition-colors select-none`}
        onClick={() => {
          if (sortTransitField === field) {
            setSortTransitDir(d => d === 'asc' ? 'desc' : 'asc');
          } else {
            setSortTransitField(field);
            setSortTransitDir('asc');
          }
        }}
      >
        <div className={`flex items-center gap-1 ${className.includes('text-right') ? 'justify-end' : className.includes('text-center') ? 'justify-center' : ''}`}>
          {label}
          {sortTransitField === field && (
            <span className="text-gray-400 text-[10px]">
              {sortTransitDir === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </div>
      </th>
    );
  };
  const handleSaveTransit = async () => {
    try {
      if (editingId) {
        await setDoc(doc(db, 'insumos_transits', editingId), formData, { merge: true });
      } else {
        await addDoc(collection(db, 'insumos_transits'), formData);
      }
      setShowAdd(false);
      setEditingId(null);
      setFormData({
        requisitionNumber: '',
        needDate: '',
        issueDate: '',
        code: '',
        description: '',
        specification: '',
        unit: '',
        status: '',
        requestedQuantity: 0,
        arrivedQuantity: 0
      });
    } catch (err) {
      console.error(err);
      alert('Error guardando tránsito');
    }
  };

  const confirmDeleteTransit = async () => {
    if (transitToDelete) {
      try {
        await deleteDoc(doc(db, 'insumos_transits', transitToDelete));
        setTransitToDelete(null);
      } catch (err) {
        console.error("Error deleting transit:", err);
      }
    }
  };

  const handleDeleteTransit = (id: string) => {
    setTransitToDelete(id);
  };

  const parseNumber = (val: string) => {
    if (!val) return 0;
    const clean = val.replace(/\./g, '').replace(',', '.');
    return parseFloat(clean) || 0;
  };

  const parseDate = (val: string) => {
    if (!val) return '';
    try {
      const parts = val.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
      return val;
    } catch {
      return val;
    }
  };

  const [importing, setImporting] = useState(false);
  const handleImportTransits = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const lines = importText.split('\n').filter(l => l.trim());
      let added = 0;
      
      // Dividimos en batches de 500 para evitar los límites de Firestore
      const BATCH_SIZE = 400;
      let batches = [];
      let currentBatch = writeBatch(db);
      let opCount = 0;
      
      // Default indexes based on original 10-column structure
      let idxMap = {
        req: 0,
        needDate: 1,
        issueDate: 2,
        code: 3,
        desc: 4,
        spec: 5,
        unit: 6,
        status: 7,
        reqQty: 8,
        arrQty: 9
      };
      
      let isFirstLine = true;
      for (const line of lines) {
        const cols = line.split('\t').map(c => c.trim());
        const firstCol = (cols[0] || '').toUpperCase();
        
        if (isFirstLine) {
           isFirstLine = false;
           
           if (firstCol.includes('REQ') || firstCol === 'NRO REQ.' || firstCol === 'REQUISICIÓN' || firstCol === 'NRO REQ') {
             // Dynamically map columns
             cols.forEach((col, i) => {
               const c = col.toUpperCase();
               if (c === 'NRO REQ.' || c === 'NRO REQ' || c === 'REQUISICION' || c === 'REQUISICIÓN' || c.includes('REQ')) idxMap.req = i;
               if (c.includes('NECESIDAD')) idxMap.needDate = i;
               if (c.includes('EMI')) idxMap.issueDate = i;
               if (c.includes('CÓDIGO') || c.includes('CODIGO')) idxMap.code = i;
               if (c.includes('DESC') || c.includes('MATERIAL')) idxMap.desc = i;
               if (c.includes('ESP') || c.includes('TEXTO')) idxMap.spec = i;
               if (c === 'UM' || c === 'U.M.' || c.includes('UNIDAD')) idxMap.unit = i;
               if (c.includes('ESTADO')) idxMap.status = i;
               if (c.includes('SOLICITADA') || c.includes('CANT') && c.includes('SOL')) idxMap.reqQty = i;
               if (c.includes('LLEGADA') || c.includes('ENTREGADA') || (c.includes('CANT') && c.includes('LLEG'))) idxMap.arrQty = i;
             });
             continue;
           } else {
             // If no headers, guess based on column count
             if (cols.length === 9) {
               idxMap = { req: 0, needDate: 1, issueDate: 2, code: 3, desc: 4, spec: 5, unit: -1, status: 6, reqQty: 7, arrQty: 8 };
             }
           }
        }

        if (cols.length >= 6 && cols[idxMap.req]) {
           // Si arrQty no se mapeó dinámicamente o está fuera de rango, usa reqQty. Si status no está, asume 'PENDIENTE'
          const transit: InsumosTransit = {
            requisitionNumber: cols[idxMap.req] || '',
            needDate: parseDate(cols[idxMap.needDate] || ''),
            issueDate: parseDate(cols[idxMap.issueDate] || ''),
            code: cols[idxMap.code] || '',
            description: cols[idxMap.desc] || '',
            specification: cols[idxMap.spec] || '',
            unit: idxMap.unit !== undefined ? (cols[idxMap.unit] || '') : '',
            status: cols[idxMap.status] || 'PENDIENTE',
            requestedQuantity: parseNumber(cols[idxMap.reqQty] || ''),
            arrivedQuantity: parseNumber(cols[idxMap.arrQty] || '')
          };
          
          const newDocRef = doc(collection(db, 'insumos_transits'));
          currentBatch.set(newDocRef, transit);
          added++;
          opCount++;
          
          if (opCount === BATCH_SIZE) {
            batches.push(currentBatch.commit());
            currentBatch = writeBatch(db);
            opCount = 0;
          }
        }
      }
      
      if (opCount > 0) {
        batches.push(currentBatch.commit());
      }
      
      await Promise.all(batches);
      
      if (added > 0) {
        alert(`Se importaron ${added} registros exitosamente.`);
        setShowImport(false);
        setImportText('');
      } else {
        alert('No se detectaron filas válidas para importar. Asegúrese de que el formato coincida con el esperado.');
      }
    } catch (err) {
      console.error(err);
      alert('Error importando datos. Verifique el formato y la conexión.');
    } finally {
      setImporting(false);
    }
  };

  // Calculations: Projection Combined Data (Same as SuppliesProjection.tsx)
  const combinedData = useMemo(() => {
    if (!config) return { projection: [], consumption: {} };

    const requirementsByMonth: Record<string, Record<string, number>> = {};
    planningMonths.forEach(month => { requirementsByMonth[month] = {}; });

    goals.forEach(goal => {
      const { month, marca, sabor, tamano, quantity } = goal;
      if (!planningMonths.includes(month) || quantity <= 0 || !tamano || !marca || !sabor) return;

      const reqObj = requirementsByMonth[month];
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const beverageLiters = quantity * botellasPorPack * (tamano / 1000);
      const mixRatio = config.co2Volumes?.[marca]?.[sabor] !== undefined && config.co2Volumes?.[marca]?.[sabor] === 0 ? 1 : 5;
      const syrupLitersNeeded = beverageLiters / mixRatio;
      const unitsRequired = (config.syrupFormulas?.[marca]?.[sabor]?.liters || 0) > 0 ? (syrupLitersNeeded / config.syrupFormulas?.[marca]?.[sabor]?.liters) : 0;
      
      Object.keys(config.insumosMatrix?.[marca]?.[sabor] || {}).forEach(insName => {
        const kgPerUnit = config.insumosMatrix?.[marca]?.[sabor]?.[insName] || 0;
        if (kgPerUnit > 0) reqObj[insName] = (reqObj[insName] || 0) + (unitsRequired * kgPerUnit);
      });

      const preformasNeeded = quantity * botellasPorPack;
      const termoWeight = config?.wasteWeights?.[tamano.toString()]?.termo ?? WASTE_WEIGHTS[tamano]?.termo ?? 0;
      const termoNeededKg = quantity * termoWeight;
      const packsPerPaleta = PACKS_POR_PALETA[tamano] || 80;
      const stretchNeededKg = (quantity / packsPerPaleta) * 0.4;
      const tapasNeeded = preformasNeeded;

      reqObj[findPreformaForProduct(tamano, '', sabor)?.name || ''] = (reqObj[findPreformaForProduct(tamano, '', sabor)?.name || ''] || 0) + preformasNeeded;
      reqObj[findTermoForProduct(tamano, sabor)?.name || ''] = (reqObj[findTermoForProduct(tamano, sabor)?.name || ''] || 0) + termoNeededKg;
      reqObj[findStretchForProduct(tamano, sabor)?.name || ''] = (reqObj[findStretchForProduct(tamano, sabor)?.name || ''] || 0) + stretchNeededKg;
      reqObj[findTapaForProduct(tamano, sabor)?.name || ''] = (reqObj[findTapaForProduct(tamano, sabor)?.name || ''] || 0) + tapasNeeded;

      const isExternal = config?.externalProducts?.[marca]?.[tamano.toString()]?.includes(sabor);
      if (!isExternal) {
        reqObj[`Etiqueta ${marca} / ${sabor} / ${tamano}cc`] = (reqObj[`Etiqueta ${marca} / ${sabor} / ${tamano}cc`] || 0) + preformasNeeded;
      }
    });

    const combinedGroups = [
      ...(config?.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
      ...(config?.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
    ] as string[][];

    const finalItems: Record<string, InsumosGrouped> = {};
    planningMonths.forEach(month => {
        Object.keys(requirementsByMonth[month]).forEach(insumo => {
            if (!insumo) return;

            let groupKey = insumo;
            let groupNames = [insumo];
            const groupMatch = combinedGroups.find(g => g.includes(insumo));
            if (groupMatch) {
                groupKey = groupMatch.join(' / ');
                groupNames = groupMatch;
            }

            if (!finalItems[groupKey]) finalItems[groupKey] = { name: groupKey, originalNames: groupNames, category: getPackingCategory(insumo), monthlyReq: {} };
            planningMonths.forEach(m => finalItems[groupKey].monthlyReq[m] = finalItems[groupKey].monthlyReq[m] || 0);
            finalItems[groupKey].monthlyReq[month] = (finalItems[groupKey].monthlyReq[month] || 0) + requirementsByMonth[month][insumo];
        });
    });

    const items = Object.values(finalItems).filter(item => 
        Object.values(item.monthlyReq).some(val => val > 0)
    );

    const getMappedCodes = (originalNames: string[]): string[] => {
        let allCodes: string[] = [];
        originalNames.forEach(itemName => {
            if (insumoMappings[itemName]) allCodes.push(...String(insumoMappings[itemName]).split(',').map(c => c.trim().toLowerCase()));
            
            if (itemName.startsWith('Etiqueta ')) {
                const parts = itemName.replace('Etiqueta ', '').replace('cc', '').split(' / ');
                if (parts.length === 3) {
                    const key = `${parts[0]}-${parts[1]}-${parts[2]}`;
                    if (etiquetasMappings[key]) allCodes.push(...String(etiquetasMappings[key]).split(',').map(c => c.trim().toLowerCase()));
                }
            }

            const pref = (config?.preformasConfig || []).find(p => p.name === itemName);
            if (pref?.sqlCode) allCodes.push(...String(pref.sqlCode).split(',').map(c => c.trim().toLowerCase()));
            
            const tm = (config?.termoConfig || []).find(t => t.name === itemName);
            if (tm?.sqlCode) allCodes.push(...String(tm.sqlCode).split(',').map(c => c.trim().toLowerCase()));
            
            const st = (config?.stretchConfig || []).find(s => s.name === itemName);
            if (st?.sqlCode) allCodes.push(...String(st.sqlCode).split(',').map(c => c.trim().toLowerCase()));
            
            const tp = (config?.tapaConfig || []).find(t => t.name === itemName);
            if (tp?.sqlCode) allCodes.push(...String(tp.sqlCode).split(',').map(c => c.trim().toLowerCase()));
        });
        
        return Array.from(new Set(allCodes));
    };

    const projectionResults = items.map(item => {
        const targetCodes = getMappedCodes(item.originalNames);
        let dynamicallyMatchedCodes: string[] = [];

        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        let initialStock = stockData.reduce((acc, s) => {
            if (targetCodes.length > 0) {
                if (s.codigo && targetCodes.includes(String(s.codigo).trim().toLowerCase())) {
                    dynamicallyMatchedCodes.push(String(s.codigo).trim().toLowerCase());
                    return acc + s.amount;
                }
                return acc; 
            }
            
            const stockName = (s.insumo || s.NAME || '');
            const hasNameMatch = item.originalNames.some(itemName => {
                const lowerItem = normalize(itemName);
                const normStockName = normalize(stockName);
                return normStockName.includes(lowerItem) || lowerItem.includes(normStockName);
            });
            
            if (hasNameMatch) {
                if (s.codigo) dynamicallyMatchedCodes.push(String(s.codigo).trim().toLowerCase());
                return acc + s.amount;
            }
            return acc;
        }, 0);

        let separatedAmount = 0;
        if (separatedSupplies[item.name]) {
            separatedAmount += separatedSupplies[item.name];
        } else {
            item.originalNames.forEach(n => {
                if (separatedSupplies[n]) separatedAmount += separatedSupplies[n];
            });
        }
        
        initialStock = Math.max(0, initialStock - separatedAmount);

        const finalTargetCodes = Array.from(new Set([...targetCodes, ...dynamicallyMatchedCodes]));
        return { ...item, initialStock, targetCodes: finalTargetCodes };
    });

    return { projection: projectionResults, items: items };
  }, [config, goals, planningMonths, stockData, findPreformaForProduct, findTermoForProduct, findStretchForProduct, findTapaForProduct, getPackingCategory, insumoMappings, etiquetasMappings, separatedSupplies]);

  // Filtered Transits List
  const filteredTransitsList = useMemo(() => {
    let result = transits;
    if (searchTransitQuery) {
      const queryLower = searchTransitQuery.toLowerCase();
      result = result.filter(t => 
        String(t.requisitionNumber || '').toLowerCase().includes(queryLower) ||
        String(t.code || '').toLowerCase().includes(queryLower) ||
        String(t.description || '').toLowerCase().includes(queryLower) ||
        String(t.specification || '').toLowerCase().includes(queryLower) ||
        String(t.status || '').toLowerCase().includes(queryLower)
      );
    }
    
    if (sortTransitField) {
      result = [...result].sort((a, b) => {
        let valA = a[sortTransitField] as string | number;
        let valB = b[sortTransitField] as string | number;
        
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortTransitDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return sortTransitDir === 'asc' ? valA - valB : valB - valA;
      });
    }
    
    return result;
  }, [transits, searchTransitQuery, sortTransitField, sortTransitDir]);

  // Export to Excel function for Sugerencias
  const handleExportSugerencias = () => {
    const tableData = combinedData.projection.filter(item => {
      if (comprasSubTab === 'Preformas') return item.category === 'Preformas';
      if (comprasSubTab === 'Etiquetas') return item.category === 'Etiquetas';
      if (comprasSubTab === 'Envases y Plásticos') return ['Termocontraíble', 'Film Stretch', 'Tapas', 'Cabezales Sifón'].includes(item.category);
      return !['Preformas', 'Etiquetas', 'Termocontraíble', 'Film Stretch', 'Tapas', 'Cabezales Sifón'].includes(item.category);
    }).sort((a, b) => {
      if (comprasSubTab === 'Etiquetas') {
        const calA = getCalibreFromInsumoName(a.name);
        const calB = getCalibreFromInsumoName(b.name);
        if (calA !== calB) return calB - calA;
      }
      return a.name.localeCompare(b.name);
    }).map(item => {
      const { consumoProyectado, consumoDiario } = getConsumoProyectadoYDiario(item);
      const stockFisico = item.initialStock;
      
      let mpTransito = 0;
      transits.forEach(t => {
        if (!t.status || String(t.status).toLowerCase().includes('recibido') || String(t.status).toLowerCase().includes('completado')) return;
        const tCode = String(t.code || '').toLowerCase().trim().replace(/^0+/, '');
        const tDesc = String(t.description || '').toLowerCase();
        let match = false;
        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (tCode && item.targetCodes && item.targetCodes.some(c => String(c).replace(/^0+/, '') === tCode)) {
          match = true;
        } else if (item.originalNames.some(n => normalize(tDesc).includes(normalize(n)))) {
          match = true;
        }
        if (match) {
          mpTransito += (Number(t.requestedQuantity) || 0) - (Number(t.arrivedQuantity) || 0);
        }
      });

      const posicionActual = stockFisico + mpTransito;
      const necesidadTeorica = consumoProyectado - posicionActual;
      const getSecurityDays = (cat: string) => {
        if (!config?.categorySecurityDays) return 0;
        let targetCat = cat;
        if (cat === 'Termocontraíble') targetCat = 'Termocontraíbles';
        if (cat === 'Film Stretch') targetCat = 'Stretch';
        return config.categorySecurityDays[targetCat] || config.categorySecurityDays[cat] || 0;
      };
      const diasSeguridad = getSecurityDays(item.category);
      const criticidad = config?.insumosCriticality?.[item.name] || 1;
      const stockSeguridad = consumoDiario * diasSeguridad * criticidad;
      const necesidadReal = Math.max(0, necesidadTeorica + stockSeguridad);
      const lotConf = config?.insumosPurchaseLots?.[item.name] || { size: 1, unit: 'un' };
      const lotSize = Number(lotConf.size) || 1;
      const lotes = Math.ceil(necesidadReal / lotSize);
      const totalComprar = lotes * lotSize;
      const cal = getCalibreFromInsumoName(item.name);

      return {
        'Insumo': item.name,
        'Categoría': item.category,
        ...(comprasSubTab === 'Etiquetas' ? { 'Calibre': cal > 0 ? `${cal} cc` : 'Sin Calibre' } : {}),
        [`Consumo Proyectado (${projectionDays} d)`]: Math.round(consumoProyectado),
        'Stock Físico': Math.round(stockFisico),
        'En Tránsito': Math.round(mpTransito),
        'Posición Actual': Math.round(posicionActual),
        'Necesidad Teórica': Math.round(necesidadTeorica),
        'Stock Seguridad': Math.round(stockSeguridad),
        'Necesidad Real': Math.round(necesidadReal),
        'Lotes a Comprar': lotes,
        'Tamaño Lote': lotSize,
        'Total a Comprar': Math.round(totalComprar),
        'Unidad': lotConf.unit
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(tableData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sugerencias Compra');
    XLSX.writeFile(workbook, `Sugerencias_Compra_${comprasSubTab.replace(/ /g, '_')}_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <RefreshCw className="w-12 h-12 text-amber-500 animate-spin" />
        <p className="text-gray-500 font-bold animate-pulse">Cargando Motor de Compras...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-2xl shadow-md border border-amber-400/20 p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <ShoppingCart className="w-48 h-48" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-3xl font-black tracking-tight flex items-center gap-2">
              <ShoppingCart className="w-8 h-8" />
              Motor de Compras y Abastecimiento
            </h2>
            <p className="text-amber-100 max-w-2xl text-sm font-medium">
              Analiza dinámicamente las necesidades de stock cruzando los planes de metas, inventario real, y materia prima en tránsito para sugerir compras eficientes por lotes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={fetchData} 
              disabled={refreshing}
              className="bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-lg p-3 transition-all flex items-center gap-2 border border-white/20 text-xs font-bold uppercase tracking-wider"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* Main Tab Selectors */}
      <div className="flex bg-gray-100 p-1 rounded-2xl gap-1 w-full max-w-lg border border-gray-200">
        <button
          onClick={() => setActiveMainTab('sugerencias')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeMainTab === 'sugerencias' 
              ? 'bg-amber-600 text-white shadow-md' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Sugerencias de Compra
        </button>
        <button
          onClick={() => setActiveMainTab('transitos')}
          className={`flex-1 py-3 px-4 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeMainTab === 'transitos' 
              ? 'bg-amber-600 text-white shadow-md' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Truck className="w-4 h-4" />
          MP en Tránsito ({transits.length})
        </button>
      </div>

      {/* VIEW: SUGERENCIAS DE COMPRA */}
      {activeMainTab === 'sugerencias' && (
        <div className="space-y-6">
          {/* Sub-tab Selectors for Categories */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-3">
            <div className="flex flex-wrap gap-2">
              {(['Materia Prima y Otros', 'Preformas', 'Etiquetas', 'Envases y Plásticos'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setComprasSubTab(tab)}
                  className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                    comprasSubTab === tab 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-100' 
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            
            <button
              onClick={handleExportSugerencias}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Exportar {comprasSubTab} a Excel
            </button>
          </div>

          {/* Controlador de Período de Proyección ajustable */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-50 text-amber-700 rounded-xl">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-gray-800">Período de Consumo Proyectado</h4>
                <p className="text-xs text-gray-500 font-bold">Ajusta los días para proyectar consumo y stock de seguridad.</p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5 bg-gray-100 p-1 rounded-xl border border-gray-200">
                {[30, 45, 60, 90, 120].map(days => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setProjectionDays(days)}
                    className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${
                      projectionDays === days
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {days} días
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm max-w-[130px]">
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={projectionDays}
                  onChange={e => setProjectionDays(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-14 text-right text-xs font-black text-gray-800 focus:outline-none"
                />
                <span className="text-xs font-bold text-gray-400">días</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="p-4">Insumo</th>
                    <th className="p-4 text-right">Consumo Proyectado<br/><span className="text-[10px] text-gray-400 lowercase">(Próximos {projectionDays} días)</span></th>
                    <th className="p-4 text-right">Stock Físico</th>
                    <th className="p-4 text-right">En Tránsito</th>
                    <th className="p-4 text-right">Posición Actual<br/><span className="text-[10px] text-gray-400 lowercase">(Físico + Tránsito)</span></th>
                    <th className="p-4 text-right">Necesidad Teórica</th>
                    <th className="p-4 text-right">Stock de Seguridad</th>
                    <th className="p-4 text-right bg-blue-50/40 text-blue-900">Necesidad Real</th>
                    <th className="p-4 text-right bg-blue-50/40 text-blue-900">Sugerencia Compra<br/><span className="text-[10px] text-blue-500 lowercase">(Lotes)</span></th>
                    <th className="p-4 text-right bg-blue-50/40 text-blue-900">Cantidad Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(() => {
                    const filteredProjection = combinedData.projection.filter(item => {
                      if (comprasSubTab === 'Preformas') return item.category === 'Preformas';
                      if (comprasSubTab === 'Etiquetas') return item.category === 'Etiquetas';
                      if (comprasSubTab === 'Envases y Plásticos') return ['Termocontraíble', 'Film Stretch', 'Tapas', 'Cabezales Sifón'].includes(item.category);
                      // Materia Prima y Otros (anything else)
                      return !['Preformas', 'Etiquetas', 'Termocontraíble', 'Film Stretch', 'Tapas', 'Cabezales Sifón'].includes(item.category);
                    });

                    if (filteredProjection.length === 0) {
                      return (
                        <tr>
                          <td colSpan={10} className="p-12 text-center text-gray-400 font-medium">
                            No se encontraron requerimientos proyectados para la categoría {comprasSubTab} en los próximos 6 meses.
                          </td>
                        </tr>
                      );
                    }

                    const renderItemRow = (item: typeof filteredProjection[0], keyStr: string) => {
                      const { consumoProyectado, consumoDiario } = getConsumoProyectadoYDiario(item);
                      const stockFisico = item.initialStock;
                      
                      let mpTransito = 0;
                      transits.forEach(t => {
                        if (!t.status || String(t.status).toLowerCase().includes('recibido') || String(t.status).toLowerCase().includes('completado')) return;
                        
                        const tCode = String(t.code || '').toLowerCase().trim().replace(/^0+/, '');
                        const tDesc = String(t.description || '').toLowerCase();
                        
                        let match = false;
                        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                        if (tCode && item.targetCodes && item.targetCodes.some(c => String(c).replace(/^0+/, '') === tCode)) {
                          match = true;
                        } else if (item.originalNames.some(n => normalize(tDesc).includes(normalize(n)))) {
                          match = true;
                        }
                        
                        if (match) {
                          mpTransito += (Number(t.requestedQuantity) || 0) - (Number(t.arrivedQuantity) || 0);
                        }
                      });
                      
                      const posicionActual = stockFisico + mpTransito;
                      const necesidadTeorica = consumoProyectado - posicionActual;
                      
                      const getSecurityDays = (cat: string) => {
                        if (!config?.categorySecurityDays) return 0;
                        let targetCat = cat;
                        if (cat === 'Termocontraíble') targetCat = 'Termocontraíbles';
                        if (cat === 'Film Stretch') targetCat = 'Stretch';
                        return config.categorySecurityDays[targetCat] || config.categorySecurityDays[cat] || 0;
                      };
                      const diasSeguridad = getSecurityDays(item.category);
                      const criticidad = config?.insumosCriticality?.[item.name] || 1;
                      const stockSeguridad = consumoDiario * diasSeguridad * criticidad;
                      
                      const necesidadReal = Math.max(0, necesidadTeorica + stockSeguridad);
                      
                      const lotConf = config?.insumosPurchaseLots?.[item.name] || { size: 1, unit: 'un' };
                      const lotSize = Number(lotConf.size) || 1;
                      const lotes = Math.ceil(necesidadReal / lotSize);
                      const totalComprar = lotes * lotSize;
                      
                      return (
                        <tr key={keyStr} className="hover:bg-gray-50/80 transition-colors">
                          <td className="p-4 font-bold text-gray-800">{item.name}</td>
                          <td className="p-4 text-right font-mono text-gray-600">{Math.round(consumoProyectado).toLocaleString('es-AR')}</td>
                          <td className="p-4 text-right font-mono text-gray-600">{Math.round(stockFisico).toLocaleString('es-AR')}</td>
                          <td className="p-4 text-right font-mono font-semibold text-blue-600 bg-blue-50/5">{Math.round(mpTransito).toLocaleString('es-AR')}</td>
                          <td className="p-4 text-right font-mono font-bold text-gray-800">{Math.round(posicionActual).toLocaleString('es-AR')}</td>
                          <td className="p-4 text-right font-mono">
                            <span className={necesidadTeorica > 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                              {Math.round(necesidadTeorica).toLocaleString('es-AR')}
                            </span>
                          </td>
                          <td className="p-4 text-right font-mono text-amber-600">{Math.round(stockSeguridad).toLocaleString('es-AR')}</td>
                          <td className="p-4 text-right font-mono font-black text-rose-600 bg-blue-50/20">{Math.round(necesidadReal).toLocaleString('es-AR')}</td>
                          <td className="p-4 text-right font-mono font-bold text-blue-800 bg-blue-50/20">
                            {lotes > 0 ? (
                              <>
                                {lotes.toLocaleString('es-AR')}{' '}
                                <span className="text-xs text-gray-400 font-normal">
                                  lotes (de {lotSize} {lotConf.unit})
                                </span>
                              </>
                            ) : (
                              <span className="text-green-600 font-semibold">Abastecido</span>
                            )}
                          </td>
                          <td className="p-4 text-right font-mono font-black text-gray-900 bg-blue-50/20">
                            {lotes > 0 ? `${Math.round(totalComprar).toLocaleString('es-AR')} ${lotConf.unit}` : '0'}
                          </td>
                        </tr>
                      );
                    };

                    if (comprasSubTab === 'Etiquetas') {
                      const groupedByCalibre: Record<number, typeof filteredProjection> = {};
                      filteredProjection.forEach(item => {
                        const cal = getCalibreFromInsumoName(item.name);
                        if (!groupedByCalibre[cal]) groupedByCalibre[cal] = [];
                        groupedByCalibre[cal].push(item);
                      });

                      const sortedCalibres = Object.keys(groupedByCalibre)
                        .map(Number)
                        .sort((a, b) => b - a); // Order from mayor to menor (e.g. 3000 -> 2250 -> 1500 -> 500 -> 0)

                      return sortedCalibres.flatMap(cal => {
                        const itemsInCalibre = groupedByCalibre[cal].sort((a, b) => a.name.localeCompare(b.name));
                        return [
                          <tr key={`group-calibre-${cal}`} className="bg-indigo-50/90 border-y-2 border-indigo-200">
                            <td colSpan={10} className="px-4 py-2.5 font-black text-indigo-950 text-xs uppercase tracking-wider bg-indigo-100/70">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shadow-sm"></span>
                                <span>Calibre {cal > 0 ? `${cal} cc` : 'Sin Calibre / Genéricos'}</span>
                                <span className="text-[10px] text-indigo-700 font-bold bg-indigo-200/80 px-2 py-0.5 rounded-full ml-1">
                                  {itemsInCalibre.length} {itemsInCalibre.length === 1 ? 'insumo' : 'insumos'}
                                </span>
                              </div>
                            </td>
                          </tr>,
                          ...itemsInCalibre.map((item, i) => renderItemRow(item, `etiqueta-${cal}-${i}`))
                        ];
                      });
                    }

                    if (comprasSubTab === 'Envases y Plásticos') {
                      const tapasItems: typeof filteredProjection = [];
                      const plasticosItems: typeof filteredProjection = [];

                      filteredProjection.forEach(item => {
                        const cat = item.category || '';
                        if (cat === 'Tapas' || cat === 'Cabezales Sifón' || cat.toLowerCase().includes('tapa') || item.name.toLowerCase().includes('tapa')) {
                          tapasItems.push(item);
                        } else {
                          plasticosItems.push(item);
                        }
                      });

                      tapasItems.sort((a, b) => a.name.localeCompare(b.name));
                      plasticosItems.sort((a, b) => a.name.localeCompare(b.name));

                      const rows: React.ReactNode[] = [];

                      if (tapasItems.length > 0) {
                        rows.push(
                          <tr key="group-tapas" className="bg-amber-50/90 border-y-2 border-amber-200">
                            <td colSpan={10} className="px-4 py-2.5 font-black text-amber-950 text-xs uppercase tracking-wider bg-amber-100/70">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-600 shadow-sm"></span>
                                <span>Tapas y Cabezales</span>
                                <span className="text-[10px] text-amber-800 font-bold bg-amber-200/80 px-2 py-0.5 rounded-full ml-1">
                                  {tapasItems.length} {tapasItems.length === 1 ? 'insumo' : 'insumos'}
                                </span>
                              </div>
                            </td>
                          </tr>,
                          ...tapasItems.map((item, i) => renderItemRow(item, `tapa-${i}`))
                        );
                      }

                      if (plasticosItems.length > 0) {
                        rows.push(
                          <tr key="group-plasticos" className="bg-emerald-50/90 border-y-2 border-emerald-200">
                            <td colSpan={10} className="px-4 py-2.5 font-black text-emerald-950 text-xs uppercase tracking-wider bg-emerald-100/70">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shadow-sm"></span>
                                <span>Plásticos y Films (Termocontraíble / Stretch)</span>
                                <span className="text-[10px] text-emerald-800 font-bold bg-emerald-200/80 px-2 py-0.5 rounded-full ml-1">
                                  {plasticosItems.length} {plasticosItems.length === 1 ? 'insumo' : 'insumos'}
                                </span>
                              </div>
                            </td>
                          </tr>,
                          ...plasticosItems.map((item, i) => renderItemRow(item, `plastico-${i}`))
                        );
                      }

                      return rows;
                    }

                    // Materia Prima y Otros (grouped by category)
                    const groupedByCategory: Record<string, typeof filteredProjection> = {};
                    filteredProjection.forEach(item => {
                      const cat = item.category || 'Otros Insumos';
                      if (!groupedByCategory[cat]) groupedByCategory[cat] = [];
                      groupedByCategory[cat].push(item);
                    });

                    const categoryOrder = config?.insumosCategoriesOrder || [];

                    const sortedCategories = Object.keys(groupedByCategory).sort((a, b) => {
                      const indexA = categoryOrder.indexOf(a);
                      const indexB = categoryOrder.indexOf(b);
                      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                      if (indexA !== -1) return -1;
                      if (indexB !== -1) return 1;
                      return a.localeCompare(b);
                    });

                    return sortedCategories.flatMap(cat => {
                      const itemsInCat = groupedByCategory[cat].sort((a, b) => a.name.localeCompare(b.name));
                      return [
                        <tr key={`group-mp-cat-${cat}`} className="bg-sky-50/90 border-y-2 border-sky-200">
                          <td colSpan={10} className="px-4 py-2.5 font-black text-sky-950 text-xs uppercase tracking-wider bg-sky-100/70">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-sky-600 shadow-sm"></span>
                              <span>Categoría: {cat}</span>
                              <span className="text-[10px] text-sky-800 font-bold bg-sky-200/80 px-2 py-0.5 rounded-full ml-1">
                                {itemsInCat.length} {itemsInCat.length === 1 ? 'insumo' : 'insumos'}
                              </span>
                            </div>
                          </td>
                        </tr>,
                        ...itemsInCat.map((item, i) => renderItemRow(item, `mp-cat-${cat}-${i}`))
                      ];
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: MP EN TRÁNSITO */}
      {activeMainTab === 'transitos' && (
        <div className="space-y-6">
          {/* Header Controls for Transits */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por req, descripción, código..."
                value={searchTransitQuery}
                onChange={e => setSearchTransitQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
              />
              {searchTransitQuery && (
                <button onClick={() => setSearchTransitQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  setFormData({
                    requisitionNumber: '',
                    needDate: '',
                    issueDate: '',
                    code: '',
                    description: '',
                    specification: '',
                    unit: 'un',
                    status: 'PENDIENTE',
                    requestedQuantity: 0,
                    arrivedQuantity: 0
                  });
                  setEditingId(null);
                  setShowAdd(true);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                Añadir Tránsito Manual
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Importar desde Excel
              </button>
            </div>
          </div>

          {/* Transits Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200 uppercase font-black tracking-wider">
                  <tr>
                    {renderSortableHeader('requisitionNumber', 'Req.')}
                    {renderSortableHeader('needDate', 'F. Nec.')}
                    {renderSortableHeader('issueDate', 'F. Emi.')}
                    {renderSortableHeader('code', 'Código')}
                    {renderSortableHeader('description', 'Descripción')}
                    {renderSortableHeader('specification', 'Especificación')}
                    {renderSortableHeader('status', 'Estado', 'px-4 py-4 text-center')}
                    {renderSortableHeader('requestedQuantity', 'Cant. Sol.', 'px-4 py-4 text-right')}
                    {renderSortableHeader('arrivedQuantity', 'Cant. Lleg.', 'px-4 py-4 text-right')}
                    <th className="px-4 py-4 text-right">Restante</th>
                    <th className="px-4 py-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredTransitsList.map((t) => {
                    const restante = Math.max(0, (t.requestedQuantity || 0) - (t.arrivedQuantity || 0));
                    return (
                      <tr key={t.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="px-4 py-3.5 font-bold text-gray-900">{t.requisitionNumber}</td>
                        <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">{t.needDate}</td>
                        <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">{t.issueDate}</td>
                        <td className="px-4 py-3.5 font-mono text-gray-700 font-semibold">{t.code}</td>
                        <td className="px-4 py-3.5 font-medium text-gray-800 max-w-[220px] truncate" title={t.description}>{t.description}</td>
                        <td className="px-4 py-3.5 text-gray-500">{t.specification}</td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                            (t.status || '').toUpperCase().includes('RECIBIDO') || (t.status || '').toUpperCase().includes('COMPLETADO')
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                              : 'bg-amber-50 text-amber-700 border border-amber-200/50'
                          }`}>
                            {t.status || 'PENDIENTE'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium text-gray-600">{Number(t.requestedQuantity).toLocaleString('es-AR')}</td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium text-gray-600">{Number(t.arrivedQuantity).toLocaleString('es-AR')}</td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-blue-600 bg-blue-50/5">{restante.toLocaleString('es-AR')}</td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-3">
                            <button 
                              onClick={() => {
                                setFormData(t);
                                setEditingId(t.id!);
                                setShowAdd(true);
                              }}
                              className="text-blue-600 hover:text-blue-800 p-1.5 hover:bg-blue-50 rounded-lg transition-all"
                              title="Editar"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleDeleteTransit(t.id!)}
                              className="text-rose-600 hover:text-rose-800 p-1.5 hover:bg-rose-50 rounded-lg transition-all"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTransitsList.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-12 text-center text-gray-400 font-medium">
                        No se encontraron materiales en tránsito registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPORT TRANSITS FROM EXCEL */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2 text-gray-800">
                <FileSpreadsheet className="w-6 h-6 text-teal-600" />
                <h3 className="text-lg font-black tracking-tight">Importar Tránsitos desde Excel</h3>
              </div>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-xl text-xs space-y-1.5 leading-relaxed">
                <p className="font-bold">Instrucciones de Importación:</p>
                <p>Copie y pegue directamente las celdas desde su planilla Excel. Las columnas deben estar separadas por tabulación (por defecto en Excel) y respetar estrictamente el siguiente orden:</p>
                <p className="font-mono bg-blue-100/50 p-2 rounded border border-blue-200 overflow-x-auto whitespace-nowrap text-[10px]">
                  NRO REQ. | F.NECESIDAD | F.EMISIÓN | CÓDIGO | DESCRIPCIÓN ARTÍCULO | ESPECIFICACIÓN | U.M. | ESTADO | CANTIDAD SOLICITADA | CANTIDAD LLEGADA
                </p>
                <p className="text-gray-500 italic mt-1">* Se ignorará la primera fila si contiene encabezados.</p>
              </div>
              
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Pegue aquí el rango copiado de Excel..."
                className="w-full h-80 border border-gray-200 rounded-xl p-4 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 whitespace-pre overflow-auto bg-gray-50/50"
              />
            </div>
            
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowImport(false)}
                className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-150 rounded-xl border border-gray-250 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleImportTransits}
                disabled={!importText.trim() || importing}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-teal-100"
              >
                {importing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Procesar e Importar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT TRANSIT */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2 text-gray-800">
                <Truck className="w-6 h-6 text-amber-600" />
                <h3 className="text-lg font-black tracking-tight">{editingId ? 'Editar Tránsito' : 'Nuevo Material en Tránsito'}</h3>
              </div>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Nro. Requerimiento</label>
                <input 
                  type="text" 
                  value={formData.requisitionNumber || ''} 
                  onChange={e => setFormData({...formData, requisitionNumber: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Ej: R-102394"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Código de Insumo (SQL)</label>
                <input 
                  type="text" 
                  value={formData.code || ''} 
                  onChange={e => setFormData({...formData, code: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Ej: MP-B-02"
                />
              </div>
              
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Fecha de Necesidad</label>
                <input 
                  type="date" 
                  value={formData.needDate || ''} 
                  onChange={e => setFormData({...formData, needDate: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Fecha de Emisión</label>
                <input 
                  type="date" 
                  value={formData.issueDate || ''} 
                  onChange={e => setFormData({...formData, issueDate: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              
              <div className="col-span-1 md:col-span-2">
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Descripción del Artículo</label>
                <input 
                  type="text" 
                  value={formData.description || ''} 
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Ej: Preforma PET de 2.25L - Azul"
                />
              </div>
              
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Especificación</label>
                <input 
                  type="text" 
                  value={formData.specification || ''} 
                  onChange={e => setFormData({...formData, specification: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Ej: 42g"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Unidad de Medida</label>
                <input 
                  type="text" 
                  value={formData.unit || 'un'} 
                  onChange={e => setFormData({...formData, unit: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Ej: kg, un"
                />
              </div>
              
              <div className="col-span-1 md:col-span-2">
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Estado del Tránsito</label>
                <select
                  value={formData.status || 'PENDIENTE'}
                  onChange={e => setFormData({...formData, status: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                >
                  <option value="PENDIENTE">PENDIENTE (Aún no recibido)</option>
                  <option value="EN PUERTO">EN PUERTO / ADUANA</option>
                  <option value="DESPACHADO">DESPACHADO (En camino)</option>
                  <option value="PARCIAL">RECIBIDO PARCIAL</option>
                  <option value="RECIBIDO">RECIBIDO / COMPLETADO</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Cantidad Solicitada</label>
                <input 
                  type="number" 
                  value={formData.requestedQuantity || 0} 
                  onChange={e => setFormData({...formData, requestedQuantity: Number(e.target.value)})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Cantidad Llegada / Recibida</label>
                <input 
                  type="number" 
                  value={formData.arrivedQuantity || 0} 
                  onChange={e => setFormData({...formData, arrivedQuantity: Number(e.target.value)})}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-150 rounded-xl border border-gray-250 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveTransit}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-md shadow-amber-100"
              >
                <Save className="w-4 h-4" />
                Guardar Tránsito
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Modal */}
      {transitToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 text-rose-600">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="text-lg font-bold text-gray-900">Eliminar Tránsito</h3>
              </div>
              <p className="text-sm text-gray-600">
                ¿Está seguro que desea eliminar este registro de tránsito? Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-100">
              <button
                onClick={() => setTransitToDelete(null)}
                className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-200 rounded-xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteTransit}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-md shadow-rose-200"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
