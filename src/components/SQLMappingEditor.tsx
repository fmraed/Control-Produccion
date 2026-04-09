import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SQL_PRODUCT_MAPPING } from '../constants';
import { Save, RefreshCw, CheckCircle2, AlertCircle, Search } from 'lucide-react';

export function SQLMappingEditor() {
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const mappingRef = doc(db, 'config', 'sql_mappings');
    
    const unsubscribe = onSnapshot(mappingRef, (docSnap) => {
      if (docSnap.exists()) {
        setMappings(docSnap.data() as Record<string, string>);
      } else {
        // Initialize with default mappings from constants
        setMappings(SQL_PRODUCT_MAPPING);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleUpdateMapping = (key: string, value: string) => {
    setMappings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const saveMappings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await setDoc(doc(db, 'config', 'sql_mappings'), mappings);
      setMessage({ type: 'success', text: 'Mapeos guardados correctamente' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("Error saving mappings:", error);
      setMessage({ type: 'error', text: 'Error al guardar los mapeos' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  const filteredKeys = Object.keys(mappings).filter(key => 
    key.toLowerCase().includes(searchTerm.toLowerCase()) || 
    mappings[key].includes(searchTerm)
  ).sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Mapeo de Códigos SQL</h3>
          <p className="text-sm text-gray-500">Asocie cada producto de la app con su código correspondiente en SQL Server.</p>
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
          <div key={key} className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{key}</label>
            <input
              type="text"
              value={mappings[key]}
              onChange={(e) => handleUpdateMapping(key, e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              placeholder="Código SQL..."
            />
          </div>
        ))}
      </div>
    </div>
  );
}
