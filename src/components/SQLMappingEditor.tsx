import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SQL_PRODUCT_MAPPING, SABORES, SABORES_SIN_JARABE, MARCAS } from '../constants';
import { Save, RefreshCw, CheckCircle2, AlertCircle, Search, Package, Droplet } from 'lucide-react';
import { useAppConfig } from '../hooks/useAppConfig';

export function SQLMappingEditor() {
  const { availableBrands, availableFlavors, getFilteredFlavors } = useAppConfig();
  const [productMappings, setProductMappings] = useState<Record<string, string>>({});
  const [syrupMappings, setSyrupMappings] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'products' | 'syrups'>('products');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const productMappingRef = doc(db, 'config', 'sql_mappings');
    const syrupMappingRef = doc(db, 'config', 'sql_syrup_mappings');
    
    let isProductReady = false;
    let isSyrupReady = false;

    const checkReady = () => {
      if (isProductReady && isSyrupReady) setLoading(false);
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

    return () => {
      unsubscribeProducts();
      unsubscribeSyrups();
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

  const saveMappings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (activeTab === 'products') {
        await setDoc(doc(db, 'config', 'sql_mappings'), productMappings);
      } else {
        await setDoc(doc(db, 'config', 'sql_syrup_mappings'), syrupMappings);
      }
      setMessage({ type: 'success', text: `Mapeos de ${activeTab === 'products' ? 'productos' : 'jarabes'} guardados.` });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("Error saving mappings:", error);
      setMessage({ type: 'error', text: 'Error al guardar los mapeos' });
    } finally {
      setSaving(false);
    }
  };

  const generatedSyrupKeys = useMemo(() => {
    const keys: string[] = [];
    availableBrands.forEach(brand => {
      const allowedFlavors = getFilteredFlavors(brand);
      allowedFlavors.forEach(flavor => {
        if (!SABORES_SIN_JARABE.includes(flavor)) {
          keys.push(`${brand}-${flavor}`);
        }
      });
    });
    return keys;
  }, [availableBrands, getFilteredFlavors]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  const activeMappings = activeTab === 'products' ? productMappings : syrupMappings;
  const sourceKeys = activeTab === 'products' ? Object.keys(activeMappings) : generatedSyrupKeys;

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
              onChange={(e) => activeTab === 'products' ? handleUpdateProductMapping(key, e.target.value) : handleUpdateSyrupMapping(key, e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              placeholder="Código SQL..."
            />
          </div>
        ))}
      </div>
    </div>
  );
}
