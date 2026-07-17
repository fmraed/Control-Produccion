import React, { useState, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig } from '../hooks/useAppConfig';
import { MonthlyGoal, InsumosTransit } from '../types';
import { BOTELLAS_POR_PACK, PACKS_POR_PALETA, WASTE_WEIGHTS } from '../constants';
import { format, parseISO, addMonths, startOfMonth, addDays, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { TrendingDown, Calendar, Database, FlaskConical, BarChart3, Package, X, Plus, Trash2 } from 'lucide-react';

interface InsumosGrouped {
  name: string;
  originalNames: string[];
  category: string;
  monthlyReq: Record<string, number>; 
}

export function SuppliesProjection() {
  const { config } = useAppConfig();
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [stockData, setStockData] = useState<any[]>([]);
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetasMappings, setEtiquetasMappings] = useState<Record<string, string>>({});
  const [separatedSupplies, setSeparatedSupplies] = useState<Record<string, number>>({});
  const [showSeparatedModal, setShowSeparatedModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'proyeccion' | 'consumo'>('proyeccion');
  const [sortConfig, setSortConfig] = useState<{ field: string, asc: boolean }>({ field: 'etaDate', asc: true });
  const [sortConfigConsumo, setSortConfigConsumo] = useState<{ field: string, asc: boolean }>({ field: 'name', asc: true });
  const [transits, setTransits] = useState<InsumosTransit[]>([]);

  const planningMonths = useMemo(() => {
    const list = [];
    const baseDate = new Date();
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    for (let i = 0; i < 6; i++) {
        list.push(format(addMonths(start, i), 'yyyy-MM'));
    }
    return list;
  }, []);

  // Helper functions
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


  React.useEffect(() => {
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
            amount: item.stock_final
          }));
          setStockData(mappedStock);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching insumos stock', err);
        setLoading(false);
      });

    return () => { unsubGoals(); unsubInsumos(); unsubEtiquetas(); unsubSeparated(); unsubTransits(); };
  }, [planningMonths]);

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
            // 1. Insumo mappings
            if (insumoMappings[itemName]) allCodes.push(...String(insumoMappings[itemName]).split(',').map(c => c.trim().toLowerCase()));
            
            // 2. Etiquetas
            if (itemName.startsWith('Etiqueta ')) {
                const parts = itemName.replace('Etiqueta ', '').replace('cc', '').split(' / ');
                if (parts.length === 3) {
                    const key = `${parts[0]}-${parts[1]}-${parts[2]}`;
                    if (etiquetasMappings[key]) allCodes.push(...String(etiquetasMappings[key]).split(',').map(c => c.trim().toLowerCase()));
                }
            }

            // 3. Built-in configs
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
                    return acc + (s.amount || s.STOCK || 0);
                }
                return acc; 
            }
            
            // Fallback to name matching
            const stockName = (s.insumo || s.NAME || '');
            const hasNameMatch = item.originalNames.some(itemName => {
                const lowerItem = normalize(itemName);
                const normStockName = normalize(stockName);
                return normStockName.includes(lowerItem) || lowerItem.includes(normStockName);
            });
            
            if (hasNameMatch) {
                if (s.codigo) dynamicallyMatchedCodes.push(String(s.codigo).trim().toLowerCase());
                return acc + (s.amount || s.STOCK || 0);
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

        const stockEvolution = [initialStock];
        let currentStock = initialStock;
        let stockoutMonthIndex = -1;
        
        const now = new Date();
        const currentYearMonth = format(now, 'yyyy-MM');
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysRemaining = Math.max(0, daysInMonth - now.getDate() + 1);
        const fractionRemaining = Math.min(1, daysRemaining / daysInMonth);

        planningMonths.forEach((m, i) => {
            let req = item.monthlyReq[m];
            if (m === currentYearMonth) {
                req = req * fractionRemaining;
            }
            currentStock -= req;
            stockEvolution.push(currentStock);
            if (currentStock < 0 && stockoutMonthIndex === -1) stockoutMonthIndex = i;
        });

        let etaDate = null;
        if (stockoutMonthIndex !== -1) {
            const m = planningMonths[stockoutMonthIndex];
            const stockAtStartOfMonth = stockEvolution[stockoutMonthIndex];
            const consumedInMonth = item.monthlyReq[m] || 1;
            const daysInMonth = new Date(parseISO(`${m}-01`).getFullYear(), parseISO(`${m}-01`).getMonth() + 1, 0).getDate();
            const dailyRate = consumedInMonth / daysInMonth;
            
            if (m === currentYearMonth) {
                // Stockout happens in current month, calculate from today
                const daysToStockout = Math.max(0, stockAtStartOfMonth / dailyRate);
                etaDate = addDays(now, daysToStockout);
            } else {
                // Stockout happens in future month, calculate from start of that month
                const daysToStockout = Math.max(0, stockAtStartOfMonth / dailyRate);
                etaDate = addDays(startOfMonth(parseISO(`${m}-01`)), daysToStockout);
            }
        }

        return { ...item, initialStock, stockEvolution, stockoutMonthIndex, etaDate };
    });

    return { projection: projectionResults.sort((a,b) => (a.stockoutMonthIndex === -1 ? 1 : b.stockoutMonthIndex === -1 ? -1 : a.stockoutMonthIndex - b.stockoutMonthIndex)), items: items };
  }, [config, goals, planningMonths, stockData, findPreformaForProduct, findTermoForProduct, findStretchForProduct, findTapaForProduct, getPackingCategory, insumoMappings, etiquetasMappings]);

  const handleSort = (field: string) => {
    if (sortConfig.field === field) setSortConfig({ field, asc: !sortConfig.asc });
    else setSortConfig({ field, asc: true });
  };

  const handleSortConsumo = (field: string) => {
    if (sortConfigConsumo.field === field) setSortConfigConsumo({ field, asc: !sortConfigConsumo.asc });
    else setSortConfigConsumo({ field, asc: true });
  };

  const sortedProjection = useMemo(() => {
    if (!combinedData?.projection) return [];
    return [...combinedData.projection].sort((a, b) => {
        let valA, valB;
        if (sortConfig.field === 'name') {
            valA = a.name; valB = b.name;
        } else if (sortConfig.field === 'initialStock') {
            valA = a.initialStock; valB = b.initialStock;
        } else if (sortConfig.field === 'etaDate') {
            valA = a.etaDate ? a.etaDate.getTime() : Infinity;
            valB = b.etaDate ? b.etaDate.getTime() : Infinity;
        } else if (sortConfig.field.startsWith('month_')) {
            const idx = parseInt(sortConfig.field.split('_')[1]);
            valA = a.stockEvolution[idx];
            valB = b.stockEvolution[idx];
        }

        if (valA < valB) return sortConfig.asc ? -1 : 1;
        if (valA > valB) return sortConfig.asc ? 1 : -1;
        return 0;
    });
  }, [combinedData, sortConfig]);

  const sortedConsumo = useMemo(() => {
    if (!combinedData?.items) return [];
    return [...combinedData.items].sort((a, b) => {
        let valA, valB;
        if (sortConfigConsumo.field === 'name') {
            valA = a.name; valB = b.name;
        } else if (sortConfigConsumo.field.startsWith('month_')) {
            const m = sortConfigConsumo.field.split('_')[1];
            valA = a.monthlyReq[m] || 0;
            valB = b.monthlyReq[m] || 0;
        }

        if (valA < valB) return sortConfigConsumo.asc ? -1 : 1;
        if (valA > valB) return sortConfigConsumo.asc ? 1 : -1;
        return 0;
    });
  }, [combinedData, sortConfigConsumo]);

  if (loading) return <div className="flex justify-center p-12 animate-pulse text-blue-600">Cargando datos...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-2xl font-black text-gray-900 tracking-tight">Gestión y Proyecciones de Insumos</h2>
        <div className="flex items-center justify-between mt-4">
            <div className="flex gap-2">
                {(['proyeccion', 'consumo'] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-amber-600 text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {tab === 'proyeccion' ? 'Cobertura' : 'Consumo Mensual'}
                    </button>
                ))}
            </div>
            <button
                onClick={() => setShowSeparatedModal(true)}
                className="px-4 py-2 rounded-lg text-sm font-black uppercase tracking-widest bg-red-50 text-red-700 hover:bg-red-100 transition-colors border border-red-200"
            >
                Artículos Separados
            </button>
        </div>
      </div>

      {activeTab === 'proyeccion' ? (
        <div className="space-y-6">
            {Object.keys(combinedData.items.reduce((acc, i) => { if(!acc[i.category]) acc[i.category] = []; acc[i.category].push(i); return acc; }, {} as Record<string, any[]>)).map(cat => (
                <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <h3 className="text-lg font-black text-amber-900 p-6 pb-0">{cat}</h3>
                    <table className="w-full text-left">
                    <thead className="bg-gray-100">
                        <tr>
                        <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest border-r cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort('name')}>
                            Insumo {sortConfig.field === 'name' ? (sortConfig.asc ? '▲' : '▼') : ''}
                        </th>
                        <th className="px-6 py-4 text-xs font-black text-gray-600 uppercase tracking-widest text-right cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort('initialStock')}>
                            Inv. Hoy {sortConfig.field === 'initialStock' ? (sortConfig.asc ? '▲' : '▼') : ''}
                        </th>
                        <th className="px-6 py-4 text-xs font-black text-gray-600 uppercase tracking-widest text-right cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort('etaDate')}>
                            ETA Quiebre {sortConfig.field === 'etaDate' ? (sortConfig.asc ? '▲' : '▼') : ''}
                        </th>
                        {planningMonths.map((m, i) => (
                            <th key={m} className="px-2 py-4 text-[10px] font-black text-blue-700 uppercase tracking-widest text-center cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort(`month_${i+1}`)}>
                                {format(parseISO(`${m}-01`), 'MMM yy', { locale: es })} {sortConfig.field === `month_${i+1}` ? (sortConfig.asc ? '▲' : '▼') : ''}
                            </th>
                        ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedProjection.filter(item => item.category === cat).map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-bold text-gray-900 border-r text-xs">{item.name}</td>
                            <td className="px-6 py-4 text-sm font-black text-gray-800 text-right">{Intl.NumberFormat('es-AR').format(Math.round(item.initialStock))}</td>
                            <td className="px-6 py-4 text-sm text-right">
                                {item.etaDate && !isNaN(item.etaDate.getTime()) ? (() => {
                                    const diff = differenceInDays(item.etaDate, new Date());
                                    let textColor = 'text-gray-700';
                                    if (diff < 15) textColor = 'text-red-700';
                                    else if (diff <= 30) textColor = 'text-orange-500';
                                    else if (diff <= 45) textColor = 'text-yellow-500';
                                    return <span className={`${textColor} font-black`}>{format(item.etaDate, 'd MMM', { locale: es })}</span>;
                                })() : item.etaDate ? <span className="text-gray-500 font-black">-</span> : <span className="text-emerald-600 font-black">OK</span>}
                            </td>
                            {planningMonths.map((m, i) => {
                                const val = item.stockEvolution[i + 1];
                                return <td key={m} className={`text-center text-xs font-bold ${val < 0 ? 'bg-red-50 text-red-700' : 'text-gray-600'}`}>{Intl.NumberFormat('es-AR').format(Math.round(val))}</td>
                            })}
                        </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
            ))}
        </div>
      ) : (
        <div className="space-y-6">
            {Object.keys(combinedData.items.reduce((acc, i) => { if(!acc[i.category]) acc[i.category] = []; acc[i.category].push(i); return acc; }, {} as Record<string, any[]>)).map(cat => (
                <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-lg font-black text-amber-900 mb-4">{cat}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead><tr className="text-gray-500 border-b">
                                <th className="p-2 cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSortConsumo('name')}>
                                    INSUMO {sortConfigConsumo.field === 'name' ? (sortConfigConsumo.asc ? '▲' : '▼') : ''}
                                </th>
                                {planningMonths.map(m => (
                                    <th key={m} className="p-2 cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSortConsumo(`month_${m}`)}>
                                        {format(parseISO(`${m}-01`), 'MMM yy', { locale: es }).toUpperCase()} {sortConfigConsumo.field === `month_${m}` ? (sortConfigConsumo.asc ? '▲' : '▼') : ''}
                                    </th>
                                ))}
                            </tr></thead>
                            <tbody>{sortedConsumo.filter(i => i.category === cat).map((item, idx) => (
                                <tr key={idx} className="border-b hover:bg-gray-50">
                                    <td className="p-2 font-bold">{item.name}</td>
                                    {planningMonths.map(m => <td key={m} className="p-2 text-right">{Intl.NumberFormat('es-AR').format(Math.round(item.monthlyReq[m]))}</td>)}
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
      )}

      {showSeparatedModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-800">Artículos Separados</h3>
                <p className="text-xs text-slate-500 font-bold mt-1">Gestión de insumos en cuarentena o no aptos.</p>
              </div>
              <button 
                onClick={() => setShowSeparatedModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-white">
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                  <h4 className="text-sm font-black text-blue-900 mb-3">Agregar artículo separado</h4>
                  <form 
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const select = form.elements.namedItem('insumo') as HTMLSelectElement;
                      const input = form.elements.namedItem('amount') as HTMLInputElement;
                      const insumo = select.value;
                      const amount = parseFloat(input.value);
                      
                      if (insumo && amount > 0) {
                        const newSupplies = { ...separatedSupplies, [insumo]: (separatedSupplies[insumo] || 0) + amount };
                        await setDoc(doc(db, 'config', 'separated_supplies'), newSupplies);
                        form.reset();
                      }
                    }}
                    className="flex flex-col sm:flex-row gap-3"
                  >
                    <select 
                      name="insumo"
                      required
                      className="flex-1 rounded-lg border-gray-300 text-sm font-bold shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2.5"
                    >
                      <option value="">Seleccionar insumo...</option>
                      {[...combinedData.items].sort((a, b) => a.name.localeCompare(b.name)).map(i => (
                        <option key={i.name} value={i.name}>{i.name}</option>
                      ))}
                    </select>
                    <input 
                      type="number" 
                      name="amount"
                      required
                      min="0.01"
                      step="0.01"
                      placeholder="Cantidad"
                      className="w-full sm:w-32 rounded-lg border-gray-300 text-sm font-bold shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2.5 text-right"
                    />
                    <button 
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-black flex items-center justify-center gap-2 transition-colors shadow-sm"
                    >
                      <Plus className="w-4 h-4" /> Agregar
                    </button>
                  </form>
                </div>

                <div>
                  <h4 className="text-sm font-black text-slate-800 mb-3 uppercase tracking-widest border-b border-slate-100 pb-2">Artículos actualmente separados</h4>
                  {Object.entries(separatedSupplies).length === 0 ? (
                    <div className="text-center p-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      <p className="text-slate-500 font-bold text-sm">No hay artículos separados actualmente.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="p-3 font-black text-slate-600 uppercase tracking-widest text-xs">Insumo</th>
                            <th className="p-3 font-black text-slate-600 uppercase tracking-widest text-xs text-right">Cantidad</th>
                            <th className="p-3 font-black text-slate-600 uppercase tracking-widest text-xs text-center w-20">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(separatedSupplies).sort((a, b) => a[0].localeCompare(b[0])).map(([name, amount]) => (
                            <tr key={name} className="hover:bg-slate-50 transition-colors">
                              <td className="p-3 font-bold text-slate-800">{name}</td>
                              <td className="p-3 font-black text-slate-700 text-right font-mono">{Intl.NumberFormat('es-AR').format(amount as number)}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={async () => {
                                    const newSupplies = { ...separatedSupplies };
                                    delete newSupplies[name];
                                    await setDoc(doc(db, 'config', 'separated_supplies'), newSupplies);
                                  }}
                                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Remover"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
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
            
            <div className="p-4 border-t border-gray-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => setShowSeparatedModal(false)}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-black rounded-xl transition-colors shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
