import { useState, useEffect, Fragment, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, getDoc, setDoc, addDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { SABORES, TAMANOS, LINEAS, VELOCIDAD_MATRIX, MARCAS, SUPERVISORES, PACKS_POR_PALETA, BOTELLAS_POR_PACK, CO2_VOLUMES, SABORES_SIN_JARABE, RANGOS_MIXTO, WASTE_WEIGHTS, DEFAULT_INSUMOS, PreformaConfig, TermoConfig, StretchConfig, TapaConfig } from '../constants';
import { Settings, Save, CheckCircle2, XCircle, AlertCircle, Plus, Trash2, Users, Database, FlaskConical, Link2, Clock, Calendar, ShieldCheck, UserCog, Briefcase, AlertTriangle, Hash, Package, TrendingUp, Scale, ArrowUp, ArrowDown } from 'lucide-react';
import { UserProfile, UserRole, RolePermissions } from '../types';
import { SQLIntegration } from './SQLIntegration';
import { SQLMappingEditor } from './SQLMappingEditor';
import { CounterControl } from './CounterControl';

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
  lineOperators?: Record<string, number>; // Line -> Required Operators
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
    changeDate?: string;
    previousWeeklyPlan?: Record<string, Record<string, { count: number, duration: number }>>;
  };
  historicalSettings?: {
    showHistoricalGlobal: boolean;
    historicalStartDate?: string;
  };
  managementSettings?: {
    showPreviousManagementGlobal: boolean;
    managementStartDate?: string;
  };
  saboresSinJarabe?: string[];
  co2Volumes?: Record<string, Record<string, number>>;
  salariosPorRango?: Record<string, number>;
  cargasSocialesPercent?: number;
  sacPercent?: number;
  qualityControlFlavors?: string[];
  warehousePositions?: number;
  stackableFlavors?: string[];
  externalProducts?: Record<string, Record<string, string[]>>;
  wasteWeights?: Record<string, { etiq: number; tapa: number; termo: number; stretch: number }>;
  syrupFormulas?: Record<string, Record<string, { liters: number; emulsion: number }>>;
  insumos?: string[];
  insumosCategories?: Record<string, string>;
  insumosCategoriesOrder?: string[];
  insumosMatrix?: Record<string, Record<string, Record<string, number>>>;
  compatibleInsumoGroups?: Record<string, string[]>;
  compatiblePackagingGroups?: Record<string, string[]>;
  preformasConfig?: PreformaConfig[];
  termoConfig?: TermoConfig[];
  stretchConfig?: StretchConfig[];
  tapaConfig?: TapaConfig[];
  categorySecurityDays?: Record<string, number>;
  insumosCriticality?: Record<string, number>;
  insumosPurchaseLots?: Record<string, { size: number; unit: string }>;
  efficiencyExcludedDowntimes: string[];
}

