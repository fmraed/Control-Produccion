import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SABORES, TAMANOS, LINEAS, VELOCIDAD_MATRIX, MARCAS, SUPERVISORES, PACKS_POR_PALETA, BOTELLAS_POR_PACK, SABORES_SIN_JARABE, CO2_VOLUMES, WASTE_WEIGHTS } from '../constants';

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
  activeProducts?: Record<string, Record<string, string[]>>; // Brand -> Size -> Flavors[]
  velocidadMatrix: Record<string, Record<number, number>>;
  packsPorPaleta: Record<number, number>;
  botellasPorPack: Record<number, number>;
  lineOperators?: Record<string, number>;
  schedulerDefaults?: Record<string, { marca: string, tamano: number, plannedPacks: number }>; // Key is Line ID
  calibreDefaults?: Record<number, number>; // Key is Size (tamano), Value is plannedPacks
  shiftConfig?: {
    standardShiftDuration: number;
    shiftDurations: {
      Mañana: number;
      Tarde: number;
      Noche: number;
    };
    weeklyPlan: Record<string, Record<string, { count: number, duration: number }>>;
    holidays?: string[];
    holidayNightDuration?: number;
  };
  saboresSinJarabe?: string[];
  co2Volumes?: Record<string, Record<string, number>>;
  historicalSettings?: {
    showHistoricalGlobal: boolean;
    historicalStartDate?: string;
  };
  managementSettings?: {
    showPreviousManagementGlobal: boolean;
    managementStartDate?: string;
    previousStartDate?: string;
    currentEndDate?: string;
  };
  salariosPorRango?: Record<string, number>;
  qualityControlFlavors?: string[];
  warehousePositions?: number;
  stackableFlavors?: string[];
  externalProducts?: Record<string, Record<string, string[]>>;
  wasteWeights?: Record<string, { etiq: number; tapa: number; termo: number }>;
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
          activeProducts: data.activeProducts || {},
          velocidadMatrix: data.velocidadMatrix || VELOCIDAD_MATRIX,
          packsPorPaleta: data.packsPorPaleta || PACKS_POR_PALETA,
          botellasPorPack: data.botellasPorPack || BOTELLAS_POR_PACK,
          lineOperators: data.lineOperators || {},
          schedulerDefaults: data.schedulerDefaults || {},
          calibreDefaults: data.calibreDefaults || {},
          shiftConfig: data.shiftConfig,
          historicalSettings: data.historicalSettings || { showHistoricalGlobal: false },
          managementSettings: data.managementSettings || { showPreviousManagementGlobal: true },
          saboresSinJarabe: data.saboresSinJarabe || SABORES_SIN_JARABE,
          salariosPorRango: data.salariosPorRango || {},
          qualityControlFlavors: Array.isArray(data.qualityControlFlavors) ? data.qualityControlFlavors : ['Agua'],
          warehousePositions: data.warehousePositions || 2300,
          stackableFlavors: Array.isArray(data.stackableFlavors) ? data.stackableFlavors : (data.flavors || SABORES).filter((s: string) => s !== 'Soda Sifon' && s !== 'Soda'),
          externalProducts: data.externalProducts || {},
          wasteWeights: data.wasteWeights || WASTE_WEIGHTS,
          co2Volumes: (() => {
            const defaultVols = { ...CO2_VOLUMES };
            if (data.co2Volumes) {
              for (const brand in data.co2Volumes) {
                defaultVols[brand] = { ...(defaultVols[brand] || {}), ...data.co2Volumes[brand] };
              }
            }
            return defaultVols;
          })()
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
          activeProducts: {},
          velocidadMatrix: VELOCIDAD_MATRIX,
          packsPorPaleta: PACKS_POR_PALETA,
          botellasPorPack: BOTELLAS_POR_PACK,
          lineOperators: {},
          historicalSettings: { showHistoricalGlobal: false },
          managementSettings: { showPreviousManagementGlobal: true },
          saboresSinJarabe: SABORES_SIN_JARABE,
          co2Volumes: CO2_VOLUMES,
          warehousePositions: 2300,
          stackableFlavors: SABORES.filter(s => s !== 'Soda Sifon' && s !== 'Soda'),
          externalProducts: {},
          wasteWeights: WASTE_WEIGHTS
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

  const localBrands = useMemo(() => {
    if (!config || !availableBrands) return [];
    return availableBrands.filter(brand => {
      // Check if brand has ANY combination that is NOT external
      const brandActive = config.activeProducts?.[brand];
      const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
      const brandCombos = config.brandFlavorCombinations?.[brand] || [];
      
      // Check all available sizes
      return availableSizes.some(size => {
        const sizeStr = size.toString();
        const hasSizeConfig = brandActive && sizeStr in brandActive;
        const flavors = hasSizeConfig ? brandActive[sizeStr] : (hasBrandConfig ? [] : brandCombos);
        const externalForSize = config.externalProducts?.[brand]?.[sizeStr] || [];
        
        return flavors.some(f => !externalForSize.includes(f) && config.enabledFlavors?.[f] !== false);
      });
    });
  }, [config, availableBrands, availableSizes]);

  const getFilteredFlavors = (brand?: string, size?: number, includeExternal: boolean = true) => {
    let filtered = availableFlavors;
    
    // Triple filter (Brand + Size -> Flavors)
    if (brand && size && config?.activeProducts) {
      const brandActive = config.activeProducts[brand];
      const sizeStr = size.toString();
      const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
      const hasSizeConfig = brandActive && sizeStr in brandActive;

      const allowed = hasSizeConfig
        ? brandActive[sizeStr]
        : (hasBrandConfig ? [] : (config.brandFlavorCombinations?.[brand] || []));

      filtered = filtered.filter(s => allowed.includes(s));
    } else if (brand && config?.brandFlavorCombinations?.[brand]) {
      // Fallback to Brand -> Flavors filter (only if no activeProducts at all for this brand)
      const brandActive = config.activeProducts?.[brand];
      if (brandActive && Object.keys(brandActive).length > 0) {
        // If brand has configs but we don't have a size, maybe we return nothing or everything?
        // Usually brand+size is safest. If only brand provided, we could return all brand active flavors.
        const allActiveFlavors = new Set<string>();
        Object.values(brandActive as Record<string, string[]>).forEach(flavors => {
          if (Array.isArray(flavors)) {
            flavors.forEach(f => allActiveFlavors.add(f));
          }
        });
        filtered = filtered.filter(s => allActiveFlavors.has(s));
      } else {
        const allowedForBrand = config.brandFlavorCombinations[brand];
        if (Array.isArray(allowedForBrand)) {
          filtered = filtered.filter(s => allowedForBrand.includes(s));
        }
      }
    }
    
    // Filter external products if requested
    if (!includeExternal && brand && size && config?.externalProducts?.[brand]) {
      const externalForSize = config.externalProducts[brand][size.toString()] || [];
      filtered = filtered.filter(s => !externalForSize.includes(s));
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

  const shouldShowReport = (report: any, forceShow?: boolean) => {
    if (forceShow) return true;
    
    if (!config?.historicalSettings) return true;
    
    // Determine origin
    const isHistorical = report.origin === 'historical';
    
    // Always show manual/non-historical reports in common sections
    if (!isHistorical) return true;
    
    const { showHistoricalGlobal, historicalStartDate } = config.historicalSettings;
    
    // If global toggle is ON, show historical everywhere
    if (showHistoricalGlobal) return true;
    
    // If global is OFF, only show if it's within the allowed start date
    if (historicalStartDate && report.fecha >= historicalStartDate) {
      return true;
    }
    
    return false;
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
    localBrands,
    getFilteredFlavors, 
    getFilteredSizes,
    shouldShowReport
  };
}
