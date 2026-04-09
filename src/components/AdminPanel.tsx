import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SABORES, TAMANOS, LINEAS, VELOCIDAD_MATRIX, MARCAS, SUPERVISORES, PACKS_POR_PALETA, BOTELLAS_POR_PACK } from '../constants';
import { Settings, Save, CheckCircle2, XCircle, AlertCircle, Plus, Trash2, Users, Database, FlaskConical, Link2 } from 'lucide-react';
import { SQLIntegration } from './SQLIntegration';
import { SQLMappingEditor } from './SQLMappingEditor';

interface AppConfig {
  flavors: string[];
  enabledFlavors: Record<string, boolean>;
  sizes: number[];
  enabledSizes: Record<number, boolean>;
  brands: string[];
  enabledBrands: Record<string, boolean>;
  lines: string[];
  enabledLines: Record<string, boolean>;
  supervisors: string[];
  enabledSupervisors: Record<string, boolean>;
  chemists: string[];
  enabledChemists: Record<string, boolean>;
  brandFlavorCombinations: Record<string, string[]>;
  lineSizeCombinations: Record<string, number[]>;
  velocidadMatrix: Record<string, Record<number, number>>;
  packsPorPaleta: Record<number, number>;
  botellasPorPack: Record<number, number>;
}

export function AdminPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'sql' | 'mappings'>('config');
  
  // New item inputs
  const [newFlavor, setNewFlavor] = useState('');
  const [newSize, setNewSize] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newLine, setNewLine] = useState('');
  const [newSupervisor, setNewSupervisor] = useState('');
  const [newChemist, setNewChemist] = useState('');
  
  // Deletion confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'brand' | 'line' | 'flavor' | 'size' | 'supervisor' | 'chemist', id: string | number, step: number } | null>(null);

  useEffect(() => {
    const configRef = doc(db, 'config', 'production');
    
    const unsubscribe = onSnapshot(configRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as any;
        // Merge with defaults to ensure all fields exist even if the document is old
        const mergedConfig: AppConfig = {
          flavors: Array.isArray(data.flavors) ? data.flavors : SABORES,
          enabledFlavors: data.enabledFlavors || {},
          sizes: Array.isArray(data.sizes) ? data.sizes : TAMANOS,
          enabledSizes: data.enabledSizes || {},
          brands: Array.isArray(data.brands) ? data.brands : MARCAS,
          enabledBrands: data.enabledBrands || {},
          lines: Array.isArray(data.lines) ? data.lines : LINEAS,
          enabledLines: data.enabledLines || {},
          supervisors: Array.isArray(data.supervisors) ? data.supervisors : SUPERVISORES,
          enabledSupervisors: data.enabledSupervisors || {},
          chemists: Array.isArray(data.chemists) ? data.chemists : [],
          enabledChemists: data.enabledChemists || {},
          brandFlavorCombinations: data.brandFlavorCombinations || {},
          lineSizeCombinations: data.lineSizeCombinations || {},
          velocidadMatrix: data.velocidadMatrix || VELOCIDAD_MATRIX,
          packsPorPaleta: data.packsPorPaleta || PACKS_POR_PALETA,
          botellasPorPack: data.botellasPorPack || BOTELLAS_POR_PACK
        };
        setConfig(mergedConfig);
      } else {
        // Initialize with defaults from constants
        const initialFlavors: Record<string, boolean> = {};
        SABORES.forEach(s => initialFlavors[s] = true);
        
        const initialSizes: Record<number, boolean> = {};
        TAMANOS.forEach(t => initialSizes[t] = true);

        const initialBrands: Record<string, boolean> = {};
        MARCAS.forEach(m => initialBrands[m] = true);

        const initialLines: Record<string, boolean> = {};
        LINEAS.forEach(l => initialLines[l] = true);

        const initialSupervisors: Record<string, boolean> = {};
        SUPERVISORES.forEach(s => initialSupervisors[s] = true);

        const initialChemists: Record<string, boolean> = {};
        
        const initialLineCombinations: Record<string, number[]> = {};
        LINEAS.forEach(l => {
          initialLineCombinations[l] = Object.keys(VELOCIDAD_MATRIX[l] || {}).map(Number);
        });

        const initialBrandCombinations: Record<string, string[]> = {};
        MARCAS.forEach(m => {
          initialBrandCombinations[m] = [...SABORES];
        });

        const defaultConfig: AppConfig = {
          flavors: SABORES,
          enabledFlavors: initialFlavors,
          sizes: TAMANOS,
          enabledSizes: initialSizes,
          brands: MARCAS,
          enabledBrands: initialBrands,
          lines: LINEAS,
          enabledLines: initialLines,
          supervisors: SUPERVISORES,
          enabledSupervisors: initialSupervisors,
          chemists: [],
          enabledChemists: initialChemists,
          brandFlavorCombinations: initialBrandCombinations,
          lineSizeCombinations: initialLineCombinations,
          velocidadMatrix: VELOCIDAD_MATRIX,
          packsPorPaleta: PACKS_POR_PALETA,
          botellasPorPack: BOTELLAS_POR_PACK
        };
        setConfig(defaultConfig);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error loading config:", error);
      setMessage({ type: 'error', text: 'Error de permisos: No tienes acceso a la configuración.' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAddFlavor = () => {
    if (!config || !newFlavor.trim()) return;
    if (config.flavors.includes(newFlavor.trim())) return;
    
    setConfig({
      ...config,
      flavors: [...config.flavors, newFlavor.trim()],
      enabledFlavors: { ...config.enabledFlavors, [newFlavor.trim()]: true }
    });
    setNewFlavor('');
  };

  const handleAddSize = () => {
    if (!config || !newSize.trim()) return;
    const sizeNum = Number(newSize.trim());
    if (isNaN(sizeNum) || config.sizes.includes(sizeNum)) return;
    
    setConfig({
      ...config,
      sizes: [...config.sizes, sizeNum].sort((a, b) => a - b),
      enabledSizes: { ...config.enabledSizes, [sizeNum]: true }
    });
    setNewSize('');
  };

  const handleAddBrand = () => {
    if (!config || !newBrand.trim()) return;
    if (config.brands.includes(newBrand.trim())) return;
    
    setConfig({
      ...config,
      brands: [...config.brands, newBrand.trim()],
      enabledBrands: { ...config.enabledBrands, [newBrand.trim()]: true },
      brandFlavorCombinations: { ...config.brandFlavorCombinations, [newBrand.trim()]: [...config.flavors] }
    });
    setNewBrand('');
  };

  const handleAddLine = () => {
    if (!config || !newLine.trim()) return;
    if (config.lines.includes(newLine.trim())) return;
    
    setConfig({
      ...config,
      lines: [...config.lines, newLine.trim()],
      enabledLines: { ...config.enabledLines, [newLine.trim()]: true },
      lineSizeCombinations: { ...config.lineSizeCombinations, [newLine.trim()]: [...config.sizes] }
    });
    setNewLine('');
  };

  const handleAddSupervisor = () => {
    if (!config || !newSupervisor.trim()) return;
    if (config.supervisors.includes(newSupervisor.trim())) return;
    
    setConfig({
      ...config,
      supervisors: [...config.supervisors, newSupervisor.trim()],
      enabledSupervisors: { ...config.enabledSupervisors, [newSupervisor.trim()]: true }
    });
    setNewSupervisor('');
  };

  const handleAddChemist = () => {
    if (!config || !newChemist.trim()) return;
    if (config.chemists.includes(newChemist.trim())) return;
    
    setConfig({
      ...config,
      chemists: [...config.chemists, newChemist.trim()],
      enabledChemists: { ...config.enabledChemists, [newChemist.trim()]: true }
    });
    setNewChemist('');
  };

  const handleDeleteBrand = (brand: string) => {
    if (!config) return;
    const newBrands = config.brands.filter(b => b !== brand);
    const newEnabledBrands = { ...config.enabledBrands };
    delete newEnabledBrands[brand];
    const newCombinations = { ...config.brandFlavorCombinations };
    delete newCombinations[brand];

    setConfig({
      ...config,
      brands: newBrands,
      enabledBrands: newEnabledBrands,
      brandFlavorCombinations: newCombinations
    });
    setDeleteConfirm(null);
  };

  const handleDeleteLine = (line: string) => {
    if (!config) return;
    const newLines = config.lines.filter(l => l !== line);
    const newEnabledLines = { ...config.enabledLines };
    delete newEnabledLines[line];
    const newCombinations = { ...config.lineSizeCombinations };
    delete newCombinations[line];

    setConfig({
      ...config,
      lines: newLines,
      enabledLines: newEnabledLines,
      lineSizeCombinations: newCombinations
    });
    setDeleteConfirm(null);
  };

  const handleDeleteFlavor = (flavor: string) => {
    if (!config) return;
    const newFlavors = config.flavors.filter(f => f !== flavor);
    const newEnabledFlavors = { ...config.enabledFlavors };
    delete newEnabledFlavors[flavor];
    
    // Also remove from all brand combinations
    const newBrandCombinations = { ...config.brandFlavorCombinations };
    Object.keys(newBrandCombinations).forEach(brand => {
      newBrandCombinations[brand] = newBrandCombinations[brand].filter(f => f !== flavor);
    });

    setConfig({
      ...config,
      flavors: newFlavors,
      enabledFlavors: newEnabledFlavors,
      brandFlavorCombinations: newBrandCombinations
    });
    setDeleteConfirm(null);
  };

  const handleDeleteSize = (size: number) => {
    if (!config) return;
    const newSizes = config.sizes.filter(s => s !== size);
    const newEnabledSizes = { ...config.enabledSizes };
    delete newEnabledSizes[size];

    // Also remove from all line combinations
    const newLineCombinations = { ...config.lineSizeCombinations };
    Object.keys(newLineCombinations).forEach(line => {
      newLineCombinations[line] = newLineCombinations[line].filter(s => s !== size);
    });

    setConfig({
      ...config,
      sizes: newSizes,
      enabledSizes: newEnabledSizes,
      lineSizeCombinations: newLineCombinations
    });
    setDeleteConfirm(null);
  };

  const handleDeleteSupervisor = (supervisor: string) => {
    if (!config) return;
    const newSupervisors = config.supervisors.filter(s => s !== supervisor);
    const newEnabledSupervisors = { ...config.enabledSupervisors };
    delete newEnabledSupervisors[supervisor];

    setConfig({
      ...config,
      supervisors: newSupervisors,
      enabledSupervisors: newEnabledSupervisors
    });
    setDeleteConfirm(null);
  };

  const handleDeleteChemist = (chemist: string) => {
    if (!config) return;
    const newChemists = config.chemists.filter(c => c !== chemist);
    const newEnabledChemists = { ...config.enabledChemists };
    delete newEnabledChemists[chemist];

    setConfig({
      ...config,
      chemists: newChemists,
      enabledChemists: newEnabledChemists
    });
    setDeleteConfirm(null);
  };

  const handleToggleFlavor = (flavor: string) => {
    if (!config) return;
    const currentStatus = config.enabledFlavors?.[flavor] !== false;
    setConfig({
      ...config,
      enabledFlavors: {
        ...config.enabledFlavors,
        [flavor]: !currentStatus
      }
    });
  };

  const handleToggleSize = (size: number) => {
    if (!config) return;
    const currentStatus = config.enabledSizes?.[size] !== false;
    setConfig({
      ...config,
      enabledSizes: {
        ...config.enabledSizes,
        [size]: !currentStatus
      }
    });
  };

  const handleToggleBrand = (brand: string) => {
    if (!config) return;
    const currentStatus = config.enabledBrands?.[brand] !== false;
    setConfig({
      ...config,
      enabledBrands: {
        ...config.enabledBrands,
        [brand]: !currentStatus
      }
    });
  };

  const handleToggleLine = (line: string) => {
    if (!config) return;
    const currentStatus = config.enabledLines?.[line] !== false;
    setConfig({
      ...config,
      enabledLines: {
        ...config.enabledLines,
        [line]: !currentStatus
      }
    });
  };

  const handleToggleSupervisor = (supervisor: string) => {
    if (!config) return;
    const currentStatus = config.enabledSupervisors?.[supervisor] !== false;
    setConfig({
      ...config,
      enabledSupervisors: {
        ...config.enabledSupervisors,
        [supervisor]: !currentStatus
      }
    });
  };

  const handleToggleChemist = (chemist: string) => {
    if (!config) return;
    const currentStatus = config.enabledChemists?.[chemist] !== false;
    setConfig({
      ...config,
      enabledChemists: {
        ...config.enabledChemists,
        [chemist]: !currentStatus
      }
    });
  };

  const handleToggleLineCombination = (line: string, size: number) => {
    if (!config) return;
    const currentCombos = config.lineSizeCombinations[line] || [];
    let newCombos;
    if (currentCombos.includes(size)) {
      newCombos = currentCombos.filter(s => s !== size);
    } else {
      newCombos = [...currentCombos, size];
    }
    
    setConfig({
      ...config,
      lineSizeCombinations: {
        ...config.lineSizeCombinations,
        [line]: newCombos
      }
    });
  };

  const handleToggleBrandCombination = (brand: string, flavor: string) => {
    if (!config) return;
    const currentCombos = config.brandFlavorCombinations[brand] || [];
    let newCombos;
    if (currentCombos.includes(flavor)) {
      newCombos = currentCombos.filter(f => f !== flavor);
    } else {
      newCombos = [...currentCombos, flavor];
    }
    
    setConfig({
      ...config,
      brandFlavorCombinations: {
        ...config.brandFlavorCombinations,
        [brand]: newCombos
      }
    });
  };

  const handleUpdateVelocidad = (line: string, size: number, speed: string) => {
    if (!config) return;
    const numSpeed = parseInt(speed, 10);
    if (isNaN(numSpeed) || numSpeed < 0) return;

    setConfig({
      ...config,
      velocidadMatrix: {
        ...config.velocidadMatrix,
        [line]: {
          ...(config.velocidadMatrix[line] || {}),
          [size]: numSpeed
        }
      }
    });
  };

  const handleUpdatePacksPorPaleta = (size: number, packs: string) => {
    if (!config) return;
    const numPacks = parseInt(packs, 10);
    if (isNaN(numPacks) || numPacks < 0) return;

    setConfig({
      ...config,
      packsPorPaleta: {
        ...config.packsPorPaleta,
        [size]: numPacks
      }
    });
  };

  const handleUpdateBotellasPorPack = (size: number, botellas: string) => {
    if (!config) return;
    const numBotellas = parseInt(botellas, 10);
    if (isNaN(numBotellas) || numBotellas < 0) return;

    setConfig({
      ...config,
      botellasPorPack: {
        ...config.botellasPorPack,
        [size]: numBotellas
      }
    });
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      await setDoc(doc(db, 'config', 'production'), config);
      setMessage({ type: 'success', text: 'Configuración guardada correctamente' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("Error saving config:", error);
      setMessage({ type: 'error', text: 'Error al guardar la configuración' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('config')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'config'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Settings className="w-4 h-4" />
          Configuración General
        </button>
        <button
          onClick={() => setActiveTab('sql')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'sql'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Database className="w-4 h-4" />
          Cruce SQL Server
        </button>
        <button
          onClick={() => setActiveTab('mappings')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'mappings'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Link2 className="w-4 h-4" />
          Mapeo de Códigos
        </button>
      </div>

      {activeTab === 'sql' ? (
        <SQLIntegration />
      ) : activeTab === 'mappings' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <SQLMappingEditor />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Settings className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Configuración de Producción</h2>
          </div>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {saving ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <Save className="w-4 h-4" />}
            Guardar Cambios
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Marcas */}
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Marcas</h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={newBrand} 
                onChange={e => setNewBrand(e.target.value)}
                placeholder="Nueva marca..."
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
              <button 
                onClick={handleAddBrand}
                className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.isArray(config.brands) && config.brands.length > 0 ? (
                config.brands.map(brand => (
                  <div key={brand} className="flex gap-1">
                    <button
                      onClick={() => handleToggleBrand(brand)}
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                        config.enabledBrands?.[brand] !== false
                          ? 'bg-white border-blue-200 text-blue-700 shadow-sm' 
                          : 'bg-gray-100 border-gray-200 text-gray-400 opacity-60'
                      }`}
                    >
                      <span className="font-medium">{brand}</span>
                      {config.enabledBrands?.[brand] !== false ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </button>
                    
                    {deleteConfirm?.type === 'brand' && deleteConfirm.id === brand ? (
                      <button
                        onClick={() => {
                          if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                          else handleDeleteBrand(brand);
                        }}
                        onMouseLeave={() => setDeleteConfirm(null)}
                        className={`px-3 rounded-lg text-xs font-bold transition-colors ${
                          deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                        }`}
                      >
                        {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm({ type: 'brand', id: brand, step: 1 })}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay marcas registradas</p>
              )}
            </div>
          </section>

          {/* Líneas */}
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Líneas</h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={newLine} 
                onChange={e => setNewLine(e.target.value)}
                placeholder="Nueva línea..."
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
              <button 
                onClick={handleAddLine}
                className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.isArray(config.lines) && config.lines.length > 0 ? (
                config.lines.map(line => (
                  <div key={line} className="flex gap-1">
                    <button
                      onClick={() => handleToggleLine(line)}
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                        config.enabledLines?.[line] !== false
                          ? 'bg-white border-blue-200 text-blue-700 shadow-sm' 
                          : 'bg-gray-100 border-gray-200 text-gray-400 opacity-60'
                      }`}
                    >
                      <span className="font-medium">Línea {line}</span>
                      {config.enabledLines?.[line] !== false ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </button>

                    {deleteConfirm?.type === 'line' && deleteConfirm.id === line ? (
                      <button
                        onClick={() => {
                          if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                          else handleDeleteLine(line);
                        }}
                        onMouseLeave={() => setDeleteConfirm(null)}
                        className={`px-3 rounded-lg text-xs font-bold transition-colors ${
                          deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                        }`}
                      >
                        {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm({ type: 'line', id: line, step: 1 })}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay líneas registradas</p>
              )}
            </div>
          </section>

          {/* Sabores */}
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Sabores</h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={newFlavor} 
                onChange={e => setNewFlavor(e.target.value)}
                placeholder="Nuevo sabor..."
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
              <button 
                onClick={handleAddFlavor}
                className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.isArray(config.flavors) && config.flavors.length > 0 ? (
                config.flavors.map(flavor => (
                  <div key={flavor} className="flex gap-1">
                    <button
                      onClick={() => handleToggleFlavor(flavor)}
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                        config.enabledFlavors?.[flavor] !== false
                          ? 'bg-white border-blue-200 text-blue-700 shadow-sm' 
                          : 'bg-gray-100 border-gray-200 text-gray-400 opacity-60'
                      }`}
                    >
                      <span className="font-medium">{flavor}</span>
                      {config.enabledFlavors?.[flavor] !== false ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </button>

                    {deleteConfirm?.type === 'flavor' && deleteConfirm.id === flavor ? (
                      <button
                        onClick={() => {
                          if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                          else handleDeleteFlavor(flavor);
                        }}
                        onMouseLeave={() => setDeleteConfirm(null)}
                        className={`px-3 rounded-lg text-xs font-bold transition-colors ${
                          deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                        }`}
                      >
                        {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm({ type: 'flavor', id: flavor, step: 1 })}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay sabores registrados</p>
              )}
            </div>
          </section>

          {/* Calibres */}
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Calibres</h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="number" 
                value={newSize} 
                onChange={e => setNewSize(e.target.value)}
                placeholder="Nuevo calibre (cc)..."
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
              <button 
                onClick={handleAddSize}
                className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.isArray(config.sizes) && config.sizes.length > 0 ? (
                config.sizes.map(size => (
                  <div key={size} className="flex gap-1">
                    <button
                      onClick={() => handleToggleSize(size)}
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                        config.enabledSizes?.[size] !== false
                          ? 'bg-white border-blue-200 text-blue-700 shadow-sm' 
                          : 'bg-gray-100 border-gray-200 text-gray-400 opacity-60'
                      }`}
                    >
                      <span className="font-medium">{size} cc</span>
                      {config.enabledSizes?.[size] !== false ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </button>

                    {deleteConfirm?.type === 'size' && deleteConfirm.id === size ? (
                      <button
                        onClick={() => {
                          if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                          else handleDeleteSize(size);
                        }}
                        onMouseLeave={() => setDeleteConfirm(null)}
                        className={`px-3 rounded-lg text-xs font-bold transition-colors ${
                          deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                        }`}
                      >
                        {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm({ type: 'size', id: size, step: 1 })}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay calibres registrados</p>
              )}
            </div>
          </section>

          {/* Supervisores */}
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Supervisores
            </h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={newSupervisor} 
                onChange={e => setNewSupervisor(e.target.value)}
                placeholder="Nuevo supervisor..."
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
              <button 
                onClick={handleAddSupervisor}
                className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.isArray(config.supervisors) && config.supervisors.length > 0 ? (
                config.supervisors.map(supervisor => (
                  <div key={supervisor} className="flex gap-1">
                    <button
                      onClick={() => handleToggleSupervisor(supervisor)}
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                        config.enabledSupervisors?.[supervisor] !== false
                          ? 'bg-white border-blue-200 text-blue-700 shadow-sm' 
                          : 'bg-gray-100 border-gray-200 text-gray-400 opacity-60'
                      }`}
                    >
                      <span className="font-medium">{supervisor}</span>
                      {config.enabledSupervisors?.[supervisor] !== false ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </button>

                    {deleteConfirm?.type === 'supervisor' && deleteConfirm.id === supervisor ? (
                      <button
                        onClick={() => {
                          if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                          else handleDeleteSupervisor(supervisor);
                        }}
                        onMouseLeave={() => setDeleteConfirm(null)}
                        className={`px-3 rounded-lg text-xs font-bold transition-colors ${
                          deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                        }`}
                      >
                        {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm({ type: 'supervisor', id: supervisor, step: 1 })}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay supervisores registrados</p>
              )}
            </div>
          </section>

          {/* Químicos */}
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-blue-600" />
              Químicos
            </h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={newChemist} 
                onChange={e => setNewChemist(e.target.value)}
                placeholder="Nuevo químico..."
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
              <button 
                onClick={handleAddChemist}
                className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.isArray(config.chemists) && config.chemists.length > 0 ? (
                config.chemists.map(chemist => (
                  <div key={chemist} className="flex gap-1">
                    <button
                      onClick={() => handleToggleChemist(chemist)}
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                        config.enabledChemists?.[chemist] !== false
                          ? 'bg-white border-blue-200 text-blue-700 shadow-sm' 
                          : 'bg-gray-100 border-gray-200 text-gray-400 opacity-60'
                      }`}
                    >
                      <span className="font-medium">{chemist}</span>
                      {config.enabledChemists?.[chemist] !== false ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </button>

                    {deleteConfirm?.type === 'chemist' && deleteConfirm.id === chemist ? (
                      <button
                        onClick={() => {
                          if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                          else handleDeleteChemist(chemist);
                        }}
                        onMouseLeave={() => setDeleteConfirm(null)}
                        className={`px-3 rounded-lg text-xs font-bold transition-colors ${
                          deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                        }`}
                      >
                        {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm({ type: 'chemist', id: chemist, step: 1 })}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay químicos registrados</p>
              )}
            </div>
          </section>
        </div>

        {/* Combinaciones Marca-Sabor */}
        <section className="mt-12">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Combinaciones Marca - Sabor</h3>
          <p className="text-sm text-gray-500 mb-6">Selecciona qué sabores están permitidos para cada marca.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Array.isArray(config.brands) && config.brands.length > 0 ? (
              config.brands.map(brand => (
                <div key={brand} className={`bg-gray-50 rounded-xl p-4 border transition-all ${config.enabledBrands?.[brand] !== false ? 'border-gray-200' : 'opacity-40 grayscale'}`}>
                  <h4 className="font-bold text-gray-700 mb-3 uppercase text-xs tracking-wider flex items-center justify-between">
                    {brand}
                    {config.enabledBrands?.[brand] === false && <span className="text-[10px] bg-gray-200 px-1.5 py-0.5 rounded">DESACTIVADA</span>}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {Array.isArray(config.flavors) && config.flavors.map(flavor => {
                      const isEnabled = Array.isArray(config.brandFlavorCombinations?.[brand]) && config.brandFlavorCombinations[brand].includes(flavor);
                      const isFlavorActive = config.enabledFlavors?.[flavor] !== false;
                      
                      return (
                        <button
                          key={flavor}
                          disabled={config.enabledBrands?.[brand] === false || !isFlavorActive}
                          onClick={() => handleToggleBrandCombination(brand, flavor)}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all flex items-center gap-1.5 ${
                            isEnabled
                              ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-2 ring-blue-500/10'
                              : 'bg-white border-gray-300 text-gray-400 hover:border-gray-400'
                          } ${(!isFlavorActive) ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                          {flavor}
                          {isEnabled && <CheckCircle2 className="w-3 h-3" />}
                          {!isFlavorActive && <XCircle className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 italic col-span-2 text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                No hay marcas registradas para configurar combinaciones
              </p>
            )}
          </div>
        </section>

        <section className="mt-12">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Combinaciones Línea - Calibre</h3>
          <p className="text-sm text-gray-500 mb-6">Selecciona qué calibres están permitidos para cada línea de producción.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Array.isArray(config.lines) && config.lines.length > 0 ? (
              config.lines.map(line => (
                <div key={line} className={`bg-gray-50 rounded-xl p-4 border transition-all ${config.enabledLines?.[line] !== false ? 'border-gray-200' : 'opacity-40 grayscale'}`}>
                  <h4 className="font-bold text-gray-700 mb-3 uppercase text-xs tracking-wider flex items-center justify-between">
                    Línea {line}
                    {config.enabledLines?.[line] === false && <span className="text-[10px] bg-gray-200 px-1.5 py-0.5 rounded">DESACTIVADA</span>}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {Array.isArray(config.sizes) && config.sizes.map(size => {
                      const isEnabled = Array.isArray(config.lineSizeCombinations?.[line]) && config.lineSizeCombinations[line].includes(size);
                      const isSizeActive = config.enabledSizes?.[size] !== false;
                      
                      return (
                        <button
                          key={size}
                          disabled={config.enabledLines?.[line] === false || !isSizeActive}
                          onClick={() => handleToggleLineCombination(line, size)}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all flex items-center gap-1.5 ${
                            isEnabled
                              ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-2 ring-blue-500/10'
                              : 'bg-white border-gray-300 text-gray-400 hover:border-gray-400'
                          } ${(!isSizeActive) ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                          {size} cc
                          {isEnabled && <CheckCircle2 className="w-3 h-3" />}
                          {!isSizeActive && <XCircle className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 italic col-span-2 text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                No hay líneas registradas para configurar combinaciones
              </p>
            )}
          </div>
        </section>
        <section className="mt-12">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Velocidad de Línea (Botellas / Minuto)</h3>
          <p className="text-sm text-gray-500 mb-6">Configura la velocidad nominal para cada combinación de Línea y Calibre habilitada.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.isArray(config.lines) && config.lines.map(line => {
              if (config.enabledLines?.[line] === false) return null;
              const allowedSizes = config.lineSizeCombinations?.[line] || [];
              if (allowedSizes.length === 0) return null;

              return (
                <div key={line} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <h4 className="font-bold text-gray-700 mb-3 uppercase text-xs tracking-wider">Línea {line}</h4>
                  <div className="space-y-3">
                    {allowedSizes.map(size => {
                      if (config.enabledSizes?.[size] === false) return null;
                      const currentSpeed = config.velocidadMatrix?.[line]?.[size] || '';
                      return (
                        <div key={size} className="flex items-center justify-between gap-3">
                          <label className="text-sm font-medium text-gray-600 w-20">{size} cc</label>
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="number"
                              value={currentSpeed}
                              onChange={(e) => handleUpdateVelocidad(line, size, e.target.value)}
                              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-1.5 text-right"
                              placeholder="0"
                            />
                            <span className="text-xs text-gray-500 w-10">BPM</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-12">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Configuración de Paletizado y Empaque</h3>
          <p className="text-sm text-gray-500 mb-6">Define la cantidad de packs por paleta y botellas por pack para cada calibre.</p>
          
          <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Calibre</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Botellas / Pack</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Packs / Paleta</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Array.isArray(config.sizes) && config.sizes.map(size => {
                  if (config.enabledSizes?.[size] === false) return null;
                  const botellas = config.botellasPorPack?.[size] || '';
                  const packs = config.packsPorPaleta?.[size] || '';
                  
                  return (
                    <tr key={size}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {size} cc
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        <input
                          type="number"
                          value={botellas}
                          onChange={(e) => handleUpdateBotellasPorPack(size, e.target.value)}
                          className="w-24 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-1.5"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        <input
                          type="number"
                          value={packs}
                          onChange={(e) => handleUpdatePacksPorPaleta(size, e.target.value)}
                          className="w-24 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-1.5"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      )}
    </div>
  );
}
