import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SABORES, TAMANOS, LINEAS, VELOCIDAD_MATRIX, MARCAS, SUPERVISORES, PACKS_POR_PALETA, BOTELLAS_POR_PACK } from '../constants';

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

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

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
        // Fallback to defaults from constants
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

        setConfig({
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
        });
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching config:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const availableFlavors = useMemo(() => {
    if (!config || !Array.isArray(config.flavors)) return SABORES;
    return config.flavors.filter(s => config.enabledFlavors?.[s] !== false);
  }, [config]);

  const availableSizes = useMemo(() => {
    if (!config || !Array.isArray(config.sizes)) return TAMANOS;
    return config.sizes.filter(t => config.enabledSizes?.[t.toString()] !== false);
  }, [config]);

  const availableBrands = useMemo(() => {
    if (!config || !Array.isArray(config.brands)) return MARCAS;
    return config.brands.filter(m => config.enabledBrands?.[m] !== false);
  }, [config]);

  const availableLines = useMemo(() => {
    if (!config || !Array.isArray(config.lines)) return LINEAS;
    return config.lines.filter(l => config.enabledLines?.[l] !== false);
  }, [config]);

  const availableSupervisors = useMemo(() => {
    if (!config || !Array.isArray(config.supervisors)) return SUPERVISORES;
    return config.supervisors.filter(s => config.enabledSupervisors?.[s] !== false);
  }, [config]);

  const availableChemists = useMemo(() => {
    if (!config || !Array.isArray(config.chemists)) return [];
    return config.chemists.filter(c => config.enabledChemists?.[c] !== false);
  }, [config]);

  const getFilteredFlavors = (brand?: string) => {
    let filtered = availableFlavors;
    
    if (brand && config?.brandFlavorCombinations?.[brand]) {
      const allowedForBrand = config.brandFlavorCombinations[brand];
      if (Array.isArray(allowedForBrand)) {
        filtered = filtered.filter(s => allowedForBrand.includes(s));
      }
    }
    
    return filtered;
  };

  const getFilteredSizes = (linea?: string) => {
    let filtered = availableSizes;
    
    if (linea && config?.lineSizeCombinations?.[linea]) {
      const allowedForLine = config.lineSizeCombinations[linea];
      if (Array.isArray(allowedForLine)) {
        filtered = filtered.filter(t => allowedForLine.includes(Number(t)));
      }
    }
    
    return filtered;
  };

  return { 
    config, 
    loading, 
    availableFlavors,
    availableSizes,
    availableBrands,
    availableLines,
    availableSupervisors,
    availableChemists,
    getFilteredFlavors, 
    getFilteredSizes 
  };
}
