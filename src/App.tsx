import { useState, useEffect } from 'react';
import { auth, logout, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { 
  LogIn, 
  LogOut, 
  FileText, 
  PlusCircle, 
  Activity, 
  Trash2, 
  Clock, 
  CalendarDays, 
  User as UserIcon, 
  ChevronDown, 
  ClipboardList, 
  BarChart3, 
  Users,
  DraftingCompass,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Dashboard } from './components/Dashboard';
import { NewReportForm } from './components/NewReportForm';
import { ConsolidatedReport } from './components/ConsolidatedReport';
import { WasteReport } from './components/WasteReport';
import { DowntimeReport } from './components/DowntimeReport';
import { ParetoChart } from './components/ParetoChart';
import { EfficiencyReport } from './components/EfficiencyReport';
import { GanttChart } from './components/GanttChart';
import { AdminPanel } from './components/AdminPanel';
import { ElaboracionForm } from './components/ElaboracionForm';
import { ElaboracionHistory } from './components/ElaboracionHistory';
import { LiveMonitor } from './components/LiveMonitor';
import { ManagementSummary } from './components/ManagementSummary';
import { PersonnelManagement } from './components/PersonnelManagement';
import { ProductionScheduler } from './components/ProductionScheduler';
import { SyrupReport } from './components/SyrupReport';
import { GoalFulfillment } from './components/GoalFulfillment';
import { StockControl } from './components/StockControl';
import { Auth } from './components/Auth';
import { ProductionReport, ElaboracionReport, UserProfile, UserRole } from './types';
import { useRolePermissions } from './hooks/useRolePermissions';
import { Settings, Beaker, PieChart, ShieldCheck, TrendingUp } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null | undefined>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'new' | 'consolidated' | 'waste' | 'downtime' | 'pareto' | 'efficiency' | 'gantt' | 'admin' | 'elaboracion' | 'elaboracion_history' | 'profile' | 'live' | 'management_summary' | 'personnel' | 'scheduler' | 'syrup' | 'goal_fulfillment' | 'stock_control'>('dashboard');
  const [editingReport, setEditingReport] = useState<ProductionReport | undefined>(undefined);
  const [editingElabReport, setEditingElabReport] = useState<ElaboracionReport | undefined>(undefined);
  const [paretoLine, setParetoLine] = useState<string>('');
  const [paretoMonth, setParetoMonth] = useState<string>('');
  const [activeMenu, setActiveMenu] = useState<'data' | 'reports' | null>(null);

  const { permissions, loading: permissionsLoading } = useRolePermissions(userProfile?.role);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch user profile
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          const isAdminEmail = currentUser.email === 'fraed.fordrinks@gmail.com';

          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            // Force admin role for the main admin email if not already set
            if (isAdminEmail && data.role !== 'admin') {
              const updatedProfile = { ...data, role: 'admin' as UserRole };
              await setDoc(doc(db, 'users', currentUser.uid), updatedProfile, { merge: true });
              setUserProfile(updatedProfile);
            } else {
              setUserProfile(data);
            }
          } else {
            // Check if user is in allowed_users whitelist
            const email = currentUser.email?.toLowerCase();
            if (email) {
              const allowedDoc = await getDoc(doc(db, 'allowed_users', email));
              
              if (allowedDoc.exists() || isAdminEmail) {
                const allowedData = allowedDoc.data();
                // Create profile from whitelist or defaults for main admin
                const newProfile: UserProfile = {
                  uid: currentUser.uid,
                  email: currentUser.email || '',
                  displayName: currentUser.displayName || 'Usuario',
                  role: isAdminEmail ? 'admin' : (allowedData?.role || 'produccion'),
                  sector: allowedData?.sector || undefined,
                  photoURL: currentUser.photoURL || undefined,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                };
                await setDoc(doc(db, 'users', currentUser.uid), newProfile);
                
                // Clean up whitelist if it was used
                if (allowedDoc.exists()) {
                  await deleteDoc(doc(db, 'allowed_users', email));
                }
                
                setUserProfile(newProfile);
              } else {
                // Not on whitelist - block access
                console.warn("User not on whitelist:", email);
                setUserProfile(undefined); // undefined means unauthorized
              }
            } else {
              setUserProfile(undefined);
            }
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleEditReport = (report: ProductionReport) => {
    setEditingReport(report);
    setCurrentView('new');
  };

  const handleEditElabReport = (report: ElaboracionReport) => {
    setEditingElabReport(report);
    setCurrentView('elaboracion');
  };

  const handleNewReport = () => {
    setEditingReport(undefined);
    setCurrentView('new');
  };

  const handleCancel = () => {
    setEditingReport(undefined);
    setEditingElabReport(undefined);
    setCurrentView('dashboard');
  };

  const handleElabSuccess = () => {
    setEditingElabReport(undefined);
    setCurrentView('elaboracion_history');
  };

  const handleViewPareto = (linea: string, month: string) => {
    setParetoLine(linea);
    setParetoMonth(month);
    setCurrentView('pareto');
  };

  if (loading || permissionsLoading || !permissions) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Auth onSuccess={() => setCurrentView('dashboard')} />;
  }

  if (userProfile === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2 uppercase tracking-tighter">Acceso Restringido</h2>
          <p className="text-gray-500 mb-8">Tu cuenta ({user?.email}) no ha sido habilitada para acceder a este sistema. Por favor, contacta al administrador.</p>
          <button
            onClick={() => logout()}
            className="flex items-center justify-center gap-2 w-full bg-gray-900 text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-800 transition-all shadow-lg"
          >
            <LogOut className="w-5 h-5" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = userProfile?.role === 'admin' || user?.email === 'fraed.fordrinks@gmail.com';
  const roleName = {
    admin: 'Admin General',
    produccion: 'Producción',
    calidad: 'Calidad',
    jefe_produccion: 'Jefe de Producción'
  }[userProfile?.role || 'produccion'] || 'Usuario';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">ProdTrack</span>
            </div>
            <div className="flex items-center gap-4">
              {!isOnline && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-100 text-orange-700 rounded-md text-xs font-bold animate-pulse">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  MODO OFFLINE
                </div>
              )}
              <button 
                onClick={() => setCurrentView('profile')}
                className="hidden sm:flex items-center gap-2 text-sm text-gray-600 hover:bg-gray-100 p-1 px-2 rounded-lg transition-colors"
                title="Ver Perfil"
              >
                {user.photoURL || userProfile?.photoURL ? (
                  <img src={user.photoURL || userProfile?.photoURL || ''} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-blue-600" />
                  </div>
                )}
                <div className="flex flex-col items-start">
                  <span className="font-medium leading-none">{userProfile?.displayName || user.displayName}</span>
                  <span className="text-[10px] text-gray-400 capitalize">{roleName} {userProfile?.sector ? `(${userProfile.sector})` : ''}</span>
                </div>
              </button>
              <button
                onClick={logout}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                title="Cerrar Sesión"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8" onClick={() => setActiveMenu(null)}>
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4">
          <h1 className="text-2xl font-bold text-gray-900 shrink-0">
            {currentView === 'dashboard' && 'Datos de Producción'}
            {currentView === 'consolidated' && 'Consolidado de Producción'}
            {currentView === 'waste' && 'Acumulado de Desperdicio'}
            {currentView === 'downtime' && 'Resumen de Paradas'}
            {currentView === 'pareto' && 'Diagrama de Pareto'}
            {currentView === 'efficiency' && 'Eficiencias'}
            {currentView === 'gantt' && 'Gantt de Producción'}
            {currentView === 'management_summary' && 'Resumen Gerencial'}
            {currentView === 'elaboracion' && 'Parte de Elaboración'}
            {currentView === 'elaboracion_history' && 'Historial de Elaboración'}
            {currentView === 'live' && 'Monitor en Vivo'}
            {currentView === 'personnel' && 'Control de Personal'}
            {currentView === 'syrup' && 'Balance de Jarabes'}
            {currentView === 'goal_fulfillment' && 'Cumplimiento de Objetivos'}
            {currentView === 'stock_control' && 'Control de Stock y Salidas'}
            {currentView === 'admin' && 'Administración'}
            {currentView === 'profile' && 'Mi Perfil'}
            {currentView === 'new' && (editingReport ? 'Editar Parte de Producción' : 'Nuevo Parte de Producción')}
          </h1>
          
          <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5 w-full lg:w-auto">
            {/* GRUPO: DATOS CARGADOS */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMenu(activeMenu === 'data' ? null : 'data');
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  ['dashboard', 'elaboracion_history'].includes(currentView)
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span className="hidden sm:inline">Datos</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${activeMenu === 'data' ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {activeMenu === 'data' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-30 overflow-hidden"
                  >
                    {permissions.viewReports && (
                      <button
                        onClick={() => { setCurrentView('dashboard'); setActiveMenu(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          currentView === 'dashboard' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <FileText className="w-4 h-4" />
                        Datos Prod.
                      </button>
                    )}
                    {permissions.viewElaboracion && (
                      <button
                        onClick={() => { setCurrentView('elaboracion_history'); setActiveMenu(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          currentView === 'elaboracion_history' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Beaker className="w-4 h-4" />
                        Datos Elab.
                      </button>
                    )}
                    {permissions.viewPersonnel && (
                      <button
                        onClick={() => { setCurrentView('personnel'); setActiveMenu(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          currentView === 'personnel' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Users className="w-4 h-4" />
                        Personal
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="w-px h-6 bg-gray-200 mx-0.5" />

            {permissions.viewAnalytics && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenu(activeMenu === 'reports' ? null : 'reports');
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                    ['consolidated', 'waste', 'downtime', 'pareto', 'efficiency', 'gantt', 'syrup', 'goal_fulfillment'].includes(currentView)
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  <span className="hidden sm:inline">Informes</span>
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${activeMenu === 'reports' ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {activeMenu === 'reports' && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-30 overflow-hidden"
                    >
                      {permissions.viewManagementSummary !== false && (
                        <button
                          onClick={() => { setCurrentView('management_summary'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'management_summary' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <PieChart className="w-4 h-4" />
                          Resumen Gerencial
                        </button>
                      )}
                      
                      {permissions.viewConsolidated !== false && (
                        <button
                          onClick={() => { setCurrentView('consolidated'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'consolidated' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Activity className="w-4 h-4" />
                          Consolidado
                        </button>
                      )}

                      {permissions.viewWaste !== false && (
                        <button
                          onClick={() => { setCurrentView('waste'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'waste' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Trash2 className="w-4 h-4" />
                          Desperdicio
                        </button>
                      )}

                      {permissions.viewSyrup !== false && (
                        <button
                          onClick={() => { setCurrentView('syrup'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'syrup' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Beaker className="w-4 h-4" />
                          Balance Jarabe
                        </button>
                      )}

                      {permissions.viewGoalFulfillment !== false && (
                        <button
                          onClick={() => { setCurrentView('goal_fulfillment'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'goal_fulfillment' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <TrendingUp className="w-4 h-4" />
                          Cumplimiento Objetivos
                        </button>
                      )}

                      {permissions.viewStockControl !== false && (
                        <button
                          onClick={() => { setCurrentView('stock_control'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'stock_control' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Database className="w-4 h-4" />
                          Control de Stock
                        </button>
                      )}

                      {permissions.viewDowntime !== false && (
                        <button
                          onClick={() => { setCurrentView('downtime'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'downtime' || currentView === 'pareto' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Clock className="w-4 h-4" />
                          Paradas / Pareto
                        </button>
                      )}

                      {permissions.viewEfficiency !== false && (
                        <button
                          onClick={() => { setCurrentView('efficiency'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'efficiency' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <Activity className="w-4 h-4" />
                          Eficiencias
                        </button>
                      )}

                      {permissions.viewGantt !== false && (
                        <button
                          onClick={() => { setCurrentView('gantt'); setActiveMenu(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            currentView === 'gantt' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <CalendarDays className="w-4 h-4" />
                          Gantt Prod.
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="w-px h-6 bg-gray-200 mx-0.5" />

            {/* ACCIONES DIRECTAS */}
            <div className="w-px h-6 bg-gray-200 mx-0.5" />

            {permissions.viewScheduler && (
              <button
                onClick={() => { setCurrentView('scheduler'); setActiveMenu(null); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  currentView === 'scheduler' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <DraftingCompass className="w-4 h-4" />
                <span className="hidden md:inline">Planificación</span>
                <span className="md:hidden">Plani.</span>
              </button>
            )}

            {permissions.viewLiveMonitor && (
              <button
                onClick={() => { setCurrentView('live'); setActiveMenu(null); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  currentView === 'live' ? 'bg-cyan-600 text-white shadow-md shadow-cyan-200' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Activity className="w-4 h-4" />
                <span className="hidden md:inline">Monitor en Vivo</span>
                <span className="md:hidden">Monitor</span>
              </button>
            )}
            <div className="w-px h-6 bg-gray-200 mx-0.5" />
            {permissions.editElaboracion && (
              <button
                onClick={() => { setCurrentView('elaboracion'); setActiveMenu(null); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  currentView === 'elaboracion' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Beaker className="w-4 h-4" />
                <span className="hidden md:inline">Cargar Elab.</span>
                <span className="md:hidden">Elab.</span>
              </button>
            )}
            
            {permissions.editReports && (
              <button
                onClick={() => { handleNewReport(); setActiveMenu(null); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  currentView === 'new' && !editingReport ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <PlusCircle className="w-4 h-4" />
                <span className="hidden md:inline">Nuevo Parte</span>
                <span className="md:hidden">Nuevo</span>
              </button>
            )}

            {permissions.viewAdmin && (
              <>
                <div className="w-px h-6 bg-gray-200 mx-0.5" />
                <button
                  onClick={() => { setCurrentView('admin'); setActiveMenu(null); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                    currentView === 'admin' ? 'bg-gray-800 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden lg:inline">Admin</span>
                </button>
              </>
            )}
          </div>
        </div>

        {currentView === 'dashboard' && (
          <Dashboard onNewReport={handleNewReport} onEditReport={handleEditReport} isAdmin={isAdmin} />
        )}
        {currentView === 'consolidated' && (
          <ConsolidatedReport />
        )}
        {currentView === 'waste' && (
          <WasteReport />
        )}
        {currentView === 'downtime' && (
          <DowntimeReport onViewPareto={handleViewPareto} />
        )}
        {currentView === 'pareto' && (
          <ParetoChart 
            linea={paretoLine} 
            month={paretoMonth} 
            onBack={() => setCurrentView('downtime')} 
          />
        )}
        {currentView === 'efficiency' && (
          <EfficiencyReport />
        )}
        {currentView === 'syrup' && (
          <SyrupReport />
        )}
        {currentView === 'goal_fulfillment' && (
          <GoalFulfillment />
        )}
        {currentView === 'stock_control' && (
          <StockControl />
        )}
        {currentView === 'management_summary' && (
          <ManagementSummary />
        )}
        {currentView === 'gantt' && (
          <GanttChart onBack={() => setCurrentView('dashboard')} />
        )}
        {currentView === 'live' && (
          <LiveMonitor />
        )}
        {currentView === 'personnel' && (
          <PersonnelManagement userProfile={userProfile} />
        )}
        {currentView === 'scheduler' && (
          <ProductionScheduler isAdmin={permissions.editScheduler} />
        )}
        {currentView === 'admin' && (
          <AdminPanel userProfile={userProfile} />
        )}
        {currentView === 'profile' && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex flex-col items-center mb-8">
              <div className="relative">
                {user.photoURL || userProfile?.photoURL ? (
                  <img src={user.photoURL || userProfile?.photoURL || ''} alt="" className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-lg" />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-blue-100 flex items-center justify-center border-4 border-white shadow-lg">
                    <UserIcon className="w-16 h-16 text-blue-600" />
                  </div>
                )}
              </div>
              <h2 className="mt-4 text-2xl font-bold text-gray-900">{userProfile?.displayName || user.displayName}</h2>
              <p className="text-gray-500">{userProfile?.email || user.email}</p>
              <span className="mt-2 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full uppercase tracking-wider">
                {userProfile?.role || 'Usuario'}
              </span>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="block text-xs font-bold text-gray-400 uppercase mb-1">ID de Usuario</span>
                  <span className="text-sm font-mono text-gray-700">{user.uid}</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="block text-xs font-bold text-gray-400 uppercase mb-1">Fecha de Registro</span>
                  <span className="text-sm text-gray-700">
                    {userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              </div>

              <div className="flex justify-center pt-6">
                <button
                  onClick={logout}
                  className="flex items-center gap-2 px-8 py-3 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  Cerrar Sesión
                </button>
              </div>
            </div>
          </div>
        )}
        {currentView === 'elaboracion' && (
          <ElaboracionForm 
            key={editingElabReport?.id || 'elaboracion'}
            onCancel={handleCancel} 
            onSuccess={handleElabSuccess} 
            initialData={editingElabReport} 
          />
        )}
        {currentView === 'elaboracion_history' && (
          <ElaboracionHistory onEditReport={handleEditElabReport} onNewReport={() => setCurrentView('elaboracion')} isAdmin={isAdmin} />
        )}
        {currentView === 'new' && (
          <NewReportForm 
            key={editingReport?.id || 'new'}
            onCancel={handleCancel} 
            onSuccess={handleCancel} 
            initialData={editingReport} 
          />
        )}
      </main>
    </div>
  );
}
