import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SQL_PRODUCT_MAPPING, SABORES, SABORES_SIN_JARABE, MARCAS } from '../constants';
import { Save, RefreshCw, CheckCircle2, AlertCircle, Search, Package, Droplet, FlaskConical } from 'lucide-react';
import { useAppConfig } from '../hooks/useAppConfig';

export function SQLMappingEditor() {
  const { availableBrands, availableFlavors, availableSizes, getFilteredFlavors, config } = useAppConfig();
  const [productMappings, setProductMappings] = useState<Record<string, string>>({});
  const [syrupMappings, setSyrupMappings] = useState<Record<string, string>>({});
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetaMappings, setEtiquetaMappings] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'products' | 'syrups' | 'insumos' | 'etiquetas'>('products');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const productMappingRef = doc(db, 'config', 'sql_mappings');
    const syrupMappingRef = doc(db, 'config', 'sql_syrup_mappings');
    const insumoMappingRef = doc(db, 'config', 'sql_insumo_mappings');
    const etiquetaMappingRef = doc(db, 'config', 'sql_etiquetas_mappings');
    
    let isProductReady = false;
    let isSyrupReady = false;
    let isInsumoReady = false;
    let isEtiquetaReady = false;

    const checkReady = () => {
      if (isProductReady && isSyrupReady && isInsumoReady && isEtiquetaReady) setLoading(false);
    };

    const unsubscribeProducts = onSnapshot(productMappingRef, (docSnap) => {
      if (docSnap.exists()) {
        setProductMappings(docSnap.data() as Record<string, string>);
      } else {
        setProductMappings(SQL_PRODUCT_MAPPING);
      }
      isProductReady = true;
      checkReady();
    });

    const unsubscribeSyrups = onSnapshot(syrupMappingRef, (docSnap) => {
      if (docSnap.exists()) {
        setSyrupMappings(docSnap.data() as Record<string, string>);
      } else {
        setSyrupMappings({});
      }
      isSyrupReady = true;
      checkReady();
    });

    const unsubscribeInsumos = onSnapshot(insumoMappingRef, (docSnap) => {
      if (docSnap.exists()) {
        setInsumoMappings(docSnap.data() as Record<string, string>);
      } else {
        setInsumoMappings({});
      }
      isInsumoReady = true;
      checkReady();
    });

    const unsubscribeEtiquetas = onSnapshot(etiquetaMappingRef, (docSnap) => {
      if (docSnap.exists()) {
        setEtiquetaMappings(docSnap.data() as Record<string, string>);
      } else {
        setEtiquetaMappings({});
      }
      isEtiquetaReady = true;
      checkReady();
    });

    return () => {
      unsubscribeProducts();
      unsubscribeSyrups();
      unsubscribeInsumos();
      unsubscribeEtiquetas();
    }
  }, []);

  const handleUpdateProductMapping = (key: string, value: string) => {
    setProductMappings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleUpdateSyrupMapping = (key: string, value: string) => {
    setSyrupMappings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleUpdateInsumoMapping = (key: string, value: string) => {
    setInsumoMappings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleUpdateEtiquetaMapping = (key: string, value: string) => {
    setEtiquetaMappings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const saveMappings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (activeTab === 'products') {
        const cleanedProductMappings: Record<string, string> = {};
        generatedProductKeys.forEach(key => {
          if (productMappings[key] !== undefined) {
            cleanedProductMappings[key] = productMappings[key];
          }
        });
        Object.entries(productMappings).forEach(([key, val]) => {
          if (val && !cleanedProductMappings[key]) {
            cleanedProductMappings[key] = val as string;
          }
        });
        await setDoc(doc(db, 'config', 'sql_mappings'), cleanedProductMappings);
        setProductMappings(cleanedProductMappings);
      } else if (activeTab === 'syrups') {
        const cleanedSyrupMappings: Record<string, string> = {};
        generatedSyrupKeys.forEach(key => {
          if (syrupMappings[key] !== undefined) {
            cleanedSyrupMappings[key] = syrupMappings[key];
          }
        });
        Object.entries(syrupMappings).forEach(([key, val]) => {
          if (val && !cleanedSyrupMappings[key]) {
            cleanedSyrupMappings[key] = val as string;
          }
        });
        await setDoc(doc(db, 'config', 'sql_syrup_mappings'), cleanedSyrupMappings);
        setSyrupMappings(cleanedSyrupMappings);
      } else if (activeTab === 'etiquetas') {
        const cleanedEtiquetaMappings: Record<string, string> = {};
        generatedProductKeys.forEach(key => {
          if (etiquetaMappings[key] !== undefined) {
            cleanedEtiquetaMappings[key] = etiquetaMappings[key];
          }
        });
        Object.entries(etiquetaMappings).forEach(([key, val]) => {
          if (val && !cleanedEtiquetaMappings[key]) {
            cleanedEtiquetaMappings[key] = val as string;
          }
        });
        await setDoc(doc(db, 'config', 'sql_etiquetas_mappings'), cleanedEtiquetaMappings);
        setEtiquetaMappings(cleanedEtiquetaMappings);
      } else {
        const cleanedInsumoMappings: Record<string, string> = {};
        generatedInsumoKeys.forEach(key => {
          if (insumoMappings[key] !== undefined) {
            cleanedInsumoMappings[key] = insumoMappings[key];
          }
        });
        Object.entries(insumoMappings).forEach(([key, val]) => {
          if (val && !cleanedInsumoMappings[key]) {
            cleanedInsumoMappings[key] = val as string;
          }
        });
        await setDoc(doc(db, 'config', 'sql_insumo_mappings'), cleanedInsumoMappings);
        setInsumoMappings(cleanedInsumoMappings);
      }
      setMessage({ type: 'success', text: `Mapeos de ${activeTab === 'products' ? 'productos' : activeTab === 'syrups' ? 'jarabes' : activeTab === 'etiquetas' ? 'etiquetas' : 'insumos'} guardados.` });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("Error saving mappings:", error);
      setMessage({ type: 'error', text: 'Error al guardar los mapeos' });
    } finally {
      setSaving(false);
    }
  };

  const generatedProductKeys = useMemo(() => {
    const keys: string[] = [];
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
          if (config?.enabledFlavors?.[flavor] !== false) {
            keys.push(`${brand}-${flavor}-${size}`);
          }
        });
      });
    });
    return keys;
  }, [availableBrands, availableSizes, availableFlavors, config]);

  const generatedSyrupKeys = useMemo(() => {
    const keys: string[] = [];
    availableBrands.forEach(brand => {
      // Usar todas las combinaciones de sabores para la marca según brandFlavorCombinations o fallback general
      const brandCombos = config?.brandFlavorCombinations?.[brand] || availableFlavors || SABORES;
      brandCombos.forEach(flavor => {
        if (!(config?.saboresSinJarabe || SABORES_SIN_JARABE).includes(flavor)) {
          keys.push(`${brand}-${flavor}`);
        }
      });
    });
    return keys;
  }, [availableBrands, availableFlavors, config?.brandFlavorCombinations, config?.saboresSinJarabe]);

  const generatedInsumoKeys = useMemo(() => {
    return config?.insumos || [];
  }, [config?.insumos]);

  if (loading || !config) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  const activeMappings = activeTab === 'products' ? productMappings : activeTab === 'syrups' ? syrupMappings : activeTab === 'etiquetas' ? etiquetaMappings : insumoMappings;
  
  // Only show keys that are currently active in the configuration
  const sourceKeysSet = new Set<string>(activeTab === 'products' || activeTab === 'etiquetas' ? generatedProductKeys : activeTab === 'syrups' ? generatedSyrupKeys : generatedInsumoKeys);
  const sourceKeys = Array.from(sourceKeysSet);

  const filteredKeys = sourceKeys.filter(key => 
    key.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (activeMappings[key] || '').includes(searchTerm)
  ).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Mapeo de Códigos SQL</h3>
          <p className="text-sm text-gray-500">Asocie productos y jarabes con sus códigos correspondientes en SQL Server.</p>
        </div>
        <button
          onClick={saveMappings}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar Mapeos
        </button>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => { setActiveTab('products'); setSearchTerm(''); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'products' 
              ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Package className="w-4 h-4" />
          Productos Terminados
        </button>
        <button
          onClick={() => { setActiveTab('etiquetas'); setSearchTerm(''); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'etiquetas' 
              ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Package className="w-4 h-4" />
          Etiquetas
        </button>
        <button
          onClick={() => { setActiveTab('syrups'); setSearchTerm(''); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'syrups' 
              ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Droplet className="w-4 h-4" />
          Jarabes
        </button>
        <button
          onClick={() => { setActiveTab('insumos'); setSearchTerm(''); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'insumos' 
              ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <FlaskConical className="w-4 h-4" />
          Insumos
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar producto o código..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredKeys.map((key) => (
          <div key={key} className="bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm hover:border-blue-200 transition-colors">
            <label className="block text-xs font-bold text-gray-600 uppercase mb-2">{key}</label>
            <input
              type="text"
              value={activeMappings[key] || ''}
              onChange={(e) => activeTab === 'products' ? handleUpdateProductMapping(key, e.target.value) : activeTab === 'syrups' ? handleUpdateSyrupMapping(key, e.target.value) : activeTab === 'etiquetas' ? handleUpdateEtiquetaMapping(key, e.target.value) : handleUpdateInsumoMapping(key, e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              placeholder="Código SQL..."
            />
          </div>
        ))}
      </div>
    </div>
  );
}