export function AdminPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'sql' | 'mappings' | 'shifts' | 'users' | 'permissions' | 'formulas' | 'danger' | 'salaries' | 'counters' | 'waste'>('config');
  const [editingPreviousScheme, setEditingPreviousScheme] = useState(false);

  const getFlavorsForBrand = (brand: string) => {
    if (!config) return [];
    const brandActive = config.activeProducts?.[brand];
    if (brandActive && Object.keys(brandActive).length > 0) {
      const allActiveFlavors = new Set<string>();
      Object.values(brandActive as Record<string, string[]>).forEach(flavors => {
        if (Array.isArray(flavors)) {
          flavors.forEach(f => allActiveFlavors.add(f));
        }
      });
      return config.flavors.filter(f => allActiveFlavors.has(f));
    }
    return (config.brandFlavorCombinations?.[brand] || []).filter(f => config.flavors.includes(f));
  };
  const [isPurging, setIsPurging] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  // User management states
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allowedUsers, setAllowedUsers] = useState<any[]>([]);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  
  // New user form states
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('produccion');
  const [newUserSector, setNewUserSector] = useState('');
  const [isAddingUser, setIsAddingUser] = useState(false);

  const filteredSizesForWaste = useMemo(() => {
    if (!config) return [];
    return config.sizes.filter(size => {
      const sizeStr = size.toString();
      if (config.enabledSizes?.[sizeStr] === false) return false;

      return config.brands.some(brand => {
        if (config.enabledBrands?.[brand] === false) return false;
        
        const brandActive = config.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const brandCombos = config.brandFlavorCombinations?.[brand] || [];

        const hasSizeConfig = brandActive && sizeStr in brandActive;
        const flavors = hasSizeConfig 
          ? (brandActive as any)[sizeStr]
          : (hasBrandConfig ? [] : (brandCombos || []));
        
        const externalForSize = config.externalProducts?.[brand]?.[sizeStr] || [];
        
        return flavors.some((sabor: string) => 
          config?.enabledFlavors?.[sabor] !== false && !externalForSize.includes(sabor)
        );
      });
    });
  }, [config]);

  // Permission states
  const [rolePermissions, setRolePermissions] = useState<Record<UserRole, RolePermissions> | null>(null);
  
  // Active product config selection
  const [selectedBrandForTriple, setSelectedBrandForTriple] = useState('');
  const [selectedSizeForTriple, setSelectedSizeForTriple] = useState<number | null>(null);

  // New item inputs
  const [newFlavor, setNewFlavor] = useState('');
  const [newSize, setNewSize] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newLine, setNewLine] = useState('');
  const [newSupervisor, setNewSupervisor] = useState('');
  const [newChemist, setNewChemist] = useState('');
  const [newInsumo, setNewInsumo] = useState('');
  const [newCompatibleGroup, setNewCompatibleGroup] = useState<string[]>([]);
  const [newCompatiblePackagingGroup, setNewCompatiblePackagingGroup] = useState<string[]>([]);
  
  // Deletion confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'brand' | 'line' | 'flavor' | 'size' | 'supervisor' | 'chemist' | 'insumo', id: string | number, step: number } | null>(null);

  const [userSearch, setUserSearch] = useState('');
  
  const trulyPendingAllowedUsers = useMemo(() => {
    const registeredEmails = new Set(users.map(u => (u.email || '').toLowerCase().trim()));
    return allowedUsers.filter(au => {
      const emailMatch = (au.email || '').toLowerCase().trim();
      const idMatch = (au.id || '').toLowerCase().trim();
      return !registeredEmails.has(emailMatch) && !registeredEmails.has(idMatch);
    });
  }, [allowedUsers, users]);

  const filteredUsers = users.filter(u => 
    ((u.displayName || '').toLowerCase().includes(userSearch.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(userSearch.toLowerCase()))
  );

  const allPackagingItems = useMemo(() => {
    const items: string[] = [];
    (config?.preformasConfig || []).forEach(p => items.push(p.name));
    (config?.termoConfig || []).forEach(t => items.push(t.name));
    (config?.stretchConfig || []).forEach(s => items.push(s.name));
    (config?.tapaConfig || []).forEach(t => items.push(t.name));
    return items;
  }, [config?.preformasConfig, config?.termoConfig, config?.stretchConfig, config?.tapaConfig]);

  const uniqueInsumoCategories = useMemo(() => {
    if (!config) return [];
    const categories = new Set<string>();
    Object.values(config.insumosCategories || {}).forEach(cat => {
      if (typeof cat === 'string' && cat.trim()) categories.add(cat.trim());
    });
    categories.add('Preformas');
    categories.add('Etiquetas');
    categories.add('Tapas');
    categories.add('Termocontraíbles');
    categories.add('Stretch');
    categories.add('Cabezales Sifón');
    return Array.from(categories).sort();
  }, [config?.insumosCategories]);

  useEffect(() => {
    const configRef = doc(db, 'config', 'production');
    
    const unsubscribe = onSnapshot(configRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as any;
        // Merge with defaults to ensure all fields exist even if the document is old
        let shiftConfig = data.shiftConfig || {
          standardShiftDuration: 480,
          shiftDurations: { Mañana: 480, Tarde: 480, Noche: 480 },
          weeklyPlan: {
            monday: ['Mañana', 'Tarde', 'Noche'],
            tuesday: ['Mañana', 'Tarde', 'Noche'],
            wednesday: ['Mañana', 'Tarde', 'Noche'],
            thursday: ['Mañana', 'Tarde', 'Noche'],
            friday: ['Mañana', 'Tarde', 'Noche'],
            saturday: ['Mañana'],
            sunday: []
          }
        };

        const normalizePlanFn = (planToNormalize: any) => {
          if (!planToNormalize) return null;
          const normalized: any = {};
          const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
          const enabledLinesCount = data.lines?.filter((l: string) => data.enabledLines?.[l] !== false).length || 3;
          
          days.forEach(day => {
            const val = planToNormalize[day];
            normalized[day] = {};
            
            ['Mañana', 'Tarde', 'Noche'].forEach(shift => {
              if (Array.isArray(val)) {
                // Format from previous turn (array of strings)
                const isActive = val.includes(shift);
                normalized[day][shift] = {
                  count: isActive ? enabledLinesCount : 0,
                  duration: (shiftConfig.shiftDurations?.[shift] || 480)
                };
              } else if (typeof val === 'object' && val !== null && val[shift]) {
                // Already in new format
                normalized[day][shift] = val[shift];
              } else {
                // Old numeric format or missing
                normalized[day][shift] = { count: 0, duration: 480 };
              }
            });
          });
          return normalized;
        };

        if (shiftConfig.weeklyPlan) {
          shiftConfig.weeklyPlan = normalizePlanFn(shiftConfig.weeklyPlan);
        }
        if (shiftConfig.previousWeeklyPlan) {
          shiftConfig.previousWeeklyPlan = normalizePlanFn(shiftConfig.previousWeeklyPlan);
        }

        // Ensure shiftDurations exists
        if (!shiftConfig.shiftDurations) {
          shiftConfig.shiftDurations = { Mañana: 480, Tarde: 480, Noche: 480 };
        }

        // Ensure holidays exists
        if (!shiftConfig.holidays) {
          shiftConfig.holidays = [];
        }

        // Ensure holidayNightDuration exists
        if (shiftConfig.holidayNightDuration === undefined) {
          shiftConfig.holidayNightDuration = 360;
        }

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
          shiftConfig: shiftConfig,
          historicalSettings: data.historicalSettings || { showHistoricalGlobal: false },
          managementSettings: data.managementSettings || { showPreviousManagementGlobal: true },
          saboresSinJarabe: Array.isArray(data.saboresSinJarabe) ? data.saboresSinJarabe : SABORES_SIN_JARABE,
          co2Volumes: data.co2Volumes || CO2_VOLUMES,
          salariosPorRango: data.salariosPorRango || {},
          cargasSocialesPercent: typeof data.cargasSocialesPercent === 'number' ? data.cargasSocialesPercent : 31.5,
          sacPercent: typeof data.sacPercent === 'number' ? data.sacPercent : 8.33,
          qualityControlFlavors: Array.isArray(data.qualityControlFlavors) ? data.qualityControlFlavors : ['Agua'],
          warehousePositions: data.warehousePositions || 2300,
          stackableFlavors: Array.isArray(data.stackableFlavors) ? data.stackableFlavors : (data.flavors || SABORES).filter((s: string) => s !== 'Soda Sifon' && s !== 'Soda'),
          externalProducts: data.externalProducts || {},
          wasteWeights: data.wasteWeights || WASTE_WEIGHTS,
          syrupFormulas: data.syrupFormulas || {},
          insumos: data.insumos || DEFAULT_INSUMOS,
          insumosCategories: data.insumosCategories || {},
          insumosCategoriesOrder: data.insumosCategoriesOrder || [],
          insumosMatrix: data.insumosMatrix || {},
          compatibleInsumoGroups: data.compatibleInsumoGroups || {},
          compatiblePackagingGroups: data.compatiblePackagingGroups || {},
          preformasConfig: data.preformasConfig || [],
          termoConfig: data.termoConfig || [],
          stretchConfig: data.stretchConfig || [],
          tapaConfig: data.tapaConfig || [],
          efficiencyExcludedDowntimes: data.efficiencyExcludedDowntimes || ['Sin programa', 'Mantenimiento programado', 'Otras ajenas a linea']
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
          activeProducts: {},
          velocidadMatrix: VELOCIDAD_MATRIX,
          packsPorPaleta: PACKS_POR_PALETA,
          botellasPorPack: BOTELLAS_POR_PACK,
          lineOperators: {},
          salariosPorRango: {},
          cargasSocialesPercent: 31.5,
          sacPercent: 8.33,
          qualityControlFlavors: ['Agua'],
          warehousePositions: 2300,
          stackableFlavors: SABORES.filter(s => s !== 'Soda Sifon' && s !== 'Soda'),
          externalProducts: {},
          shiftConfig: {
            standardShiftDuration: 480,
            shiftDurations: { Mañana: 480, Tarde: 480, Noche: 480 },
            weeklyPlan: {
              monday: { 
                Mañana: { count: 3, duration: 480 }, 
                Tarde: { count: 3, duration: 480 }, 
                Noche: { count: 3, duration: 480 } 
              },
              tuesday: { 
                Mañana: { count: 3, duration: 480 }, 
                Tarde: { count: 3, duration: 480 }, 
                Noche: { count: 3, duration: 480 } 
              },
              wednesday: { 
                Mañana: { count: 3, duration: 480 }, 
                Tarde: { count: 3, duration: 480 }, 
                Noche: { count: 3, duration: 480 } 
              },
              thursday: { 
                Mañana: { count: 3, duration: 480 }, 
                Tarde: { count: 3, duration: 480 }, 
                Noche: { count: 3, duration: 480 } 
              },
              friday: { 
                Mañana: { count: 3, duration: 480 }, 
                Tarde: { count: 3, duration: 480 }, 
                Noche: { count: 3, duration: 420 } 
              },
              saturday: { 
                Mañana: { count: 3, duration: 480 }, 
                Tarde: { count: 0, duration: 480 }, 
                Noche: { count: 0, duration: 480 } 
              },
              sunday: { 
                Mañana: { count: 0, duration: 480 }, 
                Tarde: { count: 0, duration: 480 }, 
                Noche: { count: 3, duration: 360 } 
              }
            },
            holidays: []
          },
          saboresSinJarabe: SABORES_SIN_JARABE,
          co2Volumes: CO2_VOLUMES,
          syrupFormulas: {},
          insumos: DEFAULT_INSUMOS,
          insumosCategories: {},
          insumosCategoriesOrder: [],
          insumosMatrix: {},
          compatibleInsumoGroups: {},
          compatiblePackagingGroups: {},
          preformasConfig: [],
          termoConfig: [],
          stretchConfig: [],
          tapaConfig: [],
          efficiencyExcludedDowntimes: ['Sin programa', 'Mantenimiento programado', 'Otras ajenas a linea']
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

  useEffect(() => {
    if (activeTab === 'users') {
      const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        const usersList = snap.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile));
        // Sort in memory by createdAt desc, handling missing fields
        usersList.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });
        setUsers(usersList);
      }, (error) => {
        console.error("Error loading users:", error);
        setMessage({ type: 'error', text: 'Error al cargar usuarios registrados' });
      });
      const unsubAllowed = onSnapshot(collection(db, 'allowed_users'), async (snap) => {
        const allowedList = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        
        // Auto-normalize any legacy uppercase/spaced emails in background
        const batch = writeBatch(db);
        let hasChanges = false;
        for (const docSnap of snap.docs) {
          const originalId = docSnap.id;
          const normalizedId = originalId.toLowerCase().trim();
          if (originalId !== normalizedId && !allowedList.some(a => a.id === normalizedId)) {
            batch.set(doc(db, 'allowed_users', normalizedId), { ...docSnap.data(), email: normalizedId });
            batch.delete(docSnap.ref);
            hasChanges = true;
          } else if (originalId !== normalizedId) {
            // Normalized already exists, delete the duplicate uppercase one
            batch.delete(docSnap.ref);
            hasChanges = true;
          }
        }
        if (hasChanges) {
          try { await batch.commit(); } catch (e) { console.error('Failed normalizing allowed users', e); }
        }

        allowedList.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });
        setAllowedUsers(allowedList);
      }, (error) => {
        console.error("Error loading allowed users:", error);
        setMessage({ type: 'error', text: 'Error al cargar invitaciones' });
      });
      return () => {
        unsubUsers();
        unsubAllowed();
      };
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'permissions') {
      const analyticsDefaultsTrue = {
        viewManagementSummary: true, viewConsolidated: true, viewWaste: true,
        viewSyrup: true, viewGoalFulfillment: true, viewStockControl: true,
        viewDowntime: true, viewEfficiency: true, viewGantt: true
      };
      const analyticsDefaultsFalse = {
        viewManagementSummary: false, viewConsolidated: false, viewWaste: false,
        viewSyrup: false, viewGoalFulfillment: false, viewStockControl: false,
        viewDowntime: false, viewEfficiency: false, viewGantt: false
      };
      
      const defaults: Record<UserRole, RolePermissions> = {
        admin: {
          viewReports: true, editReports: true, viewElaboracion: true, editElaboracion: true,
          viewScheduler: true, editScheduler: true, viewPersonnel: true, editPersonnel: true,
          viewLiveMonitor: true, viewAnalytics: true, ...analyticsDefaultsTrue, viewAdmin: true,
          viewPersonnelPayroll: true,
          viewEnergy: true, editEnergy: true, viewHistoricalData: true, editHistoricalData: true,
          viewInsumos: true, editInsumos: true
        },
        jefe_produccion: {
          viewReports: true, editReports: true, viewElaboracion: true, editElaboracion: true,
          viewScheduler: true, editScheduler: true, viewPersonnel: true, editPersonnel: true,
          viewLiveMonitor: true, viewAnalytics: true, ...analyticsDefaultsTrue, viewAdmin: false,
          viewPersonnelPayroll: true,
          viewEnergy: true, editEnergy: true, viewHistoricalData: true, editHistoricalData: true,
          viewInsumos: true, editInsumos: true
        },
        produccion: {
          viewReports: true, editReports: true, viewElaboracion: true, editElaboracion: true,
          viewScheduler: true, editScheduler: false, viewPersonnel: true, editPersonnel: true,
          viewLiveMonitor: true, viewAnalytics: false, ...analyticsDefaultsFalse, viewAdmin: false,
          viewPersonnelPayroll: false,
          viewEnergy: true, editEnergy: false, viewHistoricalData: false, editHistoricalData: false,
          viewInsumos: true, editInsumos: false
        },
        calidad: {
          viewReports: true, editReports: false, viewElaboracion: true, editElaboracion: true,
          viewScheduler: true, editScheduler: false, viewPersonnel: true, editPersonnel: true,
          viewLiveMonitor: true, viewAnalytics: false, ...analyticsDefaultsFalse, viewAdmin: false,
          viewPersonnelPayroll: false,
          viewEnergy: true, editEnergy: false, viewHistoricalData: false, editHistoricalData: false,
          viewInsumos: true, editInsumos: false
        }
      };

      const unsub = onSnapshot(doc(db, 'config', 'permissions'), (snap) => {
        if (snap.exists()) {
          const remote = snap.data() as Record<UserRole, RolePermissions>;
          const merged: Record<UserRole, RolePermissions> = { ...defaults };
          (Object.keys(defaults) as UserRole[]).forEach(role => {
            if (remote[role]) {
              merged[role] = { ...defaults[role], ...remote[role] };
            }
          });
          setRolePermissions(merged);
        } else {
          setRolePermissions(defaults);
        }
      });
      return () => unsub();
    }
  }, [activeTab]);

  const handleUpdateUser = async (user: UserProfile) => {
    try {
      await setDoc(doc(db, 'users', user.uid), {
        ...user,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setMessage({ type: 'success', text: 'Usuario actualizado' });
      setEditingUser(null);
    } catch (e) {
      setMessage({ type: 'error', text: 'Error al actualizar usuario' });
    }
  };

  const handleAddAllowedUser = async () => {
    if (!newUserEmail.trim()) return;
    setIsAddingUser(true);
    try {
      const email = newUserEmail.toLowerCase().trim();
      
      // Check if user is already registered in 'users'
      const existingRegisteredUser = users.find(u => (u.email || '').toLowerCase().trim() === email);
      
      if (existingRegisteredUser) {
        // Update existing user directly
        await setDoc(doc(db, 'users', existingRegisteredUser.uid), {
          ...existingRegisteredUser,
          role: newUserRole,
          sector: newUserSector || existingRegisteredUser.sector,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        setMessage({ type: 'success', text: `Usuario ${email} ya estaba registrado. Se actualizó su rol y sector directamente.` });
      } else {
        // Not registered yet, add to whitelist
        await setDoc(doc(db, 'allowed_users', email), {
          email,
          role: newUserRole,
          sector: newUserSector,
          createdAt: new Date().toISOString()
        });
        setMessage({ type: 'success', text: 'Usuario habilitado correctamente. Podrá entrar cuando se registre.' });
      }
      
      setNewUserEmail('');
      setNewUserSector('');
    } catch (error) {
      console.error("Error adding allowed user:", error);
      setMessage({ type: 'error', text: 'Error al habilitar/actualizar usuario' });
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleDeleteAllowedUser = async (email: string) => {
    try {
      await deleteDoc(doc(db, 'allowed_users', email));
      setMessage({ type: 'success', text: 'Permiso eliminado' });
    } catch (error) {
      console.error("Error deleting allowed user:", error);
      setMessage({ type: 'error', text: 'Error al eliminar permiso' });
    }
  };

  const handleUpdatePermissions = async (role: UserRole, perms: RolePermissions) => {
    if (!rolePermissions) return;
    const newPerms = { ...rolePermissions, [role]: perms };
    setRolePermissions(newPerms);
    try {
      await setDoc(doc(db, 'config', 'permissions'), newPerms);
      setMessage({ type: 'success', text: 'Permisos actualizados' });
    } catch (e) {
      setMessage({ type: 'error', text: 'Error al actualizar permisos' });
    }
  };

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

  const handleAddInsumo = () => {
    if (!config || !newInsumo.trim()) return;
    const currentInsumos = config.insumos || [];
    if (currentInsumos.includes(newInsumo.trim())) return;
    
    setConfig({
      ...config,
      insumos: [...currentInsumos, newInsumo.trim()]
    });
    setNewInsumo('');
  };

  const handleUpdateInsumoCategory = (insumo: string, category: string) => {
    if (!config) return;
    setConfig({
      ...config,
      insumosCategories: {
        ...(config.insumosCategories || {}),
        [insumo]: category
      }
    });
  };

  const handleUpdateInsumoPurchasing = (insumo: string, field: 'criticality' | 'lotSize' | 'lotUnit', value: any) => {
    if (!config) return;
    if (field === 'criticality') {
      setConfig({
        ...config,
        insumosCriticality: {
          ...(config.insumosCriticality || {}),
          [insumo]: Number(value) || 1
        }
      });
    } else {
      const currentLot = config.insumosPurchaseLots?.[insumo] || { size: 1, unit: 'kg' };
      setConfig({
        ...config,
        insumosPurchaseLots: {
          ...(config.insumosPurchaseLots || {}),
          [insumo]: {
            ...currentLot,
            [field === 'lotSize' ? 'size' : 'unit']: field === 'lotSize' ? (Number(value) || 1) : value
          }
        }
      });
    }
  };

  const handleUpdateCategorySecurityDays = (category: string, days: number) => {
    if (!config) return;
    setConfig({
      ...config,
      categorySecurityDays: {
        ...(config.categorySecurityDays || {}),
        [category]: days
      }
    });
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

  const handleDeleteInsumo = (insumo: string) => {
    if (!config) return;
    const currentInsumos = config.insumos || [];
    setConfig({
      ...config,
      insumos: currentInsumos.filter(i => i !== insumo)
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

  const handleToggleTripleCombination = (brand: string, size: number, flavor: string) => {
    if (!config) return;
    const sizeStr = size.toString();
    const currentActiveProducts = config.activeProducts || {};
    const brandActiveProducts = currentActiveProducts[brand] || {};
    
    // Check if the specific size exists in activeProducts to avoid incorrect fallback
    const sizeFlavors = (brandActiveProducts && sizeStr in brandActiveProducts)
      ? (brandActiveProducts as any)[sizeStr]
      : (config.brandFlavorCombinations[brand] || []);
    
    let newFlavors;
    if (sizeFlavors.includes(flavor)) {
      newFlavors = sizeFlavors.filter(f => f !== flavor);
    } else {
      newFlavors = [...sizeFlavors, flavor];
    }
    
    setConfig({
      ...config,
      activeProducts: {
        ...currentActiveProducts,
        [brand]: {
          ...brandActiveProducts,
          [sizeStr]: newFlavors
        }
      }
    });
  };

  const handleToggleExternalProduct = (brand: string, size: number, flavor: string) => {
    if (!config) return;
    const sizeStr = size.toString();
    const currentExternal = config.externalProducts || {};
    const brandExternal = currentExternal[brand] || {};
    const sizeFlavors = brandExternal[sizeStr] || [];
    
    let newFlavors;
    if (sizeFlavors.includes(flavor)) {
      newFlavors = sizeFlavors.filter(f => f !== flavor);
    } else {
      newFlavors = [...sizeFlavors, flavor];
    }
    
    setConfig({
      ...config,
      externalProducts: {
        ...currentExternal,
        [brand]: {
          ...brandExternal,
          [sizeStr]: newFlavors
        }
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

    const handlePurgePersonnelData = async () => {
    setIsPurging(true);
    setMessage(null);
    try {
      // 1. Delete all employees
      const employeesSnap = await getDocs(collection(db, 'employees'));
      const batch1 = writeBatch(db);
      employeesSnap.docs.forEach(d => batch1.delete(d.ref));
      await batch1.commit();

      // 2. Delete all attendance_records
      const attendanceSnap = await getDocs(collection(db, 'attendance_records'));
      const batch2 = writeBatch(db);
      let count = 0;
      let currentBatch = writeBatch(db);
      for (const d of attendanceSnap.docs) {
        currentBatch.delete(d.ref);
        count++;
        if (count === 400) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await currentBatch.commit();

      // 3. Delete all shift_assignments
      const assignmentsSnap = await getDocs(collection(db, 'shift_assignments'));
      const batch3 = writeBatch(db);
      count = 0;
      currentBatch = writeBatch(db);
      for (const d of assignmentsSnap.docs) {
        currentBatch.delete(d.ref);
        count++;
        if (count === 400) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await currentBatch.commit();

      setMessage({ type: 'success', text: 'Toda la base de datos de Control de Personal ha sido borrada.' });
      window.scrollTo(0, 0);
    } catch (error) {
      console.error("Error purging personnel data:", error);
      setMessage({ type: 'error', text: 'Error al borrar los datos de personal.' });
    } finally {
      setIsPurging(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      await setDoc(doc(db, 'config', 'production'), config, { merge: true });
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
      <div className="flex flex-wrap gap-2 p-1.5 bg-gray-100/80 rounded-2xl border border-gray-200 mb-8">
        <button
          onClick={() => setActiveTab('config')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'config'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          General
        </button>
        <button
          onClick={() => setActiveTab('sql')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'sql'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          SQL Server
        </button>
        <button
          onClick={() => setActiveTab('mappings')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'mappings'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Link2 className="w-3.5 h-3.5" />
          Mapeos
        </button>
        <button
          onClick={() => setActiveTab('shifts')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'shifts'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          Turnos
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'users'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <UserCog className="w-3.5 h-3.5" />
          Usuarios
        </button>
        <button
          onClick={() => setActiveTab('formulas')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'formulas'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FlaskConical className="w-3.5 h-3.5" />
          Fórmulas
        </button>
        <button
          onClick={() => setActiveTab('permissions')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'permissions'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Permisos
        </button>
        <button
          onClick={() => setActiveTab('salaries')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'salaries'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Briefcase className="w-3.5 h-3.5" />
          Salarios
        </button>
        <button
          onClick={() => setActiveTab('counters')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'counters'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Hash className="w-3.5 h-3.5" />
          Contadores
        </button>
        <button
          onClick={() => setActiveTab('waste')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'waste'
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          Desperdicio
        </button>
        <button
          onClick={() => setActiveTab('danger')}
          className={`flex-1 min-w-[140px] px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'danger'
              ? 'bg-red-600 text-white shadow-md shadow-red-200'
              : 'text-red-400 hover:text-red-700 hover:bg-red-50'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Config. Avanzada
        </button>
      </div>

      {activeTab === 'sql' ? (
        <SQLIntegration />
      ) : activeTab === 'mappings' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <SQLMappingEditor />
        </div>
      ) : activeTab === 'counters' ? (
        <CounterControl />
      ) : activeTab === 'shifts' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Planificación de Turnos</h2>
            </div>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {saving ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <Save className="w-4 h-4" />}
              Guardar Planificación
            </button>
          </div>

          <div className="max-w-4xl space-y-8">
            <div className="bg-slate-50 border border-slate-250 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="enable-shift-change"
                  checked={!!(config.shiftConfig as any)?.changeDate}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    if (enabled) {
                      setConfig({
                        ...config,
                        shiftConfig: {
                          ...config.shiftConfig!,
                          changeDate: new Date().toISOString().split('T')[0],
                          previousWeeklyPlan: JSON.parse(JSON.stringify(config.shiftConfig!.weeklyPlan))
                        }
                      });
                    } else {
                      setConfig({
                        ...config,
                        shiftConfig: {
                          ...config.shiftConfig!,
                          changeDate: '',
                          previousWeeklyPlan: undefined
                        }
                      });
                      setEditingPreviousScheme(false);
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="enable-shift-change" className="text-sm font-bold text-slate-800 select-none">
                  Hubo un cambio de esquema de planificación de turnos en este mes
                </label>
              </div>

              {!!(config.shiftConfig as any)?.changeDate && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-250">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                      Fecha de entrada en vigencia del Esquema Nuevo
                    </label>
                    <input
                      type="date"
                      value={(config.shiftConfig as any)?.changeDate || ''}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          shiftConfig: {
                            ...config.shiftConfig!,
                            changeDate: e.target.value
                          }
                        });
                      }}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Antes de esta fecha se usará el <b>Esquema Anterior</b>. A partir de esta fecha (inclusive) se utilizará el <b>Esquema Nuevo</b>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                      Esquema a Visualizar/Editar abajo
                    </label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setEditingPreviousScheme(false)}
                        className={`px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
                          !editingPreviousScheme
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        Esquema Nuevo
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPreviousScheme(true)}
                        className={`px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
                          editingPreviousScheme
                            ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        Esquema Anterior (Viejo)
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {!editingPreviousScheme ? (
                        <span className="text-blue-600 font-medium">Editando plan vigente a partir del {(config.shiftConfig as any)?.changeDate}</span>
                      ) : (
                        <span className="text-amber-600 font-medium">Editando plan histórico anterior al {(config.shiftConfig as any)?.changeDate}</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <section>
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-gray-400" />
                Planificación Semanal Detallada {editingPreviousScheme ? '(Esquema Anterior)' : '(Esquema Nuevo)'}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Configura la cantidad de turnos (líneas activas) y la duración específica para cada turno por día para el 
                <span className="font-semibold text-blue-600 ml-1">
                  {editingPreviousScheme ? 'Esquema Anterior' : 'Esquema Nuevo'}
                </span>.
              </p>
              
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-r">Día</th>
                      {['Mañana', 'Tarde', 'Noche'].map(s => (
                        <th key={s} className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider border-r" colSpan={2}>{s}</th>
                      ))}
                      <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Total</th>
                    </tr>
                    <tr className="bg-gray-100/50">
                      <th className="border-r"></th>
                      {['Mañana', 'Tarde', 'Noche'].map(s => (
                        <Fragment key={s}>
                          <th className="px-2 py-1 text-[10px] text-gray-400 font-medium text-center border-r">Cant.</th>
                          <th className="px-2 py-1 text-[10px] text-gray-400 font-medium text-center border-r">Min.</th>
                        </Fragment>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => {
                      const currentWeeklyPlan = (editingPreviousScheme && config.shiftConfig?.previousWeeklyPlan) 
                        ? config.shiftConfig.previousWeeklyPlan 
                        : (config.shiftConfig?.weeklyPlan || {});
                      const dayPlan = currentWeeklyPlan[day] || {};
                      let totalDayShifts = 0;
                      Object.values(dayPlan).forEach((p: any) => totalDayShifts += (p.count || 0));
                      
                      return (
                        <tr key={day} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-gray-700 capitalize border-r bg-gray-50/30">
                            {day === 'monday' && 'Lunes'}
                            {day === 'tuesday' && 'Martes'}
                            {day === 'wednesday' && 'Miércoles'}
                            {day === 'thursday' && 'Jueves'}
                            {day === 'friday' && 'Viernes'}
                            {day === 'saturday' && 'Sábado'}
                            {day === 'sunday' && 'Domingo'}
                          </td>
                          {['Mañana', 'Tarde', 'Noche'].map(shift => {
                            const p = (dayPlan as any)[shift] || { count: 0, duration: 480 };
                            return (
                              <Fragment key={shift}>
                                <td className="px-2 py-2 border-r">
                                  <input 
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.5"
                                    value={p.count}
                                    onChange={(e) => {
                                      const count = Math.max(0, Number(e.target.value));
                                      const targetKey = editingPreviousScheme ? 'previousWeeklyPlan' : 'weeklyPlan';
                                      const currentTargetPlan = config.shiftConfig?.[targetKey] || {};
                                      setConfig({
                                        ...config,
                                        shiftConfig: {
                                          ...config.shiftConfig!,
                                          [targetKey]: {
                                            ...currentTargetPlan,
                                            [day]: {
                                              ...dayPlan,
                                              [shift]: { ...p, count }
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    className={`w-12 text-center text-sm border rounded p-1 focus:ring-1 focus:ring-blue-500 ${p.count > 0 ? 'bg-blue-50 border-blue-200 font-bold text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
                                  />
                                </td>
                                <td className="px-2 py-2 border-r">
                                  <input 
                                    type="number"
                                    min="0"
                                    value={p.duration}
                                    onChange={(e) => {
                                      const duration = Math.max(0, Number(e.target.value));
                                      const targetKey = editingPreviousScheme ? 'previousWeeklyPlan' : 'weeklyPlan';
                                      const currentTargetPlan = config.shiftConfig?.[targetKey] || {};
                                      setConfig({
                                        ...config,
                                        shiftConfig: {
                                          ...config.shiftConfig!,
                                          [targetKey]: {
                                            ...currentTargetPlan,
                                            [day]: {
                                              ...dayPlan,
                                              [shift]: { ...p, duration }
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    className={`w-16 text-center text-xs border rounded p-1 focus:ring-1 focus:ring-blue-500 ${p.count > 0 ? 'bg-white border-gray-300' : 'bg-gray-50 border-gray-100 text-gray-300'}`}
                                  />
                                </td>
                              </Fragment>
                            );
                          })}
                          <td className="px-4 py-3 text-right text-sm font-black text-blue-600 bg-blue-50/20">
                            {totalDayShifts}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="text-sm font-bold text-blue-800 mb-2">Resumen de Horas Semanales Planificadas {editingPreviousScheme ? '(Esquema Anterior)' : '(Esquema Nuevo)'}:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  {['Mañana', 'Tarde', 'Noche'].map(shift => {
                    let weeklyHours = 0;
                    const currentWeeklyPlan = (editingPreviousScheme && config.shiftConfig?.previousWeeklyPlan) 
                      ? config.shiftConfig.previousWeeklyPlan 
                      : (config.shiftConfig?.weeklyPlan || {});
                    Object.values(currentWeeklyPlan).forEach((dayPlan: any) => {
                      const p = dayPlan[shift];
                      if (p && p.count > 0) {
                        // We calculate hours per line (duration of the shift)
                        weeklyHours += p.duration / 60;
                      }
                    });
                    return (
                      <div key={shift} className="bg-white p-2 rounded border border-blue-200">
                        <span className="text-xs text-gray-500 block">{shift}</span>
                        <span className="text-lg font-black text-blue-700">{weeklyHours.toFixed(1)} hs/sem</span>
                      </div>
                    );
                  })}
                  
                  {(() => {
                    const standardDays = ['monday', 'tuesday', 'wednesday', 'thursday'];
                    let standardDaysSum = 0;
                    const currentWeeklyPlan = (editingPreviousScheme && config.shiftConfig?.previousWeeklyPlan) 
                      ? config.shiftConfig.previousWeeklyPlan 
                      : (config.shiftConfig?.weeklyPlan || {});
                    standardDays.forEach(day => {
                      const dayPlan = currentWeeklyPlan[day] || {};
                      ['Mañana', 'Tarde', 'Noche'].forEach(shift => {
                        standardDaysSum += (dayPlan[shift]?.count || 0);
                      });
                    });
                    const avg = standardDaysSum / standardDays.length;
                    return (
                      <div className="bg-blue-600 p-2 rounded border border-blue-700 text-white shadow-sm">
                        <span className="text-xs text-blue-100 block">Promedio Lun-Jue</span>
                        <span className="text-lg font-black">{avg.toFixed(1)} turnos/día</span>
                      </div>
                    );
                  })()}
                </div>
              </div>

            </section>
            <section className="border-t border-gray-100 pt-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  Feriados y Días No Operativos
                </h3>
                
                <div className="flex items-center gap-3 bg-orange-50 p-2 rounded-lg border border-orange-100">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <span className="text-xs font-bold text-orange-800 uppercase">Duración Noche Feriado:</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number"
                      min="0"
                      step="30"
                      value={config.shiftConfig?.holidayNightDuration || 360}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value));
                        setConfig({
                          ...config,
                          shiftConfig: {
                            ...config.shiftConfig!,
                            holidayNightDuration: val
                          }
                        });
                      }}
                      className="w-16 text-center text-xs border border-orange-200 rounded p-1 focus:ring-1 focus:ring-orange-500 bg-white font-bold text-orange-700"
                    />
                    <span className="text-[10px] font-bold text-orange-400 uppercase">min</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Agrega fechas específicas donde la planta no operará (feriados). Los turnos planificados para estas fechas se considerarán 0.
              </p>
              
              <div className="flex flex-wrap gap-4 items-end mb-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nueva Fecha</label>
                  <input 
                    type="date"
                    id="new-holiday"
                    className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                  />
                </div>
                <button 
                  onClick={() => {
                    const input = document.getElementById('new-holiday') as HTMLInputElement;
                    const date = input.value;
                    if (date && !config.shiftConfig?.holidays?.includes(date)) {
                      setConfig({
                        ...config,
                        shiftConfig: {
                          ...config.shiftConfig!,
                          holidays: [...(config.shiftConfig!.holidays || []), date].sort()
                        }
                      });
                      input.value = '';
                    }
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-bold"
                >
                  <Plus className="w-4 h-4" />
                  Agregar Feriado
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {config.shiftConfig?.holidays?.map(date => (
                  <div key={date} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 group">
                    <span className="text-xs font-bold text-gray-700">
                      {new Date(date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                    <button 
                      onClick={() => {
                        setConfig({
                          ...config,
                          shiftConfig: {
                            ...config.shiftConfig!,
                            holidays: config.shiftConfig!.holidays?.filter(h => h !== date) || []
                          }
                        });
                      }}
                      className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {(!config.shiftConfig?.holidays || config.shiftConfig.holidays.length === 0) && (
                  <div className="col-span-full py-4 text-center text-gray-400 text-xs italic">
                    No hay feriados configurados.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : activeTab === 'config' ? (
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

          {/* Líneas */}
          </section>
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Líneas y Personal Requerido</h3>
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
            <div className="grid grid-cols-1 gap-2">
              {Array.isArray(config.lines) && config.lines.length > 0 ? (
                config.lines.map(line => (
                  <div key={line} className="flex flex-col gap-2 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => handleToggleLine(line)}
                        className={`flex items-center gap-2 transition-all ${
                          config.enabledLines?.[line] !== false
                            ? 'text-blue-700' 
                            : 'text-gray-400 opacity-60'
                        }`}
                      >
                        {config.enabledLines?.[line] !== false ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                        <span className="font-medium text-base">Línea {line}</span>
                      </button>

                      {deleteConfirm?.type === 'line' && deleteConfirm.id === line ? (
                        <button
                          onClick={() => {
                            if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                            else handleDeleteLine(line);
                          }}
                          onMouseLeave={() => setDeleteConfirm(null)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                            deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-600 border border-orange-200' : 'bg-red-600 text-white'
                          }`}
                        >
                          {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                        </button>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm({ type: 'line', id: line, step: 1 })}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    
                    {config.enabledLines?.[line] !== false && (
                      <div className="flex items-center justify-between border-t border-gray-100 pt-2 mt-1">
                        <span className="text-xs text-gray-600 font-medium">Operarios requeridos:</span>
                        <input
                          type="number"
                          min="0"
                          value={config.lineOperators?.[line] || 0}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setConfig({
                              ...config,
                              lineOperators: {
                                ...(config.lineOperators || {}),
                                [line]: val
                              }
                            });
                          }}
                          className="w-20 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 text-center"
                        />
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 italic col-span-2 text-center py-4">No hay líneas registradas</p>
              )}
            </div>

          {/* Sabores */}
          </section>
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

          {/* Eficiencia Excluidos */}
          </section>
          <section className="bg-gray-50 p-4 rounded-xl border border-gray-200 lg:col-span-2">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Configuración de Eficiencia (Exclusiones de Paradas)</h3>
            <p className="text-sm text-gray-600 mb-4">Ingrese las razones o categorías de paradas que deben ser excluidas de los cálculos de eficiencia (separadas por coma):</p>
            <input
              type="text"
              value={config.efficiencyExcludedDowntimes?.join(', ') || ''}
              onChange={e => {
                const val = e.target.value.split(',').map(s => s.trim()).filter(s => s !== '');
                setConfig({ ...config, efficiencyExcludedDowntimes: val });
              }}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              placeholder="ej: Sin programa, Mantenimiento programado, OTRAS AJENAS A LINEA"
            />

          {/* Calibres */}
          </section>
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

          {/* Supervisores */}
          </section>
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

          {/* Químicos */}
          </section>
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

          {/* Control de Datos Históricos */}
          </section>
          <section className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 lg:col-span-2 shadow-sm">
            <h3 className="text-lg font-bold text-indigo-900 mb-4 border-b border-indigo-200 pb-2 flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-600" />
              Gestión de Datos Históricos (Importados)
            </h3>
            <p className="text-sm text-indigo-700 mb-6 font-medium">
              Define si los datos con origen "Historial" se incluyen en los cálculos globales de eficiencia y dashboards, o si se filtran por fecha.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-indigo-200 shadow-sm transition-all hover:border-indigo-400">
                  <div className="pr-4">
                    <span className="block font-black text-gray-900 text-sm tracking-tight">MOSTRAR HISTORIAL GLOBAL</span>
                    <span className="text-[10px] text-gray-500 font-medium italic">Si se activa, el Dashboard ignorará la fecha de filtrado histórico y mostrará todo.</span>
                  </div>
                  <button
                    onClick={() => setConfig({
                      ...config,
                      historicalSettings: {
                        ...(config.historicalSettings || { showHistoricalGlobal: false }),
                        showHistoricalGlobal: !config.historicalSettings?.showHistoricalGlobal
                      }
                    })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                      config.historicalSettings?.showHistoricalGlobal ? 'bg-indigo-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        config.historicalSettings?.showHistoricalGlobal ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-white rounded-xl border border-indigo-200 shadow-sm transition-all hover:border-indigo-400">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Fecha de Inicio de Visualización</label>
                  <input
                    type="date"
                    value={config.historicalSettings?.historicalStartDate || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      historicalSettings: {
                        ...(config.historicalSettings || { showHistoricalGlobal: false }),
                        historicalStartDate: e.target.value
                      }
                    })}
                    className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm border p-2 bg-indigo-50/20 font-bold"
                  />
                  <p className="mt-3 text-[10px] text-indigo-500 font-medium bg-indigo-50 p-2 rounded border border-indigo-100 flex items-start gap-2">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span>Los reportes manuales (Parte Diario) se muestran siempre. Los históricos se ocultan si son anteriores a esta fecha <strong>Y</strong> el toggle de la izquierda está apagado.</span>
                  </p>
                </div>
              </div>
            </div>

          {/* Corte de Gestión */}
          </section>
          <section className="bg-emerald-50 p-6 rounded-xl border border-emerald-100 lg:col-span-2 shadow-sm">
            <h3 className="text-lg font-bold text-emerald-900 mb-4 border-b border-emerald-200 pb-2 flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-600" />
              Hito de Cambio de Gestión
            </h3>
            <p className="text-sm text-emerald-700 mb-6 font-medium">
              Define una fecha de hito o cambio de gestión. Al establecerla, se habilitarán filtros en los reportes (Dashboard, Resumen Gerencial, etc.) para comparar la gestión anterior con la actual.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="p-4 bg-white rounded-xl border border-emerald-200 shadow-sm transition-all hover:border-emerald-400">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Fecha de Inicio de Gestión Actual</label>
                  <input
                    type="date"
                    value={config.managementSettings?.managementStartDate || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      managementSettings: {
                        ...(config.managementSettings || { showPreviousManagementGlobal: true }),
                        managementStartDate: e.target.value
                      }
                    })}
                    className="w-full rounded-lg border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 text-sm border p-2 bg-emerald-50/20 font-bold"
                  />
                  <p className="mt-3 text-[10px] text-emerald-600 font-medium bg-emerald-50 p-2 rounded border border-emerald-100 flex items-start gap-2">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span>Los reportes permitirán filtrar por "Gestión Actual" o "Gestión Anterior" en base a esta fecha.</span>
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Combinaciones Marca-Sabor */}
        <section className="mt-12">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Productos Activos por Calibre</h3>
          <p className="text-sm text-gray-500 mb-6 font-medium">Define qué combinaciones exactas de Marca, Calibre y Sabor están activas.</p>
          
          {/* Summary of Active Combinations */}
          {config.activeProducts && Object.keys(config.activeProducts).length > 0 && (
            <div className="mb-8 bg-gray-50 rounded-2xl border border-gray-200 p-6">
              <h4 className="text-sm font-black text-gray-700 uppercase tracking-widest mb-4">Resumen de Combinaciones Configuradas</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(config.activeProducts).map(([brand, sizes]) => (
                  Object.entries(sizes).map(([size, flavors]) => (
                    flavors.length > 0 && (
                      <div key={`${brand}-${size}`} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{brand}</span>
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">{size} cc</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {flavors.map(f => (
                            <span key={f} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">{f}</span>
                          ))}
                        </div>
                      </div>
                    )
                  ))
                )).flat().filter(Boolean)}
              </div>
            </div>
          )}

          <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 flex flex-wrap gap-6 items-end mb-8 shadow-sm">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-black text-blue-800 uppercase mb-2 tracking-widest">1. Seleccionar Marca</label>
              <select 
                value={selectedBrandForTriple}
                onChange={(e) => setSelectedBrandForTriple(e.target.value)}
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500 text-blue-900"
              >
                <option value="">Seleccione una marca...</option>
                {config.brands.filter(b => config.enabledBrands?.[b] !== false).map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-black text-blue-800 uppercase mb-2 tracking-widest">2. Seleccionar Calibre</label>
              <select 
                value={selectedSizeForTriple || ''}
                onChange={(e) => setSelectedSizeForTriple(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500 text-blue-900"
              >
                <option value="">Seleccione un calibre...</option>
                {config.sizes.filter(s => config.enabledSizes?.[s] !== false).map(s => (
                  <option key={s} value={s}>{s} cc</option>
                ))}
              </select>
            </div>
          </div>

          {selectedBrandForTriple && selectedSizeForTriple ? (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-xl font-black text-gray-900 font-mono uppercase tracking-tighter">
                    {selectedBrandForTriple} - {selectedSizeForTriple} cc
                    {!(config.activeProducts?.[selectedBrandForTriple] && selectedSizeForTriple.toString() in config.activeProducts[selectedBrandForTriple]) && (
                      <span className="ml-3 text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full align-middle normal-case font-bold tracking-normal">
                        Usando valores por defecto de marca
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-gray-400 font-medium">Habilitar/Deshabilitar sabores para esta combinación específica:</p>
                </div>
                <div className="flex gap-2">
                   <button 
                    onClick={() => {
                      const sizeStr = selectedSizeForTriple.toString();
                      const currentActiveProducts = config.activeProducts || {};
                      const brandActiveProducts = currentActiveProducts[selectedBrandForTriple] || {};
                      
                      setConfig({
                        ...config,
                        activeProducts: {
                          ...currentActiveProducts,
                          [selectedBrandForTriple]: {
                            ...brandActiveProducts,
                            [sizeStr]: [...config.flavors]
                          }
                        }
                      });
                    }}
                    className="text-[10px] font-black uppercase px-3 py-1 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors"
                   >
                     Habilitar Todos
                   </button>
                   <button 
                    onClick={() => {
                      const sizeStr = selectedSizeForTriple.toString();
                      const currentActiveProducts = config.activeProducts || {};
                      const brandActiveProducts = currentActiveProducts[selectedBrandForTriple] || {};
                      
                      setConfig({
                        ...config,
                        activeProducts: {
                          ...currentActiveProducts,
                          [selectedBrandForTriple]: {
                            ...brandActiveProducts,
                            [sizeStr]: []
                          }
                        }
                      });
                    }}
                    className="text-[10px] font-black uppercase px-3 py-1 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors"
                   >
                     Deshabilitar Todos
                   </button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {config.flavors.map(flavor => {
                  const sizeStr = selectedSizeForTriple.toString();
                  const brandActiveProducts = config.activeProducts?.[selectedBrandForTriple];
                  const hasSpecificConfig = brandActiveProducts && sizeStr in brandActiveProducts;
                  const currentActiveFlavors = hasSpecificConfig
                    ? brandActiveProducts[sizeStr]
                    : (config.brandFlavorCombinations[selectedBrandForTriple] || []);
                  
                  const isEnabled = currentActiveFlavors.includes(flavor);
                  const isExternal = (config.externalProducts?.[selectedBrandForTriple]?.[sizeStr] || []).includes(flavor);
                  const isFlavorActive = config.enabledFlavors?.[flavor] !== false;

                  return (
                    <div key={flavor} className="flex flex-col gap-1.5">
                      <button
                        disabled={!isFlavorActive}
                        onClick={() => handleToggleTripleCombination(selectedBrandForTriple, selectedSizeForTriple, flavor)}
                        className={`w-full px-4 py-3 rounded-2xl border text-xs font-black uppercase transition-all flex items-center justify-between gap-2 shadow-sm ${
                          isEnabled
                            ? 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-50 shadow-blue-100'
                            : 'bg-white border-gray-100 text-gray-400 hover:border-blue-200 hover:text-blue-600'
                        } ${(!isFlavorActive) ? 'opacity-20 grayscale cursor-not-allowed border-dashed' : ''}`}
                      >
                        <span className="truncate">{flavor}</span>
                        {isEnabled && <CheckCircle2 className="w-4 h-4" />}
                      </button>
                      
                      {isEnabled && (
                        <button
                          onClick={() => handleToggleExternalProduct(selectedBrandForTriple, selectedSizeForTriple, flavor)}
                          className={`text-[9px] font-black uppercase py-1.5 px-3 rounded-xl transition-all border ${
                            isExternal 
                              ? 'bg-purple-600 border-purple-600 text-white shadow-sm shadow-purple-100' 
                              : 'bg-white border-gray-100 text-gray-400 hover:border-purple-200 hover:text-purple-600'
                          }`}
                        >
                          {isExternal ? 'Producto Externo' : 'Producción Local'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
              <Plus className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-400 font-medium">Selecciona una marca y un calibre para empezar a configurar las combinaciones de sabores.</p>
            </div>
          )}

        </section>
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
      ) : null}

      {activeTab === 'users' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-2">
              <UserCog className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Gestión de Usuarios</h2>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] font-black text-blue-800 uppercase mb-1 tracking-widest">Email del Usuario</label>
                <input 
                  type="email"
                  value={newUserEmail}
                  onChange={e => setNewUserEmail(e.target.value)}
                  placeholder="ejemplo@correo.com"
                  className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="w-40">
                <label className="block text-[10px] font-black text-blue-800 uppercase mb-1 tracking-widest">Rol</label>
                <select 
                  value={newUserRole}
                  onChange={e => setNewUserRole(e.target.value as UserRole)}
                  className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="produccion">Producción</option>
                  <option value="calidad">Calidad</option>
                  <option value="jefe_produccion">Jefe Producción</option>
                  <option value="admin">Admin General</option>
                </select>
              </div>
              <div className="w-40">
                <label className="block text-[10px] font-black text-blue-800 uppercase mb-1 tracking-widest">Sector</label>
                <select 
                  value={newUserSector}
                  onChange={e => setNewUserSector(e.target.value)}
                  className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Cualquiera</option>
                  <option value="Producción">Producción</option>
                  <option value="Elaboración">Elaboración</option>
                  <option value="Calidad">Calidad</option>
                </select>
              </div>
              <button
                onClick={handleAddAllowedUser}
                disabled={isAddingUser || !newUserEmail.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all h-[38px] flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Habilitar
              </button>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Habilitaciones Pendientes de Registro ({trulyPendingAllowedUsers.length})
              </h3>
              {trulyPendingAllowedUsers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Rol Pre-definido</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Sector</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Fecha Invit.</th>
                        <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {trulyPendingAllowedUsers.map(au => (
                        <tr key={au.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600">{au.email}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 py-1 text-[10px] font-black uppercase bg-amber-100 text-amber-700 rounded-full">{au.role}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{au.sector || 'Cualquiera'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400">
                             {au.createdAt ? new Date(au.createdAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <button 
                               onClick={() => handleDeleteAllowedUser(au.id)}
                               className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-full transition-colors"
                               title="Revocar acceso"
                            >
                               <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/50">
                  <p className="text-gray-400 text-sm italic font-medium">No hay invitaciones pendientes</p>
                </div>
              )}
            </div>

            <div>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Usuarios Registrados en Sistema ({users.length})
                </h3>
                <div className="relative w-full sm:w-64">
                   <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                   <input 
                     type="text"
                     placeholder="Buscar por nombre o email..."
                     value={userSearch}
                     onChange={e => setUserSearch(e.target.value)}
                     className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                   />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-blue-900 mb-1">¿Un usuario se registró pero no aparece aquí?</h4>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      Para que un usuario aparezca en esta lista, primero debe estar en <b>Habilitaciones Pendientes</b> con su email exacto. 
                      Una vez que el usuario inicia sesión por primera vez con ese email, el sistema crea su perfil y pasará automáticamente a esta lista de <b>Usuarios Registrados</b>.
                      Si el usuario ya se registró en Firebase pero no fue habilitado previamente, verá un mensaje de "Acceso Restringido" hasta que usted lo habilite arriba y el usuario vuelva a entrar.
                    </p>
                  </div>
                </div>
              </div>

              {filteredUsers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Usuario</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Rol</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Sector</th>
                        <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredUsers.map(u => (
                        <tr key={u.uid} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              {u.photoURL ? (
                                <img src={u.photoURL} className="w-8 h-8 rounded-full border border-gray-200" alt="" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600 border border-blue-200">
                                  {u.displayName?.substring(0, 1) || 'U'}
                                </div>
                              )}
                              <span className="text-sm font-bold text-gray-900">{u.displayName}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{u.email}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={u.role}
                              onChange={(e) => handleUpdateUser({ ...u, role: e.target.value as UserRole })}
                              className="text-[10px] font-black uppercase tracking-widest bg-white border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                            >
                              <option value="admin">Admin General</option>
                              <option value="jefe_produccion">Jefe Producción</option>
                              <option value="produccion">Producción</option>
                              <option value="calidad">Calidad</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={u.sector || ''}
                              onChange={(e) => handleUpdateUser({ ...u, sector: e.target.value })}
                              className="text-[10px] font-black uppercase tracking-widest bg-white border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                            >
                              <option value="">Sin Sector</option>
                              <option value="Producción">Producción</option>
                              <option value="Elaboración">Elaboración</option>
                              <option value="Calidad">Calidad</option>
                              <option value="Administración">Administración</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                               {u.email === 'fraed.fordrinks@gmail.com' && (
                                  <span className="px-2 py-0.5 bg-gray-900 text-white text-[8px] font-black rounded italic">ROOT</span>
                               )}
                               <button className="text-blue-600 hover:text-blue-800 font-bold text-[10px] uppercase tracking-widest bg-blue-50 px-2 py-1 rounded">
                                 LOGS
                               </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/50">
                  <p className="text-gray-400 text-sm italic font-medium">
                    {userSearch ? `No se encontraron usuarios que coincidan con "${userSearch}"` : 'No hay usuarios registrados'}
                  </p>
                </div>
              )}
            </div>
      </div>
    </div>
  )}

      {activeTab === 'formulas' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Formulaciones</h2>
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
              <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
               <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Uso de Jarabe</h3>
               <p className="text-xs text-gray-500 mb-4">Seleccione qué sabores NO utilizan jarabe en su elaboración (ej. Agua, Soda).</p>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {config.flavors.map(sabor => {
                     const sinJarabe = (config.saboresSinJarabe || SABORES_SIN_JARABE).includes(sabor);
                     return (
                       <button
                         key={sabor}
                         onClick={() => {
                            const list = config.saboresSinJarabe || [...SABORES_SIN_JARABE];
                            if (sinJarabe) {
                               setConfig({...config, saboresSinJarabe: list.filter(s => s !== sabor)});
                            } else {
                               setConfig({...config, saboresSinJarabe: [...list, sabor]});
                            }
                         }}
                         className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                           sinJarabe
                             ? 'bg-orange-50 border-orange-200 text-orange-700 shadow-sm'
                             : 'bg-white border-gray-200 text-gray-500'
                         }`}
                       >
                         <span className="font-medium">{sabor}</span>
                         <span className="text-[10px]">{sinJarabe ? 'NO LLEVA' : 'USA JARABE'}</span>
                       </button>
                     );
                  })}
               </div>
              
              </section>
              <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                 <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Control de Calidad (Por Liberar)</h3>
                 <p className="text-xs text-gray-500 mb-4">Seleccione qué sabores pasan por Control de Calidad previo a su liberación (ej. Agua).</p>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {config.flavors.map(sabor => {
                       const isQC = (config.qualityControlFlavors || ['Agua']).includes(sabor);
                       return (
                         <button
                           key={sabor}
                           onClick={() => {
                              const list = config.qualityControlFlavors || ['Agua'];
                              if (isQC) {
                                 setConfig({...config, qualityControlFlavors: list.filter(s => s !== sabor)});
                              } else {
                                 setConfig({...config, qualityControlFlavors: [...list, sabor]});
                              }
                           }}
                           className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                             isQC
                               ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm' 
                               : 'bg-white border-gray-200 text-gray-500'
                           }`}
                         >
                           <span className="font-medium text-sm">{sabor}</span>
                           {isQC ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-4 h-4 rounded-full border-2 border-gray-200" />}
                         </button>
                       );
                    })}
                 </div>

              </section>
              <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                 <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Almacenamiento y Logística</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                    <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Posiciones Totales en Galpón</label>
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-blue-500" />
                        <input
                          type="number"
                          min="1"
                          value={config.warehousePositions || 2300}
                          onChange={(e) => setConfig({ ...config, warehousePositions: Number(e.target.value) })}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 font-medium">Capacidad total teórica del depósito en posiciones de paleta.</p>
                    </div>
                 </div>

                 <p className="text-xs text-gray-500 mb-4">Seleccione qué sabores se pueden <b>apilar (doble paleta)</b> en una sola posición. Sabores como Soda Sifon suelen ocupar 1 posición por paleta.</p>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {config.flavors.map(sabor => {
                       const isStackable = (config.stackableFlavors || []).includes(sabor);
                       return (
                         <button
                           key={sabor}
                           onClick={() => {
                              const list = config.stackableFlavors || [];
                              if (isStackable) {
                                 setConfig({...config, stackableFlavors: list.filter(s => s !== sabor)});
                              } else {
                                 setConfig({...config, stackableFlavors: [...list, sabor]});
                              }
                           }}
                           className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-all ${
                             isStackable
                               ? 'bg-green-50 border-green-200 text-green-700 shadow-sm' 
                               : 'bg-white border-gray-200 text-gray-500'
                           }`}
                         >
                           <div className="flex flex-col items-start">
                             <span className="font-medium text-sm">{sabor}</span>
                             <span className="text-[10px] opacity-70">{isStackable ? 'Apilable (2/pos)' : 'No Apilable (1/pos)'}</span>
                           </div>
                           {isStackable ? <TrendingUp className="w-4 h-4 text-green-600" /> : <div className="w-4 h-4 rounded-full border-2 border-gray-200" />}
                         </button>
                       );
                    })}
                 </div>

              </section>
              <section className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                 <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Volúmenes de CO2</h3>
                 <p className="text-xs text-gray-500 mb-4">Ajuste el volumen de gas según Marca y Sabor. Deje en 0 para sabores como Agua que no llevan CO2.</p>
                 <div className="space-y-6">
                   {config.brands.map(brand => (
                      <div key={brand} className="space-y-3">
                         <h4 className="font-bold text-gray-700 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm ring-2 ring-blue-100"></div> {brand}</h4>
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                           {getFlavorsForBrand(brand).map(sabor => {
                              const val = config.co2Volumes?.[brand]?.[sabor] !== undefined ? config.co2Volumes[brand][sabor] : 0;
                              return (
                                 <div key={sabor} className="flex justify-between items-center bg-white p-2 rounded border border-gray-200 text-sm">
                                    <span className="truncate">{sabor}</span>
                                    <input 
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={val === 0 ? 0 : (val || '')}
                                      placeholder="0"
                                      onChange={(e) => {
                                          const newVal = Number(e.target.value);
                                          const currentVolumes = config.co2Volumes || {};
                                          const brandObj = currentVolumes[brand] || {};
                                          setConfig({
                                              ...config,
                                              co2Volumes: {
                                                  ...currentVolumes,
                                                  [brand]: {
                                                      ...brandObj,
                                                      [sabor]: newVal
                                                  }
                                              }
                                          });
                                      }}
                                      className="w-20 text-right rounded border-gray-300 bg-gray-50 hover:bg-white transition-colors shadow-sm p-1 px-2 border focus:border-blue-500 focus:ring-blue-500"
                                    />
                                 </div>
                              )
                           })}
                         </div>
                      </div>
                   ))}
                 </div>

              </section>
              <section className="bg-gray-50 p-4 rounded-xl border border-gray-200 lg:col-span-2">
                 <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Fórmulas de Jarabe (Por Unidad)</h3>
                 <p className="text-xs text-gray-500 mb-4">Defina los litros de jarabe y los kg de emulsión que conforman una "unidad" de jarabe, por Marca y Sabor.</p>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {config.brands.map(brand => (
                      <div key={brand} className="space-y-3">
                         <h4 className="font-bold text-gray-700 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm ring-2 ring-blue-100"></div> 
                            {brand}
                         </h4>
                         <div className="flex flex-col gap-2">
                           {getFlavorsForBrand(brand).filter(sabor => !(config.saboresSinJarabe || SABORES_SIN_JARABE).includes(sabor)).map(sabor => {
                              const formula = config.syrupFormulas?.[brand]?.[sabor] || { liters: 0, emulsion: 0 };
                              return (
                                 <div key={sabor} className="flex justify-between items-center bg-white p-2 rounded border border-gray-200 text-sm">
                                    <span className="truncate w-1/3">{sabor}</span>
                                    <div className="flex items-center gap-2 w-2/3 justify-end">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-gray-500 mb-1">Litros Jarabe</span>
                                            <input 
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={formula.liters === 0 ? '' : formula.liters}
                                                placeholder="L"
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    const current = config.syrupFormulas || {};
                                                    const brandObj = current[brand] || {};
                                                    setConfig({
                                                        ...config,
                                                        syrupFormulas: {
                                                            ...current,
                                                            [brand]: {
                                                                ...brandObj,
                                                                [sabor]: { ...(brandObj[sabor] || { emulsion: 0 }), liters: val }
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="w-24 text-right rounded border-gray-300 bg-gray-50 hover:bg-white transition-colors shadow-sm p-1 px-2 border focus:border-blue-500 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-gray-500 mb-1">Kg Emulsión</span>
                                            <input 
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={formula.emulsion === 0 ? '' : formula.emulsion}
                                                placeholder="Kg"
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    const current = config.syrupFormulas || {};
                                                    const brandObj = current[brand] || {};
                                                    setConfig({
                                                        ...config,
                                                        syrupFormulas: {
                                                            ...current,
                                                            [brand]: {
                                                                ...brandObj,
                                                                [sabor]: { ...(brandObj[sabor] || { liters: 0 }), emulsion: val }
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="w-24 text-right rounded border-gray-300 bg-gray-50 hover:bg-white transition-colors shadow-sm p-1 px-2 border focus:border-blue-500 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>
                                 </div>
                              )
                           })}
                         </div>
                      </div>
                   ))}
                 </div>

              </section>
              <section className="bg-gray-50 p-4 rounded-xl border border-gray-200 lg:col-span-2 overflow-x-auto">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b pb-2">
                   <div>
                     <h3 className="text-lg font-semibold text-gray-800">Matriz General de Insumos (Kg por Unidad)</h3>
                     <p className="text-xs text-gray-500 mt-1">Ajuste los kilogramos de cada insumo requeridos para una "unidad" de jarabe, por Marca y Sabor.</p>
                   </div>
                   <div className="flex gap-2">
                     <input 
                       type="text" 
                       value={newInsumo} 
                       onChange={e => setNewInsumo(e.target.value)}
                       placeholder="Nuevo insumo..."
                       className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 w-48"
                     />
                     <button 
                       onClick={handleAddInsumo}
                       className="bg-indigo-600 text-white px-3 py-2 rounded-md hover:bg-indigo-700 font-medium text-sm flex items-center gap-2 transition-colors"
                     >
                       <Plus className="w-4 h-4" />
                       Agregar Insumo
                     </button>
                   </div>
                 </div>
                 
                 {/* List of currently managed insumos so they can be deleted */}
                 <div className="mb-6 mb-8">
                   <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Gestión de Insumos</h4>
                   <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg shadow-sm">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Insumo</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Categoría</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Criticidad</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Presentación (Lote)</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {config.insumos?.map(insumo => (
                            <tr key={insumo} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-gray-900">
                                {insumo}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                <input
                                  type="text"
                                  placeholder="Ej: Bases, Jugos, Químicos..."
                                  value={config.insumosCategories?.[insumo] || ''}
                                  onChange={e => handleUpdateInsumoCategory(insumo, e.target.value)}
                                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs w-full max-w-[150px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                                  list="categories-list"
                                />
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-center text-sm text-gray-500">
                                <input
                                  type="number"
                                  step="0.1"
                                  min="1"
                                  value={config.insumosCriticality?.[insumo] || 1}
                                  onChange={e => handleUpdateInsumoPurchasing(insumo, 'criticality', e.target.value)}
                                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-[70px] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                                  title="Factor multiplicador (ej. 1.2)"
                                />
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-center text-sm text-gray-500 flex items-center justify-center space-x-1">
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  value={config.insumosPurchaseLots?.[insumo]?.size || 1}
                                  onChange={e => handleUpdateInsumoPurchasing(insumo, 'lotSize', e.target.value)}
                                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-[70px] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                                />
                                <input
                                  type="text"
                                  placeholder="kg, L, un"
                                  value={config.insumosPurchaseLots?.[insumo]?.unit || 'kg'}
                                  onChange={e => handleUpdateInsumoPurchasing(insumo, 'lotUnit', e.target.value)}
                                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-[60px] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                                />
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                {deleteConfirm?.type === 'insumo' && deleteConfirm.id === insumo ? (
                                  <button
                                    onClick={() => {
                                      if (deleteConfirm.step === 1) setDeleteConfirm({ ...deleteConfirm, step: 2 });
                                      else handleDeleteInsumo(insumo);
                                    }}
                                    onMouseLeave={() => setDeleteConfirm(null)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                      deleteConfirm.step === 1 ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' : 'bg-red-600 text-white hover:bg-red-700'
                                    }`}
                                  >
                                    {deleteConfirm.step === 1 ? '¿Borrar?' : '¡CONFIRMAR!'}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setDeleteConfirm({ type: 'insumo', id: insumo, step: 1 })}
                                    className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg transition-colors hover:bg-red-50"
                                    title="Eliminar insumo"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <datalist id="categories-list">
                        {Array.from(new Set(Object.values(config.insumosCategories || {}).filter(Boolean))).map(cat => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
                 </div>

                 {/* Orden de Categorías en el Reporte */}
                 <div className="mb-6 mb-8 bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                   <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Orden de Categorías en el Reporte</h4>
                   <p className="text-xs text-gray-500 mb-4">
                     Defina la secuencia en que las categorías de insumos se muestran en la pestaña "Materias Primas e Ingredientes" del reporte usando los controles de subir / bajar.
                   </p>
                   
                   {(() => {
                     const allCats = Array.from(new Set(Object.values(config.insumosCategories || {}).filter(Boolean))) as string[];
                     const orderedCats = [...allCats].sort((a, b) => {
                       const idxA = (config.insumosCategoriesOrder || []).indexOf(a);
                       const idxB = (config.insumosCategoriesOrder || []).indexOf(b);
                       if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                       if (idxA === -1) return 1;
                       if (idxB === -1) return -1;
                       return idxA - idxB;
                     });

                     if (orderedCats.length === 0) {
                       return (
                         <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg p-3 border border-gray-200">
                           Asigne categorías a sus insumos en la tabla superior para visualizar y ordenar las categorías aquí.
                         </div>
                       );
                     }

                     const handleMoveCategory = (cat: string, direction: 'up' | 'down') => {
                       const currentOrder = [...(config.insumosCategoriesOrder || [])];
                       // Ensure all existing categories are listed in the order array
                       orderedCats.forEach((c: string) => {
                         if (!currentOrder.includes(c)) {
                           currentOrder.push(c);
                         }
                       });

                       const index = currentOrder.indexOf(cat);
                       if (index === -1) return;

                       if (direction === 'up' && index > 0) {
                         const temp = currentOrder[index];
                         currentOrder[index] = currentOrder[index - 1];
                         currentOrder[index - 1] = temp;
                       } else if (direction === 'down' && index < currentOrder.length - 1) {
                         const temp = currentOrder[index];
                         currentOrder[index] = currentOrder[index + 1];
                         currentOrder[index + 1] = temp;
                       }

                       // Filter to active categories
                       const finalOrder = currentOrder.filter(c => allCats.includes(c));

                       setConfig({
                         ...config,
                         insumosCategoriesOrder: finalOrder
                       });
                     };

                     return (
                       <div className="space-y-2 max-w-md">
                         {orderedCats.map((cat, idx) => (
                           <div key={cat} className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-lg p-2.5 px-3.5 text-xs font-medium text-gray-700 hover:bg-gray-100/55 transition-colors">
                             <span className="font-bold text-gray-800">{cat}</span>
                             <div className="flex gap-1.5">
                               <button
                                 onClick={() => handleMoveCategory(cat, 'up')}
                                 disabled={idx === 0}
                                 className={`p-1 bg-white border border-gray-200 rounded-md text-gray-500 shadow-sm transition-all ${idx === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/50'}`}
                                 title="Subir"
                               >
                                 <ArrowUp className="w-3.5 h-3.5" />
                               </button>
                               <button
                                 onClick={() => handleMoveCategory(cat, 'down')}
                                 disabled={idx === orderedCats.length - 1}
                                 className={`p-1 bg-white border border-gray-200 rounded-md text-gray-500 shadow-sm transition-all ${idx === orderedCats.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/50'}`}
                                 title="Bajar"
                               >
                                 <ArrowDown className="w-3.5 h-3.5" />
                               </button>
                             </div>
                           </div>
                         ))}
                       </div>
                     );
                   })()}
                 </div>

                 {/* Configuración de Compras - Días de Margen por Categoría */}
                 <div className="mb-8">
                   <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Días de Margen de Seguridad por Categoría</h4>
                   <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg shadow-sm">
                     <table className="min-w-full divide-y divide-gray-200 text-sm">
                       <thead className="bg-gray-50/50">
                         <tr>
                           <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Categoría</th>
                           <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Días de Cobertura de Seguridad</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-200">
                         {uniqueInsumoCategories.map(cat => (
                           <tr key={cat} className="hover:bg-gray-50/50 transition-colors">
                             <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-gray-900">
                               {cat}
                             </td>
                             <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                               <input
                                 type="number"
                                 step="1"
                                 min="0"
                                 value={config.categorySecurityDays?.[cat] ?? 0}
                                 onChange={e => handleUpdateCategorySecurityDays(cat, parseInt(e.target.value) || 0)}
                                 className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs w-24 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                               />
                               <span className="ml-2 text-xs text-gray-400">días de consumo promedio</span>
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>

                 {/* Insumos Compatibles / Equivalentes */}
                 <div className="mb-8 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                   <div className="flex flex-col md:flex-row gap-6">
                     <div className="flex-1">
                       <h4 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                         <Link2 className="w-4 h-4" /> 
                         Grupos de Insumos Equivalentes
                       </h4>
                       <p className="text-xs text-blue-700 mb-4 max-w-lg">
                         Cree grupos de insumos que se pueden usar de forma intercambiable en las fórmulas (ej. Azúcar y Azúcar Refinada). El sistema sumará su stock cuando calcule requerimientos y disponibilidad.
                       </p>
                       
                       <div className="space-y-2 mb-4">
                         {Object.entries(config.compatibleInsumoGroups || {}).map(([groupId, group]) => {
                           const groupArray = group as string[];
                           return (
                           <div key={groupId} className="flex items-center justify-between bg-white px-3 py-2 border border-blue-200 rounded-lg shadow-sm">
                             <div className="flex flex-wrap gap-1.5 items-center">
                               {groupArray.map((item, i) => (
                                 <span key={item} className="flex items-center text-xs font-semibold text-blue-800 bg-blue-100 px-2 py-0.5 rounded">
                                   {item}
                                   {i < groupArray.length - 1 && <span className="mx-1 text-blue-400">/</span>}
                                 </span>
                               ))}
                             </div>
                             <button
                               onClick={() => {
                                 const updatedGroups = { ...(config.compatibleInsumoGroups || {}) };
                                 delete updatedGroups[groupId];
                                 setConfig({
                                   ...config,
                                   compatibleInsumoGroups: updatedGroups
                                 });
                               }}
                               className="text-blue-400 hover:text-red-500 p-1 rounded transition-colors ml-2"
                               title="Eliminar grupo"
                             >
                               <Trash2 className="w-4 h-4" />
                             </button>
                           </div>
                         )})}
                         {(!config.compatibleInsumoGroups || Object.keys(config.compatibleInsumoGroups).length === 0) && (
                           <div className="text-xs text-blue-600/70 italic bg-white/50 px-3 py-2 rounded border border-blue-200/50">
                             No hay grupos de insumos equivalentes creados.
                           </div>
                         )}
                       </div>
                     </div>
                     <div className="flex-1 md:max-w-sm bg-white p-4 rounded-lg border border-blue-100 shadow-sm">
                       <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Nuevo Grupo de Equivalencia</h5>
                       <div className="space-y-3">
                         <div className="max-h-[160px] overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50 space-y-1">
                           {config.insumos?.map(insumo => {
                             const isChecked = newCompatibleGroup.includes(insumo);
                             return (
                               <label key={insumo} className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${isChecked ? 'bg-blue-50 text-blue-800 font-medium' : 'hover:bg-gray-100 text-gray-600'}`}>
                                 <input
                                   type="checkbox"
                                   className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                   checked={isChecked}
                                   onChange={(e) => {
                                     if (e.target.checked) {
                                       setNewCompatibleGroup([...newCompatibleGroup, insumo]);
                                     } else {
                                       setNewCompatibleGroup(newCompatibleGroup.filter(i => i !== insumo));
                                     }
                                   }}
                                 />
                                 <span className="text-xs">{insumo}</span>
                               </label>
                             );
                           })}
                         </div>
                         <button
                           onClick={() => {
                             if (newCompatibleGroup.length >= 2) {
                               const groupId = newCompatibleGroup.join('-');
                               const updatedGroups = { ...(config.compatibleInsumoGroups || {}) };
                               updatedGroups[groupId] = [...newCompatibleGroup];
                               setConfig({
                                 ...config,
                                 compatibleInsumoGroups: updatedGroups
                               });
                               setNewCompatibleGroup([]);
                             }
                           }}
                           disabled={newCompatibleGroup.length < 2}
                           className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wide"
                         >
                           <Plus className="w-3.5 h-3.5" /> Guardar Grupo ({newCompatibleGroup.length})
                         </button>
                       </div>
                     </div>
                   </div>
                 </div>

                 <div className="space-y-8">
                   {config.brands.map(brand => {
                     const brandFlavors = getFlavorsForBrand(brand);
                     if (brandFlavors.length === 0) return null;

                     const visibleInsumos = config.insumos?.filter(insumo => {
                       if (!config.compatibleInsumoGroups) return true;
                       for (const group of (Object.values(config.compatibleInsumoGroups) as string[][])) {
                         if (group.indexOf(insumo) > 0) return false;
                       }
                       return true;
                     }) || [];

                     return (
                       <div key={brand} className="space-y-3">
                          <h4 className="font-bold text-gray-700 flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-sm ring-2 ring-indigo-100"></div> 
                             {brand}
                          </h4>
                          <div className="overflow-x-auto border border-gray-200 rounded-lg">
                            <table className="min-w-full divide-y divide-gray-200 text-xs">
                              <thead className="bg-gray-100">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-200 sticky left-0 bg-gray-100 z-10 w-64 min-w-[16rem]">Kg por Unidad<br/><span className="font-normal text-[10px]">GPL/Sabor</span></th>
                                  {brandFlavors.map(sabor => (
                                    <th key={sabor} className="px-3 py-2 text-center font-semibold text-gray-700 border-r border-gray-200 min-w-[80px]">
                                      {sabor}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 bg-white">
                                {visibleInsumos.map(insumo => {
                                  // Determine display name
                                  let displayName = insumo;
                                  if (config.compatibleInsumoGroups) {
                                    const group = (Object.values(config.compatibleInsumoGroups) as string[][]).find(g => g[0] === insumo);
                                    if (group) displayName = group.join(' / ');
                                  }

                                  return (
                                  <tr key={insumo} className="hover:bg-gray-50">
                                    <td className="px-3 py-1.5 font-medium text-gray-800 border-r border-gray-200 sticky left-0 bg-white z-10 truncate shadow-[1px_0_0_0_#e5e7eb]">
                                      {displayName}
                                    </td>
                                    {brandFlavors.map(sabor => {
                                      const val = config.insumosMatrix?.[brand]?.[sabor]?.[insumo] || 0;
                                      return (
                                        <td key={sabor} className="p-0 border-r border-gray-200">
                                          <input
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            value={val === 0 ? '' : val}
                                            placeholder="0"
                                            onChange={(e) => {
                                              const newVal = Number(e.target.value);
                                              const currentMatrix = config.insumosMatrix || {};
                                              const brandData = currentMatrix[brand] || {};
                                              const saborData = brandData[sabor] || {};
                                              
                                              // Set the new value for this insumo
                                              let updatedMatrix = {
                                                ...currentMatrix,
                                                [brand]: {
                                                  ...brandData,
                                                  [sabor]: {
                                                    ...saborData,
                                                    [insumo]: newVal
                                                  }
                                                }
                                              };

                                              // If this is part of a compatible group, also mirror the value to other members for data consistency
                                              if (config.compatibleInsumoGroups) {
                                                const group = (Object.values(config.compatibleInsumoGroups) as string[][]).find(g => g.includes(insumo));
                                                if (group) {
                                                  group.forEach(member => {
                                                    if (member !== insumo) {
                                                      updatedMatrix[brand][sabor][member] = newVal;
                                                    }
                                                  });
                                                }
                                              }

                                              setConfig({
                                                ...config,
                                                insumosMatrix: updatedMatrix
                                              });
                                            }}
                                            className="w-full h-full min-h-[32px] text-center border-none bg-transparent hover:bg-gray-50 focus:ring-1 focus:ring-inset focus:ring-indigo-500 focus:bg-white transition-colors"
                                          />
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )})}
                              </tbody>
                            </table>
                          </div>
                       </div>
                     )
                   })}
                 </div>

              {/* ENVASES Y MATERIALES DE EMBALAJE */}
              </section>
              <section className="bg-gray-50 p-6 rounded-xl border border-gray-200 lg:col-span-2 space-y-6">
                 <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-gray-200 pb-4">
                   <div>
                     <h3 className="text-lg font-bold text-gray-800">Envases y Materiales de Embalaje</h3>
                     <p className="text-xs text-gray-500 mt-1">Configure las clases de Preformas, Plásticos Termocontraíbles, Film Stretch, Tapas y sus compatibilidades.</p>
                   </div>
                   <button
                     type="button"
                     onClick={() => {
                       if (confirm("¿Estás seguro de que deseas limpiar todas las clases precargadas de Preformas, Termocontraíble, Stretch, Tapas y sus compatibilidades? Se borrarán todos los datos y podrás cargar los tuyos de cero. Al finalizar, recuerda presionar el botón 'Guardar Cambios' al principio de la pestaña.")) {
                         setConfig({
                           ...config,
                           preformasConfig: [],
                           termoConfig: [],
                           stretchConfig: [],
                           tapaConfig: [],
                           compatiblePackagingGroups: {}
                         });
                       }
                     }}
                     className="px-3.5 py-2 hover:bg-rose-50 text-rose-600 font-bold text-xs uppercase tracking-wider rounded-lg border border-rose-200 bg-white shadow-sm transition-all self-start md:self-center"
                   >
                     Limpiar Clases Precargadas
                   </button>
                 </div>

                 {/* Packaging Compatibles / Equivalentes */}
                 <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl mb-6">
                   <div className="flex flex-col md:flex-row gap-6">
                     <div className="flex-1">
                       <h4 className="text-sm font-bold text-orange-900 mb-2 flex items-center gap-2">
                         <Link2 className="w-4 h-4" /> 
                         Grupos de Empaque Equivalentes
                       </h4>
                       <p className="text-xs text-orange-700 mb-4 max-w-lg">
                         Cree grupos de insumos de empaque que se pueden usar de forma intercambiable (ej. diferentes marcas de tapas del mismo calibre).
                       </p>
                       
                       <div className="space-y-2 mb-4">
                         {Object.entries(config.compatiblePackagingGroups || {}).map(([groupId, group]) => {
                           const groupArray = group as string[];
                           return (
                           <div key={groupId} className="flex items-center justify-between bg-white px-3 py-2 border border-orange-200 rounded-lg shadow-sm">
                             <div className="flex flex-wrap gap-1.5 items-center">
                               {groupArray.map((item, i) => (
                                 <span key={item} className="flex items-center text-xs font-semibold text-orange-800 bg-orange-100 px-2 py-0.5 rounded">
                                   {item}
                                   {i < groupArray.length - 1 && <span className="mx-1 text-orange-400">/</span>}
                                 </span>
                               ))}
                             </div>
                             <button
                               onClick={() => {
                                 const updatedGroups = { ...(config.compatiblePackagingGroups || {}) };
                                 delete updatedGroups[groupId];
                                 setConfig({
                                   ...config,
                                   compatiblePackagingGroups: updatedGroups
                                 });
                               }}
                               className="text-orange-400 hover:text-red-500 p-1 rounded transition-colors ml-2"
                               title="Eliminar grupo"
                             >
                               <Trash2 className="w-4 h-4" />
                             </button>
                           </div>
                         )})}
                         {(!config.compatiblePackagingGroups || Object.keys(config.compatiblePackagingGroups).length === 0) && (
                           <div className="text-xs text-orange-600/70 italic bg-white/50 px-3 py-2 rounded border border-orange-200/50">
                             No hay grupos de empaque equivalentes creados.
                           </div>
                         )}
                       </div>
                     </div>
                     <div className="flex-1 md:max-w-sm bg-white p-4 rounded-lg border border-orange-100 shadow-sm">
                       <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Nuevo Grupo de Equivalencia</h5>
                       <div className="space-y-3">
                         <div className="max-h-[160px] overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50 space-y-1">
                           {allPackagingItems.map(item => {
                             const isChecked = newCompatiblePackagingGroup.includes(item);
                             return (
                               <label key={item} className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${isChecked ? 'bg-orange-50 text-orange-800 font-medium' : 'hover:bg-gray-100 text-gray-600'}`}>
                                 <input
                                   type="checkbox"
                                   className="rounded text-orange-600 focus:ring-orange-500 w-3.5 h-3.5"
                                   checked={isChecked}
                                   onChange={(e) => {
                                     if (e.target.checked) {
                                       setNewCompatiblePackagingGroup([...newCompatiblePackagingGroup, item]);
                                     } else {
                                       setNewCompatiblePackagingGroup(newCompatiblePackagingGroup.filter(i => i !== item));
                                     }
                                   }}
                                 />
                                 <span className="text-xs">{item}</span>
                               </label>
                             );
                           })}
                         </div>
                         <button
                           onClick={() => {
                             if (newCompatiblePackagingGroup.length >= 2) {
                               const groupId = newCompatiblePackagingGroup.join('-');
                               const updatedGroups = { ...(config.compatiblePackagingGroups || {}) };
                               updatedGroups[groupId] = [...newCompatiblePackagingGroup];
                               setConfig({
                                 ...config,
                                 compatiblePackagingGroups: updatedGroups
                               });
                               setNewCompatiblePackagingGroup([]);
                             }
                           }}
                           disabled={newCompatiblePackagingGroup.length < 2}
                           className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wide"
                         >
                           <Plus className="w-3.5 h-3.5" /> Guardar Grupo ({newCompatiblePackagingGroup.length})
                         </button>
                       </div>
                     </div>
                   </div>
                 </div>

                 {/* PREFORMAS */}
                 <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4">
                   <div className="flex justify-between items-center border-b pb-3 mb-2">
                     <div className="flex items-center gap-2">
                       <Package className="w-5 h-5 text-blue-600" />
                       <h4 className="font-bold text-gray-800 text-sm">Clases de Preformas</h4>
                     </div>
                     <button
                       onClick={() => {
                         const current = config.preformasConfig || [];
                         setConfig({
                           ...config,
                           preformasConfig: [
                             ...current,
                             { name: 'Nueva Preforma', sizes: [3000], line: '', sqlCode: '' }
                           ]
                         });
                       }}
                       className="text-xs bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 rounded px-2.5 py-1.5 font-bold flex items-center gap-1 transition-all"
                     >
                       <Plus className="w-3.5 h-3.5" /> Agregar Preforma
                     </button>
                   </div>
                   
                   <div className="overflow-x-auto">
                     <table className="w-full text-xs text-left">
                       <thead>
                         <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider font-extrabold text-[10px] border-b">
                           <th className="px-4 py-2.5">Nombre / Clase de Preforma</th>
                           <th className="px-4 py-2.5">Calibres Asociados (cc)</th>
                           <th className="px-4 py-2.5">Sabores (Opcional)</th>
                           <th className="px-4 py-2.5">Línea (Opcional)</th>
                           <th className="px-4 py-2.5">Código SQL</th>
                           <th className="px-4 py-2.5 text-right">Acción</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-100">
                         {(config.preformasConfig || []).map((preforma, idx) => (
                           <tr key={idx} className="hover:bg-gray-50/50">
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={preforma.name}
                                 onChange={(e) => {
                                   const updated = [...(config.preformasConfig || [])];
                                   updated[idx].name = e.target.value;
                                   setConfig({ ...config, preformasConfig: updated });
                                 }}
                                 className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-wrap gap-1">
                                 {TAMANOS.map(size => {
                                   const isSelected = preforma.sizes.includes(size);
                                   return (
                                     <button
                                       key={size}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.preformasConfig || [])];
                                         const currentSizes = updated[idx].sizes || [];
                                         if (isSelected) {
                                           updated[idx].sizes = currentSizes.filter(s => s !== size);
                                         } else {
                                           updated[idx].sizes = [...currentSizes, size];
                                         }
                                         setConfig({ ...config, preformasConfig: updated });
                                       }}
                                       className={`px-2 py-1 rounded text-[10px] font-black tracking-tight transition-all ${
                                         isSelected
                                           ? 'bg-blue-600 text-white shadow-sm'
                                           : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                       }`}
                                     >
                                       {size}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-col gap-1 w-full max-h-[100px] overflow-y-auto">
                                 {config.flavors.map(flavor => {
                                   const isSelected = (preforma.flavors || []).includes(flavor);
                                   return (
                                     <button
                                       key={flavor}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.preformasConfig || [])];
                                         const currentFlavors = updated[idx].flavors || [];
                                         if (isSelected) {
                                           updated[idx].flavors = currentFlavors.filter(s => s !== flavor);
                                         } else {
                                           updated[idx].flavors = [...currentFlavors, flavor];
                                         }
                                         setConfig({ ...config, preformasConfig: updated });
                                       }}
                                       className={`px-2 py-1 text-left rounded text-[10px] font-medium transition-all ${
                                         isSelected
                                           ? 'bg-amber-100 text-amber-800 border border-amber-300 shadow-sm'
                                           : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600'
                                       }`}
                                     >
                                       {flavor}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <select
                                 value={preforma.line || ''}
                                 onChange={(e) => {
                                   const updated = [...(config.preformasConfig || [])];
                                   updated[idx].line = e.target.value;
                                   setConfig({ ...config, preformasConfig: updated });
                                 }}
                                 className="bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs focus:bg-white text-gray-800 outline-none w-24 font-bold"
                               >
                                 <option value="">Todas</option>
                                 {LINEAS.map(l => (
                                   <option key={l} value={l}>Línea {l}</option>
                                 ))}
                               </select>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={preforma.sqlCode || ''}
                                 placeholder="Sin Código"
                                 onChange={(e) => {
                                   const updated = [...(config.preformasConfig || [])];
                                   updated[idx].sqlCode = e.target.value;
                                   setConfig({ ...config, preformasConfig: updated });
                                 }}
                                 className="w-28 font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 text-right">
                               <button
                                 onClick={() => {
                                   const updated = (config.preformasConfig || []).filter((_, i) => i !== idx);
                                   setConfig({ ...config, preformasConfig: updated });
                                 }}
                                 className="text-gray-400 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors"
                                 title="Eliminar"
                               >
                                 <Trash2 className="w-4 h-4" />
                               </button>
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>

                 {/* TERMO */}
                 <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4">
                   <div className="flex justify-between items-center border-b pb-3 mb-2">
                     <div className="flex items-center gap-2">
                       <Scale className="w-5 h-5 text-orange-600" />
                       <h4 className="font-bold text-gray-800 text-sm">Plásticos Termocontraíbles (Termo)</h4>
                     </div>
                     <button
                       onClick={() => {
                         const current = config.termoConfig || [];
                         setConfig({
                           ...config,
                           termoConfig: [
                             ...current,
                             { name: 'Nuevo Plastico', sizes: [3000], sqlCode: '' }
                           ]
                         });
                       }}
                       className="text-xs bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 rounded px-2.5 py-1.5 font-bold flex items-center gap-1 transition-all"
                     >
                       <Plus className="w-3.5 h-3.5" /> Agregar Termocontraíble
                     </button>
                   </div>
                   
                   <div className="overflow-x-auto">
                     <table className="w-full text-xs text-left">
                       <thead>
                         <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider font-extrabold text-[10px] border-b">
                           <th className="px-4 py-2.5">Nombre / Medida del Termo</th>
                           <th className="px-4 py-2.5">Calibres Asociados (cc)</th>
                           <th className="px-4 py-2.5">Sabores (Opcional)</th>
                           <th className="px-4 py-2.5">Código SQL</th>
                           <th className="px-4 py-2.5 text-right">Acción</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-100">
                         {(config.termoConfig || []).map((termo, idx) => (
                           <tr key={idx} className="hover:bg-gray-50/50">
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={termo.name}
                                 onChange={(e) => {
                                   const updated = [...(config.termoConfig || [])];
                                   updated[idx].name = e.target.value;
                                   setConfig({ ...config, termoConfig: updated });
                                 }}
                                 className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-wrap gap-1">
                                 {TAMANOS.map(size => {
                                   const isSelected = termo.sizes.includes(size);
                                   return (
                                     <button
                                       key={size}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.termoConfig || [])];
                                         const currentSizes = updated[idx].sizes || [];
                                         if (isSelected) {
                                           updated[idx].sizes = currentSizes.filter(s => s !== size);
                                         } else {
                                           updated[idx].sizes = [...currentSizes, size];
                                         }
                                         setConfig({ ...config, termoConfig: updated });
                                       }}
                                       className={`px-2 py-1 rounded text-[10px] font-black tracking-tight transition-all ${
                                         isSelected
                                           ? 'bg-orange-600 text-white shadow-sm'
                                           : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                       }`}
                                     >
                                       {size}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-col gap-1 w-full max-h-[100px] overflow-y-auto">
                                 {config.flavors.map(flavor => {
                                   const isSelected = (termo.flavors || []).includes(flavor);
                                   return (
                                     <button
                                       key={flavor}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.termoConfig || [])];
                                         const currentFlavors = updated[idx].flavors || [];
                                         if (isSelected) {
                                           updated[idx].flavors = currentFlavors.filter(s => s !== flavor);
                                         } else {
                                           updated[idx].flavors = [...currentFlavors, flavor];
                                         }
                                         setConfig({ ...config, termoConfig: updated });
                                       }}
                                       className={`px-2 py-1 text-left rounded text-[10px] font-medium transition-all ${
                                         isSelected
                                           ? 'bg-amber-100 text-amber-800 border border-amber-300 shadow-sm'
                                           : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600'
                                       }`}
                                     >
                                       {flavor}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={termo.sqlCode || ''}
                                 placeholder="Sin Código"
                                 onChange={(e) => {
                                   const updated = [...(config.termoConfig || [])];
                                   updated[idx].sqlCode = e.target.value;
                                   setConfig({ ...config, termoConfig: updated });
                                 }}
                                 className="w-28 font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 text-right align-top">
                               <button
                                 onClick={() => {
                                   const updated = (config.termoConfig || []).filter((_, i) => i !== idx);
                                   setConfig({ ...config, termoConfig: updated });
                                 }}
                                 className="text-gray-400 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors"
                                 title="Eliminar"
                               >
                                 <Trash2 className="w-4 h-4" />
                               </button>
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>

                 {/* FILM STRETCH */}
                 <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4">
                   <div className="flex justify-between items-center border-b pb-3 mb-2">
                     <div className="flex items-center gap-2">
                       <TrendingUp className="w-5 h-5 text-purple-600" />
                       <h4 className="font-bold text-gray-800 text-sm">Film Stretch</h4>
                     </div>
                     <button
                       onClick={() => {
                         const current = config.stretchConfig || [];
                         setConfig({
                           ...config,
                           stretchConfig: [
                             ...current,
                             { name: 'Nueva Bobina', sizes: [3000], sqlCode: '' }
                           ]
                         });
                       }}
                       className="text-xs bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100 rounded px-2.5 py-1.5 font-bold flex items-center gap-1 transition-all"
                     >
                       <Plus className="w-3.5 h-3.5" /> Agregar Film Stretch
                     </button>
                   </div>
                   
                   <div className="overflow-x-auto">
                     <table className="w-full text-xs text-left">
                       <thead>
                         <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider font-extrabold text-[10px] border-b">
                           <th className="px-4 py-2.5">Nombre / Medida del Stretch</th>
                           <th className="px-4 py-2.5">Calibres Asociados (cc)</th>
                           <th className="px-4 py-2.5">Sabores (Opcional)</th>
                           <th className="px-4 py-2.5">Código SQL</th>
                           <th className="px-4 py-2.5 text-right">Acción</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-100">
                         {(config.stretchConfig || []).map((stretch, idx) => (
                           <tr key={idx} className="hover:bg-gray-50/50">
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={stretch.name}
                                 onChange={(e) => {
                                   const updated = [...(config.stretchConfig || [])];
                                   updated[idx].name = e.target.value;
                                   setConfig({ ...config, stretchConfig: updated });
                                 }}
                                 className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-wrap gap-1">
                                 {TAMANOS.map(size => {
                                   const isSelected = stretch.sizes.includes(size);
                                   return (
                                     <button
                                       key={size}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.stretchConfig || [])];
                                         const currentSizes = updated[idx].sizes || [];
                                         if (isSelected) {
                                           updated[idx].sizes = currentSizes.filter(s => s !== size);
                                         } else {
                                           updated[idx].sizes = [...currentSizes, size];
                                         }
                                         setConfig({ ...config, stretchConfig: updated });
                                       }}
                                       className={`px-2 py-1 rounded text-[10px] font-black tracking-tight transition-all ${
                                         isSelected
                                           ? 'bg-purple-600 text-white shadow-sm'
                                           : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                       }`}
                                     >
                                       {size}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-col gap-1 w-full max-h-[100px] overflow-y-auto">
                                 {config.flavors.map(flavor => {
                                   const isSelected = (stretch.flavors || []).includes(flavor);
                                   return (
                                     <button
                                       key={flavor}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.stretchConfig || [])];
                                         const currentFlavors = updated[idx].flavors || [];
                                         if (isSelected) {
                                           updated[idx].flavors = currentFlavors.filter(s => s !== flavor);
                                         } else {
                                           updated[idx].flavors = [...currentFlavors, flavor];
                                         }
                                         setConfig({ ...config, stretchConfig: updated });
                                       }}
                                       className={`px-2 py-1 text-left rounded text-[10px] font-medium transition-all ${
                                         isSelected
                                           ? 'bg-amber-100 text-amber-800 border border-amber-300 shadow-sm'
                                           : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600'
                                       }`}
                                     >
                                       {flavor}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={stretch.sqlCode || ''}
                                 placeholder="Sin Código"
                                 onChange={(e) => {
                                   const updated = [...(config.stretchConfig || [])];
                                   updated[idx].sqlCode = e.target.value;
                                   setConfig({ ...config, stretchConfig: updated });
                                 }}
                                 className="w-28 font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 text-right align-top">
                               <button
                                 onClick={() => {
                                   const updated = (config.stretchConfig || []).filter((_, i) => i !== idx);
                                   setConfig({ ...config, stretchConfig: updated });
                                 }}
                                 className="text-gray-400 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors"
                                 title="Eliminar"
                               >
                                 <Trash2 className="w-4 h-4" />
                               </button>
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>

               <section className="bg-gray-50 p-4 rounded-xl border border-gray-200 mt-8 lg:col-span-2">
                 <div className="flex justify-between items-center mb-4 border-b pb-2">
                   <div>
                     <h3 className="text-lg font-semibold text-gray-800">Tapas</h3>
                     <p className="text-xs text-gray-500 mt-1">Configuración de Tapas.</p>
                   </div>
                   <button
                     onClick={() => {
                       const current = config.tapaConfig || [];
                       setConfig({
                         ...config,
                         tapaConfig: [
                           ...current,
                           { name: 'Nueva Tapa', sizes: [3000], flavors: [], sqlCode: '' }
                         ]
                       });
                     }}
                     className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center gap-1 shadow-sm"
                   >
                     <Plus className="w-4 h-4" /> Agregar
                   </button>
                 </div>
                 
                 <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                   <div className="max-h-[300px] overflow-y-auto">
                     <table className="w-full text-left border-collapse">
                       <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
                         <tr>
                           <th className="px-4 py-2 text-[10px] uppercase font-bold text-gray-500 w-[25%]">Insumo</th>
                           <th className="px-4 py-2 text-[10px] uppercase font-bold text-gray-500 w-[35%]">Tamaños (cc)</th>
                           <th className="px-4 py-2 text-[10px] uppercase font-bold text-gray-500 w-[20%]">Sabores (Opc)</th>
                           <th className="px-4 py-2 text-[10px] uppercase font-bold text-gray-500 w-[10%]">Sistema</th>
                           <th className="px-4 py-2 text-right"></th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-100">
                         {(config.tapaConfig || []).map((tapa, idx) => (
                           <tr key={idx} className="hover:bg-gray-50/50">
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={tapa.name}
                                 onChange={(e) => {
                                   const updated = [...(config.tapaConfig || [])];
                                   updated[idx].name = e.target.value;
                                   setConfig({ ...config, tapaConfig: updated });
                                 }}
                                 className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-wrap gap-1">
                                 {TAMANOS.map(size => {
                                   const isSelected = (tapa.sizes || []).includes(size);
                                   return (
                                     <button
                                       key={size}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.tapaConfig || [])];
                                         const currentSizes = updated[idx].sizes || [];
                                         if (isSelected) {
                                           updated[idx].sizes = currentSizes.filter(s => s !== size);
                                         } else {
                                           updated[idx].sizes = [...currentSizes, size];
                                         }
                                         setConfig({ ...config, tapaConfig: updated });
                                       }}
                                       className={`px-2 py-1 rounded text-[10px] font-black tracking-tight transition-all ${
                                         isSelected
                                           ? 'bg-blue-100 text-blue-700 border border-blue-300 shadow-inner'
                                           : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600'
                                       }`}
                                     >
                                       {size}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <div className="flex flex-col gap-1 w-full max-h-[100px] overflow-y-auto">
                                 {config.flavors.map(flavor => {
                                   const isSelected = (tapa.flavors || []).includes(flavor);
                                   return (
                                     <button
                                       key={flavor}
                                       type="button"
                                       onClick={() => {
                                         const updated = [...(config.tapaConfig || [])];
                                         const currentFlavors = updated[idx].flavors || [];
                                         if (isSelected) {
                                           updated[idx].flavors = currentFlavors.filter(s => s !== flavor);
                                         } else {
                                           updated[idx].flavors = [...currentFlavors, flavor];
                                         }
                                         setConfig({ ...config, tapaConfig: updated });
                                       }}
                                       className={`px-2 py-1 text-left rounded text-[10px] font-medium transition-all ${
                                         isSelected
                                           ? 'bg-amber-100 text-amber-800 border border-amber-300 shadow-sm'
                                           : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600'
                                       }`}
                                     >
                                       {flavor}
                                     </button>
                                   );
                                 })}
                               </div>
                             </td>
                             <td className="px-4 py-3 align-top">
                               <input
                                 type="text"
                                 value={tapa.sqlCode || ''}
                                 placeholder="Cód"
                                 onChange={(e) => {
                                   const updated = [...(config.tapaConfig || [])];
                                   updated[idx].sqlCode = e.target.value;
                                   setConfig({ ...config, tapaConfig: updated });
                                 }}
                                 className="w-full font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               />
                             </td>
                             <td className="px-4 py-3 text-right align-top">
                               <button
                                 onClick={() => {
                                   const updated = (config.tapaConfig || []).filter((_, i) => i !== idx);
                                   setConfig({ ...config, tapaConfig: updated });
                                 }}
                                 className="text-gray-400 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors"
                                 title="Eliminar"
                               >
                                 <Trash2 className="w-4 h-4" />
                               </button>
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>
                 {/* Parámetros de Compra de Envases */}
                 <div className="mt-8 mb-4 border-t border-gray-200 pt-6">
                   <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                     <Package className="w-4 h-4 text-indigo-600" />
                     Parámetros de Compra de Envases
                   </h4>
                   <p className="text-xs text-gray-500 mb-4">Configure la criticidad y el lote de compra para preformas, termo, stretch y tapas.</p>
                   <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg shadow-sm">
                     <table className="min-w-full divide-y divide-gray-200 text-sm">
                       <thead className="bg-gray-50/50">
                         <tr>
                           <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Envase / Material</th>
                           <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Criticidad</th>
                           <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Presentación (Lote)</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-200">
                         {allPackagingItems.map((item, idx) => (
                           <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                             <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-gray-900">
                               {item}
                             </td>
                             <td className="px-4 py-3 whitespace-nowrap text-center text-sm text-gray-500">
                               <input
                                 type="number"
                                 step="0.1"
                                 min="1"
                                 value={config.insumosCriticality?.[item] || 1}
                                 onChange={e => handleUpdateInsumoPurchasing(item, 'criticality', e.target.value)}
                                 className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-[70px] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                                 title="Factor multiplicador (ej. 1.2)"
                               />
                             </td>
                             <td className="px-4 py-3 whitespace-nowrap text-center text-sm text-gray-500 flex items-center justify-center space-x-1">
                               <input
                                 type="number"
                                 step="0.1"
                                 min="0.1"
                                 value={config.insumosPurchaseLots?.[item]?.size || 1}
                                 onChange={e => handleUpdateInsumoPurchasing(item, 'lotSize', e.target.value)}
                                 className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-[70px] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                               />
                               <input
                                 type="text"
                                 placeholder="kg, L, un"
                                 value={config.insumosPurchaseLots?.[item]?.unit || 'kg'}
                                 onChange={e => handleUpdateInsumoPurchasing(item, 'lotUnit', e.target.value)}
                                 className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-[60px] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                               />
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>
               </section>
              </section>
          </div>
        </div>
      )}

      {activeTab === 'permissions' && rolePermissions && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Configuración de Permisos por Rol</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {(['produccion', 'calidad', 'jefe_produccion', 'admin'] as UserRole[]).map(role => (
              <div key={role} className="bg-gray-50 rounded-2xl p-5 border border-gray-100 flex flex-col h-full">
                <div className="flex items-center gap-2 mb-4">
                  <div className={`p-2 rounded-lg ${role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <h3 className="font-black uppercase tracking-tighter text-sm text-gray-800">
                    {role === 'admin' ? 'Admin General' : 
                     role === 'jefe_produccion' ? 'Jefe Producción' : 
                     role === 'produccion' ? 'Producción' : 'Calidad'}
                  </h3>
                </div>

                <div className="space-y-3 flex-1">
                  {Object.entries(rolePermissions[role]).map(([perm, value]) => {
                    const labelMap: Record<string, string> = {
                      viewReports: 'Ver Partes',
                      editReports: 'Cargar Partes',
                      viewElaboracion: 'Ver Elab.',
                      editElaboracion: 'Cargar Elab.',
                      viewScheduler: 'Ver Planificación',
                      editScheduler: 'Editar Planificación',
                      viewPersonnel: 'Ver Personal',
                      editPersonnel: 'Editar Personal',
                      viewLiveMonitor: 'Ver Monitor',
                      viewAnalytics: 'Ver Informes (Menú)',
                      viewManagementSummary: 'Reporte: Resumen',
                      viewConsolidated: 'Reporte: Consolidado',
                      viewWaste: 'Reporte: Desperdicio',
                      viewSyrup: 'Reporte: Jarabe',
                      viewGoalFulfillment: 'Reporte: Objetivos',
                      viewStockControl: 'Reporte: Stock',
                      viewDowntime: 'Reporte: Paradas',
                      viewEfficiency: 'Reporte: Eficiencia',
                      viewGantt: 'Reporte: Gantt',
                      viewAdmin: 'Acceso Admin Panel',
                      viewPersonnelPayroll: 'Ver Nómina (Personal)',
                      viewEnergy: 'Ver Módulo Energía',
                      editEnergy: 'Cargar Factura Real Energía',
                      viewHistoricalData: 'Ver Históricos Importer/Exporter',
                      editHistoricalData: 'Gestionar Importer/Exporter Históricos'
                    };
                    const label = labelMap[perm] || perm.replace(/([A-Z])/g, ' $1').trim();
                    return (
                    <label key={perm} className="flex items-center justify-between p-2 hover:bg-white rounded-lg transition-colors cursor-pointer group">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest group-hover:text-blue-600 transition-colors" title={perm}>
                        {label}
                      </span>
                      <input
                        type="checkbox"
                        checked={value as boolean}
                        onChange={(e) => {
                          const newPerms = { ...rolePermissions[role], [perm]: e.target.checked };
                          handleUpdatePermissions(role, newPerms);
                        }}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                    </label>
                  )})}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'salaries' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2 text-gray-900">
              <Briefcase className="w-6 h-6" />
              <h2 className="text-xl font-bold">Escalas Salariales por Rango</h2>
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
          
          {/* Adicionales de Carga Salarial */}
          <div className="bg-blue-50/50 rounded-2xl p-5 border border-blue-100 mb-8">
            <h3 className="text-xs font-black text-blue-800 uppercase tracking-widest mb-4">Adicionales Configurables sobre Salarios</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl p-4 border border-blue-100 shadow-sm">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Cargas Sociales Ciertas (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={typeof config?.cargasSocialesPercent === 'number' ? config.cargasSocialesPercent : 31.5}
                    onChange={(e) => {
                      if (!config) return;
                      setConfig({
                        ...config,
                        cargasSocialesPercent: Number(e.target.value)
                      });
                    }}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg pr-8 pl-4 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none focus:bg-white transition-all"
                    placeholder="31.5"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-medium">Se calcula sobre el salario base de cada categoría.</p>
              </div>

              <div className="bg-white rounded-xl p-4 border border-blue-100 shadow-sm">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">SAC (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={typeof config?.sacPercent === 'number' ? config.sacPercent : 8.33}
                    onChange={(e) => {
                      if (!config) return;
                      setConfig({
                        ...config,
                        sacPercent: Number(e.target.value)
                      });
                    }}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg pr-8 pl-4 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none focus:bg-white transition-all"
                    placeholder="8.33"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-medium">Sueldo Anual Complementario (Aguinaldo).</p>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6">Valores de salario base en $ para cada rango/categoría. Guarde los cambios al finalizar (Icono arriba a la derecha).</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {RANGOS_MIXTO.map(rango => {
              const currentSalary = config?.salariosPorRango?.[rango] || 0;
              return (
                <div key={rango} className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex flex-col justify-between h-full">
                  <h3 className="font-black text-gray-800 text-sm mb-3 tracking-tighter uppercase">{rango}</h3>
                  <div className="relative mt-auto">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                    <input
                      type="number"
                      min="0"
                      value={currentSalary || ''}
                      onChange={(e) => {
                        if (!config) return;
                        setConfig({
                          ...config,
                          salariosPorRango: {
                            ...(config.salariosPorRango || {}),
                            [rango]: Number(e.target.value)
                          }
                        });
                      }}
                      className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-4 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'waste' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Scale className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Referencia de Desperdicio</h2>
            </div>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
          
          <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6 border-b pb-4">
            Valores de referencia para el cálculo de desperdicio. Solo se muestran calibres con productos locales (no externos) activos.
          </p>
          
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 first:rounded-tl-xl">Calibre</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-200">Peso Etiqueta (g)</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-200">Peso Tapa (g)</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-200">Peso Termo (kg/pack)</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 last:rounded-tr-xl">Peso Stretch (kg/paleta)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSizesForWaste.length > 0 ? (
                  filteredSizesForWaste.map(size => {
                    const sizeStr = size.toString();
                    const weights = config.wasteWeights?.[sizeStr] || { etiq: 0, tapa: 0, termo: 0, stretch: 0 };
                    return (
                      <tr key={size} className="hover:bg-blue-50/20 transition-colors group">
                        <td className="px-6 py-5 text-sm font-black text-gray-900 font-mono bg-gray-50/30 group-hover:bg-blue-50/50 transition-colors">{size} cc</td>
                        <td className="px-6 py-5">
                          <input
                            type="number"
                            step="0.01"
                            value={weights.etiq}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setConfig({
                                ...config,
                                wasteWeights: {
                                  ...(config.wasteWeights || {}),
                                  [sizeStr]: { ...weights, etiq: val }
                                }
                              });
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all focus:bg-white"
                          />
                        </td>
                        <td className="px-6 py-5">
                          <input
                            type="number"
                            step="0.01"
                            value={weights.tapa}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setConfig({
                                ...config,
                                wasteWeights: {
                                  ...(config.wasteWeights || {}),
                                  [sizeStr]: { ...weights, tapa: val }
                                }
                              });
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all focus:bg-white"
                          />
                        </td>
                        <td className="px-6 py-5">
                          <input
                            type="number"
                            step="0.0001"
                            value={weights.termo}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setConfig({
                                ...config,
                                wasteWeights: {
                                  ...(config.wasteWeights || {}),
                                  [sizeStr]: { ...weights, termo: val }
                                }
                              });
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all focus:bg-white"
                          />
                        </td>
                        <td className="px-6 py-5">
                          <input
                            type="number"
                            step="0.0001"
                            value={weights.stretch}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setConfig({
                                ...config,
                                wasteWeights: {
                                  ...(config.wasteWeights || {}),
                                  [sizeStr]: { ...weights, stretch: val }
                                }
                              });
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all focus:bg-white"
                          />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic text-sm">
                      No hay calibres locales habilitados para configurar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'danger' && (
        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6">
          <div className="flex items-center gap-2 mb-6 text-red-600">
            <AlertTriangle className="w-6 h-6" />
            <h2 className="text-xl font-bold">Zona de Peligro (Cuidado)</h2>
          </div>
          
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <h3 className="text-lg font-bold text-red-900 mb-2">Borrar Datos de Prueba de Personal</h3>
            <p className="text-sm text-red-700 mb-6">
              Esta acción eliminará de forma <b>permanente e irreversible</b> todos los empleados, 
              registros de asistencia y asignaciones de turnos de la base de datos de "Control de Personal".
              Use esta función únicamente si desea limpiar la base de datos luego de realizar pruebas, 
              para comenzar a cargar datos reales desde cero. No se podrán recuperar los datos eliminados.
            </p>
            
            {!confirmPurge ? (
              <button
                onClick={() => setConfirmPurge(true)}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-xs transition-all"
              >
                <Trash2 className="w-4 h-4" />
                Borrar Base de Datos de Personal
              </button>
            ) : (
              <div className="bg-white p-5 rounded-xl border border-red-200 shadow-sm max-w-xl">
                <p className="text-red-800 font-bold mb-4">¿Está ABSOLUTAMENTE seguro de borrar todos los datos de personal? Esta acción no se puede deshacer.</p>
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      await handlePurgePersonnelData();
                      setConfirmPurge(false);
                    }}
                    disabled={isPurging}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50"
                  >
                    {isPurging ? (
                      <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {isPurging ? 'Borrando...' : 'Sí, borrar definitivamente'}
                  </button>
                  <button
                    onClick={() => setConfirmPurge(false)}
                    disabled={isPurging}
                    className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {message && message.type === 'success' && isPurging === false && (
              <p className="mt-4 text-sm font-bold text-green-600 uppercase tracking-widest">{message.text}</p>
            )}
            {message && message.type === 'error' && isPurging === false && (
              <p className="mt-4 text-sm font-bold text-red-600 uppercase tracking-widest">{message.text}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
